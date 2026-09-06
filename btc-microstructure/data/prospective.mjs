// Prospective capture. Appends 5m bars strictly after the frozen M1 cutoff into a
// separate file, together with the wall-clock time of each append. A bar whose
// append time is not later than the bar itself is not prospective, and the log
// makes that visible: prospective status is a property of when data was recorded,
// not of the date printed on it.
// Usage: node data/prospective.mjs [--market perp]   (safe to re-run; appends only)
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';

export const CUTOFF = Date.parse('2026-09-06T00:00:00Z');   // frozen in PRE-REGISTRATION-M1.md

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MARKET = arg('--market', 'perp');
const HOST = MARKET === 'spot' ? 'https://api.binance.com/api/v3' : 'https://fapi.binance.com/fapi/v1';
const LIMIT = MARKET === 'spot' ? 1000 : 1500;
const M5 = 300_000;
const DIR = new URL('./cache/', import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const OUT = `${DIR}prospective-5m-${MARKET}.json`;

const store = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { cutoff: CUTOFF, appends: [], bars: [] };
let cursor = store.bars.length ? store.bars.at(-1).t + M5 : CUTOFF;
const before = store.bars.length;
const now = Date.now();

while (cursor < now - M5) {
  const res = await fetch(`${HOST}/klines?symbol=BTCUSDT&interval=5m&startTime=${cursor}&limit=${LIMIT}`);
  if (!res.ok) { console.error(`${res.status}; stopping`); break; }
  const batch = await res.json();
  if (!batch.length) break;
  for (const k of batch) {
    if (k[0] < cursor || k[0] + M5 > now) continue;      // only closed bars
    store.bars.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], qv: +k[7], n: +k[8], tbb: +k[9], tbq: +k[10] });
  }
  const last = batch.at(-1)[0];
  if (last < cursor) break;
  cursor = last + M5;
}
if (store.bars.length > before) {
  store.appends.push({ at: new Date(now).toISOString(), added: store.bars.length - before,
    through: new Date(store.bars.at(-1).t).toISOString(), lagHours: +((now - store.bars.at(-1).t) / 3_600_000).toFixed(2) });
}
writeFileSync(OUT, JSON.stringify(store));
console.log(`${OUT}: ${store.bars.length} prospective bars (${store.bars.length - before} new), ${store.appends.length} appends`);
