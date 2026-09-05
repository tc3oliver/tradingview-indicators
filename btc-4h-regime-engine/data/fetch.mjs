// Builds one 4H-aligned dataset for BTCUSDT perpetual from free Binance sources.
//
//   klines   fapi/v1/klines                     4H      2019-09-08 ->
//   OI       data.binance.vision metrics dump   5m      2020-09-01 ->
//   funding  fapi/v1/fundingRate                8h      2019-09-10 ->
//
// Everything is resampled onto the 4H kline grid. OI and funding are sampled at
// the value in force AT BAR CLOSE, which is what a bar-close strategy can see.
//
// Output: cache/btc-4h.json  — one row per 4H bar, plus cache/raw/* for reuse.
//
// Usage: node fetch.mjs [--from 2020-09-01] [--to 2026-09-05]
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { inflateRawSync, constants as zc } from 'node:zlib';

const H4 = 4 * 3600_000;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = Date.parse(arg('--from', '2020-09-01') + 'T00:00:00Z');
const TO = Date.parse(arg('--to', new Date(Date.now() - 86400_000).toISOString().slice(0, 10)) + 'T00:00:00Z');

const DIR = new URL('./cache/', import.meta.url).pathname;
const RAW = DIR + 'raw/';
mkdirSync(RAW, { recursive: true });

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Binance rate-limits hard on 429/418; back off rather than hammering.
async function get(url, { binary = false, tries = 6 } = {}) {
  for (let t = 0; t < tries; t++) {
    const res = await fetch(url);
    if (res.ok) return binary ? Buffer.from(await res.arrayBuffer()) : res.json();
    if (res.status === 404) return null;
    if (res.status === 429 || res.status === 418 || res.status >= 500) {
      const wait = Math.min(60_000, 1000 * 2 ** t);
      log(`  ${res.status} on ${url.slice(-60)} — waiting ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    throw new Error(`${res.status} ${url}`);
  }
  throw new Error(`gave up after ${tries}: ${url}`);
}

// Run `fn` over `items` with at most `n` in flight.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const cached = async (name, build) => {
  const f = RAW + name;
  if (existsSync(f)) { log(`= ${name} (cached)`); return JSON.parse(readFileSync(f, 'utf8')); }
  const v = await build();
  writeFileSync(f, JSON.stringify(v));
  log(`+ ${name}`);
  return v;
};

// ---------- 1. 4H klines ----------
const klines = await cached('klines-4h.json', async () => {
  const rows = [];
  let cursor = FROM;
  while (cursor < TO) {
    const batch = await get(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=4h&startTime=${cursor}&limit=1500`);
    if (!batch?.length) break;
    for (const k of batch) {
      if (k[0] >= TO) break;
      rows.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], qv: +k[7], n: +k[8], tbv: +k[9] });
    }
    const last = batch.at(-1)[0];
    if (last <= cursor) break;
    cursor = last + H4;
    process.stdout.write(`\r  klines ${rows.length}`);
  }
  process.stdout.write('\n');
  return rows;
});
log(`klines: ${klines.length} bars, ${new Date(klines[0].t).toISOString().slice(0, 10)} -> ${new Date(klines.at(-1).t).toISOString().slice(0, 10)}`);

// ---------- 1b. spot 4H klines (for perp premium and spot-vs-perp RVOL) ----------
const spot = await cached('spot-klines-4h.json', async () => {
  const rows = [];
  let cursor = FROM;
  while (cursor < TO) {
    const batch = await get(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=4h&startTime=${cursor}&limit=1000`);
    if (!batch?.length) break;
    for (const k of batch) {
      if (k[0] >= TO) break;
      rows.push({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], tbv: +k[9] });
    }
    const last = batch.at(-1)[0];
    if (last <= cursor) break;
    cursor = last + H4;
    process.stdout.write(`\r  spot ${rows.length}`);
  }
  process.stdout.write('\n');
  return rows;
});
log(`spot: ${spot.length} bars, ${new Date(spot[0].t).toISOString().slice(0, 10)} -> ${new Date(spot.at(-1).t).toISOString().slice(0, 10)}`);
const spotByT = new Map(spot.map((r) => [r.t, r]));

// ---------- 2. open interest (5m daily zips) ----------
// Single-entry zips: parse the local file header, then raw-inflate the payload.
function unzipOne(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip');
  const method = buf.readUInt16LE(8);
  const compSize = buf.readUInt32LE(18);
  const start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
  const body = buf.subarray(start, compSize > 0 ? start + compSize : undefined);
  // Z_SYNC_FLUSH tolerates the trailing central directory when compSize is 0.
  return method === 0 ? body.toString() : inflateRawSync(body, { finishFlush: zc.Z_SYNC_FLUSH }).toString();
}

const days = [];
for (let d = Math.max(FROM, Date.parse('2020-09-01T00:00:00Z')); d < TO; d += 86400_000) {
  days.push(new Date(d).toISOString().slice(0, 10));
}

const oi = await cached('oi-5m.json', async () => {
  let done = 0, missing = 0;
  const parts = await pool(days, 16, async (day) => {
    const buf = await get(
      `https://data.binance.vision/data/futures/um/daily/metrics/BTCUSDT/BTCUSDT-metrics-${day}.zip`,
      { binary: true },
    );
    process.stdout.write(`\r  oi ${++done}/${days.length}`);
    if (!buf) { missing++; return []; }
    const lines = unzipOne(buf).trim().split('\n');
    const head = lines[0].split(',');
    const ix = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
    return lines.slice(1).map((ln) => {
      const c = ln.split(',');
      return {
        // "2024-01-15 00:00:00" is UTC in these dumps
        t: Date.parse(c[ix.create_time].replace(' ', 'T') + 'Z'),
        oi: +c[ix.sum_open_interest],
        oiv: +c[ix.sum_open_interest_value],
        ttls: +c[ix.sum_toptrader_long_short_ratio],
        ttlsc: +c[ix.count_toptrader_long_short_ratio],
        gls: +c[ix.count_long_short_ratio],
        tls: +c[ix.sum_taker_long_short_vol_ratio],
      };
    }).filter((r) => Number.isFinite(r.t) && Number.isFinite(r.oi));
  });
  process.stdout.write(`\n  missing days: ${missing}\n`);
  return parts.flat().sort((a, b) => a.t - b.t);
});
log(`oi: ${oi.length} 5m samples, ${new Date(oi[0].t).toISOString().slice(0, 10)} -> ${new Date(oi.at(-1).t).toISOString().slice(0, 10)}`);

// ---------- 3. funding (8h) ----------
const funding = await cached('funding.json', async () => {
  const rows = [];
  let cursor = Date.parse('2019-09-01T00:00:00Z');
  while (cursor < TO) {
    const batch = await get(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&startTime=${cursor}&limit=1000`);
    if (!batch?.length) break;
    for (const f of batch) rows.push({ t: f.fundingTime, r: +f.fundingRate });
    const last = batch.at(-1).fundingTime;
    if (last <= cursor) break;
    cursor = last + 1;
    process.stdout.write(`\r  funding ${rows.length}`);
  }
  process.stdout.write('\n');
  return rows;
});
log(`funding: ${funding.length} settlements, ${new Date(funding[0].t).toISOString().slice(0, 10)} -> ${new Date(funding.at(-1).t).toISOString().slice(0, 10)}`);

// ---------- 4. align onto the 4H grid ----------
// Both OI and funding are sampled as "last value at or before bar close".
// Bar [t, t+4h) closes at t+4h-1ms, so a strategy acting at that close may use
// any observation with timestamp <= that instant. Nothing later. That is the
// whole no-lookahead contract for this dataset.
function lastAtOrBefore(series, times) {
  const out = new Array(times.length).fill(null);
  let j = 0;
  for (let i = 0; i < times.length; i++) {
    while (j < series.length && series[j].t <= times[i]) j++;
    out[i] = j > 0 ? series[j - 1] : null;
  }
  return out;
}

const closes = klines.map((k) => k.t + H4 - 1);
const oiAt = lastAtOrBefore(oi, closes);
const frAt = lastAtOrBefore(funding, closes);

const rows = klines.map((k, i) => ({
  t: k.t,
  open: k.o, high: k.h, low: k.l, close: k.c,
  volume: k.v,
  // Spot leg, aligned by open time. Present only where Binance spot has the
  // same bar; nulls are left as nulls rather than forward-filled.
  spotOpen: spotByT.get(k.t)?.o ?? null,
  spotHigh: spotByT.get(k.t)?.h ?? null,
  spotLow: spotByT.get(k.t)?.l ?? null,
  spotClose: spotByT.get(k.t)?.c ?? null,
  spotVolume: spotByT.get(k.t)?.v ?? null,
  quoteVolume: k.qv,
  trades: k.n,
  takerBuyVolume: k.tbv,
  oi: oiAt[i]?.oi ?? null,
  oiValue: oiAt[i]?.oiv ?? null,
  topTraderLS: oiAt[i]?.ttls ?? null,
  topTraderLSCount: oiAt[i]?.ttlsc ?? null,
  globalLS: oiAt[i]?.gls ?? null,
  takerLS: oiAt[i]?.tls ?? null,
  // Funding in force at this bar close. Staleness matters: settlement is every
  // 8h so the same value repeats across two 4H bars by construction.
  funding: frAt[i]?.r ?? null,
  fundingAgeH: frAt[i] ? Math.round((closes[i] - frAt[i].t) / 3600_000) : null,
}));

// ---------- 5. integrity report ----------
const withOI = rows.filter((r) => r.oi != null);
const gaps = [];
for (let i = 1; i < klines.length; i++) {
  const d = klines[i].t - klines[i - 1].t;
  if (d !== H4) gaps.push({ after: new Date(klines[i - 1].t).toISOString(), missingBars: d / H4 - 1 });
}
// A stale OI sample means the 5m feed had a hole; >4h stale is a real gap.
const staleOI = rows.filter((r, i) => r.oi != null && oiAt[i] && closes[i] - oiAt[i].t > H4).length;
const staleFunding = rows.filter((r) => r.fundingAgeH != null && r.fundingAgeH > 8).length;

const report = {
  bars: rows.length,
  from: new Date(rows[0].t).toISOString(),
  to: new Date(rows.at(-1).t).toISOString(),
  barsWithOI: withOI.length,
  oiCoverageFrom: withOI.length ? new Date(withOI[0].t).toISOString() : null,
  barsWithFunding: rows.filter((r) => r.funding != null).length,
  klineGaps: gaps,
  staleOIBars: staleOI,
  staleFundingBars: staleFunding,
};

writeFileSync(DIR + 'btc-4h.json', JSON.stringify(rows));
writeFileSync(DIR + 'report.json', JSON.stringify(report, null, 2));

log('\n--- integrity ---');
log(JSON.stringify(report, null, 2));
log(`\nwrote cache/btc-4h.json (${(JSON.stringify(rows).length / 1e6).toFixed(1)} MB)`);
