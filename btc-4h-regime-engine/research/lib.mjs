// Shared data loading, performance metrics, and the trial registry.
//
// Registry discipline: a configuration counts as a trial the moment its Sharpe
// is computed — whether or not it was a serious candidate, whether or not it
// was reported. Adding entries can only lower the Deflated Sharpe Ratio. That
// is the point. Never delete an entry to improve a number.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const BARS_PER_YEAR = 6 * 365;
export const FEE = 0.0005;                       // per side, 0.10% round trip

export const rows = JSON.parse(readFileSync(new URL('../data/cache/btc-4h.json', import.meta.url), 'utf8'));
export const close = rows.map((r) => r.close);

export const SPLITS = {
  development: [Date.parse('2020-09-01T00:00:00Z'), Date.parse('2024-01-01T00:00:00Z')],
  validation: [Date.parse('2024-01-01T00:00:00Z'), Date.parse('2025-07-01T00:00:00Z')],
  holdout: [Date.parse('2025-07-01T00:00:00Z'), Infinity],
};

export const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
export const stdev = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
export const ema = (v, p) => { const k = 2 / (p + 1); let e = v[0]; return v.map((x, i) => (e = i ? x * k + e * (1 - k) : x)); };
export const sma = (v, p) => v.map((_, i) => (i < p - 1 ? NaN : mean(v.slice(i - p + 1, i + 1))));
export const p2 = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '—');

export const barRet = close.map((c, i) => (i ? c / close[i - 1] - 1 : 0));

// Trailing realised volatility, annualised. Window ends at i inclusive.
export function trailVol(win = 30) {
  return barRet.map((_, i) => {
    if (i < win) return NaN;
    return stdev(barRet.slice(i - win + 1, i + 1)) * Math.sqrt(BARS_PER_YEAR);
  });
}

// Backtest a fractional-position strategy.
//   pos(i) -> desired weight in [0,1], decided using data through bar i
// One-bar lag: the weight chosen at close of bar i-1 earns bar i's return, and
// the transaction cost is charged at the moment the weight changes.
export function backtest(pos, [from, to]) {
  const rets = [], weights = [];
  let prev = 0, eq = 1, peak = 1, maxDD = 0, turnover = 0;
  const ddSeries = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].t < from || rows[i].t >= to) continue;
    const w = Math.max(0, Math.min(1, pos(i - 1) || 0));
    const r = w * barRet[i] - FEE * Math.abs(w - prev);
    turnover += Math.abs(w - prev);
    rets.push(r);
    weights.push(w);
    eq *= 1 + r;
    peak = Math.max(peak, eq);
    const dd = 1 - eq / peak;
    ddSeries.push(dd);
    maxDD = Math.max(maxDD, dd);
    prev = w;
  }
  if (!rets.length) return null;
  const years = rets.length / BARS_PER_YEAR;
  const m = mean(rets), sd = stdev(rets);
  const dn = rets.filter((x) => x < 0);
  const dsd = dn.length ? Math.sqrt(mean(dn.map((x) => x * x))) : 0;
  const cagr = eq ** (1 / years) - 1;
  return {
    netRet: eq - 1,
    cagr,
    sharpe: sd ? (m / sd) * Math.sqrt(BARS_PER_YEAR) : 0,
    sortino: dsd ? (m / dsd) * Math.sqrt(BARS_PER_YEAR) : 0,
    maxDD,
    calmar: maxDD ? cagr / maxDD : Infinity,
    // Ulcer Index: RMS of the drawdown path. Penalises long, deep underwater
    // stretches, which a single max-drawdown number hides entirely.
    ulcer: Math.sqrt(mean(ddSeries.map((d) => d * d))),
    avgExposure: mean(weights),
    timeInMarket: weights.filter((w) => w > 0).length / weights.length,
    turnoverPerYear: turnover / years,
    bars: rets.length,
    rets,
  };
}

// ---------- trial registry ----------
const REG = new URL('../trials.json', import.meta.url);

export function readTrials() {
  return existsSync(REG) ? JSON.parse(readFileSync(REG, 'utf8')) : [];
}

// Idempotent on (hypothesis, config, split) so re-running a script does not
// inflate the trial count. Changing a config's definition creates a new entry.
export function recordTrials(entries) {
  const all = readTrials();
  const key = (e) => `${e.hypothesis}|${e.config}|${e.split}`;
  const idx = new Map(all.map((e) => [key(e), e]));
  for (const e of entries) idx.set(key(e), e);
  const out = [...idx.values()];
  writeFileSync(REG, JSON.stringify(out, null, 2));
  return out.length;
}
