// INSTRUMENTED TEST BUILD — the offline suite's observation layer, kept out of
// the shipped script.
//
// PineTS can only observe a value that is plotted. Until v1.1 that meant the
// production main.pine carried 57 `plot(..., display = display.none)` test
// hooks, which took it to 63 of Pine's 64 plot outputs — a production file one
// plot away from refusing to compile, entirely because of its tests.
//
// So the hooks moved here. This module appends them to the real source at test
// time. Nothing is rewritten and nothing is stubbed: every expression below is
// evaluated against the same globals the panel reads, on the same run, so a
// hook cannot drift from the thing it claims to observe.
//
// The instrumented build deliberately exceeds 64 plots. It is never pasted into
// TradingView — the production file is, and tests/main.test.mjs asserts its
// count against the real ceiling. Checking the ceiling on a file that is not
// the shipped one would be checking nothing.

// Scalars, plotted one per hook. Everything DERIVABLE from another hook is
// absent by design: the suite recomputes notional, risk, 1R, 3R and required
// leverage from entry, stop and quantity rather than trusting a second plot of
// the same arithmetic, which is a stronger test than plotting both.
const SCALARS = [
  // --- market context ---
  ['rC', 't_refClose'], ['oiN24', 't_oiN24'], ['atr14', 't_atr14'], ['volPct', 't_volPct'],
  ['trendDist', 't_trendDist'], ['dMom12w', 't_mom12w'], ['px24', 't_px24'],
  ['oiChg4h', 't_oiChg4'], ['oiChg24h', 't_oiChg24'],
  ['oiZ4', 't_oiZ4'], ['oiZ24', 't_oiZ24'], ['oiZ24s', 't_oiZ24s'], ['oiP4', 't_oiP4'], ['oiP24', 't_oiP24'],
  ['premium', 't_premium'], ['premZ', 't_premZ'], ['premP', 't_premP'],
  ['partRaw', 't_partRaw'], ['partZ', 't_partZ'], ['partP', 't_partP'],
  ['rvolSpot', 't_rvolSpot'], ['rvolSpotZ', 't_rvolSpotZ'], ['rvolSpotP', 't_rvolSpotP'],
  ['rvolPerp', 't_rvolPerp'], ['rvolPerpZ', 't_rvolPerpZ'], ['rvolPerpP', 't_rvolPerpP'],
  ['fundRaw', 't_fundRaw'], ['fundZ', 't_fundZ'], ['fundP', 't_fundP'],
  ['etf5d', 't_etf5d'], ['etfZ', 't_etfZ'], ['etfP', 't_etfP'],
  ['liqLZ', 't_liqLZ'], ['liqLP', 't_liqLP'], ['liqSZ', 't_liqSZ'], ['liqSP', 't_liqSP'],
  ['liqBal', 't_liqBal'], ['liqBZ', 't_liqBZ'],
  ['trSt', 't_trSt'], ['oi24St', 't_oi24St'], ['trendScore', 't_trendScore'], ['rvol30', 't_rvol30'],
  ['anomCount', 't_anomCount'], ['evCount', 't_evCount'], ['rowsUsed', 't_rowsUsed'],
  ['ctxAgeMs', 't_ctxAge'],
  // --- the plan: inputs to the arithmetic, and the results costs introduced ---
  ['entryPx', 't_entry'], ['stopPx', 't_stop'], ['qty', 't_qty'], ['patr', 't_patr'],
  ['tgtPx', 't_target'], ['riskPerUnit', 't_riskPerUnit'], ['riskBudget', 't_riskBudget'],
  ['actRisk', 't_actRisk'], ['costStop', 't_costStop'], ['costLoadR', 't_costLoadR'],
  ['bePx', 't_bePx'], ['beBp', 't_beBp'], ['tgtGrossR', 't_tgtGrossR'], ['tgtNetR', 't_tgtNetR'],
  ['liveR', 't_liveR'], ['livePnlGross', 't_pnlGross'], ['livePnlNet', 't_pnlNet'],
  ['toStopR', 't_toStopR'], ['toTargetR', 't_toTargetR'], ['toEntryR', 't_toEntryR'],
  ['minQty', 't_minQty'],
  // --- plan drawing geometry ---
  // Box coordinates are plotted rather than read back off the drawing objects
  // because the offline runtime does not expose them. They are computed in chart
  // scope in main.pine for exactly this reason: geometry no test can see is
  // geometry that goes wrong in a screenshot instead of in a test run.
  ['boxL', 't_boxL'], ['boxR', 't_boxR'], ['lineL', 't_lineL'],
  ['rskTop', 't_rskTop'], ['rskBot', 't_rskBot'],
  ['rwdTop', 't_rwdTop'], ['rwdBot', 't_rwdBot'],
];

// Discrete state, packed. Not to save plots — the instrumented build has no
// budget to save — but because the decoders in harness.mjs are what the
// migration differential compares against the frozen v1.0 baselines, which
// carry the same packs. Changing the encoding would silently invalidate the
// comparison.
//
// Bit order is fixed and mirrored in harness.mjs BOOL_BITS.
const PACKS = `
_bp = (tfOK ? 1 : 0) + (oiObs ? 2 : 0) + (partOK ? 4 : 0) + (oiOK ? 8 : 0) + (oiLooksNotional ? 16 : 0) + (changed ? 32 : 0) + (newCtx ? 64 : 0) + (planOK ? 128 : 0) + (capped ? 256 : 0) + (planActive ? 512 : 0) + (costOn ? 1024 : 0) + (stdChart ? 2048 : 0) + (qtyTooSmall ? 4096 : 0) + (linearOK ? 8192 : 0) + (planFatal ? 16384 : 0) + (needStop ? 32768 : 0) + (needFill ? 65536 : 0)
_sp = refStat + 5 * (spotStat + 5 * (oiStat + 5 * (dailyStat + 5 * (fdStat + 5 * (etStat + 5 * (lLStat + 5 * lSStat))))))
_dp = (oi24Dir + 1) + 3 * ((oi4Dir + 1) + 3 * ((pmDir + 1) + 3 * ((fdDir + 1) + 3 * ((etDir + 1) + 3 * ((ptDir + 1) + 3 * ((rsDir + 1) + 3 * ((rpDir + 1) + 3 * ((lqBDir + 1) + 3 * ((mechPx + 1) + 3 * (mechOi + 1))))))))))
_lp = oi24Lvl + 3 * (oi4Lvl + 3 * (pmLvl + 3 * (fdLvl + 3 * (etLvl + 3 * (ptLvl + 3 * (rsLvl + 3 * (rpLvl + 3 * (lqLLvl + 3 * lqSLvl))))))))
plot(_bp, "t_boolPack", display = display.none)
plot(_sp, "t_statPack", display = display.none)
plot(_dp, "t_dirPack",  display = display.none)
plot(_lp, "t_lvlPack",  display = display.none)
plot(array.get(evStat, 0), "t_evPush", display = display.none)
plot(array.get(evStat, 1), "t_evDup",  display = display.none)
plot(array.get(alStat, 0), "t_alFire", display = display.none)
plot(array.get(alStat, 1), "t_alSup",  display = display.none)
`;

const HEADER = `
// ===================== INSTRUMENTATION (tests/build-instrumented.mjs) ========
// Appended at test time only. Not present in the shipped main.pine.
`;

export function instrument(src) {
  const lines = SCALARS.map(([expr, name]) => `plot(${expr}, "${name}", display = display.none)`);
  return src + HEADER + lines.join('\n') + '\n' + PACKS;
}

// Guard against silent rot: every hook must reference a name that actually
// exists in the source. A renamed variable would otherwise turn its hook into a
// Pine compile error offline, or — worse in a runtime with no type checking —
// into an all-na series that every test then passes against vacuously.
export function hookNames() {
  return [...SCALARS.map(([, n]) => n), 't_boolPack', 't_statPack', 't_dirPack', 't_lvlPack',
    't_evPush', 't_evDup', 't_alFire', 't_alSup'];
}

export function missingSymbols(src) {
  const body = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  return SCALARS
    .map(([expr]) => expr)
    .filter((e) => !new RegExp(`(^|[^\\w.])${e}\\b`, 'm').test(body));
}
