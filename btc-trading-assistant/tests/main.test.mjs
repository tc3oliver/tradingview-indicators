// Behaviour and safety checks for BTC Trading Assistant.
//
// The migration differential proves the numbers did not change. This file
// proves the things the differential cannot: that the indicator is honest on a
// timeframe its predecessor refused to run on, that it never reads a bar it
// should not, that the default panel cannot show a direction, and that a broken
// or misdeclared feed produces silence rather than a plausible number.

import {
  rows, run, ser, eq, check, note, section, fin, CHART, ALT,
  BASE, PROD, RAW, HASH, rewrite, enable, extMaster, wire, asMode, setConst,
  symOverride, chartStandard, readTable, bser, decode, branchTypeLint, buildSeries,
} from './harness.mjs';
import { instrument, hookNames, missingSymbols } from './build-instrumented.mjs';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sub = (src, re, to) => src.replace(re, to);
const setNum = (src, label, v) =>
  sub(src, new RegExp(`input\\.(float|int|price)\\([^,]+,\\s*"${esc(label)}"`), (m, t) => `input.${t}(${v}, "${label}"`);
const setStr = (src, label, v) =>
  sub(src, new RegExp(`input\\.string\\("[^"]*",\\s*"${esc(label)}"`), `input.string("${v}", "${label}"`);
const setBool = (src, label, v) =>
  sub(src, new RegExp(`input\\.bool\\((?:true|false),\\s*"${esc(label)}"`), `input.bool(${v}, "${label}"`);

// One place that knows v1.1's plan-input vocabulary. `entry`/`stop`/`target` of
// 0 mean "use the mode that does not need a price" — Current price, ATR
// distance, R multiple — rather than v1.0's magic zero, which is exactly what
// §2 removed from the product.
export const plan = (o = {}) => {
  let x = setBool(BASE, 'Enable trade plan', true);
  x = setStr(x, 'Stage', o.stage ?? 'Planning');
  x = setStr(x, 'Direction', o.dir ?? 'Long');
  x = setStr(x, 'Entry', (o.entry ?? 0) > 0 ? 'Manual price' : 'Current price');
  x = setStr(x, 'Stop', (o.stop ?? 0) > 0 ? 'Manual price' : 'ATR distance');
  x = setStr(x, 'Target', (o.target ?? 0) > 0 ? 'Manual price' : 'R multiple');
  x = setNum(x, '  Entry price', (o.entry ?? 0).toFixed(2));
  x = setNum(x, '  Stop price', (o.stop ?? 0).toFixed(2));
  x = setNum(x, '  Target price', (o.target ?? 0).toFixed(2));
  x = setNum(x, '  Target (R)', (o.tgtR ?? 2).toFixed(2));
  x = setNum(x, '  ATR multiple', (o.atrMult ?? 1.5).toFixed(2));
  x = setNum(x, 'Account equity', (o.eq ?? 10000).toFixed(2));
  x = setNum(x, '  Risk (%)', (o.risk ?? 1).toFixed(4));
  x = setNum(x, 'Max exposure (x equity)', (o.lev ?? 100).toFixed(2));
  x = setBool(x, 'Include costs in position sizing', o.cost !== false);
  x = setNum(x, '  Entry cost (bp)', (o.entryBp ?? 5).toFixed(2));
  x = setNum(x, '  Exit cost (bp)', (o.exitBp ?? 5).toFixed(2));
  if (o.riskCash != null) {
    x = setStr(x, 'Risk per trade', 'Fixed cash amount');
    x = setNum(x, '  Risk ($)', o.riskCash.toFixed(2));
  }
  if (o.alerts) x = setBool(x, 'Enable plan alerts', true);
  if (o.alertR) x = setBool(x, '  Also alert at 1R / 2R / 3R', true);
  return x;
};

const CTX_HOOKS = ['t_refClose', 't_atr14', 't_px24', 't_oiChg24', 't_oiZ24', 't_premium', 't_premZ', 't_partRaw', 't_rvolPerp'];

// ---------------------------------------------------------------------------
export async function sourceChecks() {
  section('§1 / §26 SOURCE — what the shipped file itself guarantees');

  const bad = branchTypeLint(RAW);
  check(bad.length === 0, `no if/else branch mixes a value-returning call with a void one (Pine CE10235)`);
  for (const b of bad.slice(0, 5)) note(b);

  // §1: TEST INSTRUMENTATION IS NOT PART OF THE PRODUCT.
  // v1.0 carried 57 hidden `plot(..., display = display.none)` hooks here and
  // sat at 63 of Pine's 64 plot outputs — a shipped file one plot from refusing
  // to compile, entirely because of its own tests. The hooks now live in
  // build-instrumented.mjs. These three checks are the ones that keep them there.
  const plots = (RAW.match(/^plot\(/gm) ?? []).length;
  const hooksInProd = (RAW.match(/"t_\w+"/g) ?? []).length;
  check(hooksInProd === 0, `no test-only t_* output in the shipped file (${hooksInProd} found)`);
  check(plots < 15, `${plots} plot outputs in production, target < 15`);
  check(plots <= 10, `${plots} plot outputs — the plan is drawn with lines and boxes, which cost no output slots`);
  // Comments are excluded throughout this section: the source discusses
  // alertcondition(), confirm = true, LONG and SHORT precisely in order to
  // explain why it does not use them, and a check that cannot tell a use from an
  // explanation is a check that punishes documentation.
  const code = RAW.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  check(!/alertcondition\(/.test(code), 'no alertcondition() — plan alerts use alert(), which consumes no output slot');
  check(!/\bstrategy\s*\(/.test(code), 'this is an indicator, not a strategy');

  // ...and the instrumented build must still observe everything, or the suite
  // would pass by measuring nothing. A renamed variable turns its hook into an
  // all-na series that every downstream test then satisfies vacuously.
  const missing = missingSymbols(PROD);
  check(missing.length === 0, `every instrumentation hook references a symbol that exists (${missing.join(', ') || 'all present'})`);
  const instrumented = (instrument(PROD).match(/^plot\(/gm) ?? []).length;
  note(`production ${plots} plots · instrumented ${instrumented} plots · ${hookNames().length} hooks · the instrumented build is never pasted into TradingView`);

  // request.*() calls are capped at 40 per script.
  const reqs = (RAW.match(/request\.\w+\(/g) ?? []).length;
  check(reqs <= 40, `${reqs} request.*() calls, within Pine's ceiling of 40`);

  // §22: every requested context is bounded, and bounded ABOVE the deepest
  // window it contains. A calc_bars_count that reached a window would silently
  // truncate a reading instead of speeding it up, which is the one way this
  // optimisation could do harm. 2,190 percentile + 30 stdev + slack.
  const unbounded = (RAW.match(/ignore_invalid_symbol = true\)/g) ?? []).length;
  check(unbounded === 0, `every request bounds its history with calc_bars_count (${unbounded} unbounded)`);
  const ctxBars = +(RAW.match(/^CTX_BARS\s*=\s*(\d+)/m) ?? [])[1];
  const dailyBars = +(RAW.match(/^DAILY_BARS\s*=\s*(\d+)/m) ?? [])[1];
  check(ctxBars >= 2250, `CTX_BARS ${ctxBars} exceeds the deepest 4H window (~2,220 bars), so the bound cannot truncate a reading`);
  check(dailyBars >= 250, `DAILY_BARS ${dailyBars} exceeds the 200-bar SMA and the 85-bar momentum term`);
  note(`plots ${plots}/64 · requests ${reqs}/40 · ${RAW.split('\n').length} lines · sha256 ${HASH.slice(0, 12)}`);

  // Drawing objects must be bounded by declaration, not by hope.
  for (const k of ['max_lines_count', 'max_boxes_count', 'max_labels_count']) {
    check(new RegExp(`${k}\\s*=\\s*\\d+`).test(RAW), `${k} is declared, so drawing objects cannot grow without a ceiling`);
  }

  // §26: nothing that was rejected by a study may reappear as a product feature,
  // and nothing unvalidated may be smuggled in as a familiar indicator name.
  // Comments are excluded: they discuss LONG and SHORT precisely in order to
  // explain why the indicator does not emit them.
  // "prediction" is deliberately NOT on this list. It appears once, in a
  // tooltip, in the phrase "a distance convention, not a prediction" — a word
  // used to deny the thing is not the thing, and banning it would delete the
  // disclaimer to satisfy the test.
  const banned = ['depth imbalance', 'microprice', 'pressureToCapacity', 'OFI', 'composite score', 'confidence',
    'ta.rsi', 'ta.macd', 'ta.adx', 'ta.dmi', 'fair value gap', 'order block', 'BOS', 'MSS', 'SMC',
    'probability', 'confluence'];
  const present = banned.filter((w) => code.toLowerCase().includes(w.toLowerCase()));
  check(present.length === 0, `no rejected-research or unvalidated-indicator vocabulary in the shipped code (${present.join(', ') || 'none found'})`);

  // §17: the research-defined windows and thresholds are constants, not inputs.
  // A user retuning the semantics of a reading and then comparing their panel
  // with someone else's is the failure this freeze exists to prevent.
  for (const c of ['Z_WIN', 'VOL_PCT_WIN', 'RVOL_DAYS', 'OI_ENTER', 'PREM_ENTER', 'TR_ENTER', 'LIQ_XEXIT']) {
    check(new RegExp(`^${c}\\s*=`, 'm').test(RAW), `${c} is a frozen constant`);
  }
  const hysInputs = ['Percentile / z lookback', 'Volatility percentile lookback', 'RVOL comparison window',
    'OI unusual (σ)', 'Trend enter (ATR from 200D)', 'Funding elevated (σ)'];
  const stillInputs = hysInputs.filter((l) => RAW.includes(`"${l}`));
  check(stillInputs.length === 0, `no research parameter is exposed as a setting (${stillInputs.join(', ') || 'none'})`);

  // §2 / §18: `active =` is what stops the settings dialog offering an edit that
  // cannot change anything — an editable ATR multiple beside a manual stop price
  // is an invitation to set a number that is silently ignored.
  const actives = (RAW.match(/\bactive = /g) ?? []).length;
  check(actives >= 15, `${actives} inputs are conditionally greyed out with active =`);
  check(!/confirm\s*=\s*true/.test(code), 'no input uses confirm = true, so first run draws context instead of opening a dialog');
  for (const p of ['  Entry price', '  Stop price', '  Target price']) {
    check(new RegExp(`input\\.price\\([^\\n]*"${p}"`).test(RAW), `${p.trim()} is an input.price(), draggable on the chart`);
  }

  // Every ta.* call must be reachable unconditionally. The two in-context
  // helpers are the ones that could regress, so their shape is pinned.
  // The trap this product had to be fixed for: an offset derived from
  // timeframe.period inside a request.security expression resolves against the
  // REQUESTED timeframe, not the chart's, so it silently becomes zero.
  check(!/\bOFS\b/.test(RAW), 'no history offset is derived from timeframe.period inside a request context');
  check(/isLTF \? \w+ : \w+/.test(RAW), 'the completed-bar selection happens in chart scope, where isLTF is meaningful');
  const la = (RAW.match(/lookahead = barmerge\.lookahead_on/g) ?? []).length;
  const prev = (RAW.match(/\[1\][^\n]*lookahead = barmerge\.lookahead_on/g) ?? []).length;
  check(la === prev + 1, `every lookahead_on request is paired with a [1] offset, plus the daily idiom (${la} total)`);
}

// ---------------------------------------------------------------------------
// A real lower-timeframe chart. Each 4H bar is split into four 1H bars whose
// aggregate reproduces the original open, high, low, close and volume exactly,
// so "the 4H context on a 1H chart" can be compared against the 4H build's own
// numbers rather than against an approximation of them.
// `parts` sub-bars per 4H bar. The first, second-to-last and last carry the
// open, the extremes and the close; the filler bars in between sit flat at the
// low so the aggregate open/high/low/close/volume of each group reproduces the
// original 4H bar exactly. That exactness is what lets "the 4H context on a 5m
// chart" be compared against the 4H build's own numbers instead of against an
// approximation of them.
function split(src, parts) {
  const stepMs = 14_400_000 / parts;
  const out = [];
  for (const r of src) {
    const sc = r.spotClose / r.close;
    const mk = (n, o, h, l, c) => ({
      t: r.t + n * stepMs,
      open: o, high: h, low: l, close: c, volume: r.volume / parts,
      spotOpen: o * sc, spotHigh: h * sc, spotLow: l * sc, spotClose: c * sc, spotVolume: r.spotVolume / parts,
      oi: r.oi, oiValue: r.oiValue,
    });
    out.push(mk(0, r.open, r.open, r.open, r.open));
    for (let n = 1; n <= parts - 3; n++) out.push(mk(n, r.low, r.low, r.low, r.low));
    out.push(mk(parts - 2, r.low, r.high, r.low, r.high));
    out.push(mk(parts - 1, r.high, r.high, r.low, r.close));
  }
  return out;
}

// One timeframe's worth of the lower-timeframe contract, run for 5m, 15m and 1H.
// Below 4H the context must be the last COMPLETED 4H bar, held for the whole
// period, and it must never read the bar the chart is currently inside.
async function ltfCheck(label, tf, parts, base4h, four) {
  const bars = split(base4h, parts);
  let ctx = null;
  try {
    ctx = await run(bars, { source: BASE, tf, byTf: { [tf]: buildSeries(bars), '240': buildSeries(base4h) } });
  } catch (e) { note(`${label} run failed: ` + e.message); }
  check(ctx !== null, `runs on a ${label} chart (${bars.length} synthetic ${label} bars over ${base4h.length} 4H bars)`);
  if (!ctx) return;

  const nc = bser(ctx, 'newCtx');
  const ticks = nc.filter((v) => v === 1).length;
  check(ticks > 0 && ticks <= bars.length / parts + 1,
    `${label}: context clock ticked ${ticks} times over ${bars.length} bars (~1 per 4H period)`);

  const ref4 = ser(four, 't_refClose');
  const refL = ser(ctx, 't_refClose');
  let matched = 0, checkedN = 0, leaked = 0;
  for (let k = 2; k < base4h.length; k++) {
    const want = ref4[k - 1];
    if (!Number.isFinite(want)) continue;
    for (let j = 0; j < parts; j++) {
      const got = refL[parts * k + j];
      if (!Number.isFinite(got)) continue;
      checkedN += 1;
      if (Math.abs(got - want) < 1e-6) matched += 1;
      // Reading the bar the chart is currently inside would be lookahead.
      if (Math.abs(got - ref4[k]) < 1e-9 && Math.abs(ref4[k] - want) > 1e-9) leaked += 1;
    }
  }
  check(checkedN > 0 && matched === checkedN, `${label}: 4H context is the last COMPLETED 4H bar (${matched}/${checkedN} bars)`);
  check(leaked === 0, `${label}: no bar reads the 4H bar it is currently inside — ${leaked} lookahead reads`);

  // §14: below 4H the reading is stale by construction, and the panel must be
  // able to say by how much rather than let a reader assume it refreshes.
  const age = fin(ser(ctx, 't_ctxAge'));
  const inRange = age.filter((v) => v >= 0 && v < 14_400_000).length;
  check(age.length > 0 && inRange === age.length,
    `${label}: context age is always inside one 4H period (${age.length} bars) — the panel can state how old the reading is`);
}

export async function timeframeChecks() {
  section('§19 / §28 TIMEFRAME — 4H context from a lower-timeframe chart, without repainting');

  const above = await run(rows.slice(-200), { source: BASE, tf: '240' }).then(() => true).catch(() => false);
  check(above, 'runs on a 4H chart');

  // The guard is a runtime.error, which the harness strips for the offline
  // runtime, so the PREDICATE is asserted instead: tfOK must be true at 4H and
  // the source must still carry the guard that acts on it.
  check(bser(await run(rows.slice(-100), { source: BASE }), 'tfOK').every((v) => v === 1), 'tfOK true on a 4H chart');
  check(/if not tfOK\n\s+runtime\.error\(/.test(RAW), 'the source still refuses to run above 4H');
  check(/chartSec <= 14400/.test(RAW), 'the timeframe predicate admits everything at or below 4H, not 4H alone');
  check(/5m, 15m, 1H and 4H/.test(RAW), 'the refusal message names the four intended timeframes');

  // §20: 5m, 15m and 1H, each served REAL sub-4H bars while
  // request.security(sym, "240") is served the original 4H bars. Without that
  // split the provider would hand the chart's own series back for the 4H request
  // and every check below would pass while testing nothing — a trap this suite
  // fell into once already.
  const base4h = rows.slice(-400);
  const four = await run(base4h, { source: BASE, tf: '240' });
  await ltfCheck('1H', '60', 4, base4h, four);
  await ltfCheck('15m', '15', 16, base4h, four);
  // 48 sub-bars per 4H bar, so a shorter 4H window keeps the run affordable
  // while still crossing many context boundaries.
  const short4h = rows.slice(-120);
  const short4 = await run(short4h, { source: BASE, tf: '240' });
  await ltfCheck('5m', '5', 48, short4h, short4);

  // PREFIX INVARIANCE. Re-running on a shorter history must not change any value
  // on the bars both runs share. A repainting construct fails this.
  const long = await run(rows.slice(-600), { source: BASE });
  const short = await run(rows.slice(-600).slice(0, 500), { source: BASE });
  let drift = 0, comparedN = 0;
  for (const key of CTX_HOOKS) {
    const a = ser(long, key), b = ser(short, key);
    // Trailing bars of the shorter run are its own realtime edge; compare the
    // settled prefix, which is what "does not repaint" is a claim about.
    for (let i = 0; i < 480; i++) {
      if (!Number.isFinite(a[i]) && !Number.isFinite(b[i])) continue;
      comparedN += 1;
      if (!eq(a[i], b[i])) drift += 1;
    }
  }
  check(comparedN > 0 && drift === 0, `history-prefix invariance: ${comparedN} settled values unchanged by extending the chart`);
}

// ---------------------------------------------------------------------------
export async function independenceChecks() {
  section('§20 REFERENCE — context follows BTC, never the chart');

  const [onBtc, onAlt] = await Promise.all([
    run(rows.slice(-400), { source: BASE, chart: CHART }),
    run(rows.slice(-400), { source: BASE, chart: ALT }),
  ]);
  let diff = 0, comparedN = 0;
  for (const key of CTX_HOOKS) {
    const a = ser(onBtc, key), b = ser(onAlt, key);
    for (let i = 0; i < a.length; i++) {
      if (!Number.isFinite(a[i]) && !Number.isFinite(b[i])) continue;
      comparedN += 1;
      if (!eq(a[i], b[i])) diff += 1;
    }
  }
  check(comparedN > 0 && diff === 0, `every context reading identical on a ${ALT} chart (${comparedN} values) — the chart symbol cannot reach one`);

  // ...and the planner is the opposite: it MUST follow the chart, because the
  // plan is the one you are looking at.
  const plan = (s) => setBool(s, 'Enable trade plan', true);
  const [pBtc, pAlt] = await Promise.all([
    run(rows.slice(-400), { source: plan(BASE), chart: CHART }),
    run(rows.slice(-400), { source: plan(BASE), chart: ALT }),
  ]);
  const eBtc = fin(ser(pBtc, 't_entry')), eAlt = fin(ser(pAlt, 't_entry'));
  check(eBtc.length > 0 && eAlt.length > 0 && eBtc.at(-1) !== eAlt.at(-1),
    `live entry follows the chart, not the reference (${eBtc.at(-1)?.toFixed(1)} vs ${eAlt.at(-1)?.toFixed(1)})`);

  const t = readTable(await run(rows.slice(-400), { source: BASE, chart: ALT })).join('\n');
  check(/not BTC/i.test(t), 'a non-BTC chart is told so, rather than silently adapting');
}

// ---------------------------------------------------------------------------
export async function dataHonestyChecks() {
  section('DATA — a feed that cannot be trusted produces silence, not a number');

  // USD-notional open interest moves with price and cannot measure positioning.
  // Both detection paths get their own run.
  const byCurrency = await run(rows.slice(-300), { source: asMode(BASE, 'Detailed'), oiCurrency: 'USD' });
  const byMagnitude = await run(rows.slice(-300), { source: asMode(BASE, 'Detailed'), usdOI: true });
  for (const [name, ctx] of [['declared currency', byCurrency], ['implausible magnitude', byMagnitude]]) {
    const flagged = bser(ctx, 'oiNotional').some((v) => v === 1);
    const oiOK = bser(ctx, 'oiOK').every((v) => v !== 1);
    const chg = fin(ser(ctx, 't_oiChg24'));
    check(flagged && oiOK && chg.length === 0, `USD-denominated OI rejected via ${name} — no positioning reading is produced`);
  }
  const t = readTable(byCurrency).join('\n');
  check(/REJECTED/.test(t), 'the rejection is stated on the panel, not just internally');

  // An adapter that is enabled but never wired is MISCONFIGURED (status 1), and
  // must not produce a reading.
  const misc = await run(rows.slice(-300), { source: asMode(enable(extMaster(BASE), 'funding'), 'Detailed') });
  const dm = decode(misc);
  check(dm.stat.fd.every((v) => v === 1), 'an enabled but unwired adapter reports MISCONFIGURED on every bar');
  check(fin(ser(misc, 't_fundRaw')).length === 0, '...and produces no funding reading');

  // A wired adapter that stops moving becomes LIKELY STALE and its reading is
  // withdrawn, rather than the last value standing as a live anomaly.
  const cut = 200;
  let stale = enable(extMaster(BASE), 'funding');
  stale = wire(stale, 'Aggregated funding rate', `extFunding = bar_index < ${cut} ? (close - ta.sma(close, 20)) / ta.sma(close, 20) * 0.05 : 0.00042`);
  const st = await run(rows.slice(-400), { source: asMode(stale, 'Detailed') });
  const ds = decode(st);
  const lateStat = ds.stat.fd.slice(cut + 12);
  check(lateStat.length > 0 && lateStat.every((v) => v === 2), 'a frozen adapter is marked LIKELY STALE once past its threshold');
  const lateRead = ser(st, 't_fundRaw').slice(cut + 12);
  check(fin(lateRead).length === 0, '...and its reading is withdrawn while stale');

  // Liquidation balance subtracts one feed from the other, so it is withheld
  // unless the user declares the two share a unit. Landing inside [-1,+1] proves
  // nothing: two unrelated scales also land there.
  let paired = enable(enable(extMaster(BASE), 'long-liquidation'), 'short-liquidation');
  paired = wire(paired, 'Long liquidations', 'extLiqL    = math.abs(close - close[1]) * volume');
  paired = wire(paired, 'Short liquidations', 'extLiqS    = math.abs(high - low) * volume * 0.7');
  const undeclared = await run(rows.slice(-300), { source: asMode(paired, 'Detailed') });
  check(fin(ser(undeclared, 't_liqBal')).length === 0, 'liquidation balance withheld until the shared unit is declared');
  const declared = await run(rows.slice(-300), {
    source: asMode(setBool(paired, '  Long and short liquidations share one source and unit', true), 'Detailed'),
  });
  const bal = fin(ser(declared, 't_liqBal'));
  check(bal.length > 0 && bal.every((v) => v >= -1 && v <= 1), `declared pairing produces a balance in [-1,+1] (${bal.length} bars)`);
}

// ---------------------------------------------------------------------------
export async function semanticChecks() {
  section('SEMANTICS — direction comes from the raw value, rarity from the percentile');

  const full = (s) => {
    let x = extMaster(setBool(s, '  Long and short liquidations share one source and unit', true));
    for (const l of ['long-liquidation', 'short-liquidation', 'funding', 'ETF flow']) x = enable(x, l);
    x = wire(x, 'Long liquidations', 'extLiqL    = math.abs(close - close[1]) * volume');
    x = wire(x, 'Short liquidations', 'extLiqS    = math.abs(high - low) * volume * 0.7');
    x = wire(x, 'Aggregated funding rate', 'extFunding = (close - ta.sma(close, 20)) / ta.sma(close, 20) * 0.05');
    x = wire(x, 'US spot BTC ETF net flow', 'extEtf     = (close - close[1]) * 100.0');
    return x;
  };
  const ctx = await run(rows, { source: asMode(full(BASE), 'Debug') });
  const d = decode(ctx);

  // The invariant that this whole design exists to enforce: a direction code is
  // the sign of its own raw measurement and of nothing else. A z-score may not
  // decide it.
  const INV = [
    ['oi24', 't_oiChg24'], ['oi4', 't_oiChg4'], ['pm', 't_premium'],
    ['fd', 't_fundRaw'], ['et', 't_etf5d'], ['lqB', 't_liqBal'],
  ];
  let bad = 0, tested = 0;
  for (const [key, hook] of INV) {
    const raw = ser(ctx, hook), dir = d.dir[key];
    for (let i = 0; i < raw.length; i++) {
      if (!Number.isFinite(raw[i]) || !Number.isFinite(dir[i])) continue;
      tested += 1;
      const want = raw[i] > 0 ? 1 : raw[i] < 0 ? -1 : 0;
      if (dir[i] !== want) bad += 1;
    }
  }
  check(tested > 0 && bad === 0, `direction code equals sign(raw value) on all ${tested} observations across ${INV.length} measures`);

  // Percentiles must be percentiles.
  let outOfRange = 0, pTested = 0;
  for (const hook of ['t_oiP4', 't_oiP24', 't_premP', 't_partP', 't_rvolSpotP', 't_rvolPerpP', 't_fundP', 't_etfP', 't_volPct']) {
    for (const v of fin(ser(ctx, hook))) { pTested += 1; if (v < 0 || v > 100) outOfRange += 1; }
  }
  check(pTested > 0 && outOfRange === 0, `all ${pTested} percentile observations lie in [0, 100]`);

  // A z-score is standardised: over a long sample its mean sits near zero and
  // its spread near one. This is a sanity check on validNorm's arithmetic, not a
  // distributional claim about the market.
  const z = fin(ser(ctx, 't_oiZ24'));
  const m = z.reduce((s, x) => s + x, 0) / z.length;
  const s2 = Math.sqrt(z.reduce((s, x) => s + (x - m) ** 2, 0) / z.length);
  check(Math.abs(m) < 0.35 && s2 > 0.6 && s2 < 1.6, `OI 24H z-score is standardised (mean ${m.toFixed(3)}, sd ${s2.toFixed(3)}, n=${z.length})`);

  // The ladder is a Schmitt trigger: entering costs more than staying. Its
  // levels must never exceed 2 and must be consistent with |z| at the extremes.
  let ladderBad = 0;
  const lz = ser(ctx, 't_oiZ24s'), ll = d.lvl.oi24;
  for (let i = 0; i < lz.length; i++) {
    if (!Number.isFinite(lz[i]) || !Number.isFinite(ll[i])) continue;
    if (ll[i] > 2) ladderBad += 1;
    if (Math.abs(lz[i]) < 0.6 && ll[i] !== 0) ladderBad += 1;      // below the exit, must be off
    if (Math.abs(lz[i]) >= 2.0 && ll[i] === 0) ladderBad += 1;      // at the extreme entry, must be on
  }
  check(ladderBad === 0, 'the OI ladder never exceeds level 2, is off below its exit and on at its extreme entry');

  // The trend state's sign is its raw deviation's sign by construction.
  const td = ser(ctx, 't_trendDist'), tst = ser(ctx, 't_trSt');
  let trBad = 0, trN = 0;
  for (let i = 0; i < td.length; i++) {
    if (!Number.isFinite(td[i]) || !Number.isFinite(tst[i]) || tst[i] === 0) continue;
    trN += 1;
    if (Math.sign(td[i]) !== Math.sign(tst[i])) trBad += 1;
  }
  check(trN > 0 && trBad === 0, `engaged trend state always agrees in sign with its raw ATR distance (${trN} bars)`);
}

// ---------------------------------------------------------------------------
export async function panelChecks() {
  section('§13–§16 / §22–§25 THE PANEL — what a user is allowed to be shown');

  const decision = readTable(await run(rows, { source: BASE }));
  const text = decision.join('\n');

  // §22: the default panel carries no research vocabulary at all.
  const FORBIDDEN = ['σ', 'z-score', 'percentile', 'p-value', 'DSR', 'beta', 'sigma',
    'OFI', 'microprice', 'depth imbalance', 'pressure', 'sample', 'confidence', '%ile'];
  const leaked = FORBIDDEN.filter((w) => text.toLowerCase().includes(w.toLowerCase()));
  check(leaked.length === 0, `Decision view carries no research vocabulary (${leaked.join(', ') || 'clean'})`);
  check(!/\dp\b/.test(text), 'Decision view prints no percentile ranks');

  // §13: three context lines, each with its word AND a plain number beside it.
  for (const row of ['BTC TRADING ASSISTANT', 'MARKET', 'VOLATILITY', 'POSITIONING']) {
    check(text.includes(row), `Decision view always shows ${row}`);
  }
  check(/4H CONTEXT/.test(text), '§14: the panel states that the context is 4H');
  check(/live bar|closed \d/.test(text), '§14: ...and how old that reading is, rather than implying it refreshes every bar');
  check(/ATR \d/.test(text), '§13: VOLATILITY carries a plain ATR percentage, not a rank');

  // §13: WATCH is absent when there is nothing unusual, rather than spending a
  // row to say "no unusual market condition".
  check(!/No unusual market condition/.test(text), '§13: a quiet market spends no row saying it is quiet');

  // §15: the disclaimer changed FORM, not meaning. The old full-width
  // AUTOMATIC SIGNAL / NONE VALIDATED row is gone; the footer replaces it.
  check(/DISCRETIONARY MODE · NO AUTO ENTRIES/.test(text), '§15: the footer states discretionary mode with no auto entries');
  check(!/AUTOMATIC SIGNAL/.test(text), '§15: ...and no longer spends a headline row restating it');
  check(/SET A PLAN/.test(text), 'with no plan, the panel says how to make one');

  // THE RULE THAT MATTERS MOST, and §15's replacement assertion: the Decision UI
  // never outputs an automatic long/short entry recommendation. LONG and SHORT
  // may appear ONLY as the echo of a direction the user typed in themselves.
  check(!/\bLONG\b|\bSHORT\b|\bBUY\b|\bSELL\b/.test(text),
    'with no plan entered, the Decision UI outputs no automatic long/short entry recommendation');
  const IMPERATIVES = ['buy ', 'sell ', 'go long', 'go short', 'enter long', 'enter short', 'take profit', 'signal:'];
  const imp = IMPERATIVES.filter((w) => text.toLowerCase().includes(w));
  check(imp.length === 0, `Decision view issues no entry instruction (${imp.join(', ') || 'none'})`);
  check(decision.length <= 20, `Decision view is ${decision.length} rows — readable at a glance`);

  // §16: DYNAMIC HIERARCHY. With a plan on, the plan leads and the market
  // compresses to one line.
  const planned = plan({ entry: 60000, stop: 58000 });
  const withPlan = readTable(await run(rows, { source: planned }));
  const wp = withPlan.join('\n');
  check(/\bLONG\b/.test(wp), 'a direction appears only once the user has entered one');
  check(withPlan[0].includes('BTC TRADE PLAN'), '§16: with a plan on, the PLAN is the first thing on the panel');
  check(/4H CONTEXT/.test(wp) && /·/.test(wp), '§16: ...and the market context compresses to a single line');
  for (const row of ['ENTRY', 'STOP', 'TARGET', 'SIZE', 'RISK', 'COST', 'BREAKEVEN', 'PRICE→ENTRY']) {
    check(wp.includes(row), `Planning view shows ${row}`);
  }
  check(/DISCRETIONARY MODE/.test(wp), 'the disclaimer survives an entered plan');
  const leaked2 = FORBIDDEN.filter((w) => wp.toLowerCase().includes(w.toLowerCase()));
  check(leaked2.length === 0, `Planning view carries no research vocabulary either (${leaked2.join(', ') || 'clean'})`);

  // §11: ACTIVE swaps the planning row for live tracking.
  const act = readTable(await run(rows, { source: setStr(planned, 'Stage', 'Active') })).join('\n');
  for (const row of ['LIVE', 'NET P&L', 'TO STOP', 'TO TARGET']) {
    check(act.includes(row), `Active view shows ${row}`);
  }
  check(!/PRICE→ENTRY/.test(act), 'Active view drops PRICE→ENTRY — the entry is already taken');

  // §23: exactly three modes, and the mode is presentation only.
  const modes = RAW.match(/options = \["Decision", "Detailed", "Debug"\]/);
  check(modes !== null, 'exactly three display modes exist');
  check(/options = \["Compact", "Normal", "Large"\]/.test(RAW), '§19: three panel sizes exist');
  const [dec, det, dbg] = await Promise.all([
    run(rows, { source: BASE }),
    run(rows, { source: asMode(BASE, 'Detailed') }),
    run(rows, { source: asMode(BASE, 'Debug') }),
  ]);
  let modeDrift = 0, modeN = 0;
  const ALL_HOOKS = [...CTX_HOOKS, 't_anomCount', 't_evPush', 't_trSt', 't_oi24St', 't_dirPack', 't_lvlPack', 't_statPack'];
  for (const key of ALL_HOOKS) {
    const a = ser(dec, key), b = ser(det, key), c = ser(dbg, key);
    for (let i = 0; i < a.length; i++) { modeN += 1; if (!eq(a[i], b[i]) || !eq(a[i], c[i])) modeDrift += 1; }
  }
  check(modeDrift === 0, `display mode changes no measurement (${modeN} values identical across all three modes)`);

  // Panel size is presentation too — same rows, different text size.
  const large = readTable(await run(rows, { source: setStr(BASE, 'Panel size', 'Large') }));
  const compact = readTable(await run(rows, { source: setStr(BASE, 'Panel size', 'Compact') }));
  check(large.length === decision.length && compact.length === decision.length,
    `panel size changes no content (${compact.length} / ${decision.length} / ${large.length} rows)`);

  const dbgText = readTable(dbg).join('\n');
  check(/DEBUG/.test(dbgText) && /Context clock/.test(dbgText), 'Debug mode exposes the context clock and internals');
  check(!/DEBUG/.test(text), '...and Decision does not');

  // §24: defaults.
  check(/showMa    = input\.bool\(false/.test(RAW), 'daily 200MA plot is off by default');
  check(/planOn    = input\.bool\(false/.test(RAW), 'the trade plan is off by default');
  check(/extOn      = input\.bool\(false/.test(RAW), 'external context is off by default');
  check(/alertsOn = input\.bool\(false/.test(RAW), 'plan alerts are off by default');
  check(/useCost = input\.bool\(true/.test(RAW), 'costs are INCLUDED in sizing by default — the honest default');
  for (const a of ['funding', 'ETF flow', 'long-liquidation', 'short-liquidation']) {
    const src = enable(BASE, a);
    check(src !== BASE, `${a} adapter is off by default`);
  }
  // §25: zero configuration to see market context.
  check(fin(ser(dec, 't_refClose')).length > 0, '§25: market context populates with nothing configured');

  // §29: the table must never overflow. Worst case is Debug with every adapter
  // live, the anomaly list at its ceiling and a full plan.
  let worst = extMaster(setBool(BASE, '  Long and short liquidations share one source and unit', true));
  for (const l of ['long-liquidation', 'short-liquidation', 'funding', 'ETF flow']) worst = enable(worst, l);
  worst = wire(worst, 'Long liquidations', 'extLiqL    = math.abs(close - close[1]) * volume');
  worst = wire(worst, 'Short liquidations', 'extLiqS    = math.abs(high - low) * volume * 0.7');
  worst = wire(worst, 'Aggregated funding rate', 'extFunding = (close - ta.sma(close, 20)) / ta.sma(close, 20) * 0.05');
  worst = wire(worst, 'US spot BTC ETF net flow', 'extEtf     = (close - close[1]) * 100.0');
  worst = setConst(worst, 'MAX_ANOM', 9);
  worst = setBool(worst, 'Enable trade plan', true);
  const worstCtx = await run(rows, { source: asMode(worst, 'Debug') });
  const used = fin(ser(worstCtx, 't_rowsUsed'));
  const maxUsed = Math.max(...used);
  check(maxUsed <= 76, `worst-case panel uses ${maxUsed} of 76 declared table rows`);
}

// ---------------------------------------------------------------------------
// §9 / §19: the palette is derived from the chart background, so one script is
// legible on both themes without a dozen colour inputs. What is asserted here is
// the DERIVATION, not the aesthetics: light and dark must not produce the same
// colours, and neither must produce an invisible one.
export async function paletteChecks() {
  section('§9 / §19 PALETTE — one script, two themes');

  check(/color\.r\(chart\.bg_color\)/.test(RAW) && /color\.g\(chart\.bg_color\)/.test(RAW),
    'the palette reads the chart background rather than assuming one');
  check(/0\.299 \* .*0\.587 \* .*0\.114/.test(RAW), 'brightness is Rec. 601 luma, not a channel average');
  check(/isDark = bgLum < 0\.5/.test(RAW), 'a single threshold decides the theme, so no colour can disagree with another');
  check(/cText   = chart\.fg_color/.test(RAW), 'panel text is the chart foreground, so it is legible on either theme');
  const colourInputs = (RAW.match(/input\.color\(/g) ?? []).length;
  check(colourInputs === 0, `${colourInputs} colour inputs — the theme is adaptive, not a settings chore`);

  // Every palette entry must exist on both sides of the branch, or one theme
  // silently inherits the other's colour.
  const pal = RAW.match(/^c\w+\s*= isDark \? #[0-9A-Fa-f]{6} : #[0-9A-Fa-f]{6}$/gm) ?? [];
  check(pal.length >= 5, `${pal.length} palette entries define both a dark and a light value`);
}

// ---------------------------------------------------------------------------
// §21 / §24: the plan is arithmetic on real prices, and it refuses rather than
// produce a confident number from an instrument or a chart it cannot size on.
export async function instrumentChecks() {
  section('§21 / §24 INSTRUMENT AND CHART — refuse rather than be confidently wrong');

  // A non-standard chart type plots synthetic prices. Sizing a real position
  // from a live entry there would turn an imaginary price into a real quantity.
  const ha = await run(rows.slice(-200), { source: chartStandard(plan({}), 'false') });
  check(bser(ha, 'stdChart').every((v) => v === 0), 'a non-standard chart type is detected');
  check(bser(ha, 'planFatal').some((v) => v === 1), '...and a live entry on it blocks the plan');
  check(fin(ser(ha, 't_qty')).length === 0, '...and produces no size at all');
  const haText = readTable(ha).join('\n');
  check(/Non-standard chart type/.test(haText), '...and the panel says which problem it is and what to do');

  // ...but a MANUAL entry on the same chart is a real price the user typed, so
  // it is allowed, and market context is unaffected either way.
  const haManual = await run(rows.slice(-200), { source: chartStandard(plan({ entry: 60000, stop: 58000 }), 'false') });
  check(fin(ser(haManual, 't_qty')).length > 0, 'a manual entry on a non-standard chart is allowed — the price is real');
  check(fin(ser(haManual, 't_refClose')).length > 0, 'market context is unaffected: it comes from the reference symbol, not the chart');

  // Inverse / coin-margined futures are convex in price and this arithmetic is
  // linear. Refuse rather than produce a plausible wrong quantity.
  const inv = await run(rows.slice(-200), { source: symOverride(plan({ entry: 60000, stop: 58000 }), 'pointVal', '100.0') });
  check(bser(inv, 'linearOK').every((v) => v === 0), 'a non-linear instrument is detected from its point value');
  check(fin(ser(inv, 't_qty')).length === 0, '...and the plan refuses rather than size it');
  check(/Non-linear instrument/.test(readTable(inv).join('\n')), '...and says so in plain words');

  // A runtime that reports no point value must NOT be read as a rejection: a
  // false refusal on a correct chart is worse than the warning it replaces.
  const unknown = await run(rows.slice(-200), { source: symOverride(plan({ entry: 60000, stop: 58000 }), 'pointVal', 'float(na)') });
  check(fin(ser(unknown, 't_qty')).length > 0, 'an instrument that reports no point value is allowed through, not rejected');

  // §11: ACTIVE needs the price you actually filled at.
  const liveActive = await run(rows.slice(-200), { source: setStr(plan({}), 'Stage', 'Active') });
  check(bser(liveActive, 'planFatal').every((v) => v === 1), 'ACTIVE with a live entry is blocked, not silently followed');
  check(/actually filled/.test(readTable(liveActive).join('\n')), '...and the panel says to set a manual entry');
  const pinnedActive = await run(rows.slice(-200), { source: setStr(plan({ entry: 60000, stop: 58000 }), 'Stage', 'Active') });
  check(fin(ser(pinnedActive, 't_qty')).length > 0, 'ACTIVE with a manual entry works');

  // §24: a size below the exchange minimum is not a small position, it is not a
  // position.
  const tiny = await run(rows.slice(-200), { source: symOverride(plan({ entry: 60000, stop: 58000, eq: 10, risk: 0.05 }), 'minQty', '0.001') });
  check(bser(tiny, 'qtyTooSmall').some((v) => v === 1), 'a size below the instrument minimum is flagged');
  check(/below this instrument's minimum order/.test(readTable(tiny).join('\n')), '...and named on the panel');

  // §24: printed and drawn levels sit on the instrument's tick grid.
  check(/mtick = syminfo\.mintick/.test(RAW) && /math\.round\(p \/ mtick\) \* mtick/.test(RAW),
    'levels are rounded to the instrument tick, written out so it is observable offline');
}

// ---------------------------------------------------------------------------
// §5 / §6 / §7 / §8 THE PLAN ARITHMETIC.
//
// Cost-aware sizing is NEW in v1.1, so it cannot be checked against a baseline
// that never had it. It is checked against INDEPENDENT GROUND TRUTH instead:
// every quantity is recomputed here in JavaScript, from the brief's formulas,
// and compared with what the Pine produced. Recomputing is the point — a test
// that read the same expression back out of the script would only prove the
// script is consistent with itself.
function truth(o, entryLive, atr) {
  const isLong = (o.dir ?? 'Long') === 'Long';
  const s = isLong ? 1 : -1;
  const on = o.cost !== false;
  const e = on ? (o.entryBp ?? 5) / 10000 : 0;
  const x = on ? (o.exitBp ?? 5) / 10000 : 0;
  const entry = (o.entry ?? 0) > 0 ? o.entry : entryLive;
  const stop = (o.stop ?? 0) > 0 ? o.stop : entry - s * (o.atrMult ?? 1.5) * atr;
  const dist = Math.abs(entry - stop);
  const costEntryU = entry * e;
  const costStopU = stop * x;
  const riskPerUnit = dist + costEntryU + costStopU;
  const eq = o.eq ?? 10000;
  const budget = o.riskCash != null ? o.riskCash : eq * (o.risk ?? 1) / 100;
  const qtyRaw = budget / riskPerUnit;
  const qtyCap = (o.lev ?? 100) * eq / entry;
  const qty = Math.min(qtyRaw, qtyCap);
  const target = (o.target ?? 0) > 0 ? o.target : entry + s * (o.tgtR ?? 2) * dist;
  const grossR = Math.abs(target - entry) / dist;
  const netR = grossR - (costEntryU + target * x) / dist;
  return {
    entry, stop, dist, riskPerUnit, qty, budget,
    actRisk: qty * riskPerUnit,
    costStop: qty * (costEntryU + costStopU),
    costLoadR: (costEntryU + costStopU) / dist,
    bePx: isLong ? entry * (1 + e) / (1 - x) : entry * (1 - e) / (1 + x),
    r1: entry + s * dist, r2: entry + s * 2 * dist, r3: entry + s * 3 * dist,
    target, grossR, netR,
    capped: qtyRaw > qtyCap,
  };
}

export async function plannerChecks() {
  section('§5–§8 THE PLAN — cost-aware arithmetic against independent ground truth');

  const sample = rows.slice(-300);
  const rel = (a, b) => Math.abs(a - b) / Math.max(1e-9, Math.abs(b));
  const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && rel(a, b) < 1e-9;

  // The grid the brief asks for: long and short, manual and ATR stop, manual and
  // live entry, percent and fixed-cash risk, costs on and off, cap binding and
  // not, manual and R-multiple target.
  const CASES = [
    { why: 'long · manual stop · costs on',            entry: 60000, stop: 58000, eq: 25000, risk: 2 },
    { why: 'short · manual stop · costs on',           dir: 'Short', entry: 60000, stop: 62000, eq: 25000, risk: 2 },
    { why: 'long · costs OFF reproduces v1.0 exactly', entry: 60000, stop: 58000, eq: 25000, risk: 2, cost: false },
    { why: 'short · costs OFF',                        dir: 'Short', entry: 60000, stop: 62000, eq: 25000, risk: 2, cost: false },
    { why: 'long · ATR stop · live entry',             eq: 25000, risk: 1 },
    { why: 'short · ATR stop · live entry',            dir: 'Short', eq: 25000, risk: 1 },
    { why: 'fixed cash risk instead of percent',       entry: 60000, stop: 58000, riskCash: 750, eq: 25000 },
    { why: 'exposure cap binds',                       entry: 60000, stop: 59950, eq: 100000, risk: 5, lev: 1 },
    { why: 'manual target',                            entry: 60000, stop: 58000, target: 65000, eq: 25000, risk: 2 },
    { why: 'asymmetric costs (2 bp in, 12 bp out)',    entry: 60000, stop: 58000, eq: 25000, risk: 2, entryBp: 2, exitBp: 12 },
    { why: 'zero costs by rate, costs still enabled',  entry: 60000, stop: 58000, eq: 25000, risk: 2, entryBp: 0, exitBp: 0 },
  ];

  for (const c of CASES) {
    const ctx = await run(sample, { source: plan(c) });
    const i = sample.length - 1;
    const g = (k) => ser(ctx, k)[i];
    const t = truth(c, sample[i].close, g('t_patr'));
    const FIELDS = [
      ['t_entry', t.entry], ['t_stop', t.stop], ['t_riskPerUnit', t.riskPerUnit], ['t_qty', t.qty],
      ['t_riskBudget', t.budget], ['t_actRisk', t.actRisk], ['t_costStop', t.costStop],
      ['t_costLoadR', t.costLoadR], ['t_bePx', t.bePx], ['t_target', t.target],
      ['t_tgtGrossR', t.grossR], ['t_tgtNetR', t.netR],
    ];
    const wrong = FIELDS.filter(([k, want]) => !near(g(k), want));
    check(wrong.length === 0, `${c.why} — ${FIELDS.length} quantities match independent arithmetic${wrong.length ? ': ' + wrong.map(([k, w]) => `${k} got ${g(k)} want ${w}`).join('; ') : ''}`);
    check(eq(bser(ctx, 'capped')[i], t.capped ? 1 : 0), `${c.why} — cap state agrees`);
  }

  // §5: the promise. With costs on, being stopped out costs what you said you
  // would risk — the stop loss AND the round trip, not the stop loss alone.
  const withCost = await run(sample, { source: plan({ entry: 60000, stop: 58000, eq: 25000, risk: 2 }) });
  const noCost = await run(sample, { source: plan({ entry: 60000, stop: 58000, eq: 25000, risk: 2, cost: false }) });
  const qc = fin(ser(withCost, 't_qty')).at(-1), qn = fin(ser(noCost, 't_qty')).at(-1);
  check(qc < qn, `including costs makes the position SMALLER (${qc.toFixed(6)} vs ${qn.toFixed(6)}), which is the whole point`);
  const realisedLoss = qc * (2000 + 60000 * 0.0005 + 58000 * 0.0005);
  check(Math.abs(realisedLoss - 500) < 1e-6, `total loss at the stop equals the 500 budgeted (${realisedLoss.toFixed(6)})`);
  const naiveLoss = qn * (2000 + 60000 * 0.0005 + 58000 * 0.0005);
  check(naiveLoss > 500, `...whereas sizing without costs would have lost ${naiveLoss.toFixed(2)} against the same 500 budget`);
  check(near(fin(ser(noCost, 't_riskPerUnit')).at(-1), 2000), 'with costs off, risk per unit IS the gross stop distance — v1.0 behaviour exactly');

  // §7: break-even is where the position has paid for itself, verified by
  // simulating the exit rather than by re-reading the formula.
  const be = fin(ser(withCost, 't_bePx')).at(-1);
  const pnlAtBe = qc * (be - 60000) - qc * 60000 * 0.0005 - qc * be * 0.0005;
  check(Math.abs(pnlAtBe) < 1e-6, `exiting at break-even nets exactly zero (${pnlAtBe.toExponential(2)})`);
  const beShort = fin(ser(await run(sample, { source: plan({ dir: 'Short', entry: 60000, stop: 62000, eq: 25000, risk: 2 }) }), 't_bePx')).at(-1);
  check(beShort < 60000 && be > 60000, `break-even sits beyond entry in the direction of the trade (long ${be.toFixed(2)}, short ${beShort.toFixed(2)})`);

  // §8: net R at the target, verified the same way.
  const tg = await run(sample, { source: plan({ entry: 60000, stop: 58000, target: 65000, eq: 25000, risk: 2 }) });
  const q = fin(ser(tg, 't_qty')).at(-1);
  const netR = fin(ser(tg, 't_tgtNetR')).at(-1), grossR = fin(ser(tg, 't_tgtGrossR')).at(-1);
  const netMoney = q * 5000 - q * 60000 * 0.0005 - q * 65000 * 0.0005;
  check(Math.abs(netR - netMoney / (q * 2000)) < 1e-9, `net R equals simulated net money divided by one R (${netR.toFixed(4)})`);
  check(grossR > netR, `costs make the target worth less than its gross R (${grossR.toFixed(2)} gross, ${netR.toFixed(2)} net) — the panel does not pretend otherwise`);
  check(Math.abs(grossR - 2.5) < 1e-9, 'a 65,000 target on a 2,000 stop is exactly 2.5R gross');

  // ONE DEFINITION OF R. Distance-to-stop must sit exactly one R beyond live R —
  // the DIFFERENCE is 1.00 on every bar, not the sum —
  // which is only true if both use the same unit.
  const liveCtx = await run(sample, { source: plan({ entry: 60000, stop: 58000, eq: 25000, risk: 2, stage: 'Active' }) });
  const lr = ser(liveCtx, 't_liveR'), ts = ser(liveCtx, 't_toStopR');
  let rBad = 0, rN = 0;
  for (let i = 0; i < lr.length; i++) {
    if (!Number.isFinite(lr[i]) || !Number.isFinite(ts[i])) continue;
    rN += 1;
    // Above entry for a long: liveR + toStopR = 1. Below the stop it flips sign,
    // so the identity is |liveR - (-1)| = toStopR in general.
    if (Math.abs((lr[i] + 1) - ts[i]) > 1e-9) rBad += 1;
  }
  check(rN > 0 && rBad === 0, `live R and distance-to-stop use one definition of R on all ${rN} bars`);

  // §11: live P&L, gross and net, against simulation.
  const i = sample.length - 1, px = sample[i].close;
  const qL = ser(liveCtx, 't_qty')[i];
  check(near(ser(liveCtx, 't_pnlGross')[i], qL * (px - 60000)), 'unrealised gross P&L is quantity times the move');
  check(near(ser(liveCtx, 't_pnlNet')[i], qL * (px - 60000) - qL * (60000 * 0.0005 + px * 0.0005)),
    'estimated net P&L subtracts the round trip at the CURRENT price, not at the stop');

  // A stop or target on the wrong side is voided, never silently flipped.
  const v1 = await run(sample, { source: plan({ dir: 'Long', entry: 60000, stop: 61000 }) });
  check(bser(v1, 'planOK').every((v) => v !== 1), 'a long with its stop above entry is voided, not flipped');
  const v2 = await run(sample, { source: plan({ dir: 'Short', entry: 60000, stop: 59000 }) });
  check(bser(v2, 'planOK').every((v) => v !== 1), 'a short with its stop below entry is voided, not flipped');
  check(fin(ser(v1, 't_qty')).length === 0, 'a voided plan produces no size at all');
  const v3 = await run(sample, { source: plan({ dir: 'Long', entry: 60000, stop: 58000, target: 59000 }) });
  check(fin(ser(v3, 't_tgtGrossR')).length === 0, 'a target on the wrong side is withheld, not flipped');
  check(fin(ser(v3, 't_qty')).length > 0, '...while the rest of the plan still sizes — a bad target is not a bad stop');

  // §24: tick rounding, exercised by substituting a tick the offline runtime
  // does not supply.
  const tick = await run(sample.slice(-60), { source: symOverride(plan({ entry: 60000.37, stop: 58000.11 }), 'mtick', '0.5') });
  const tbl = readTable(tick).join('\n');
  check(/60000\.50/.test(tbl) && /58000\.00/.test(tbl), `levels are snapped to a 0.5 tick before they are printed`);
}

// ---------------------------------------------------------------------------
// §12 PLAN ALERTS. Observed through the fired/suppressed counters rather than
// through the runtime's alert plumbing, because what needs proving is the
// DUPLICATE GUARD, and a counter is a direct measurement of it.
export async function alertChecks() {
  section('§12 PLAN ALERTS — fire once per level, and only for the current stage');

  const sample = rows.slice(-400);
  // A level in the middle of the sample's range, so it is crossed many times.
  const mid = (Math.min(...sample.map((r) => r.low)) + Math.max(...sample.map((r) => r.high))) / 2;
  const lvl = Math.round(mid);
  const base = { entry: lvl, stop: lvl * 0.98, eq: 25000, risk: 1 };

  const off = await run(sample, { source: plan({ ...base }) });
  check(ser(off, 't_alFire').at(-1) === 0, 'with plan alerts off, nothing fires');

  const on = await run(sample, { source: plan({ ...base, alerts: true }) });
  const fired = ser(on, 't_alFire').at(-1), sup = ser(on, 't_alSup').at(-1);
  check(fired >= 1, `PLANNING fires on the entry touch (${fired} fired)`);
  check(fired === 1, 'exactly once — the level did not move, so re-touching it is a duplicate');
  check(sup > 0, `and every later touch of the same unmoved level is suppressed (${sup} suppressed)`);

  // ACTIVE watches the exits instead. Firing entry alerts on a position you are
  // already in would be noise; firing stop alerts on a trade you have not
  // entered would be a lie.
  const act = await run(sample, { source: plan({ ...base, alerts: true, stage: 'Active' }) });
  check(ser(act, 't_alFire').at(-1) >= 1, 'ACTIVE fires on stop or target touches');

  // The R ladder is opt-in, because three more levels is three times the noise.
  const withR = await run(sample, { source: plan({ ...base, alerts: true, stage: 'Active', alertR: true }) });
  check(ser(withR, 't_alFire').at(-1) >= ser(act, 't_alFire').at(-1),
    `opting into 1R/2R/3R can only add alerts (${ser(act, 't_alFire').at(-1)} → ${ser(withR, 't_alFire').at(-1)})`);

  // MESSAGES, AS DELIVERED — not as spelled in the source.
  // The offline runtime drops every alert except on the last bar unless the
  // alert mode is overridden, which is why a suite can assert "the string exists
  // in main.pine" and prove nothing about what a user would actually receive.
  // These read the emitted messages instead.
  const cap = await run(sample, { source: plan({ ...base, alerts: true }), alertMode: 'historical' });
  const planMsgs = (cap.alerts ?? []).map((a) => a.message).filter((m) => m.startsWith('BTC Trading Assistant · '));
  check(planMsgs.length > 0, `plan alerts are actually delivered, not merely spelled (${planMsgs.length} captured)`);
  const first = planMsgs[0] ?? '';
  check(/^BTC Trading Assistant · PLANNING · LONG · Entry touched at [\d,.]+$/.test(first),
    `the delivered message names product, stage, direction, level and price — "${first}"`);

  const capActive = await run(sample, { source: plan({ ...base, alerts: true, stage: 'Active' }), alertMode: 'historical' });
  const activeMsgs = (capActive.alerts ?? []).map((a) => a.message).filter((m) => m.startsWith('BTC Trading Assistant · '));
  check(activeMsgs.some((m) => m.includes('ACTIVE ·')), 'ACTIVE messages say ACTIVE, so an alert cannot be read as the wrong stage');
  check(!activeMsgs.some((m) => m.includes('Entry touched')), 'ACTIVE never delivers an entry alert for a position already taken');
  check(!planMsgs.some((m) => m.includes('Stop touched')), '...and PLANNING never delivers a stop alert for a trade not yet entered');
  const ladderMsgs = activeMsgs.concat((await run(sample, { source: plan({ ...base, alerts: true, stage: 'Active', alertR: true }), alertMode: 'historical' })).alerts?.map((a) => a.message) ?? []);
  check(ladderMsgs.some((m) => /(Stop|Target|1R|2R|3R) touched at/.test(m)), 'exit alerts name which level was touched');
  check(/barstate\.isconfirmed and not na\(lvl\)/.test(RAW),
    'touches are evaluated on confirmed bars, so an intrabar wick that closes back inside does not fire');

  // The 4H context alerts from v1.0 are untouched.
  check(/alert\(txt, alert\.freq_once_per_bar_close\)/.test(RAW), 'the confirmed 4H context alerts are unchanged');
}

// ---------------------------------------------------------------------------
// §23 DRAWING LIFECYCLE. The failure this guards against does not show up as a
// wrong number: the script quietly reaches max_lines_count, Pine drops the
// OLDEST objects, and the plan the user is looking at disappears while the
// chart fills with stale ones. What proves it cannot happen is structural — an
// allocation that only runs when the handle is na.
export async function drawingChecks() {
  section('§23 DRAWINGS — created once, moved thereafter');

  const news = (RAW.match(/line\.new\(/g) ?? []).length;
  const boxNews = (RAW.match(/box\.new\(/g) ?? []).length;
  check(news === 1, `exactly ${news} line.new() call site in the whole script`);
  check(boxNews === 1, `exactly ${boxNews} box.new() call site in the whole script`);
  check(/if na\(l\)\n\s+l := line\.new\(/.test(RAW), 'a line is allocated only when its handle is still na');
  check(/if na\(b\)\n\s+b := box\.new\(/.test(RAW), 'a box is allocated only when its handle is still na');
  const vars = (RAW.match(/^var (line|box)\s+\w+\s+= na$/gm) ?? []).length;
  check(vars >= 9, `${vars} drawing handles are persistent vars, so the object count is fixed for the life of the script`);
  check(/^if barstate\.islast\n/m.test(RAW), 'drawings are updated on the last bar only, not rebuilt every bar');
  check(/line\.set_xy1\(l, x1, /.test(RAW) && /box\.set_lefttop\(b, x1, /.test(RAW), 'existing objects are moved rather than replaced');
  // A hidden level must not change the object count, or the ceiling becomes a
  // function of the user's settings.
  check(/CLEAR = color\.new\(color\.gray, 100\)/.test(RAW) && /na\(p\) \? CLEAR : col/.test(RAW),
    'a level that should not be shown is drawn transparent, so hiding one never changes the object count');
  const maxLines = +(RAW.match(/max_lines_count\s*=\s*(\d+)/) ?? [])[1];
  const maxBoxes = +(RAW.match(/max_boxes_count\s*=\s*(\d+)/) ?? [])[1];
  check(maxLines >= 7 && maxLines <= 50, `max_lines_count ${maxLines} comfortably exceeds the 7 lines actually used`);
  check(maxBoxes >= 2 && maxBoxes <= 20, `max_boxes_count ${maxBoxes} comfortably exceeds the 2 boxes actually used`);
}
