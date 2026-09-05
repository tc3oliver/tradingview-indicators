// OI 4H DE-SEASONALIZATION AUDIT
//
// OI 4H is an IMPULSE because no amount of smoothing made its label readable
// without destroying the extremes it exists to report (smoothing-audit.mjs:
// EMA(3) cut 1.5σ retention to 72% and the peak to 0.51). This audit asks a
// different question — not "smooth it more" but "normalise it better".
//
// Open interest on a 24/7 venue has a time-of-day shape: Asian-hours bars and
// US-hours bars are not the same population. A rolling 180-bar z-score pools
// them, so a perfectly ordinary 04-08 UTC move can score as unusual simply
// because the window is dominated by busier slots. The candidate fixes that by
// comparing each bar only with the SAME UTC slot on previous days.
//
// ============================================================================
// PRE-REGISTERED. Written before the first run; nothing below was chosen after
// seeing a result.
//
// VARIANTS, exactly these three, no search:
//   A   rolling z over 180 bars                       (what ships today)
//   B30 same-UTC-slot z over the previous 30 days
//   B60 same-UTC-slot z over the previous 60 days
//
// PERMITTED METRICS — signal quality only:
//   false spike count, extreme retention, detection delay,
//   impulse frequency, peak magnitude at known extremes, stability
// FORBIDDEN: forward return, MAE, MFE, Sharpe, profit, or any market outcome.
// Choosing a normaliser by what it would have earned turns a display decision
// into an unregistered trading hypothesis, which is the mistake this whole
// project exists to avoid.
//
// GROUND TRUTH is method-independent on purpose. "A real extreme" is defined by
// the RAW percentage change |oiChg4h| landing in the top 1% / 0.5% / 0.1% of all
// bars. Defining it by variant A's own z-score would hand A the win by
// construction.
//
// DEFINITIONS
//   fired          |z| >= 1.0, the indicator's own OI entry threshold
//   false spike    a fired bar whose |oiChg4h| is BELOW the median |oiChg4h| of
//                  the whole sample — the normaliser manufactured an "unusual"
//                  reading out of a smaller-than-typical raw move
//   retention      fraction of raw-extreme EVENTS (contiguous runs of top-q
//                  bars) that the variant fires on at all
//   delay          bars from the start of a raw-extreme event to the first fire
//   frequency      fraction of all bars fired
//   peak           median |z| on top-0.1% bars — is the extreme still loud
//   stability      fraction of bars where fired-ness changes from the bar before
//
// ADOPTION RULE, fixed in advance. Adopt a B variant only if ALL hold:
//   1. false-spike RATE at least 20% lower, relative, than A
//   2. retention no more than 2 percentage points below A at EVERY tier
//   3. median detection delay equal to A's (which is 0)
//   4. impulse frequency within +-25% of A — a variant that fires less by being
//      blind is not an improvement
// Otherwise OI 4H keeps variant A and stays an IMPULSE. A negative result here
// is a valid, publishable outcome.
// ============================================================================

import { readFileSync } from 'node:fs';

const { hash, bars } = JSON.parse(readFileSync(new URL('./states.json', import.meta.url), 'utf8'));
const n = bars.length;

const ENTER = 1.0;
const TIERS = [0.01, 0.005, 0.001];
const SLOTS = 6;                       // 4H bars per UTC day
const raw = bars.map((b) => b.oiChg4);
const slotOf = (t) => Math.floor((t % 86400000) / 14400000);

// ---------------------------------------------------------------- variants --
// A is read straight out of the compiled indicator, not recomputed, so the
// baseline is literally what ships.
const zA = bars.map((b) => b.oiZ4);

// B: for each bar, mean and sd of the SAME slot over the previous `days` days.
// Strictly previous — the current bar is never in its own window.
function slotZ(days) {
  const out = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(raw[i])) continue;
    const vals = [];
    for (let k = 1; k <= days; k++) {
      const j = i - k * SLOTS;
      if (j < 0) break;
      if (Number.isFinite(raw[j])) vals.push(raw[j]);
    }
    if (vals.length < Math.max(10, days / 3)) continue;
    const m = vals.reduce((s, x) => s + x, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((s, x) => s + (x - m) ** 2, 0) / vals.length);
    if (sd > 0) out[i] = (raw[i] - m) / sd;
  }
  return out;
}

// ------------------------------------------------- is there a slot effect? --
// If open-interest change has no time-of-day structure, de-seasonalising it
// cannot help and the rest of this audit is a formality. Measured first.
const bySlot = Array.from({ length: SLOTS }, () => []);
for (let i = 0; i < n; i++) if (Number.isFinite(raw[i])) bySlot[slotOf(bars[i].t)].push(raw[i]);
const slotStats = bySlot.map((v) => {
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
  const absm = v.reduce((s, x) => s + Math.abs(x), 0) / v.length;
  return { n: v.length, mean: m, sd, absMean: absm };
});
const grandAbs = slotStats.reduce((s, x) => s + x.absMean * x.n, 0) / slotStats.reduce((s, x) => s + x.n, 0);
const sdSpread = Math.max(...slotStats.map((s) => s.sd)) / Math.min(...slotStats.map((s) => s.sd));

// ------------------------------------------------------------- ground truth --
const absRaw = raw.filter(Number.isFinite).map(Math.abs).sort((a, b) => a - b);
const q = (p) => absRaw[Math.min(absRaw.length - 1, Math.floor((1 - p) * absRaw.length))];
const medAbs = absRaw[absRaw.length >> 1];
const cut = TIERS.map(q);

const eventsAt = (thr) => {
  const ev = []; let start = -1;
  for (let i = 0; i < n; i++) {
    const on = Number.isFinite(raw[i]) && Math.abs(raw[i]) >= thr;
    if (on && start < 0) start = i;
    else if (!on && start >= 0) { ev.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) ev.push([start, n - 1]);
  return ev;
};
const EV = cut.map(eventsAt);

// ----------------------------------------------------------------- metrics --
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : NaN);

function measure(z) {
  const fired = z.map((v) => Number.isFinite(v) && Math.abs(v) >= ENTER);
  const usable = z.filter(Number.isFinite).length;
  const nFired = fired.filter(Boolean).length;

  let falseSpikes = 0;
  for (let i = 0; i < n; i++) if (fired[i] && Number.isFinite(raw[i]) && Math.abs(raw[i]) < medAbs) falseSpikes++;

  const retention = [], delays = [];
  for (const ev of EV) {
    let kept = 0; const d = [];
    for (const [a, b] of ev) {
      let first = -1;
      for (let i = a; i <= Math.min(n - 1, b + 6); i++) if (fired[i]) { first = i; break; }
      if (first >= 0) { kept++; d.push(first - a); }
    }
    retention.push(ev.length ? kept / ev.length : NaN);
    delays.push(d);
  }

  const peakBars = [];
  for (let i = 0; i < n; i++) if (Number.isFinite(raw[i]) && Math.abs(raw[i]) >= cut[2] && Number.isFinite(z[i])) peakBars.push(Math.abs(z[i]));

  let flips = 0, comparable = 0;
  for (let i = 1; i < n; i++) {
    if (!Number.isFinite(z[i]) || !Number.isFinite(z[i - 1])) continue;
    comparable++;
    if (fired[i] !== fired[i - 1]) flips++;
  }

  return {
    usable, freq: nFired / usable,
    falseRate: nFired ? falseSpikes / nFired : NaN, falseCount: falseSpikes,
    retention, medDelay: median(delays[0]), delays,
    peak: median(peakBars), flipRate: comparable ? flips / comparable : NaN,
  };
}

const V = { A: zA, B30: slotZ(30), B60: slotZ(60) };
const R = Object.fromEntries(Object.entries(V).map(([k, z]) => [k, measure(z)]));

// ------------------------------------------------------------------ report --
const pct = (x, d = 1) => (Number.isFinite(x) ? (x * 100).toFixed(d) + '%' : '  n/a');
console.log('='.repeat(112));
console.log('OI 4H DE-SEASONALIZATION AUDIT — signal quality only, no market outcome used');
console.log(`frozen hash ${hash}`);
console.log(`${n} bars  ${new Date(bars[0].t).toISOString().slice(0, 10)} -> ${new Date(bars.at(-1).t).toISOString().slice(0, 10)}`);
console.log('='.repeat(112));

console.log('\n--- step 1: is there a UTC-slot effect in the raw 4H OI change at all? ---');
console.log('  slot (UTC)      n     mean       sd    mean |chg|   vs all slots');
for (let s = 0; s < SLOTS; s++) {
  const st = slotStats[s];
  const lab = `${String(s * 4).padStart(2, '0')}-${String(s * 4 + 4).padStart(2, '0')}`;
  console.log(`  ${lab}      ${String(st.n).padStart(6)}  ${(st.mean * 100).toFixed(3).padStart(7)}%  ${(st.sd * 100).toFixed(3).padStart(7)}%  ${(st.absMean * 100).toFixed(3).padStart(9)}%   ${((st.absMean / grandAbs - 1) * 100).toFixed(1).padStart(6)}%`);
}
console.log(`\n  spread of per-slot standard deviation: ${sdSpread.toFixed(2)}x between the widest and narrowest slot`);
console.log(`  ${sdSpread < 1.15 ? 'The slots are close to interchangeable. There is little seasonality to remove.'
  : sdSpread < 1.5 ? 'A modest slot effect exists — enough that de-seasonalising is worth measuring.'
    : 'A large slot effect exists; pooling slots in one z-score is measurably wrong.'}`);

console.log('\n--- step 2: ground truth, defined on the RAW change so no variant is favoured ---');
console.log(`  median |4H OI change|      ${(medAbs * 100).toFixed(3)}%`);
TIERS.forEach((t, i) => console.log(`  top ${(t * 100).toFixed(1)}% cutoff            ${(cut[i] * 100).toFixed(3)}%   ${EV[i].length} independent events`));

console.log('\n--- step 3: the three variants ---');
console.log('  variant   usable   fires   false spikes   retention 1%/0.5%/0.1%   med delay   peak |z|   flip rate');
for (const [k, r] of Object.entries(R)) {
  console.log(`  ${k.padEnd(9)}${String(r.usable).padStart(7)}${pct(r.freq).padStart(8)}${(pct(r.falseRate) + ` (${r.falseCount})`).padStart(15)}   ${r.retention.map((x) => pct(x, 0)).join(' / ').padStart(20)}${String(r.medDelay).padStart(12)}${r.peak.toFixed(2).padStart(11)}${pct(r.flipRate).padStart(12)}`);
}

console.log('\n--- step 4: the pre-registered adoption rule ---');
const A = R.A;
let adopted = null;
for (const k of ['B30', 'B60']) {
  const b = R[k];
  const c1 = b.falseRate <= A.falseRate * 0.8;
  const c2 = b.retention.every((x, i) => x >= A.retention[i] - 0.02);
  const c3 = b.medDelay === A.medDelay;
  const c4 = b.freq >= A.freq * 0.75 && b.freq <= A.freq * 1.25;
  const pass = c1 && c2 && c3 && c4;
  console.log(`  ${k}`);
  console.log(`    1. false-spike rate >=20% lower   ${pct(b.falseRate)} vs ${pct(A.falseRate)}   ${c1 ? 'PASS' : 'FAIL'}`);
  console.log(`    2. retention within 2pp at all tiers                       ${c2 ? 'PASS' : 'FAIL'}`);
  console.log(`    3. median detection delay equals A (${A.medDelay})                     ${c3 ? 'PASS' : 'FAIL'}`);
  console.log(`    4. impulse frequency within +-25% of A                     ${c4 ? 'PASS' : 'FAIL'}`);
  console.log(`    => ${pass ? 'ADOPT' : 'REJECT'}`);
  if (pass && !adopted) adopted = k;
}

console.log('\n' + '='.repeat(112));
console.log('DECISION');
console.log('='.repeat(112));
if (adopted) {
  console.log(`  ${adopted} clears every pre-registered gate. OI 4H should be re-normalised on the`);
  console.log('  same UTC slot. main.pine must be changed and the threshold version bumped.');
} else {
  console.log('  NO CHANGE. Neither same-slot variant cleared the pre-registered gates, so OI 4H');
  console.log('  keeps the rolling 180-bar z-score and stays an IMPULSE — reported the moment it');
  console.log('  happens, with no persistent state and nothing claimed to last.');
  console.log('');
  console.log('  This is the expected shape of a negative result and it is being recorded as one.');
  console.log('  Nothing was re-tuned after seeing these numbers; the candidates and the rule were');
  console.log('  fixed in the header before the first run.');
}
console.log('\n  No forward return, MAE, MFE or Sharpe was computed anywhere in this file.');
