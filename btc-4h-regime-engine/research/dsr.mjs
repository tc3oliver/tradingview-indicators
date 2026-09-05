// Deflated Sharpe Ratio from the ACTUAL trial registry.
//
// Bailey & López de Prado (2014), "The Deflated Sharpe Ratio: Correcting for
// Selection Bias, Backtest Overfitting and Non-Normality", J. Portfolio
// Management 40(5).
//
// The expected maximum Sharpe under the null is driven by two things this
// project can measure rather than assume: how many configurations were actually
// tried (N), and how much their Sharpes varied (Var(SR)). A wide spread of
// results across a large search means a high bar; a narrow spread across a
// small search means a low one.
//
//   SR0  = sqrt(Var(SR)) * [ (1-g)*Z^-1(1 - 1/N) + g*Z^-1(1 - 1/(N*e)) ]
//   DSR  = Z[ (SR - SR0)*sqrt(T-1) / sqrt(1 - g3*SR + ((g4-1)/4)*SR^2) ]
//
// with g = Euler-Mascheroni, g3/g4 the skewness and (non-excess) kurtosis of the
// candidate's own returns. All Sharpes here are PER-BAR, not annualised — the
// formula requires the same frequency as T.
//
// Usage: node dsr.mjs "<config name>" [split]

import { readTrials, backtest, ema, close, trailVol, SPLITS, mean, stdev, BARS_PER_YEAR, rows } from './lib.mjs';

const G = 0.5772156649015329;

// Abramowitz & Stegun 7.1.26
function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
// Acklam's inverse normal CDF
function normInv(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) return -normInv(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

const moment = (a, k) => { const m = mean(a), s = stdev(a); return mean(a.map((x) => ((x - m) / s) ** k)); };

// Rebuild the candidate's return series so skew/kurtosis are its own.
const WARMUP = 200;
const ema50 = ema(close, 50), ema200 = ema(close, 200);
const vol = trailVol(30);
function meanWeight(pos, [from, to]) {
  const w = [];
  for (let i = 1; i < rows.length; i++) { if (rows[i].t < from || rows[i].t >= to) continue; w.push(Math.max(0, Math.min(1, pos(i - 1) || 0))); }
  return w.length ? mean(w) : 0;
}
const candidate = (i) => (i >= WARMUP && close[i] > ema200[i] && ema50[i] > ema200[i] ? 1 : 0);
function solveScale(target, split) {
  let lo = 0, hi = 5;
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (meanWeight((i) => (i >= WARMUP && Number.isFinite(vol[i]) ? mid / vol[i] : 0), split) < target) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
function seriesFor(config, split) {
  const range = SPLITS[split];
  if (config === 'EMA slow trend  [candidate]') return backtest(candidate, range);
  if (config === 'buy & hold') return backtest(() => 1, range);
  if (config === 'BH @ matched expo') { const k = meanWeight(candidate, range); return backtest(() => k, range); }
  if (config === 'vol-scaled BH @ matched expo') { const s = solveScale(meanWeight(candidate, range), range); return backtest((i) => (i >= WARMUP && Number.isFinite(vol[i]) ? s / vol[i] : 0), range); }
  if (config === 'vol-scaled BH @ 20% target') return backtest((i) => (i >= WARMUP && Number.isFinite(vol[i]) ? 0.2 / vol[i] : 0), range);
  return null;
}

const CONFIG = process.argv[2] ?? 'EMA slow trend  [candidate]';
const SPLIT = process.argv[3] ?? 'validation';

const trials = readTrials();
const ann2bar = (s) => s / Math.sqrt(BARS_PER_YEAR);

// Two honest readings of N. Neither is chosen to flatter the result.
const onSel = trials.filter((t) => t.selectionSet);
const POOLS = {
  'configurations evaluated on the selection set': onSel,
  'every Sharpe ever computed in this project': trials,
};

const bt = seriesFor(CONFIG, SPLIT);
if (!bt) { console.error(`unknown config: ${CONFIG}`); process.exit(1); }
const sr = ann2bar(bt.sharpe);
const T = bt.bars;
const g3 = moment(bt.rets, 3), g4 = moment(bt.rets, 4);

console.log('='.repeat(96));
console.log(`DEFLATED SHARPE RATIO — "${CONFIG}" on ${SPLIT}`);
console.log('='.repeat(96));
console.log(`  observations T            ${T}`);
console.log(`  Sharpe (annualised)       ${bt.sharpe.toFixed(3)}`);
console.log(`  Sharpe (per bar)          ${sr.toFixed(5)}`);
console.log(`  skewness  g3              ${g3.toFixed(3)}`);
console.log(`  kurtosis  g4              ${g4.toFixed(3)}  (normal = 3)`);

for (const [label, pool] of Object.entries(POOLS)) {
  const srs = pool.map((t) => ann2bar(t.sharpe));
  const N = srs.length;
  const vSR = N > 1 ? stdev(srs) : 0;
  const sr0 = vSR * ((1 - G) * normInv(1 - 1 / N) + G * normInv(1 - 1 / (N * Math.E)));
  const denom = Math.sqrt(1 - g3 * sr + ((g4 - 1) / 4) * sr * sr);
  const dsr = normCdf(((sr - sr0) * Math.sqrt(T - 1)) / denom);
  console.log(`\n  --- N from: ${label} ---`);
  console.log(`    N trials                ${N}`);
  console.log(`    stdev of trial Sharpes  ${vSR.toFixed(5)} per bar  (${(vSR * Math.sqrt(BARS_PER_YEAR)).toFixed(3)} annualised)`);
  console.log(`    SR0 (expected max under null)  ${sr0.toFixed(5)} per bar  (${(sr0 * Math.sqrt(BARS_PER_YEAR)).toFixed(3)} annualised)`);
  console.log(`    DSR                     ${dsr.toFixed(4)}   ${dsr > 0.95 ? 'clears 95%' : dsr > 0.9 ? 'clears 90% only' : 'DOES NOT CLEAR'}`);
}

console.log('\n  DSR is the probability the true Sharpe exceeds zero after correcting for');
console.log('  how many configurations were searched and how non-normal the returns are.');
console.log('  It is not a p-value on the strategy being good — only on it not being the');
console.log('  best of a set of coin flips.');
console.log(`\n  Registry currently holds ${trials.length} entries across ${new Set(trials.map((t) => t.config)).size} distinct configurations.`);
