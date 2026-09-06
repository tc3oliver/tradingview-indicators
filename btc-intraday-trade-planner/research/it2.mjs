// IT2 — replication of Shen, Urquhart & Wang (2022), exactly as pre-registered
// in PRE-REGISTRATION-IT2-IT3.md. Usage: node it2.mjs
// Writes RESULTS-IT2.md, results-it2.json and appends IT2 trials to ../trials.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { mean, stdev, moment, dsr, effectiveN } from './stats.mjs';

// ---------------------------------------------------------------- 1m data
function load1m(market) {
  const buf = readFileSync(new URL(`../data/cache/btc-1m-${market}.bin`, import.meta.url));
  const nl = buf.indexOf(10);
  const h = JSON.parse(buf.subarray(0, nl).toString());
  const cols = {}; let off = nl + 1;
  for (const c of h.cols) { const ab = new ArrayBuffer(h.n * 8); Buffer.from(ab).set(buf.subarray(off, off + h.n * 8)); cols[c] = new Float64Array(ab); off += h.n * 8; }
  const idx = new Map(); for (let i = 0; i < h.n; i++) idx.set(cols.t[i], i);
  return { ...cols, n: h.n, idx, market };
}
// price at boundary B = close of the 1m bar ending at B; fall back to the last bar within 30 minutes
function priceAt(D, B) { for (let k = 1; k <= 30; k++) { const i = D.idx.get(B - k * 60_000); if (i !== undefined) return D.c[i]; } return NaN; }
function window(D, from, to) { const out = []; for (let t = from; t < to; t += 60_000) { const i = D.idx.get(t); if (i !== undefined) out.push(i); } return out; }

// ---------------------------------------------------------------- timing definitions
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function nyOffsetMs(y, m, d) { // UTC offset of New York at local noon on that date
  const guess = Date.UTC(y, m - 1, d, 17); const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute); return local - guess;
}
const DEFS = [
  { id: 'primary', open: 9 * 60 + 30, tz: 'NY' },
  { id: 'open0900', open: 9 * 60, tz: 'NY' },
  { id: 'fixedEST', open: 9 * 60 + 30, tz: 'EST' },
  { id: 'open0900-fixedEST', open: 9 * 60, tz: 'EST' },
];
const at = (def, y, m, d, hm) => { const off = def.tz === 'NY' ? nyOffsetMs(y, m, d) : -5 * 3600_000; return Date.UTC(y, m - 1, d, 0, 0) + hm * 60_000 - off; };

// ---------------------------------------------------------------- build the daily table
function dailyTable(D, def, from, to) {
  const days = [];
  let prevClose = NaN;
  for (let t = Date.parse(from + 'T00:00:00Z') - 86400_000; t <= Date.parse(to + 'T00:00:00Z'); t += 86400_000) {
    const dt = new Date(t), y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    const tClose = at(def, y, m, d, 17 * 60), tOpen = at(def, y, m, d, def.open), tO30 = tOpen + 30 * 60_000, tC60 = tClose - 60 * 60_000, tC30 = tClose - 30 * 60_000;
    const pC = priceAt(D, tClose), pO = priceAt(D, tOpen), pO30 = priceAt(D, tO30), pC60 = priceAt(D, tC60), pC30 = priceAt(D, tC30);
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (key >= from && [pC, pO, pO30, pC60, pC30, prevClose].every(Number.isFinite)) {
      const fh = window(D, tOpen, tO30);
      const vol = fh.reduce((s, i) => s + D.v[i], 0);
      const rets = []; for (let k = 1; k < fh.length; k++) rets.push(Math.log(D.c[fh[k]] / D.c[fh[k - 1]]));
      days.push({ key, year: y, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), rONFH: pO30 / prevClose - 1, rON: pO / prevClose - 1, rFH: pO30 / pO - 1, rSLH: pC30 / pC60 - 1, rLH: pC / pC30 - 1, vol, sig: fh.length >= 10 ? stdev(rets) : NaN, pC30, pC });
    }
    prevClose = pC;
  }
  return days;
}

// ---------------------------------------------------------------- statistics
function olsNW(y, X, lag = 5) { // X: array of rows (without intercept)
  const n = y.length, k = X[0].length + 1;
  const Z = X.map((r) => [1, ...r]);
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0)), Xty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { Xty[a] += Z[i][a] * y[i]; for (let b = 0; b < k; b++) XtX[a][b] += Z[i][a] * Z[i][b]; }
  const inv = invert(XtX), beta = inv.map((r) => r.reduce((s, v, j) => s + v * Xty[j], 0));
  const e = y.map((yi, i) => yi - Z[i].reduce((s, v, j) => s + v * beta[j], 0));
  // Newey-West: S = Σ_l w_l Σ_t e_t e_{t-l} x_t x_{t-l}'
  const S = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let l = 0; l <= lag; l++) {
    const w = 1 - l / (lag + 1); // Bartlett kernel
    for (let t = l; t < n; t++) for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) {
      S[a][b] += w * e[t] * e[t - l] * Z[t][a] * Z[t - l][b];
      if (l > 0) S[a][b] += w * e[t] * e[t - l] * Z[t - l][a] * Z[t][b]; // symmetric lag term
    }
  }
  const V = mul(mul(inv, S), inv);
  const se = beta.map((_, j) => Math.sqrt(Math.max(0, V[j][j])));
  const ybar = mean(y), r2 = 1 - e.reduce((s, v) => s + v * v, 0) / y.reduce((s, v) => s + (v - ybar) ** 2, 0);
  return { beta, t: beta.map((b, j) => (se[j] ? b / se[j] : 0)), r2, n };
}
function invert(A) { const n = A.length, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; const d = M[c][c]; for (let j = 0; j < 2 * n; j++) M[c][j] /= d; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; } } return M.map((r) => r.slice(n)); }
function mul(A, B) { return A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0))); }
function oosR2(y, x, minN = 365) { // expanding-window forecast vs historical mean
  let num = 0, den = 0;
  for (let t = minN; t < y.length; t++) {
    const ys = y.slice(0, t), xs = x.slice(0, t), mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0; for (let i = 0; i < t; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    const b = sxx ? sxy / sxx : 0, a = my - b * mx;
    num += (y[t] - (a + b * x[t])) ** 2; den += (y[t] - my) ** 2;
  }
  return den ? 1 - num / den : NaN;
}
const tercile = (vals) => { const s = [...vals].filter(Number.isFinite).sort((a, b) => a - b); return [s[Math.floor(s.length / 3)], s[Math.floor((2 * s.length) / 3)]]; };
function terciles(days, key, withinYear) {
  const lab = new Array(days.length).fill('n/a');
  const groups = withinYear ? [...new Set(days.map((d) => d.year))].map((y) => days.map((d, i) => i).filter((i) => days[i].year === y)) : [days.map((_, i) => i)];
  for (const g of groups) { const [q1, q2] = tercile(g.map((i) => days[i][key])); for (const i of g) { const v = days[i][key]; lab[i] = !Number.isFinite(v) ? 'n/a' : v < q1 ? 'low' : v < q2 ? 'medium' : 'high'; } }
  return lab;
}
function regress(days) {
  if (days.length < 30) return null;
  const y = days.map((d) => d.rLH), x1 = days.map((d) => d.rONFH), x2 = days.map((d) => d.rSLH);
  const a = olsNW(y, x1.map((v) => [v])), b = olsNW(y, x2.map((v) => [v])), c = olsNW(y, days.map((d) => [d.rONFH, d.rSLH]));
  const dec = olsNW(y, days.map((d) => [d.rON, d.rFH, d.rSLH]));
  return { n: days.length, bONFH: a.beta[1], tONFH: a.t[1], r2: a.r2, r2oos: days.length > 400 ? oosR2(y, x1) : NaN, bSLH: b.beta[1], tSLH: b.t[1], r2SLH: b.r2, joint: { bONFH: c.beta[1], tONFH: c.t[1], bSLH: c.beta[2], tSLH: c.t[2], r2: c.r2 }, dec: { bON: dec.beta[1], tON: dec.t[1], bFH: dec.beta[2], tFH: dec.t[2] }, hit: mean(days.map((d) => (Math.sign(d.rONFH) === Math.sign(d.rLH) ? 1 : 0))) };
}

// ---------------------------------------------------------------- timing strategies
const RULES = {
  ONFH: (d) => (d.rONFH > 0 ? 1 : -1),
  SLH: (d) => (d.rSLH < 0 ? 1 : -1),
  BOTH: (d) => (d.rONFH > 0 && d.rSLH < 0 ? 1 : d.rONFH <= 0 && d.rSLH >= 0 ? -1 : 0),
  ALWAYS_LONG: () => 1,
};
function strategy(days, rule, costRT = 0) {
  const tr = days.map((d) => { const pos = rule(d); return { ...d, pos, gross: pos * d.rLH, net: pos === 0 ? 0 : pos * d.rLH - costRT }; }).filter((t) => t.pos !== 0);
  const g = tr.map((t) => t.gross), nt = tr.map((t) => t.net);
  const wins = nt.filter((r) => r > 0), losses = nt.filter((r) => r <= 0);
  const pf = (rs) => { const gp = rs.filter((r) => r > 0).reduce((s, r) => s + r, 0), gl = -rs.filter((r) => r < 0).reduce((s, r) => s + r, 0); return gl > 0 ? gp / gl : gp > 0 ? Infinity : 0; };
  const sorted = [...nt].sort((a, b) => b - a), exBest = sorted.slice(Math.ceil(sorted.length * 0.05));
  let eq = 1, peak = 1, maxDD = 0; for (const r of nt) { eq *= 1 + r; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak); }
  let streak = 0, worst = 0; for (const r of nt) { streak = r <= 0 ? streak + 1 : 0; worst = Math.max(worst, streak); }
  const nw = tr.length > 30 ? olsNW(g, g.map(() => []), 5) : { t: [0] };
  return { trades: tr.length, grossMean: mean(g), grossT: nw.t[0], netMean: mean(nt), annGross: mean(g) * 365 * (tr.length / days.length), annNet: mean(nt) * 365 * (tr.length / days.length), sharpe: stdev(nt) ? (mean(nt) / stdev(nt)) * Math.sqrt(365 * (tr.length / days.length)) : 0, success: mean(nt.map((r) => (r > 0 ? 1 : 0))), pf: pf(nt), pfExBest: pf(exBest), maxDD, worstStreak: worst, avgWin: mean(wins), avgLoss: mean(losses), rets: nt, trades_: tr };
}

// ---------------------------------------------------------------- run
const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : x === Infinity ? '∞' : 'n/a');
const pct = (x, d = 3) => (Number.isFinite(x) ? (x * 100).toFixed(d) + '%' : 'n/a');
const COSTS = [0.0014, 0.0020, 0.0030];
const PERIODS = { P1: ['2017-08-17', '2020-12-31'], GAP: ['2021-01-01', '2021-12-31'], P2: ['2022-01-01', '2026-09-06'] };
const spot = load1m('spot'), perp = load1m('perp');
const runs = {};
for (const [pid, [from, to]] of Object.entries(PERIODS)) for (const D of [spot, perp]) {
  if (pid === 'P1' && D.market === 'perp') continue;
  for (const def of DEFS) {
    const days = dailyTable(D, def, from, to);
    if (days.length < 30) continue;
    const volT = terciles(days, 'vol', true), sigT = terciles(days, 'sig', false);
    const sub = (pred) => regress(days.filter((_, i) => pred(days[i], i)));
    const r = {
      period: pid, market: D.market, def: def.id, n: days.length,
      desc: { rONFH: [mean(days.map((d) => d.rONFH)), stdev(days.map((d) => d.rONFH))], rSLH: [mean(days.map((d) => d.rSLH)), stdev(days.map((d) => d.rSLH))], rLH: [mean(days.map((d) => d.rLH)), stdev(days.map((d) => d.rLH))], absLH: mean(days.map((d) => Math.abs(d.rLH))) },
      reg: regress(days),
      vol: { high: sub((d, i) => volT[i] === 'high'), medium: sub((d, i) => volT[i] === 'medium'), low: sub((d, i) => volT[i] === 'low') },
      sig: { high: sub((d, i) => sigT[i] === 'high'), medium: sub((d, i) => sigT[i] === 'medium'), low: sub((d, i) => sigT[i] === 'low') },
      byYear: Object.fromEntries([...new Set(days.map((d) => d.year))].map((y) => [y, { reg: sub((d) => d.year === y), strat: strategy(days.filter((d) => d.year === y), RULES.ONFH, COSTS[0]) }])),
      weekday: { reg: sub((d) => d.dow >= 1 && d.dow <= 5), strat: strategy(days.filter((d) => d.dow >= 1 && d.dow <= 5), RULES.ONFH, COSTS[0]) },
      weekend: { reg: sub((d) => d.dow === 0 || d.dow === 6), strat: strategy(days.filter((d) => d.dow === 0 || d.dow === 6), RULES.ONFH, COSTS[0]) },
      strat: Object.fromEntries(Object.entries(RULES).map(([k, rule]) => [k, Object.fromEntries([0, ...COSTS].map((c) => [c, strategy(days, rule, c)]))])),
      long: strategy(days.filter((d) => d.rONFH > 0), RULES.ONFH, COSTS[0]), short: strategy(days.filter((d) => d.rONFH <= 0), RULES.ONFH, COSTS[0]),
      volHighStrat: strategy(days.filter((_, i) => volT[i] === 'high'), RULES.ONFH, COSTS[0]), volOtherStrat: strategy(days.filter((_, i) => volT[i] !== 'high' && volT[i] !== 'n/a'), RULES.ONFH, COSTS[0]),
      costRatio: { vsAbsMove: COSTS[0] / mean(days.map((d) => Math.abs(d.rLH))), vsGross: COSTS[0] / Math.max(1e-12, strategy(days, RULES.ONFH, 0).grossMean) },
    };
    runs[`${pid}|${D.market}|${def.id}`] = r;
    console.log(`${pid} ${D.market} ${def.id}: n=${r.n} βONFH=${f(r.reg.bONFH)} t=${f(r.reg.tONFH, 2)} R²=${pct(r.reg.r2, 2)} hit=${pct(r.reg.hit, 1)} η(ONFH) gross/trade=${pct(r.strat.ONFH[0].grossMean)} net@0.14=${pct(r.strat.ONFH[0.0014].netMean)}`);
  }
}

// ---------------------------------------------------------------- registry, effective N, DSR
const P2 = runs['P2|perp|primary'];
const variants = Object.entries(runs).filter(([k]) => k.startsWith('P2|perp|')).flatMap(([k, r]) => ['ONFH', 'SLH', 'BOTH'].map((rule) => ({ key: `${k}|${rule}`, s: r.strat[rule][0.0014] })));
const L = Math.min(...variants.map((v) => v.s.rets.length));
const effIT2 = effectiveN(variants.map((v) => v.s.rets.slice(0, L)));
const prior = JSON.parse(readFileSync(new URL('./effective-trials.json', import.meta.url), 'utf8'));
const N_eff = Math.ceil(prior.N_eff + effIT2.effective);
const reg = JSON.parse(readFileSync(new URL('../trials.json', import.meta.url), 'utf8'));
reg.entries = reg.entries.filter((e) => e.hypothesis !== 'IT2').concat(variants.map((v) => ({ hypothesis: 'IT2', config: v.key, split: 'post-publication', sharpe: v.s.sharpe, trades: v.s.trades, expR: v.s.netMean })));
reg.effectiveN = { prior: prior.N_eff, IT2: effIT2, total: N_eff };
writeFileSync(new URL('../trials.json', import.meta.url), JSON.stringify(reg, null, 1));
const cand = P2.strat.ONFH[0.0014];
const perDay = cand.sharpe / Math.sqrt(365), pool = variants.map((v) => v.s.sharpe / Math.sqrt(365));
const D = dsr(perDay, cand.rets.length, moment(cand.rets, 3), moment(cand.rets, 4), pool, N_eff);

// ---------------------------------------------------------------- gates
const P1 = runs['P1|spot|primary'], P2s = runs['P2|spot|primary'];
const replication = P1.reg.bONFH > 0 && P1.reg.tONFH >= 1.96 && P1.vol.high && P1.vol.low && P1.vol.high.bONFH > P1.vol.low.bONFH ? 'REPLICATED' : P1.reg.bONFH > 0 && P1.reg.tONFH >= 1.65 ? 'PARTIAL' : 'NOT REPLICATED';
const years = Object.entries(P2.byYear).filter(([, y]) => y.strat.trades >= 100);
const posYears = years.filter(([, y]) => y.strat.netMean > 0).length;
const bestYear = Math.max(...years.map(([, y]) => y.strat.rets.reduce((s, r) => s + r, 0)));
const totalNet = cand.rets.reduce((s, r) => s + r, 0);
const G = {
  A1: replication === 'REPLICATED',
  A2: P2.reg.bONFH > 0 && P2.reg.tONFH >= 1.96 && P2s.reg.bONFH > 0,
  A3: cand.grossMean > 0 && cand.grossT >= 1.96,
  A4: cand.netMean > 0,
  A5: P2.strat.ONFH[0.0020].netMean > 0,
  A6: years.length > 0 && posYears / years.length >= 0.6 && totalNet - bestYear > 0,
  A7: cand.pfExBest > 1.0,
  A10: cand.trades >= 500,
  A11: D.dsr >= 0.95,
};
const failed = Object.keys(G).filter((g) => !G[g]);
const verdict = failed.length ? 'REJECT' : 'RETROSPECTIVE PASS';

// ---------------------------------------------------------------- report
const regRow = (r) => (r ? `${f(r.bONFH)} (t ${f(r.tONFH, 2)}), R² ${pct(r.r2, 2)}, n ${r.n}` : 'n/a');
const stratRow = (s) => `${s.trades} | ${pct(s.grossMean)} | ${f(s.grossT, 2)} | ${pct(s.netMean)} | ${pct(s.annNet, 1)} | ${f(s.sharpe, 2)} | ${pct(s.success, 1)} | ${f(s.pf, 2)} | ${f(s.pfExBest, 2)} | ${pct(s.maxDD, 1)} | ${s.worstStreak}`;
let md = `# IT2 — results: Bitcoin intraday time-series momentum replication\n\nRETROSPECTIVE RESEARCH. 2022-01 → 2026-09 is a POST-PUBLICATION RETROSPECTIVE TEST. Rules frozen in PRE-REGISTRATION-IT2-IT3.md (commit b2ac11d).\n\n` +
  `## Verdict: **${verdict}** — replication: **${replication}**; failed gates: ${failed.join(', ') || 'none'}\n\n` +
  `| gate | result |\n|---|---|\n` + Object.entries(G).map(([k, v]) => `| ${k} | ${v ? '✓' : '✗'} |`).join('\n') + `\n\n` +
  `## Phase 1 — paper period on Binance spot (2017-08-17 → 2020-12-31)\n\n| definition | n | mean r_ONFH / sd | mean r_LH / sd | β_ONFH (NW t), R² | R²_OOS | β_SLH (t) | joint β_ONFH (t) | hit rate | β_ON (t) / β_FH (t) |\n|---|---|---|---|---|---|---|---|---|---|\n`;
for (const def of DEFS) { const r = runs[`P1|spot|${def.id}`]; if (!r) continue; md += `| ${def.id} | ${r.n} | ${pct(r.desc.rONFH[0])} / ${pct(r.desc.rONFH[1], 2)} | ${pct(r.desc.rLH[0])} / ${pct(r.desc.rLH[1], 2)} | ${regRow(r.reg)} | ${pct(r.reg.r2oos, 2)} | ${f(r.reg.bSLH, 2)} (${f(r.reg.tSLH, 2)}) | ${f(r.reg.joint.bONFH)} (${f(r.reg.joint.tONFH, 2)}) | ${pct(r.reg.hit, 1)} | ${f(r.reg.dec.bON)} (${f(r.reg.dec.tON, 2)}) / ${f(r.reg.dec.bFH)} (${f(r.reg.dec.tFH, 2)}) |\n`; }
const terTable = (r) => `| volume high | ${regRow(r.vol.high)} |\n| volume medium | ${regRow(r.vol.medium)} |\n| volume low | ${regRow(r.vol.low)} |\n| volatility high | ${regRow(r.sig.high)} |\n| volatility medium | ${regRow(r.sig.medium)} |\n| volatility low | ${regRow(r.sig.low)} |\n`;
md += `\nPaper: β_ONFH 0.968 (t 4.38), R² 1.44%, R²_OOS 1.09%; β_SLH −9.778 (t −10.22).\n\n### Terciles, primary definition (paper: volume high 2.013 t 4.74 / low 0.430 n.s.; volatility high 2.012 t 6.25 / low n.s.)\n\n| subset | β_ONFH (NW t), R², n |\n|---|---|\n${terTable(P1)}\n`;
md += `### Timing rules, primary definition, gross (paper: η(ONFH) 7.82%/yr Sharpe 0.65 success 51.6%; η(SLH) 17.3% / 1.72 / 56.1%; η(both) 16.7% / 1.72 / 58.1%; always-long 6.54%)\n\n| rule | trades | gross/trade | NW t | net/trade @0 | ann. | Sharpe | success | PF | PF ex-5% | maxDD | streak |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const k of Object.keys(RULES)) md += `| ${k} | ${stratRow(P1.strat[k][0])} |\n`;
md += `\n## Gap year 2021 (paper sample ended 2020-12-31; published online 2021-10)\n\n| market | β_ONFH (t), R², n | η(ONFH) gross/trade | net @0.14% |\n|---|---|---|---|\n`;
for (const m of ['spot', 'perp']) { const r = runs[`GAP|${m}|primary`]; md += `| ${m} | ${regRow(r.reg)} | ${pct(r.strat.ONFH[0].grossMean)} | ${pct(r.strat.ONFH[0.0014].netMean)} |\n`; }
md += `\n## Phase 2 — post-publication retrospective test (2022-01-01 → 2026-09-06)\n\n| market | definition | n | β_ONFH (NW t), R² | R²_OOS | β_SLH (t) | hit rate | mean \\|r_LH\\| |\n|---|---|---|---|---|---|---|---|\n`;
for (const m of ['perp', 'spot']) for (const def of DEFS) { const r = runs[`P2|${m}|${def.id}`]; md += `| ${m} | ${def.id} | ${r.n} | ${regRow(r.reg)} | ${pct(r.reg.r2oos, 2)} | ${f(r.reg.bSLH, 2)} (${f(r.reg.tSLH, 2)}) | ${pct(r.reg.hit, 1)} | ${pct(r.desc.absLH)} |\n`; }
md += `\n### Terciles, perpetual, primary definition\n\n| subset | β_ONFH (NW t), R², n |\n|---|---|\n${terTable(P2)}\n`;
md += `### By year, perpetual, primary — regression and η(ONFH) net @0.14%\n\n| year | β_ONFH (t), R², n | trades | gross/trade | NW t | net/trade | ann. net | Sharpe | success | PF | PF ex-5% | maxDD | streak |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const [y, v] of Object.entries(P2.byYear)) md += `| ${y} | ${regRow(v.reg)} | ${stratRow(v.strat)} |\n`;
md += `\n### Weekday / weekend, long / short, volume terciles — perpetual, primary, η(ONFH) net @0.14%\n\n| subset | β_ONFH (t), R², n | trades | gross/trade | NW t | net/trade | ann. net | Sharpe | success | PF | PF ex-5% | maxDD | streak |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n` +
  `| weekday | ${regRow(P2.weekday.reg)} | ${stratRow(P2.weekday.strat)} |\n| weekend | ${regRow(P2.weekend.reg)} | ${stratRow(P2.weekend.strat)} |\n| long-signal days | — | ${stratRow(P2.long)} |\n| short-signal days | — | ${stratRow(P2.short)} |\n| high-volume tercile days | ${regRow(P2.vol.high)} | ${stratRow(P2.volHighStrat)} |\n| other volume days | — | ${stratRow(P2.volOtherStrat)} |\n`;
md += `\n## Phase 3 — economic implementation, perpetual, primary definition\n\n**COST / EXPECTED MOVE RATIO** (0.14% RT): ÷ mean \\|r_LH\\| = **${f(P2.costRatio.vsAbsMove, 2)}**; ÷ gross mean profit per trade of η(ONFH) = **${f(P2.costRatio.vsGross, 1)}**. Paper's own break-even for η(ONFH): 3 bps.\n\n| rule | cost RT | trades | gross/trade | NW t | net/trade | ann. net | Sharpe | success | PF | PF ex-5% | maxDD | streak |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const k of ['ONFH', 'SLH', 'BOTH', 'ALWAYS_LONG']) for (const c of [0, ...COSTS]) md += `| ${k} | ${pct(c, 2)} | ${stratRow(P2.strat[k][c])} |\n`;
md += `\n## Multiple testing\n\nIT2 registered variants: ${variants.length} (3 rules × 4 timing definitions); effective ${f(effIT2.effective, 1)} (eigen ${f(effIT2.eigen, 1)}, clusters ${effIT2.cluster}, mean |ρ| ${f(effIT2.meanAbsRho, 2)}). Prior effective N ${prior.N_eff} → N = ${N_eff}. η(ONFH) primary: daily Sharpe ${f(cand.sharpe, 2)} annualised, SR0 ${f(D.sr0 * Math.sqrt(365), 2)}, **DSR ${f(D.dsr, 3)}**.\n`;
writeFileSync(new URL('./RESULTS-IT2.md', import.meta.url), md);
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'rets' || k === 'trades_' ? undefined : v)));
writeFileSync(new URL('./results-it2.json', import.meta.url), JSON.stringify({ verdict, replication, gates: G, failed, N_eff, effIT2, dsr: D, runs: strip(runs) }, null, 1));
console.log(`\n${verdict} — replication ${replication}; failed: ${failed.join(' ') || 'none'}; DSR ${f(D.dsr, 3)} (N=${N_eff})`);
