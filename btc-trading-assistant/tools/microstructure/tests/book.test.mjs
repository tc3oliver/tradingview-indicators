import { describe, test, eq, ok, near } from './harness.mjs';
import { OrderBook, INVALID_REASONS } from '../collector/book.mjs';

const snap = (id = 100) => ({ lastUpdateId: id, E: 1, T: 1,
  bids: [['100.0', '2'], ['99.0', '3'], ['98.0', '1']],
  asks: [['101.0', '2'], ['102.0', '4'], ['103.0', '1']] });
const ev = (U, u, pu, b = [], a = []) => ({ e: 'depthUpdate', E: Date.now(), U, u, pu, b, a, recvMs: Date.now() });

describe('order book — sequence integrity', () => {
  test('normal sequence applies and stays valid', () => {
    const bk = new OrderBook();
    bk.bufferEvent(ev(95, 105, 94));
    eq(bk.applySnapshot(snap(100)).ok, true);
    eq(bk.valid, true);
    eq(bk.apply(ev(106, 110, 105)).ok, true);
    eq(bk.apply(ev(111, 120, 110)).ok, true);
    eq(bk.lastUpdateId, 120);
    eq(bk.stats.gaps, 0);
  });

  test('a duplicate (already applied) update is skipped, not reapplied', () => {
    const bk = new OrderBook();
    bk.bufferEvent(ev(95, 105, 94));
    bk.applySnapshot(snap(100));
    bk.apply(ev(106, 110, 105, [['100.0', '9']]));
    const before = bk.bids.get(100);
    const r = bk.apply(ev(106, 110, 105, [['100.0', '1']]));
    eq(r.ok, true); eq(r.skipped, true);
    eq(bk.bids.get(100), before, 'a replayed event must not change the book');
  });

  test('an update older than the snapshot is dropped', () => {
    const bk = new OrderBook();
    bk.bufferEvent(ev(50, 60, 49));         // entirely before the snapshot
    bk.bufferEvent(ev(95, 105, 94));
    bk.applySnapshot(snap(100));
    ok(bk.stats.dropped >= 1, 'the stale buffered event should have been dropped');
    eq(bk.valid, true);
  });

  test('a missing update (pu !== previous u) invalidates immediately', () => {
    const bk = new OrderBook();
    bk.bufferEvent(ev(95, 105, 94));
    bk.applySnapshot(snap(100));
    const r = bk.apply(ev(120, 130, 119));    // pu 119 !== 105
    eq(r.ok, false);
    eq(r.reason, INVALID_REASONS.GAP);
    eq(bk.valid, false);
    eq(bk.lastUpdateId, null, 'an invalid book must not keep a usable sequence id');
    eq(bk.stats.gaps, 1);
  });

  test('an out-of-order event arriving after a gap does not silently repair the book', () => {
    const bk = new OrderBook();
    bk.bufferEvent(ev(95, 105, 94));
    bk.applySnapshot(snap(100));
    bk.apply(ev(120, 130, 119));               // gap -> invalid
    const r = bk.apply(ev(106, 110, 105));     // the event we missed, arriving late
    eq(bk.valid, false, 'only a fresh snapshot may revalidate the book');
    eq(r.buffered, true);
  });

  test('a first event that does not bracket lastUpdateId is rejected', () => {
    const bk = new OrderBook();
    bk.bufferEvent(ev(150, 160, 149));         // U > lastUpdateId: a hole exists
    const r = bk.applySnapshot(snap(100));
    eq(r.ok, false);
    eq(r.reason, INVALID_REASONS.FIRST_EVENT);
    eq(bk.valid, false);
  });

  test('snapshot race: events buffered during the fetch are replayed in order', () => {
    const bk = new OrderBook();
    bk.bufferEvent(ev(95, 105, 94, [['100.0', '5']]));
    bk.bufferEvent(ev(106, 110, 105, [['100.0', '6']]));
    bk.bufferEvent(ev(111, 115, 110, [['100.0', '7']]));
    eq(bk.applySnapshot(snap(100)).ok, true);
    eq(bk.valid, true);
    eq(bk.lastUpdateId, 115);
    eq(bk.bids.get(100), 7, 'the last buffered value must win');
  });

  test('disconnect invalidates and a resync restores', () => {
    const bk = new OrderBook();
    bk.bufferEvent(ev(95, 105, 94));
    bk.applySnapshot(snap(100));
    bk.invalidate(INVALID_REASONS.DISCONNECT);
    eq(bk.valid, false);
    eq(bk.invalidReason, INVALID_REASONS.DISCONNECT);
    bk.bufferEvent(ev(195, 205, 194));
    eq(bk.applySnapshot(snap(200)).ok, true);
    eq(bk.valid, true);
    ok(bk.stats.resyncs >= 1);
  });
});

describe('order book — structure', () => {
  test('bids descend, asks ascend, bid < ask', () => {
    const bk = new OrderBook();
    bk.bufferEvent(ev(95, 105, 94));
    bk.applySnapshot(snap(100));
    const a = bk.audit();
    eq(a.ok, true, a.problems.join('; '));
    eq(bk.bestBid()[0], 100);
    eq(bk.bestAsk()[0], 101);
  });

  test('zero quantity removes a level and no non-positive quantity is retained', () => {
    const bk = new OrderBook();
    bk.bufferEvent(ev(95, 105, 94));
    bk.applySnapshot(snap(100));
    bk.apply(ev(106, 110, 105, [['99.0', '0']]));
    eq(bk.bids.has(99), false);
    eq(bk.audit().ok, true);
  });

  test('removing a level we never held is normal and is counted, not fatal', () => {
    const bk = new OrderBook();
    bk.bufferEvent(ev(95, 105, 94));
    bk.applySnapshot(snap(100));
    const r = bk.apply(ev(106, 110, 105, [['1.0', '0']]));
    eq(r.ok, true);
    eq(bk.stats.removedMissing, 1);
  });

  test('a crossed book is detected and invalidates', () => {
    const bk = new OrderBook();
    bk.bufferEvent(ev(95, 105, 94));
    bk.applySnapshot(snap(100));
    const r = bk.apply(ev(106, 110, 105, [['105.0', '1']]));   // bid above the best ask
    eq(r.ok, false);
    eq(r.reason, INVALID_REASONS.CROSSED);
    eq(bk.valid, false);
    eq(bk.stats.crossed, 1);
  });

  test('snapshot and diff reconcile: replaying diffs onto an old snapshot reaches the new state', () => {
    const a = new OrderBook(), b = new OrderBook();
    const diffs = [ev(95, 105, 94, [['100.0', '5']], [['101.0', '3']]),
      ev(106, 110, 105, [['99.5', '2']], [['101.0', '0']]),
      ev(111, 115, 110, [['100.0', '4']], [['104.0', '7']])];
    a.bufferEvent(diffs[0]); a.applySnapshot(snap(100));
    a.apply(diffs[1]); a.apply(diffs[2]);
    // the same diffs replayed from the same snapshot must reproduce the book exactly
    for (const d of diffs) b.bufferEvent({ ...d });
    b.applySnapshot(snap(100));
    eq([...b.bids].sort().join(), [...a.bids].sort().join(), 'bids diverged');
    eq([...b.asks].sort().join(), [...a.asks].sort().join(), 'asks diverged');
    eq(b.lastUpdateId, a.lastUpdateId);
    near(b.bestBid()[1], 4, 1e-12);
  });
});
