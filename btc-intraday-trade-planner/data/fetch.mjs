// 15m klines for BTCUSDT perpetual from Binance USDT-M futures (fapi/v1/klines).
// Output: cache/btc-15m.json — [{t,o,h,l,c,v,qv,n,tbv}] per 15m bar, UTC open time.
// Usage: node fetch.mjs [--from 2020-01-01] [--to 2026-09-06]
import { writeFileSync, mkdirSync } from 'node:fs';

const M15 = 15 * 60_000;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = Date.parse(arg('--from', '2020-01-01') + 'T00:00:00Z');
const TO = Date.parse(arg('--to', new Date(Date.now() - 86400_000).toISOString().slice(0, 10)) + 'T00:00:00Z');
const DIR = new URL('./cache/', import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 6) {
  for (let t = 0; t < tries; t++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 429 || res.status === 418 || res.status >= 500) { await sleep(Math.min(60_000, 1000 * 2 ** t)); continue; }
    throw new Error(`${res.status} ${url}`);
  }
  throw new Error(`gave up: ${url}`);
}

const rows = [];
let cursor = FROM;
while (cursor < TO) {
  const batch = await get(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&startTime=${cursor}&limit=1500`);
  if (!batch?.length) break;
  for (const k of batch) {
    if (k[0] >= TO) break;
    rows.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], qv: +k[7], n: +k[8], tbv: +k[9] });
  }
  const last = batch.at(-1)[0];
  if (last <= cursor) break;
  cursor = last + M15;
  process.stdout.write(`\r  klines ${rows.length}  ${new Date(cursor).toISOString().slice(0, 10)}`);
  await sleep(120);
}
process.stdout.write('\n');
// Grid integrity: every bar must be exactly 15m after the previous one.
let gaps = 0;
for (let i = 1; i < rows.length; i++) if (rows[i].t - rows[i - 1].t !== M15) gaps++;
writeFileSync(DIR + 'btc-15m.json', JSON.stringify(rows));
console.log(`wrote ${rows.length} bars, ${gaps} grid gaps, ${new Date(rows[0].t).toISOString()} -> ${new Date(rows.at(-1).t).toISOString()}`);
