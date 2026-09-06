// Stamps the M2 freeze marker from git. Run once, immediately after the
// pre-registration commit; the marker records THAT commit, so the prospective boundary
// is anchored to a reviewable object rather than to a promise.
// Usage: node collector/freeze.mjs   (or `npm run freeze`)
import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { PATHS, SCHEMA_VERSION, COLLECTOR_VERSION, SYMBOL } from './config.mjs';

if (existsSync(PATHS.freeze)) {
  const f = JSON.parse(readFileSync(PATHS.freeze, 'utf8'));
  console.log(`already frozen at ${f.frozenAt} (${f.commit}); refusing to rewrite`);
  process.exit(0);
}
const git = (c) => execSync(c, { encoding: 'utf8' }).trim();
const commit = git('git rev-parse HEAD');
const frozenAtMs = Number(git('git show -s --format=%ct HEAD')) * 1000;
const marker = {
  study: 'M2', symbol: SYMBOL, schemaVersion: SCHEMA_VERSION, collectorVersion: COLLECTOR_VERSION,
  commit, frozenAt: new Date(frozenAtMs).toISOString(), frozenAtMs,
  subject: git('git show -s --format=%s HEAD'),
  note: 'Prospective data begins at the first valid order book observed after frozenAtMs. Anything earlier is WARMUP / ENGINEERING DATA and is labelled as such in every record.',
};
writeFileSync(PATHS.freeze, JSON.stringify(marker, null, 2));
console.log(`M2 frozen at ${marker.frozenAt}\ncommit ${commit}\nschema ${SCHEMA_VERSION}`);
