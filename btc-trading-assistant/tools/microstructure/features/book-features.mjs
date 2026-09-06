// Order-book and flow measurements (PART A1).
//
// Every definition here is fixed. Depth bands, top-N levels and flow windows are a
// short pre-declared list, not a search space: they exist to describe the book, and
// nothing downstream is allowed to pick whichever one looks best.
import { BOOK } from '../collector/config.mjs';

/** Signed flow accumulator over the pre-declared windows. */
export class FlowWindows {
  constructor(windowsMs = BOOK.flowWindowsMs) {
    this.windows = [...windowsMs].sort((a, b) => a - b);
    this.max = this.windows.at(-1);
    this.trades = [];               // { t, quote, buy }
  }

  add(t, quote, aggressiveBuy) {
    this.trades.push({ t, quote, buy: aggressiveBuy });
    this.prune(t);
  }

  prune(now) {
    const cut = now - this.max;
    let i = 0;
    while (i < this.trades.length && this.trades[i].t < cut) i++;
    if (i) this.trades.splice(0, i);
  }

  measure(now) {
    const out = {};
    for (const w of this.windows) {
      const cut = now - w;
      let buy = 0, sell = 0, n = 0;
      for (let i = this.trades.length - 1; i >= 0; i--) {
        const tr = this.trades[i];
        if (tr.t < cut) break;
        n++;
        if (tr.buy) buy += tr.quote; else sell += tr.quote;
      }
      const tot = buy + sell;
      out[`${w}ms`] = { buyQuote: buy, sellQuote: sell, signedQuote: buy - sell, trades: n, afi: tot > 0 ? (buy - sell) / tot : 0 };
    }
    return out;
  }
}

const sumBand = (levels, refPrice, bandBp, sign) => {
  // sign = -1 for bids (prices below mid), +1 for asks
  const limit = refPrice * (1 + (sign * bandBp) / 10000);
  let notional = 0, count = 0;
  for (const [p, q] of levels) {
    if (sign < 0 ? p < limit : p > limit) break;
    notional += p * q; count++;
  }
  return { notional, count };
};

const sumTop = (levels, n) => {
  let notional = 0;
  for (let i = 0; i < Math.min(n, levels.length); i++) notional += levels[i][0] * levels[i][1];
  return notional;
};

/**
 * Snapshot of every A1 measurement from a valid book.
 * Returns null if the book is invalid or one-sided — an invalid book produces no
 * feature record, ever.
 */
export function bookFeatures(book, flow, now = Date.now()) {
  if (!book.valid) return null;
  const bids = book.sortedBids(), asks = book.sortedAsks();
  if (!bids.length || !asks.length) return null;
  const bid = bids[0][0], ask = asks[0][0], bq = bids[0][1], aq = asks[0][1];
  const mid = (bid + ask) / 2;
  const spread = ask - bid;
  const spreadBp = (spread / mid) * 10000;
  // Stoikov-style level-1 microprice: the mid shifted toward the heavier side.
  const microprice = (bid * aq + ask * bq) / (bq + aq);

  const depth = { bid: {}, ask: {} };
  for (const n of BOOK.topLevels) { depth.bid[`top${n}`] = sumTop(bids, n); depth.ask[`top${n}`] = sumTop(asks, n); }
  for (const bp of BOOK.depthBands) {
    depth.bid[`within${bp}bp`] = sumBand(bids, mid, bp, -1).notional;
    depth.ask[`within${bp}bp`] = sumBand(asks, mid, bp, +1).notional;
  }

  const imb = (b, a) => (b + a > 0 ? (b - a) / (b + a) : 0);
  const imbalance = {
    top1: imb(depth.bid.top1, depth.ask.top1),
    top5: imb(depth.bid.top5, depth.ask.top5),
    top10: imb(depth.bid.top10, depth.ask.top10),
    // distance-weighted: each level weighted by 1/(1 + bp distance from mid)
    weighted: (() => {
      const w = (levels, sign) => levels.reduce((s, [p, q]) => {
        const d = Math.abs(p - mid) / mid * 10000;
        return d > 50 ? s : s + (p * q) / (1 + d);
      }, 0);
      return imb(w(bids, -1), w(asks, +1));
    })(),
  };

  // Depth slope: notional added per bp of distance, out to the widest declared band.
  const wide = BOOK.depthBands.at(-1);
  const slope = { bid: depth.bid[`within${wide}bp`] / wide, ask: depth.ask[`within${wide}bp`] / wide };

  const f = flow ? flow.measure(now) : null;
  const nearBid = depth.bid.within2bp || depth.bid.top5;
  const nearAsk = depth.ask.within2bp || depth.ask.top5;

  // Pre-declared interactions. Four, chosen from the literature, not searched.
  const w5 = f?.['5000ms'];
  const interaction = w5 ? {
    // aggressive buying relative to the ask-side capacity it must consume, and mirror
    pressureToCapacity: nearAsk > 0 || nearBid > 0
      ? (w5.buyQuote / Math.max(1, nearAsk)) - (w5.sellQuote / Math.max(1, nearBid)) : 0,
    flowOverOppositeNearDepth: w5.signedQuote >= 0
      ? w5.signedQuote / Math.max(1, nearAsk) : w5.signedQuote / Math.max(1, nearBid),
    flowTimesImbalance: w5.afi * imbalance.top5,
    flowTimesFragility: w5.afi * (spreadBp / Math.max(1e-9, (nearBid + nearAsk) / 1e6)),
  } : null;

  return {
    at: now, lastUpdateId: book.lastUpdateId, eventMs: book.lastEventMs, recvMs: book.lastRecvMs,
    bid, ask, bidQty: bq, askQty: aq, mid, spread, spreadBp, microprice,
    micropriceDisplacementBp: ((microprice - mid) / mid) * 10000,
    depth, imbalance, slope, flow: f, interaction,
    bidLevels: bids.length, askLevels: asks.length,
  };
}

/**
 * Liquidity state, mechanical and human-readable. Thresholds are relative to the
 * book's own tick and notional scale, not fitted to any return series.
 */
export function liquidityState(fx) {
  if (!fx) return { state: 'UNKNOWN', reasons: ['no valid book'] };
  const near = fx.depth.bid.within5bp + fx.depth.ask.within5bp;
  const reasons = [];
  let state = 'NORMAL';
  if (fx.spreadBp > 3 || near < 250_000) { state = 'THIN'; }
  if (fx.spreadBp > 8 || near < 75_000) { state = 'VERY THIN'; }
  if (fx.spreadBp <= 1.0 && near > 2_000_000) state = 'DEEP';
  reasons.push(`spread ${fx.spreadBp.toFixed(2)} bp`);
  reasons.push(`$${Math.round(near).toLocaleString()} within 5 bp of mid`);
  return { state, reasons, nearNotional: near };
}

/** Book pressure as CONTEXT. Deliberately not a direction. */
export function bookPressure(fx) {
  if (!fx) return { label: 'UNKNOWN', value: 0 };
  const v = fx.imbalance.top5;
  const label = v > 0.15 ? 'MORE RESTING BIDS' : v < -0.15 ? 'MORE RESTING ASKS' : 'BALANCED';
  return { label, value: v, note: 'CONTEXT — NOT A DIRECTIONAL SIGNAL' };
}
