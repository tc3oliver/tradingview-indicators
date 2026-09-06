// DSR trial-count correction — estimate the EFFECTIVE number of independent
// trials for each study from the correlation of the trials' daily returns
// on the selection (validation) split, and recompute IT1's best candidate
// under the corrected N. Writes EFFECTIVE-TRIALS.md.
//
// Bailey & López de Prado (2014) define N as the number of independent
// trials. Splits of one configuration are the same strategy on different
// dates (not separate trials), and parameter neighbours are highly
// correlated. Method and assumptions are stated in the output.
import { writeFileSync, readFileSync } from 'node:fs';
import { effectiveN, dailyReturns, dsr, moment, stdev } from './stats.mjs';

const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const out = {};

// ---- IT1: 144 configurations, 15m engine
{
  const { GRID, simulate, TIMES, SPLITS, cfgName, metrics } = await import('./engine.mjs');
  const [a, b] = SPLITS.validation;
  const series = [], sharpes = [], names = [];
  const runs = [];
  for (const cfg of GRID) {
    const sim = simulate(cfg);
    const d = dailyReturns(sim.barRets, TIMES);
    const idx = d.days.map((day, i) => i).filter((i) => d.days[i] * 86400_000 >= a && d.days[i] * 86400_000 < b);
    series.push(idx.map((i) => d.rets[i]));
    sharpes.push(metrics(sim.trades, sim.barRets, ['validation']).sharpe);
    names.push(cfgName(cfg)); runs.push({ cfg, sim });
  }
  out.IT1 = { ...effectiveN(series), configs: GRID.length, rawEntries: GRID.length * 3, sharpes, runs, names, metrics, SPLITS, TIMES };
}

// ---- TP1: 96 configurations, 4H engine (sibling project)
{
  const E = await import('../../btc-4h-trade-planner/research/engine.mjs');
  const series = [], sharpes = [];
  for (const cfg of E.GRID) {
    const sim = E.simulate(cfg, 'validation');
    // the 4H engine's barRets start at the split start; reconstruct times
    const [a] = E.SPLITS.validation;
    const rows = E.ROWS.filter((r) => r.t >= a).slice(0, sim.barRets.length);
    const d = dailyReturns(sim.barRets, rows.map((r) => r.t));
    series.push(d.rets); sharpes.push(E.metrics(sim).sharpe);
  }
  const L = Math.min(...series.map((s) => s.length));
  out.TP1 = { ...effectiveN(series.map((s) => s.slice(0, L))), configs: E.GRID.length, rawEntries: E.GRID.length * 3 };
}

// ---- Regime engine: 15 configurations; return series are not regenerable
// from a common runner, so the raw configuration count is used (upper bound).
{
  const reg = JSON.parse(readFileSync(new URL('../../btc-4h-regime-engine/trials.json', import.meta.url), 'utf8'));
  const configs = new Set(reg.map((e) => e.hypothesis + '|' + e.config)).size;
  out.REG = { raw: configs, eigen: NaN, cluster: NaN, effective: configs, configs, rawEntries: reg.length, meanAbsRho: NaN };
}

const N_raw = out.IT1.rawEntries + out.TP1.rawEntries + out.REG.rawEntries;
const N_cfg = out.IT1.configs + out.TP1.configs + out.REG.configs;
const N_eff = Math.ceil(out.IT1.effective + out.TP1.effective + out.REG.effective);

// ---- Recompute IT1 DSR for every primary under N_eff (validation ∪ test)
const { runs, sharpes, names, metrics, SPLITS, TIMES } = out.IT1;
const pool = sharpes.map((s) => s / Math.sqrt(96 * 365));
const rows = [];
for (const { cfg, sim } of runs) {
  if (cfg.role !== 'primary') continue;
  const vt = metrics(sim.trades, sim.barRets, ['validation', 'test']);
  const br = vt.barRets, perBar = vt.sharpe / Math.sqrt(96 * 365);
  const old = dsr(perBar, br.length, moment(br, 3), moment(br, 4), pool, 765);
  const nu = dsr(perBar, br.length, moment(br, 3), moment(br, 4), pool, N_eff);
  rows.push({ name: names[runs.findIndex((r) => r.cfg === cfg)], sharpe: vt.sharpe, old: old.dsr, nu: nu.dsr, sr0old: old.sr0 * Math.sqrt(96 * 365), sr0new: nu.sr0 * Math.sqrt(96 * 365), expR: vt.expR });
}
rows.sort((x, y) => y.sharpe - x.sharpe);

let md = `# DSR trial-count correction\n\n` +
  `Bailey & López de Prado (2014) define the DSR's N as the number of **independent** trials. The IT1 run used N = 765 by adding every registry entry (configuration × split, plus the two prior studies' entries). That over-counts twice: the three splits of one configuration are the same strategy on different dates, and parameter neighbours are near-duplicates of their primary. This file replaces that count with an estimated effective number and keeps all three numbers side by side.\n\n` +
  `## Method\n\n` +
  `- Each configuration's sized equity curve on the **validation** split (the selection set) is compounded into daily returns. The Pearson correlation matrix across configurations is computed.\n` +
  `- **Eigenvalue estimator** (Li & Ji 2005): M_eff = Σ [ 1(λ_i ≥ 1) + (λ_i − ⌊λ_i⌋) ] over the correlation matrix's eigenvalues.\n` +
  `- **Cluster estimator**: number of single-linkage clusters at |ρ| ≥ 0.5 (a simplified form of the ONC clustering López de Prado & Lewis 2019 use to count effective trials).\n` +
  `- The **larger** of the two is used per study (more trials = harder to pass). Studies are treated as independent of each other (their effective counts are summed); this ignores any correlation between the 4H and 15m searches, which is conservative.\n` +
  `- Splits are not counted as separate trials. The regime-engine study's return series cannot be regenerated from a common runner, so its raw configuration count is used as an upper bound.\n` +
  `- V[SR] in SR0 is still the variance of all configurations' validation Sharpes (not cluster-aggregated), which keeps the dispersion term unchanged from the original run.\n\n` +
  `## Counts\n\n| study | raw registry entries | configurations | mean \\|ρ\\| | eigen M_eff | clusters (\\|ρ\\|≥0.5) | effective N used |\n|---|---|---|---|---|---|---|\n` +
  `| IT1 (15m intraday) | ${out.IT1.rawEntries} | ${out.IT1.configs} | ${f(out.IT1.meanAbsRho)} | ${f(out.IT1.eigen, 1)} | ${out.IT1.cluster} | ${f(out.IT1.effective, 1)} |\n` +
  `| TP1 (4H trade planner) | ${out.TP1.rawEntries} | ${out.TP1.configs} | ${f(out.TP1.meanAbsRho)} | ${f(out.TP1.eigen, 1)} | ${out.TP1.cluster} | ${f(out.TP1.effective, 1)} |\n` +
  `| Regime engine | ${out.REG.rawEntries} | ${out.REG.configs} | n/a | n/a | n/a | ${out.REG.configs} (upper bound) |\n` +
  `| **total** | **${N_raw}** | **${N_cfg}** | | | | **${N_eff}** |\n\n` +
  `## IT1 under the corrected N (validation ∪ test, top 10 by Sharpe)\n\n| candidate | Sharpe | expR | SR0 @N=765 | DSR @N=765 | SR0 @N=${N_eff} | DSR @N=${N_eff} |\n|---|---|---|---|---|---|---|\n`;
for (const r of rows.slice(0, 10)) md += `| ${r.name.replace(/ buf0.1 2R w\d+$/, '')} | ${f(r.sharpe)} | ${f(r.expR)} | ${f(r.sr0old)} | ${f(r.old, 3)} | ${f(r.sr0new)} | ${f(r.nu, 3)} |\n`;
md += `\nThe corrected N does not change any IT1 verdict: every primary still fails G1 (after-cost expectancy), G2, G3 and G7 regardless of G9. Going forward (IT2, IT3) the DSR uses this effective count, and the study's own trials are added to it with the same estimator.\n`;
writeFileSync(new URL('./EFFECTIVE-TRIALS.md', import.meta.url), md);
writeFileSync(new URL('./effective-trials.json', import.meta.url), JSON.stringify({ IT1: { raw: out.IT1.rawEntries, configs: out.IT1.configs, eigen: out.IT1.eigen, cluster: out.IT1.cluster, effective: out.IT1.effective }, TP1: { raw: out.TP1.rawEntries, configs: out.TP1.configs, eigen: out.TP1.eigen, cluster: out.TP1.cluster, effective: out.TP1.effective }, REG: { raw: out.REG.rawEntries, configs: out.REG.configs, effective: out.REG.configs }, N_raw, N_cfg, N_eff }, null, 1));
console.log(md);
