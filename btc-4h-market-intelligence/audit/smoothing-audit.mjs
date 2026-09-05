// SMOOTHING / STABILITY AUDIT
//
// The hysteresis verification established that the Schmitt trigger is correct —
// it loses no crossing and adds no delay — but that four measures still flicker,
// because the enter-exit gap absorbs only 34-62% of ordinary bar-to-bar movement
// in the z-score. The noise is in the INPUT, not the trigger.
//
// This audit asks a data-product question only: which smoothing, if any, makes
// each measure readable without throwing away the events worth reading?
//
// ============================================================================
// PRE-REGISTERED — candidates and metrics fixed before the first run.
//
// CANDIDATES (exactly these four, no search):
//     none, EMA(2), EMA(3), EMA(4)
//
// SCOPE: OI 4H, OI 24H, PREMIUM, PARTICIPATION.
// TREND is excluded — after hysteresis it already runs a median of 9 bars and
// transitions roughly once every 78 bars. Smoothing it would buy latency for
// nothing.
//
// PERMITTED METRICS. Signal-processing and readability only:
//     median state duration, transition count, false-flip rate,
//     anomaly retention, detection delay, peak attenuation
// Sharpe, forward return and any market outcome are OUT OF SCOPE. Choosing a
// filter by what it would have earned is how a display parameter becomes an
// unregistered trading hypothesis.
//
// DEFINITIONS
//   false flip      an engaged episode lasting a single bar
//   detection delay bars between the RAW z crossing its enter threshold and the
//                   smoothed state actually engaging; measured per event, then
//                   median / P90 / max
//   retention       fraction of raw events at |z| >= 1.5 / 2.0 / 2.5 for which
//                   the smoothed state engaged at all
//   peak attenuation  median of max|smoothed z| / max|raw z| within each event.
//                   1.00 keeps the peak; 0.70 means three-tenths of the extreme
//                   was filtered away
//
// The JavaScript Schmitt used here was already proven identical to the compiled
// Pine on all 13,164 bars by hysteresis-verify.mjs, so simulating variants in
// JavaScript describes the real indicator.
// ============================================================================

import { readFileSync } from 'node:fs';

const { hash, bars } = JSON.parse(readFileSync(new URL('./states.json', import.meta.url), 'utf8'));
const n = bars.length;

const M = {
  'OI 4H':    { z: 'oiZ4',   levels: 2, e1: 1.0, x1: 0.6, e2: 2.0, x2: 1.25 },
  'OI 24H':   { z: 'oiZ24',  levels: 2, e1: 1.0, x1: 0.6, e2: 2.0, x2: 1.25 },
  'PREMIUM':  { z: 'premZ',  levels: 1, e1: 2.0, x1: 1.25 },
  'PARTICIP': { z: 'partZ',  levels: 1, e1: 1.0, x1: 0.6 },
};
const CANDIDATES = [0, 2, 3, 4];          // 0 = no smoothing
const TIERS = [1.5, 2.0, 2.5];

const ema = (v, p) => {
  if (p <= 1) return v.slice();
  const k = 2 / (p + 1);
  let e = NaN;
  return v.map((x) => {
    if (!Number.isFinite(x)) return NaN;
    e = Number.isFinite(e) ? x * k + e * (1 - k) : x;
    return e;
  });
};

function schmitt(zs, cfg) {
  const out = new Array(zs.length).fill(0);
  let lvl = 0, sgn = 0;
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    if (Number.isFinite(z)) {
      const a = Math.abs(z), s = z >= 0 ? 1 : -1;
      if (lvl === 0) {
        if (a >= cfg.e1) { lvl = cfg.levels === 2 && a >= cfg.e2 ? 2 : 1; sgn = s; }
      } else if (s !== sgn) { lvl = 0; sgn = 0; }
      else if (a < cfg.x1) { lvl = 0; sgn = 0; }
      else if (cfg.levels === 2 && lvl === 2 && a < cfg.x2) lvl = 1;
      else if (cfg.levels === 2 && lvl === 1 && a >= cfg.e2) lvl = 2;
    }
    out[i] = lvl * sgn;
  }
  return out;
}

const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quant = (a, q) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

const transitions = (st) => { let c = 0; for (let i = 1; i < n; i++) if (st[i] !== st[i - 1]) c++; return c; };

// Two durations, because they answer different questions and the earlier
// scripts disagreed on which one "median state duration" meant.
//   engaged  a run of any non-zero state — how long the measure stays flagged
//   label    a run of the SAME state value — how long the printed text holds
// The dashboard shows the label, so the label duration is the binding one:
// EXPANDING alternating with EXTREME EXPANSION every bar is still flicker.
function episodes(st) {
  const eps = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    const on = st[i] !== 0;
    if (on && start < 0) start = i;
    else if (!on && start >= 0) { eps.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) eps.push([start, n - 1]);
  return eps;
}

function labelRuns(st) {
  const lens = [];
  let cur = st[0], len = 1;
  for (let i = 1; i < n; i++) {
    if (st[i] === cur) len++;
    else { if (cur !== 0) lens.push(len); cur = st[i]; len = 1; }
  }
  if (cur !== 0) lens.push(len);
  return lens;
}

// Raw events at a given magnitude, from the UNSMOOTHED z. These are what a
// reader would call a real crossing, and every variant is judged against them.
function rawEvents(zs, thr) {
  const ev = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    const on = Number.isFinite(zs[i]) && Math.abs(zs[i]) >= thr;
    if (on && start < 0) start = i;
    else if (!on && start >= 0) { ev.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) ev.push([start, n - 1]);
  return ev;
}

// Allow the state to engage anywhere inside the event or within a short grace
// window after it, so a slow filter is credited with a late detection rather
// than scored as a miss — the delay column is where that cost shows up.
const GRACE = 6;
function retentionDelay(ev, st) {
  let kept = 0;
  const delays = [];
  for (const [a, b] of ev) {
    let first = -1;
    for (let i = a; i <= Math.min(n - 1, b + GRACE); i++) if (st[i] !== 0) { first = i; break; }
    if (first >= 0) { kept++; delays.push(first - a); }
  }
  return { events: ev.length, retention: ev.length ? kept / ev.length : NaN, delays };
}

function attenuation(ev, rawZ, smZ) {
  const r = [];
  for (const [a, b] of ev) {
    let mr = 0, ms = 0;
    for (let i = a; i <= b; i++) {
      if (Number.isFinite(rawZ[i])) mr = Math.max(mr, Math.abs(rawZ[i]));
      if (Number.isFinite(smZ[i])) ms = Math.max(ms, Math.abs(smZ[i]));
    }
    if (mr > 0) r.push(ms / mr);
  }
  return median(r);
}

console.log('='.repeat(118));
console.log('SMOOTHING / STABILITY AUDIT — data-product quality only, no market outcome used');
console.log(`frozen hash ${hash}`);
console.log(`${n} bars  ${new Date(bars[0].t).toISOString().slice(0, 10)} -> ${new Date(bars.at(-1).t).toISOString().slice(0, 10)}`);
console.log('candidates: none, EMA(2), EMA(3), EMA(4)   |   TREND excluded: already readable at median 9 bars');
console.log('='.repeat(118));

const results = {};
for (const [name, cfg] of Object.entries(M)) {
  const rawZ = bars.map((b) => b[cfg.z]);
  const evEnter = rawEvents(rawZ, cfg.e1);      // events at this measure's own entry level
  console.log(`\n${'-'.repeat(118)}\n${name}   raw z, enter ${cfg.e1}σ / exit ${cfg.x1}σ   —   ${evEnter.length} raw crossings of the entry level\n${'-'.repeat(118)}`);
  console.log('  smoothing   label dur  engaged dur   transitions   false flips   det delay med/P90/max   retention 1.5σ/2.0σ/2.5σ   peak attn');
  results[name] = [];
  for (const p of CANDIDATES) {
    const smZ = ema(rawZ, p);
    const st = schmitt(smZ, cfg);
    const eps = episodes(st);
    const engagedLens = eps.map(([a, b]) => b - a + 1);
    const lens = labelRuns(st);
    const falseFlips = lens.filter((l) => l <= 1).length;
    const rd = retentionDelay(evEnter, st);
    const tiers = TIERS.map((t) => retentionDelay(rawEvents(rawZ, t), st).retention);
    const attn = attenuation(evEnter, rawZ, smZ);
    const row = {
      p, enter: cfg.e1, medDur: median(lens), medEngaged: median(engagedLens), trans: transitions(st), flips: lens.length ? falseFlips / lens.length : NaN,
      dMed: median(rd.delays), dP90: quant(rd.delays, 0.9), dMax: rd.delays.length ? Math.max(...rd.delays) : NaN,
      ret: rd.retention, tiers, attn, episodes: eps.length,
    };
    results[name].push(row);
    const lbl = p === 0 ? 'none' : `EMA(${p})`;
    console.log(`  ${lbl.padEnd(11)}${String(row.medDur).padStart(10)}${String(row.medEngaged).padStart(13)}${String(row.trans).padStart(14)}${(row.flips * 100).toFixed(0).padStart(13)}%${`${row.dMed}/${row.dP90}/${row.dMax}`.padStart(22)}${tiers.map((x) => (x * 100).toFixed(0) + '%').join(' / ').padStart(27)}${row.attn.toFixed(2).padStart(12)}`);
  }
}

// ---------------------------------------------------------------- verdict ---
// Gates come from the brief, not from taste. Where the brief named a number it
// is used; where it did not, the metric is reported and does NOT gate.
//   duration   "median duration <= 2 bars -> do not rescue it"      => >= 3
//   delay      "median 0-1 acceptable, often 2-3 is not"            => med <= 1, P90 <= 2
//   retention  "should still keep most genuinely extreme events",
//              checked at |z| >= 1.5 / 2.0 / 2.5                    => all >= 90%
// false-flip rate and peak attenuation are reported only. Inventing thresholds
// for them would be choosing the answer.
const gates = (r) => ({
  duration: r.medDur >= 3,
  delay: r.dMed <= 1 && r.dP90 <= 2,
  // Only tiers at or above the measure's own entry threshold count. PREMIUM
  // enters at 2.0σ, so it cannot by construction engage on a 1.5σ event —
  // scoring it against that tier was measuring the threshold, not the filter.
  retention: TIERS.map((t, i) => [t, r.tiers[i]]).filter(([t]) => t >= r.enter).every(([, x]) => x >= 0.90),
});
const REGIME_OK = (r) => Object.values(gates(r)).every(Boolean);

console.log(`
${'='.repeat(118)}`);
console.log('VERDICT — gates taken from the brief: label duration >= 3 bars, median delay <= 1 and P90 <= 2,');
console.log('          retention >= 90% at every tier at or above the measure own entry threshold.');
console.log('          False-flip rate and peak attenuation are reported, not gated.');
console.log('='.repeat(118));

const decisions = {};
for (const [name, rows] of Object.entries(results)) {
  // Pareto pick: among qualifying candidates take the LEAST smoothing, since
  // every extra tap costs latency and peak.
  const ok = rows.filter(REGIME_OK);
  const pick = ok.length ? ok[0] : null;
  decisions[name] = pick ? { type: 'REGIME', p: pick.p, row: pick } : { type: 'IMPULSE', row: rows[0] };
  console.log(`
  ${name}`);
  for (const row of rows) {
    const g = gates(row);
    const why = [];
    if (!g.duration) why.push(`label dur ${row.medDur}`);
    if (!g.delay) why.push(`delay med ${row.dMed} P90 ${row.dP90}`);
    if (!g.retention) why.push(`retention ${TIERS.map((t, i) => (t >= row.enter ? (row.tiers[i] * 100).toFixed(0) + '%' : '-')).join('/')}`);
    console.log(`    ${(row.p === 0 ? 'none' : `EMA(${row.p})`).padEnd(8)} ${REGIME_OK(row) ? 'QUALIFIES' : 'fails: ' + why.join(', ')}   [flips ${(row.flips * 100).toFixed(0)}%, attn ${row.attn.toFixed(2)}]`);
  }
  const d = decisions[name];
  console.log(`    => ${d.type}${d.type === 'REGIME' ? ` with ${d.p === 0 ? 'no smoothing' : `EMA(${d.p})`}` : ' — no candidate cleared the gates'}`);
}

console.log(`
${'='.repeat(118)}
PRODUCT SHAPE
${'='.repeat(118)}`);
console.log('  REGIME   persistent state, appears in WHAT CHANGED as a regime transition');
console.log('  IMPULSE  raw and smoothed z shown, one-shot spike alert, NO persistent state,');
console.log('           NOT a regime transition in WHAT CHANGED');
console.log('  CONTEXT  slow external feeds, shown when available\n');
console.log('  TREND          REGIME   no smoothing — median 9 bars after hysteresis already');
for (const [name, d] of Object.entries(decisions))
  console.log(`  ${name.padEnd(14)} ${d.type.padEnd(8)} ${d.type === 'REGIME' ? (d.p === 0 ? 'no smoothing' : `EMA(${d.p})`) : 'raw + smoothed z displayed, spike alert only'}`);
console.log('  ETF / SOPR / FUNDING   CONTEXT  external adapters, unavailable offline');
console.log('\n  Raw z stays on the dashboard for every measure regardless of type.');
