// Estimator checks. These run before M1 is estimated: the regression machinery has to
// be shown correct on data whose answer is known, or a null result means nothing.
import { olsNW, demeanByGroup, rankIC, meanT, quantiles, bucketOf } from './stats.mjs';
import { features, forward, usable, loadBars, afiOf } from './features.mjs';

let fails = 0;
const ok = (cond, name, detail = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`); if (!cond) fails++; };

// deterministic normal draws
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

// --- 1. OLS recovers a known slope ---------------------------------------
{
  const n = 20000, X = [], y = [];
  for (let i = 0; i < n; i++) { const x1 = gauss(), x2 = gauss(); X.push([x1, x2]); y.push(0.3 + 0.5 * x1 - 2 * x2 + gauss()); }
  const r = olsNW(y, X, 12);
  ok(Math.abs(r.beta[0] - 0.3) < 0.05 && Math.abs(r.beta[1] - 0.5) < 0.05 && Math.abs(r.beta[2] + 2) < 0.05,
    'olsNW recovers [0.3, 0.5, -2]', `got [${r.beta.map((b) => b.toFixed(3)).join(', ')}]`);
  ok(r.t[1] > 10 && r.t[2] < -10, 'olsNW t-stats are large where the effect is real', `t=[${r.t.map((t) => t.toFixed(1)).join(', ')}]`);
  ok(Math.abs(r.r2 - 0.8) < 0.05, 'olsNW R² matches the signal share', `R²=${r.r2.toFixed(3)}`);
}

// --- 2. Under the null the t-stat is small, and HAC does not shrink it away
{
  const n = 20000, X = [], y = [];
  for (let i = 0; i < n; i++) { X.push([gauss()]); y.push(gauss()); }
  const r = olsNW(y, X, 12);
  ok(Math.abs(r.t[1]) < 3, 'olsNW null slope is insignificant', `t=${r.t[1].toFixed(2)}`);
}

// --- 3. HAC widens standard errors when the score is autocorrelated ------
// This is the M1 case: a persistent regressor (AFI) against an overlapping forward
// return. An iid regressor would leave the score uncorrelated no matter how
// autocorrelated the residual is, and HAC would correctly change nothing.
{
  const n = 20000, X = [], y = [], e = [];
  for (let i = 0; i < n; i++) e.push(gauss());
  let x = 0;
  for (let i = 0; i < n; i++) {
    x = 0.9 * x + gauss();                                       // persistent regressor
    let s = 0; for (let l = 0; l < 12 && i - l >= 0; l++) s += e[i - l];   // 12-bar overlap
    X.push([x]); y.push(s);
  }
  const iid = olsNW(y, X, 0), hac = olsNW(y, X, 12);
  ok(hac.se[1] > iid.se[1] * 1.5, 'Newey-West inflates the standard error when the score is autocorrelated',
    `se ${iid.se[1].toExponential(2)} -> ${hac.se[1].toExponential(2)}`);
}

// --- 4. Within transformation equals explicit group dummies ---------------
{
  const n = 3000, g = [], v = [], X = [], y = [];
  for (let i = 0; i < n; i++) {
    const gi = i % 5, x = gauss();
    g.push(gi); v.push(x); X.push([x]); y.push(10 * gi + 2 * x + gauss());
  }
  const gd = X.map((r, i) => [r[0], ...[1, 2, 3, 4].map((k) => (g[i] === k ? 1 : 0))]);
  const withDummies = olsNW(y, gd, 0);
  const yd = demeanByGroup(Float64Array.from(y), g, 5), xd = demeanByGroup(Float64Array.from(v), g, 5);
  const within = olsNW(Array.from(yd), Array.from(xd, (x) => [x]), 0);
  ok(Math.abs(withDummies.beta[1] - within.beta[1]) < 1e-9,
    'within transformation == explicit group dummies', `${withDummies.beta[1].toFixed(9)} vs ${within.beta[1].toFixed(9)}`);
}

// --- 5. rank IC, meanT, quantiles ----------------------------------------
{
  const a = [1, 2, 3, 4, 5], b = [5, 4, 3, 2, 1];
  ok(Math.abs(rankIC(a, a) - 1) < 1e-12 && Math.abs(rankIC(a, b) + 1) < 1e-12, 'rankIC is ±1 on monotone pairs');
  const m = meanT(Array.from({ length: 5000 }, () => gauss() + 0.05), 12);
  ok(m.t > 2, 'meanT detects a real mean shift', `t=${m.t.toFixed(2)}`);
  const m0 = meanT(Array.from({ length: 5000 }, () => gauss()), 12);
  ok(Math.abs(m0.t) < 3, 'meanT is quiet under the null', `t=${m0.t.toFixed(2)}`);
  const q = quantiles([...Array(1000).keys()], 10);
  ok(q.length === 9 && q[4] === 500, 'quantiles cuts a uniform series where expected', `median edge ${q[4]}`);
  ok(bucketOf(-1e9, q) === 0 && bucketOf(1e9, q) === 9, 'bucketOf spans all deciles');
}

// --- 6. feature construction on the real bars -----------------------------
{
  const bars = loadBars('perp');
  const f = features(bars);
  const fwd = forward(f, bars, 3);
  const idx = usable(f, fwd);
  ok(idx.length > 600000, 'usable bars available', `${idx.length.toLocaleString()} of ${f.n.toLocaleString()}`);

  let afiBad = 0, retBad = 0, fwdBad = 0, gapBad = 0;
  for (const i of idx) {
    if (!(f.afi[i] >= -1 && f.afi[i] <= 1)) afiBad++;
    if (Math.abs(f.afi[i] - afiOf(bars[i])) > 1e-12) afiBad++;
    if (Math.abs(f.ret5[i] - Math.log(bars[i].c / bars[i - 1].c)) > 1e-12) retBad++;
    if (Math.abs(fwd[i] - Math.log(bars[i + 3].c / bars[i].c)) > 1e-12) fwdBad++;
    if (bars[i].t - bars[i - 12].t !== 12 * 300_000 || bars[i + 3].t - bars[i].t !== 3 * 300_000) gapBad++;
  }
  ok(afiBad === 0, 'AFI in range and matches its own definition', `${afiBad} bad`);
  ok(retBad === 0 && fwdBad === 0, 'returns match log(close ratio)', `${retBad}/${fwdBad} bad`);
  ok(gapBad === 0, 'no usable bar spans a hole in the 5m grid', `${gapBad} bad`);

  // the forward return must use only future bars: shifting it must destroy the match
  const shifted = forward(f, bars, 3);
  let sameAsContemporaneous = 0;
  for (const i of idx) if (Math.abs(shifted[i] - f.ret5[i]) < 1e-15) sameAsContemporaneous++;
  ok(sameAsContemporaneous / idx.length < 0.001, 'forward return is not the contemporaneous return',
    `${sameAsContemporaneous} coincidences`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
