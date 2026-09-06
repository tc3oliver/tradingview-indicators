// Estimators for the M2 prospective study.
//
// The multiple-testing machinery below — normInv, normCdf, effectiveN and the
// correlation/eigenvalue helpers it needs — was previously imported from the
// intraday study, so that the effective-trial correction was literally the same
// code in both. That project has been condensed into
// research/rejected-studies/intraday.md and its directory removed, so those
// functions are inlined here UNCHANGED rather than reimplemented. A rewrite
// would quietly make the two studies' corrections incomparable, and the whole
// reason for sharing them was that they were not.
//
//  effectiveN.eigen   Li & Ji (2005): M_eff = Σ [ 1(λ_i ≥ 1) + (λ_i − ⌊λ_i⌋) ]
//                     over the eigenvalues of the trials' correlation matrix.
//  effectiveN.cluster number of single-linkage clusters at |ρ| ≥ 0.5.
// The larger of the two is used as N — more trials means a harder test.

export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const stdev = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
const EULER_G = 0.5772156649015329;
export function erf(x) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
export const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
export function normInv(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 0.97575) return -normInv(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Pearson correlation matrix of equal-length series (columns = trials).
export function corrMatrix(series) {
  const n = series.length, T = series[0].length;
  const z = series.map((s) => { const m = mean(s), sd = stdev(s) || 1; return s.map((x) => (x - m) / sd); });
  const R = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) { let s = 0; for (let t = 0; t < T; t++) s += z[i][t] * z[j][t]; R[i][j] = R[j][i] = i === j ? 1 : s / T; }
  return R;
}

// Eigenvalues of a symmetric matrix (cyclic Jacobi). Fine for n ≤ a few hundred.
export function symEigenvalues(A) {
  const n = A.length, M = A.map((r) => r.slice());
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += M[i][j] ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(M[p][q]) < 1e-14) continue;
      const theta = (M[q][q] - M[p][p]) / (2 * M[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const kp = M[k][p], kq = M[k][q]; M[k][p] = c * kp - s * kq; M[k][q] = s * kp + c * kq; }
      for (let k = 0; k < n; k++) { const pk = M[p][k], qk = M[q][k]; M[p][k] = c * pk - s * qk; M[q][k] = s * pk + c * qk; }
    }
  }
  return M.map((r, i) => r[i]);
}

export function effectiveN(series, rho = 0.5) {
  const R = corrMatrix(series), n = R.length;
  const lam = symEigenvalues(R).map((x) => Math.max(0, x));
  const eigen = lam.reduce((s, l) => s + (l >= 1 ? 1 : 0) + (l - Math.floor(l)), 0);
  // single-linkage clusters at |ρ| ≥ rho (union-find)
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.abs(R[i][j]) >= rho) parent[find(i)] = find(j);
  const cluster = new Set(Array.from({ length: n }, (_, i) => find(i))).size;
  const offDiag = []; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) offDiag.push(R[i][j]);
  return { raw: n, eigen, cluster, meanAbsRho: mean(offDiag.map(Math.abs)), effective: Math.max(eigen, cluster) };
}



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
