// IT3 — Lower-turnover 1H short-horizon trading (pre-registered fallback).
// Implements PRE-REGISTRATION-IT2-IT3.md, IT3 §1–§5, and nothing else.
// Runs only if IT2 is REJECTED (checked from results-it2.json).
// Usage: node it3.mjs   → RESULTS-IT3.md, results-it3.json, IT3 entries in ../trials.json
import { readFileSync, writeFileSync } from 'node:fs';
import { mean, stdev, moment, dsr, effectiveN, dailyReturns } from './stats.mjs';

const it2 = JSON.parse(readFileSync(new URL('./results-it2.json', import.meta.url), 'utf8'));
if (it2.verdict !== 'REJECT') { console.log(`IT2 verdict is ${it2.verdict}; IT3 does not run.`); process.exit(0); }

// ---------------------------------------------------------------- 1H bars from the 15m cache
const m15 = JSON.parse(readFileSync(new URL('../data/cache/btc-15m.json', import.meta.url), 'utf8'));
const bars = [];
for (let i = 0; i + 3 < m15.length; i += 4) {
  if (m15[i].t % 3600_000 !== 0) throw new Error('15m grid not hour-aligned at ' + i);
  bars.push({ t: m15[i].t, o: m15[i].o, h: Math.max(...m15.slice(i, i + 4).map((b) => b.h)), l: Math.min(...m15.slice(i, i + 4).map((b) => b.l)), c: m15[i + 3].c });
}
const N = bars.length, O = bars.map((b) => b.o), H = bars.map((b) => b.h), L = bars.map((b) => b.l), C = bars.map((b) => b.c), T = bars.map((b) => b.t);
export const COST_BASE = 0.0007, COST_STRESS = [0.0010, 0.0015], RISK = 0.01, MAX_LEV = 3, START_EQ = 10_000, BARS_PER_YEAR = 24 * 365;
const SPLITS = { development: [Date.parse('2020-01-01T00:00:00Z'), Date.parse('2024-01-01T00:00:00Z')], validation: [Date.parse('2024-01-01T00:00:00Z'), Date.parse('2025-07-01T00:00:00Z')], test: [Date.parse('2025-07-01T00:00:00Z'), Date.parse('2026-09-07T00:00:00Z')] };
const splitOf = (t) => Object.keys(SPLITS).find((k) => t >= SPLITS[k][0] && t < SPLITS[k][1]);

// ATR24 (Wilder, SMA-seeded), 24H return, σ24 from 30 non-overlapping daily returns
const ATR = new Array(N).fill(NaN);
{ let sum = 0, rma = null; for (let i = 1; i < N; i++) { const tr = Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])); if (i <= 24) { sum += tr; if (i === 24) rma = sum / 24; } else rma = (rma * 23 + tr) / 24; if (rma !== null) ATR[i] = rma; } }
const RET24 = new Array(N).fill(NaN); for (let i = 24; i < N; i++) RET24[i] = C[i] / C[i - 24] - 1;
const SIG24 = new Array(N).fill(NaN);
{ const daily = []; for (let i = 0; i < N; i++) { if (T[i] % 86400_000 === 0 && i >= 24) { daily.push(RET24[i]); } SIG24[i] = daily.length > 30 ? stdev(daily.slice(-31, -1)) : NaN; } }
// Note: σ24 at bar i uses the 30 daily returns BEFORE the current day's (the slice excludes the last pushed value on midnight bars).
const rollHigh = (w) => { const r = new Array(N).fill(NaN); for (let i = w; i < N; i++) { let m = -Infinity; for (let k = i - w; k < i; k++) m = Math.max(m, H[k]); r[i] = m; } return r; };
const rollLow = (w) => { const r = new Array(N).fill(NaN); for (let i = w; i < N; i++) { let m = Infinity; for (let k = i - w; k < i; k++) m = Math.min(m, L[k]); r[i] = m; } return r; };
const HH = { 24: rollHigh(24), 48: rollHigh(48) }, LL = { 24: rollLow(24), 48: rollLow(48) };

// ---------------------------------------------------------------- candidates
const cfgName = (c) => `${c.family} ${c.dir} stop${c.stopATR} hold${c.holdBars}${c.family === 'A' ? ' range' + c.win : ' thr' + c.thr}`;
function signal(cfg, i) {
  const long = cfg.dir === 'long';
  if (!Number.isFinite(ATR[i])) return false;
  if (cfg.family === 'A') return long ? C[i] > HH[cfg.win][i] : C[i] < LL[cfg.win][i];
  if (T[i] % 86400_000 !== 0 || !Number.isFinite(SIG24[i]) || !Number.isFinite(RET24[i])) return false;
  const z = RET24[i] / SIG24[i];
  if (cfg.family === 'B') return long ? z > cfg.thr : z < -cfg.thr;
  if (cfg.family === 'C') return long ? z < -cfg.thr : z > cfg.thr;
}
export function simulate(cfg, costSide = COST_BASE) {
  const long = cfg.dir === 'long', sgn = long ? 1 : -1;
  let cash = START_EQ, pending = null, pos = null, prevMark = START_EQ, expBars = 0;
  const trades = [], barRets = new Array(N).fill(0), planned = [];
  const close = (i, px, reason) => {
    const gross = sgn * (px - pos.fill) * pos.qty, cost = costSide * px * pos.qty; cash += gross - cost;
    const Rd = pos.Rp * pos.qty;
    trades.push({ sig: pos.sig, t: T[pos.sig], fill: pos.fill, stop: pos.stop, exitBar: i, px, reason, R: (gross - cost - pos.entryCost) / Rd, grossR: gross / Rd, mae: pos.mae, mfe: pos.mfe, split: splitOf(T[pos.sig]), year: new Date(T[pos.sig]).getUTCFullYear(), bars: i - pos.fillBar + 1 });
    pos = null;
  };
  for (let i = 0; i < N; i++) {
    if (pos && pos.closeAtOpen) close(i, O[i], 'time');
    if (pending) { const fill = O[i], qty = Math.min((RISK * cash) / pending.Rp, (MAX_LEV * cash) / fill); const entryCost = costSide * fill * qty; cash -= entryCost; pos = { ...pending, fill, fillBar: i, qty, entryCost, mae: 0, mfe: 0 }; pending = null; }
    if (pos) {
      pos.mae = Math.min(pos.mae, sgn * ((long ? L[i] : H[i]) - pos.fill) / pos.Rp); pos.mfe = Math.max(pos.mfe, sgn * ((long ? H[i] : L[i]) - pos.fill) / pos.Rp);
      const path = H[i] - O[i] <= O[i] - L[i] ? [O[i], H[i], L[i]] : [O[i], L[i], H[i]];
      for (const px of path) { if (!pos) break; if (long ? px <= pos.stop : px >= pos.stop) { close(i, px === O[i] ? O[i] : pos.stop, 'stop'); continue; } if (long ? px >= pos.tp : px <= pos.tp) close(i, px === O[i] ? O[i] : pos.tp, 'tp'); }
      if (pos && i - pos.fillBar >= cfg.holdBars) pos.closeAtOpen = true;
    }
    const mark = cash + (pos ? sgn * (C[i] - pos.fill) * pos.qty : 0); barRets[i] = mark / prevMark - 1; prevMark = mark; if (pos) expBars++;
    if (!pos && !pending && i + 1 < N && signal(cfg, i)) {
      const stop = C[i] - sgn * cfg.stopATR * ATR[i], Rp = Math.abs(C[i] - stop);
      planned.push({ t: T[i], Rp, px: C[i] });
      pending = { sig: i, stop, Rp, tp: C[i] + sgn * 2 * Rp };
    }
  }
  return { trades, barRets, planned, exposure: expBars / N };
}

// ---------------------------------------------------------------- metrics (as IT1)
const pf = (rs) => { const g = rs.filter((r) => r > 0).reduce((s, r) => s + r, 0), l = -rs.filter((r) => r < 0).reduce((s, r) => s + r, 0); return l > 0 ? g / l : g > 0 ? Infinity : 0; };
const pfExBest = (rs) => { const s = [...rs].sort((a, b) => b - a); return pf(s.slice(Math.ceil(s.length * 0.05))); };
function metrics(trades, barRets, splits) {
  const rng = splits.map((k) => SPLITS[k]), inR = (t) => rng.some(([a, b]) => t >= a && t < b);
  const tr = trades.filter((t) => inR(t.t)), rs = tr.map((t) => t.R), br = barRets.filter((_, i) => inR(T[i]));
  const years = br.length / BARS_PER_YEAR; let eq = 1, peak = 1, maxDD = 0; for (const r of br) { eq *= 1 + r; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak); }
  const m = mean(br), s = stdev(br), ddev = Math.sqrt(mean(br.map((r) => Math.min(0, r) ** 2)));
  const wins = rs.filter((r) => r > 0), losses = rs.filter((r) => r <= 0); let streak = 0, worst = 0; for (const r of rs) { streak = r <= 0 ? streak + 1 : 0; worst = Math.max(worst, streak); }
  const byYear = {}; for (const t of tr) { byYear[t.year] ??= { n: 0, netR: 0 }; byYear[t.year].n++; byYear[t.year].netR += t.R; }
  const gross = wins.reduce((a, b) => a + b, 0);
  return { trades: rs.length, expR: mean(rs), winRate: rs.length ? wins.length / rs.length : 0, avgWin: mean(wins), avgLoss: mean(losses), pf: pf(rs), pfExBest: pfExBest(rs), netR: rs.reduce((a, b) => a + b, 0), sharpe: s ? (m / s) * Math.sqrt(BARS_PER_YEAR) : 0, sortino: ddev ? (m / ddev) * Math.sqrt(BARS_PER_YEAR) : 0, maxDD, calmar: maxDD > 0 && years > 0 ? (eq ** (1 / years) - 1) / maxDD : 0, avgMAE: mean(tr.map((t) => t.mae)), worstMAE: tr.length ? Math.min(...tr.map((t) => t.mae)) : 0, avgMFE: mean(tr.map((t) => t.mfe)), exposure: br.length ? tr.reduce((a, t) => a + t.bars, 0) / br.length : 0, turnoverPerYear: years > 0 ? rs.length / years : 0, worstStreak: worst, topWinnerShare: gross > 0 && wins.length ? Math.max(...wins) / gross : 0, byYear, avgHoldBars: mean(tr.map((t) => t.bars)), stopRate: rs.length ? tr.filter((t) => t.reason === 'stop').length / rs.length : 0, barRets: br };
}

// ---------------------------------------------------------------- grid (6 primary + 18 neighbours)
const base = [];
for (const family of ['A', 'B', 'C']) for (const dir of ['long', 'short']) base.push({ family, dir });
const PRIMARY = base.map((c) => ({ ...c, stopATR: 2.5, holdBars: 48, win: 24, thr: 1.0, role: 'primary' }));
const NEIGH = PRIMARY.flatMap((p, k) => [{ ...p, stopATR: 2.0, role: 'n1', of: k }, { ...p, holdBars: 24, role: 'n2', of: k }, { ...(p.family === 'A' ? { ...p, win: 48 } : { ...p, thr: 0.5 }), role: 'n3', of: k }]);
const GRID = [...PRIMARY, ...NEIGH];
if (GRID.length !== 24) throw new Error('grid');

// ---------------------------------------------------------------- feasibility gate, then run
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : x === Infinity ? '∞' : 'n/a');
const pct = (x) => f(x * 100, 1) + '%';
const runs = GRID.map((cfg) => {
  const sim = simulate(cfg);
  const dev = sim.planned.filter((p) => splitOf(p.t) === 'development');
  const ratio = (0.0014 * median(dev.map((p) => p.px))) / median(dev.map((p) => p.Rp));
  const feasible = ratio <= 0.10;
  const by = {}; for (const s of ['development', 'validation', 'test']) by[s] = metrics(sim.trades, sim.barRets, [s]); by.valtest = metrics(sim.trades, sim.barRets, ['validation', 'test']);
  const stress = cfg.role === 'primary' ? COST_STRESS.map((c) => metrics(simulate(cfg, c).trades, [], ['validation', 'test']).expR) : null;
  return { cfg, name: cfgName(cfg), ratio, feasible, medRiskPct: median(dev.map((p) => p.Rp / p.px)), by, stress, sim };
});

// registry + effective N
const reg = JSON.parse(readFileSync(new URL('../trials.json', import.meta.url), 'utf8'));
reg.entries = reg.entries.filter((e) => e.hypothesis !== 'IT3').concat(runs.flatMap((r) => ['development', 'validation', 'test'].map((split) => ({ hypothesis: 'IT3', config: r.name, role: r.cfg.role, split, feasible: r.feasible, sharpe: r.by[split].sharpe, trades: r.by[split].trades, expR: r.by[split].expR, pf: r.by[split].pf }))));
const [va, vb] = SPLITS.validation;
const series = runs.map((r) => { const d = dailyReturns(r.sim.barRets, T); return d.rets.filter((_, i) => d.days[i] * 86400_000 >= va && d.days[i] * 86400_000 < vb); });
const effIT3 = effectiveN(series);
const N_eff = Math.ceil((reg.effectiveN?.total ?? 92) + effIT3.effective);
reg.effectiveN = { ...(reg.effectiveN || {}), IT3: effIT3, totalAfterIT3: N_eff };
writeFileSync(new URL('../trials.json', import.meta.url), JSON.stringify(reg, null, 1));

const pool = runs.map((r) => r.by.validation.sharpe / Math.sqrt(BARS_PER_YEAR));
const results = runs.filter((r) => r.cfg.role === 'primary').map((r, k) => {
  const vt = r.by.valtest, br = vt.barRets, perBar = vt.sharpe / Math.sqrt(BARS_PER_YEAR);
  const D = dsr(perBar, br.length, moment(br, 3), moment(br, 4), pool, N_eff);
  const years = Object.entries(vt.byYear).filter(([, y]) => y.n >= 10), posYears = years.filter(([, y]) => y.netR > 0).length, best = years.length ? Math.max(...years.map(([, y]) => y.netR)) : 0;
  const neigh = runs.filter((x) => x.cfg.of === k);
  const G = { G0: r.feasible, G1: r.by.development.expR > 0 && r.by.validation.expR > 0 && r.by.test.expR > 0, G2: vt.pf >= 1.2, G3: vt.pfExBest > 1, G4: vt.trades >= 60, G5: years.length > 0 && posYears / years.length >= 0.5 && vt.netR - best > 0, G6: vt.topWinnerShare < 0.25, G7: r.stress[0] > 0, G8: neigh.filter((x) => x.by.valtest.expR > 0).length >= 2, G9: D.dsr >= 0.95 };
  const failed = Object.keys(G).filter((g) => !G[g]);
  const verdict = !G.G0 ? 'INFEASIBLE' : !G.G4 ? 'INSUFFICIENT' : failed.length === 0 ? 'RETROSPECTIVE PASS' : 'REJECTED';
  return { k, name: r.name, verdict, failed, G, ratio: r.ratio, medRiskPct: r.medRiskPct, by: r.by, stress: r.stress, dsr: D.dsr, sr0: D.sr0 * Math.sqrt(BARS_PER_YEAR), neigh: neigh.map((x) => ({ role: x.cfg.role, expR: x.by.valtest.expR, trades: x.by.valtest.trades })) };
});
const counts = results.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] || 0) + 1), a), {});

let md = `# IT3 — results: lower-turnover 1H short-horizon trading\n\nRETROSPECTIVE RESEARCH, 2020-01 → 2026-09, Binance BTCUSDT perpetual 1H (aggregated from the 15m cache). Rules frozen in PRE-REGISTRATION-IT2-IT3.md (commit b2ac11d) before IT2 ran. IT3 ran because IT2 was ${it2.verdict}.\n\n` +
  `Effective N for the DSR: prior ${reg.effectiveN.total ?? 92} + IT3 ${f(effIT3.effective, 1)} (24 configurations, eigen ${f(effIT3.eigen, 1)}, clusters ${effIT3.cluster}) = ${N_eff}. SR0 = ${f(results[0].sr0)} annualised.\n\n## Verdicts\n\n${Object.entries(counts).map(([k, v]) => `- **${k}**: ${v}`).join('\n')}\n\n` +
  `## Economic feasibility (development split): cost / planned risk\n\n| # | candidate | median planned risk (% of price) | 0.14% RT ÷ median risk | feasible (≤ 0.10) |\n|---|---|---|---|---|\n`;
for (const r of results) md += `| ${r.k + 1} | ${r.name} | ${pct(r.medRiskPct)} | ${f(r.ratio, 3)} | ${r.G.G0 ? '✓' : '✗'} |\n`;
md += `\n## Primary candidates — validation ∪ test (0.14% RT)\n\n| # | candidate | verdict | failed | n | expR | win | avgW/avgL | PF | PF ex-5% | Sharpe | Sortino | maxDD | Calmar | MAE avg/worst | MFE | expo | trades/yr | hold (bars) | stop% | streak | top win | dev expR (n) | val expR (n) | test expR (n) | @0.20% | @0.30% | DSR |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of results) { const v = r.by.valtest; md += `| ${r.k + 1} | ${r.name} | ${r.verdict} | ${r.failed.join(' ') || '—'} | ${v.trades} | ${f(v.expR)} | ${pct(v.winRate)} | ${f(v.avgWin)}/${f(v.avgLoss)} | ${f(v.pf)} | ${f(v.pfExBest)} | ${f(v.sharpe)} | ${f(v.sortino)} | ${pct(v.maxDD)} | ${f(v.calmar)} | ${f(v.avgMAE)}/${f(v.worstMAE)} | ${f(v.avgMFE)} | ${pct(v.exposure)} | ${f(v.turnoverPerYear, 0)} | ${f(v.avgHoldBars, 0)} | ${pct(v.stopRate)} | ${v.worstStreak} | ${pct(v.topWinnerShare)} | ${f(r.by.development.expR)} (${r.by.development.trades}) | ${f(r.by.validation.expR)} (${r.by.validation.trades}) | ${f(r.by.test.expR)} (${r.by.test.trades}) | ${f(r.stress[0])} | ${f(r.stress[1])} | ${f(r.dsr, 3)} |\n`; }
md += `\n## Year breakdown (validation ∪ test, net R / trades) and neighbours\n\n| # | candidate | 2024 | 2025 | 2026 | n1 stop2.0 | n2 hold24 | n3 window/thr |\n|---|---|---|---|---|---|---|---|\n`;
for (const r of results) { const y = (k) => (r.by.valtest.byYear[k] ? `${f(r.by.valtest.byYear[k].netR, 1)} / ${r.by.valtest.byYear[k].n}` : '—'); md += `| ${r.k + 1} | ${r.name} | ${y(2024)} | ${y(2025)} | ${y(2026)} | ${r.neigh.map((n) => `${f(n.expR)} (${n.trades})`).join(' | ')} |\n`; }
md += `\n## Gate detail\n\n| # | candidate | ${Object.keys(results[0].G).join(' | ')} |\n|---|---|${Object.keys(results[0].G).map(() => '---').join('|')}|\n`;
for (const r of results) md += `| ${r.k + 1} | ${r.name} | ${Object.values(r.G).map((g) => (g ? '✓' : '✗')).join(' | ')} |\n`;
md += `\n## All 24 configurations — validation ∪ test\n\n| config | role | feasible | n | expR | PF | Sharpe | maxDD |\n|---|---|---|---|---|---|---|---|\n`;
for (const r of runs) md += `| ${r.name} | ${r.cfg.role} | ${r.feasible ? '✓' : '✗'} | ${r.by.valtest.trades} | ${f(r.by.valtest.expR)} | ${f(r.by.valtest.pf)} | ${f(r.by.valtest.sharpe)} | ${pct(r.by.valtest.maxDD)} |\n`;
writeFileSync(new URL('./RESULTS-IT3.md', import.meta.url), md);
writeFileSync(new URL('./results-it3.json', import.meta.url), JSON.stringify(results.map((r) => ({ ...r, by: Object.fromEntries(Object.entries(r.by).map(([k, v]) => [k, { ...v, barRets: undefined }])) })), null, 1));
console.log(Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', '));
for (const r of results) console.log(`${r.verdict.padEnd(18)} ${r.name.padEnd(36)} ratio=${f(r.ratio, 3)} n=${String(r.by.valtest.trades).padStart(4)} expR=${f(r.by.valtest.expR)} PF=${f(r.by.valtest.pf)} DSR=${f(r.dsr, 3)} failed=${r.failed.join(' ')}`);
