// Columnar feature store.
//
// One file per UTC day: a JSON header line naming the columns and the version, then the
// concatenated Float64 column buffers, all gzipped. Columnar because every study reads a
// few columns over many days and none of them wants to parse 86,400 JSON objects per day;
// no external dependency because this repository has none and a parquet writer is not
// worth a supply chain.
//
// The store is DERIVED. `historical/replay.mjs` regenerates it from the vendor archives,
// and the manifest records the checksum, the row count, and the versions of the code that
// produced it, so a stale file cannot be silently mixed with a fresh one.
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STORE_VERSION = 'fs1';
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'historical', STORE_VERSION);
export const MANIFEST = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'historical', 'MANIFEST-M2H.json');

// Fixed column order. Adding a column is a store-version bump, not an edit.
export const COLUMNS = [
  'at', 'bid', 'ask', 'bidQty', 'askQty', 'mid', 'spreadBp', 'microprice', 'micropriceDisplacementBp',
  'depthBidTop1', 'depthBidTop5', 'depthBidTop10', 'depthBid1bp', 'depthBid2bp', 'depthBid5bp', 'depthBid10bp',
  'depthAskTop1', 'depthAskTop5', 'depthAskTop10', 'depthAsk1bp', 'depthAsk2bp', 'depthAsk5bp', 'depthAsk10bp',
  'imbTop1', 'imbTop5', 'imbTop10', 'imbWeighted',
  'flow1sSigned', 'flow1sAfi', 'flow5sSigned', 'flow5sAfi', 'flow5sBuy', 'flow5sSell', 'flow30sSigned', 'flow30sAfi',
  'pressureToCapacity', 'flowOverOppositeNearDepth', 'flowTimesImbalance', 'flowTimesFragility',
  'execBuy10kVwap', 'execBuy10kSlipBp', 'execBuy10kComplete', 'execSell10kVwap', 'execSell10kSlipBp', 'execSell10kComplete',
  'execBuy50kVwap', 'execBuy50kSlipBp', 'execBuy50kComplete', 'execSell50kVwap', 'execSell50kSlipBp', 'execSell50kComplete',
  'bidLevels', 'askLevels',
];

/** Flatten a live/historical feature record into the fixed column order. */
export function flatten(fx) {
  const d = fx.depth, f = fx.flow || {}, w1 = f['1000ms'] || {}, w5 = f['5000ms'] || {}, w30 = f['30000ms'] || {};
  const i = fx.interaction || {};
  const e = (side, size, field) => { const x = fx.exec?.[side]?.[size]; return x ? (field === 'complete' ? (x.complete ? 1 : 0) : x[field] ?? NaN) : NaN; };
  return [
    fx.at, fx.bid, fx.ask, fx.bidQty, fx.askQty, fx.mid, fx.spreadBp, fx.microprice, fx.micropriceDisplacementBp,
    d.bid.top1, d.bid.top5, d.bid.top10, d.bid.within1bp, d.bid.within2bp, d.bid.within5bp, d.bid.within10bp,
    d.ask.top1, d.ask.top5, d.ask.top10, d.ask.within1bp, d.ask.within2bp, d.ask.within5bp, d.ask.within10bp,
    fx.imbalance.top1, fx.imbalance.top5, fx.imbalance.top10, fx.imbalance.weighted,
    w1.signedQuote ?? NaN, w1.afi ?? NaN, w5.signedQuote ?? NaN, w5.afi ?? NaN, w5.buyQuote ?? NaN, w5.sellQuote ?? NaN,
    w30.signedQuote ?? NaN, w30.afi ?? NaN,
    i.pressureToCapacity ?? NaN, i.flowOverOppositeNearDepth ?? NaN, i.flowTimesImbalance ?? NaN, i.flowTimesFragility ?? NaN,
    e('BUY', 10000, 'vwap'), e('BUY', 10000, 'slippageBp'), e('BUY', 10000, 'complete'),
    e('SELL', 10000, 'vwap'), e('SELL', 10000, 'slippageBp'), e('SELL', 10000, 'complete'),
    e('BUY', 50000, 'vwap'), e('BUY', 50000, 'slippageBp'), e('BUY', 50000, 'complete'),
    e('SELL', 50000, 'vwap'), e('SELL', 50000, 'slippageBp'), e('SELL', 50000, 'complete'),
    fx.bidLevels, fx.askLevels,
  ];
}

export const dayPath = (iso) => join(ROOT, `${iso}.fs.gz`);

export function writeDay(iso, rows, meta = {}) {
  mkdirSync(ROOT, { recursive: true });
  const n = rows.length, k = COLUMNS.length;
  const cols = COLUMNS.map(() => new Float64Array(n));
  for (let r = 0; r < n; r++) for (let c = 0; c < k; c++) cols[c][r] = rows[r][c];
  let header = JSON.stringify({ version: STORE_VERSION, day: iso, rows: n, columns: COLUMNS, ...meta });
  // Pad so the column data starts on an 8-byte boundary: a Float64Array cannot be laid
  // over a buffer at an arbitrary offset, and copying 27 MB a day to work around that
  // would be silly when a few spaces fix it.
  while ((header.length + 1) % 8 !== 0) header += ' ';
  const body = Buffer.concat([Buffer.from(header + '\n'), ...cols.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))]);
  const gz = gzipSync(body);
  const tmp = dayPath(iso) + '.tmp';
  writeFileSync(tmp, gz);
  renameSync(tmp, dayPath(iso));
  const sha = createHash('sha256').update(gz).digest('hex');
  updateManifest(iso, { rows: n, bytes: gz.length, sha256: sha, ...meta });
  return { rows: n, bytes: gz.length, sha256: sha };
}

export function readDay(iso) {
  const p = dayPath(iso);
  if (!existsSync(p)) return null;
  const buf = gunzipSync(readFileSync(p));
  const nl = buf.indexOf(10);
  const header = JSON.parse(buf.subarray(0, nl).toString('utf8'));
  const n = header.rows, k = header.columns.length;
  const data = buf.subarray(nl + 1);
  if (data.byteOffset % 8 !== 0) throw new Error(`${p}: column data is not 8-byte aligned; the file was not written by this store version`);
  const cols = {};
  for (let c = 0; c < k; c++) {
    cols[header.columns[c]] = new Float64Array(data.buffer, data.byteOffset + c * n * 8, n);
  }
  return { header, n, cols };
}

/**
 * Read-modify-write the manifest under a lock.
 *
 * Days are independent, so replay parallelises across processes — but they all append to
 * one manifest, and an unlocked read-modify-write loses whichever entry landed second.
 * A day of compute is too expensive to lose to a race that a lock file prevents.
 */
function withManifestLock(fn) {
  const lock = MANIFEST + '.lock';
  const deadline = Date.now() + 30_000;
  for (;;) {
    try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); break; }
    catch {
      if (Date.now() > deadline) {                 // a crashed writer left it behind
        try { unlinkSync(lock); } catch { /* someone else cleaned up */ }
        continue;
      }
      const until = Date.now() + 25;
      while (Date.now() < until) { /* brief spin; the critical section is a file write */ }
    }
  }
  try { return fn(); } finally { try { unlinkSync(lock); } catch { /* already gone */ } }
}

export function updateManifest(iso, entry) {
  mkdirSync(dirname(MANIFEST), { recursive: true });
  return withManifestLock(() => _updateManifest(iso, entry));
}

function _updateManifest(iso, entry) {
  const m = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { storeVersion: STORE_VERSION, days: {} };
  m.days[iso] = { ...entry, writtenAt: new Date().toISOString() };
  m.updatedAt = new Date().toISOString();
  m.totalBytes = Object.values(m.days).reduce((s, d) => s + (d.bytes || 0), 0);
  m.totalRows = Object.values(m.days).reduce((s, d) => s + (d.rows || 0), 0);
  const tmp = MANIFEST + '.tmp';
  writeFileSync(tmp, JSON.stringify(m, null, 2));
  renameSync(tmp, MANIFEST);
  return m;
}

export const manifest = () => (existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { storeVersion: STORE_VERSION, days: {} });
export const storedDays = () => (existsSync(ROOT) ? readdirSync(ROOT).filter((f) => f.endsWith('.fs.gz')).map((f) => f.slice(0, 10)).sort() : []);

/** Re-checksum every stored day against the manifest. */
export function verify() {
  const m = manifest(), bad = [];
  for (const iso of storedDays()) {
    const rec = m.days[iso];
    const sha = createHash('sha256').update(readFileSync(dayPath(iso))).digest('hex');
    if (!rec) bad.push({ day: iso, problem: 'not in manifest' });
    else if (rec.sha256 !== sha) bad.push({ day: iso, problem: 'checksum mismatch' });
    else if (statSync(dayPath(iso)).size !== rec.bytes) bad.push({ day: iso, problem: 'size mismatch' });
  }
  return { days: storedDays().length, bad };
}
