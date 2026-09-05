// H4 — derivatives as a RISK flag (second moment), not a direction signal.
//
// H1/H2 killed the direction claim. H3 killed the layered architecture: market
// structure as specified is a NEGATIVE contribution, B-Xtrender is
// indistinguishable from MACD with the sign flipping between periods, and no
// derivatives veto earns its place.
//
// One honest avenue remains, and it is the only use the evidence review found
// even weakly supported: practitioners universally read elevated open interest
// as CASCADE POTENTIAL IN BOTH DIRECTIONS — a second-moment variable. Nobody
// claims it predicts direction; several sources explicitly decline to.
//
// A feature that cannot predict return may still earn its place by flagging
// entries with fat left tails.
//
// ============================================================================
// PRE-REGISTERED — fixed before the first run.
// ============================================================================
//
// THEORY. High leverage concentration raises the probability of a forced-
// liquidation cascade. Cascades are violent in whichever direction they fire,
// so the prediction is about the MAGNITUDE of adverse excursion, not its sign.
//
// FEATURES (all coin-denominated; USD notional remains banned):
//   oiChgZ    z-score of 4H OI change, 180-bar trailing  (the spec's variable)
//   oiLvlZ    z-score of the OI LEVEL, 180-bar trailing  (crowding, arguably
//             the better proxy — declared up front, not added after a result)
//   fundingZ  z-score of funding rate
//   takerZ    z-score of taker buy/sell imbalance
//
// BENCHMARK — the control that H1-H3 lacked:
//   volZ      z-score of trailing 30-bar realised volatility
// A derivatives feature earns nothing by predicting risk if simply looking at
// recent volatility predicts it equally well. Every feature is therefore also
// tested WITHIN trailing-volatility buckets. Beating nothing is not an edge.
//
// OUTCOMES over the next 24h (6 bars), measured from the decision bar's close:
//   MAE   min(low) / close - 1        the left tail an entry would have worn
//   MFE   max(high) / close - 1
//   rvol  stdev of the 6 forward bar returns
//   tail  indicator of MAE < -5%
//
// SAMPLING. Consecutive bars' 6-bar forward windows overlap by 5, which would
// inflate significance ~6x. PRIMARY analysis uses every 6th bar only, so
// forward windows never overlap. Full-sample block bootstrap (L=60 bars) is
// reported as secondary.
//
// FLAG DEFINITION: feature z > +1.5 (for takerZ, < -1.5). Same thresholds as
// H3, taken from the original spec. Nothing new was tuned.
//
// A FEATURE IS ADMITTED AS A RISK FLAG only if ALL hold:
//   1. mean forward MAE is worse in the flagged group by >= 1.0 percentage point
//   2. 95% bootstrap CI of that difference excludes 0
//   3. same direction in development, validation AND holdout
//   4. >= 100 non-overlapping flagged observations
//   5. the effect SURVIVES within trailing-volatility buckets — i.e. it is not
//      just restating "the market is currently volatile"
// ============================================================================

import { readFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync(new URL('../data/cache/btc-4h.json', import.meta.url), 'utf8'));
const n = rows.length;
const close = rows.map((r) => r.close), high = rows.map((r) => r.high), low = rows.map((r) => r.low);

const H = 6, Z_WIN = 180, Z_LIM = 1.5, BOOT = 10000;
const SPLITS = {
  development: [Date.parse('2020-09-01T00:00:00Z'), Date.parse('2024-01-01T00:00:00Z')],
  validation: [Date.parse('2024-01-01T00:00:00Z'), Date.parse('2025-07-01T00:00:00Z')],
  holdout: [Date.parse('2025-07-01T00:00:00Z'), Infinity],
};

let _s = 0x51ed270b;
const rnd = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; _s |= 0; return (_s >>> 0) / 4294967296; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const p2 = (x) => (x * 100).toFixed(2) + '%';

function zscore(v, w) {
  const out = new Array(v.length).fill(NaN);
  for (let i = w; i < v.length; i++) {
    let s = 0, c = 0;
    for (let j = i - w + 1; j <= i; j++) if (Number.isFinite(v[j])) { s += v[j]; c++; }
    if (c < w / 2) continue;
    const m = s / c;
    let q = 0;
    for (let j = i - w + 1; j <= i; j++) if (Number.isFinite(v[j])) q += (v[j] - m) ** 2;
    const sd = Math.sqrt(q / c);
    out[i] = sd > 0 ? (v[i] - m) / sd : 0;
  }
  return out;
}

const barRet = close.map((c, i) => (i ? c / close[i - 1] - 1 : 0));
const trailVol = barRet.map((_, i) => {
  if (i < 30) return NaN;
  const w = barRet.slice(i - 29, i + 1);
  const m = mean(w);
  return Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / w.length);
});

const F = {
  oiChgZ: zscore(rows.map((r, i) => (i && rows[i - 1].oi ? (r.oi - rows[i - 1].oi) / rows[i - 1].oi : 0)), Z_WIN),
  oiLvlZ: zscore(rows.map((r) => r.oi ?? NaN), Z_WIN),
  fundingZ: zscore(rows.map((r) => r.funding ?? 0), Z_WIN),
  takerZ: zscore(rows.map((r) => (r.volume > 0 ? (2 * r.takerBuyVolume) / r.volume - 1 : 0)), Z_WIN),
  volZ: zscore(trailVol, Z_WIN),
};
// takerZ flags aggressive SELLING, so its extreme is the negative tail.
const FLAG = { oiChgZ: (z) => z > Z_LIM, oiLvlZ: (z) => z > Z_LIM, fundingZ: (z) => z > Z_LIM, takerZ: (z) => z < -Z_LIM, volZ: (z) => z > Z_LIM };

// Non-overlapping sample: every 6th bar, full forward window, all features valid.
const sample = [];
for (let i = Z_WIN; i + H < n; i += H) {
  if (Object.values(F).some((f) => !Number.isFinite(f[i]))) continue;
  let lo = Infinity, hi = -Infinity;
  const fr = [];
  for (let j = i + 1; j <= i + H; j++) { lo = Math.min(lo, low[j]); hi = Math.max(hi, high[j]); fr.push(barRet[j]); }
  const m = mean(fr);
  sample.push({
    i, t: rows[i].t,
    mae: lo / close[i] - 1,
    mfe: hi / close[i] - 1,
    rvol: Math.sqrt(fr.reduce((s, x) => s + (x - m) ** 2, 0) / fr.length),
    ret: close[i + H] / close[i] - 1,
    z: Object.fromEntries(Object.keys(F).map((k) => [k, F[k][i]])),
    volZ: F.volZ[i],
  });
}

function boot(a, b) {
  const d = new Array(BOOT);
  for (let k = 0; k < BOOT; k++) {
    let sa = 0, sb = 0;
    for (let i = 0; i < a.length; i++) sa += a[(rnd() * a.length) | 0];
    for (let i = 0; i < b.length; i++) sb += b[(rnd() * b.length) | 0];
    d[k] = sa / a.length - sb / b.length;
  }
  d.sort((x, y) => x - y);
  return { lo: d[Math.floor(0.025 * BOOT)], hi: d[Math.floor(0.975 * BOOT)] };
}

console.log('='.repeat(112));
console.log('H4 — do derivatives features flag FORWARD RISK (not direction)?');
console.log(`non-overlapping sample: ${sample.length} observations (every ${H}th bar, 24h forward window)`);
console.log('='.repeat(112));

function analyse(feat, set, tag) {
  const A = set.filter((s) => FLAG[feat](s.z[feat]));   // flagged
  const B = set.filter((s) => !FLAG[feat](s.z[feat]));
  if (A.length < 5 || B.length < 5) return { n: A.length, dMae: NaN, lo: NaN, hi: NaN };
  const dMae = mean(A.map((s) => s.mae)) - mean(B.map((s) => s.mae));
  const ci = boot(A.map((s) => s.mae), B.map((s) => s.mae));
  const tailA = A.filter((s) => s.mae < -0.05).length / A.length;
  const tailB = B.filter((s) => s.mae < -0.05).length / B.length;
  const dVol = mean(A.map((s) => s.rvol)) - mean(B.map((s) => s.rvol));
  if (tag) {
    console.log(`    ${tag.padEnd(13)} n=${String(A.length).padStart(4)}  MAE ${p2(mean(A.map((s) => s.mae))).padStart(8)} vs ${p2(mean(B.map((s) => s.mae))).padStart(8)}  diff ${p2(dMae).padStart(8)}  CI[${p2(ci.lo)}, ${p2(ci.hi)}]  ${ci.hi < 0 ? 'RISKIER' : ci.lo > 0 ? 'safer' : '—'}   P(MAE<-5%) ${p2(tailA)} vs ${p2(tailB)}   fwd rvol ${dVol > 0 ? '+' : ''}${(dVol * 100).toFixed(2)}pp`);
  }
  return { n: A.length, dMae, ...ci };
}

console.log('\n--- full sample, each feature vs the rest ---');
const fullRes = {};
for (const k of Object.keys(F)) {
  console.log(`\n  ${k}${k === 'volZ' ? '   <-- BENCHMARK: plain trailing volatility, the thing to beat' : ''}`);
  fullRes[k] = analyse(k, sample, 'all');
}

console.log('\n\n--- direction agreement across development / validation / holdout ---');
console.log('  feature      dev diff   val diff   hold diff   agree?');
const agree = {};
for (const k of Object.keys(F)) {
  const r = Object.entries(SPLITS).map(([, [a, b]]) => analyse(k, sample.filter((s) => s.t >= a && s.t < b), null));
  const signs = r.map((x) => Math.sign(x.dMae));
  agree[k] = signs.every((s) => s === signs[0]) && Number.isFinite(signs[0]);
  console.log(`  ${k.padEnd(11)}${r.map((x) => (Number.isFinite(x.dMae) ? p2(x.dMae) : 'n/a').padStart(11)).join('')}   ${agree[k] ? 'yes' : 'NO'}`);
}

console.log('\n\n--- criterion 5: does it survive INSIDE trailing-volatility buckets? ---');
console.log('  If a feature only works because volatile periods are volatile, it adds nothing.');
const loVol = sample.filter((s) => s.volZ <= 0), hiVol = sample.filter((s) => s.volZ > 0);
for (const k of Object.keys(F)) {
  if (k === 'volZ') continue;
  console.log(`\n  ${k}`);
  analyse(k, loVol, 'calm regime');
  analyse(k, hiVol, 'volatile');
}

console.log(`\n${'='.repeat(112)}\nVERDICT vs pre-registered H4 criteria\n${'='.repeat(112)}`);
console.log('  feature      1.MAE>=1pp worse  2.CI excl 0  3.dir agrees  4.n>=100  5.survives vol buckets  ADMIT?');
for (const k of Object.keys(F)) {
  if (k === 'volZ') continue;
  const r = fullRes[k];
  const c1 = r.dMae <= -0.01;
  const c2 = r.hi < 0;
  const c3 = agree[k];
  const c4 = r.n >= 100;
  const a = analyse(k, loVol, null), b = analyse(k, hiVol, null);
  const c5 = a.hi < 0 && b.hi < 0;
  const ok = c1 && c2 && c3 && c4 && c5;
  const y = (v) => (v ? 'yes' : 'NO ');
  console.log(`  ${k.padEnd(11)}${y(c1).padStart(15)}${y(c2).padStart(13)}${y(c3).padStart(14)}${y(c4).padStart(10)}${y(c5).padStart(24)}   ${ok ? '*** ADMIT ***' : 'reject'}`);
}
console.log('\n  volZ is the benchmark, not a candidate. A derivatives feature that only');
console.log('  matches volZ has produced no information a 30-bar stdev did not already have.');
