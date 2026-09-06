// Historical viewer: replay a day of reconstructed book state, and read the M2-H
// backtest report in the browser instead of in a markdown file.
//
// Deliberately a separate process from the live planner: it takes no collector lock, so
// it can run while 24/7 capture continues.
//
// Usage: npm run replay -- --date 2020-06-01 [--port 8788]
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDay, storedDays, manifest } from './store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, '..', 'execution-planner', 'public');
const RESEARCH = resolve(HERE, '..', 'research');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', 8788));
const START_DATE = arg('--date', null);

// Only the fields the viewer draws; sending 53 columns for 86,400 seconds would be 40 MB.
const FRAME_COLS = ['at', 'bid', 'ask', 'mid', 'spreadBp', 'microprice', 'micropriceDisplacementBp',
  'depthBidTop1', 'depthBidTop5', 'depthBidTop10', 'depthBid1bp', 'depthBid2bp', 'depthBid5bp', 'depthBid10bp',
  'depthAskTop1', 'depthAskTop5', 'depthAskTop10', 'depthAsk1bp', 'depthAsk2bp', 'depthAsk5bp', 'depthAsk10bp',
  'imbTop1', 'imbTop5', 'imbTop10', 'imbWeighted', 'flow5sAfi', 'flow5sSigned', 'flow30sAfi',
  'pressureToCapacity', 'flowTimesFragility',
  'execBuy10kSlipBp', 'execSell10kSlipBp', 'execBuy10kComplete', 'bidLevels', 'askLevels'];

const cache = new Map();
const day = (iso) => {
  if (!cache.has(iso)) {
    const d = readDay(iso);
    if (!d) return null;
    if (cache.size > 2) cache.delete(cache.keys().next().value);   // a day is ~35 MB in memory
    cache.set(iso, d);
  }
  return cache.get(iso);
};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  if (url.pathname === '/api/days') {
    const m = manifest();
    return send(200, { days: storedDays(), startDate: START_DATE, manifest: m.days, totalBytes: m.totalBytes, totalRows: m.totalRows });
  }

  if (url.pathname === '/api/frames') {
    const iso = url.searchParams.get('day');
    const d = day(iso);
    if (!d) return send(404, { error: `no stored day ${iso}` });
    const from = Math.max(0, Number(url.searchParams.get('from') || 0));
    const count = Math.min(3600, Math.max(1, Number(url.searchParams.get('count') || 600)));
    const to = Math.min(d.n, from + count);
    const out = {};
    for (const c of FRAME_COLS) out[c] = Array.from(d.cols[c].subarray(from, to), (x) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null));
    return send(200, { day: iso, from, to, rows: d.n, header: d.header, cols: out });
  }

  if (url.pathname === '/api/research') {
    const f = join(RESEARCH, 'results-m2h.json');
    if (!existsSync(f)) return send(200, { available: false, reason: 'run `npm run research:m2h`' });
    return send(200, { available: true, ...JSON.parse(readFileSync(f, 'utf8')) });
  }

  if (url.pathname === '/api/audit') {
    const f = join(RESEARCH, 'AUDIT-M2H.md');
    return send(200, existsSync(f) ? readFileSync(f, 'utf8') : '# not generated yet', 'text/plain; charset=utf-8');
  }

  const file = url.pathname === '/' ? 'replay.html' : url.pathname === '/backtest' ? 'backtest.html' : url.pathname.slice(1);
  const full = join(PUBLIC, file);
  if (!full.startsWith(PUBLIC) || !existsSync(full)) return send(404, 'not found', 'text/plain');
  return send(200, readFileSync(full), MIME[extname(full)] || 'application/octet-stream');
});

server.listen(PORT, () => {
  const days = storedDays();
  console.log(`\n  M2-H HISTORICAL VIEWER`);
  console.log(`  replay    http://localhost:${PORT}/${START_DATE ? `?date=${START_DATE}` : ''}`);
  console.log(`  backtest  http://localhost:${PORT}/backtest\n`);
  console.log(`  ${days.length} day(s) in the feature store${days.length ? `: ${days[0]} … ${days.at(-1)}` : ' — run `npm run m2h:replay` first'}\n`);
});
