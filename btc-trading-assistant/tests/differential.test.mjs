// MIGRATION DIFFERENTIAL — the acceptance test for this consolidation.
//
// BTC Trading Assistant replaces two published indicators. The claim tested here
// is not "the new one looks right", it is "the new one computes the SAME NUMBERS
// as the two it replaces, bar by bar, on the same data". Both originals are kept
// under tests/baseline/ purely so this can be re-run after their directories are
// gone.
//
// ONE HONEST COMPLICATION, MEASURED RATHER THAN ASSUMED.
// The offline runtime rounds every user-function return value and every
// array.get() to ten decimal places (check 1 below measures this rather than
// asserting it). The baseline computed its 4H windows inline on chart bars and
// never crossed that boundary; this build computes them inside a
// request.security context or through a 4H buffer, because that is what makes a
// 15m chart show real 4H readings, and both routes cross it.
//
// So the comparison is split:
//   EXACT     everything that does not cross that boundary, plus every discrete
//             output — ladder levels, direction codes, feed status codes,
//             anomaly count, the whole event log. These decide what a user
//             actually sees and they must be bit-identical.
//   BOUNDED   the continuous values that do cross it. Their differences must be
//             consistent with ten-decimal input rounding and must not move any
//             discrete output, which the EXACT group independently proves.
// On TradingView arrays and function returns are exact float64, so this residue
// is expected to be zero there. TRADINGVIEW-VALIDATION.md carries it as a manual
// check rather than letting the offline result stand in for one.
//
// Deliberately not compared: SOPR and the estimated lower-timeframe flow proxy
// are ABSENT from this build by decision, not by accident, and are recorded as
// removals in research/MIGRATION.md.

// v1.1 NOTE — WHAT "IDENTICAL" MEANS ONCE COSTS EXIST.
// The planner differential runs with "Include costs in position sizing" OFF,
// where riskPerUnit collapses to the gross stop distance and the arithmetic is
// v1.0's exactly. That is the honest comparison: cost-aware sizing is NEW
// behaviour and cannot be checked against a baseline that never had it, so it is
// verified against independently computed ground truth in main.test.mjs instead.
// Turning costs on and then declaring the result identical would be comparing
// two different questions and calling the answer a pass.

import {
  rows, run, ser, eq, check, note, section, fin,
  BASE, BASELINE, BASELINE_PLANNER, rewrite, enable, extMaster, wire, asMode, setConst, decode, unpack, bser,
} from './harness.mjs';

// ---------------------------------------------------------------- helpers ---
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Tolerant of a no-op: setting Direction to "Long" when "Long" is already the
// default must not be reported as a stale-harness failure.
const sub = (src, re, to) => src.replace(re, to);
const setNum = (src, label, v) =>
  sub(src, new RegExp(`input\\.(float|int|price)\\([^,]+,\\s*"${esc(label)}"`), (m, t) => `input.${t}(${v}, "${label}"`);
const setStr = (src, label, v) =>
  sub(src, new RegExp(`input\\.string\\("[^"]*",\\s*"${esc(label)}"`), `input.string("${v}", "${label}"`);
const setBool = (src, label, v) =>
  sub(src, new RegExp(`input\\.bool\\((?:true|false),\\s*"${esc(label)}"`), `input.bool(${v}, "${label}"`);

// The four adapters cannot be wired from Node — there is no second indicator to
// point at — so they are replaced with deterministic expressions at exactly the
// point where the user's plot would arrive. Identical text in both builds, so
// both see identical numbers.
const LIQL = 'extLiqL    = math.abs(close - close[1]) * volume';
const LIQS = 'extLiqS    = math.abs(high - low) * volume * 0.7';
const FUND = 'extFunding = (close - ta.sma(close, 20)) / ta.sma(close, 20) * 0.05';
const ETF  = 'extEtf     = (close - close[1]) * 100.0';
const withAdapters = (src) => {
  // extMaster is v1.1's master switch and is absent from the baselines, which
  // had no such thing; it is a no-op there by design.
  let x = extMaster(setBool(src, '  Long and short liquidations share one source and unit', true));
  for (const l of ['long-liquidation', 'short-liquidation', 'funding', 'ETF flow']) x = enable(x, l);
  x = wire(x, 'Long liquidations', LIQL);
  x = wire(x, 'Short liquidations', LIQS);
  x = wire(x, 'Aggregated funding rate', FUND);
  x = wire(x, 'US spot BTC ETF net flow', ETF);
  return x;
};

// At its shipped 2190 the volatility percentile is na over any window this suite
// can afford, so comparing it would be vacuous — na === na proves nothing about
// the arithmetic. Both builds get the same reduced window, which exercises the
// real ta.percentrank path in the reference context. v1.1 froze the window into
// a constant; the baseline still carries it as an input, so each is substituted
// in its own idiom and the two end up at the same 400.
const shortVolWin = (src) =>
  /^VOL_PCT_WIN/m.test(src) ? setConst(src, 'VOL_PCT_WIN', 400) : setNum(src, 'Volatility percentile lookback', 400);

// Values that never cross the offline runtime's rounding boundary in EITHER
// build: computed inline on chart bars from request.security scalars, or
// discrete by nature.
const EXACT = [
  't_refClose', 't_mom12w', 't_premium', 't_fundRaw', 't_liqBal',
  't_trSt', 't_oi24St', 't_anomCount', 't_evCount', 't_evPush', 't_evDup',
];
// Values that do cross it: computed inside a request.security context through a
// user function, or read back out of a 4H buffer, or derived from one of those.
const BOUNDED = [
  't_atr14', 't_rvol30', 't_volPct', 't_trendDist', 't_px24',
  't_oiChg4', 't_oiChg24', 't_oiZ4', 't_oiZ24', 't_oiZ24s', 't_oiP4', 't_oiP24', 't_oiN24',
  't_premZ', 't_premP', 't_partRaw', 't_partZ', 't_partP',
  't_rvolSpot', 't_rvolSpotZ', 't_rvolSpotP', 't_rvolPerp', 't_rvolPerpZ', 't_rvolPerpP',
  't_fundZ', 't_fundP', 't_etf5d', 't_etfZ', 't_etfP',
  't_liqLZ', 't_liqLP', 't_liqSZ', 't_liqSP', 't_liqBZ',
];

export async function differential() {
  section('§26 MARKET CONTEXT DIFFERENTIAL — new vs BTC 4H Market Radar v3.3');

  // ---- 1. measure the runtime's precision boundary, do not assume it --------
  const probe = `//@version=6
indicator("p", overlay=true)
f(x) => x
var array<float> a = array.new_float(0)
v = close / 3.0 + 0.000000000123456789
array.push(a, v)
plot(v, "t_raw", display=display.none)
plot(f(v), "t_fn", display=display.none)
plot(array.get(a, array.size(a) - 1), "t_arr", display=display.none)
`;
  const pc = await run(rows.slice(-30), { source: probe });
  const raw = ser(pc, 't_raw', 30).at(-1);
  const viaFn = ser(pc, 't_fn', 30).at(-1);
  const viaArr = ser(pc, 't_arr', 30).at(-1);
  const dp = (x) => { const s = String(x); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
  const rounds = viaFn !== raw || viaArr !== raw;
  check(rounds, `offline runtime rounds function returns and array reads (raw ${dp(raw)}dp -> fn ${dp(viaFn)}dp, array ${dp(viaArr)}dp)`);
  note('this is why the comparison below is split into EXACT and BOUNDED; TradingView does not do it');

  const newSrc = asMode(shortVolWin(withAdapters(BASE)), 'Debug');
  const oldSrc = asMode(shortVolWin(withAdapters(BASELINE)), 'Debug');
  const [A, B] = await Promise.all([run(rows, { source: newSrc }), run(rows, { source: oldSrc })]);

  // ---- 2. EXACT group ------------------------------------------------------
  let exactBad = 0;
  const emptyExact = [];
  for (const h of EXACT) {
    const a = ser(A, h), b = ser(B, h);
    if (fin(a).length === 0) emptyExact.push(h);
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (!eq(a[i], b[i])) exactBad += 1;
  }
  check(exactBad === 0, `${EXACT.length} inline / discrete measurements bit-identical to the baseline across ${rows.length} bars`);
  check(emptyExact.length === 0, `every EXACT measurement carries data (empty: ${emptyExact.join(', ') || 'none'})`);

  // ---- 3. BOUNDED group ----------------------------------------------------
  let worstName = '', worstRel = 0, worstBar = -1, structural = 0;
  const emptyBounded = [];
  for (const h of BOUNDED) {
    const a = ser(A, h), b = ser(B, h);
    if (fin(a).length === 0) emptyBounded.push(h);
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (eq(a[i], b[i])) continue;
      // One side na and the other a number is STRUCTURAL — a different sample
      // set, a different guard, a different window. Rounding cannot produce it.
      if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) { structural += 1; continue; }
      const rel = Math.abs(a[i] - b[i]) / Math.max(1e-12, Math.abs(b[i]));
      if (rel > worstRel) { worstRel = rel; worstName = h; worstBar = i; }
    }
  }
  check(structural === 0, 'no BOUNDED measurement is defined on one build and undefined on the other');
  check(emptyBounded.length === 0, `every BOUNDED measurement carries data (empty: ${emptyBounded.join(', ') || 'none'})`);
  // 1e-3 is not a tolerance chosen to make the test pass; it is the ceiling
  // above which a ten-decimal input perturbation could no longer explain the
  // difference for the smallest-scale measure here (the perp premium, ~4e-4,
  // normalised by a standard deviation of the same order).
  check(worstRel < 1e-3, `every BOUNDED difference explained by input rounding — worst ${worstRel.toExponential(2)} relative`);
  if (worstBar >= 0) note(`worst case: ${worstName} at bar ${worstBar}`);

  // ---- 4. discrete state, which is what a user actually reads --------------
  const dA = decode(A), dB = decode(B);
  const OLD_STAT = ['ref', 'spot', 'oi', 'daily', 'sopr', 'fd', 'et', 'lL', 'lS'];
  const spB = ser(B, 't_statPack');
  const oldStat = Object.fromEntries(OLD_STAT.map((k) => [k, []]));
  for (let i = 0; i < spB.length; i++) {
    const s = unpack(spB[i], 5, 9);
    OLD_STAT.forEach((k, j) => oldStat[k].push(s[j]));
  }
  let statBad = 0;
  for (const k of ['ref', 'spot', 'oi', 'daily', 'fd', 'et', 'lL', 'lS']) {
    for (let i = 0; i < spB.length; i++) if (!eq(dA.stat[k][i], oldStat[k][i])) statBad += 1;
  }
  check(statBad === 0, 'every feed status code identical (SOPR excluded — removed by decision)');

  let dirBad = 0, lvlBad = 0;
  for (const k of Object.keys(dA.dir)) for (let i = 0; i < rows.length; i++) if (!eq(dA.dir[k][i], dB.dir[k][i])) dirBad += 1;
  for (const k of Object.keys(dA.lvl)) for (let i = 0; i < rows.length; i++) if (!eq(dA.lvl[k][i], dB.lvl[k][i])) lvlBad += 1;
  check(dirBad === 0, 'every raw-value direction code identical (11 measures)');
  check(lvlBad === 0, 'every hysteresis intensity level identical (10 measures) — rounding moved no state');

  const PAIRS = [['tfOK', 1], ['oiObs', 2], ['partOK', 8], ['oiOK', 16], ['oiNotional', 32], ['changed', 64]];
  let boolBad = 0;
  const bOld = ser(B, 't_boolPack');
  for (const [name, oldBit] of PAIRS) {
    const an = bser(A, name);
    for (let i = 0; i < rows.length; i++) {
      const bo = Number.isFinite(bOld[i]) ? ((Math.round(bOld[i]) & oldBit) ? 1 : 0) : NaN;
      if (!eq(an[i], bo)) boolBad += 1;
    }
  }
  check(boolBad === 0, 'shared boolean state identical (tfOK, oiObs, partOK, oiOK, OI units guard, changed)');

  const evA = ser(A, 't_evPush').at(-1), duA = ser(A, 't_evDup').at(-1);
  check(evA === ser(B, 't_evPush').at(-1) && duA === ser(B, 't_evDup').at(-1),
    `event log identical: ${evA} accepted / ${duA} suppressed`);

  // ---- 5. the Decision words are a relabelling, not a new state ------------
  const tsA = ser(A, 't_trendScore');
  const WORDS = { '2': 'Strong uptrend', '1': 'Uptrend', '0': 'Neutral', '-1': 'Downtrend', '-2': 'Strong downtrend' };
  const seen = [...new Set(fin(tsA).map((v) => Math.round(v)))].sort((x, y) => x - y);
  check(seen.every((v) => WORDS[String(v)] !== undefined), `MARKET word defined for every trendScore observed (${seen.join(', ')})`);
  check(seen.length >= 3, `trendScore actually varies over the sample (${seen.length} distinct states)`);

  // The context clock must tick once per chart bar at 4H, or the 4H differential
  // is comparing a frozen context against a live one and means nothing.
  const nc = bser(A, 'newCtx');
  check(nc.every((v) => v === 1), `context clock stepped on all ${nc.length} bars at 4H (offset 0, so buffers track bar history exactly)`);
}

// ============================================================================
export async function plannerDifferential() {
  section('§27 TRADE PLANNER DIFFERENTIAL — new vs Trade Risk Planner v1.0');

  // A grid chosen to exercise every branch of the arithmetic: both directions,
  // pinned and live entry, explicit and ATR-derived stop, the leverage cap
  // binding and not binding, and a stop on the wrong side of entry.
  const CASES = [
    { dir: 'Long',  entry: 0,     stop: 0,     eq: 10000,  risk: 1.0,  lev: 1.0,  why: 'live entry, ATR stop, cap loose' },
    { dir: 'Short', entry: 0,     stop: 0,     eq: 10000,  risk: 1.0,  lev: 1.0,  why: 'short, live entry, ATR stop' },
    { dir: 'Long',  entry: 60000, stop: 58000, eq: 25000,  risk: 2.0,  lev: 3.0,  why: 'pinned entry and stop' },
    { dir: 'Short', entry: 60000, stop: 62000, eq: 25000,  risk: 2.0,  lev: 3.0,  why: 'short, pinned' },
    { dir: 'Long',  entry: 60000, stop: 59950, eq: 100000, risk: 5.0,  lev: 1.0,  why: 'tight stop — leverage cap binds' },
    { dir: 'Short', entry: 60000, stop: 60050, eq: 100000, risk: 5.0,  lev: 1.0,  why: 'short, tight stop — cap binds' },
    { dir: 'Long',  entry: 60000, stop: 61000, eq: 10000,  risk: 1.0,  lev: 1.0,  why: 'stop on the wrong side — plan voided' },
    { dir: 'Long',  entry: 0,     stop: 0,     eq: 500,    risk: 0.25, lev: 10.0, why: 'small account, high cap' },
  ];

  // v1.0 encoded "follow the live price" and "derive the stop from ATR" as a
  // magic zero. v1.1 replaced both with an explicit mode, which is the whole
  // point of §2 — so the same CASE is expressed in each build's own idiom and
  // the two must still produce the same numbers.
  const applyPlan = (src, c, isNew) => {
    let x = src;
    if (isNew) {
      x = setBool(x, 'Enable trade plan', true);
      // Costs OFF: this compares the arithmetic v1.0 actually had.
      x = setBool(x, 'Include costs in position sizing', false);
      x = setStr(x, 'Entry', c.entry > 0 ? 'Manual price' : 'Current price');
      x = setStr(x, 'Stop', c.stop > 0 ? 'Manual price' : 'ATR distance');
      x = setNum(x, '  Entry price', c.entry.toFixed(1));
      x = setNum(x, '  Stop price', c.stop.toFixed(1));
      x = setNum(x, '  ATR multiple', '1.5');
      x = setNum(x, '  Risk (%)', c.risk.toFixed(2));
    } else {
      x = setNum(x, 'Entry price (0 = current price)', c.entry.toFixed(1));
      x = setNum(x, 'Invalidation price (0 = auto)', c.stop.toFixed(1));
      x = setNum(x, 'Auto-stop distance (ATR multiples)', '1.5');
      x = setNum(x, 'Risk per trade (%)', c.risk.toFixed(2));
    }
    x = setStr(x, 'Direction', c.dir);
    x = setNum(x, 'Account equity', c.eq.toFixed(1));
    x = setNum(x, 'Max exposure (x equity)', c.lev.toFixed(1));
    return x;
  };

  const near = (x, y) => x === y || (Number.isNaN(x) && Number.isNaN(y)) ||
    (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) / Math.max(1e-12, Math.abs(y)) < 1e-12);

  let compared = 0, planned = 0;
  for (const c of CASES) {
    const [A, B] = await Promise.all([
      run(rows, { source: applyPlan(BASE, c, true) }),
      run(rows, { source: applyPlan(BASELINE_PLANNER, c, false) }),
    ]);

    const aPlan = bser(A, 'planOK'), aCap = bser(A, 'capped');
    const bPlan = ser(B, 't_planOK'), bCap = ser(B, 't_capped');
    // t_trail is absent: v1.1 removed the N-bar trailing reference, whose job —
    // "how far is price from where this trade stops being alive" — is done
    // properly by the ACTIVE view's distance-to-stop in R. Recorded as an
    // intentional removal in research/MIGRATION.md, not dropped quietly.
    const direct = [['t_entry', 't_entry'], ['t_stop', 't_stop'], ['t_qty', 't_qty'], ['t_patr', 't_atr']];

    let bad = 0, live = 0;
    for (let i = 0; i < rows.length; i++) {
      if (!eq(aPlan[i], bPlan[i]) || !eq(aCap[i], bCap[i])) bad += 1;
      for (const [ka, kb] of direct) if (!near(ser(A, ka)[i], ser(B, kb)[i])) bad += 1;

      // Everything else the planner prints is a fixed function of those, so it
      // is recomputed from the NEW build's outputs and checked against the OLD
      // build's own plots. That is stronger than plotting both: it proves the
      // derivations as well as the values.
      const qty = ser(A, 't_qty')[i], entry = ser(A, 't_entry')[i], stop = ser(A, 't_stop')[i];
      if (Number.isFinite(qty)) {
        live += 1;
        const dist = Math.abs(entry - stop);
        const s = c.dir === 'Long' ? 1 : -1;
        if (!near(qty * entry, ser(B, 't_notional')[i])) bad += 1;
        if (!near(qty * dist, ser(B, 't_risk')[i])) bad += 1;
        if (!near(entry + s * dist, ser(B, 't_r1')[i])) bad += 1;
        if (!near(entry + 3 * s * dist, ser(B, 't_r3')[i])) bad += 1;
      }
      compared += 1;
    }
    planned += live;
    check(bad === 0, `planner identical — ${c.why}${live === 0 ? ' (plan correctly void on every bar)' : ''}`);
  }
  note(`${compared} bars compared across ${CASES.length} plan configurations; ${planned} carried a live plan`);
}
