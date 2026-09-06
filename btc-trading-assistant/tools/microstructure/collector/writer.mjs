// Append-safe partitioned raw event log.
//
// Format: newline-delimited JSON, gzipped in batches and appended. Concatenated gzip
// members are a valid gzip stream (RFC 1952 §2.2), so `gunzip -c` reads the whole file
// and a crash mid-run costs at most the last unflushed batch instead of the file. No
// external dependency, no rewrite-in-place, no partial-record corruption.
//
// One partition per UTC day per kind. The manifest records, for every partition, the
// event count, first and last event time, sequence gaps, resyncs, byte size, sha256 of
// the finished file, and the collector and schema versions that produced it.
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, appendFileSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash as hash } from 'node:crypto';
import { join } from 'node:path';
import { PATHS, SCHEMA_VERSION, COLLECTOR_VERSION, SYMBOL } from './config.mjs';

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

export class EventWriter {
  constructor({ root = PATHS.events, manifestPath = PATHS.manifest, statePath = PATHS.state, flushMs = 1000, maxBatch = 2000 } = {}) {
    this.root = root; this.manifestPath = manifestPath; this.statePath = statePath;
    this.flushMs = flushMs; this.maxBatch = maxBatch;
    mkdirSync(root, { recursive: true });
    this.lockPath = join(root, '..', '.collector.lock');
    this._lock();
    this.manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { schemaVersion: SCHEMA_VERSION, symbol: SYMBOL, partitions: {} };
    this.state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { lastU: {}, lastAggId: null };
    this.buffers = new Map();       // `${day}/${kind}` -> array of records
    this.dirs = new Set();          // partition directories already created
    this.dirty = false;
    this._timer = setInterval(() => this.flush(), flushMs);
    this._timer.unref?.();
  }

  // Two collectors writing the same partitions would duplicate every raw event. The
  // lock makes that a clear error instead of a corrupt archive discovered weeks later.
  _lock() {
    if (existsSync(this.lockPath)) {
      const pid = Number(readFileSync(this.lockPath, 'utf8').trim());
      let alive = false;
      try { process.kill(pid, 0); alive = true; } catch { alive = false; }
      if (alive) throw new Error(`a collector is already running (pid ${pid}). Stop it first, or open the planner it is already feeding. Lock: ${this.lockPath}`);
      unlinkSync(this.lockPath);      // stale lock from a killed process
    }
    writeFileSync(this.lockPath, String(process.pid));
    const release = () => { try { if (existsSync(this.lockPath) && readFileSync(this.lockPath, 'utf8').trim() === String(process.pid)) unlinkSync(this.lockPath); } catch { /* going down anyway */ } };
    this._release = release;
    process.once('exit', release);
  }

  key(day, kind) { return `${day}/${kind}`; }
  path(day, kind) { return join(this.root, day, `${kind}.ndjson.gz`); }

  /** Duplicate guard for depth: an event already durably written is never rewritten. */
  seenDepth(u) { return this.state.lastU.depth != null && u <= this.state.lastU.depth; }
  seenTrade(a) { return this.state.lastAggId != null && a <= this.state.lastAggId; }

  write(kind, record) {
    const day = dayOf(record.recvMs ?? record.at ?? Date.now());
    const k = this.key(day, kind);
    if (!this.buffers.has(k)) this.buffers.set(k, []);
    this.buffers.get(k).push(record);
    const p = this._part(day, kind);
    p.events++;
    p.firstMs = Math.min(p.firstMs ?? Infinity, record.recvMs ?? record.at);
    p.lastMs = Math.max(p.lastMs ?? 0, record.recvMs ?? record.at);
    if (record.phase) { p.phases ??= {}; p.phases[record.phase] = (p.phases[record.phase] || 0) + 1; }
    if (kind === 'depth' && record.u != null) this.state.lastU.depth = record.u;
    if (kind === 'trades' && record.a != null) this.state.lastAggId = record.a;
    this.dirty = true;
    if (this.buffers.get(k).length >= this.maxBatch) this.flush();
  }

  countMeta(day, field, n = 1) { const p = this._part(day, 'meta'); p[field] = (p[field] || 0) + n; this.dirty = true; }

  _part(day, kind) {
    const k = this.key(day, kind);
    if (!this.manifest.partitions[k]) {
      this.manifest.partitions[k] = { day, kind, events: 0, firstMs: null, lastMs: null,
        sequenceGaps: 0, resyncs: 0, reconnects: 0, bytes: 0, sha256: null, open: true,
        collectorVersion: COLLECTOR_VERSION, schemaVersion: SCHEMA_VERSION };
    }
    return this.manifest.partitions[k];
  }

  flush() {
    for (const [k, records] of this.buffers) {
      if (!records.length) continue;
      const [day, kind] = k.split('/');
      if (!this.dirs.has(day)) { mkdirSync(join(this.root, day), { recursive: true }); this.dirs.add(day); }
      // Synchronous append: a flush that has returned is a flush that is on disk.
      appendFileSync(this.path(day, kind), gzipSync(Buffer.from(records.map((r) => JSON.stringify(r)).join('\n') + '\n')));
      records.length = 0;
    }
    if (this.dirty) { this._persistManifest(); this.dirty = false; }
  }

  /** Close finished days: size them, checksum them, mark them closed. Atomic. */
  seal(todayIso = dayOf(Date.now())) {
    this.flush();
    for (const [k, p] of Object.entries(this.manifest.partitions)) {
      if (!p.open || p.day >= todayIso) continue;
      const file = this.path(p.day, p.kind);
      if (existsSync(file)) {
        p.bytes = statSync(file).size;
        p.sha256 = hash('sha256').update(readFileSync(file)).digest('hex');
      }
      p.open = false;
    }
    this._persistManifest();
  }

  _persistManifest() {
    this.manifest.updatedAt = new Date().toISOString();
    this.manifest.diskBytes = this.diskUsage();
    const tmp = this.manifestPath + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.manifest, null, 2));
    renameSync(tmp, this.manifestPath);
    const tmp2 = this.statePath + '.tmp';
    writeFileSync(tmp2, JSON.stringify(this.state, null, 2));
    renameSync(tmp2, this.statePath);
  }

  diskUsage() {
    let total = 0;
    if (!existsSync(this.root)) return 0;
    for (const day of readdirSync(this.root)) {
      const dir = join(this.root, day);
      try {
        for (const f of readdirSync(dir)) total += statSync(join(dir, f)).size;
      } catch { /* partition removed under us */ }
    }
    return total;
  }

  close() { clearInterval(this._timer); this.flush(); this._release?.(); }
}

export { dayOf };
