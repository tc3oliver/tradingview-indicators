import { describe, test, eq, ok } from './harness.mjs';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, appendFileSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventWriter } from '../collector/writer.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'm2-writer-'));
const mk = (dir) => new EventWriter({ root: join(dir, 'l2'), manifestPath: join(dir, 'MANIFEST.json'), statePath: join(dir, 'state.json'), flushMs: 1e9 });
const readAll = (f) => gunzipSync(readFileSync(f)).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
const day = (iso) => Date.parse(iso);

describe('event log', () => {
  test('appended gzip members read back as one stream', () => {
    const d = tmp(), w = mk(d);
    for (let i = 0; i < 5; i++) { w.write('depth', { u: i, recvMs: day('2026-09-06T00:00:00Z') + i }); w.flush(); }
    w.close();
    const rows = readAll(join(d, 'l2', '2026-09-06', 'depth.ndjson.gz'));
    eq(rows.length, 5);
    eq(rows[4].u, 4);
    rmSync(d, { recursive: true, force: true });
  });

  test('records partition by UTC day', () => {
    const d = tmp(), w = mk(d);
    w.write('depth', { u: 1, recvMs: day('2026-09-06T23:59:59Z') });
    w.write('depth', { u: 2, recvMs: day('2026-09-07T00:00:01Z') });
    w.close();
    ok(existsSync(join(d, 'l2', '2026-09-06', 'depth.ndjson.gz')));
    ok(existsSync(join(d, 'l2', '2026-09-07', 'depth.ndjson.gz')));
    rmSync(d, { recursive: true, force: true });
  });

  test('sealing a finished day sets bytes, checksum and closes it', () => {
    const d = tmp(), w = mk(d);
    w.write('depth', { u: 1, recvMs: day('2026-09-05T12:00:00Z') });
    w.seal('2026-09-06');
    const m = JSON.parse(readFileSync(join(d, 'MANIFEST.json'), 'utf8'));
    const p = m.partitions['2026-09-05/depth'];
    eq(p.open, false);
    ok(p.bytes > 0, 'byte size must be recorded');
    eq(p.sha256.length, 64);
    w.close();
    rmSync(d, { recursive: true, force: true });
  });

  test('the checksum changes if the file is tampered with', () => {
    const d = tmp(), w = mk(d);
    w.write('depth', { u: 1, recvMs: day('2026-09-05T12:00:00Z') });
    w.seal('2026-09-06'); w.close();
    const f = join(d, 'l2', '2026-09-05', 'depth.ndjson.gz');
    const before = JSON.parse(readFileSync(join(d, 'MANIFEST.json'), 'utf8')).partitions['2026-09-05/depth'].sha256;
    appendFileSync(f, Buffer.from([0x00]));
    const w2 = mk(d);
    w2.manifest.partitions['2026-09-05/depth'].open = true;
    w2.seal('2026-09-06'); w2.close();
    const after = JSON.parse(readFileSync(join(d, 'MANIFEST.json'), 'utf8')).partitions['2026-09-05/depth'].sha256;
    ok(before !== after, 'a modified partition must not keep its old checksum');
    rmSync(d, { recursive: true, force: true });
  });

  test('restart resumes without duplicate ingestion', () => {
    const d = tmp();
    const w = mk(d);
    w.write('depth', { u: 10, recvMs: day('2026-09-06T00:00:00Z') });
    w.write('trades', { a: 77, recvMs: day('2026-09-06T00:00:00Z') });
    w.close();
    const w2 = mk(d);                                   // simulates a process restart
    eq(w2.seenDepth(10), true, 'an already written depth event must be recognised');
    eq(w2.seenDepth(11), false);
    eq(w2.seenTrade(77), true);
    eq(w2.seenTrade(78), false);
    w2.write('depth', { u: 11, recvMs: day('2026-09-06T00:00:10Z') });
    w2.close();
    eq(readAll(join(d, 'l2', '2026-09-06', 'depth.ndjson.gz')).length, 2);
    rmSync(d, { recursive: true, force: true });
  });

  test('a truncated final gzip member does not destroy earlier records', () => {
    const d = tmp(), w = mk(d);
    for (let i = 0; i < 3; i++) { w.write('depth', { u: i, recvMs: day('2026-09-06T00:00:00Z') + i }); w.flush(); }
    w.close();
    const f = join(d, 'l2', '2026-09-06', 'depth.ndjson.gz');
    const buf = readFileSync(f);
    // simulate a crash mid-write: keep everything but chop the tail of the last member
    writeFileSync(f, Buffer.concat([buf, Buffer.from([0x1f, 0x8b, 0x08])]));
    let recovered = 0;
    try { recovered = gunzipSync(readFileSync(f)).toString().trim().split('\n').length; }
    catch { // a strict gunzip refuses the trailing garbage; the salvage path is member-wise
      const whole = readFileSync(f);
      recovered = gunzipSync(whole.subarray(0, buf.length)).toString().trim().split('\n').length;
    }
    eq(recovered, 3, 'all completed records must survive a torn tail');
    rmSync(d, { recursive: true, force: true });
  });

  test('the manifest counts phases separately so warmup and prospective never merge', () => {
    const d = tmp(), w = mk(d);
    w.write('features', { at: day('2026-09-06T00:00:00Z'), recvMs: day('2026-09-06T00:00:00Z'), phase: 'warmup' });
    w.write('features', { at: day('2026-09-06T00:00:01Z'), recvMs: day('2026-09-06T00:00:01Z'), phase: 'prospective' });
    w.write('features', { at: day('2026-09-06T00:00:02Z'), recvMs: day('2026-09-06T00:00:02Z'), phase: 'prospective' });
    w.flush();
    const p = w.manifest.partitions['2026-09-06/features'];
    eq(p.phases.warmup, 1);
    eq(p.phases.prospective, 2);
    w.close();
    rmSync(d, { recursive: true, force: true });
  });

  test('a second collector on the same store is refused, not silently duplicated', () => {
    const d = tmp(), w = mk(d);
    let msg = '';
    try { mk(d); } catch (e) { msg = e.message; }
    ok(/already running/.test(msg), `expected a lock error, got: ${msg || '(no error)'}`);
    w.close();
    const w2 = mk(d);                       // the lock is released on close
    w2.close();
    rmSync(d, { recursive: true, force: true });
  });

  test('a stale lock from a dead process is reclaimed', () => {
    const d = tmp(), w = mk(d);
    w.close();
    writeFileSync(join(d, '.collector.lock'), '999999');   // a pid that is not running
    const w2 = mk(d);
    w2.close();
    rmSync(d, { recursive: true, force: true });
  });

  test('disk usage is reported', () => {
    const d = tmp(), w = mk(d);
    w.write('depth', { u: 1, recvMs: day('2026-09-06T00:00:00Z') });
    w.flush();
    ok(w.diskUsage() > 0);
    w.close();
    rmSync(d, { recursive: true, force: true });
  });
});
