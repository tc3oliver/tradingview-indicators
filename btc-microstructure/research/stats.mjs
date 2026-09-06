// Estimators for M1. Multiple-testing machinery (normInv, effectiveN) is imported
// from the intraday study so the effective-trial correction is literally the same code.
export { normInv, normCdf, mean, stdev, effectiveN, corrMatrix }
  from '../../btc-intraday-trade-planner/research/stats.mjs';
import { mean } from '../../btc-intraday-trade-planner/research/stats.mjs';

function invert(A) {
  const k = A.length, M = A.map((r, i) => [...r, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    if (!d) throw new Error('singular design matrix');
    for (let j = 0; j < 2 * k; j++) M[c][j] /= d;
    for (let r = 0; r < k; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * k; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((r) => r.slice(k));
}
const matmul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));

// OLS with Newey-West (Bartlett) HAC standard errors.
// X: array of regressor rows, no intercept column (one is added).
export function olsNW(y, X, lag) {
  const n = y.length, k = X[0].length + 1;
  const Z = X.map((r) => [1, ...r]);
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0)), Xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { Xty[a] += Z[i][a] * y[i]; for (let b = 0; b < k; b++) XtX[a][b] += Z[i][a] * Z[i][b]; }
  const inv = invert(XtX), beta = inv.map((r) => r.reduce((s, v, j) => s + v * Xty[j], 0));
  const e = new Float64Array(n);
  for (let i = 0; i < n; i++) { let f = 0; for (let j = 0; j < k; j++) f += Z[i][j] * beta[j]; e[i] = y[i] - f; }
  const S = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let l = 0; l <= lag; l++) {
    const w = 1 - l / (lag + 1);
    for (let t = l; t < n; t++) {
      const et = w * e[t] * e[t - l];
      for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) {
        S[a][b] += et * Z[t][a] * Z[t - l][b];
        if (l > 0) S[a][b] += et * Z[t - l][a] * Z[t][b];
      }
    }
  }
  const V = matmul(matmul(inv, S), inv);
  const se = beta.map((_, j) => Math.sqrt(Math.max(0, V[j][j])));
  const ybar = mean(Array.from(y));
  let ss = 0, tss = 0;
  for (let i = 0; i < n; i++) { ss += e[i] * e[i]; tss += (y[i] - ybar) ** 2; }
  return { beta, se, t: beta.map((b, j) => (se[j] ? b / se[j] : 0)), r2: tss ? 1 - ss / tss : NaN, n };
}

// Within transformation: subtract the group mean of the sample being regressed.
// Equivalent to including a full set of group dummies (minute-of-day fixed effects).
export function demeanByGroup(v, g, nGroups) {
  const sum = new Float64Array(nGroups), cnt = new Float64Array(nGroups);
  for (let i = 0; i < v.length; i++) { sum[g[i]] += v[i]; cnt[g[i]]++; }
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] - (cnt[g[i]] ? sum[g[i]] / cnt[g[i]] : 0);
  return out;
}

// Spearman rank correlation (average ranks for ties).
export function rankIC(x, y) {
  const rank = (a) => {
    const o = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Float64Array(a.length);
    for (let i = 0; i < o.length;) {
      let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[o[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(Array.from(x)), ry = rank(Array.from(y));
  const mx = mean(Array.from(rx)), my = mean(Array.from(ry));
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < rx.length; i++) { const a = rx[i] - mx, b = ry[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

// Newey-West t-stat of a sample mean (overlapping observations).
export function meanT(v, lag) {
  const n = v.length; if (n < 2) return { mean: NaN, t: NaN, n };
  const m = mean(Array.from(v));
  const e = Array.from(v, (x) => x - m);
  let s = 0;
  for (let l = 0; l <= lag; l++) {
    const w = 1 - l / (lag + 1);
    let acc = 0; for (let t = l; t < n; t++) acc += e[t] * e[t - l];
    s += (l === 0 ? 1 : 2) * w * acc;
  }
  const se = Math.sqrt(Math.max(0, s) / n) / Math.sqrt(n);
  return { mean: m, t: se ? m / se : 0, se, n };
}

export function quantiles(v, k) {
  const s = Array.from(v).sort((a, b) => a - b), out = [];
  for (let i = 1; i < k; i++) out.push(s[Math.min(s.length - 1, Math.floor((i * s.length) / k))]);
  return out;
}
export const bucketOf = (x, edges) => { let b = 0; while (b < edges.length && x > edges[b]) b++; return b; };
