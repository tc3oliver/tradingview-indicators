// Streaming historical replay: vendor archive → canonical events → the same OrderBook
// and the same feature engine the live collector uses → one feature record per second →
// columnar store.
//
// A day of BTCUSDT L2 is 400 MB compressed and 62 million level rows, so the hot loop is
// written to survive that: manual chunk splitting rather than readline, field slicing
// rather than String.split, no async generator chaining, and trades pre-loaded into typed
// arrays (under a million a day) so the depth stream is the only thing being iterated.
//
// What is NOT optimised away is the feature computation itself: it is the same
// features/book-features.mjs and features/execution.mjs the live planner calls, on the
// same OrderBook class, and there is no historical-only implementation of any measure.
import { createReadStream, statSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { streamDataset, fetchDataset, discardDataset, RELIABLE_SINCE } from './tardis.mjs';
import { OrderBook } from '../collector/book.mjs';
import { FlowWindows, bookFeatures } from '../features/book-features.mjs';
import { walkBook } from '../features/execution.mjs';
import { EXEC_SIZES } from '../collector/collector.mjs';
import { flatten, writeDay, readDay } from './store.mjs';

const SEC = 1000;
export const PRUNE_BAND_PCT = 0.02;      // phantom levels beyond ±2% of mid are dropped
const PRUNE_EVERY_SEC = 60;

/** Trades for a day, as typed arrays. ~900k rows, so this is small and worth doing once. */
export async function loadTrades(iso) {
  const ts = [], quote = [], buy = [];
  for await (const line of streamDataset('trades', iso)) {
    // exchange,symbol,timestamp,local_timestamp,id,side,price,amount
    let k = line.indexOf(',') + 1; k = line.indexOf(',', k) + 1;
    let e = line.indexOf(',', k); const t = +line.slice(k, e) / 1000; k = e + 1;
    e = line.indexOf(',', k); k = e + 1;                                  // local_timestamp
    e = line.indexOf(',', k); k = e + 1;                                  // id
    e = line.indexOf(',', k); const isBuy = line.charCodeAt(k) === 98; k = e + 1;  // 'b' of "buy"
    e = line.indexOf(',', k); const price = +line.slice(k, e); k = e + 1;
    const qty = +line.slice(k);
    ts.push(t); quote.push(price * qty); buy.push(isBuy ? 1 : 0);
  }
  return { ts: Float64Array.from(ts), quote: Float64Array.from(quote), buy: Uint8Array.from(buy), n: ts.length };
}

/**
 * Replay one UTC day.
 * @returns audit record; writes the feature store as a side effect
 */
export async function replayDay(iso, { onProgress, write = true, keepScratch = false } = {}) {
  const t0 = Date.now();
  const trades = await loadTrades(iso);
  const file = await fetchDataset('incremental_book_L2', iso);

  const book = new OrderBook();
  const flow = new FlowWindows();
  const rows = [];
  const audit = {
    day: iso, reliable: iso >= RELIABLE_SINCE,
    depthEvents: 0, levelRows: 0, tradeEvents: trades.n, snapshots: 0,
    crossedBooks: 0, invalidations: 0, timestampRegressions: 0, droppedBeforeSnapshot: 0,
    duplicateLevelRows: 0, prunedLevels: 0,
    firstTs: null, lastTs: null,
    validSeconds: 0, expectedSeconds: 86400, missingSeconds: 0, longestGapSec: 0,
    emptyBookSeconds: 0, maxBookLevels: 0,
  };

  let ti = 0;                                        // cursor into the trade arrays
  let curTs = -1, curSnap = false, b = [], a = [];
  let nextSec = null, lastSampledSec = null, lastPruneSec = null;

  const applyPending = () => {
    if (curTs < 0) return;
    const r = book.applyVendor({ ts: curTs, localTs: curTs, isSnapshot: curSnap, b, a });
    if (r.skipped) audit.droppedBeforeSnapshot++;
    if (r.snapshot) audit.snapshots++;
    audit.depthEvents++;
    audit.levelRows += b.length + a.length;
    b = []; a = [];
  };

  const sample = (sec) => {
    if (!book.valid) return;
    if (!book.checkCrossed()) { audit.crossedBooks++; audit.invalidations++; book._vendorSnapshotOpen = false; lastSampledSec = null; return; }
    if (lastPruneSec === null || sec - lastPruneSec >= PRUNE_EVERY_SEC) {
      audit.prunedLevels += book.pruneFarLevels(PRUNE_BAND_PCT);
      lastPruneSec = sec;
    }
    const at = sec * SEC;
    const fx = bookFeatures(book, flow, at);
    if (!fx) { audit.emptyBookSeconds++; return; }
    fx.exec = {};
    for (const side of ['BUY', 'SELL']) {
      fx.exec[side] = {};
      for (const n of EXEC_SIZES) {
        const e = walkBook(book, side, n);
        fx.exec[side][n] = e.ok ? { vwap: e.vwap, slippageBp: e.slippageBp, allInBp: e.allInBp, complete: e.complete, levels: e.levelsUsed } : { complete: false };
      }
    }
    rows.push(flatten(fx));
    audit.validSeconds++;
    audit.maxBookLevels = Math.max(audit.maxBookLevels, book.bids.size + book.asks.size);
    if (lastSampledSec !== null) {
      const gap = sec - lastSampledSec - 1;
      if (gap > 0) { audit.missingSeconds += gap; audit.longestGapSec = Math.max(audit.longestGapSec, gap); }
    }
    lastSampledSec = sec;
  };

  // Feed every trade with an exchange timestamp at or before `upto` into the flow windows.
  const drainTrades = (upto) => {
    while (ti < trades.n && trades.ts[ti] <= upto) { flow.add(trades.ts[ti], trades.quote[ti], trades.buy[ti] === 1); ti++; }
  };

  audit.archiveBytes = statSync(file).size;
  const stream = createReadStream(file).pipe(createGunzip());
  let tail = '';
  for await (const chunk of stream) {
    const s = tail + chunk.toString('latin1');
    let i = 0, j;
    while ((j = s.indexOf('\n', i)) >= 0) {
      const line = s.slice(i, j); i = j + 1;
      if (line.length < 20 || line.charCodeAt(0) === 101) continue;      // header ('e')
      // exchange,symbol,timestamp,local_timestamp,is_snapshot,side,price,amount
      let k = line.indexOf(',') + 1; k = line.indexOf(',', k) + 1;
      let e = line.indexOf(',', k); const ts = +line.slice(k, e) / 1000; k = e + 1;
      e = line.indexOf(',', k); k = e + 1;                               // local_timestamp
      e = line.indexOf(',', k); const snap = line.charCodeAt(k) === 116; k = e + 1;
      e = line.indexOf(',', k); const isBid = line.charCodeAt(k) === 98; k = e + 1;
      e = line.indexOf(',', k); const price = +line.slice(k, e); k = e + 1;
      const amount = +line.slice(k);

      if (ts !== curTs || snap !== curSnap) {
        applyPending();
        const sec = Math.floor(ts / SEC);
        if (nextSec === null) nextSec = sec;
        while (sec > nextSec) {
          drainTrades((nextSec + 1) * SEC - 1);
          sample(nextSec);
          nextSec++;
          if (onProgress && nextSec % 7200 === 0) onProgress(audit, nextSec);
        }
        curTs = ts; curSnap = snap;
        if (audit.firstTs === null) audit.firstTs = ts;
        audit.lastTs = ts;
      }
      (isBid ? b : a).push([price, amount]);
    }
    tail = s.slice(i);
  }
  applyPending();
  if (nextSec !== null) { drainTrades((nextSec + 1) * SEC - 1); sample(nextSec); }

  audit.timestampRegressions = book.stats.timestampRegressions || 0;
  audit.validCoveragePct = (audit.validSeconds / audit.expectedSeconds) * 100;
  audit.seconds = (Date.now() - t0) / 1000;
  if (write && rows.length) {
    audit.store = writeDay(iso, rows, {
      depthEvents: audit.depthEvents, tradeEvents: audit.tradeEvents, snapshots: audit.snapshots,
      validCoveragePct: audit.validCoveragePct, crossedBooks: audit.crossedBooks,
      invalidations: audit.invalidations, maxBookLevels: audit.maxBookLevels, archiveBytes: audit.archiveBytes,
      pruneBandPct: PRUNE_BAND_PCT, source: 'tardis:incremental_book_L2+trades',
    });
  }
  if (!keepScratch) { discardDataset('incremental_book_L2', iso); discardDataset('trades', iso); }
  return audit;
}

/** Replay a list of days, skipping any already in the store unless forced. */
export async function replayDays(days, { force = false, onDay, keepScratch = false } = {}) {
  const out = [];
  for (const iso of days) {
    if (!force && readDay(iso)) { out.push({ day: iso, cached: true }); onDay?.({ day: iso, cached: true }); continue; }
    try {
      const a = await replayDay(iso, { keepScratch });
      out.push(a); onDay?.(a);
    } catch (e) {
      const a = { day: iso, error: String(e.message || e), status: e.status ?? null };
      out.push(a); onDay?.(a);
    }
  }
  return out;
}
