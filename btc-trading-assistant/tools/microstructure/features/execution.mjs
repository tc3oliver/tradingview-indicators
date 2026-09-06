// Instantaneous market-order cost, computed by walking the current valid book.
//
// This is not a forecast. It is arithmetic on the book in front of you: how much of it
// a given order eats, at what average price, and what that costs against the mid you
// decided at. If the book cannot fill the order, that is reported rather than
// extrapolated.
import { FEES, COST_PROFILES } from '../collector/config.mjs';

/**
 * @param book   OrderBook (must be valid)
 * @param side   'BUY' | 'SELL'
 * @param notionalUsd  order size in quote currency
 * @param feeBpPerSide taker commission per side, defaults to the configured VIP 0 rate
 */
export function walkBook(book, side, notionalUsd, feeBpPerSide = FEES.takerBp) {
  if (!book?.valid) return { ok: false, reason: 'book invalid' };
  const levels = side === 'BUY' ? book.sortedAsks() : book.sortedBids();
  const bid = book.bestBid(), ask = book.bestAsk();
  if (!levels.length || !bid || !ask) return { ok: false, reason: 'book empty' };
  if (!(notionalUsd > 0)) return { ok: false, reason: 'notional must be positive' };

  const mid = (bid[0] + ask[0]) / 2;
  const best = side === 'BUY' ? ask[0] : bid[0];

  let remaining = notionalUsd, spent = 0, base = 0, worst = best, consumed = 0, levelsUsed = 0;
  let sideNotional = 0;
  for (const [p, q] of levels) sideNotional += p * q;

  for (const [p, q] of levels) {
    if (remaining <= 1e-9) break;
    const avail = p * q;
    const take = Math.min(avail, remaining);
    spent += take; base += take / p; remaining -= take;
    worst = p; levelsUsed++; consumed += take;
  }
  const filled = notionalUsd - remaining;
  const complete = remaining <= 1e-6;
  const vwap = base > 0 ? spent / base : NaN;

  // Slippage is measured against the decision-time mid, so it contains the half-spread.
  // That is the honest number for someone deciding now: crossing the spread is a cost.
  const slippageBp = complete ? ((side === 'BUY' ? vwap - mid : mid - vwap) / mid) * 10000 : NaN;
  const halfSpreadBp = ((ask[0] - bid[0]) / 2 / mid) * 10000;
  const impactBp = complete ? slippageBp - halfSpreadBp : NaN;
  const feeBp = feeBpPerSide;

  return {
    ok: true, complete, side, notionalUsd,
    mid, best, vwap, worstPrice: worst,
    filledUsd: filled, unfilledUsd: remaining,
    levelsUsed, consumedPctOfSide: sideNotional > 0 ? (consumed / sideNotional) * 100 : 0,
    sideNotional,
    halfSpreadBp, slippageBp, impactBp, feeBp,
    allInBp: complete ? slippageBp + feeBp : NaN,
    allInUsd: complete ? ((slippageBp + feeBp) / 10000) * notionalUsd : NaN,
    // A full round trip: in now and out later, both as taker, at today's book.
    roundTripEstimateBp: complete ? 2 * (slippageBp + feeBp) : NaN,
  };
}

/** The same estimate under each declared cost profile, for the record. */
export function costProfiles(estimate) {
  if (!estimate?.ok || !estimate.complete) return null;
  const out = {};
  for (const p of Object.values(COST_PROFILES)) {
    out[p.id] = { name: p.name, roundTripBp: p.roundTripBp, usableForAcceptance: p.usableForAcceptance,
      note: p.note,
      // Profile A is commission-only and is completed by the measured book cost;
      // B and C are all-in allowances and are used as stated.
      allInRoundTripBp: p.id === 'A' ? p.roundTripBp + 2 * estimate.slippageBp : p.roundTripBp };
  }
  return out;
}

/**
 * EXECUTION QUALITY (PART A4). Mechanical, and it refuses to grade when the user has
 * not said what "good" means to them. No composite score, nothing fitted to returns.
 */
export function executionQuality(estimate, maxAllInCostBp) {
  if (!estimate?.ok) return { verdict: 'UNKNOWN', reason: estimate?.reason || 'no estimate' };
  if (!estimate.complete) {
    return { verdict: 'POOR', reason: `the visible book cannot fill this order — $${Math.round(estimate.unfilledUsd).toLocaleString()} of $${Math.round(estimate.notionalUsd).toLocaleString()} has no resting liquidity` };
  }
  if (maxAllInCostBp == null) {
    return { verdict: 'NOT GRADED', reason: 'no maximum acceptable cost is configured, so the numbers are shown without a verdict (set M2_MAX_COST_BP to enable one)' };
  }
  const within = estimate.allInBp <= maxAllInCostBp;
  return { verdict: within ? 'GOOD' : 'POOR', limitBp: maxAllInCostBp,
    reason: `all-in immediate cost ${estimate.allInBp.toFixed(2)} bp ${within ? '≤' : '>'} your limit of ${maxAllInCostBp} bp` };
}

/** Cost band for the default order size. Descriptive, never directional. */
export function marketOrderCostBand(estimate) {
  if (!estimate?.ok || !estimate.complete) return 'UNKNOWN';
  const b = estimate.allInBp;
  return b <= 6 ? 'LOW' : b <= 12 ? 'NORMAL' : 'HIGH';
}
