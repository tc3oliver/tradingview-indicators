// Price reconciliation: rebuild 1m OHLC from raw aggTrades and compare it, bar by
// bar, with Binance's own 1m klines. Runs on four days spread across the sample
// (~100 MB streamed); the per-5m notional reconciliation in research/audit.mjs
// covers every audited day.
// Usage: node reconcile-1m.mjs [--market perp] -> cache/reconcile-1m-<market>.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MARKET = arg('--market', 'perp');
const PATHSEG = MARKET === 'spot' ? 'spot' : 'futures/um';
const HOST = MARKET === 'spot' ? 'https://api.binance.com/api/v3' : 'https://fapi.binance.com/fapi/v1';
const DAYS = ['2020-05-15', '2022-05-15', '2024-05-15', '2026-05-15'];
const M1 = 60_000;
const DIR = new URL('./cache/', import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });

function stream(url, onLine) {
  return new Promise((resolve, reject) => {
    const curl = spawn('curl', ['-sfL', url]), unzip = spawn('funzip');
    curl.stdout.pipe(unzip.stdin); curl.stderr.resume(); unzip.stderr.resume();
    curl.on('error', reject); unzip.on('error', reject);
    let bad = null; curl.on('close', (c) => { if (c !== 0) bad = `curl ${c}`; });
    const rl = createInterface({ input: unzip.stdout, crlfDelay: Infinity });
    rl.on('line', onLine);
    rl.on('close', () => (bad ? reject(new Error(`${bad} ${url}`)) : resolve()));
  });
}

const report = [];
for (const day of DAYS) {
  const start = Date.parse(day + 'T00:00:00Z');
  const built = new Map();
  await stream(`https://data.binance.vision/data/${PATHSEG}/daily/aggTrades/BTCUSDT/BTCUSDT-aggTrades-${day}.zip`, (line) => {
    if (!line || /^[a-zA-Z_]/.test(line)) return;
    const f = line.split(',');
    const px = +f[1], qty = +f[2], t = +f[5];
    if (!Number.isFinite(px)) return;
    const k = Math.floor(t / M1) * M1;
    let b = built.get(k);
    if (!b) built.set(k, (b = { o: px, h: px, l: px, c: px, v: 0 }));
    if (px > b.h) b.h = px; if (px < b.l) b.l = px;
    b.c = px; b.v += qty;
  });
  const kl = await (await fetch(`${HOST}/klines?symbol=BTCUSDT&interval=1m&startTime=${start}&limit=1000`)).json();
  const kl2 = await (await fetch(`${HOST}/klines?symbol=BTCUSDT&interval=1m&startTime=${start + 1000 * M1}&limit=1000`)).json();
  const rows = [...kl, ...kl2].filter((k) => k[0] >= start && k[0] < start + 86_400_000);
  let compared = 0, ohlcMismatch = 0, volMismatch = 0, maxVolRel = 0, missing = 0;
  for (const k of rows) {
    const b = built.get(k[0]);
    if (!b) { if (+k[8] > 0) missing++; continue; }
    compared++;
    if (b.o !== +k[1] || b.h !== +k[2] || b.l !== +k[3] || b.c !== +k[4]) ohlcMismatch++;
    const rel = +k[5] > 0 ? Math.abs(b.v - +k[5]) / +k[5] : 0;
    if (rel > 1e-9) { volMismatch++; maxVolRel = Math.max(maxVolRel, rel); }
  }
  const r = { day, klineBars: rows.length, compared, missing, ohlcMismatch, volMismatch, maxVolRel };
  report.push(r);
  console.log(JSON.stringify(r));
}
writeFileSync(`${DIR}reconcile-1m-${MARKET}.json`, JSON.stringify(report, null, 2));
