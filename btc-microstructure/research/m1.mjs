// Study M1 — H1 (aggressor flow continuation) and H2 (absorption / price response),
// exactly as pre-registered in ../PRE-REGISTRATION-M1.md (frozen commit 1350c08).
// Every configuration is written to trials.json before any gate is evaluated.
// Usage: node --max-old-space-size=8192 research/m1.mjs
import { writeFileSync } from 'node:fs';
import { olsNW, demeanByGroup, rankIC, meanT, quantiles, bucketOf, effectiveN, normInv, mean } from './stats.mjs';
import { features, forward, usable, loadBars } from './features.mjs';

const HAC = 12;                                   // Newey-West Bartlett lag, pre-registered
const HORIZONS = { '5m': 1, '15m': 3, '30m': 6 }; // 15m is the acceptance primary
const PRIOR_EFFECTIVE_N = 115;                    // cumulative across TP1, IT1, IT2, IT3
const SPLITS = {
  dev: [Date.parse('2020-01-01T00:00:00Z'), Date.parse('2023-01-01T00:00:00Z')],
  val: [Date.parse('2023-01-01T00:00:00Z'), Date.parse('2025-01-01T00:00:00Z')],
  test: [Date.parse('2025-01-01T00:00:00Z'), Date.parse('2026-09-06T00:00:00Z')],
};
const inSplit = (t, s) => t >= SPLITS[s][0] && t < SPLITS[s][1];

const venues = {};
for (const m of ['perp', 'spot']) {
  const bars = loadBars(m), f = features(bars);
  venues[m] = { bars, f, fwd: Object.fromEntries(Object.entries(HORIZONS).map(([k, h]) => [k, forward(f, bars, h)])) };
}

// Decile breakpoints come from the development split only (pre-registered).
function devEdges(v, pick) {
  const { f, fwd } = v;
  const idx = usable(f, fwd['15m']).filter((i) => inSplit(f.t[i], 'dev'));
  return quantiles(idx.map(pick), 10);
}
const AFI_EDGES = { perp: devEdges(venues.perp, (i) => venues.perp.f.afi[i]), spot: devEdges(venues.spot, (i) => venues.spot.f.afi[i]) };
const INT_EDGES = { perp: devEdges(venues.perp, (i) => venues.perp.f.afi[i] * venues.perp.f.ret5[i]),
  spot: devEdges(venues.spot, (i) => venues.spot.f.afi[i] * venues.spot.f.ret5[i]) };

// --- one regression -------------------------------------------------------
// hyp 'H1': fwd ~ AFI + ret5 + rv5 + lnqv + minute-of-day FE
// hyp 'H2': fwd ~ AFI + ret5 + AFI*ret5 + rv5 + lnqv + minute-of-day FE
function fit(v, hyp, hz, idx) {
  const { f, fwd } = v, y0 = fwd[hz];
  if (idx.length < 500) return null;
  const cols = hyp === 'H1'
    ? [(i) => f.afi[i], (i) => f.ret5[i], (i) => f.rv5[i], (i) => f.lnqv[i]]
    : [(i) => f.afi[i], (i) => f.ret5[i], (i) => f.afi[i] * f.ret5[i], (i) => f.rv5[i], (i) => f.lnqv[i]];
  const g = idx.map((i) => f.mod[i]);
  const y = demeanByGroup(Float64Array.from(idx, (i) => y0[i]), g, 288);
  const xs = cols.map((fn) => demeanByGroup(Float64Array.from(idx, fn), g, 288));
  const X = idx.map((_, r) => xs.map((c) => c[r]));
  const res = olsNW(Array.from(y), X, HAC);
  const names = hyp === 'H1' ? ['const', 'AFI', 'ret5', 'rv5', 'lnqv'] : ['const', 'AFI', 'ret5', 'AFIxret5', 'rv5', 'lnqv'];
  const key = hyp === 'H1' ? 'AFI' : 'AFIxret5';
  const j = names.indexOf(key);
  return { n: res.n, r2: res.r2, key, beta: res.beta[j], se: res.se[j], t: res.t[j],
    ci: [res.beta[j] - 1.96 * res.se[j], res.beta[j] + 1.96 * res.se[j]],
    coef: Object.fromEntries(names.map((nm, k) => [nm, { beta: res.beta[k], t: res.t[k] }])) };
}

const idxOf = (v, hz, filter) => usable(v.f, v.fwd[hz]).filter(filter || (() => true));

// --- trial registry (written before any gate) -----------------------------
const trials = [];
const fitted = {};
for (const venue of ['perp', 'spot']) for (const hyp of ['H1', 'H2']) for (const hz of Object.keys(HORIZONS)) {
  const v = venues[venue], cfg = `${hyp}|${hz}|${venue}`;
  fitted[cfg] = {};
  for (const s of ['dev', 'val', 'test']) {
    const r = fit(v, hyp, hz, idxOf(v, hz, (i) => inSplit(v.f.t[i], s)));
    fitted[cfg][s] = r;
    trials.push({ study: 'M1', config: cfg, hypothesis: hyp, horizon: hz, venue, split: s,
      primary: hyp !== null && hz === '15m' && venue === 'perp', term: r?.key, n: r?.n, beta: r?.beta, t: r?.t, r2: r?.r2 });
  }
  fitted[cfg].valtest = fit(v, hyp, hz, idxOf(v, hz, (i) => inSplit(v.f.t[i], 'val') || inSplit(v.f.t[i], 'test')));
  fitted[cfg].full = fit(v, hyp, hz, idxOf(v, hz, () => true));
}

// --- effective independent trials ----------------------------------------
// Per configuration, the daily sum of the demeaned score x~*y~ whose mean is the
// numerator of beta. Configurations measuring the same thing correlate; splits are
// not trials and do not appear here.
function scoreSeries(venue, hyp, hz) {
  const v = venues[venue], { f, fwd } = v, y0 = fwd[hz];
  const idx = idxOf(v, hz, () => true), g = idx.map((i) => f.mod[i]);
  const y = demeanByGroup(Float64Array.from(idx, (i) => y0[i]), g, 288);
  const x = demeanByGroup(Float64Array.from(idx, (i) => (hyp === 'H1' ? f.afi[i] : f.afi[i] * f.ret5[i])), g, 288);
  const daily = new Map();
  for (let r = 0; r < idx.length; r++) {
    const d = Math.floor(f.t[idx[r]] / 86_400_000);
    daily.set(d, (daily.get(d) || 0) + x[r] * y[r]);
  }
  return daily;
}
const cfgKeys = Object.keys(fitted);
const dailyMaps = cfgKeys.map((c) => { const [hyp, hz, venue] = c.split('|'); return scoreSeries(venue, hyp, hz); });
const allDays = [...new Set(dailyMaps.flatMap((m) => [...m.keys()]))].sort((a, b) => a - b);
const seriesForN = dailyMaps.map((m) => allDays.map((d) => m.get(d) || 0));
const eff = effectiveN(seriesForN, 0.5);
const cumulativeEffective = PRIOR_EFFECTIVE_N + eff.effective;
const T_THRESHOLD = normInv(1 - 0.05 / (2 * cumulativeEffective));

writeFileSync(new URL('../trials.json', import.meta.url).pathname, JSON.stringify({
  study: 'M1', registeredBefore: 'any gate evaluation', rawEntries: trials.length,
  configurations: cfgKeys.length, effectiveN: eff, priorEffectiveN: PRIOR_EFFECTIVE_N,
  cumulativeEffectiveN: cumulativeEffective, multipleTestingT: T_THRESHOLD, trials,
}, null, 2));

// --- descriptive panels ---------------------------------------------------
function deciles(venue, hyp, hz, filter) {
  const v = venues[venue], { f, fwd } = v, y0 = fwd[hz];
  const edges = hyp === 'H1' ? AFI_EDGES[venue] : INT_EDGES[venue];
  const pick = hyp === 'H1' ? (i) => f.afi[i] : (i) => f.afi[i] * f.ret5[i];
  const bins = Array.from({ length: 10 }, () => []);
  for (const i of idxOf(v, hz, filter)) bins[bucketOf(pick(i), edges)].push(y0[i]);
  const rows = bins.map((b, k) => ({ decile: k + 1, n: b.length, ...meanT(b, HAC) }));
  const mono = rankIC(rows.map((r) => r.decile), rows.map((r) => r.mean));
  return { rows, mono, topMinusBottom: rows[9].mean - rows[0].mean, edges };
}

const valtest = (v) => (i) => inSplit(v.f.t[i], 'val') || inSplit(v.f.t[i], 'test');
const D = { H1: deciles('perp', 'H1', '15m', valtest(venues.perp)), H2: deciles('perp', 'H2', '15m', valtest(venues.perp)) };

// rank IC of the tested term against the forward return
function ic(venue, hyp, hz, filter) {
  const v = venues[venue], idx = idxOf(v, hz, filter);
  const x = idx.map(hyp === 'H1' ? (i) => v.f.afi[i] : (i) => v.f.afi[i] * v.f.ret5[i]);
  return rankIC(x, idx.map((i) => v.fwd[hz][i]));
}

// H2's four pre-specified cells
function cells(venue, hz, filter) {
  const v = venues[venue], { f } = v, e = AFI_EDGES[venue], y0 = v.fwd[hz];
  const out = { absorbedBuy: [], alignedBuy: [], absorbedSell: [], alignedSell: [] };
  for (const i of idxOf(v, hz, filter)) {
    const b = bucketOf(f.afi[i], e);
    if (b === 9) (f.ret5[i] <= 0 ? out.absorbedBuy : out.alignedBuy).push(y0[i]);
    else if (b === 0) (f.ret5[i] >= 0 ? out.absorbedSell : out.alignedSell).push(y0[i]);
  }
  return Object.fromEntries(Object.entries(out).map(([k, a]) => [k, { n: a.length, ...meanT(a, HAC) }]));
}
const CELLS = cells('perp', '15m', valtest(venues.perp));

// long / short sides of the primary regression
const SIDES = {
  H1: { long: fit(venues.perp, 'H1', '15m', idxOf(venues.perp, '15m', (i) => valtest(venues.perp)(i) && venues.perp.f.afi[i] > 0)),
    short: fit(venues.perp, 'H1', '15m', idxOf(venues.perp, '15m', (i) => valtest(venues.perp)(i) && venues.perp.f.afi[i] < 0)) },
};

// year by year, primary specification
const YEARS = {};
for (const hyp of ['H1', 'H2']) {
  YEARS[hyp] = {};
  for (let y = 2020; y <= 2026; y++) {
    const lo = Date.parse(`${y}-01-01T00:00:00Z`), hi = Date.parse(`${y + 1}-01-01T00:00:00Z`);
    YEARS[hyp][y] = fit(venues.perp, hyp, '15m', idxOf(venues.perp, '15m', (i) => venues.perp.f.t[i] >= lo && venues.perp.f.t[i] < hi));
  }
}

// I6: drop the 5% of observations with the largest |forward return|
function trimmed(hyp) {
  const v = venues.perp, idx = idxOf(v, '15m', valtest(v));
  const cut = quantiles(idx.map((i) => Math.abs(v.fwd['15m'][i])), 20)[18];   // 95th percentile
  return fit(v, hyp, '15m', idx.filter((i) => Math.abs(v.fwd['15m'][i]) <= cut));
}
const TRIM = { H1: trimmed('H1'), H2: trimmed('H2') };

// I4: drop the single best year, re-estimate on validation u test
function dropBestYear(hyp) {
  const sign = Math.sign(fitted[`${hyp}|15m|perp`].valtest.beta) || 1;
  let best = null, bestVal = -Infinity;
  for (const y of [2023, 2024, 2025, 2026]) {
    const r = YEARS[hyp][y]; if (!r) continue;
    const v = sign * r.beta; if (v > bestVal) { bestVal = v; best = y; }
  }
  const lo = Date.parse(`${best}-01-01T00:00:00Z`), hi = Date.parse(`${best + 1}-01-01T00:00:00Z`);
  const v = venues.perp;
  return { droppedYear: best, fit: fit(v, hyp, '15m', idxOf(v, '15m', (i) => valtest(v)(i) && !(v.f.t[i] >= lo && v.f.t[i] < hi))) };
}
const DROP = { H1: dropBestYear('H1'), H2: dropBestYear('H2') };

// --- information gate -----------------------------------------------------
function gate(hyp) {
  const c = `${hyp}|15m|perp`, F = fitted[c];
  const sign = Math.sign(F.valtest.beta) || 1;
  const yrs = Object.values(YEARS[hyp]).filter(Boolean);
  const dec = D[hyp];
  const spotVT = fitted[`${hyp}|15m|spot`].valtest;
  const g = {
    I1: Math.sign(F.dev.beta) === Math.sign(F.val.beta) && Math.sign(F.val.beta) === Math.sign(F.test.beta),
    I2: Math.abs(F.val.t) >= 2 && Math.abs(F.test.t) >= 2 && Math.sign(F.val.beta) === sign && Math.sign(F.test.beta) === sign,
    I3: Math.abs(F.valtest.t) > T_THRESHOLD,
    I4: yrs.filter((r) => Math.sign(r.beta) === sign).length >= 5 && Math.abs(DROP[hyp].fit.t) >= 2 && Math.sign(DROP[hyp].fit.beta) === sign,
    I5: Math.abs(dec.mono) >= 0.7 && Math.sign(dec.mono) === sign && Math.sign(dec.topMinusBottom) === sign,
    I6: Math.sign(TRIM[hyp].beta) === sign && Math.abs(TRIM[hyp].t) >= 2,
    I7: Math.sign(spotVT.beta) === sign,
  };
  g.pass = Object.values(g).every(Boolean);
  g.failed = Object.entries(g).filter(([k, v]) => k !== 'pass' && !v).map(([k]) => k);
  return g;
}
const GATE = { H1: gate('H1'), H2: gate('H2') };
const INFO_PASS = GATE.H1.pass || GATE.H2.pass;

// --- descriptive economics (the §7 gate is only *reached* if INFO_PASS) ----
// Signal = top/bottom development AFI decile. Fill at the open of the next bar,
// exit at the open of the bar 3 later. No stop, no target, no sizing.
function minimal(costRt) {
  const v = venues.perp, { f, bars } = v, e = AFI_EDGES.perp, R = [];
  for (const i of idxOf(v, '15m', valtest(v))) {
    if (i + 4 >= f.n) continue;
    if (bars[i + 4].t - bars[i].t !== 4 * 300_000) continue;
    const b = bucketOf(f.afi[i], e);
    if (b !== 9 && b !== 0) continue;
    const dir = b === 9 ? 1 : -1;
    const gross = dir * (bars[i + 4].o - bars[i + 1].o) / bars[i + 1].o;
    R.push({ t: f.t[i], dir, gross, net: gross - costRt });
  }
  const g = R.map((r) => r.gross), nt = R.map((r) => r.net);
  const win = nt.filter((x) => x > 0), lose = nt.filter((x) => x <= 0);
  const days = (SPLITS.test[1] - SPLITS.val[0]) / 86_400_000;
  return { trades: R.length, grossPerTrade: mean(g), netPerTrade: mean(nt),
    grossT: meanT(g, HAC).t, hitRate: nt.length ? win.length / nt.length : 0,
    pf: lose.length ? win.reduce((s, x) => s + x, 0) / -lose.reduce((s, x) => s + x, 0) : Infinity,
    annualisedNet: mean(nt) * R.length * (365 / days),
    meanAbsMove: mean(g.map(Math.abs)) };
}
const ECON = { base: minimal(0.0014), stress20: minimal(0.0020), stress30: minimal(0.0030) };
ECON.costOverEdge = { '0.14%': 0.0014 / ECON.base.grossPerTrade, '0.20%': 0.0020 / ECON.base.grossPerTrade, '0.30%': 0.0030 / ECON.base.grossPerTrade };
ECON.costOverExpectedMove = { '0.14%': 0.0014 / ECON.base.meanAbsMove };

// --- post-hoc, after the gates were evaluated and both hypotheses rejected ----
// Not part of any gate and it cannot change one. The decile pattern of AFI is
// recorded per split so a future pre-registration has something to be written
// against, since H1's rejection came with a monotone pattern of the opposite sign.
const POSTHOC = { note: 'computed after the verdict; descriptive only, changes no gate', afiDecilesBySplit: {} };
for (const s of ['dev', 'val', 'test']) {
  const d = deciles('perp', 'H1', '15m', (i) => inSplit(venues.perp.f.t[i], s));
  POSTHOC.afiDecilesBySplit[s] = { mono: d.mono, topMinusBottom: d.topMinusBottom, top: d.rows[9], bottom: d.rows[0] };
}

const results = { generated: new Date().toISOString(), splits: SPLITS, hac: HAC, postHoc: POSTHOC,
  afiEdges: AFI_EDGES, intEdges: INT_EDGES, fitted, deciles: D, cells: CELLS, sides: SIDES,
  ic: { H1: ic('perp', 'H1', '15m', valtest(venues.perp)), H2: ic('perp', 'H2', '15m', valtest(venues.perp)) },
  years: YEARS, trim: TRIM, dropBestYear: DROP, effectiveN: eff, cumulativeEffectiveN: cumulativeEffective,
  multipleTestingT: T_THRESHOLD, gate: GATE, informationGatePassed: INFO_PASS,
  economicsDescriptive: ECON, verdict: INFO_PASS ? 'SEE GATE' : 'REJECT' };
writeFileSync(new URL('./results-m1.json', import.meta.url).pathname, JSON.stringify(results, null, 2));

// ---------------------------------------------------------------- report
const p = (x, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const bp = (x) => (Number.isFinite(x) ? (x * 10000).toFixed(3) + ' bp' : 'n/a');
const L = [];
L.push('# M1 results — aggressor flow and short-horizon BTC returns', '');
L.push(`Pre-registered in [\`../PRE-REGISTRATION-M1.md\`](../PRE-REGISTRATION-M1.md). Generated ${results.generated}.`);
L.push('All figures are **RETROSPECTIVE — NEW DATA DOMAIN**, not pristine out-of-sample.', '');
L.push(`## Verdict: **${INFO_PASS ? 'information gate passed — see §6' : 'REJECT'}**`, '');
L.push(`H1 failed ${GATE.H1.failed.join(' ') || 'nothing'}; H2 failed ${GATE.H2.failed.join(' ') || 'nothing'}.`, '');

for (const hyp of ['H1', 'H2']) {
  const term = hyp === 'H1' ? 'AFI' : 'AFI × ret5m';
  L.push(`## ${hyp} — ${hyp === 'H1' ? 'aggressor flow continuation' : 'absorption / price response'}`, '');
  L.push(`Coefficient on **${term}**, 15m forward return, futures, minute-of-day fixed effects, Newey-West lag ${HAC}.`, '');
  L.push('| split | n | β | HAC t | 95% CI | within R² |', '|---|---|---|---|---|---|');
  for (const s of ['dev', 'val', 'test', 'valtest', 'full']) {
    const r = fitted[`${hyp}|15m|perp`][s];
    L.push(`| ${s} | ${r.n.toLocaleString()} | ${r.beta.toExponential(3)} | ${p(r.t, 2)} | [${r.ci[0].toExponential(2)}, ${r.ci[1].toExponential(2)}] | ${p(100 * r.r2, 3)}% |`);
  }
  L.push('');
  L.push('| robustness | n | β | HAC t |', '|---|---|---|---|');
  for (const hz of ['5m', '30m']) { const r = fitted[`${hyp}|${hz}|perp`].valtest; L.push(`| futures, ${hz} horizon | ${r.n.toLocaleString()} | ${r.beta.toExponential(3)} | ${p(r.t, 2)} |`); }
  for (const hz of ['5m', '15m', '30m']) { const r = fitted[`${hyp}|${hz}|spot`].valtest; L.push(`| spot, ${hz} horizon | ${r.n.toLocaleString()} | ${r.beta.toExponential(3)} | ${p(r.t, 2)} |`); }
  L.push('');
  L.push(`Spearman rank IC of ${term} against the 15m forward return (validation ∪ test): **${p(results.ic[hyp], 5)}**.`, '');
  const d = D[hyp];
  L.push(`### Deciles of ${term} (breakpoints from development), validation ∪ test`, '');
  L.push('| decile | n | mean 15m forward return | HAC t |', '|---|---|---|---|');
  for (const r of d.rows) L.push(`| ${r.decile} | ${r.n.toLocaleString()} | ${bp(r.mean)} | ${p(r.t, 2)} |`);
  L.push('', `Monotonicity (Spearman of decile index vs mean return): **${p(d.mono, 3)}**. Top − bottom: **${bp(d.topMinusBottom)}**.`, '');
  L.push('### Year by year (primary specification, futures, 15m)', '', '| year | n | β | HAC t |', '|---|---|---|---|');
  for (const [y, r] of Object.entries(YEARS[hyp])) L.push(`| ${y} | ${r.n.toLocaleString()} | ${r.beta.toExponential(3)} | ${p(r.t, 2)} |`);
  L.push('');
  L.push('### Gates', '', '| gate | requirement | result |', '|---|---|---|');
  const G = GATE[hyp], F = fitted[`${hyp}|15m|perp`];
  L.push(`| I1 | same β sign in all three splits | ${G.I1 ? 'pass' : 'FAIL'} (${[F.dev, F.val, F.test].map((r) => (r.beta > 0 ? '+' : '−')).join(' ')}) |`);
  L.push(`| I2 | \\|t\\| ≥ 2 on validation and on test | ${G.I2 ? 'pass' : 'FAIL'} (${p(F.val.t, 2)}, ${p(F.test.t, 2)}) |`);
  L.push(`| I3 | \\|t\\| > ${p(T_THRESHOLD, 2)} on validation ∪ test | ${G.I3 ? 'pass' : 'FAIL'} (${p(F.valtest.t, 2)}) |`);
  L.push(`| I4 | consistent sign in ≥ 5 of 7 years, survives dropping the best year | ${G.I4 ? 'pass' : 'FAIL'} (drop ${DROP[hyp].droppedYear}: t ${p(DROP[hyp].fit.t, 2)}) |`);
  L.push(`| I5 | decile monotonicity ≥ 0.7 with the right sign | ${G.I5 ? 'pass' : 'FAIL'} (${p(D[hyp].mono, 2)}) |`);
  L.push(`| I6 | survives removing the 5% largest \\|forward return\\| | ${G.I6 ? 'pass' : 'FAIL'} (β ${TRIM[hyp].beta.toExponential(2)}, t ${p(TRIM[hyp].t, 2)}) |`);
  L.push(`| I7 | spot β has the same sign | ${G.I7 ? 'pass' : 'FAIL'} (${fitted[`${hyp}|15m|spot`].valtest.beta.toExponential(2)}) |`);
  L.push('');
}

L.push('## H2 cells (development AFI deciles, validation ∪ test)', '');
L.push('| cell | n | mean 15m forward return | HAC t |', '|---|---|---|---|');
for (const [k, c] of Object.entries(CELLS)) L.push(`| ${k} | ${c.n.toLocaleString()} | ${bp(c.mean)} | ${p(c.t, 2)} |`);
L.push('');
L.push('## H1 long and short sides (validation ∪ test)', '', '| side | n | β | HAC t |', '|---|---|---|---|');
for (const [k, r] of Object.entries(SIDES.H1)) L.push(`| AFI ${k === 'long' ? '> 0' : '< 0'} | ${r.n.toLocaleString()} | ${r.beta.toExponential(3)} | ${p(r.t, 2)} |`);
L.push('');
L.push('## Trials', '');
L.push(`| raw registry entries | configurations | mean \\|ρ\\| | eigenvalue estimate | clusters at \\|ρ\\| ≥ 0.5 | effective |`, '|---|---|---|---|---|---|');
L.push(`| ${trials.length} | ${cfgKeys.length} | ${p(eff.meanAbsRho, 2)} | ${p(eff.eigen, 1)} | ${eff.cluster} | ${p(eff.effective, 1)} |`);
L.push('', `Cumulative across every study in this repository: **${p(cumulativeEffective, 1)} effective trials**, giving a two-sided multiple-testing threshold of \\|t\\| > **${p(T_THRESHOLD, 2)}** (gate I3).`, '');

L.push('## Economics', '');
L.push(INFO_PASS
  ? 'The information gate passed, so §7 of the pre-registration is reached and these are the gate figures.'
  : '**The information gate did not pass, so §7 was never reached and no strategy is built.** The numbers below are descriptive only, computed so the question "how big was the edge before and after cost" has an answer on the record. They cannot and do not change the verdict.');
L.push('');
L.push('Signal: top / bottom development AFI decile. Fill at the next bar\'s open, exit at the open three bars later. No stop, no target, no sizing.', '');
L.push('| cost (round trip) | trades | gross/trade | net/trade | annualised net | hit rate | PF |', '|---|---|---|---|---|---|---|');
for (const [k, e] of [['0.14%', ECON.base], ['0.20%', ECON.stress20], ['0.30%', ECON.stress30]])
  L.push(`| ${k} | ${e.trades.toLocaleString()} | ${bp(e.grossPerTrade)} | ${bp(e.netPerTrade)} | ${p(100 * e.annualisedNet, 1)}% | ${p(100 * e.hitRate, 1)}% | ${p(e.pf, 2)} |`);
L.push('');
L.push(`Gross edge per signal: **${bp(ECON.base.grossPerTrade)}** (HAC t ${p(ECON.base.grossT, 2)}); mean absolute 15m move on those bars: **${bp(ECON.base.meanAbsMove)}**.`);
L.push(`**COST / EXPECTED EDGE** = ${p(ECON.costOverEdge['0.14%'], 1)} at 0.14%, ${p(ECON.costOverEdge['0.20%'], 1)} at 0.20%, ${p(ECON.costOverEdge['0.30%'], 1)} at 0.30%.`);
L.push(`**COST / EXPECTED MOVE** = ${p(ECON.costOverExpectedMove['0.14%'], 2)} at 0.14%.`, '');
L.push('## Post-hoc', '');
L.push('Computed after the gates were evaluated and both hypotheses rejected. It changes no gate and no verdict; it exists so that a future pre-registration has a recorded starting point rather than a memory.', '');
L.push('| split | decile monotonicity | top decile mean | bottom decile mean | top − bottom |', '|---|---|---|---|---|');
for (const [s, r] of Object.entries(POSTHOC.afiDecilesBySplit))
  L.push(`| ${s} | ${p(r.mono, 3)} | ${bp(r.top.mean)} (t ${p(r.top.t, 2)}) | ${bp(r.bottom.mean)} (t ${p(r.bottom.t, 2)}) | ${bp(r.topMinusBottom)} |`);
L.push('');
writeFileSync(new URL('./RESULTS-M1.md', import.meta.url).pathname, L.join('\n'));
console.log(L.join('\n'));
