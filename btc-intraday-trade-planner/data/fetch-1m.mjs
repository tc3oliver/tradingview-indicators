// 1-minute klines from Binance, stored as compact binary (Float64 columns).
//   --market spot  : api.binance.com  BTCUSDT spot   (from 2017-08-17)
//   --market perp  : fapi.binance.com BTCUSDT perp   (from 2019-09-08)
// Output: cache/btc-1m-<market>.bin  = header JSON line + Float64 columns t,o,h,l,c,v,qv
// Usage: node fetch-1m.mjs --market spot [--from 2017-08-17] [--to 2026-09-06]
import { writeFileSync, mkdirSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MARKET = arg('--market', 'perp');
const BASE = MARKET === 'spot' ? 'https://api.binance.com/api/v3/klines' : 'https://fapi.binance.com/fapi/v1/klines';
const LIMIT = MARKET === 'spot' ? 1000 : 1500;
const FROM = Date.parse(arg('--from', MARKET === 'spot' ? '2017-08-17' : '2019-09-08') + 'T00:00:00Z');
const TO = Date.parse(arg('--to', new Date(Date.now() - 86400_000).toISOString().slice(0, 10)) + 'T00:00:00Z');
const DIR = new URL('./cache/', import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, tries = 8) {
  for (let t = 0; t < tries; t++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 429 || res.status === 418 || res.status >= 500) { await sleep(Math.min(120_000, 2000 * 2 ** t)); continue; }
    throw new Error(`${res.status} ${url}`);
  }
  throw new Error(`gave up: ${url}`);
}
const cols = { t: [], o: [], h: [], l: [], c: [], v: [], qv: [] };
let cursor = FROM, n = 0;
while (cursor < TO) {
  const batch = await get(`${BASE}?symbol=BTCUSDT&interval=1m&startTime=${cursor}&limit=${LIMIT}`);
  if (!batch?.length) break;
  for (const k of batch) { if (k[0] >= TO) break; cols.t.push(k[0]); cols.o.push(+k[1]); cols.h.push(+k[2]); cols.l.push(+k[3]); cols.c.push(+k[4]); cols.v.push(+k[5]); cols.qv.push(+k[7]); n++; }
  const last = batch.at(-1)[0];
  if (last <= cursor) break;
  cursor = last + 60_000;
  if (n % 50_000 < LIMIT) process.stdout.write(`\r  ${MARKET} 1m ${n}  ${new Date(cursor).toISOString().slice(0, 10)}`);
  await sleep(MARKET === 'spot' ? 60 : 150);
}
process.stdout.write('\n');
const header = Buffer.from(JSON.stringify({ market: MARKET, n, cols: Object.keys(cols) }) + '\n');
const body = Buffer.concat(Object.values(cols).map((a) => Buffer.from(Float64Array.from(a).buffer)));
writeFileSync(`${DIR}btc-1m-${MARKET}.bin`, Buffer.concat([header, body]));
let gaps = 0; for (let i = 1; i < n; i++) if (cols.t[i] - cols.t[i - 1] !== 60_000) gaps++;
console.log(`wrote ${n} bars (${gaps} gaps in the 1m grid — exchange downtime is expected), ${new Date(cols.t[0]).toISOString()} -> ${new Date(cols.t[n - 1]).toISOString()}`);
