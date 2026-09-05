// PROSPECTIVE EVENT LOG
//
// The 2020-09 → 2026-09 window has been examined repeatedly. Nothing measured on
// it can be called out-of-sample any more. This script records events from the
// v2 FREEZE FORWARD, so that a genuine prospective sample accumulates.
//
// It writes one row per event with the full feature vector at the moment it
// fired, plus forward outcomes once enough bars exist to fill them in. Rows are
// keyed by (timestamp, event) and merged on re-run, so re-running after new data
// arrives fills in outcomes without disturbing what was already recorded.
//
// IMPORTANT: outcomes are recorded so that a future hypothesis can be tested
// against them. They are NOT evidence today, and looking at them before
// pre-registering a hypothesis would burn the sample exactly the way the
// historical window was burned. Record now, decide later.
//
// Usage: node event-log.mjs [--freeze 2026-09-06]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const { hash, bars } = JSON.parse(readFileSync(new URL('./states.json', import.meta.url), 'utf8'));
const LOG = new URL('./event-log.json', import.meta.url);

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FREEZE = Date.parse(arg('--freeze', '2026-09-06') + 'T00:00:00Z');

const H = { h24: 6, h48: 12, d7: 42 };
const n = bars.length;

// Regime transitions and impulse spikes are logged separately, because they are
// different kinds of event and a future test must not pool them.
const REGIME = { trSt: 'TREND', oi24St: 'OI_24H', fdSt: 'FUNDING', etSt: 'ETF', spSt: 'SOPR' };
const IMPULSE = { oi4Imp: 'OI_4H', pmImp: 'PREMIUM', ptImp: 'PARTICIPATION', rsImp: 'SPOT_RVOL', rpImp: 'PERP_RVOL' };

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
    };
  }

  for (const f of fired) {
    events.push({
      key: `${b.t}|${f.kind}|${f.measure}`,
      timestamp: new Date(b.t).toISOString(),
      indicatorHash: hash,
      ...f,
      price: b.close,
      features: {
        trendDist: b.trendDist, volPct: b.volPct,
        oiZ4: b.oiZ4, oiZ24: b.oiZ24, oiZ24s: b.oiZ24s,
        premZ: b.premZ, partZ: b.partZ,
        rvolSpotZ: b.rvolSpotZ, rvolPerpZ: b.rvolPerpZ,
        anomCount: b.anomCount, aligned: b.aligned, alignAvail: b.alignAvail,
      },
      outcomes: fwd,
    });
  }
}

// Merge: keep everything previously recorded, refresh outcomes that were null.
const prior = existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : { freeze: null, events: [] };
const byKey = new Map(prior.events.map((e) => [e.key, e]));
let added = 0, filled = 0;
for (const e of events) {
  const old = byKey.get(e.key);
  if (!old) { byKey.set(e.key, e); added++; continue; }
  for (const h of Object.keys(H)) {
    if (old.outcomes[h] === null && e.outcomes[h] !== null) { old.outcomes[h] = e.outcomes[h]; filled++; }
  }
}
const merged = [...byKey.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
writeFileSync(LOG, JSON.stringify({ freeze: new Date(FREEZE).toISOString(), indicatorHash: hash, events: merged }, null, 2));

const dataEnd = new Date(bars.at(-1).t).toISOString().slice(0, 10);
console.log('='.repeat(90));
console.log('PROSPECTIVE EVENT LOG');
console.log(`freeze ${new Date(FREEZE).toISOString().slice(0, 10)}   indicator ${hash.slice(0, 12)}   data ends ${dataEnd}`);
console.log('='.repeat(90));
console.log(`  events in log      ${merged.length}   (+${added} new, ${filled} outcome slots filled)`);
const pending = merged.filter((e) => Object.values(e.outcomes).some((o) => o === null)).length;
console.log(`  awaiting outcomes  ${pending}`);
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
