import { describe, test, eq, ok, near } from './harness.mjs';
import { walkBook, executionQuality, marketOrderCostBand, costProfiles } from '../features/execution.mjs';
import { bookFeatures, liquidityState, bookPressure, FlowWindows } from '../features/book-features.mjs';
import { pctToBp, bpToPct, FEES, COST_PROFILES } from '../collector/config.mjs';
import { OrderBook } from '../collector/book.mjs';

// A book whose arithmetic can be done by hand.
function synthetic({ bids, asks }) {
  const bk = new OrderBook();
  bk.bufferEvent({ U: 95, u: 105, pu: 94, b: [], a: [], E: 1, recvMs: 1 });
  bk.applySnapshot({ lastUpdateId: 100, E: 1, T: 1, bids, asks });
  return bk;
}
const BOOK = synthetic({
  bids: [['99.00', '10'], ['98.00', '10'], ['97.00', '10']],
  asks: [['101.00', '10'], ['102.00', '10'], ['103.00', '10']],
});

describe('cost units', () => {
  test('0.14% is 14 bp, not 140 bp', () => {
    eq(pctToBp(0.0014), 14);
    eq(bpToPct(14), 0.0014);
  });
  test('the conservative profile is 14 bp round trip', () => eq(COST_PROFILES.B.roundTripBp, 14));
  test('commission-only profile is twice the VIP 0 taker fee', () => {
    eq(FEES.takerBp, 5);
    eq(COST_PROFILES.A.roundTripBp, 10);
  });
  test('the maker profile exists and may never be used for acceptance', () => {
    eq(COST_PROFILES.M.usableForAcceptance, false);
    eq(COST_PROFILES.M.roundTripBp, 4);
  });
  test('every acceptance-usable profile is a taker profile', () => {
    for (const p of Object.values(COST_PROFILES)) if (p.usableForAcceptance) ok(!/maker/i.test(p.name), p.name);
  });
});

describe('walk the book', () => {
  test('an order inside the top level fills at the top level', () => {
    const r = walkBook(BOOK, 'BUY', 500);
    eq(r.ok, true); eq(r.complete, true); eq(r.levelsUsed, 1);
    near(r.vwap, 101, 1e-12);
    near(r.mid, 100, 1e-12);
    near(r.slippageBp, ((101 - 100) / 100) * 10000, 1e-9);   // 100 bp: mid 100, pay 101
  });

  test('a larger order walks into deeper levels with a known VWAP', () => {
    // 1010 fills level 1 ($1010 available), 1020 more fills level 2 ...
    const r = walkBook(BOOK, 'BUY', 1010 + 510);
    eq(r.complete, true); eq(r.levelsUsed, 2);
    // 10 units @101 = 1010, then 510/102 = 5 units @102
    const base = 10 + 510 / 102;
    near(r.vwap, (1010 + 510) / base, 1e-9);
    ok(r.vwap > 101 && r.vwap < 102, 'VWAP must sit between the two levels');
    eq(r.worstPrice, 102);
  });

  test('insufficient depth is reported, never extrapolated', () => {
    const r = walkBook(BOOK, 'BUY', 1e9);
    eq(r.ok, true); eq(r.complete, false);
    ok(r.unfilledUsd > 0);
    ok(Number.isNaN(r.allInBp), 'no all-in cost may be quoted for an order the book cannot fill');
    eq(executionQuality(r, 10).verdict, 'POOR');
  });

  test('buy and sell are symmetric while both stay inside the top level', () => {
    // $900 fits inside 10 units at 99 ($990) and inside 10 units at 101 ($1010).
    const b = walkBook(BOOK, 'BUY', 900), s = walkBook(BOOK, 'SELL', 900);
    near(b.slippageBp, s.slippageBp, 1e-9);
    near(b.allInBp, s.allInBp, 1e-9);
    eq(b.levelsUsed, 1); eq(s.levelsUsed, 1);
  });

  test('slippage decomposes into half-spread plus book impact', () => {
    const r = walkBook(BOOK, 'BUY', 1510);
    near(r.halfSpreadBp + r.impactBp, r.slippageBp, 1e-9);
  });

  test('fee arithmetic: all-in is slippage plus one taker fee, round trip is twice that', () => {
    const r = walkBook(BOOK, 'BUY', 500);
    near(r.allInBp, r.slippageBp + FEES.takerBp, 1e-12);
    near(r.roundTripEstimateBp, 2 * (r.slippageBp + FEES.takerBp), 1e-12);
    near(r.allInUsd, (r.allInBp / 10000) * 500, 1e-12);
  });

  test('an invalid book produces no estimate at all', () => {
    const bk = new OrderBook();
    eq(walkBook(bk, 'BUY', 100).ok, false);
  });

  test('a non-positive order size is refused', () => {
    eq(walkBook(BOOK, 'BUY', 0).ok, false);
    eq(walkBook(BOOK, 'BUY', -5).ok, false);
  });
});

describe('execution quality', () => {
  test('without a configured limit the planner refuses to grade', () => {
    const q = executionQuality(walkBook(BOOK, 'BUY', 500), null);
    eq(q.verdict, 'NOT GRADED');
  });
  test('with a limit it is a plain comparison', () => {
    const r = walkBook(BOOK, 'BUY', 500);
    eq(executionQuality(r, r.allInBp + 1).verdict, 'GOOD');
    eq(executionQuality(r, r.allInBp - 1).verdict, 'POOR');
  });
  test('the cost band is descriptive and never directional', () => {
    ok(['LOW', 'NORMAL', 'HIGH', 'UNKNOWN'].includes(marketOrderCostBand(walkBook(BOOK, 'BUY', 500))));
  });
  test('profile A adds the measured book cost, B and C are used as stated', () => {
    const r = walkBook(BOOK, 'BUY', 500), p = costProfiles(r);
    near(p.A.allInRoundTripBp, COST_PROFILES.A.roundTripBp + 2 * r.slippageBp, 1e-9);
    eq(p.B.allInRoundTripBp, 14);
    eq(p.C.allInRoundTripBp, 20);
  });
});

describe('book features', () => {
  const flow = new FlowWindows();
  flow.add(Date.now(), 1000, true);
  flow.add(Date.now(), 3000, false);
  const fx = bookFeatures(BOOK, flow, Date.now());

  test('mid, spread and microprice are computed from the top of book', () => {
    near(fx.mid, 100, 1e-12);
    near(fx.spreadBp, 200, 1e-9);
    near(fx.microprice, 100, 1e-12, 'equal size on both sides puts the microprice at the mid');
  });
  test('the microprice leans toward the thinner side', () => {
    const b = synthetic({ bids: [['99.00', '1']], asks: [['101.00', '100']] });
    const f2 = bookFeatures(b, null, Date.now());
    ok(f2.microprice < 100, 'a heavy ask should pull the microprice down');
  });
  test('imbalance is measured in notional, not units, and is bounded in [-1, 1]', () => {
    // 10 units at 99 is $990 against 10 units at 101 = $1010, so top-1 imbalance is
    // -0.01 rather than 0. Notional is the quantity that matters for execution.
    near(fx.imbalance.top1, (990 - 1010) / 2000, 1e-12);
    for (const v of Object.values(fx.imbalance)) ok(v >= -1 && v <= 1, `imbalance out of range: ${v}`);
  });
  test('AFI matches the signed flow definition', () => near(fx.flow['5000ms'].afi, (1000 - 3000) / 4000, 1e-12));
  test('an invalid book yields no feature record', () => eq(bookFeatures(new OrderBook(), flow, Date.now()), null));
  test('book pressure is labelled as context, not direction', () => {
    const p = bookPressure(fx);
    ok(/NOT A DIRECTIONAL SIGNAL/.test(p.note));
    ok(!/LONG|SHORT|BUY NOW|SELL NOW/.test(p.label));
  });
  test('liquidity state is mechanical and explains itself', () => {
    const l = liquidityState(fx);
    ok(['DEEP', 'NORMAL', 'THIN', 'VERY THIN'].includes(l.state));
    ok(l.reasons.length >= 2);
  });
});
