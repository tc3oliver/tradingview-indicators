// Does hysteresis actually reduce flicker, or does it just add delay?
//
// The claim being tested is narrow and has nothing to do with trading edge:
// a Schmitt trigger should collapse a state that rattles across its threshold
// into a readable one, WITHOUT delaying the moment the threshold is first
// crossed. The obvious alternative — "require two consecutive bars" — buys
// stability by paying 8 hours of delay, which is why it was not used.
//
// Four measurements, as specified:
//   transition count        how often the displayed state changes
//   median state duration   how long a state survives once entered
//   extreme retention       fraction of raw threshold crossings still reported
//   detection delay         bars between the raw crossing and the state engaging
//
// The script also cross-checks the JavaScript Schmitt implementation against
// what the compiled Pine actually emitted. If those disagree, every number
// below is describing a different state machine than the indicator runs.

import { readFileSync } from 'node:fs';

const { hash, bars } = JSON.parse(readFileSync(new URL('./states.json', import.meta.url), 'utf8'));
const n = bars.length;

// Thresholds mirror main.pine's defaults exactly.
// Only the REGIME measures are covered. OI 4H, PREMIUM and PARTICIPATION were
// demoted to IMPULSE by smoothing-audit.mjs precisely because no configuration
// of this trigger made them readable; they now hold no state to verify.
// OI 24H is fed the EMA(2)-smoothed z, which is what the indicator uses.
// v3: the ladder is driven by |z| ALONE and the sign comes from the raw value,
// so the model below must do the same or it is describing a different machine.
// `dir` names the raw-sign field; where it is null the raw value IS the
// deviation and the signed Schmitt applies directly.
const M = {
  'OI 24H': { z: 'oiZ24s',    dir: 'oi24Dir', pine: 'oi24St', levels: 2, e1: 1.0, x1: 0.6, e2: 2.0, x2: 1.25 },
  'TREND':  { z: 'trendDist', dir: null,      pine: 'trSt',   levels: 1, e1: 0.5, x1: 0.2 },
};

// --- the three state machines under comparison ---

// No hysteresis: a bare threshold on |z|, re-evaluated every bar, signed by the
// raw direction exactly as the indicator signs it.
function raw(zs, e1, e2, dirs) {
  return zs.map((z, i) => {
    if (!Number.isFinite(z)) return 0;
    const a = Math.abs(z);
    const s = dirs ? (dirs[i] || 0) : (z >= 0 ? 1 : -1);
    const lvl = e2 !== undefined && a >= e2 ? 2 : a >= e1 ? 1 : 0;
    return lvl * s;
  });
}

// Two-bar confirmation: the alternative that trades delay for stability.
function confirmed(zs, e1, e2, dirs, k = 2) {
  const r = raw(zs, e1, e2, dirs);
  const n = zs.length;
  const out = new Array(n).fill(0);
  let st = 0;
  for (let i = 0; i < n; i++) {
    let same = true;
    for (let j = 0; j < k; j++) if (i - j < 0 || r[i - j] !== r[i]) same = false;
    if (same) st = r[i];
    out[i] = st;
  }
  return out;
}

// Schmitt: same entry threshold as raw, a lower exit threshold. Mirrors the
// Pine mag()/sch() functions line for line, including the v3 na-reset.
function schmitt(zs, cfg, dirs) {
  const out = new Array(n).fill(0);
  let lvl = 0, st = 0;
  for (let i = 0; i < n; i++) {
    const z = zs[i];
    if (cfg.levels === 1) {
      // sch(): the raw value is itself the deviation, so the state is signed.
      if (!Number.isFinite(z)) st = 0;
      else if (st === 0) st = z >= cfg.e1 ? 1 : z <= -cfg.e1 ? -1 : 0;
      else if (st === 1 && z < cfg.x1) st = 0;
      else if (st === -1 && z > -cfg.x1) st = 0;
      out[i] = st;
    } else {
      // mag(): magnitude only. No sign flip can reset it — the direction word
      // is a separate axis and lives on the raw value.
      if (!Number.isFinite(z)) lvl = 0;
      else {
        const a = Math.abs(z);
        if (lvl === 0) lvl = a >= cfg.e2 ? 2 : a >= cfg.e1 ? 1 : 0;
        else if (a < cfg.x1) lvl = 0;
        else if (lvl === 2 && a < cfg.x2) lvl = 1;
        else if (lvl === 1 && a >= cfg.e2) lvl = 2;
      }
      out[i] = lvl * (dirs ? (dirs[i] || 0) : (Number.isFinite(z) && z < 0 ? -1 : 1));
    }
  }
  return out;
}

// --- metrics ---
const transitions = (st) => { let c = 0; for (let i = 1; i < n; i++) if (st[i] !== st[i - 1]) c++; return c; };

function durations(st) {
  const d = [];
  let cur = st[0], len = 1;
  for (let i = 1; i < n; i++) {
    if (st[i] === cur) len++;
    else { if (cur !== 0) d.push(len); cur = st[i]; len = 1; }
  }
  if (cur !== 0) d.push(len);
  d.sort((a, b) => a - b);
  return d;
}
const median = (a) => (a.length ? (a.length % 2 ? a[a.length >> 1] : (a[(a.length >> 1) - 1] + a[a.length >> 1]) / 2) : 0);

// A raw "event" is a contiguous run where the bare threshold is engaged. Both
// retention and delay are measured against these, since they are what a reader
// would consider a real crossing.
function events(st) {
  const ev = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (st[i] !== 0 && start < 0) start = i;
    else if (st[i] === 0 && start >= 0) { ev.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) ev.push([start, n - 1]);
  return ev;
}

function retentionAndDelay(rawSt, testSt) {
  const ev = events(rawSt);
  let kept = 0;
  const delays = [];
  for (const [a, b] of ev) {
    let first = -1;
    // allow the state to engage anywhere within the raw event, or shortly after
    for (let i = a; i <= Math.min(n - 1, b + 6); i++) if (testSt[i] !== 0) { first = i; break; }
    if (first >= 0) { kept++; delays.push(first - a); }
  }
  delays.sort((x, y) => x - y);
  return { events: ev.length, kept, retention: ev.length ? kept / ev.length : 1, medDelay: median(delays), maxDelay: delays.length ? delays[delays.length - 1] : 0 };
}

console.log('='.repeat(100));
console.log('HYSTERESIS VERIFICATION — display stability only, no edge claimed');
console.log(`frozen hash ${hash}`);
console.log(`${n} bars  ${new Date(bars[0].t).toISOString().slice(0, 10)} -> ${new Date(bars.at(-1).t).toISOString().slice(0, 10)}`);
console.log('='.repeat(100));

// --- cross-check: does the JS Schmitt reproduce what Pine emitted? ---
console.log('\n--- cross-check against the compiled indicator ---');
let mismatchTotal = 0;
for (const [name, cfg] of Object.entries(M)) {
  const zs = bars.map((b) => b[cfg.z]);
  const dirs = cfg.dir ? bars.map((b) => b[cfg.dir]) : null;
  const js = schmitt(zs, cfg, dirs);
  const pine = bars.map((b) => b[cfg.pine]);
  let bad = 0, firstBad = -1;
  for (let i = 0; i < n; i++) {
    const p = Number.isFinite(pine[i]) ? pine[i] : 0;
    if (js[i] !== p) { bad++; if (firstBad < 0) firstBad = i; }
  }
  mismatchTotal += bad;
  console.log(`  ${name.padEnd(10)} ${bad === 0 ? 'match' : `${bad} mismatches, first at bar ${firstBad}`}`);
}
if (mismatchTotal > 0) {
  console.log('\n  ❌ the JavaScript model disagrees with the compiled indicator.');
  console.log('     Every number below would describe a different state machine. Stopping.');
  process.exit(1);
}
console.log('  ✅ identical on every bar — the comparison below describes the real indicator');

// --- the comparison ---
console.log('\n--- flicker and delay ---');
console.log('  measure     variant        transitions  median dur  events  retained  med delay  max delay');
const summary = [];
for (const [name, cfg] of Object.entries(M)) {
  const zs = bars.map((b) => b[cfg.z]);
  const dirs = cfg.dir ? bars.map((b) => b[cfg.dir]) : null;
  const r = raw(zs, cfg.e1, cfg.levels === 2 ? cfg.e2 : undefined, dirs);
  const h = schmitt(zs, cfg, dirs);
  const c = confirmed(zs, cfg.e1, cfg.levels === 2 ? cfg.e2 : undefined, dirs);
  const rows = [
    ['raw threshold', r],
    ['schmitt', h],
    ['2-bar confirm', c],
  ];
  for (const [label, st] of rows) {
    const rd = label === 'raw threshold' ? { events: events(r).length, retention: 1, medDelay: 0, maxDelay: 0 } : retentionAndDelay(r, st);
    console.log(`  ${(label === 'raw threshold' ? name : '').padEnd(11)} ${label.padEnd(14)}${String(transitions(st)).padStart(12)}${String(median(durations(st))).padStart(12)}${String(rd.events).padStart(8)}${(rd.retention * 100).toFixed(0).padStart(9)}%${String(rd.medDelay).padStart(11)}${String(rd.maxDelay).padStart(11)}`);
    if (label === 'schmitt') summary.push({ name, tRaw: transitions(r), tHys: transitions(h), tConf: transitions(c), dRaw: median(durations(r)), dHys: median(durations(h)), dConf: median(durations(c)), ret: rd.retention, delay: rd.medDelay, maxDelay: rd.maxDelay });
  }
  console.log('');
}

// --- verdict ---
console.log('='.repeat(100));
console.log('VERDICT');
console.log('='.repeat(100));
console.log('  measure     transitions raw -> schmitt   median duration raw -> schmitt   retention   delay');
let allGood = true;
for (const s of summary) {
  const cut = s.tRaw ? (1 - s.tHys / s.tRaw) * 100 : 0;
  // Fewer transitions is not the goal — a readable state is. A median run
  // length that does not move means the flicker was not fixed, however many
  // transitions were shaved off.
  const ok = s.dHys > s.dRaw && s.ret >= 0.99 && s.delay === 0;
  allGood = allGood && ok;
  console.log(`  ${s.name.padEnd(11)}${String(s.tRaw).padStart(6)} -> ${String(s.tHys).padEnd(6)} (${cut >= 0 ? '-' : '+'}${Math.abs(cut).toFixed(0)}%)   ${String(s.dRaw).padStart(9)} -> ${String(s.dHys).padEnd(10)}${(s.ret * 100).toFixed(0).padStart(9)}%${String(s.delay).padStart(8)}  ${ok ? '' : '<-- check'}`);
}
const medConfDelay = summary.length ? summary.reduce((a, s) => a + s.delay, 0) / summary.length : 0;
console.log(`\n  Schmitt keeps the SAME entry threshold as the raw rule, so a first crossing is`);
console.log(`  reported on the same bar: median detection delay ${summary.every((s) => s.delay === 0) ? '0 bars across every measure' : 'NOT zero — investigate'}.`);
console.log(`  The 2-bar-confirmation alternative reaches similar stability only by delaying`);
console.log(`  every entry by up to two bars, which on a 4H chart is eight hours.`);
const noDelay = summary.every((s) => s.delay === 0 && s.ret >= 0.99);
const readable = summary.filter((s) => s.dHys > s.dRaw).length;
console.log(`\n  >>> correctness: ${noDelay ? 'PASS — no crossing lost, no bar of delay added, on any measure' : 'FAIL'}`);
console.log(`  >>> readability: ${readable}/${summary.length} measures got a longer median run. ${readable === summary.length ? '' : 'The rest still flicker.'}`);
if (readable < summary.length)
  console.log('      A Schmitt trigger can only absorb noise smaller than its enter-exit gap.\n      Diagnosis below.');
console.log('\n--- diagnosis: is the enter-exit gap wider than ordinary bar-to-bar movement? ---');
console.log('  A state can only stay engaged if a single bar cannot carry the z-score back');
console.log('  across the exit level. Gap must exceed typical |dz| or the trigger is decorative.\n');
console.log('  measure     enter  exit   gap   median |dz|   p75 |dz|   gap absorbs');
for (const [name, cfg] of Object.entries(M)) {
  const zs = bars.map((b) => b[cfg.z]).filter(Number.isFinite);
  const d = [];
  for (let i = 1; i < zs.length; i++) d.push(Math.abs(zs[i] - zs[i - 1]));
  d.sort((a, b) => a - b);
  const gap = cfg.e1 - cfg.x1;
  const md = d[d.length >> 1], p75 = d[Math.floor(d.length * 0.75)];
  const frac = d.filter((x) => x < gap).length / d.length;
  console.log(`  ${name.padEnd(10)}${cfg.e1.toFixed(2).padStart(6)}${cfg.x1.toFixed(2).padStart(6)}${gap.toFixed(2).padStart(6)}${md.toFixed(2).padStart(13)}${p75.toFixed(2).padStart(11)}${(frac * 100).toFixed(0).padStart(12)}% of bar-to-bar moves`);
}
console.log('\n  Where the gap absorbs well under half of ordinary bar-to-bar movement, the');
console.log('  state will keep rattling no matter how the trigger is wired.');

console.log('\n  This is a readability property. It is not evidence of predictive value, and');
console.log('  no state in this indicator claims any.');
