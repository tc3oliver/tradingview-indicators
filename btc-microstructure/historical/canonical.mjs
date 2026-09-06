// The canonical event schema. Historical vendor data and the live collector both
// translate into these two shapes, and from here on there is exactly one code path:
// the same OrderBook, the same FlowWindows, the same features/book-features.mjs and
// features/execution.mjs. There is no second, historical-only implementation of any
// feature, because a backtest computed by different code from the live tool is a
// backtest of a different tool.
//
//   CanonicalDepthEvent { kind:'depth', ts, localTs, b, a, isSnapshot, seq|null }
//   CanonicalTradeEvent { kind:'trade', ts, localTs, id, price, qty, aggressiveBuy }
//
// `ts`      exchange timestamp, ms
// `localTs` capture-side receive timestamp, ms (Tardis's machine, or ours when live)
// `seq`     { U, u, pu } when the source carries Binance sequence ids, else null.
//           Present on live and on the Tardis replay API; absent on the Tardis CSV.

export const DEPTH = 'depth';
export const TRADE = 'trade';

/** Live/replay: an original Binance depthUpdate payload. */
export function fromBinanceDepth(payload, localTs) {
  return { kind: DEPTH, ts: payload.E, localTs, b: payload.b || [], a: payload.a || [],
    isSnapshot: false, seq: { U: payload.U, u: payload.u, pu: payload.pu } };
}

/** Live/replay: an original Binance aggTrade payload. */
export function fromBinanceTrade(payload, localTs) {
  return { kind: TRADE, ts: payload.T ?? payload.E, localTs, id: payload.a,
    price: +payload.p, qty: +payload.q, aggressiveBuy: payload.m === false };
}

// --- Tardis normalised CSV -------------------------------------------------
// incremental_book_L2: exchange,symbol,timestamp,local_timestamp,is_snapshot,side,price,amount
// Timestamps are microseconds. `amount` is the ABSOLUTE size at that price; 0 removes it.
// Rows sharing a (timestamp, local_timestamp, is_snapshot) belong to one update, so they
// are coalesced back into one event — applying them individually would produce book
// states that never existed on the exchange.
export function parseDepthRow(line) {
  // split by hand: 62 million rows a day makes String.split measurable
  let i = line.indexOf(',') + 1;                 // exchange
  i = line.indexOf(',', i) + 1;                  // symbol
  let j = line.indexOf(',', i); const ts = +line.slice(i, j); i = j + 1;
  j = line.indexOf(',', i); const localTs = +line.slice(i, j); i = j + 1;
  j = line.indexOf(',', i); const snap = line.charCodeAt(i) === 116; i = j + 1;   // 't' of "true"
  j = line.indexOf(',', i); const bid = line.charCodeAt(i) === 98; i = j + 1;     // 'b' of "bid"
  j = line.indexOf(',', i); const price = line.slice(i, j); i = j + 1;
  const amount = line.slice(i);
  return { ts: ts / 1000, localTs: localTs / 1000, isSnapshot: snap, bid, price, amount };
}

// trades: exchange,symbol,timestamp,local_timestamp,id,side,price,amount
// `side` is the LIQUIDITY TAKER side, so side === 'buy' is an aggressive buy. Verified
// against the raw Binance `m` flag in historical/reconcile.mjs rather than assumed.
export function parseTradeRow(line) {
  let i = line.indexOf(',') + 1;
  i = line.indexOf(',', i) + 1;
  let j = line.indexOf(',', i); const ts = +line.slice(i, j); i = j + 1;
  j = line.indexOf(',', i); const localTs = +line.slice(i, j); i = j + 1;
  j = line.indexOf(',', i); const id = +line.slice(i, j); i = j + 1;
  j = line.indexOf(',', i); const buy = line.charCodeAt(i) === 98; i = j + 1;     // 'b' of "buy"
  j = line.indexOf(',', i); const price = +line.slice(i, j); i = j + 1;
  const qty = +line.slice(i);
  return { kind: TRADE, ts: ts / 1000, localTs: localTs / 1000, id, price, qty, aggressiveBuy: buy };
}

/**
 * Coalesce consecutive CSV level rows into canonical depth events.
 * Yields one event per (timestamp, is_snapshot) run.
 */
export async function* canonicalDepth(lines) {
  let cur = null;
  for await (const line of lines) {
    const r = parseDepthRow(line);
    if (!cur || cur.ts !== r.ts || cur.isSnapshot !== r.isSnapshot || cur.localTs !== r.localTs) {
      if (cur) yield cur;
      cur = { kind: DEPTH, ts: r.ts, localTs: r.localTs, isSnapshot: r.isSnapshot, b: [], a: [], seq: null };
    }
    (r.bid ? cur.b : cur.a).push([r.price, r.amount]);
  }
  if (cur) yield cur;
}

export async function* canonicalTrades(lines) {
  for await (const line of lines) yield parseTradeRow(line);
}

/**
 * Merge two time-ordered canonical streams into one, ordered by exchange timestamp.
 * Depth wins ties, so flow measured at a second boundary sees the book that flow acted
 * against rather than the one it produced.
 */
export async function* merge(depthIter, tradeIter) {
  let d = await depthIter.next(), t = await tradeIter.next();
  while (!d.done || !t.done) {
    if (t.done || (!d.done && d.value.ts <= t.value.ts)) { yield d.value; d = await depthIter.next(); }
    else { yield t.value; t = await tradeIter.next(); }
  }
}
