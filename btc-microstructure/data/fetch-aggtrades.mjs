// Raw Binance aggTrades archives -> 5m signed aggressor flow + a data-integrity record.
//
// Full-history raw trades are ~80 GB for this symbol, so the archives are pulled for a
// deterministic stratified sample of days (see DAYS below). Those days are what the M1
// integrity audit runs on, and what the kline taker-buy aggregate is reconciled against.
// Archives are streamed through `unzip -p` and never stored on disk.
//
// Schema (futures um):  agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker
// Schema (spot):        ... ,is_buyer_maker,is_best_match      (one extra column)
// Some files carry a header row, some do not; both are handled and recorded.
//
// is_buyer_maker = false -> the buyer lifted the offer -> AGGRESSIVE BUY
// is_buyer_maker = true  -> the seller hit the bid      -> AGGRESSIVE SELL
//
// Usage: node fetch-aggtrades.mjs [--market perp|spot]
// Output: cache/aggtrades-<market>.json  (resumable: existing days are skipped)
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MARKET = arg('--market', 'perp');
const PATHSEG = MARKET === 'spot' ? 'spot' : 'futures/um';
const DIR = new URL('./cache/', import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const OUT = `${DIR}aggtrades-${MARKET}.json`;
const M5 = 300_000;

// Deterministic day sample, fixed before any result was looked at.
function days() {
  const d = [];
  for (let y = 2020; y <= 2026; y++) for (const m of ['02', '05', '08', '11']) {
    const s = `${y}-${m}-15`;
    if (s <= '2026-09-05') d.push(s);
  }
  // archive-boundary pairs: month rollover, year rollover
  d.push('2023-03-31', '2023-04-01', '2022-12-31', '2023-01-01');
  // stress days: COVID crash, May-2021 crash, Aug-2024 carry unwind
  d.push('2020-03-12', '2021-05-19', '2024-08-05');
  return [...new Set(d)].sort();
}
const DAYS = MARKET === 'spot' ? days().filter((_, i) => i % 5 === 0) : days();

const store = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};

function stream(url, onLine) {
  return new Promise((resolve, reject) => {
    const curl = spawn('curl', ['-sfL', url]);
    const unzip = spawn('funzip');           // funzip: stdin zip -> stdout, no temp file
    curl.stdout.pipe(unzip.stdin);
    curl.stderr.resume(); unzip.stderr.resume();
    curl.on('error', reject); unzip.on('error', reject);
    let code = null;
    curl.on('close', (c) => { if (c !== 0) code = `curl ${c}`; });
    const rl = createInterface({ input: unzip.stdout, crlfDelay: Infinity });
    rl.on('line', onLine);
    rl.on('close', () => (code ? reject(new Error(`${code} ${url}`)) : resolve()));
  });
}

for (const day of DAYS) {
  if (store[day]) { console.log(`${day} cached`); continue; }
  const url = `https://data.binance.vision/data/${PATHSEG}/daily/aggTrades/BTCUSDT/BTCUSDT-aggTrades-${day}.zip`;
  const dayStart = Date.parse(day + 'T00:00:00Z'), dayEnd = dayStart + 86_400_000;
  const bars = new Map();                       // bar open ms -> [buyQuote, sellQuote, buyN, sellN]
  const a = {                                   // integrity record
    rows: 0, header: false, cols: 0, dupIds: 0, idGaps: 0, idGapRows: 0, outOfOrder: 0,
    outsideDay: 0, badMaker: 0, nonFinite: 0, minId: Infinity, maxId: -Infinity,
    tFirst: Infinity, tLast: -Infinity, pMin: Infinity, pMax: -Infinity,
    qty: 0, quote: 0, buyQuote: 0, buyN: 0, sellN: 0, maxGapMs: 0,
  };
  const seen = new Set();
  let prevId = null, prevT = null;
  await stream(url, (line) => {
    if (!line) return;
    if (a.rows === 0 && /^[a-zA-Z_]/.test(line)) { a.header = true; a.cols = line.split(',').length; return; }
    const f = line.split(',');
    if (!a.cols) a.cols = f.length;
    const id = +f[0], px = +f[1], qty = +f[2], t = +f[5], mk = f[6].trim();
    if (!Number.isFinite(id) || !Number.isFinite(px) || !Number.isFinite(qty) || !Number.isFinite(t)) { a.nonFinite++; return; }
    if (mk !== 'true' && mk !== 'false' && mk !== 'True' && mk !== 'False') { a.badMaker++; return; }
    a.rows++;
    if (seen.has(id)) a.dupIds++; else seen.add(id);
    if (prevId !== null && id !== prevId + 1) { a.idGaps++; a.idGapRows += Math.max(0, id - prevId - 1); }
    if (prevT !== null) { if (t < prevT) a.outOfOrder++; else a.maxGapMs = Math.max(a.maxGapMs, t - prevT); }
    prevId = id; prevT = t;
    if (t < dayStart || t >= dayEnd) a.outsideDay++;
    if (id < a.minId) a.minId = id; if (id > a.maxId) a.maxId = id;
    if (t < a.tFirst) a.tFirst = t; if (t > a.tLast) a.tLast = t;
    if (px < a.pMin) a.pMin = px; if (px > a.pMax) a.pMax = px;
    const quote = px * qty, aggBuy = mk === 'false' || mk === 'False';
    a.qty += qty; a.quote += quote;
    if (aggBuy) { a.buyQuote += quote; a.buyN++; } else a.sellN++;
    const k = Math.floor(t / M5) * M5;
    let b = bars.get(k); if (!b) bars.set(k, (b = [0, 0, 0, 0]));
    if (aggBuy) { b[0] += quote; b[2]++; } else { b[1] += quote; b[3]++; }
  });
  store[day] = { audit: a, bars: Object.fromEntries([...bars].sort((x, y) => x[0] - y[0])) };
  writeFileSync(OUT, JSON.stringify(store));
  console.log(`${day}  ${a.rows.toLocaleString()} trades  quote $${(a.quote / 1e9).toFixed(2)}B  aggBuy ${(100 * a.buyQuote / a.quote).toFixed(1)}%  dup ${a.dupIds}  idGaps ${a.idGaps}  ooo ${a.outOfOrder}`);
}
console.log(`wrote ${OUT}: ${Object.keys(store).length} days`);
