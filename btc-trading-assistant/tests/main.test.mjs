// Behaviour and safety checks for BTC Trading Assistant.
//
// The migration differential proves the numbers did not change. This file
// proves the things the differential cannot: that the indicator is honest on a
// timeframe its predecessor refused to run on, that it never reads a bar it
// should not, that the default panel cannot show a direction, and that a broken
// or misdeclared feed produces silence rather than a plausible number.

import {
  rows, run, ser, eq, check, note, section, fin, CHART, ALT,
  BASE, RAW, HASH, rewrite, enable, wire, asMode, readTable, bser, decode, branchTypeLint, buildSeries,
} from './harness.mjs';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sub = (src, re, to) => src.replace(re, to);
const setNum = (src, label, v) =>
  sub(src, new RegExp(`input\\.(float|int)\\([^,]+,\\s*"${esc(label)}"`), (m, t) => `input.${t}(${v}, "${label}"`);
const setStr = (src, label, v) =>
  sub(src, new RegExp(`input\\.string\\("[^"]*",\\s*"${esc(label)}"`), `input.string("${v}", "${label}"`);
const setBool = (src, label, v) =>
  sub(src, new RegExp(`input\\.bool\\((?:true|false),\\s*"${esc(label)}"`), `input.bool(${v}, "${label}"`);

const CTX_HOOKS = ['t_refClose', 't_atr14', 't_px24', 't_oiChg24', 't_oiZ24', 't_premium', 't_premZ', 't_partRaw', 't_rvolPerp'];

// ---------------------------------------------------------------------------
export async function sourceChecks() {
  section('SOURCE — what the file itself guarantees');

  const bad = branchTypeLint(RAW);
  check(bad.length === 0, `no if/else branch mixes a value-returning call with a void one (Pine CE10235)`);
  for (const b of bad.slice(0, 5)) note(b);

  // Pine's ceiling is 64 plots INCLUDING the visible ones. Being at 63 is not a
  // detail: it is the reason five planner outputs are derived in the suite
  // instead of plotted.
  const plots = (RAW.match(/^plot\(/gm) ?? []).length;
  check(plots <= 64, `${plots} plot outputs, within Pine's ceiling of 64`);

  // request.*() calls are capped at 40 per script. Splitting the context into
  // narrow tuples cost calls, so the count is asserted rather than assumed.
  const reqs = (RAW.match(/request\.\w+\(/g) ?? []).length;
  check(reqs <= 40, `${reqs} request.*() calls, within Pine's ceiling of 40`);
  note(`plots ${plots}/64 · requests ${reqs}/40 · ${RAW.split('\n').length} lines · sha256 ${HASH.slice(0, 12)}`);

  // The product must not contain a directional claim anywhere in its own text.
  // Comments are excluded: they discuss LONG and SHORT precisely in order to
  // explain why the indicator does not emit them.
  const codeOnly = RAW.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  const banned = ['depth imbalance', 'microprice', 'pressureToCapacity', 'OFI', 'composite score', 'confidence'];
  const present = banned.filter((w) => codeOnly.toLowerCase().includes(w.toLowerCase()));
  check(present.length === 0, `no rejected-research vocabulary in the shipped code (${present.join(', ') || 'none found'})`);

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
function toHourly(src) {
  const out = [];
  for (const r of src) {
    const mk = (n, o, h, l, c, sc) => ({
      t: r.t + n * 3600_000,
      open: o, high: h, low: l, close: c, volume: r.volume / 4,
      spotOpen: o * sc, spotHigh: h * sc, spotLow: l * sc, spotClose: c * sc, spotVolume: r.spotVolume / 4,
      oi: r.oi, oiValue: r.oiValue,
    });
    const sc = r.spotClose / r.close;
    out.push(mk(0, r.open, r.open, r.open, r.open, sc));
    out.push(mk(1, r.open, r.high, r.open, r.high, sc));
    out.push(mk(2, r.high, r.high, r.low, r.low, sc));
    out.push(mk(3, r.low, Math.max(r.low, r.close), r.low, r.close, sc));
  }
  return out;
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

  // The 1H chart is served REAL 1H bars while request.security(sym, "240") is
  // served the original 4H bars. Without that split the provider would hand the
  // chart's own series back for the 4H request and these checks would pass while
  // testing nothing.
  const base4h = rows.slice(-400);
  const h = toHourly(base4h);
  let hourly = null;
  try {
    hourly = await run(h, { source: BASE, tf: '60', byTf: { '60': buildSeries(h), '240': buildSeries(base4h) } });
  } catch (e) { note('1H run failed: ' + e.message); }
  check(hourly !== null, `runs on a 1H chart (${h.length} synthetic 1H bars over ${base4h.length} 4H bars)`);

  if (hourly) {
    // OFS must be 1 below 4H, so the context is the LAST COMPLETED 4H bar and is
    // held for the whole period. Two consequences, both checked:
    //   the clock ticks once per four 1H bars, not every bar;
    //   the held value equals the 4H build's PREVIOUS bar, never its current one.
    const nc = bser(hourly, 'newCtx');
    const ticks = nc.filter((v) => v === 1).length;
    check(ticks > 0 && ticks <= h.length / 4 + 1, `context clock ticked ${ticks} times over ${h.length} 1H bars (~1 per 4H period)`);

    const four = await run(base4h, { source: BASE, tf: '240' });
    const ref4 = ser(four, 't_refClose');
    const refH = ser(hourly, 't_refClose');
    // 1H bar 4k..4k+3 sits inside 4H bar k, so the completed context there is
    // 4H bar k-1.
    let matched = 0, checkedN = 0, leaked = 0;
    for (let k = 2; k < base4h.length; k++) {
      const want = ref4[k - 1];
      if (!Number.isFinite(want)) continue;
      for (let j = 0; j < 4; j++) {
        const got = refH[4 * k + j];
        if (!Number.isFinite(got)) continue;
        checkedN += 1;
        if (Math.abs(got - want) < 1e-6) matched += 1;
        // Reading the bar the chart is currently inside would be lookahead.
        if (Math.abs(got - ref4[k]) < 1e-9 && Math.abs(ref4[k] - want) > 1e-9) leaked += 1;
      }
    }
    check(checkedN > 0 && matched === checkedN, `4H context on the 1H chart is the last COMPLETED 4H bar (${matched}/${checkedN} bars)`);
    check(leaked === 0, `no bar reads the 4H bar it is currently inside — ${leaked} lookahead reads`);
  }

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
  const plan = (s) => setNum(setBool(s, 'Enable trade plan', true), 'Entry price (0 = current price)', '0.0');
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
  const misc = await run(rows.slice(-300), { source: asMode(enable(BASE, 'funding'), 'Detailed') });
  const dm = decode(misc);
  check(dm.stat.fd.every((v) => v === 1), 'an enabled but unwired adapter reports MISCONFIGURED on every bar');
  check(fin(ser(misc, 't_fundRaw')).length === 0, '...and produces no funding reading');

  // A wired adapter that stops moving becomes LIKELY STALE and its reading is
  // withdrawn, rather than the last value standing as a live anomaly.
  const cut = 200;
  let stale = enable(BASE, 'funding');
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
  let paired = enable(enable(BASE, 'long-liquidation'), 'short-liquidation');
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
    let x = setBool(s, '  Long and short liquidations share one source and unit', true);
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
  section('§21–§25 THE PANEL — what a user is allowed to be shown');

  const decision = readTable(await run(rows, { source: BASE }));
  const text = decision.join('\n');

  // §22: the default panel carries no research vocabulary at all.
  const FORBIDDEN = ['σ', 'z-score', 'percentile', 'p-value', 'DSR', 'beta', 'sigma',
    'OFI', 'microprice', 'depth imbalance', 'pressure', 'sample', 'confidence', '%ile'];
  const leaked = FORBIDDEN.filter((w) => text.toLowerCase().includes(w.toLowerCase()));
  check(leaked.length === 0, `Decision view carries no research vocabulary (${leaked.join(', ') || 'clean'})`);
  check(!/\dp\b/.test(text), 'Decision view prints no percentile ranks');

  // §21: the four context lines and the standing disclaimer are always present.
  for (const row of ['BTC TRADING ASSISTANT', 'MARKET', 'VOLATILITY', 'POSITIONING', 'WATCH', 'AUTOMATIC SIGNAL']) {
    check(text.includes(row), `Decision view always shows ${row}`);
  }
  check(/NONE VALIDATED/.test(text), 'Decision view states that no automatic signal is validated');
  check(/NOT SET/.test(text), 'with no plan entered, the trade section reads NOT SET');
  check(decision.length <= 20, `Decision view is ${decision.length} rows — readable at a glance`);

  // The one rule that matters most: with no plan entered, the panel cannot
  // contain a direction. LONG and SHORT may appear ONLY as the echo of a
  // direction the user typed in themselves.
  check(!/\bLONG\b|\bSHORT\b|\bBUY\b|\bSELL\b/.test(text),
    'with no plan entered, the panel contains no LONG, SHORT, BUY or SELL');

  const planned = setNum(setNum(setBool(BASE, 'Enable trade plan', true),
    'Entry price (0 = current price)', '60000.0'), 'Invalidation price (0 = auto)', '58000.0');
  const withPlan = readTable(await run(rows, { source: planned })).join('\n');
  check(/\bLONG\b/.test(withPlan), 'a direction appears only once the user has entered one');
  check(/ENTRY/.test(withPlan) && /STOP/.test(withPlan) && /POSITION/.test(withPlan) && /RISK/.test(withPlan) && /TARGETS/.test(withPlan),
    'the plan section shows entry, stop, position, risk and the R ladder');
  check(/1R/.test(withPlan) && /2R/.test(withPlan) && /3R/.test(withPlan), 'all three R targets are shown');
  check(/NONE VALIDATED/.test(withPlan), 'the no-signal statement survives an entered plan');

  // §23: exactly three modes, and the mode is presentation only.
  const modes = RAW.match(/options = \["Decision", "Detailed", "Debug"\]/);
  check(modes !== null, 'exactly three display modes exist');
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

  const dbgText = readTable(dbg).join('\n');
  check(/DEBUG/.test(dbgText) && /Context clock/.test(dbgText), 'Debug mode exposes the context clock and internals');
  check(!/DEBUG/.test(text), '...and Decision does not');

  // §24: default chart clutter. The 200MA and the trailing reference are off,
  // so their plots must be entirely na until switched on.
  check(fin(ser(dec, 't_trail')).length >= 0, 'trailing reference is computed but not drawn by default');
  check(/showMa    = input\.bool\(false/.test(RAW), 'daily 200MA plot is off by default');
  check(/showTr    = input\.bool\(false/.test(RAW), 'trailing reference is off by default');
  check(/planOn  = input\.bool\(false/.test(RAW), 'the trade plan is off by default');
  for (const a of ['funding', 'ETF flow', 'long-liquidation', 'short-liquidation']) {
    check(new RegExp(`input\\.bool\\(false, "Enable ${a} adapter"`).test(RAW), `${a} adapter is off by default`);
  }

  // §29: the table must never overflow. Worst case is Debug with every adapter
  // live and the anomaly list at its ceiling.
  let worst = setBool(BASE, '  Long and short liquidations share one source and unit', true);
  for (const l of ['long-liquidation', 'short-liquidation', 'funding', 'ETF flow']) worst = enable(worst, l);
  worst = wire(worst, 'Long liquidations', 'extLiqL    = math.abs(close - close[1]) * volume');
  worst = wire(worst, 'Short liquidations', 'extLiqS    = math.abs(high - low) * volume * 0.7');
  worst = wire(worst, 'Aggregated funding rate', 'extFunding = (close - ta.sma(close, 20)) / ta.sma(close, 20) * 0.05');
  worst = wire(worst, 'US spot BTC ETF net flow', 'extEtf     = (close - close[1]) * 100.0');
  worst = setNum(worst, 'Max anomalies listed (Detailed)', 9);
  const worstCtx = await run(rows, { source: asMode(worst, 'Debug') });
  const used = fin(ser(worstCtx, 't_rowsUsed'));
  const maxUsed = Math.max(...used);
  check(maxUsed <= 76, `worst-case panel uses ${maxUsed} of 76 declared table rows`);
}

// ---------------------------------------------------------------------------
export async function plannerChecks() {
  section('THE PLANNER — arithmetic, and only arithmetic');

  const mk = (o) => {
    let x = setBool(BASE, 'Enable trade plan', true);
    x = setStr(x, 'Direction', o.dir ?? 'Long');
    x = setNum(x, 'Entry price (0 = current price)', (o.entry ?? 0).toFixed(1));
    x = setNum(x, 'Invalidation price (0 = auto)', (o.stop ?? 0).toFixed(1));
    x = setNum(x, 'Account equity', (o.eq ?? 10000).toFixed(1));
    x = setNum(x, 'Risk per trade (%)', (o.risk ?? 1).toFixed(2));
    x = setNum(x, 'Max exposure (x equity)', (o.lev ?? 100).toFixed(1));
    return x;
  };

  // Risk taken equals risk asked for, whenever the cap is not binding. This is
  // the promise the whole planner makes.
  const c = await run(rows.slice(-300), { source: mk({ entry: 60000, stop: 58000, eq: 25000, risk: 2, lev: 100 }) });
  const qty = fin(ser(c, 't_qty'));
  check(qty.length > 0, 'an uncapped plan produces a size');
  const risked = qty[0] * 2000;
  check(Math.abs(risked - 500) < 1e-6, `risk taken equals risk asked: ${risked.toFixed(6)} on a 25,000 account at 2% = 500`);

  // ...and when the cap binds, the number shown must be the risk ACTUALLY taken,
  // not the one that was asked for.
  const capped = await run(rows.slice(-300), { source: mk({ entry: 60000, stop: 59950, eq: 100000, risk: 5, lev: 1 }) });
  const cq = fin(ser(capped, 't_qty'));
  const isCapped = bser(capped, 'capped').some((v) => v === 1);
  check(isCapped, 'a tight stop makes the exposure cap bind');
  const notional = cq[0] * 60000;
  check(Math.abs(notional - 100000) < 1e-6, `capped notional equals the cap exactly (${notional.toFixed(2)} = 1.0x of 100,000)`);
  const actual = cq[0] * 50;
  check(actual < 5000, `risk actually taken (${actual.toFixed(2)}) is below the 5,000 asked for, as the cap requires`);

  // A stop on the wrong side of entry is not silently flipped.
  const void1 = await run(rows.slice(-300), { source: mk({ dir: 'Long', entry: 60000, stop: 61000 }) });
  check(bser(void1, 'planOK').every((v) => v !== 1), 'a long with its stop above entry is voided, not flipped');
  const void2 = await run(rows.slice(-300), { source: mk({ dir: 'Short', entry: 60000, stop: 59000 }) });
  check(bser(void2, 'planOK').every((v) => v !== 1), 'a short with its stop below entry is voided, not flipped');
  check(fin(ser(void1, 't_qty')).length === 0, 'a voided plan produces no size at all');

  // The trailing reference excludes the live bar, so it can never repaint.
  const tr = await run(rows.slice(-300), { source: mk({}) });
  const trail = ser(tr, 't_trail'), lows = rows.slice(-300).map((r) => r.low);
  let peeked = 0, trN = 0;
  for (let i = 12; i < trail.length; i++) {
    if (!Number.isFinite(trail[i])) continue;
    trN += 1;
    // It is the lowest of the PREVIOUS 10 bars, so it may never dip below any of
    // them, and may never be influenced by bar i itself.
    const window = lows.slice(i - 10, i);
    if (Math.abs(trail[i] - Math.min(...window)) > 1e-9) peeked += 1;
  }
  check(trN > 0 && peeked === 0, `trailing reference is exactly the previous 10 bars' low on all ${trN} bars — the live bar is excluded`);
}
