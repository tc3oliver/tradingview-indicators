// Study IT1 — run all 144 registered configurations, register every trial,
// then apply the nine pre-registered gates to the 36 primaries.
// Implements PRE-REGISTRATION.md §5–§7 and nothing else.
// Usage: node run.mjs   (writes ../trials.json, results.json, RESULTS.md)
import { writeFileSync, readFileSync } from 'node:fs';
import { GRID, PRIMARY, simulate, metrics, cfgName, COST_BASE, COST_STRESS, SPLITS, TIMES } from './engine.mjs';

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const stdev = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
const EULER_G = 0.5772156649015329;
function erf(x) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
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
function dsr(perBarSharpe, T, g3, g4, pool, N) {
  const vSR = stdev(pool);
  const sr0 = vSR * ((1 - EULER_G) * normInv(1 - 1 / N) + EULER_G * normInv(1 - 1 / (N * Math.E)));
  const denom = Math.sqrt(Math.max(1e-12, 1 - g3 * perBarSharpe + ((g4 - 1) / 4) * perBarSharpe * perBarSharpe));
  return { dsr: normCdf(((perBarSharpe - sr0) * Math.sqrt(T - 1)) / denom), sr0 };
}

// ---------------------------------------------------------------- run everything
console.log(`Running ${GRID.length} configurations...`);
const runs = GRID.map((cfg, k) => {
  const sim = simulate(cfg, COST_BASE);
  const by = {};
  for (const s of ['development', 'validation', 'test']) by[s] = metrics(sim.trades, sim.barRets, [s]);
  by.valtest = metrics(sim.trades, sim.barRets, ['validation', 'test']);
  const stress = cfg.role === 'primary' ? COST_STRESS.map((c) => metrics(simulate(cfg, c).trades, [], ['validation', 'test']).expR) : null;
  if (k % 12 === 11) process.stdout.write(`\r  ${k + 1}/${GRID.length}`);
  return { cfg, name: cfgName(cfg), by, stress, trades: sim.trades };
});
process.stdout.write('\n');

// ---------------------------------------------------------------- registry FIRST
const PRIOR = 45 + 288;
const trials = runs.flatMap((r) => ['development', 'validation', 'test'].map((split) => ({
  hypothesis: 'IT1', config: r.name, role: r.cfg.role, split,
  sharpe: r.by[split].sharpe, trades: r.by[split].trades, expR: r.by[split].expR, pf: r.by[split].pf, maxDD: r.by[split].maxDD,
})));
writeFileSync(new URL('../trials.json', import.meta.url), JSON.stringify({ study: 'IT1', preRegistration: 'PRE-REGISTRATION.md', priorEntries: PRIOR, entries: trials }, null, 1));
const N_DSR = PRIOR + trials.length;
console.log(`registered ${trials.length} trials (+${PRIOR} prior) -> N = ${N_DSR}`);

// ---------------------------------------------------------------- gates on the 36 primaries
const pool = runs.map((r) => r.by.validation.sharpe / Math.sqrt(96 * 365)); // per-bar
const results = runs.filter((r) => r.cfg.role === 'primary').map((r, k) => {
  const vt = r.by.valtest;
  const perBar = vt.sharpe / Math.sqrt(96 * 365);
  const br = vt.barRets;
  const { dsr: d, sr0 } = dsr(perBar, br.length, moment(br, 3), moment(br, 4), pool, N_DSR);
  const years = Object.entries(vt.byYear).filter(([, y]) => y.n >= 10);
  const posYears = years.filter(([, y]) => y.netR > 0).length;
  const bestYear = years.length ? Math.max(...years.map(([, y]) => y.netR)) : 0;
  const neigh = runs.filter((x) => x.cfg.of === k);
  const G = {
    G1: r.by.development.expR > 0 && r.by.validation.expR > 0 && r.by.test.expR > 0,
    G2: vt.pf >= 1.20,
    G3: vt.pfExBest > 1.0,
    G4: vt.trades >= 60,
    G5: years.length > 0 && posYears / years.length >= 0.5 && vt.netR - bestYear > 0,
    G6: vt.topWinnerShare < 0.25,
    G7: r.stress[0] > 0,
    G8: neigh.filter((x) => x.by.valtest.expR > 0).length >= 2,
    G9: d >= 0.95,
  };
  const failed = Object.keys(G).filter((g) => !G[g]);
  const verdict = !G.G4 ? 'INSUFFICIENT' : failed.length === 0 ? 'RETROSPECTIVE PASS' : 'REJECTED';
  return { k, name: r.name, cfg: r.cfg, by: r.by, stress: r.stress, G, failed, verdict, dsr: d, sr0: sr0 * Math.sqrt(96 * 365), neigh: neigh.map((x) => ({ role: x.cfg.role, expR: x.by.valtest.expR, trades: x.by.valtest.trades })) };
});

// ---------------------------------------------------------------- report
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : x === Infinity ? '∞' : 'n/a');
const pct = (x) => f(x * 100, 1) + '%';
const counts = results.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] || 0) + 1), a), {});
let md = `# Study IT1 — results\n\nRETROSPECTIVE RESEARCH on 2020-01 → 2026-09 BTCUSDT perpetual 15m. Gates and grid frozen in PRE-REGISTRATION.md before this run. ` +
  `Registry: ${trials.length} entries this study + ${PRIOR} prior = N ${N_DSR} for the DSR. Noise floor SR0 (expected best annualised Sharpe of ${N_DSR} zero-edge trials at this study's dispersion): **${f(results[0].sr0)}**.\n\n` +
  `## Verdicts\n\n${Object.entries(counts).map(([k, v]) => `- **${k}**: ${v}`).join('\n')}\n\n`;

md += `## Primary candidates — validation ∪ test (base cost 0.14% RT)\n\n| # | candidate | verdict | failed | n | expR | win | avgW/avgL | PF | PF ex-best5% | Sharpe | Sortino | maxDD | Calmar | MAE avg/worst | MFE avg | expo | trades/yr | streak | top win | stop% | sess-exit% | dev expR (n) | val expR (n) | test expR (n) | expR @0.20% | @0.30% | DSR |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of results) {
  const v = r.by.valtest;
  md += `| ${r.k + 1} | ${r.name.replace(/ buf0.1 2R w\d+$/, '')} | ${r.verdict} | ${r.failed.join(' ') || '—'} | ${v.trades} | ${f(v.expR)} | ${pct(v.winRate)} | ${f(v.avgWin)}/${f(v.avgLoss)} | ${f(v.pf)} | ${f(v.pfExBest)} | ${f(v.sharpe)} | ${f(v.sortino)} | ${pct(v.maxDD)} | ${f(v.calmar)} | ${f(v.avgMAE)}/${f(v.worstMAE)} | ${f(v.avgMFE)} | ${pct(v.exposure)} | ${f(v.turnoverPerYear, 0)} | ${v.worstStreak} | ${pct(v.topWinnerShare)} | ${pct(v.stopRate)} | ${pct(v.sessionExitRate)} | ${f(r.by.development.expR)} (${r.by.development.trades}) | ${f(r.by.validation.expR)} (${r.by.validation.trades}) | ${f(r.by.test.expR)} (${r.by.test.trades}) | ${f(r.stress[0])} | ${f(r.stress[1])} | ${f(r.dsr, 3)} |\n`;
}

md += `\n## Year and weekday breakdown (validation ∪ test, net R / trades)\n\n| # | candidate | ${['2024', '2025', '2026'].join(' | ')} | Mon | Tue | Wed | Thu | Fri | neighbours n1/n2/n3 expR |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of results) {
  const v = r.by.valtest;
  const y = (k) => (v.byYear[k] ? `${f(v.byYear[k].netR, 1)} / ${v.byYear[k].n}` : '—');
  const d = (k) => (v.byDow[k] ? `${f(v.byDow[k].netR, 1)} / ${v.byDow[k].n}` : '—');
  md += `| ${r.k + 1} | ${r.name.replace(/ buf0.1 2R w\d+$/, '')} | ${y('2024')} | ${y('2025')} | ${y('2026')} | ${d('Mon')} | ${d('Tue')} | ${d('Wed')} | ${d('Thu')} | ${d('Fri')} | ${r.neigh.map((n) => f(n.expR)).join(' / ')} |\n`;
}

md += `\n## Gate detail\n\n| # | candidate | ${Object.keys(results[0].G).join(' | ')} |\n|---|---|${Object.keys(results[0].G).map(() => '---').join('|')}|\n`;
for (const r of results) md += `| ${r.k + 1} | ${r.name.replace(/ buf0.1 2R w\d+$/, '')} | ${Object.values(r.G).map((g) => (g ? '✓' : '✗')).join(' | ')} |\n`;

md += `\n## All 144 registered configurations — validation ∪ test\n\n| config | role | n | expR | PF | Sharpe | maxDD |\n|---|---|---|---|---|---|---|\n`;
for (const r of runs) md += `| ${r.name} | ${r.cfg.role} | ${r.by.valtest.trades} | ${f(r.by.valtest.expR)} | ${f(r.by.valtest.pf)} | ${f(r.by.valtest.sharpe)} | ${pct(r.by.valtest.maxDD)} |\n`;

writeFileSync(new URL('./RESULTS.md', import.meta.url), md);
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(results.map((r) => ({ ...r, by: Object.fromEntries(Object.entries(r.by).map(([k, v]) => [k, { ...v, barRets: undefined }])) })), null, 1));
console.log(Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', '));
for (const r of results) console.log(`${r.verdict.padEnd(18)} ${r.name.padEnd(44)} n=${String(r.by.valtest.trades).padStart(4)} expR=${f(r.by.valtest.expR)} PF=${f(r.by.valtest.pf)} DSR=${f(r.dsr, 3)} failed=${r.failed.join(' ')}`);
