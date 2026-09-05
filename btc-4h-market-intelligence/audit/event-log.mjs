// PROSPECTIVE EVENT LOG
//
// The 2020-09 -> 2026-09 window has been examined repeatedly. Nothing measured
// on it can be called out-of-sample any more. This script records events from
// the FREEZE FORWARD, so that a genuine prospective sample accumulates.
//
// COHORT INTEGRITY is the whole point of the guard below. If a new version of
// the indicator re-scans the bars after an old freeze with new definitions, and
// those rows merge into the old file, the result LOOKS like accumulated
// out-of-sample evidence and is nothing of the kind — it is a fresh in-sample
// fit wearing the old cohort's timestamp. So a log is stamped with the full
// cohort identity (schema, freeze, indicator hash, config hash, threshold
// version) and this script REFUSES to write into a log that does not match.
// --new-cohort starts a separate file instead of contaminating the old one.
//
// Each row carries the complete raw fact set at the moment the event fired —
// raw values, percentiles, z-scores, freshness and the state codes — so a future
// hypothesis can be tested against facts rather than against a summary somebody
// chose in advance. Forward outcomes are filled in as bars arrive.
//
// IMPORTANT: outcomes are RECORDED so that a future hypothesis can be tested
// against them. They are NOT evidence today, and looking at them before
// pre-registering a hypothesis would burn the sample exactly the way the
// historical window was burned. Record now, decide later.
//
// Usage: node event-log.mjs [--freeze 2026-09-06] [--new-cohort]

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { describeCohort, resolveLogTarget, cohortId } from './cohort.mjs';

const DIR = new URL('./', import.meta.url);
const { hash, bars } = JSON.parse(readFileSync(new URL('./states.json', DIR), 'utf8'));

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FREEZE_STR = arg('--freeze', '2026-09-06');
const FREEZE = Date.parse(FREEZE_STR + 'T00:00:00Z');
const NEW_COHORT = process.argv.includes('--new-cohort');

const current = describeCohort(new URL('../main.pine', DIR), FREEZE_STR);
if (current.indicatorHash !== hash) {
  console.error('states.json was extracted from a different main.pine than the one on disk.');
  console.error(`  states.json  ${hash.slice(0, 16)}`);
  console.error(`  main.pine    ${current.indicatorHash.slice(0, 16)}`);
  console.error('Re-run: node extract-states.mjs');
  process.exit(1);
}

// ---------------------------------------------------------- cohort routing --
const DEFAULT = 'event-log.json';
const existingPath = new URL('./' + DEFAULT, DIR);
const existing = existsSync(existingPath) ? JSON.parse(readFileSync(existingPath, 'utf8')) : null;
const target = resolveLogTarget({ existing, current, newCohort: NEW_COHORT, defaultPath: DEFAULT });

console.log('='.repeat(96));
console.log('PROSPECTIVE EVENT LOG');
console.log(`freeze ${FREEZE_STR}   cohort ${target.id.slice(0, 12)}   indicator ${hash.slice(0, 12)}   schema ${current.schema}`);
console.log('='.repeat(96));

if (target.action === 'refuse') {
  console.error(`\n❌ REFUSING TO WRITE — ${target.reason}`);
  console.error(`\n   ${DEFAULT} was written by a different experiment. Merging this run into it`);
  console.error('   would turn a fresh in-sample scan into something that reads as accumulated');
  console.error('   prospective evidence. That is the one failure this log exists to prevent.\n');
  console.error(`   ${target.hint}`);
  console.error(`   The existing file is left untouched. Prior cohorts in this directory:`);
  for (const f of readdirSync(new URL('./', DIR)).filter((f) => f.startsWith('event-log') && f.endsWith('.json'))) console.error(`     ${f}`);
  process.exit(1);
}
console.log(`${target.action === 'append' ? 'appending to' : 'creating'} ${target.path}   (${target.reason})`);

// --------------------------------------------------------------- events -----
const H = { h24: 6, h48: 12, d7: 42 };
const n = bars.length;

// Regime transitions and impulse spikes are logged separately: they are
// different kinds of event and a future test must not pool them.
const REGIME = { trSt: 'TREND', oi24St: 'OI_24H', fdSt: 'FUNDING', etSt: 'ETF', spSt: 'SOPR' };
const IMPULSE = { oi4Lvl: 'OI_4H', pmLvl: 'PREMIUM', ptLvl: 'PARTICIPATION', rsLvl: 'SPOT_RVOL', rpLvl: 'PERP_RVOL', lqLLvl: 'LONG_LIQ', lqSLvl: 'SHORT_LIQ' };

// Everything the indicator knew at that instant. Recorded in full because a
// summary chosen today is a hypothesis chosen today.
const FACTS = ['close', 'px24', 'oiRaw', 'oiChg4', 'oiChg24', 'fundRaw', 'premium', 'liqBal',
  'rvolSpot', 'rvolPerp', 'partRaw', 'etf5d', 'sopr', 'soprDev', 'trendDist', 'atr14', 'volPct', 'mom12w'];
const NORM = ['oiP4', 'oiP24', 'premP', 'partP', 'rvolSpotP', 'rvolPerpP', 'fundP', 'etfP', 'liqLP', 'liqSP',
  'oiZ4', 'oiZ24', 'oiZ24s', 'premZ', 'partZ', 'rvolSpotZ', 'rvolPerpZ', 'fundZ', 'etfZ', 'liqLZ', 'liqSZ', 'liqBZ'];
const HEALTH = ['refStat', 'spotStat', 'oiStat', 'dailyStat', 'soprStat', 'fdStat', 'etStat', 'lLStat', 'lSStat'];
const STATE = ['trSt', 'oi24Lvl', 'oi24Dir', 'oi4Lvl', 'oi4Dir', 'pmLvl', 'pmDir', 'ptLvl', 'ptDir',
  'rsLvl', 'rpLvl', 'fdLvl', 'fdDir', 'etLvl', 'etDir', 'spSt', 'lqLLvl', 'lqSLvl', 'lqBDir',
  'mechPx', 'mechOi', 'anomCount', 'maxExt'];
const pick = (b, keys) => Object.fromEntries(keys.map((k) => [k, Number.isFinite(b[k]) ? b[k] : null]));

const events = [];
for (let i = 1; i < n; i++) {
  const b = bars[i], p = bars[i - 1];
  if (b.t < FREEZE) continue;

  const fired = [];
  for (const [k, name] of Object.entries(REGIME)) {
    const cur = Number.isFinite(b[k]) ? b[k] : 0, prev = Number.isFinite(p[k]) ? p[k] : 0;
    if (cur !== prev) fired.push({ kind: 'REGIME_TRANSITION', measure: name, from: prev, to: cur });
  }
  for (const [k, name] of Object.entries(IMPULSE)) {
    const cur = Number.isFinite(b[k]) ? b[k] : 0, prev = Number.isFinite(p[k]) ? p[k] : 0;
    if (cur !== 0 && prev === 0) fired.push({ kind: 'IMPULSE_SPIKE', measure: name, from: 0, to: cur });
  }
  if (!fired.length) continue;

  // Forward outcomes, left null until the bars exist. A null is not a zero.
  const fwd = {};
  for (const [label, h] of Object.entries(H)) {
    if (i + h >= n) { fwd[label] = null; continue; }
    let lo = Infinity, hi = -Infinity;
    for (let j = i + 1; j <= i + h; j++) { lo = Math.min(lo, bars[j].low); hi = Math.max(hi, bars[j].high); }
    fwd[label] = {
      ret: b.close ? bars[i + h].close / b.close - 1 : null,
      mae: b.close ? lo / b.close - 1 : null,
      mfe: b.close ? hi / b.close - 1 : null,
      atr: Number.isFinite(b.atr14) ? b.atr14 : null,
    };
  }

  for (const f of fired) {
    events.push({
      key: `${b.t}|${f.kind}|${f.measure}`,
      timestamp: new Date(b.t).toISOString(),
      cohort: target.id,
      ...f,
      raw: pick(b, FACTS),
      normalized: pick(b, NORM),
      freshness: pick(b, HEALTH),
      state: pick(b, STATE),
      outcomes: fwd,
    });
  }
}

// Merge: keep everything previously recorded, refresh outcomes that were null.
// Only ever within the SAME cohort — the guard above already ensured that.
const prior = target.action === 'append' ? existing : { events: [] };
const byKey = new Map((prior.events ?? []).map((e) => [e.key, e]));
let added = 0, filled = 0;
for (const e of events) {
  const old = byKey.get(e.key);
  if (!old) { byKey.set(e.key, e); added++; continue; }
  for (const h of Object.keys(H)) {
    if (old.outcomes[h] === null && e.outcomes[h] !== null) { old.outcomes[h] = e.outcomes[h]; filled++; }
  }
}
const merged = [...byKey.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

writeFileSync(new URL('./' + target.path, DIR), JSON.stringify({
  cohort: current,
  cohortId: target.id,
  schema: current.schema,
  freeze: new Date(FREEZE).toISOString(),
  factFields: { raw: FACTS, normalized: NORM, freshness: HEALTH, state: STATE },
  events: merged,
}, null, 2));

const dataEnd = new Date(bars.at(-1).t).toISOString().slice(0, 10);
console.log(`\n  data ends          ${dataEnd}`);
console.log(`  events in log      ${merged.length}   (+${added} new, ${filled} outcome slots filled)`);
const pending = merged.filter((e) => Object.values(e.outcomes).some((o) => o === null)).length;
console.log(`  awaiting outcomes  ${pending}`);
console.log(`  facts per event    ${FACTS.length} raw · ${NORM.length} normalized · ${HEALTH.length} freshness · ${STATE.length} state`);

if (!merged.length) {
  console.log(`\n  Empty, and correctly so: the dataset ends ${dataEnd}, before the freeze.`);
  console.log('  Re-run after new 4H bars arrive. Every row from here on is genuinely');
  console.log('  prospective — the only kind of evidence this project has left to gather.');
} else {
  const byKind = {};
  for (const e of merged) byKind[`${e.kind} ${e.measure}`] = (byKind[`${e.kind} ${e.measure}`] ?? 0) + 1;
  for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(34)} ${v}`);
}
console.log('\n  Do NOT analyse these outcomes before pre-registering a hypothesis against');
console.log('  them. Reading first is how the historical window stopped being usable.');
console.log(`\n  cohort id ${cohortId(current)}`);
