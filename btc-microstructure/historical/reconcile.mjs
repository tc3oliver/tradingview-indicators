// Vendor / live reconciliation.
//
// Three questions, because the answer to each licenses a different thing:
//
//  1. Does the bulk CSV path reproduce a sequence-verified book?
//     Tardis's normalised CSV has no U/u/pu, so its book cannot be checked against
//     Binance's own continuity rule. The replay API returns the ORIGINAL Binance
//     payloads, which go through the identical OrderBook.apply() the live collector
//     uses. Rebuild both for the same window and compare feature by feature.
//
//  2. Is our live @100ms depth equivalent to the @0ms stream Tardis captures?
//     Binance's 100 ms diff is the union of the 0 ms updates in that window with
//     absolute, last-write-wins levels, so the book at any boundary should be identical.
//     That is an argument; here it is tested, by batching the raw 0 ms stream into
//     100 ms events and comparing the resulting books.
//
//  3. Does the CSV's `side` mean what we think it means?
//     The CSV says buy/sell; the raw payload says `m` (buyer-is-maker). If we have the
//     aggressor backwards, every flow feature is sign-flipped.
//
// If (1) fails, vendor backtests may not be carried to the live planner and the study
// stops. That is the point of running this before the research, not after.
import { streamReplay, isFreeDay } from './tardis.mjs';
import { OrderBook } from '../collector/book.mjs';
import { FlowWindows, bookFeatures } from '../features/book-features.mjs';
import { readDay } from './store.mjs';

const SEC = 1000;
const COMPARE = [
  ['bid', (f) => f.bid], ['ask', (f) => f.ask], ['spreadBp', (f) => f.spreadBp],
  ['microprice', (f) => f.microprice], ['micropriceDisplacementBp', (f) => f.micropriceDisplacementBp],
  ['depthBidTop1', (f) => f.depth.bid.top1], ['depthBidTop5', (f) => f.depth.bid.top5], ['depthBidTop10', (f) => f.depth.bid.top10],
  ['depthAskTop1', (f) => f.depth.ask.top1], ['depthAskTop5', (f) => f.depth.ask.top5], ['depthAskTop10', (f) => f.depth.ask.top10],
  ['depthBid5bp', (f) => f.depth.bid.within5bp], ['depthAsk5bp', (f) => f.depth.ask.within5bp],
  ['imbTop1', (f) => f.imbalance.top1], ['imbTop5', (f) => f.imbalance.top5], ['imbTop10', (f) => f.imbalance.top10],
  ['imbWeighted', (f) => f.imbalance.weighted],
  ['flow5sAfi', (f) => f.flow?.['5000ms']?.afi ?? NaN],
  ['flow5sSigned', (f) => f.flow?.['5000ms']?.signedQuote ?? NaN],
  ['pressureToCapacity', (f) => f.interaction?.pressureToCapacity ?? NaN],
  ['flowTimesFragility', (f) => f.interaction?.flowTimesFragility ?? NaN],
];

const stats = (xs) => {
  if (!xs.length) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  return { n: xs.length, median: s[Math.floor(s.length / 2)], p99: s[Math.floor(0.99 * s.length)], max: s.at(-1) };
};

/**
 * Rebuild the book from raw Binance payloads via the strict, sequence-verified path.
 * `batchMs > 0` first coalesces the 0 ms stream into batched diffs, which is how the
 * exchange builds the @100ms stream our live collector subscribes to.
 */
async function rawPath(day, fromIso, toIso, { batchMs = 0 } = {}) {
  const book = new OrderBook(), flow = new FlowWindows();
  const perSec = new Map();
  let nextSec = null, pending = null, tradeSides = { buy: 0, sell: 0 };

  const sampleTo = (sec) => {
    while (nextSec !== null && sec > nextSec) {
      if (book.valid) {
        const fx = bookFeatures(book, flow, nextSec * SEC);
        if (fx) perSec.set(nextSec, fx);
      }
      nextSec++;
    }
  };
  const flushBatch = () => {
    if (!pending) return;
    // Last write wins within the batch, exactly as an exchange-side 100 ms diff does.
    const b = [...pending.b].map(([p, q]) => [p, q]), a = [...pending.a].map(([p, q]) => [p, q]);
    book.apply({ E: pending.E, U: pending.U, u: pending.u, pu: pending.pu, b, a, recvMs: pending.localTs });
    pending = null;
  };

  for await (const { localTs, payload, stream } of streamReplay(fromIso, toIso, ['depth', 'depthSnapshot', 'aggTrade'])) {
    const sec = Math.floor((payload.E ?? localTs) / SEC);
    if (nextSec === null) nextSec = sec;
    if (sec > nextSec) { flushBatch(); sampleTo(sec); }

    if (stream?.endsWith('@depthSnapshot') || payload.lastUpdateId !== undefined) {
      flushBatch();
      book.applySnapshot({ lastUpdateId: payload.lastUpdateId, bids: payload.bids, asks: payload.asks });
    } else if (payload.e === 'depthUpdate') {
      if (!batchMs) {
        book.apply({ ...payload, recvMs: localTs });
      } else {
        const bucket = Math.floor(payload.E / batchMs);
        if (pending && pending.bucket !== bucket) flushBatch();
        if (!pending) pending = { bucket, E: payload.E, localTs, U: payload.U, u: payload.u, pu: payload.pu, b: new Map(), a: new Map() };
        pending.E = payload.E; pending.u = payload.u; pending.localTs = localTs;
        for (const [p, q] of payload.b || []) pending.b.set(p, q);
        for (const [p, q] of payload.a || []) pending.a.set(p, q);
      }
    } else if (payload.e === 'aggTrade') {
      const aggressiveBuy = payload.m === false;
      if (aggressiveBuy) tradeSides.buy++; else tradeSides.sell++;
      flow.add(payload.T ?? payload.E, +payload.p * +payload.q, aggressiveBuy);
    }
  }
  flushBatch();
  sampleTo(nextSec + 1);
  return { perSec, book, tradeSides };
}

/**
 * @param day    a free-tier day (first of the month) unless an API key is present
 * @param minutes window length from midnight UTC
 */
export async function reconcile(day, { minutes = 10, batchMs = 100 } = {}) {
  const from = `${day}T00:00:00.000Z`;
  const to = new Date(Date.parse(from) + minutes * 60_000).toISOString();
  const out = { day, from, to, minutes, freeTierDay: isFreeDay(day) };

  // 1. raw, sequence-verified, event by event
  const raw = await rawPath(day, from, to, { batchMs: 0 });
  out.raw = { seconds: raw.perSec.size, gaps: raw.book.stats.gaps, applied: raw.book.stats.applied,
    dropped: raw.book.stats.dropped, crossed: raw.book.stats.crossed, tradeSides: raw.tradeSides };

  // 2. the same raw stream, batched to 100 ms the way the live @100ms feed is
  const batched = await rawPath(day, from, to, { batchMs });
  out.batched = { seconds: batched.perSec.size, gaps: batched.book.stats.gaps };
  const batchDiffs = {};
  for (const [name] of COMPARE) batchDiffs[name] = [];
  let batchCompared = 0;
  for (const [sec, fa] of raw.perSec) {
    const fb = batched.perSec.get(sec);
    if (!fb) continue;
    batchCompared++;
    for (const [name, get] of COMPARE) {
      const x = get(fa), y = get(fb);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      batchDiffs[name].push(Math.abs(x - y) / Math.max(1e-12, Math.abs(x) || 1));
    }
  }
  out.batchedVsRaw = { compared: batchCompared, relative: Object.fromEntries(Object.entries(batchDiffs).map(([k, v]) => [k, stats(v)])) };

  // 3. the bulk CSV path, read back from the feature store built by historical/replay.mjs
  const store = readDay(day);
  if (!store) {
    out.storeMissing = true;
    return out;
  }
  const byAt = new Map();
  for (let i = 0; i < store.n; i++) byAt.set(Math.floor(store.cols.at[i] / SEC), i);
  const csvDiffs = {}, absDiffs = {};
  for (const [name] of COMPARE) { csvDiffs[name] = []; absDiffs[name] = []; }
  let compared = 0, missingInStore = 0;
  const colOf = { bid: 'bid', ask: 'ask', spreadBp: 'spreadBp', microprice: 'microprice',
    micropriceDisplacementBp: 'micropriceDisplacementBp',
    depthBidTop1: 'depthBidTop1', depthBidTop5: 'depthBidTop5', depthBidTop10: 'depthBidTop10',
    depthAskTop1: 'depthAskTop1', depthAskTop5: 'depthAskTop5', depthAskTop10: 'depthAskTop10',
    depthBid5bp: 'depthBid5bp', depthAsk5bp: 'depthAsk5bp',
    imbTop1: 'imbTop1', imbTop5: 'imbTop5', imbTop10: 'imbTop10', imbWeighted: 'imbWeighted',
    flow5sAfi: 'flow5sAfi', flow5sSigned: 'flow5sSigned',
    pressureToCapacity: 'pressureToCapacity', flowTimesFragility: 'flowTimesFragility' };
  for (const [sec, fa] of raw.perSec) {
    const i = byAt.get(sec);
    if (i === undefined) { missingInStore++; continue; }
    compared++;
    for (const [name, get] of COMPARE) {
      const x = get(fa), y = store.cols[colOf[name]][i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      absDiffs[name].push(Math.abs(x - y));
      csvDiffs[name].push(Math.abs(x - y) / Math.max(1e-12, Math.abs(x) || 1));
    }
  }
  out.csvVsRaw = { compared, missingInStore,
    relative: Object.fromEntries(Object.entries(csvDiffs).map(([k, v]) => [k, stats(v)])),
    absolute: Object.fromEntries(Object.entries(absDiffs).map(([k, v]) => [k, stats(v)])) };

  // 4. aggressor-side semantics: the CSV's buy/sell against the raw `m` flag
  const storeBuy = [], storeSell = [];
  for (let i = 0; i < store.n; i++) {
    const sec = Math.floor(store.cols.at[i] / SEC);
    if (!raw.perSec.has(sec)) continue;
    storeBuy.push(store.cols.flow5sBuy[i]); storeSell.push(store.cols.flow5sSell[i]);
  }
  const rawAfi = [], storeAfi = [];
  for (const [sec, fa] of raw.perSec) {
    const i = byAt.get(sec); if (i === undefined) continue;
    const x = fa.flow?.['5000ms']?.afi, y = store.cols.flow5sAfi[i];
    if (Number.isFinite(x) && Number.isFinite(y)) { rawAfi.push(x); storeAfi.push(y); }
  }
  const corr = (a, b) => {
    const n = a.length; if (n < 2) return NaN;
    const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
    let sab = 0, sa = 0, sb = 0;
    for (let i = 0; i < n; i++) { const u = a[i] - ma, v = b[i] - mb; sab += u * v; sa += u * u; sb += v * v; }
    return sa && sb ? sab / Math.sqrt(sa * sb) : NaN;
  };
  out.aggressorSide = { n: rawAfi.length, correlation: corr(rawAfi, storeAfi),
    correlationIfFlipped: corr(rawAfi, storeAfi.map((x) => -x)),
    note: 'a correlation near +1 confirms the CSV `side` column is the liquidity-taker side; near -1 would mean every flow feature is sign-flipped' };

  return out;
}

/**
 * Pool reconciliation over several days.
 *
 * Free replay access caps a response at roughly 3.2 MB, which on this instrument is about
 * one minute of raw depth — measured, not assumed. The pre-registered overlap threshold is
 * a count of compared seconds, not a requirement that they be consecutive, so the window is
 * pooled across days instead of stretched.
 */
export async function reconcileDays(days, { minutes = 5 } = {}) {
  const parts = [];
  for (const d of days) {
    try { parts.push(await reconcile(d, { minutes })); }
    catch (e) { parts.push({ day: d, error: String(e.message || e) }); }
  }
  const ok = parts.filter((r) => r.csvVsRaw);
  if (!ok.length) return { days, parts, error: 'no day reconciled' };
  const pool = (path, field) => {
    const out = {};
    for (const [name] of COMPARE) {
      const vals = [];
      for (const r of ok) {
        const s2 = r[path]?.[field]?.[name];
        if (s2 && Number.isFinite(s2.median)) vals.push(s2);
      }
      // Pooling summaries rather than raw arrays: the worst median and the worst tail are
      // what the thresholds are about, and keeping every difference would mean holding
      // several days of per-second comparisons in memory for no extra information.
      out[name] = vals.length ? {
        n: vals.reduce((s2, v) => s2 + v.n, 0),
        median: Math.max(...vals.map((v) => v.median)),
        p99: Math.max(...vals.map((v) => v.p99 ?? NaN)),
        max: Math.max(...vals.map((v) => v.max ?? NaN)),
      } : { n: 0 };
    }
    return out;
  };
  const sum = (f) => ok.reduce((s2, r) => s2 + (f(r) || 0), 0);
  return {
    days, minutes, parts,
    windows: ok.map((r) => ({ day: r.day, from: r.from, to: r.to, compared: r.csvVsRaw.compared, rawSeconds: r.raw.seconds })),
    raw: { applied: sum((r) => r.raw.applied), gaps: sum((r) => r.raw.gaps), dropped: sum((r) => r.raw.dropped),
      crossed: sum((r) => r.raw.crossed), seconds: sum((r) => r.raw.seconds),
      tradeSides: { buy: sum((r) => r.raw.tradeSides.buy), sell: sum((r) => r.raw.tradeSides.sell) } },
    csvVsRaw: { compared: sum((r) => r.csvVsRaw.compared), missingInStore: sum((r) => r.csvVsRaw.missingInStore),
      relative: pool('csvVsRaw', 'relative'), absolute: pool('csvVsRaw', 'absolute') },
    batchedVsRaw: { compared: sum((r) => r.batchedVsRaw?.compared), relative: pool('batchedVsRaw', 'relative') },
    aggressorSide: {
      n: sum((r) => r.aggressorSide?.n),
      correlation: Math.min(...ok.map((r) => r.aggressorSide?.correlation ?? NaN)),
      correlationIfFlipped: Math.max(...ok.map((r) => r.aggressorSide?.correlationIfFlipped ?? NaN)),
      note: ok[0].aggressorSide?.note,
    },
  };
}

/** Pass/fail on the reconciliation, with thresholds fixed in the M2-H pre-registration. */
export function verdict(r) {
  const exchangeState = ['bid', 'ask', 'spreadBp', 'microprice', 'depthBidTop5', 'depthAskTop5', 'imbTop5', 'imbTop10'];
  const worst = (block, names) => Math.max(...names.map((n) => block?.relative?.[n]?.median ?? Infinity));
  const checks = {
    csvReproducesSequenceVerifiedBook: r.csvVsRaw ? worst(r.csvVsRaw, exchangeState) <= 1e-3 : false,
    hundredMsBatchingIsEquivalent: r.batchedVsRaw ? worst(r.batchedVsRaw, exchangeState) <= 1e-6 : false,
    aggressorSideCorrect: (r.aggressorSide?.correlation ?? -1) > 0.9,
    enoughOverlap: (r.csvVsRaw?.compared ?? 0) >= 300,
  };
  return { ...checks, pass: Object.values(checks).every(Boolean) };
}
