// BTC Execution Planner — local, read-only, no API key, no order placement, ever.
// Starts the collector in-process and serves the current book state plus a
// walk-the-book execution estimate.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Collector } from '../collector/collector.mjs';
import { walkBook, costProfiles, executionQuality, marketOrderCostBand } from '../features/execution.mjs';
import { liquidityState, bookPressure } from '../features/book-features.mjs';
import { PLANNER, FEES, COST_PROFILES, SYMBOL, WS_LIMITS } from '../collector/config.mjs';
import { coverage } from '../research/coverage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

// There is no validated directional model. This is not a placeholder to be flipped by
// hand: nothing may set it true except a passing M2 directional gate written into
// research/results-m2.json, and the server checks that file rather than trusting a flag.
function directionalStatus() {
  const f = resolve(HERE, '..', 'research', 'results-m2.json');
  if (!existsSync(f)) return { validated: false, state: 'COLLECTING', reason: 'no directional results file yet' };
  try {
    const r = JSON.parse(readFileSync(f, 'utf8'));
    return { validated: r.directionalGatePassed === true && r.economicGatePassed === true,
      state: r.status || 'UNKNOWN', reason: r.reason || null };
  } catch {
    return { validated: false, state: 'UNKNOWN', reason: 'results file unreadable' };
  }
}

export function start({ port = PLANNER.port } = {}) {
  const collector = new Collector().start();

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };

    if (url.pathname === '/api/status') {
      return send(200, { ...collector.status(), directional: directionalStatus(), coverage: coverage(),
        fees: FEES, costProfiles: COST_PROFILES, wsLimits: WS_LIMITS,
        planner: { defaultNotionalUsd: PLANNER.defaultNotionalUsd, presets: PLANNER.presetNotionalUsd, maxAllInCostBp: PLANNER.maxAllInCostBp } });
    }

    if (url.pathname === '/api/plan') {
      const side = (url.searchParams.get('side') || 'BUY').toUpperCase();
      const notional = Number(url.searchParams.get('notional') || PLANNER.defaultNotionalUsd);
      const maxBp = url.searchParams.get('maxBp') ? Number(url.searchParams.get('maxBp')) : PLANNER.maxAllInCostBp;
      if (side !== 'BUY' && side !== 'SELL') return send(400, { error: 'side must be BUY or SELL' });
      if (!Number.isFinite(notional) || notional <= 0) return send(400, { error: 'notional must be a positive number' });

      const st = collector.status();
      const fx = collector.lastFeature;
      if (!st.book.valid) {
        return send(200, { bookValid: false, reason: st.book.reason, side, notional,
          message: 'The local order book is not sequence-verified right now, so no execution estimate is shown.' });
      }
      const est = walkBook(collector.book, side, notional);
      const both = { BUY: walkBook(collector.book, 'BUY', notional), SELL: walkBook(collector.book, 'SELL', notional) };
      return send(200, {
        bookValid: true, side, notional, at: Date.now(),
        estimate: est, profiles: costProfiles(est),
        quality: executionQuality(est, maxBp), costBand: marketOrderCostBand(est),
        symmetry: { buyAllInBp: both.BUY.allInBp, sellAllInBp: both.SELL.allInBp },
        liquidity: liquidityState(fx), pressure: bookPressure(fx),
        book: { bid: fx?.bid, ask: fx?.ask, mid: fx?.mid, spreadBp: fx?.spreadBp, microprice: fx?.microprice,
          micropriceDisplacementBp: fx?.micropriceDisplacementBp, depth: fx?.depth, imbalance: fx?.imbalance, flow: fx?.flow },
        feeds: st.feeds, directional: directionalStatus(),
      });
    }

    if (url.pathname === '/api/book') return send(200, collector.book.snapshotTop(20));

    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const full = join(PUBLIC, file);
    if (!full.startsWith(PUBLIC) || !existsSync(full)) return send(404, 'not found', 'text/plain');
    return send(200, readFileSync(full), MIME[extname(full)] || 'application/octet-stream');
  });

  server.listen(port, () => {
    console.log(`\n  BTC EXECUTION PLANNER  ${SYMBOL} (Binance USDⓈ-M)`);
    console.log(`  http://localhost:${port}\n`);
    console.log('  Read-only public market data. No API key. No orders are ever placed.');
    console.log('  The order book needs a few seconds to sequence-verify after start.\n');
  });

  const shutdown = () => { collector.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref?.(); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return { server, collector };
}

if (import.meta.url === `file://${process.argv[1]}`) start();
