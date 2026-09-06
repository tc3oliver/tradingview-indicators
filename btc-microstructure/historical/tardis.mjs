// Tardis.dev provider adapter.
//
// Two sources, and the difference between them is load-bearing:
//
//   datasets CSV  (`incremental_book_L2`, `trades`) — compact enough to replay years.
//                 Tardis-normalised: absolute price levels, periodic snapshots, but
//                 NO Binance U/u/pu sequence ids, so the exchange's own continuity
//                 rule cannot be applied to it.
//   replay API    — the ORIGINAL Binance payloads, U/u/pu intact, identical in
//                 semantics to what our live collector receives. About 26 GB/day
//                 uncompressed, so it is used on sample windows to prove the CSV path
//                 reconstructs the same book, not as the bulk source.
//
// Auth: TARDIS_API_KEY if present. Without it both endpoints serve only the first day
// of each calendar month, which is enough to integrate and reconcile against but is
// NOT enough for an acceptance verdict — see research/DATA-REQUIREMENTS.md.
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { createReadStream, mkdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const SCRATCH = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'historical', '.scratch');

export const EXCHANGE = 'binance-futures';
export const SYMBOL = 'BTCUSDT';
export const AVAILABLE_SINCE = '2019-11-17';
// Tardis documents capture problems (missing data, latency) before 2020-05-14 for this
// exchange. Anything earlier may be described, never used for acceptance.
export const RELIABLE_SINCE = '2020-05-14';

export const apiKey = () => process.env.TARDIS_API_KEY || null;
export const authHeaders = () => (apiKey() ? { Authorization: `Bearer ${apiKey()}` } : {});

/** Free access covers the first day of each month only. */
export const isFreeDay = (iso) => iso.slice(8, 10) === '01';
export const canFetch = (iso) => Boolean(apiKey()) || isFreeDay(iso);

export function datasetUrl(dataType, iso, symbol = SYMBOL) {
  const [y, m, d] = iso.split('-');
  return `https://datasets.tardis.dev/v1/${EXCHANGE}/${dataType}/${y}/${m}/${d}/${symbol}.csv.gz`;
}

export function replayUrl(from, to, channels = 'depth', symbol = SYMBOL) {
  const list = (Array.isArray(channels) ? channels : [channels]).map((channel) => ({ channel, symbols: [symbol.toLowerCase()] }));
  const filters = encodeURIComponent(JSON.stringify(list));
  return `https://api.tardis.dev/v1/data-feeds/${EXCHANGE}?from=${from}&to=${to}&filters=${filters}`;
}

async function open(url) {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`${res.status} ${url}${body ? ` — ${body.slice(0, 300)}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

/**
 * Fetch a day's archive to the scratch directory, resumably.
 *
 * Streaming a 400 MB body straight out of `fetch` fails: the server speaks HTTP/2 and
 * long-running streams die with NGHTTP2_PROTOCOL_ERROR partway through. curl over
 * HTTP/1.1 with `--retry` and `-C -` survives, so the archive lands on disk first and is
 * read from there. The scratch copy is deleted after the day is replayed unless kept.
 */
export async function fetchDataset(dataType, iso, symbol = SYMBOL) {
  mkdirSync(SCRATCH, { recursive: true });
  const out = join(SCRATCH, `${dataType}-${symbol}-${iso}.csv.gz`);
  if (existsSync(out) && statSync(out).size > 0) return out;
  const args = ['-sfL', '--http1.1', '--retry', '6', '--retry-delay', '3', '--retry-all-errors',
    '-C', '-', '-o', out, datasetUrl(dataType, iso, symbol)];
  if (apiKey()) args.push('-H', `Authorization: Bearer ${apiKey()}`);
  await new Promise((resolve, reject) => {
    const c = spawn('curl', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => {
      if (code === 0) return resolve();
      try { if (existsSync(out)) unlinkSync(out); } catch { /* nothing to clean */ }
      const e = new Error(`curl exit ${code} for ${dataType} ${iso}${err ? ` — ${err.slice(0, 200)}` : ''}`);
      e.status = code === 22 ? 401 : null;   // curl 22 == HTTP >= 400, which here means unauthorised
      reject(e);
    });
  });
  return out;
}

export function discardDataset(dataType, iso, symbol = SYMBOL) {
  const p = join(SCRATCH, `${dataType}-${symbol}-${iso}.csv.gz`);
  try { if (existsSync(p)) unlinkSync(p); } catch { /* already gone */ }
}

/**
 * Stream a gzipped dataset CSV line by line from the scratch copy. The archive is
 * decompressed in flight and never fully materialised, which is what makes multi-year
 * replay possible on a laptop.
 * @returns {AsyncGenerator<string>} data lines, header removed
 */
export async function* streamDataset(dataType, iso, symbol = SYMBOL) {
  const file = await fetchDataset(dataType, iso, symbol);
  const gz = createReadStream(file).pipe(createGunzip());
  const rl = createInterface({ input: gz, crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; if (line.startsWith('exchange,')) continue; }
    if (!line) continue;
    yield line;
  }
}

/**
 * Raw Binance payloads for a window. Used to prove semantics, not to bulk-load.
 *
 * Fetched through curl for the same reason the datasets are: a long-running HTTP/2 body
 * dies partway with NGHTTP2_PROTOCOL_ERROR, and a silently truncated reconciliation
 * window would look like a short overlap rather than an error.
 */
export async function* streamReplay(fromIso, toIso, channels = 'depth', symbol = SYMBOL) {
  mkdirSync(SCRATCH, { recursive: true });
  const list = (Array.isArray(channels) ? channels : [channels]).join('+');
  const tag = `${fromIso}_${toIso}_${list}`.replace(/[^0-9a-zA-Z._+-]/g, '');
  const file = join(SCRATCH, `replay-${symbol}-${tag}.ndjson`);
  if (!existsSync(file) || statSync(file).size === 0) {
    const args = ['-sfL', '--http1.1', '--retry', '6', '--retry-delay', '3', '--retry-all-errors',
      '-o', file, replayUrl(fromIso, toIso, channels, symbol)];
    if (apiKey()) args.push('-H', `Authorization: Bearer ${apiKey()}`);
    await new Promise((resolve, reject) => {
      const c = spawn('curl', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      c.stderr.on('data', (d) => { err += d; });
      c.on('close', (code) => {
        if (code === 0) return resolve();
        try { if (existsSync(file)) unlinkSync(file); } catch { /* nothing to clean */ }
        const e = new Error(`curl exit ${code} for replay ${tag}${err ? ` — ${err.slice(0, 200)}` : ''}`);
        e.status = code === 22 ? 401 : null;
        reject(e);
      });
    });
  }
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const sp = line.indexOf(' ');
    if (sp < 0) continue;
    const localTs = Date.parse(line.slice(0, sp));       // Tardis capture timestamp
    let msg;
    try { msg = JSON.parse(line.slice(sp + 1)); } catch { continue; }
    yield { localTs, payload: msg.data ?? msg, stream: msg.stream ?? null };
  }
}

/** Compressed size of a day, without downloading it. */
export async function daySize(dataType, iso, symbol = SYMBOL) {
  try {
    const res = await fetch(datasetUrl(dataType, iso, symbol), { method: 'HEAD', headers: authHeaders() });
    const len = Number(res.headers.get('content-length'));
    return res.ok && Number.isFinite(len) ? len : null;
  } catch { return null; }
}

/** Every day in [from, to], and every day we are actually allowed to fetch. */
export function dayRange(from, to) {
  const out = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
export const fetchableDays = (from, to) => dayRange(from, to).filter(canFetch);
