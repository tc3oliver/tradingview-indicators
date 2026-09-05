// Test groups:
//   1. differential  — refactored vs. frozen baseline, bar-for-bar identical
//   2. no-repaint    — prefix invariance: adding future bars never alters past output
//   3. staleness     — every bar shows the most recently completed session, never an older one
//   4. weekend-gap   — state survives a simulated Fri 17:00 -> Sun 17:00 market close
import { PineTS, Provider } from 'pinets';
import { readFileSync } from 'node:fs';

const OLD = readFileSync('./main.v1.pine', 'utf8');
const NEW = readFileSync('./main.pine', 'utf8');

const SESSIONS = {
  london:  { from: 3,   to: 5,  old: 'london',       plot: 'london' },
  newYork: { from: 8.5, to: 11, old: 'newYork',      plot: 'newYork' },
  asia:    { from: 20,  to: 24, old: 'asia',         plot: 'asia' },
  nyClose: { from: 10,  to: 12, old: 'newYorkClose', plot: 'nyClose' },
};
const FIELDS = ['hi', 'lo', 'hiBar', 'loBar'];
const OLD_SUFFIX = { hi: 'High', lo: 'Low', hiBar: 'HighBar', loBar: 'LowBar' };

const nan = (v) => (v == null ? NaN : v);
// ctx.var -> Series {data:[num]};  ctx.plots -> {data:[{value}]}
const ser = (s) => (Array.isArray(s) ? s.map(nan) : s.data.map((d) => nan(d && typeof d === 'object' ? d.value : d)));
const eq = (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b));

const nyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
const nyParts = (ms) => {
  const p = Object.fromEntries(nyFmt.formatToParts(ms).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: (+p.hour % 24) + +p.minute / 60 };
};

const fail = [];
const check = (cond, msg) => { if (!cond) fail.push(msg); };

const TF = process.argv[2] ?? '1h';
const N = +(process.argv[3] ?? 500);

// Fetch candles once, then replay everything offline from the same array
const seed = new PineTS(Provider.Binance, 'BTCUSDT', TF, N);
await seed.run('//@version=5\nindicator("x")\nplot(close)');
const bars = seed.data;
const run = (src, data) => new PineTS(data, 'BTCUSDT', TF, data.length).run(src);

const newCtx = await run(NEW, bars);
const oldCtx = await run(OLD, bars);
const n = bars.length;

// ---------- 1. differential ----------
for (const [name, cfg] of Object.entries(SESSIONS)) {
  for (const f of FIELDS) {
    const a = ser(oldCtx.var[`glb1_${cfg.old}${OLD_SUFFIX[f]}`]);
    const b = ser(newCtx.plots[`${cfg.plot}_${f}`]);
    for (let i = 0; i < n; i++) {
      if (!eq(a[i], b[i])) { check(false, `differential ${name}.${f} bar#${i}: old=${a[i]} new=${b[i]}`); break; }
    }
  }
}
console.log(`1. differential  : ${fail.length ? '❌' : '✅'} refactored === original over ${n} bars`);

// ---------- 2. no-repaint (prefix invariance) ----------
const before = fail.length;
for (const k of [Math.floor(n * 0.5), Math.floor(n * 0.75), n - 10, n - 1]) {
  const cut = await run(NEW, bars.slice(0, k));
  for (const cfg of Object.values(SESSIONS)) {
    for (const f of FIELDS) {
      const full = ser(newCtx.plots[`${cfg.plot}_${f}`]);
      const part = ser(cut.plots[`${cfg.plot}_${f}`]);
      // The final bar is the unconfirmed realtime bar; it moves on TradingView too
      for (let i = 0; i < k - 1; i++) {
        if (!eq(full[i], part[i])) {
          check(false, `repaint ${cfg.plot}.${f} bar#${i}: full=${full[i]} truncated@${k}=${part[i]}`);
          i = k;
        }
      }
    }
  }
}
console.log(`2. no-repaint    : ${fail.length > before ? '❌' : '✅'} past bars unchanged when future bars added`);

// ---------- 3. staleness ----------
const before2 = fail.length;
let staleReport = [];
for (const [name, cfg] of Object.entries(SESSIONS)) {
  // Group bars into session instances by New York date
  const groups = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const { date, hour } = nyParts(bars[i].openTime);
    const inSess = hour >= cfg.from && hour < cfg.to;
    if (!inSess) { cur = null; continue; }
    if (!cur || cur.date !== date) groups.push((cur = { date, first: i, last: i, hi: -Infinity, lo: Infinity, hiBar: -1, loBar: -1 }));
    cur.last = i;
    if (bars[i].high > cur.hi) { cur.hi = bars[i].high; cur.hiBar = i; }
    if (bars[i].low < cur.lo) { cur.lo = bars[i].low; cur.loBar = i; }
  }

  const got = Object.fromEntries(FIELDS.map((f) => [f, ser(newCtx.plots[`${cfg.plot}_${f}`])]));
  let maxStaleDays = 0;

  for (let i = 0; i < n; i++) {
    // What bar i should show: the session containing i (running max up to i),
    // otherwise the most recently completed one
    const inG = groups.find((g) => i >= g.first && i <= g.last);
    let want;
    if (inG) {
      want = { hi: -Infinity, lo: Infinity, hiBar: -1, loBar: -1 };
      for (let j = inG.first; j <= i; j++) {
        if (bars[j].high > want.hi) { want.hi = bars[j].high; want.hiBar = j; }
        if (bars[j].low < want.lo) { want.lo = bars[j].low; want.loBar = j; }
      }
    } else {
      const done = groups.filter((g) => g.last < i);
      if (!done.length) continue;
      want = done[done.length - 1];
      // Which session instance is actually being shown? Resolve it via hiBar
      const shown = groups.find((g) => got.hiBar[i] >= g.first && got.hiBar[i] <= g.last);
      if (shown && shown !== want) {
        const days = (Date.parse(want.date) - Date.parse(shown.date)) / 86400000;
        maxStaleDays = Math.max(maxStaleDays, days);
      }
    }
    for (const f of FIELDS) {
      if (!eq(got[f][i], want[f])) {
        check(false, `stale ${name}.${f} bar#${i}: showing ${got[f][i]}, most-recent-completed is ${want[f]}`);
        i = n;
        break;
      }
    }
  }
  staleReport.push(`${name}: max ${maxStaleDays} day(s) behind`);
}
console.log(`3. staleness     : ${fail.length > before2 ? '❌' : '✅'} always the most-recent completed session`);
staleReport.forEach((s) => console.log(`                   ${s}`));

// ---------- 4. simulated forex weekend gap (Fri 17:00 NY close -> Sun 17:00 open) ----------
const before3 = fail.length;
const nyDow = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' });
const gapped = bars.filter((b) => {
  const dow = nyDow.format(b.openTime);
  const { hour } = nyParts(b.openTime);
  if (dow === 'Sat') return false;
  if (dow === 'Fri' && hour >= 17) return false;
  if (dow === 'Sun' && hour < 17) return false;
  return true;
});
const gapCtx = await run(NEW, gapped);
let gapStale = [];
for (const [name, cfg] of Object.entries(SESSIONS)) {
  const groups = [];
  let cur = null;
  for (let i = 0; i < gapped.length; i++) {
    const { date, hour } = nyParts(gapped[i].openTime);
    if (!(hour >= cfg.from && hour < cfg.to)) { cur = null; continue; }
    if (!cur || cur.date !== date) groups.push((cur = { date, first: i, last: i, hi: -Infinity, lo: Infinity, hiBar: -1, loBar: -1 }));
    cur.last = i;
    if (gapped[i].high > cur.hi) { cur.hi = gapped[i].high; cur.hiBar = i; }
    if (gapped[i].low < cur.lo) { cur.lo = gapped[i].low; cur.loBar = i; }
  }
  const gHi = ser(gapCtx.plots[`${cfg.plot}_hi`]);
  const gHiBar = ser(gapCtx.plots[`${cfg.plot}_hiBar`]);
  let maxStale = 0;
  for (let i = 0; i < gapped.length; i++) {
    if (groups.some((g) => i >= g.first && i <= g.last)) continue;
    const done = groups.filter((g) => g.last < i);
    if (!done.length) continue;
    const want = done[done.length - 1];
    if (!eq(gHi[i], want.hi)) check(false, `gap-stale ${name} bar#${i}: showing ${gHi[i]}, want ${want.hi} (${want.date})`);
    const shown = groups.find((g) => gHiBar[i] >= g.first && gHiBar[i] <= g.last);
    if (shown) maxStale = Math.max(maxStale, (Date.parse(want.date) - Date.parse(shown.date)) / 86400000);
  }
  gapStale.push(`${name}: max ${maxStale} day(s) behind`);
}
console.log(`4. weekend-gap   : ${fail.length > before3 ? '❌' : '✅'} correct across simulated Fri17:00→Sun17:00 close (${bars.length - gapped.length} bars removed)`);
gapStale.forEach((s) => console.log(`                   ${s}`));

console.log(`\n${TF} x${n}`);
if (fail.length) {
  console.log(`\n❌ ${fail.length} failures:`);
  fail.slice(0, 15).forEach((f) => console.log('  ', f));
  process.exit(1);
}
console.log('\n✅ all 4 test groups passed');
