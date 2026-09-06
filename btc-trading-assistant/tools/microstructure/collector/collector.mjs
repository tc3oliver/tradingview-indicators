// The collector: two websockets, one validated local order book, an append-safe raw
// event log, and a 1 Hz feature record.
//
// Two connections because the exchange routes these streams differently — observed
// 2026-09-06, see config.mjs and research/LITERATURE-M2.md §1.
//
// What is persisted, and why:
//   depth     every depthUpdate, so the book can be rebuilt from scratch
//   trades    every aggTrade, so flow can be recomputed at any window
//   meta      snapshots, resyncs, reconnects, invalidations — the audit trail
//   features  one derived record per second, so 30 days of research does not require
//             replaying tens of gigabytes of diffs. Derived, and recomputable.
// bookTicker is deliberately NOT persisted: measured at ~140 msg/s against depth's
// ~10/s, and depth@100ms already carries every top-of-book change our 5s/30s/5m
// horizons can use. Recorded here so the omission is a decision, not an oversight.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { WS, REST, RECONNECT_HOURS, STALE_MS, PATHS, SCHEMA_VERSION, COLLECTOR_VERSION, SYMBOL, BOOK } from './config.mjs';
import { OrderBook, INVALID_REASONS } from './book.mjs';
import { Stream } from './ws.mjs';
import { EventWriter, dayOf } from './writer.mjs';
import { FlowWindows, bookFeatures } from '../features/book-features.mjs';
import { walkBook } from '../features/execution.mjs';

// Order sizes the execution study is pre-registered on: 10k primary, 50k secondary.
export const EXEC_SIZES = [10000, 50000];

export class Collector {
  constructor({ writer, log = console.log } = {}) {
    this.book = new OrderBook();
    this.flow = new FlowWindows();
    this.writer = writer ?? new EventWriter();
    this.log = log;
    this.started = Date.now();
    this.lastFeature = null;
    this.snapshotInFlight = false;
    this.counters = { depth: 0, trades: 0, snapshots: 0, resyncs: 0, gaps: 0, reconnects: 0, featureRecords: 0, duplicatesSkipped: 0 };
    this.prospective = this._loadProspective();
  }

  // ---- prospective boundary (PART 8) -------------------------------------
  // M2's prospective sample starts at the first valid book AFTER the M2
  // pre-registration commit. Everything earlier is WARMUP / ENGINEERING DATA. The
  // file is written once and never rewritten; a schema bump starts a new one.
  _loadProspective() {
    if (existsSync(PATHS.prospective)) return JSON.parse(readFileSync(PATHS.prospective, 'utf8'));
    return { schemaVersion: SCHEMA_VERSION, collectorVersion: COLLECTOR_VERSION, symbol: SYMBOL, startedAt: null, startedLastUpdateId: null, note: 'set on the first valid book after the M2 freeze' };
  }

  get phase() { return this.prospective.startedAt ? 'prospective' : 'warmup'; }

  /** The freeze marker is the gatekeeper: no freeze file, no prospective phase. */
  freeze() {
    if (this._freeze !== undefined) return this._freeze;
    if (!existsSync(PATHS.freeze)) return (this._freeze = null);
    try {
      const f = JSON.parse(readFileSync(PATHS.freeze, 'utf8'));
      // A schema bump invalidates the old prospective identity rather than inheriting it.
      if (f.schemaVersion !== SCHEMA_VERSION) return (this._freeze = null);
      return (this._freeze = f);
    } catch { return (this._freeze = null); }
  }

  _markProspectiveStart() {
    if (this.prospective.startedAt) return;
    const f = this.freeze();
    if (!f?.frozenAtMs || Date.now() <= f.frozenAtMs) return;   // still WARMUP / ENGINEERING DATA
    this.prospective.freezeCommit = f.commit;
    this.prospective.frozenAt = f.frozenAt;
    this.prospective.startedAt = new Date().toISOString();
    this.prospective.startedAtMs = Date.now();
    this.prospective.startedLastUpdateId = this.book.lastUpdateId;
    mkdirSync(PATHS.data, { recursive: true });
    writeFileSync(PATHS.prospective, JSON.stringify(this.prospective, null, 2));
    this.log(`M2_PROSPECTIVE_START = ${this.prospective.startedAt} (lastUpdateId ${this.prospective.startedLastUpdateId})`);
  }

  // ---- lifecycle ---------------------------------------------------------
  start() {
    this.depthStream = new Stream(WS.depth, {
      name: 'depth', staleMs: STALE_MS, maxHours: RECONNECT_HOURS,
      onMessage: (d, recvMs) => this.onDepth(d, recvMs),
      onEvent: (e) => this.onMeta(e),
    }).start();
    this.tradeStream = new Stream(WS.trades, {
      name: 'trades', staleMs: 60_000, maxHours: RECONNECT_HOURS,
      onMessage: (d, recvMs) => this.onTrade(d, recvMs),
      onEvent: (e) => this.onMeta(e),
    }).start();
    // Snapshot only once the depth feed is actually delivering, per the exchange's own
    // step 1 (buffer first, snapshot second). Snapshotting before the socket is open
    // guarantees a hole between the snapshot and the first event.
    const waitForFeed = setInterval(() => {
      if (this.depthStream.messages > 0) { clearInterval(waitForFeed); this.resync('startup'); }
    }, 100);
    waitForFeed.unref?.();
    setTimeout(() => { clearInterval(waitForFeed); if (!this.book.valid && !this.snapshotInFlight) this.resync('startup (feed did not arrive)'); }, 15_000).unref?.();
    this._featureTimer = setInterval(() => this.emitFeature(), 1000 / BOOK.featureHz);
    this._sealTimer = setInterval(() => this.writer.seal(), 60_000);
    this._featureTimer.unref?.(); this._sealTimer.unref?.();
    return this;
  }

  stop() {
    clearInterval(this._featureTimer); clearInterval(this._sealTimer);
    this.depthStream?.stop(); this.tradeStream?.stop();
    this.writer.close();
  }

  onMeta(e) {
    if (e.type === 'ws_reconnect' || e.type === 'ws_rotate' || e.type === 'ws_stale') {
      this.counters.reconnects++;
      this.writer.countMeta(dayOf(Date.now()), 'reconnects');
      if (e.stream === 'depth') {
        this.book.invalidate(INVALID_REASONS.DISCONNECT);
        this.resync(`depth ${e.type}`);
      }
    }
    this.writer.write('meta', { ...e, phase: this.phase, recvMs: e.at ?? Date.now() });
  }

  async resync(reason) {
    if (this.snapshotInFlight) return;
    this.snapshotInFlight = true;
    this.counters.resyncs++;
    this.writer.countMeta(dayOf(Date.now()), 'resyncs');
    this.writer.write('meta', { type: 'resync_begin', reason, at: Date.now(), recvMs: Date.now(), phase: this.phase });
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        const res = await fetch(REST.depthSnapshot);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const snap = await res.json();
        const r = this.book.applySnapshot(snap);
        this.counters.snapshots++;
        this.writer.write('meta', { type: 'snapshot', at: Date.now(), recvMs: Date.now(), phase: this.phase,
          lastUpdateId: snap.lastUpdateId, E: snap.E, T: snap.T, bids: snap.bids.length, asks: snap.asks.length,
          applied: r.ok, note: r.reason ?? null });
        if (r.ok) { this.snapshotInFlight = false; return true; }
      } catch (err) {
        this.writer.write('meta', { type: 'snapshot_error', at: Date.now(), recvMs: Date.now(), phase: this.phase, attempt, error: String(err.message || err) });
      }
      await new Promise((r) => setTimeout(r, Math.min(10_000, 300 * 2 ** attempt)));
    }
    this.snapshotInFlight = false;
    return false;
  }

  onDepth(d, recvMs) {
    if (d?.e !== 'depthUpdate') return;
    if (this.writer.seenDepth(d.u)) { this.counters.duplicatesSkipped++; return; }
    this.counters.depth++;
    const rec = { e: d.e, E: d.E, T: d.T, U: d.U, u: d.u, pu: d.pu, b: d.b, a: d.a, recvMs, phase: this.phase };
    this.writer.write('depth', rec);
    const before = this.book.valid;
    const r = this.book.apply({ ...d, recvMs });
    if (!r.ok) {
      if (r.reason === INVALID_REASONS.GAP) { this.counters.gaps++; this.writer.countMeta(dayOf(recvMs), 'sequenceGaps'); }
      this.writer.write('meta', { type: 'book_invalid', at: recvMs, recvMs, phase: this.phase, reason: r.reason, expected: r.expected ?? null, got: r.got ?? null });
      this.resync(r.reason);
      return;
    }
    if (!before && this.book.valid) {
      this.writer.write('meta', { type: 'book_valid', at: recvMs, recvMs, phase: this.phase, lastUpdateId: this.book.lastUpdateId });
      this._markProspectiveStart();
    }
  }

  onTrade(d, recvMs) {
    if (d?.e !== 'aggTrade') return;
    if (this.writer.seenTrade(d.a)) { this.counters.duplicatesSkipped++; return; }
    this.counters.trades++;
    const price = +d.p, qty = +d.q, quote = price * qty;
    // m === true means the buyer was the maker, so the seller was the aggressor.
    const aggressiveBuy = d.m === false;
    this.writer.write('trades', { a: d.a, p: d.p, q: d.q, f: d.f, l: d.l, T: d.T, E: d.E, m: d.m, recvMs, phase: this.phase });
    this.flow.add(d.T ?? recvMs, quote, aggressiveBuy);
  }

  emitFeature() {
    const now = Date.now();
    this.flow.prune(now);
    if (!this.book.valid) { this.lastFeature = null; return; }
    if (this.depthStream?.stale) {
      this.book.invalidate(INVALID_REASONS.STALE);
      this.writer.write('meta', { type: 'book_invalid', at: now, recvMs: now, phase: this.phase, reason: INVALID_REASONS.STALE });
      this.resync('stale depth feed');
      return;
    }
    const fx = bookFeatures(this.book, this.flow, now);
    if (!fx) return;
    // Execution estimates for the pre-declared sizes are stored with the record. They
    // are derived (walkBook over the same book) and recomputable from the raw depth
    // log, but storing them is what lets the execution study run without replaying
    // tens of gigabytes of diffs. Sizes are fixed in config, not searched.
    fx.exec = {};
    for (const side of ['BUY', 'SELL']) {
      fx.exec[side] = {};
      for (const n of EXEC_SIZES) {
        const e = walkBook(this.book, side, n);
        fx.exec[side][n] = e.ok
          ? { vwap: e.vwap, slippageBp: e.slippageBp, allInBp: e.allInBp, complete: e.complete, levels: e.levelsUsed }
          : { complete: false };
      }
    }
    this.lastFeature = fx;
    this.counters.featureRecords++;
    this.writer.write('features', { ...fx, phase: this.phase, schemaVersion: SCHEMA_VERSION });
  }

  /** Everything the integrity monitor and the planner UI need. */
  status() {
    const audit = this.book.valid ? this.book.audit() : { ok: false, problems: ['book invalid'], bidLevels: this.book.bids.size, askLevels: this.book.asks.size };
    return {
      symbol: SYMBOL, schemaVersion: SCHEMA_VERSION, collectorVersion: COLLECTOR_VERSION,
      uptimeSec: Math.round((Date.now() - this.started) / 1000),
      book: { valid: this.book.valid, reason: this.book.invalidReason, lastUpdateId: this.book.lastUpdateId,
        bidLevels: audit.bidLevels, askLevels: audit.askLevels, structural: audit },
      feeds: {
        depth: { ageMs: this.depthStream?.ageMs ?? Infinity, stale: this.depthStream?.stale ?? true, messages: this.depthStream?.messages ?? 0, reconnects: this.depthStream?.reconnects ?? 0 },
        trades: { ageMs: this.tradeStream?.ageMs ?? Infinity, stale: this.tradeStream?.stale ?? true, messages: this.tradeStream?.messages ?? 0, reconnects: this.tradeStream?.reconnects ?? 0 },
      },
      counters: { ...this.counters, bookStats: this.book.stats },
      storage: { diskBytes: this.writer.manifest.diskBytes ?? 0, partitions: Object.keys(this.writer.manifest.partitions).length },
      phase: this.phase,
      freeze: this.freeze(),
      prospective: this.prospective,
    };
  }
}
