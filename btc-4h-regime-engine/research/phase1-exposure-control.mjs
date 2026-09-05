// PHASE 1 — is the slow-trend filter's drawdown improvement anything more than
// holding less?
//
// H3 found one configuration with cross-period consistency: a slow EMA regime
// filter. Over the holdout it turned buy & hold's -24.2% / 53.4% max drawdown
// into +1.4% / 24.6%. That looks like risk management. It might just be
// deleveraging: the filter is out of the market ~55% of the time, and ANY way
// of holding half as much BTC halves the drawdown.
//
// A drawdown improvement that a constant 45% position reproduces for free is
// not a trend filter. It is a smaller position with extra steps and extra fees.
//
// ============================================================================
// PRE-REGISTERED — fixed before the first run.
// ============================================================================
//
// CANDIDATE (locked, carried over from H3 verbatim, NOT re-tuned):
//   close > EMA200 AND EMA50 > EMA200  ->  weight 1, else 0
//
// CONTROLS:
//   1  buy & hold                    weight 1 always
//   2  BH @ matched exposure         constant weight = candidate's mean weight
//   3  vol-scaled BH @ matched exp   w = clamp(s / trailingVol, 0, 1), s solved
//                                    so mean weight equals the candidate's
//   4  vol-scaled BH @ 20% target    w = clamp(0.20 / trailingVol, 0, 1)
//                                    the literature-standard reference
//
// Controls 2 and 3 are calibrated using the candidate's realised average
// exposure over the period being measured. That is a lookahead advantage given
// TO THE CONTROLS, which biases the comparison AGAINST the candidate. Deliberate
// — a filter that cannot beat a control holding a deliberately generous
// advantage is not worth building.
//
// One-bar lag, 0.10% round trip, fractional weights allowed. Vol-scaling
// generates continuous turnover and is charged for it in full.
//
// CANDIDATE PASSES only if it beats BOTH exposure-matched controls (2 and 3) on
// ALL THREE of Sharpe, Calmar and Ulcer Index on the VALIDATION set, and the
// direction of each agrees on the holdout.
//
// Beating only control 1 is an explicit FAIL: it would mean the effect is
// exposure reduction, obtainable without any signal at all.
// ============================================================================

import { rows, close, ema, trailVol, backtest, SPLITS, mean, p2, recordTrials, BARS_PER_YEAR } from './lib.mjs';

const WARMUP = 200;
const ema50 = ema(close, 50), ema200 = ema(close, 200);
const vol = trailVol(30);

const candidate = (i) => (i >= WARMUP && close[i] > ema200[i] && ema50[i] > ema200[i] ? 1 : 0);

// Mean weight a position function actually achieves over a window, matching
// backtest()'s one-bar-lag indexing exactly.
function meanWeight(pos, [from, to]) {
  const w = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].t < from || rows[i].t >= to) continue;
    w.push(Math.max(0, Math.min(1, pos(i - 1) || 0)));
  }
  return w.length ? mean(w) : 0;
}

// Solve the vol-scaling constant so average exposure matches the candidate's.
function solveScale(target, split) {
  let lo = 0, hi = 5;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    const m = meanWeight((i) => (i >= WARMUP && Number.isFinite(vol[i]) ? mid / vol[i] : 0), split);
    if (m < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const FIELDS = [
  ['CAGR', (r) => p2(r.cagr)],
  ['Sharpe', (r) => r.sharpe.toFixed(2)],
  ['Sortino', (r) => r.sortino.toFixed(2)],
  ['maxDD', (r) => p2(r.maxDD)],
  ['Calmar', (r) => (Number.isFinite(r.calmar) ? r.calmar.toFixed(2) : '—')],
  ['Ulcer', (r) => p2(r.ulcer)],
  ['avg expo', (r) => p2(r.avgExposure)],
  ['in mkt', (r) => p2(r.timeInMarket)],
  ['turn/yr', (r) => r.turnoverPerYear.toFixed(1)],
  ['net ret', (r) => p2(r.netRet)],
];

console.log('='.repeat(108));
console.log('PHASE 1 — is the slow-trend drawdown improvement more than exposure reduction?');
console.log(`${rows.length} bars  ${new Date(rows[0].t).toISOString().slice(0, 10)} -> ${new Date(rows.at(-1).t).toISOString().slice(0, 10)}`);
console.log('one-bar lag, 0.10% round trip, fractional weights, vol-scaling charged for its turnover');
console.log('='.repeat(108));

const results = {};
const trials = [];

for (const [split, range] of Object.entries(SPLITS)) {
  const k = meanWeight(candidate, range);
  const s = solveScale(k, range);
  const models = {
    'buy & hold': () => 1,
    'EMA slow trend  [candidate]': candidate,
    [`BH @ matched expo (${(k * 100).toFixed(0)}%)`]: () => k,
    'vol-scaled BH @ matched expo': (i) => (i >= WARMUP && Number.isFinite(vol[i]) ? s / vol[i] : 0),
    'vol-scaled BH @ 20% target': (i) => (i >= WARMUP && Number.isFinite(vol[i]) ? 0.2 / vol[i] : 0),
  };

  console.log(`\n${'='.repeat(108)}`);
  console.log(`${split.toUpperCase()}   ${new Date(range[0]).toISOString().slice(0, 10)} -> ${range[1] === Infinity ? 'now' : new Date(range[1]).toISOString().slice(0, 10)}`);
  console.log('='.repeat(108));
  console.log('  model                          ' + FIELDS.map(([h]) => h.padStart(9)).join(''));

  results[split] = {};
  for (const [name, fn] of Object.entries(models)) {
    const r = backtest(fn, range);
    results[split][name.replace(/\s*\(\d+%\)/, '')] = r;
    console.log(`  ${name.padEnd(31)}` + FIELDS.map(([, f]) => f(r).padStart(9)).join(''));
    trials.push({
      hypothesis: 'P1', config: name.replace(/\s*\(\d+%\)/, ''), split,
      sharpe: +r.sharpe.toFixed(4), maxDD: +r.maxDD.toFixed(4), bars: r.bars,
      engine: 'lib.backtest (1-bar lag)', selectionSet: split === 'validation',
    });
  }
}

// ---------- verdict ----------
const CAND = 'EMA slow trend  [candidate]';
const CTRL = ['BH @ matched expo', 'vol-scaled BH @ matched expo'];

console.log(`\n${'='.repeat(108)}`);
console.log('VERDICT — candidate vs the two exposure-matched controls');
console.log('='.repeat(108));

function cmp(split) {
  const c = results[split][CAND];
  const out = {};
  for (const ctrl of CTRL) {
    const o = results[split][ctrl];
    out[ctrl] = {
      sharpe: c.sharpe - o.sharpe,
      calmar: (Number.isFinite(c.calmar) ? c.calmar : 0) - (Number.isFinite(o.calmar) ? o.calmar : 0),
      ulcer: o.ulcer - c.ulcer,          // positive = candidate better (lower ulcer)
    };
  }
  return out;
}

const V = cmp('validation'), H = cmp('holdout'), D = cmp('development');
for (const ctrl of CTRL) {
  console.log(`\n  vs ${ctrl}`);
  console.log(`    ${'metric'.padEnd(10)}${'dev'.padStart(10)}${'validation'.padStart(12)}${'holdout'.padStart(10)}   agree?`);
  for (const m of ['sharpe', 'calmar', 'ulcer']) {
    const signs = [D[ctrl][m], V[ctrl][m], H[ctrl][m]].map(Math.sign);
    const agree = signs.every((x) => x === signs[0]);
    const fmt = (x) => (m === 'ulcer' ? p2(x) : x.toFixed(2));
    console.log(`    ${m.padEnd(10)}${fmt(D[ctrl][m]).padStart(10)}${fmt(V[ctrl][m]).padStart(12)}${fmt(H[ctrl][m]).padStart(10)}   ${agree ? (signs[0] > 0 ? 'yes, candidate ahead' : 'yes, candidate BEHIND') : 'NO'}`);
  }
}

const beatsOn = (cmpSet) => CTRL.every((c) => cmpSet[c].sharpe > 0 && cmpSet[c].calmar > 0 && cmpSet[c].ulcer > 0);
const valPass = beatsOn(V);
const holdAgree = CTRL.every((c) => ['sharpe', 'calmar', 'ulcer'].every((m) => Math.sign(V[c][m]) === Math.sign(H[c][m])));

console.log(`\n  1. beats BOTH exposure-matched controls on Sharpe, Calmar and Ulcer (validation)   ${valPass ? 'PASS' : 'FAIL'}`);
console.log(`  2. every one of those comparisons keeps its direction on the holdout             ${holdAgree ? 'PASS' : 'FAIL'}`);
console.log(`\n  >>> PHASE 1 ${valPass && holdAgree ? 'PASS — the filter does something a smaller constant position does not.' : 'FAIL'}`);
if (!(valPass && holdAgree)) {
  console.log('      The drawdown improvement is not established as anything beyond holding less.');
  console.log('      Phase 2 does not start. Do not re-tune the EMA lengths to rescue this —');
  console.log('      that is a new hypothesis and it goes in the registry as one.');
}

console.log(`\n  trial registry: ${recordTrials(trials)} entries total`);
