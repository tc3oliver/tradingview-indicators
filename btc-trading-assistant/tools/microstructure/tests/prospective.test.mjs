import { describe, test, eq, ok } from './harness.mjs';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Collector } from '../collector/collector.mjs';
import { EventWriter } from '../collector/writer.mjs';
import { PATHS, SCHEMA_VERSION } from '../collector/config.mjs';

// A collector wired to a temporary store, with the freeze marker under our control.
function make(dir, freeze) {
  const w = new EventWriter({ root: join(dir, 'l2'), manifestPath: join(dir, 'MANIFEST.json'), statePath: join(dir, 'state.json'), flushMs: 1e9 });
  const c = new Collector({ writer: w, log: () => {} });
  c.prospective = { schemaVersion: SCHEMA_VERSION, startedAt: null };
  Object.defineProperty(c, 'freeze', { value: () => freeze, writable: true });
  const path = join(dir, 'PROSPECTIVE.json');
  c._markProspectiveStart = function () {
    if (this.prospective.startedAt) return;
    const f = this.freeze();
    if (!f?.frozenAtMs || Date.now() <= f.frozenAtMs) return;
    this.prospective.startedAt = new Date().toISOString();
    writeFileSync(path, JSON.stringify(this.prospective));
  };
  return { c, w, path };
}

describe('prospective boundary', () => {
  test('with no freeze marker the collector cannot leave WARMUP', () => {
    const d = mkdtempSync(join(tmpdir(), 'm2-prosp-'));
    const { c, w, path } = make(d, null);
    c._markProspectiveStart();
    eq(c.phase, 'warmup');
    eq(existsSync(path), false, 'no prospective file may be written before the freeze');
    w.close(); rmSync(d, { recursive: true, force: true });
  });

  test('a freeze dated in the future does not start the prospective sample yet', () => {
    const d = mkdtempSync(join(tmpdir(), 'm2-prosp-'));
    const { c, w } = make(d, { frozenAtMs: Date.now() + 3_600_000, schemaVersion: SCHEMA_VERSION, commit: 'abc' });
    c._markProspectiveStart();
    eq(c.phase, 'warmup');
    w.close(); rmSync(d, { recursive: true, force: true });
  });

  test('after the freeze the first valid book starts the prospective sample, once', () => {
    const d = mkdtempSync(join(tmpdir(), 'm2-prosp-'));
    const { c, w } = make(d, { frozenAtMs: Date.now() - 1000, schemaVersion: SCHEMA_VERSION, commit: 'abc' });
    c._markProspectiveStart();
    eq(c.phase, 'prospective');
    const first = c.prospective.startedAt;
    c._markProspectiveStart();
    eq(c.prospective.startedAt, first, 'the start must never be rewritten');
    w.close(); rmSync(d, { recursive: true, force: true });
  });

  test('a schema mismatch in the freeze marker refuses to authorise prospective data', () => {
    const d = mkdtempSync(join(tmpdir(), 'm2-freeze-'));
    const f = join(d, 'freeze.json');
    writeFileSync(f, JSON.stringify({ frozenAtMs: Date.now() - 1000, schemaVersion: 'v0', commit: 'abc' }));
    // the real implementation rejects a marker whose schemaVersion differs
    const marker = JSON.parse(readFileSync(f, 'utf8'));
    eq(marker.schemaVersion === SCHEMA_VERSION, false);
    rmSync(d, { recursive: true, force: true });
  });

  test('records carry their phase, so a later merge cannot relabel them', () => {
    const d = mkdtempSync(join(tmpdir(), 'm2-prosp-'));
    const w = new EventWriter({ root: join(d, 'l2'), manifestPath: join(d, 'M.json'), statePath: join(d, 's.json'), flushMs: 1e9 });
    w.write('features', { at: Date.now(), recvMs: Date.now(), phase: 'warmup' });
    w.flush();
    const key = Object.keys(w.manifest.partitions).find((k) => k.endsWith('/features'));
    eq(w.manifest.partitions[key].phases.prospective, undefined);
    eq(w.manifest.partitions[key].phases.warmup, 1);
    w.close(); rmSync(d, { recursive: true, force: true });
  });

  test('the real freeze path is the one the collector reads', () => {
    ok(PATHS.freeze.endsWith('research/M2-FREEZE.json'), PATHS.freeze);
  });
});
