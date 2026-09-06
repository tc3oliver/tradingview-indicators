// Phase 4 + 5 — run the entire pre-registered grid, apply the ten gates.
//
// This file implements PRE-REGISTRATION.md sections 5 and 6 and nothing else.
// It contains no configuration that is not in that document, and it writes
// every configuration it evaluates into the trial registry before printing a
// single verdict, so the DSR denominator can never be smaller than the search.
//
// Usage: node phase45.mjs            (writes trials.json, results.json, RESULTS.md)

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import {
  GRID, ENTRIES, BIAS, simulate, metrics, matchedBaseline, pfExBest, profitFactor,
  SPLITS, BARS_PER_YEAR,
} from './engine.mjs';

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const stdev = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };

// ---------------------------------------------------------------------------
// DSR machinery — Bailey & López de Prado (2014), same formulas as
// ../../btc-4h-regime-engine/research/dsr.mjs. Per-bar Sharpes throughout.
// ---------------------------------------------------------------------------
const EULER_G = 0.5772156649015329;
function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}
const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
function normInv(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 0.97575) return -normInv(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
const moment = (a, k) => { const m = mean(a), s = stdev(a); return s ? mean(a.map((x) => ((x - m) / s) ** k)) : 0; };

function dsr(perBarSharpe, T, g3, g4, poolPerBarSharpes) {
  const N = poolPerBarSharpes.length;
  if (N < 2 || T < 2) return { dsr: 0, sr0: 0, n: N };
  const vSR = stdev(poolPerBarSharpes);
  const sr0 = vSR * ((1 - EULER_G) * normInv(1 - 1 / N) + EULER_G * normInv(1 - 1 / (N * Math.E)));
  const denom = Math.sqrt(Math.max(1e-12, 1 - g3 * perBarSharpe + ((g4 - 1) / 4) * perBarSharpe * perBarSharpe));
  return { dsr: normCdf(((perBarSharpe - sr0) * Math.sqrt(T - 1)) / denom), sr0, n: N };
}

// ---------------------------------------------------------------------------
// Run the grid
// ---------------------------------------------------------------------------
const cfgName = (c) => `${c.bias} ${c.entry} s${c.stopATR} t${c.trailBars} ${c.dir}`;

console.log(`Running ${GRID.length} configurations x 3 splits...`);
const results = [];
for (const cfg of GRID) {
  const bySplit = {};
  for (const split of ['development', 'validation', 'test']) {
    const sim = simulate(cfg, split);
    bySplit[split] = { m: metrics(sim), trades: sim.trades };
  }
  results.push({ cfg, name: cfgName(cfg), bySplit });
}

// ---------------------------------------------------------------------------
// Trial registry FIRST — before any gate is evaluated or any table printed.
// Every Sharpe computed above is now a permanent trial.
// ---------------------------------------------------------------------------
const REG = new URL('../trials.json', import.meta.url);
const priorReg = JSON.parse(readFileSync(new URL('../../btc-4h-regime-engine/trials.json', import.meta.url), 'utf8'));
const trials = results.flatMap((r) => ['development', 'validation', 'test'].map((split) => ({
  hypothesis: 'TP1',
  config: r.name,
  split,
  sharpe: r.bySplit[split].m.sharpe,
  maxDD: r.bySplit[split].m.maxDD,
  trades: r.bySplit[split].m.trades,
  expR: r.bySplit[split].m.expR,
  pf: Number.isFinite(r.bySplit[split].m.pf) ? r.bySplit[split].m.pf : null,
  engine: 'trade-planner engine v1',
  selectionSet: split === 'validation',
})));
writeFileSync(REG, JSON.stringify(trials, null, 1));
console.log(`Registry: ${trials.length} trials this study + ${priorReg.length} prior (regime-engine) = ${trials.length + priorReg.length}`);

// ---------------------------------------------------------------------------
// Gates. "Combined" = union of validation and test trades (no trade spans a
// split by construction) and the concatenated bar-return series.
// ---------------------------------------------------------------------------
SPLITS.valtest = [SPLITS.validation[0], Infinity];

const ann2bar = (s) => s / Math.sqrt(BARS_PER_YEAR);
const selPool = trials.filter((t) => t.selectionSet).map((t) => ann2bar(t.sharpe));
const allPool = [...trials, ...priorReg].map((t) => ann2bar(t.sharpe));

const entrySibling = { pullback20: 'pullback50', pullback50: 'pullback20', breakout20: 'breakout40', breakout40: 'breakout20' };
const combinedExpR = new Map();
for (const r of results) {
  const rs = [...r.bySplit.validation.trades, ...r.bySplit.test.trades].map((t) => t.r);
  combinedExpR.set(r.name, mean(rs));
}

for (const r of results) {
  const { cfg } = r;
  const val = r.bySplit.validation, tst = r.bySplit.test;
  const comb = [...val.trades, ...tst.trades];
  const rs = comb.map((t) => t.r);
  const combRets = [...val.m.barRets, ...tst.m.barRets];

  // combined-period stats
  let eq = 1, peak = 1, maxDD = 0;
  for (const x of combRets) { eq *= 1 + x; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak); }
  const years = combRets.length / BARS_PER_YEAR;
  const m = mean(combRets), sd = stdev(combRets);
  const combSharpe = sd ? (m / sd) * Math.sqrt(BARS_PER_YEAR) : 0;
  const combCagr = eq > 0 ? eq ** (1 / years) - 1 : -1;
  const combCalmar = maxDD ? combCagr / maxDD : 0;

  const byYear = {};
  for (const t of comb) byYear[t.year] = (byYear[t.year] ?? 0) + t.r;
  const bigYears = Object.entries(byYear).filter(([y]) => comb.filter((t) => t.year === +y).length >= 5);
  const posShare = bigYears.length ? bigYears.filter(([, v]) => v > 0).length / bigYears.length : 0;
  const netR = rs.reduce((s, x) => s + x, 0);
  const bestYear = bigYears.length ? Math.max(...bigYears.map(([, v]) => v)) : 0;

  const gp = rs.filter((x) => x > 0);
  const topShare = gp.length ? Math.max(...gp) / gp.reduce((s, x) => s + x, 0) : 0;

  // G7 neighbourhood: one pre-registered dimension moved to its only other value
  const neighbours = [
    cfgName({ ...cfg, entry: entrySibling[cfg.entry] }),
    cfgName({ ...cfg, stopATR: cfg.stopATR === 1.5 ? 2.0 : 1.5 }),
    cfgName({ ...cfg, trailBars: cfg.trailBars === 10 ? 20 : 10 }),
  ];
  const nbrPos = neighbours.filter((n) => (combinedExpR.get(n) ?? -1) > 0).length;

  // G10 baseline: constant same-direction weight at the model's own realised
  // average notional weight over the combined period
  const wAvg = (val.m.avgWeight * val.m.barRets.length + tst.m.avgWeight * tst.m.barRets.length) / (combRets.length || 1);
  const base = matchedBaseline(cfg.dir, 'valtest', wAvg);

  // G9 on the combined series against both honest pools
  const g3m = moment(combRets, 3), g4m = moment(combRets, 4);
  const dsrSel = dsr(ann2bar(combSharpe), combRets.length, g3m, g4m, selPool);
  const dsrAll = dsr(ann2bar(combSharpe), combRets.length, g3m, g4m, allPool);

  const gates = {
    G1: val.m.expR > 0 && tst.m.expR > 0,
    G2: val.m.pf >= 1.2 && tst.m.pf >= 1.2,
    G3: pfExBest(rs) > 1.0,
    G4: comb.length >= 40,
    G5: bigYears.length > 0 && posShare >= 0.5 && netR - bestYear > 0,
    G6: topShare < 0.25,
    G7: nbrPos >= 2,
    G8: true, // separation by construction; each direction is its own row
    G9: dsrSel.dsr >= 0.95 && dsrAll.dsr >= 0.95,
    G10: combSharpe > base.sharpe && combCalmar > base.calmar,
  };
  const failed = Object.entries(gates).filter(([, ok]) => !ok).map(([g]) => g);
  r.combined = {
    trades: comb.length, expR: mean(rs), netR, pf: profitFactor(rs), pfExBest: pfExBest(rs),
    sharpe: combSharpe, calmar: combCalmar, maxDD, byYear, topShare, nbrPos, wAvg,
    base, dsrSel: dsrSel.dsr, dsrAll: dsrAll.dsr, sr0Sel: dsrSel.sr0, sr0All: dsrAll.sr0,
  };
  r.gates = gates;
  r.verdict = !gates.G4 ? 'INSUFFICIENT' : failed.length === 0 ? 'RETROSPECTIVE PASS' : 'REJECTED';
  r.failedGates = failed;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
const fm = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const pc = (x, d = 0) => (Number.isFinite(x) ? (x * 100).toFixed(d) + '%' : '—');

const verdictCount = {};
for (const r of results) verdictCount[r.verdict] = (verdictCount[r.verdict] ?? 0) + 1;
console.log('\nVerdicts:', verdictCount);

const passes = results.filter((r) => r.verdict === 'RETROSPECTIVE PASS');
const near = results
  .filter((r) => r.verdict === 'REJECTED' && r.failedGates.length <= 3)
  .sort((a, b) => a.failedGates.length - b.failedGates.length);

let md = `# Phase 4/5 results — RETROSPECTIVE RESEARCH

Generated by \`research/phase45.mjs\`. Every number is after 0.14% round-trip
cost. Nothing here is out-of-sample; see PRE-REGISTRATION.md §0.1.

Verdict counts: ${Object.entries(verdictCount).map(([k, v]) => `**${k}: ${v}**`).join(' · ')}

## Full grid — validation | test (dev shown for context, never for selection)

| config | dev n/expR | val n | val expR | val PF | test n | test expR | test PF | comb PF-5% | verdict | failed |
|---|---|---|---|---|---|---|---|---|---|---|
`;
for (const r of results) {
  const d = r.bySplit.development.m, v = r.bySplit.validation.m, t = r.bySplit.test.m;
  md += `| ${r.name} | ${d.trades}/${fm(d.expR)} | ${v.trades} | ${fm(v.expR)} | ${fm(v.pf)} | ${t.trades} | ${fm(t.expR)} | ${fm(t.pf)} | ${fm(r.combined.pfExBest)} | ${r.verdict} | ${r.failedGates.join(' ') || '—'} |\n`;
}

md += `\n## Gate detail for every non-rejected or nearly-passing configuration\n`;
const detail = [...passes, ...near.slice(0, 10), ...results.filter((r) => r.verdict === 'INSUFFICIENT')];
for (const r of [...new Set(detail)]) {
  const c = r.combined;
  md += `\n### ${r.name} — ${r.verdict}\n`;
  md += `combined ${c.trades} trades, expR ${fm(c.expR, 3)}, PF ${fm(c.pf)}, PF ex-best-5% ${fm(c.pfExBest)}, `;
  md += `Sharpe ${fm(c.sharpe)}, Calmar ${fm(c.calmar)}, maxDD ${pc(c.maxDD, 1)}\n`;
  md += `baseline (const ${pc(c.wAvg)} ${r.cfg.dir}) Sharpe ${fm(c.base.sharpe)}, Calmar ${fm(c.base.calmar)}\n`;
  md += `DSR ${fm(c.dsrSel, 3)} (N=${selPool.length} selection pool) / ${fm(c.dsrAll, 3)} (N=${allPool.length} everything)\n`;
  md += `per-year net R: ${Object.entries(c.byYear).map(([y, v]) => `${y}: ${fm(v, 1)}`).join(', ')}\n`;
  md += `gates: ${Object.entries(r.gates).map(([g, ok]) => `${g}${ok ? '✓' : '✗'}`).join(' ')}\n`;
}

writeFileSync(new URL('./RESULTS.md', import.meta.url), md);
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(results.map((r) => ({
  name: r.name, cfg: r.cfg, verdict: r.verdict, failedGates: r.failedGates, combined: { ...r.combined, base: r.combined.base },
  splits: Object.fromEntries(['development', 'validation', 'test'].map((s) => {
    const { barRets, byYear, ...rest } = r.bySplit[s].m;
    return [s, rest];
  })),
})), null, 1));

console.log(`\nPASS: ${passes.length}`);
for (const r of passes) console.log('  ', r.name);
console.log(`\nNearest misses (rejected, <=3 gates failed):`);
for (const r of near.slice(0, 12)) console.log('  ', r.name.padEnd(34), 'failed', r.failedGates.join(','));
console.log('\nWrote RESULTS.md, results.json, ../trials.json');
