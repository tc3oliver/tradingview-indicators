// Shared statistics: Deflated Sharpe Ratio (Bailey & López de Prado 2014) and
// the effective number of independent trials used as its N.
//
// DSR = Z[ ((SR − SR0) √(T−1)) / √(1 − γ3·SR + (γ4−1)/4·SR²) ]
// SR0 = √V[SR_n] · ( (1−γ)·Z⁻¹[1 − 1/N] + γ·Z⁻¹[1 − 1/(N·e)] )
// where SR is the per-period Sharpe of the candidate, γ3/γ4 its skew/kurtosis,
// V[SR_n] the variance of the trials' Sharpes and N the number of INDEPENDENT
// trials. Bailey & López de Prado state N explicitly as independent trials;
// correlated trials must be reduced to an effective count first (they use
// clustering in López de Prado & Lewis 2019). Two estimators are provided:
//
//  effectiveN.eigen   Li & Ji (2005): M_eff = Σ [ 1(λ_i ≥ 1) + (λ_i − ⌊λ_i⌋) ]
//                     over the eigenvalues of the trials' return correlation matrix.
//  effectiveN.cluster number of single-linkage clusters at |ρ| ≥ 0.5.
//
// The larger of the two is used as N (more trials = harder to pass).

export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const stdev = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
export const moment = (a, k) => { const m = mean(a), s = stdev(a); return s ? mean(a.map((x) => ((x - m) / s) ** k)) : 0; };
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

export function dsr(perPeriodSharpe, T, g3, g4, poolSharpes, N) {
  const vSR = stdev(poolSharpes);
  const sr0 = vSR * ((1 - EULER_G) * normInv(1 - 1 / N) + EULER_G * normInv(1 - 1 / (N * Math.E)));
  const denom = Math.sqrt(Math.max(1e-12, 1 - g3 * perPeriodSharpe + ((g4 - 1) / 4) * perPeriodSharpe ** 2));
  return { dsr: T > 1 ? normCdf(((perPeriodSharpe - sr0) * Math.sqrt(T - 1)) / denom) : 0, sr0 };
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

// Compound per-bar returns into per-UTC-day returns so that correlation is
// measured on a common, less noisy grid.
export function dailyReturns(barRets, times) {
  const out = [], days = []; let day = -1, eq = 1;
  for (let i = 0; i < barRets.length; i++) { const d = Math.floor(times[i] / 86400_000); if (d !== day) { if (day >= 0) { out.push(eq - 1); days.push(day); } day = d; eq = 1; } eq *= 1 + barRets[i]; }
  if (day >= 0) { out.push(eq - 1); days.push(day); }
  return { rets: out, days };
}
