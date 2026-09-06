// Klines with the taker-buy split, for BTCUSDT.
//   --market perp  -> USD-M futures (fapi.binance.com), the M1 primary venue
//   --market spot  -> spot (api.binance.com), venue robustness only
// Output: cache/btc-<interval>-<market>.json
//   [{t,o,h,l,c,v,qv,n,tbb,tbq}]  t = UTC open time (ms)
//   qv  = total quote volume            (USDT notional traded)
//   tbq = taker-buy quote volume        (aggressive BUY notional; buyer was the taker)
//   qv - tbq                            (aggressive SELL notional)
// Usage: node fetch-klines.mjs --market perp --interval 5m [--from 2020-01-01] [--to 2026-09-06]
import { writeFileSync, mkdirSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MARKET = arg('--market', 'perp');
const INTERVAL = arg('--interval', '5m');
const MS = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000 }[INTERVAL];
if (!MS) throw new Error(`unsupported interval ${INTERVAL}`);
const HOST = MARKET === 'spot' ? 'https://api.binance.com/api/v3' : 'https://fapi.binance.com/fapi/v1';
const LIMIT = MARKET === 'spot' ? 1000 : 1500;
const FROM = Date.parse(arg('--from', '2020-01-01') + 'T00:00:00Z');
const TO = Date.parse(arg('--to', '2026-09-06') + 'T00:00:00Z');
const DIR = new URL('./cache/', import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 7) {
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
  const batch = await get(`${HOST}/klines?symbol=BTCUSDT&interval=${INTERVAL}&startTime=${cursor}&limit=${LIMIT}`);
  if (!batch?.length) break;
  for (const k of batch) {
    if (k[0] >= TO) break;
    rows.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], qv: +k[7], n: +k[8], tbb: +k[9], tbq: +k[10] });
  }
  const last = batch.at(-1)[0];
  if (last <= cursor) break;
  cursor = last + MS;
  process.stdout.write(`\r  ${MARKET} ${INTERVAL}: ${rows.length} bars  ${new Date(cursor).toISOString().slice(0, 10)}`);
  await sleep(120);
}
process.stdout.write('\n');

let gaps = 0, bad = 0;
for (let i = 1; i < rows.length; i++) if (rows[i].t - rows[i - 1].t !== MS) gaps++;
for (const r of rows) if (r.tbq > r.qv * 1.000001 || r.tbq < -1e-9) bad++;
const out = `${DIR}btc-${INTERVAL}-${MARKET}.json`;
writeFileSync(out, JSON.stringify(rows));
console.log(`wrote ${out}: ${rows.length} bars, ${gaps} grid gaps, ${bad} taker-buy > total, ${new Date(rows[0].t).toISOString()} -> ${new Date(rows.at(-1).t).toISOString()}`);
