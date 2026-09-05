// PROSPECTIVE COHORT IDENTITY
//
// The one thing a prospective log must never do is let a new algorithm's events
// sit in the same file as an old one's. If v3 re-scans the bars after the v2
// freeze with v3 definitions and those rows merge into the v2 log, the result
// LOOKS like accumulated out-of-sample evidence and is nothing of the kind — it
// is a fresh in-sample fit wearing the old cohort's timestamp.
//
// So a cohort is identified by everything that could change what an event MEANS:
//
//   schema          the record layout. Old rows lack fields new analysis needs.
//   freeze          the instant before which nothing counts as prospective.
//   indicatorHash   sha256 of main.pine. Any logic change at all.
//   configHash      sha256 of every input default actually in force.
//   thresholds      an explicitly bumped version string, for changes that are
//                   deliberate and semantic rather than incidental.
//
// Change any one of them and you have a different experiment. event-log.mjs
// refuses to write, and --new-cohort starts a separate file.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const SCHEMA_VERSION = 3;

const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Canonical, order-independent identity for a cohort descriptor. */
export function cohortId({ schema, freeze, indicatorHash, configHash, thresholds }) {
  return sha([
    `schema=${schema}`,
    `freeze=${freeze}`,
    `indicator=${indicatorHash}`,
    `config=${configHash}`,
    `thresholds=${thresholds}`,
  ].join('\n'));
}

export function cohortMatches(a, b) {
  if (!a || !b) return false;
  return cohortId(a) === cohortId(b);
}

/**
 * Every input default in main.pine, in source order, hashed. Bumping a
 * hysteresis threshold or a lookback window changes this even though the
 * numbers live inside the same file whose hash also changes — the two are kept
 * separate so a cohort mismatch report can say WHICH one moved.
 */
export function configFingerprint(pineSource) {
  const defaults = [...pineSource.matchAll(/input\.(bool|int|float|string|symbol|source|timeframe)\(([^,)]+)(?:,\s*"([^"]*)")?/g)]
    .map((m) => `${m[3] ?? '?'}=${m[2].trim()}`);
  return { hash: sha(defaults.join('|')), count: defaults.length };
}

/** The deliberately-bumped marker, read from main.pine rather than duplicated. */
export function thresholdVersion(pineSource) {
  const m = pineSource.match(/THRESHOLD-VERSION:\s*(\S+)/);
  if (!m) throw new Error('main.pine has no "// THRESHOLD-VERSION:" marker — cohort identity would be incomplete');
  return m[1];
}

/** Build the descriptor for the indicator as it stands on disk right now. */
export function describeCohort(pinePath, freeze) {
  const src = readFileSync(pinePath, 'utf8');
  const cfg = configFingerprint(src);
  return {
    schema: SCHEMA_VERSION,
    freeze,
    indicatorHash: sha(src),
    configHash: cfg.hash,
    thresholds: thresholdVersion(src),
    _inputCount: cfg.count,
  };
}

/**
 * Where does this run's events belong? Pure function so the three branches can
 * be tested without touching the disk.
 *
 *   append  the existing log was written by this exact cohort
 *   create  no log yet, or --new-cohort was passed: a SEPARATE file
 *   refuse  a log exists under a different cohort and --new-cohort was not
 *           passed. This is the branch that matters — without it, v3 rows would
 *           land in the v2 file and look like accumulated prospective evidence.
 */
export function resolveLogTarget({ existing, current, newCohort, defaultPath }) {
  const id = cohortId(current);
  const altPath = `event-log-v${current.schema}-${id.slice(0, 12)}.json`;
  if (!existing) return { action: 'create', path: defaultPath, id, reason: 'no log yet' };
  if (cohortMatches(existing.cohort, current)) return { action: 'append', path: defaultPath, id, reason: 'same cohort' };
  if (newCohort) return { action: 'create', path: altPath, id, reason: 'new cohort requested' };
  return {
    action: 'refuse', path: defaultPath, id,
    reason: `cohort mismatch: ${cohortDiff(existing.cohort, current).join('; ') || 'existing log has no cohort stamp (pre-v3 format)'}`,
    hint: `pass --new-cohort to start ${altPath}`,
  };
}

/** Human-readable diff, so a refusal explains itself instead of just exiting. */
export function cohortDiff(a, b) {
  const keys = ['schema', 'freeze', 'indicatorHash', 'configHash', 'thresholds'];
  return keys.filter((k) => String(a?.[k]) !== String(b?.[k]))
    .map((k) => `${k}: logged ${String(a?.[k]).slice(0, 16)} vs current ${String(b?.[k]).slice(0, 16)}`);
}
