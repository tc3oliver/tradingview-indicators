// H2 — disaggregated derivatives positioning.
//
// H1 RESULT (closed, not reopened): using aggregate coin-denominated OI alone,
// deleveraging pullbacks out-returned leveraging pullbacks in 12 of 12 cells
// with adequate sample, but NO bootstrap CI excluded zero. Recorded as
// "direction consistent, statistically underpowered". Reaching significance at
// the observed effect size would need ~360 events vs ~25/yr available.
//
// The original spec's USD-notional OI "Healthy Deleveraging" gate is WITHDRAWN
// as invalid: USD OI = coin OI x price, so it falls mechanically whenever price
// falls. It classified 134 of 147 uptrend pullbacks (91%) as "healthy" and its
// sign reversed at 3 of 4 horizons. It is a lagged price transform, not a
// positioning measure.
//
// H2 motivation is not a fishing expedition. The published positioning results
// (CFTC COT, commercial vs non-commercial) attach to DISAGGREGATION. Aggregate
// OI throws away who holds the position. The Binance metrics dump gives us the
// disaggregation for free.
//
// ============================================================================
// PRE-REGISTERED — fixed before the first run.
// ============================================================================
//
// EVENT DEFINITION: unchanged from H1. 30-bar lookback, D = 5% drawdown from
// the running high, 30-bar spacing, uptrend only (close[peakBar] > EMA200).
// Not re-tuned. No new drawdown thresholds scanned.
//
// EPISODE: consecutive events belong to the same drawdown episode if price
// never exceeded the earlier event's peak between them. The FIRST event of each
// episode is the independent unit. All statistics are episode-level.
//
// VARIABLES (all measured peakBar -> event bar, all disaggregated, no funding):
//   oiChg    coin/contract-denominated OI change.  USD notional is BANNED.
//   ttlsChg  top trader long/short POSITION ratio change (sum_*).
//            The account ratio (count_*) is NOT used as a primary variable.
//   takerImb mean taker buy/sell imbalance over the leg, 2*takerBuy/vol - 1.
//
// CLASSIFICATION — three-way, sign-based. No magnitude thresholds exist to be
// tuned. Events matching neither rule are UNCLASSIFIED and are excluded from
// the primary comparison rather than forced into a binary.
//   HEALTHY  : oiChg < 0 AND ttlsChg >= 0   leverage leaving, top traders not cutting longs
//   BEARISH  : oiChg > 0 AND ttlsChg <  0   positions being built, top traders cutting longs
//   UNCLASSIFIED : everything else
//
// PRIMARY OUTCOME: 24h (6-bar) forward return. 48h is secondary and does not
// affect the verdict.
//
// TAKER IMBALANCE is tested as a SEPARATE split (H2b), not folded into the
// primary classifier — it is a flow variable, not a positioning variable, and
// mixing them would destroy attribution.
//
// STATISTICS: moving-block bootstrap over the time-ordered episode sequence,
// preserving labels, so regime clustering is not treated as independence.
// Primary block length L = 5 episodes; L = 1 and 3 reported for sensitivity
// only. 10,000 resamples, seeded.
//
// DISCOVERY / HOLDOUT: chronological. Discovery 2020-09 -> 2024-08.
// Holdout 2024-09 -> present. Direction must agree. Thresholds are NOT to be
// re-tuned after seeing the holdout.
//
// H2 PASSES only if ALL hold:
//   1. HEALTHY minus BEARISH 24h forward return > +0.50%
//   2. 95% block-bootstrap CI of that difference excludes 0
//   3. >= 30 independent episodes in each group
//   4. discovery and holdout agree in direction
//   5. no threshold re-tuning after the holdout is seen
// ============================================================================

import { readFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync(new URL('../data/cache/btc-4h.json', import.meta.url), 'utf8'));

const LOOKBACK = 30, SPACING = 30, D = 0.05;
const PRIMARY_H = 6;                 // 24h
const HORIZONS = [6, 12];            // 24h primary, 48h secondary
const BOOT = 10000, BLOCK_PRIMARY = 5, BLOCKS = [1, 3, 5];
const HOLDOUT_FROM = Date.parse('2024-09-01T00:00:00Z');

let _s = 0x2f6e2b1;
const rnd = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; _s |= 0; return (_s >>> 0) / 4294967296; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (x) => (x * 100).toFixed(2) + '%';

const ema = (v, n) => { const k = 2 / (n + 1); let e = v[0]; return v.map((x, i) => (e = i ? x * k + e * (1 - k) : x)); };
const ema200 = ema(rows.map((r) => r.close), 200);

const maxH = Math.max(...HORIZONS);

// ---------- events (H1 definition, verbatim) ----------
const raw = [];
let last = -Infinity;
for (let i = LOOKBACK; i < rows.length - maxH; i++) {
  if (i - last < SPACING) continue;
  let peak = -Infinity, peakBar = -1;
  for (let j = i - LOOKBACK; j < i; j++) if (rows[j].high > peak) { peak = rows[j].high; peakBar = j; }
  if (rows[i].close > peak * (1 - D)) continue;
  if (rows[peakBar].oi == null || rows[i].oi == null) continue;
  last = i;

  // taker imbalance averaged across the pullback leg
  let imb = 0, cnt = 0;
  for (let j = peakBar; j <= i; j++) {
    if (rows[j].volume > 0) { imb += (2 * rows[j].takerBuyVolume) / rows[j].volume - 1; cnt++; }
  }
  raw.push({
    i, peakBar, peak,
    t: rows[i].t,
    date: new Date(rows[i].t).toISOString().slice(0, 10),
    uptrend: rows[peakBar].close > ema200[peakBar],
    oiChg: (rows[i].oi - rows[peakBar].oi) / rows[peakBar].oi,
    ttlsChg: rows[peakBar].topTraderLS > 0 ? (rows[i].topTraderLS - rows[peakBar].topTraderLS) / rows[peakBar].topTraderLS : null,
    takerImb: cnt ? imb / cnt : null,
    fwd: Object.fromEntries(HORIZONS.map((h) => [h, (rows[i + h].close - rows[i].close) / rows[i].close])),
  });
}

// ---------- overlap / double-counting audit ----------
console.log('='.repeat(96));
console.log('H2 — disaggregated derivatives positioning');
console.log(`data: ${rows.length} 4H bars  ${new Date(rows[0].t).toISOString().slice(0, 10)} -> ${new Date(rows.at(-1).t).toISOString().slice(0, 10)}`);
console.log('='.repeat(96));
console.log('\n--- audit 1: do forward-return windows overlap? ---');
let overlaps = 0, minGap = Infinity;
for (let k = 1; k < raw.length; k++) {
  const gap = raw[k].i - raw[k - 1].i;
  minGap = Math.min(minGap, gap);
  if (gap <= maxH) overlaps++;
}
console.log(`  events: ${raw.length}   min gap between events: ${minGap} bars   max horizon: ${maxH} bars`);
console.log(`  overlapping forward windows: ${overlaps}  ${overlaps === 0 ? '(none — spacing 30 > horizon 12)' : '(PROBLEM)'}`);

console.log('\n--- audit 2: is the same pullback counted more than once? ---');
// Same episode if price never exceeded the previous event's peak in between.
for (const e of raw) e.episode = null;
let ep = 0;
for (let k = 0; k < raw.length; k++) {
  if (k === 0) { raw[k].episode = ep; continue; }
  const prev = raw[k - 1];
  let recovered = false;
  for (let j = prev.i; j < raw[k].i; j++) if (rows[j].high > prev.peak) { recovered = true; break; }
  raw[k].episode = recovered ? ++ep : prev.episode;
}
const bySamePeak = raw.filter((e, k) => k > 0 && e.peakBar === raw[k - 1].peakBar).length;
const dupEpisode = raw.length - new Set(raw.map((e) => e.episode)).size;
console.log(`  events sharing a peak bar with the previous event : ${bySamePeak}`);
console.log(`  events that are continuations of a live drawdown  : ${dupEpisode}`);
console.log(`  raw events ${raw.length}  ->  independent episodes ${raw.length - dupEpisode}`);

// first event of each episode = the actionable signal
const seen = new Set();
const eps = raw.filter((e) => (seen.has(e.episode) ? false : (seen.add(e.episode), true)));
const up = eps.filter((e) => e.uptrend && e.ttlsChg != null && e.takerImb != null);
console.log(`  episodes ${eps.length}  ->  uptrend, complete data: ${up.length}`);
console.log(`\n  H1 reported 101 deleveraging / 46 leveraging RAW EVENTS.`);
const h1Raw = raw.filter((e) => e.uptrend);
console.log(`  Recount at episode level: ${up.length} independent uptrend episodes (was ${h1Raw.length} raw events).`);
console.log(`  => H1's effective n was overstated by ${h1Raw.length - up.length} (${((1 - up.length / h1Raw.length) * 100).toFixed(0)}%). Its CIs were too narrow, not too wide.`);

// ---------- classification ----------
const label = (e) => (e.oiChg < 0 && e.ttlsChg >= 0 ? 'HEALTHY' : e.oiChg > 0 && e.ttlsChg < 0 ? 'BEARISH' : 'UNCLASSIFIED');
for (const e of up) e.cls = label(e);

const counts = { HEALTHY: 0, BEARISH: 0, UNCLASSIFIED: 0 };
for (const e of up) counts[e.cls]++;
console.log('\n--- classification (three-way, sign-based, nothing tunable) ---');
for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(13)} ${String(v).padStart(4)}  ${((v / up.length) * 100).toFixed(0)}%`);

// ---------- moving-block bootstrap over the ordered episode sequence ----------
// Resamples blocks of consecutive episodes carrying their labels, so bull-market
// clustering of HEALTHY episodes is not counted as independent information.
function blockBoot(seq, h, L) {
  const n = seq.length;
  const nb = Math.ceil(n / L);
  const out = [];
  for (let b = 0; b < BOOT; b++) {
    const A = [], B = [];
    for (let k = 0; k < nb; k++) {
      const s = (rnd() * n) | 0;
      for (let j = 0; j < L; j++) {
        const e = seq[(s + j) % n];
        if (e.cls === 'HEALTHY') A.push(e.fwd[h]);
        else if (e.cls === 'BEARISH') B.push(e.fwd[h]);
      }
    }
    if (A.length && B.length) out.push(mean(A) - mean(B));
  }
  out.sort((x, y) => x - y);
  return { lo: out[Math.floor(0.025 * out.length)], hi: out[Math.floor(0.975 * out.length)], n: out.length };
}

function show(seq, title) {
  const A = seq.filter((e) => e.cls === 'HEALTHY');
  const B = seq.filter((e) => e.cls === 'BEARISH');
  console.log(`\n  ${title}   healthy n=${A.length}  bearish n=${B.length}`);
  if (!A.length || !B.length) { console.log('    empty group'); return null; }
  const res = {};
  for (const h of HORIZONS) {
    const a = A.map((e) => e.fwd[h]), b = B.map((e) => e.fwd[h]);
    const d = mean(a) - mean(b);
    const ci = blockBoot(seq, h, BLOCK_PRIMARY);
    res[h] = { d, ...ci, nA: a.length, nB: b.length };
    const tag = h === PRIMARY_H ? 'PRIMARY' : 'secondary';
    console.log(`    ${String(h * 4 + 'h').padStart(5)} ${tag.padEnd(10)} healthy ${pct(mean(a)).padStart(8)} (med ${pct(median(a)).padStart(7)})  bearish ${pct(mean(b)).padStart(8)} (med ${pct(median(b)).padStart(7)})  diff ${pct(d).padStart(8)}  CI[${pct(ci.lo)}, ${pct(ci.hi)}]  ${ci.lo > 0 || ci.hi < 0 ? 'excl 0' : '—'}`);
  }
  return res;
}

console.log('\n' + '-'.repeat(96));
console.log('H2a PRIMARY — OI direction x top-trader position ratio direction');
console.log('-'.repeat(96));
const full = show(up, 'FULL SAMPLE 2020-09 -> 2026-09');

const disc = up.filter((e) => e.t < HOLDOUT_FROM);
const hold = up.filter((e) => e.t >= HOLDOUT_FROM);
const rd = show(disc, 'DISCOVERY 2020-09 -> 2024-08');
const rh = show(hold, 'HOLDOUT   2024-09 -> 2026-09');

console.log('\n  block-length sensitivity on the primary horizon (primary L=5):');
for (const L of BLOCKS) {
  const ci = blockBoot(up, PRIMARY_H, L);
  console.log(`    L=${L}  CI[${pct(ci.lo)}, ${pct(ci.hi)}]  ${ci.lo > 0 || ci.hi < 0 ? 'excl 0' : '—'}`);
}

// ---------- H2b: taker imbalance, reported separately for attribution ----------
console.log('\n' + '-'.repeat(96));
console.log('H2b SECONDARY — taker buy/sell imbalance (flow, not positioning; separate for attribution)');
console.log('-'.repeat(96));
const tb = up.map((e) => ({ ...e, cls: e.takerImb > 0 ? 'HEALTHY' : 'BEARISH' }));
show(tb, 'split on mean taker imbalance > 0 over the pullback leg');

// ---------- verdict ----------
console.log('\n' + '='.repeat(96));
console.log('VERDICT vs pre-registered H2 criteria');
console.log('='.repeat(96));
const p = full?.[PRIMARY_H];
const c1 = !!p && p.d > 0.005;
const c2 = !!p && p.lo > 0;
const c3 = !!p && p.nA >= 30 && p.nB >= 30;
const c4 = !!rd?.[PRIMARY_H] && !!rh?.[PRIMARY_H] && Math.sign(rd[PRIMARY_H].d) === Math.sign(rh[PRIMARY_H].d);
console.log(`  1. 24h diff > +0.50%                        ${c1 ? 'PASS' : 'FAIL'}  (${p ? pct(p.d) : 'n/a'})`);
console.log(`  2. 95% block-bootstrap CI excludes 0        ${c2 ? 'PASS' : 'FAIL'}  (${p ? `[${pct(p.lo)}, ${pct(p.hi)}]` : 'n/a'})`);
console.log(`  3. >= 30 independent episodes per group     ${c3 ? 'PASS' : 'FAIL'}  (${p ? `${p.nA} / ${p.nB}` : 'n/a'})`);
console.log(`  4. discovery and holdout agree in direction ${c4 ? 'PASS' : 'FAIL'}  (${rd?.[PRIMARY_H] ? pct(rd[PRIMARY_H].d) : 'n/a'} vs ${rh?.[PRIMARY_H] ? pct(rh[PRIMARY_H].d) : 'n/a'})`);
console.log(`  5. no post-holdout threshold re-tuning      PASS  (classification is sign-based; nothing to tune)`);
console.log(`\n  >>> H2 ${c1 && c2 && c3 && c4 ? 'PASS' : 'FAIL'}`);
console.log('\n  Search log: hypotheses 2 | event definitions 1 (unchanged from H1) |');
console.log('  drawdown thresholds scanned in H2: 0 | post-hoc re-tunings: 0');
