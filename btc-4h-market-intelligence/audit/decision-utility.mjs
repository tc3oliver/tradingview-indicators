// DECISION UTILITY AUDIT — Market Intelligence v1 (frozen)
//
// Question: beyond organising data, does any state justify an ACTION?
//
// ============================================================================
// RETROSPECTIVE VALIDATION — NOT an out-of-sample proof.
//
// The 2020-09 → 2026-09 window has been examined repeatedly across five earlier
// hypotheses. Nothing computed here can claim untouched OOS status. It can
// eliminate Actions that clearly do not work; it cannot establish that one does.
// Only data arriving after the v1 freeze hash counts as prospective.
// ============================================================================
//
// PRE-REGISTERED, fixed before the first run:
//
// STATES ARE FROZEN. Read from the compiled indicator via states.json, never
// re-derived here. No threshold, feature or definition is touched.
//
// EPISODES. Consecutive bars in the same condition collapse to one episode; the
// entry bar is the single observation. Bar-level counting would inflate every
// interval by the persistence of the state.
//
// MATCHING. Each treated entry is compared only with control bars sharing its
// price environment, on four strata:
//   trend regime (exact) x prior-24h-return quintile x realised-vol tercile x
//   distance-from-EMA200-in-ATR tercile
// Effect = count-weighted mean of within-stratum differences. This is what
// separates "leveraged rallies behave differently" from "rallies that already
// ran behave differently".
//
// OUTCOMES, all normalised by ATR at the entry bar so 2020 and 2026 are
// comparable: maximum adverse excursion, forward return, continuation
// probability. Raw percentages reported alongside.
//
// UNCERTAINTY. Treated side resampled at EPISODE level; control side resampled
// in blocks of 24 bars (4 days). 10,000 iterations, seeded.
//
// ACCEPTANCE (all must hold, else the Action is deleted):
//   1. direction agrees between development (-2024-06) and validation (2024-07-)
//   2. incremental over the matched price-only control
//   3. effect passes its economic threshold:
//        DO NOT CHASE  MAE worse by >= 0.35 ATR, or continuation -10pp
//        RISK-OFF      drawdown worse by >= 0.50 ATR, AND beats a plain
//                      200-day-MA filter
//        SPOT/PERP     a practically observable difference, else descriptive
//   4. not driven by a few extremes — trimmed mean must keep the sign
//   5. >= 30 independent episodes per group
//   6. survives 0.1% friction as a decision (reported, not netted)

import { readFileSync } from 'node:fs';

const { hash, bars } = JSON.parse(readFileSync(new URL('./states.json', import.meta.url), 'utf8'));
const n = bars.length;

// This audit targets the v1 state machine (market/trend/part codes), which v2
// replaced with the REGIME/IMPULSE/CONTEXT split. Against a v2 states.json it
// would find those fields undefined and report "0 episodes" for every test —
// looking like a clean run rather than a broken one. Fail loudly instead.
const V1_FIELDS = ['market', 'trend', 'part'];
const missing = V1_FIELDS.filter((f) => bars.every((b) => b[f] === undefined));
if (missing.length) {
  console.error('This script audits Market Intelligence v1 and cannot run against a v2 states.json.');
  console.error(`Missing v1 fields: ${missing.join(', ')}   (states.json was built from ${hash.slice(0, 12)})`);
  console.error('');
  console.error('Its findings are recorded in AUDIT.md and stand — they are what deleted the');
  console.error('Action layer. To re-derive them, check out main.pine at hash');
  console.error('35b88632358a1b2506b655c9297b2ea593595c9571bc1623a883c7605826235e,');
  console.error('re-run extract-states.mjs, then run this again.');
  process.exit(1);
}
const close = bars.map((b) => b.close), low = bars.map((b) => b.low), atr = bars.map((b) => b.atr);

const BPD = 6;
const H = { '24h': 6, '48h': 12, '3D': 18, '7D': 42 };
const BOOT = 2000, CTRL_BLOCK = 24;
const SPLIT = Date.parse('2024-07-01T00:00:00Z');

let _s = 0x7a1c39f;
const rnd = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; _s |= 0; return (_s >>> 0) / 4294967296; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const med = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// Mean with the most extreme 5% at each end removed — criterion 4.
const trimMean = (a) => { if (a.length < 20) return mean(a); const s = [...a].sort((x, y) => x - y); const k = Math.floor(s.length * 0.05); return mean(s.slice(k, s.length - k)); };
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const pp = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + 'pp' : '—');
const pc = (x) => (Number.isFinite(x) ? (x * 100).toFixed(2) + '%' : '—');

// ---------- price environment ----------
const sma = (v, p) => v.map((_, i) => (i < p - 1 ? NaN : mean(v.slice(i - p + 1, i + 1))));
const ema = (v, p) => { const k = 2 / (p + 1); let e = v[0]; return v.map((x, i) => (e = i ? x * k + e * (1 - k) : x)); };
const ema200 = ema(close, 200);
const ma200d = sma(close, 200 * BPD);          // plain 200-day MA: the price-only baseline
const ret24 = close.map((c, i) => (i >= BPD ? c / close[i - BPD] - 1 : NaN));
const rvol = close.map((_, i) => {
  if (i < 30) return NaN;
  const r = [];
  for (let j = i - 29; j <= i; j++) r.push(Math.log(close[j] / close[j - 1]));
  const m = mean(r);
  return Math.sqrt(mean(r.map((x) => (x - m) ** 2)));
});
const distAtr = close.map((c, i) => (atr[i] > 0 ? (c - ema200[i]) / atr[i] : NaN));

// Strata built from full-sample quantiles. These describe the price
// environment; they are not tunable knobs of any state.
function bucketer(v, k) {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  const cut = Array.from({ length: k - 1 }, (_, i) => s[Math.floor(((i + 1) / k) * s.length)]);
  return (x) => (Number.isFinite(x) ? cut.filter((c) => x > c).length : -1);
}
const bRet = bucketer(ret24, 5), bVol = bucketer(rvol, 3), bDist = bucketer(distAtr, 3);
// Integer stratum ids, computed once. String keys rebuilt inside a bootstrap
// loop dominated the runtime and bought nothing.
// Two schemes. A matching variable must never include the treatment itself:
// RISK-OFF IS the bearish trend read, so "bearish but not RISK-OFF" does not
// exist and matching on trend would leave every episode unmatched. U1 and U3
// compare inside a bullish trend, so there trend stays in.
function mkStrata(withTrend) {
  const ids = new Map();
  const arr = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const k = `${withTrend ? bars[i].trend : 'x'}|${bRet(ret24[i])}|${bVol(rvol[i])}|${bDist(distAtr[i])}`;
    if (!ids.has(k)) ids.set(k, ids.size);
    arr[i] = ids.get(k);
  }
  return { arr, size: ids.size };
}
const ST = { true: mkStrata(true), false: mkStrata(false) };
const NS = Math.max(ST.true.size, ST.false.size);
let strata = ST.true.arr;

// ---------- outcomes ----------
const valid = (i, h) => i + h < n && Number.isFinite(atr[i]) && atr[i] > 0 && Number.isFinite(ret24[i]) && Number.isFinite(rvol[i]) && Number.isFinite(distAtr[i]);
// Precomputed once per (horizon, field). Recomputing a rolling window minimum
// inside the bootstrap was the entire cost of this script.
const OUT = {};
for (const [hk, h] of Object.entries(H)) {
  const maeAtr = new Float64Array(n).fill(NaN), maeRaw = new Float64Array(n).fill(NaN);
  const retAtr = new Float64Array(n).fill(NaN), retRaw = new Float64Array(n).fill(NaN), cont = new Float64Array(n).fill(NaN);
  for (let i = 0; i + h < n; i++) {
    if (!(atr[i] > 0)) continue;
    let lo = Infinity;
    for (let j = i + 1; j <= i + h; j++) if (low[j] < lo) lo = low[j];
    maeAtr[i] = (lo - close[i]) / atr[i];
    maeRaw[i] = lo / close[i] - 1;
    retAtr[i] = (close[i + h] - close[i]) / atr[i];
    retRaw[i] = close[i + h] / close[i] - 1;
    cont[i] = close[i + h] > close[i] ? 1 : 0;
  }
  OUT[h] = { maeAtr, maeRaw, retAtr, retRaw, cont };
}
const outcome = (i, h) => ({ maeAtr: OUT[h].maeAtr[i], maeRaw: OUT[h].maeRaw[i], retAtr: OUT[h].retAtr[i], retRaw: OUT[h].retRaw[i], cont: OUT[h].cont[i] });

// ---------- episodes ----------
function entries(pred) {
  const out = [];
  let prev = false;
  for (let i = 0; i < n; i++) {
    const on = pred(i);
    if (on && !prev) out.push(i);
    prev = on;
  }
  return out;
}

// ---------- matched, stratified comparison ----------
// Effect = count-weighted mean of within-stratum differences, so a treated
// group concentrated in one price environment cannot borrow the average of a
// different one.
const _ts = new Float64Array(NS), _tn = new Float64Array(NS), _cs = new Float64Array(NS), _cn = new Float64Array(NS);
function stratified(treated, controls, h, field) {
  const v = OUT[h][field];
  _ts.fill(0); _tn.fill(0); _cs.fill(0); _cn.fill(0);
  for (let k = 0; k < treated.length; k++) { const i = treated[k]; const s = strata[i]; if (s < 0 || !Number.isFinite(v[i])) continue; _ts[s] += v[i]; _tn[s]++; }
  for (let k = 0; k < controls.length; k++) { const i = controls[k]; const s = strata[i]; if (s < 0 || !Number.isFinite(v[i])) continue; _cs[s] += v[i]; _cn[s]++; }
  let num = 0, den = 0, unmatched = 0;
  for (let s = 0; s < NS; s++) {
    if (!_tn[s]) continue;
    if (_cn[s] < 5) { unmatched += _tn[s]; continue; }
    num += _tn[s] * (_ts[s] / _tn[s] - _cs[s] / _cn[s]);
    den += _tn[s];
  }
  return { effect: den ? num / den : NaN, matched: den, unmatched };
}

// Treated resampled as whole episodes; controls resampled in 4-day blocks so
// their serial correlation is not mistaken for independent evidence.
function bootCI(treated, controlPool, h, field) {
  const out = [];
  for (let b = 0; b < BOOT; b++) {
    const T = Array.from({ length: treated.length }, () => treated[(rnd() * treated.length) | 0]);
    const C = [];
    while (C.length < controlPool.length) {
      const s = (rnd() * controlPool.length) | 0;
      for (let k = 0; k < CTRL_BLOCK && C.length < controlPool.length; k++) C.push(controlPool[(s + k) % controlPool.length]);
    }
    const e = stratified(T, C, h, field).effect;
    if (Number.isFinite(e)) out.push(e);
  }
  out.sort((a, b) => a - b);
  return out.length ? { lo: out[Math.floor(0.025 * out.length)], hi: out[Math.floor(0.975 * out.length)] } : { lo: NaN, hi: NaN };
}

// ---------- report ----------
const results = [];
function analyse(title, treatedPred, controlPred, horizons, fields, note, withTrend = true) {
  strata = ST[withTrend].arr;
  console.log(`\n${'='.repeat(104)}\n${title}\n${'='.repeat(104)}`);
  if (note) console.log(`  ${note}`);
  const maxH = Math.max(...horizons.map((k) => H[k]));
  const treated = entries(treatedPred).filter((i) => valid(i, maxH));
  const control = [];
  for (let i = 0; i < n; i++) if (controlPred(i) && !treatedPred(i) && valid(i, maxH)) control.push(i);

  const dev = treated.filter((i) => bars[i].t < SPLIT), val = treated.filter((i) => bars[i].t >= SPLIT);
  console.log(`  treated episodes ${treated.length}  (dev ${dev.length} / val ${val.length})   control bars ${control.length}`);
  if (treated.length < 5) { console.log('  too few episodes to analyse'); return; }

  console.log(`\n  ${'outcome'.padEnd(22)}${'treated'.padStart(10)}${'control'.padStart(10)}${'diff'.padStart(9)}${'95% CI'.padStart(18)}${'trimmed'.padStart(10)}${'dev'.padStart(8)}${'val'.padStart(8)}  agree`);
  for (const hk of horizons) {
    for (const f of fields) {
      const h = H[hk];
      const st = stratified(treated, control, h, f);
      const ci = bootCI(treated, control, h, f);
      const tv = treated.map((i) => outcome(i, h)[f]), cv = control.map((i) => outcome(i, h)[f]);
      const trimmed = trimMean(tv) - trimMean(cv);
      const d = dev.length >= 3 ? stratified(dev, control.filter((i) => bars[i].t < SPLIT), h, f).effect : NaN;
      const v = val.length >= 3 ? stratified(val, control.filter((i) => bars[i].t >= SPLIT), h, f).effect : NaN;
      const agree = Number.isFinite(d) && Number.isFinite(v) && Math.sign(d) === Math.sign(v);
      const fmt = f === 'cont' ? pp : f.endsWith('Raw') ? pc : f2;
      console.log(`  ${(hk + ' ' + f).padEnd(22)}${fmt(mean(tv)).padStart(10)}${fmt(mean(cv)).padStart(10)}${fmt(st.effect).padStart(9)}${(`[${fmt(ci.lo)}, ${fmt(ci.hi)}]`).padStart(18)}${fmt(trimmed).padStart(10)}${fmt(d).padStart(8)}${fmt(v).padStart(8)}  ${agree ? 'yes' : 'NO'}`);
      results.push({ title, horizon: hk, field: f, effect: st.effect, lo: ci.lo, hi: ci.hi, trimmed, dev: d, val: v, agree, nT: treated.length, matched: st.matched, unmatched: st.unmatched });
    }
  }
  const last = results[results.length - 1];
  console.log(`\n  matched ${last.matched}/${treated.length} treated episodes into strata with >=5 controls (${last.unmatched} unmatched, dropped)`);
}

console.log('='.repeat(104));
console.log('DECISION UTILITY AUDIT — Market Intelligence v1');
console.log(`frozen hash ${hash}`);
console.log(`RETROSPECTIVE VALIDATION on ${n} bars ${new Date(bars[0].t).toISOString().slice(0, 10)} -> ${new Date(bars.at(-1).t).toISOString().slice(0, 10)}`);
console.log('This window has been examined repeatedly. It can eliminate Actions. It cannot prove one.');
console.log('='.repeat(104));

const bullish = (i) => bars[i].trend === 1 || bars[i].trend === 2;
const bearish = (i) => bars[i].trend === 4 || bars[i].trend === 5;

// ---- U1 ----
analyse('U1 — LEVERAGED RALLY vs matched bullish control.  Action under test: DO NOT CHASE',
  (i) => bars[i].market === 4, bullish, ['24h', '48h'], ['maeAtr', 'retAtr', 'cont'],
  'Does knowing a rally is derivatives-led add anything to knowing price already rose?');

// ---- U2 ----
analyse('U2 — RISK-OFF vs matched control.  Action under test: REDUCE EXPOSURE',
  (i) => bars[i].market === 10 || bars[i].market === 11, () => true, ['3D', '7D'], ['maeAtr', 'retAtr'],
  'RISK-OFF is derived from trend and volatility only — NO derivatives or on-chain data. Matching therefore excludes trend, because RISK-OFF IS the bearish trend read and a same-trend control cannot exist.', false);

analyse('U2b — plain 200-day MA filter vs the same control.  The price-only baseline RISK-OFF must beat',
  (i) => Number.isFinite(ma200d[i]) && close[i] < ma200d[i], () => true, ['3D', '7D'], ['maeAtr', 'retAtr'],
  'If this matches U2, the extra machinery in RISK-OFF earns nothing.', false);

// ---- U3 ----
analyse('U3 — SPOT-LED vs PERP-LED within a bullish trend.  Action under test: treat spot-led as higher quality',
  (i) => bars[i].part === 6 && bullish(i), (i) => bars[i].part === 7 && bullish(i), ['24h', '48h'], ['maeAtr', 'retAtr', 'cont'],
  'Control is PERP-LED, not "everything else" — the question is whether the distinction carries information.');

// ---- verdict ----
console.log(`\n${'='.repeat(104)}\nACCEPTANCE\n${'='.repeat(104)}`);
const THRESH = {
  'U1 — LEVERAGED RALLY vs matched bullish control.  Action under test: DO NOT CHASE': { field: 'maeAtr', need: -0.35, dir: -1, alt: { field: 'cont', need: -0.10, dir: -1 }, action: 'DO NOT CHASE' },
  'U2 — RISK-OFF vs matched control.  Action under test: REDUCE EXPOSURE': { field: 'maeAtr', need: -0.50, dir: -1, action: 'REDUCE / RISK-OFF' },
  'U3 — SPOT-LED vs PERP-LED within a bullish trend.  Action under test: treat spot-led as higher quality': { field: 'maeAtr', need: 0.35, dir: 1, alt: { field: 'cont', need: 0.10, dir: 1 }, action: 'SPOT-LED quality claim' },
};
for (const [title, t] of Object.entries(THRESH)) {
  const rs = results.filter((r) => r.title === title);
  if (!rs.length) { console.log(`\n  ${t.action.padEnd(24)} NO DATA — cannot be tested`); continue; }
  const hit = (f, need, dir) => rs.filter((r) => r.field === f).some((r) => (dir < 0 ? r.effect <= need && r.hi < 0 : r.effect >= need && r.lo > 0));
  const c3 = hit(t.field, t.need, t.dir) || (t.alt ? hit(t.alt.field, t.alt.need, t.alt.dir) : false);
  const c1 = rs.filter((r) => r.field === t.field).every((r) => r.agree);
  const c4 = rs.filter((r) => r.field === t.field).every((r) => Math.sign(r.trimmed) === Math.sign(r.effect));
  const c5 = rs[0].nT >= 30;
  console.log(`\n  ${t.action}`);
  console.log(`    1. dev/validation direction agrees   ${c1 ? 'PASS' : 'FAIL'}`);
  console.log(`    3. economic threshold met with CI    ${c3 ? 'PASS' : 'FAIL'}  (need ${t.field} ${t.dir < 0 ? '<=' : '>='} ${t.need}${t.alt ? ` or ${t.alt.field} ${t.alt.dir < 0 ? '<=' : '>='} ${t.alt.need}` : ''})`);
  console.log(`    4. not driven by extremes            ${c4 ? 'PASS' : 'FAIL'}`);
  console.log(`    5. >= 30 independent episodes        ${c5 ? 'PASS' : 'FAIL'}  (${rs[0].nT})`);
  console.log(`    => ACTION ${c1 && c3 && c4 && c5 ? 'SUPPORTED (retrospective only)' : 'NOT SUPPORTED — delete'}`);
}
