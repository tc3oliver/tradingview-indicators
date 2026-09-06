// Local USDⓈ-M order book, maintained by Binance's current published procedure.
//
//   1. buffer depthUpdate events
//   2. take a REST snapshot
//   3. drop every buffered event with u < snapshot.lastUpdateId
//   4. the first applied event must satisfy U <= lastUpdateId <= u
//   5. thereafter every event must satisfy pu === previous u
//   6. any violation invalidates the book immediately and forces a resync
//   7. quantities are absolute, and a quantity of 0 removes the level
//
// The invariant this file exists to protect: `valid` is false the instant sequence
// integrity is unproven, and nothing downstream may use an invalid book. There is no
// "probably fine" state.

export const INVALID_REASONS = {
  INIT: 'never synced',
  GAP: 'sequence gap (pu !== previous u)',
  FIRST_EVENT: 'first event did not bracket the snapshot lastUpdateId',
  DISCONNECT: 'feed disconnected',
  STALE: 'no event within the staleness window',
  CROSSED: 'book crossed (best bid >= best ask)',
  RESYNC: 'resync in progress',
};

export class OrderBook {
  constructor() {
    this.bids = new Map();          // price(number) -> qty(number)
    this.asks = new Map();
    this.lastUpdateId = null;
    this.valid = false;
    this.invalidReason = INVALID_REASONS.INIT;
    this.buffer = [];
    this.syncing = false;
    this.stats = { applied: 0, dropped: 0, gaps: 0, resyncs: 0, crossed: 0, removedMissing: 0 };
    this.lastEventMs = 0;           // exchange event time of the last applied event
    this.lastRecvMs = 0;            // local receive time of the last applied event
    this._sortedBids = null;        // lazily rebuilt descending [price, qty]
    this._sortedAsks = null;
  }

  invalidate(reason) {
    if (this.valid) this.stats.resyncs++;
    this.valid = false;
    this.invalidReason = reason;
    this.lastUpdateId = null;
    this._sortedBids = this._sortedAsks = null;
  }

  /** Buffer an event received before (or during) a snapshot. */
  bufferEvent(ev) { this.buffer.push(ev); if (this.buffer.length > 20000) this.buffer.shift(); }

  /**
   * Apply a REST snapshot and replay whatever was buffered.
   * Returns { ok, reason } — ok === false means try again with a fresh snapshot.
   */
  applySnapshot(snap) {
    this.bids = new Map();
    this.asks = new Map();
    for (const [p, q] of snap.bids) { const qty = +q; if (qty > 0) this.bids.set(+p, qty); }
    for (const [p, q] of snap.asks) { const qty = +q; if (qty > 0) this.asks.set(+p, qty); }
    this.lastUpdateId = snap.lastUpdateId;
    this._sortedBids = this._sortedAsks = null;

    const pending = this.buffer.filter((e) => e.u >= snap.lastUpdateId);
    this.stats.dropped += this.buffer.length - pending.length;
    this.buffer = [];
    if (!pending.length) {
      // No event yet covers the snapshot; stay invalid until one arrives.
      this.valid = false;
      this.invalidReason = INVALID_REASONS.RESYNC;
      this._pendingFirst = true;
      return { ok: true, reason: 'awaiting first event' };
    }
    const first = pending[0];
    if (!(first.U <= snap.lastUpdateId && first.u >= snap.lastUpdateId)) {
      this.invalidate(INVALID_REASONS.FIRST_EVENT);
      return { ok: false, reason: INVALID_REASONS.FIRST_EVENT };
    }
    this.valid = true;
    this.invalidReason = null;
    this._pendingFirst = false;
    this._applyLevels(first);
    this.lastUpdateId = first.u;
    this.lastEventMs = first.E; this.lastRecvMs = first.recvMs ?? Date.now();
    this.stats.applied++;
    for (const ev of pending.slice(1)) {
      const r = this.apply(ev);
      if (!r.ok) return r;
    }
    return { ok: true };
  }

  /**
   * Apply one depthUpdate. Returns { ok, reason }.
   * ok === false means the book is now invalid and a resync is required.
   */
  apply(ev) {
    if (!this.valid) {
      if (this._pendingFirst && this.lastUpdateId !== null) {
        if (ev.u < this.lastUpdateId) { this.stats.dropped++; return { ok: true, skipped: true }; }
        if (!(ev.U <= this.lastUpdateId && ev.u >= this.lastUpdateId)) {
          this.invalidate(INVALID_REASONS.FIRST_EVENT);
          return { ok: false, reason: INVALID_REASONS.FIRST_EVENT };
        }
        this.valid = true; this.invalidReason = null; this._pendingFirst = false;
      } else {
        this.bufferEvent(ev);
        return { ok: true, buffered: true };
      }
    } else {
      if (ev.u <= this.lastUpdateId) { this.stats.dropped++; return { ok: true, skipped: true }; }
      if (ev.pu !== this.lastUpdateId) {
        this.stats.gaps++;
        this.invalidate(INVALID_REASONS.GAP);
        return { ok: false, reason: INVALID_REASONS.GAP, expected: this.lastUpdateId, got: ev.pu };
      }
    }
    this._applyLevels(ev);
    this.lastUpdateId = ev.u;
    this.lastEventMs = ev.E; this.lastRecvMs = ev.recvMs ?? Date.now();
    this.stats.applied++;
    const b = this.bestBid(), a = this.bestAsk();
    if (b && a && b[0] >= a[0]) {
      this.stats.crossed++;
      this.invalidate(INVALID_REASONS.CROSSED);
      return { ok: false, reason: INVALID_REASONS.CROSSED };
    }
    return { ok: true };
  }

  _applyLevels(ev) {
    for (const [p, q] of ev.b || []) this._set(this.bids, +p, +q);
    for (const [p, q] of ev.a || []) this._set(this.asks, +p, +q);
    this._sortedBids = this._sortedAsks = null;
  }

  _set(side, price, qty) {
    if (qty === 0) { if (!side.delete(price)) this.stats.removedMissing++; return; }
    side.set(price, qty);
  }

  sortedBids() { return (this._sortedBids ??= [...this.bids].sort((x, y) => y[0] - x[0])); }
  sortedAsks() { return (this._sortedAsks ??= [...this.asks].sort((x, y) => x[0] - y[0])); }
  bestBid() { return this.sortedBids()[0] || null; }
  bestAsk() { return this.sortedAsks()[0] || null; }

  /** Structural checks used by the tests and by the integrity monitor. */
  audit() {
    const b = this.sortedBids(), a = this.sortedAsks();
    const problems = [];
    for (let i = 1; i < b.length; i++) if (b[i][0] >= b[i - 1][0]) { problems.push('bids not strictly descending'); break; }
    for (let i = 1; i < a.length; i++) if (a[i][0] <= a[i - 1][0]) { problems.push('asks not strictly ascending'); break; }
    if (b.length && a.length && b[0][0] >= a[0][0]) problems.push('crossed book');
    if ([...this.bids.values(), ...this.asks.values()].some((q) => !(q > 0))) problems.push('non-positive quantity retained');
    return { ok: problems.length === 0, problems, bidLevels: b.length, askLevels: a.length };
  }

  snapshotTop(n = 20) {
    return { bids: this.sortedBids().slice(0, n), asks: this.sortedAsks().slice(0, n),
      lastUpdateId: this.lastUpdateId, valid: this.valid, invalidReason: this.invalidReason };
  }
}
