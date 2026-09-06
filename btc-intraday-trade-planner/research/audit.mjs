// Phase 1 — intraday seasonality audit. Measures only; no strategy is tested.
// Output: AUDIT.md next to this file.
import { readFileSync, writeFileSync } from 'node:fs';
import { sessionFlags, local, M15 } from './sessions.mjs';

const bars = JSON.parse(readFileSync(new URL('../data/cache/btc-15m.json', import.meta.url), 'utf8'));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const f = (x, d = 2) => Number.isFinite(x) ? x.toFixed(d) : 'n/a';

// Per-bar features
const rows = bars.map((b, i) => {
  const r = i ? Math.log(b.c / bars[i - 1].c) : 0;
  const fl = sessionFlags(b.t);
  const ny = local(b.t, 'America/New_York'), ldn = local(b.t, 'Europe/London');
  const utcH = new Date(b.t).getUTCHours(), dow = new Date(b.t).getUTCDay();
  const label = !(fl.inASIA || fl.inLONDON || fl.inNY) ? (dow === 0 || dow === 6 ? 'WEEKEND' : 'OFF-HOURS')
    : fl.inLONDON && fl.inNY ? 'LON+NY OVERLAP' : fl.inNY ? 'NY ONLY' : fl.inLONDON ? 'LONDON ONLY' : 'ASIA';
  return { v: b.v, qv: b.qv, n: b.n, r, ar: Math.abs(r), rng: (b.h - b.l) / b.c, utcH, dow, nyH: Math.floor(ny.hm / 60), ldnH: Math.floor(ldn.hm / 60), label, weekend: dow === 0 || dow === 6, year: new Date(b.t).getUTCFullYear() };
});
// ATR14 on 15m (Wilder) for the ATR column
let atr = null; const ATR = new Array(rows.length).fill(NaN);
for (let i = 1; i < bars.length; i++) {
  const tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
  atr = atr === null ? tr : (atr * 13 + tr) / 14;
  ATR[i] = atr / bars[i].c;
}

const group = (key) => {
  const g = new Map();
  rows.forEach((r, i) => { const k = key(r); if (k === null) return; if (!g.has(k)) g.set(k, []); g.get(k).push(i); });
  return g;
};
const stat = (idx) => ({
  n: idx.length,
  volMed: med(idx.map((i) => rows[i].qv)) / 1e6,
  tradesMed: med(idx.map((i) => rows[i].n)),
  rv: sd(idx.map((i) => rows[i].r)) * Math.sqrt(96 * 365) * 100,     // annualised realised vol from 15m returns
  rngMean: mean(idx.map((i) => rows[i].rng)) * 100,
  atrMean: mean(idx.filter((i) => Number.isFinite(ATR[i])).map((i) => ATR[i])) * 100,
});
const table = (title, g, order) => {
  const keys = order ?? [...g.keys()].sort((a, b) => (a > b) - (a < b));
  let s = `### ${title}\n\n| slot | bars | median $vol (M) | median trades | realised vol (ann. %) | mean range % | mean ATR14 % |\n|---|---|---|---|---|---|---|\n`;
  for (const k of keys) { if (!g.has(k)) continue; const st = stat(g.get(k)); s += `| ${k} | ${st.n} | ${f(st.volMed, 1)} | ${st.tradesMed} | ${f(st.rv, 0)} | ${f(st.rngMean, 3)} | ${f(st.atrMean, 3)} |\n`; }
  return s + '\n';
};

const wk = (r) => (r.weekend ? null : r);
let md = `# Phase 1 — Intraday seasonality audit (BTCUSDT perpetual, 15m)\n\n` +
  `RETROSPECTIVE RESEARCH. Descriptive only — nothing here is a trading rule.\n\n` +
  `Data: ${bars.length} bars, ${new Date(bars[0].t).toISOString().slice(0, 10)} → ${new Date(bars.at(-1).t).toISOString().slice(0, 10)}, Binance fapi 15m klines. ` +
  `Volume in quote (USDT). Realised vol = sd of 15m log returns × √(96·365). ` +
  `Spread / slippage: **no order-book history available** in this dataset; the cost model folds slippage into a per-side rate instead (see PRE-REGISTRATION §1).\n\n`;

md += table('By session (weekdays defined in each session\'s own timezone)', group((r) => r.label), ['ASIA', 'LONDON ONLY', 'LON+NY OVERLAP', 'NY ONLY', 'OFF-HOURS', 'WEEKEND']);
md += table('By UTC hour, weekdays only', group((r) => wk(r) && String(r.utcH).padStart(2, '0') + ':00 UTC'));
md += table('By New York local hour, weekdays only (DST-correct)', group((r) => wk(r) && String(r.nyH).padStart(2, '0') + ':00 NY'));
md += table('By London local hour, weekdays only (DST-correct)', group((r) => wk(r) && String(r.ldnH).padStart(2, '0') + ':00 LDN'));
md += table('By UTC weekday', group((r) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][r.dow]), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
md += table('By year', group((r) => String(r.year)));

// DST evidence: the NY-open 15m slot (09:30 NY) lands at 13:30 UTC in summer and 14:30 UTC in winter.
const nyOpen = rows.map((r, i) => i).filter((i) => !rows[i].weekend && local(bars[i].t, 'America/New_York').hm === 9 * 60 + 30);
const summer = nyOpen.filter((i) => new Date(bars[i].t).getUTCHours() === 13), winter = nyOpen.filter((i) => new Date(bars[i].t).getUTCHours() === 14);
const s1330 = rows.map((r, i) => i).filter((i) => !rows[i].weekend && new Date(bars[i].t).getUTCHours() === 13 && new Date(bars[i].t).getUTCMinutes() === 30);
const s1430 = rows.map((r, i) => i).filter((i) => !rows[i].weekend && new Date(bars[i].t).getUTCHours() === 14 && new Date(bars[i].t).getUTCMinutes() === 30);
const asiaNight = rows.map((r, i) => i).filter((i) => !rows[i].weekend && rows[i].utcH === 3);
const nyOpenHour = rows.map((r, i) => i).filter((i) => !rows[i].weekend && rows[i].nyH === 9 && local(bars[i].t, 'America/New_York').hm >= 570);

md += `## DST and same-slot normalisation\n\n` +
  `| slot | bars | median $vol (M) | realised vol (ann. %) |\n|---|---|---|---|\n` +
  `| 09:30 NY open bar, summer (=13:30 UTC) | ${summer.length} | ${f(stat(summer).volMed, 1)} | ${f(stat(summer).rv, 0)} |\n` +
  `| 09:30 NY open bar, winter (=14:30 UTC) | ${winter.length} | ${f(stat(winter).volMed, 1)} | ${f(stat(winter).rv, 0)} |\n` +
  `| fixed 13:30 UTC bar, all year | ${s1330.length} | ${f(stat(s1330).volMed, 1)} | ${f(stat(s1330).rv, 0)} |\n` +
  `| fixed 14:30 UTC bar, all year | ${s1430.length} | ${f(stat(s1430).volMed, 1)} | ${f(stat(s1430).rv, 0)} |\n` +
  `| 03:00 UTC hour (Asia mid-session) | ${asiaNight.length} | ${f(stat(asiaNight).volMed, 1)} | ${f(stat(asiaNight).rv, 0)} |\n` +
  `| 09:30–10:00 NY (open half-hour) | ${nyOpenHour.length} | ${f(stat(nyOpenHour).volMed, 1)} | ${f(stat(nyOpenHour).rv, 0)} |\n\n`;

const ratio = stat(nyOpenHour).volMed / stat(asiaNight).volMed;
md += `**Conclusion.** Median 15m volume in the NY opening half-hour is **${f(ratio, 1)}×** the 03:00 UTC hour, and the 09:30 NY bar is identical in summer and winter while a fixed UTC slot mixes the open bar with an ordinary pre-open bar for half the year. ` +
  `Therefore (a) any volume threshold must be relative to the **same session / same local time-of-day** distribution, never a global median, and (b) session windows must be defined in local session time, not fixed UTC. Both are adopted in the pre-registration.\n`;

writeFileSync(new URL('./AUDIT.md', import.meta.url), md);
console.log(md);
