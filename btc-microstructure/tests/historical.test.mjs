import { describe, test, eq, ok, near } from './harness.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDepthRow, parseTradeRow, canonicalDepth, canonicalTrades, merge, fromBinanceDepth, fromBinanceTrade, DEPTH, TRADE } from '../historical/canonical.mjs';
import { OrderBook } from '../collector/book.mjs';
import { bookFeatures, FlowWindows } from '../features/book-features.mjs';
import { flatten, COLUMNS } from '../historical/store.mjs';
import { dayRange, fetchableDays, canFetch, isFreeDay, RELIABLE_SINCE, datasetUrl, replayUrl } from '../historical/tardis.mjs';
import { HORIZONS, PRIMARY_HORIZON, FEATURES, SPLITS, buildPanel, fit, backtest, metrics } from '../research/m2h.mjs';
import { verdict } from '../historical/reconcile.mjs';

const line = (ts, local, snap, side, price, amt) => `binance-futures,BTCUSDT,${ts},${local},${snap},${side},${price},${amt}`;
const collect = async (it) => { const o = []; for await (const x of it) o.push(x); return o; };
async function* from(arr) { for (const x of arr) yield x; }

describe('vendor CSV parsing', () => {
  test('a depth row is parsed field by field, microseconds to milliseconds', () => {
    const r = parseDepthRow(line(1590969604584000, 1590969604753947, 'true', 'ask', '9446.83', '3.921'));
    eq(r.ts, 1590969604584);
    eq(r.localTs, 1590969604753.947);
    eq(r.isSnapshot, true);
    eq(r.bid, false);
    eq(r.price, '9446.83');
    eq(r.amount, '3.921');
  });

  test('a trade row carries the liquidity-taker side', () => {
    const r = parseTradeRow('binance-futures,BTCUSDT,1590969600567000,1590969601874296,137802763,buy,9446.49,0.319');
    eq(r.kind, TRADE);
    eq(r.ts, 1590969600567);
    eq(r.id, 137802763);
    eq(r.aggressiveBuy, true);
    near(r.price, 9446.49, 1e-9);
    near(r.qty, 0.319, 1e-12);
    eq(parseTradeRow('binance-futures,BTCUSDT,1,2,3,sell,100,1').aggressiveBuy, false);
  });

  test('rows sharing a timestamp are coalesced into one event', async () => {
    const evs = await collect(canonicalDepth(from([
      line(1000000, 1001000, 'false', 'bid', '100', '1'),
      line(1000000, 1001000, 'false', 'ask', '101', '2'),
      line(2000000, 2001000, 'false', 'bid', '100', '3'),
    ])));
    eq(evs.length, 2, 'two distinct timestamps must produce two events');
    eq(evs[0].b.length, 1); eq(evs[0].a.length, 1);
    eq(evs[0].ts, 1000);
    eq(evs[1].b[0][1], '3');
  });

  test('a snapshot run is kept separate from the deltas that follow it', async () => {
    const evs = await collect(canonicalDepth(from([
      line(1000000, 1001000, 'true', 'bid', '100', '1'),
      line(1000000, 1001000, 'false', 'bid', '100', '2'),
    ])));
    eq(evs.length, 2);
    eq(evs[0].isSnapshot, true);
    eq(evs[1].isSnapshot, false);
  });
});

describe('canonical schema is shared by both sources', () => {
  test('a live Binance payload becomes the same shape as a vendor event', () => {
    const d = fromBinanceDepth({ e: 'depthUpdate', E: 5, U: 1, u: 2, pu: 0, b: [['100', '1']], a: [] }, 7);
    eq(d.kind, DEPTH); eq(d.ts, 5); eq(d.localTs, 7); eq(d.seq.u, 2);
    const t = fromBinanceTrade({ e: 'aggTrade', T: 9, E: 10, a: 3, p: '100', q: '2', m: false }, 11);
    eq(t.kind, TRADE); eq(t.aggressiveBuy, true); eq(t.price, 100); eq(t.qty, 2);
    eq(fromBinanceTrade({ T: 1, a: 1, p: '1', q: '1', m: true }, 1).aggressiveBuy, false);
  });

  test('the vendor path carries no sequence ids, and says so rather than inventing them', async () => {
    const [ev] = await collect(canonicalDepth(from([line(1000000, 1001000, 'false', 'bid', '100', '1')])));
    eq(ev.seq, null);
  });

  test('merging two streams orders by exchange timestamp, depth winning ties', async () => {
    const d = canonicalDepth(from([line(1000000, 1000000, 'false', 'bid', '100', '1'), line(3000000, 3000000, 'false', 'bid', '100', '2')]));
    const t = canonicalTrades(from(['binance-futures,BTCUSDT,1000000,1000000,1,buy,100,1', 'binance-futures,BTCUSDT,2000000,2000000,2,sell,100,1']));
    const out = await collect(merge(d[Symbol.asyncIterator](), t[Symbol.asyncIterator]()));
    eq(out.map((x) => `${x.kind}@${x.ts}`).join(' '), 'depth@1000 trade@1000 trade@2000 depth@3000');
  });
});

describe('vendor book application', () => {
  const snapshot = { kind: DEPTH, ts: 1000, localTs: 1000, isSnapshot: true,
    b: [['100', '2'], ['99', '3']], a: [['101', '2'], ['102', '4']] };

  test('no delta is trusted before a snapshot arrives', () => {
    const bk = new OrderBook();
    const r = bk.applyVendor({ kind: DEPTH, ts: 1, localTs: 1, isSnapshot: false, b: [['100', '1']], a: [] });
    eq(bk.valid, false);
    eq(r.skipped, true);
    eq(bk.bids.size, 0, 'nothing may be applied to an unsynced book');
  });

  test('a snapshot followed by a delta makes the book valid', () => {
    const bk = new OrderBook();
    bk.applyVendor(snapshot);
    eq(bk.valid, false, 'the snapshot alone does not open the book');
    bk.applyVendor({ kind: DEPTH, ts: 2000, localTs: 2000, isSnapshot: false, b: [['100', '5']], a: [] });
    eq(bk.valid, true);
    eq(bk.bids.get(100), 5);
    eq(bk.bestAsk()[0], 101);
  });

  test('zero quantity removes a level on the vendor path too', () => {
    const bk = new OrderBook();
    bk.applyVendor(snapshot);
    bk.applyVendor({ kind: DEPTH, ts: 2000, localTs: 2000, isSnapshot: false, b: [['99', '0']], a: [] });
    eq(bk.bids.has(99), false);
  });

  test('a crossed book is caught by the on-demand check and invalidates', () => {
    const bk = new OrderBook();
    bk.applyVendor(snapshot);
    bk.applyVendor({ kind: DEPTH, ts: 2000, localTs: 2000, isSnapshot: false, b: [['105', '1']], a: [] });
    eq(bk.valid, true, 'applying does not check; the caller does');
    eq(bk.checkCrossed(), false);
    eq(bk.valid, false);
    eq(bk.stats.crossed, 1);
  });

  test('timestamp regressions are counted, not silently accepted', () => {
    const bk = new OrderBook();
    bk.applyVendor(snapshot);
    bk.applyVendor({ kind: DEPTH, ts: 5000, localTs: 5000, isSnapshot: false, b: [['100', '1']], a: [] });
    bk.applyVendor({ kind: DEPTH, ts: 4000, localTs: 4000, isSnapshot: false, b: [['100', '2']], a: [] });
    eq(bk.stats.timestampRegressions, 1);
  });

  test('pruning drops only levels far from mid, and the live collector never calls it', () => {
    const bk = new OrderBook();
    bk.applyVendor({ ...snapshot, b: [['100', '2'], ['50', '9']], a: [['101', '2'], ['500', '9']] });
    bk.applyVendor({ kind: DEPTH, ts: 2000, localTs: 2000, isSnapshot: false, b: [], a: [] });
    const dropped = bk.pruneFarLevels(0.02);
    eq(dropped, 2);
    eq(bk.bids.has(100), true); eq(bk.bids.has(50), false);
    eq(bk.asks.has(101), true); eq(bk.asks.has(500), false);
    const collector = readFileSync(new URL('../collector/collector.mjs', import.meta.url), 'utf8');
    ok(!/pruneFarLevels/.test(collector), 'the live collector must not prune');
  });

  test('the live apply() path is unchanged: it still checks crossing inline', () => {
    const bk = new OrderBook();
    bk.bufferEvent({ U: 95, u: 105, pu: 94, b: [], a: [], E: 1, recvMs: 1 });
    bk.applySnapshot({ lastUpdateId: 100, bids: [['100', '2']], asks: [['101', '2']] });
    const r = bk.apply({ E: 2, U: 106, u: 110, pu: 105, b: [['105', '1']], a: [], recvMs: 2 });
    eq(r.ok, false);
    eq(bk.valid, false, 'the live path must invalidate on the event itself, as it always did');
  });
});

describe('one feature engine, not two', () => {
  test('vendor and live books produce identical features from identical state', () => {
    const vendor = new OrderBook();
    vendor.applyVendor({ kind: DEPTH, ts: 1000, localTs: 1000, isSnapshot: true,
      b: [['100', '2'], ['99', '3']], a: [['101', '2'], ['102', '4']] });
    vendor.applyVendor({ kind: DEPTH, ts: 2000, localTs: 2000, isSnapshot: false, b: [], a: [] });

    const live = new OrderBook();
    live.bufferEvent({ U: 95, u: 105, pu: 94, b: [], a: [], E: 1, recvMs: 1 });
    live.applySnapshot({ lastUpdateId: 100, bids: [['100', '2'], ['99', '3']], asks: [['101', '2'], ['102', '4']] });

    const flowA = new FlowWindows(), flowB = new FlowWindows();
    flowA.add(1000, 500, true); flowB.add(1000, 500, true);
    const a = bookFeatures(vendor, flowA, 2000), b = bookFeatures(live, flowB, 2000);
    for (const k of ['bid', 'ask', 'mid', 'spreadBp', 'microprice', 'micropriceDisplacementBp']) near(a[k], b[k], 1e-12, k);
    for (const k of ['top1', 'top5', 'top10', 'weighted']) near(a.imbalance[k], b.imbalance[k], 1e-12, k);
    near(a.depth.bid.top5, b.depth.bid.top5, 1e-12);
    near(a.flow['5000ms'].afi, b.flow['5000ms'].afi, 1e-12);
  });

  test('there is no second implementation of the feature maths', () => {
    for (const f of ['../historical/replay.mjs', '../historical/reconcile.mjs', '../research/m2h.mjs']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      ok(!/function\s+bookFeatures|const\s+bookFeatures\s*=/.test(src), `${f} must import bookFeatures, not define it`);
      ok(!/function\s+walkBook|const\s+walkBook\s*=/.test(src), `${f} must import walkBook, not define it`);
    }
  });

  test('the store round-trips a feature record through the fixed column order', () => {
    const bk = new OrderBook();
    bk.applyVendor({ kind: DEPTH, ts: 1000, localTs: 1000, isSnapshot: true, b: [['100', '2']], a: [['101', '2']] });
    bk.applyVendor({ kind: DEPTH, ts: 2000, localTs: 2000, isSnapshot: false, b: [], a: [] });
    const fx = bookFeatures(bk, new FlowWindows(), 2000);
    fx.exec = { BUY: { 10000: { vwap: 101, slippageBp: 1, allInBp: 6, complete: true, levels: 1 }, 50000: { complete: false } },
      SELL: { 10000: { vwap: 100, slippageBp: 1, allInBp: 6, complete: true, levels: 1 }, 50000: { complete: false } } };
    const row = flatten(fx);
    eq(row.length, COLUMNS.length);
    eq(row[COLUMNS.indexOf('mid')], fx.mid);
    eq(row[COLUMNS.indexOf('execBuy10kComplete')], 1);
    eq(row[COLUMNS.indexOf('execBuy50kComplete')], 0);
  });
});

describe('provider access rules', () => {
  test('free access is the first day of each month, and only that', () => {
    eq(isFreeDay('2021-03-01'), true);
    eq(isFreeDay('2021-03-02'), false);
    if (!process.env.TARDIS_API_KEY) {
      eq(canFetch('2021-03-02'), false);
      eq(fetchableDays('2021-03-01', '2021-03-31').length, 1);
    }
  });
  test('the acceptance window starts where the vendor says capture is reliable', () => {
    eq(RELIABLE_SINCE, '2020-05-14');
    eq(SPLITS.dev[0], RELIABLE_SINCE, 'development must start at the reliable date, not earlier');
  });
  test('day ranges are inclusive and dense', () => {
    eq(dayRange('2020-05-14', '2020-05-16').join(), '2020-05-14,2020-05-15,2020-05-16');
  });
  test('urls are built for the right exchange and symbol', () => {
    ok(datasetUrl('trades', '2021-07-01').endsWith('/binance-futures/trades/2021/07/01/BTCUSDT.csv.gz'));
    ok(replayUrl('a', 'b', ['depth', 'aggTrade']).includes('binance-futures'));
    ok(decodeURIComponent(replayUrl('a', 'b', ['depth', 'aggTrade'])).includes('"channel":"aggTrade"'));
  });
});

describe('reconciliation verdict', () => {
  const good = {
    csvVsRaw: { compared: 600, relative: Object.fromEntries(['bid', 'ask', 'spreadBp', 'microprice', 'depthBidTop5', 'depthAskTop5', 'imbTop5', 'imbTop10'].map((k) => [k, { median: 0 }])) },
    batchedVsRaw: { relative: Object.fromEntries(['bid', 'ask', 'spreadBp', 'microprice', 'depthBidTop5', 'depthAskTop5', 'imbTop5', 'imbTop10'].map((k) => [k, { median: 0 }])) },
    aggressorSide: { correlation: 0.99 },
  };
  test('an exact reconstruction passes', () => eq(verdict(good).pass, true));
  test('a book that does not reproduce fails, and that stops the study', () => {
    const bad = structuredClone(good);
    bad.csvVsRaw.relative.imbTop5.median = 0.05;
    eq(verdict(bad).csvReproducesSequenceVerifiedBook, false);
    eq(verdict(bad).pass, false);
  });
  test('a flipped aggressor side fails', () => {
    const bad = structuredClone(good);
    bad.aggressorSide.correlation = -0.99;
    eq(verdict(bad).aggressorSideCorrect, false);
  });
  test('too little overlap fails even when everything matches', () => {
    const bad = structuredClone(good);
    bad.csvVsRaw.compared = 10;
    eq(verdict(bad).enoughOverlap, false);
  });
});

describe('M2-H study construction', () => {
  // A synthetic two-day panel with a planted forward-only effect in D1.
  function panel({ days = 2, seconds = 4000, edgeBpPerUnit = 0, seed = 3 } = {}) {
    let s = seed;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const rows = [], dayList = [];
    for (let d = 0; d < days; d++) {
      const iso = new Date(Date.UTC(2020, 5, 1 + d)).toISOString().slice(0, 10);
      dayList.push(iso);
      const base = Date.UTC(2020, 5, 1 + d) / 1000;
      const imb = Array.from({ length: seconds }, () => Math.max(-1, Math.min(1, gauss() / 3)));
      let mid = 10000, roll = 0;
      for (let i = 0; i < seconds; i++) {
        if (i) { roll += imb[i - 1]; if (i - 31 >= 0) roll -= imb[i - 31]; mid *= 1 + (gauss() * 3 + (edgeBpPerUnit * roll) / 30) / 1e4; }
        const half = mid * 1.25e-6 * (1 + 0.3 * Math.sin(i / 91));
        rows.push({ sec: base + i, day: d, mid, bid: mid - half, ask: mid + half,
          spreadBp: (2 * half / mid) * 1e4, imb: imb[i], depth: 5e6 * (1 + 0.2 * Math.sin(i / 177)) });
      }
    }
    const n = rows.length;
    const col = (f) => Float64Array.from(rows, f);
    const p = {
      n, days: dayList, dayIdx: Int32Array.from(rows, (r) => r.day), sec: col((r) => r.sec),
      cols: { at: col((r) => r.sec * 1000), bid: col((r) => r.bid), ask: col((r) => r.ask), mid: col((r) => r.mid),
        spreadBp: col((r) => r.spreadBp), micropriceDisplacementBp: col((r) => r.imb * 0.01),
        depthBid5bp: col((r) => r.depth * (1 + r.imb)), depthAsk5bp: col((r) => r.depth * (1 - r.imb)),
        imbTop5: col((r) => r.imb), flow5sAfi: col((r) => r.imb),
        pressureToCapacity: col((r) => r.imb), flowTimesFragility: col((r) => r.imb),
        execBuy10kVwap: col((r) => r.ask), execBuy10kSlipBp: col((r) => (r.ask - r.mid) / r.mid * 1e4),
        execBuy10kComplete: col(() => 1), execSell10kVwap: col((r) => r.bid),
        execSell10kSlipBp: col((r) => (r.mid - r.bid) / r.mid * 1e4), execSell10kComplete: col(() => 1),
        execBuy50kVwap: col((r) => r.ask), execBuy50kComplete: col(() => 1),
        execSell50kVwap: col((r) => r.bid), execSell50kComplete: col(() => 1) },
    };
    return p;
  }

  // buildPanel expects to load from the store; wire the derived fields the same way.
  function derive(p) {
    const off = (h) => { const o = new Int32Array(p.n).fill(-1); let j = 0;
      for (let i = 0; i < p.n; i++) { const want = p.sec[i] + h; if (j < i) j = i;
        while (j < p.n && p.sec[j] < want) j++;
        if (j < p.n && p.sec[j] === want && p.dayIdx[j] === p.dayIdx[i]) o[i] = j; } return o; };
    p.fwdIdx = Object.fromEntries(Object.entries(HORIZONS).map(([k, h]) => [k, off(h)]));
    const back = new Int32Array(p.n).fill(-1); let j = 0;
    for (let i = 0; i < p.n; i++) { const want = p.sec[i] - 30; while (j < p.n && p.sec[j] < want) j++;
      if (j < p.n && p.sec[j] === want && p.dayIdx[j] === p.dayIdx[i]) back[i] = j; }
    p.pastIdx = back;
    p.split = new Array(p.n).fill('dev');
    p.featVals = {};
    for (const [name, fn] of Object.entries(FEATURES)) {
      const v = new Float64Array(p.n);
      for (let i = 0; i < p.n; i++) {
        const prev = i > 0 && p.dayIdx[i - 1] === p.dayIdx[i] && p.sec[i - 1] === p.sec[i] - 1 ? i - 1 : -1;
        v[i] = fn(p.cols, i, prev);
      }
      p.featVals[name] = v;
    }
    return p;
  }

  test('the primary horizon is 30 s and is not reassignable from results', () => {
    eq(PRIMARY_HORIZON, '30s');
    eq(HORIZONS['30s'], 30);
  });

  test('forward returns never cross a day boundary', () => {
    const p = derive(panel({ days: 2, seconds: 200 }));
    const idx = p.fwdIdx[PRIMARY_HORIZON];
    for (let i = 0; i < p.n; i++) if (idx[i] >= 0) eq(p.dayIdx[idx[i]], p.dayIdx[i], 'a forward index leaked into another day');
    let crossed = 0;
    for (let i = 0; i < p.n; i++) if (idx[i] < 0) crossed++;
    ok(crossed > 0, 'the end of each day must have no forward return at all');
  });

  test('the target is strictly future: the index is exactly the horizon ahead', () => {
    const p = derive(panel({ days: 1, seconds: 500 }));
    const idx = p.fwdIdx[PRIMARY_HORIZON];
    for (let i = 0; i < p.n; i++) if (idx[i] >= 0) eq(p.sec[idx[i]] - p.sec[i], 30);
  });

  test('a planted forward effect is recovered with the right sign', () => {
    const p = derive(panel({ days: 3, seconds: 12000, edgeBpPerUnit: 8 }));
    const r = fit(p, 'D1_depthImbalance', PRIMARY_HORIZON, () => true);
    ok(r && r.beta > 0, `expected a positive beta, got ${r?.beta}`);
    ok(r.t > 3, `expected a large t, got ${r?.t.toFixed(2)}`);
  });

  test('a pure random walk stays quiet', () => {
    const p = derive(panel({ days: 3, seconds: 12000, edgeBpPerUnit: 0, seed: 77 }));
    const r = fit(p, 'D1_depthImbalance', PRIMARY_HORIZON, () => true);
    ok(Math.abs(r.t) < 3, `expected a quiet t under the null, got ${r.t.toFixed(2)}`);
  });

  test('no lookahead: a feature equal to the PAST return does not register as prediction', () => {
    const p = derive(panel({ days: 3, seconds: 12000, edgeBpPerUnit: 0, seed: 11 }));
    for (let i = 1; i < p.n; i++) {
      p.featVals.D1_depthImbalance[i] = p.dayIdx[i - 1] === p.dayIdx[i] ? Math.log(p.cols.mid[i] / p.cols.mid[i - 1]) * 1e4 : 0;
    }
    const r = fit(p, 'D1_depthImbalance', PRIMARY_HORIZON, () => true);
    ok(Math.abs(r.t) < 6, `a past-return feature must not masquerade as prediction (t = ${r.t.toFixed(2)})`);
  });

  test('the backtest prices both legs from the book, never mid to mid', () => {
    const p = derive(panel({ days: 1, seconds: 4000 }));
    const edges = [-0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4];
    const bt = backtest(p, 'D1_depthImbalance', edges, { size: 10000 });
    ok(bt.trades.length > 0);
    for (const t of bt.trades.slice(0, 50)) {
      if (t.dir > 0) { eq(t.entry, p.cols.execBuy10kVwap[t.i + 1]); }
      else { eq(t.entry, p.cols.execSell10kVwap[t.i + 1]); }
      ok(t.netBp === t.grossBp - 10, 'commission must be both sides at 5 bp');
    }
  });

  test('positions never overlap', () => {
    const p = derive(panel({ days: 1, seconds: 4000 }));
    const edges = [-0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4];
    const bt = backtest(p, 'D1_depthImbalance', edges, { size: 10000 });
    for (let i = 1; i < bt.trades.length; i++) {
      ok(bt.trades[i].sec > bt.trades[i - 1].sec + 30, `trade ${i} opened before the previous one closed`);
    }
  });

  test('trades that cannot be priced are excluded and counted, not filled at a guess', () => {
    const p = derive(panel({ days: 1, seconds: 4000 }));
    p.cols.execBuy10kComplete.fill(0);
    const edges = [-0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4];
    const bt = backtest(p, 'D1_depthImbalance', edges, { size: 10000 });
    ok(bt.excludedIncomplete > 0, 'an unfillable book must produce exclusions');
    for (const t of bt.trades) ok(t.dir < 0, 'only the sell side should remain executable');
  });

  test('metrics separate long from short and report the trimmed mean', () => {
    const p = derive(panel({ days: 1, seconds: 4000 }));
    const edges = [-0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4];
    const m = metrics(backtest(p, 'D1_depthImbalance', edges, { size: 10000 }));
    eq(m.long.n + m.short.n, m.trades);
    ok(Number.isFinite(m.netBpPerTradeExBest5pct));
    ok(m.netBpPerTradeExBest5pct <= m.netBpPerTrade + 1e-9, 'removing the best 5% cannot improve the mean');
  });
});
