// GATE TEST — run this before writing a single line of Pine Script.
//
// The BTC 4H Regime & Pullback Engine design rests on one claim:
//
//   "A pullback where open interest FALLS (healthy deleveraging) resolves
//    differently from a pullback where open interest RISES (new short build)."
//
// A literature review across SSRN/arXiv, Glassnode, CryptoQuant, Kaiko,
// Amberdata and CoinGlass found NO published test of this. It is asserted by
// vendors and narrated after the fact, never scored. So we score it.
//
// If the two forward-return distributions overlap, the premise is gone and the
// rest of the design is a trend follower with expensive decoration. Published
// base rate for those on single-asset BTC is ~0.8 net Sharpe, reachable with an
// EMA cross.
//
// ============================================================================
// PRE-REGISTERED — written before the first run, not edited afterwards.
// ============================================================================
//
// EVENT. Over a 30-bar (5-day) lookback ending at bar i, let peak = the highest
// high and peakBar its index. Bar i is a pullback event iff
//     close[i] <= peak * (1 - D)
// and no event has fired in the preceding 30 bars. Spacing 30 > max horizon 24,
// so forward windows never overlap and the bootstrap is not inflated.
//
// GROUPING. oiChg = (oi[i] - oi[peakBar]) / oi[peakBar], on COIN-DENOMINATED
// open interest. USD-denominated OI rises with price even when no contract is
// opened, so a z-score on it is a lagged price transform wearing a positioning
// costume. USD is run separately below purely as a contamination control.
//     group A "deleveraging" : oiChg < 0
//     group B "leveraging"   : oiChg > 0
//
// PRIMARY POPULATION. Uptrend only: close[peakBar] > EMA200[peakBar]. This is
// the design's actual claim (spec §21 runs the pullback engine only in a bull
// regime). All-pullbacks is reported as a robustness arm, not as the test.
//
// OUTCOME. Forward return (close[i+h] - close[i]) / close[i] at
// h = 3, 6, 12, 24 bars = 12h, 24h, 48h, 96h.
//
// DIRECTION. The thesis predicts A > B. A significant result with the sign
// REVERSED is a failure of the design as written, not a discovery to re-label.
//
// PASS requires ALL of:
//   1. n >= 30 in each group at the primary threshold D = 0.05
//   2. mean(A) - mean(B) > 0 at >= 2 of the 4 horizons
//   3. the 95% bootstrap CI of that difference excludes 0 at those horizons
//   4. the sign stays positive across D in {0.03, 0.05, 0.08, 0.12}
//      — one threshold working while its neighbours do not is a search artifact
//
// Anything less is a FAIL. A FAIL is a successful outcome for this script: it
// costs one afternoon and saves the weeks that §39-45 of the design would take.
// ============================================================================

import { readFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync(new URL('../data/cache/btc-4h.json', import.meta.url), 'utf8'));

const LOOKBACK = 30;
const SPACING = 30;
const HORIZONS = [3, 6, 12, 24];
const THRESHOLDS = [0.03, 0.05, 0.08, 0.12];
const PRIMARY_D = 0.05;
const BOOT = 10000;

// Deterministic PRNG — a bootstrap that moves between runs cannot be audited.
let _s = 0x2f6e2b1;
const rnd = () => {
  _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; _s |= 0;
  return (_s >>> 0) / 4294967296;
};

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];

// EMA200 on 4H close, for the bull-regime filter.
const ema = (vals, n) => {
  const k = 2 / (n + 1);
  const out = new Array(vals.length);
  let e = vals[0];
  for (let i = 0; i < vals.length; i++) { e = i ? vals[i] * k + e * (1 - k) : vals[0]; out[i] = e; }
  return out;
};
const ema200 = ema(rows.map((r) => r.close), 200);

// Collect non-overlapping pullback events at a given drawdown threshold.
function events(D) {
  const out = [];
  let last = -Infinity;
  for (let i = LOOKBACK; i < rows.length - Math.max(...HORIZONS); i++) {
    if (i - last < SPACING) continue;
    let peak = -Infinity, peakBar = -1;
    for (let j = i - LOOKBACK; j < i; j++) if (rows[j].high > peak) { peak = rows[j].high; peakBar = j; }
    if (rows[i].close > peak * (1 - D)) continue;
    if (rows[peakBar].oi == null || rows[i].oi == null) continue;
    last = i;
    out.push({
      i,
      peakBar,
      uptrend: rows[peakBar].close > ema200[peakBar],
      oiChg: (rows[i].oi - rows[peakBar].oi) / rows[peakBar].oi,
      oiUsdChg: (rows[i].oiValue - rows[peakBar].oiValue) / rows[peakBar].oiValue,
      fwd: Object.fromEntries(HORIZONS.map((h) => [h, (rows[i + h].close - rows[i].close) / rows[i].close])),
      date: new Date(rows[i].t).toISOString().slice(0, 10),
    });
  }
  return out;
}

// Bootstrap CI on the difference of means. Resamples each group independently.
function bootDiff(a, b) {
  const diffs = new Array(BOOT);
  for (let k = 0; k < BOOT; k++) {
    let sa = 0, sb = 0;
    for (let i = 0; i < a.length; i++) sa += a[(rnd() * a.length) | 0];
    for (let i = 0; i < b.length; i++) sb += b[(rnd() * b.length) | 0];
    diffs[k] = sa / a.length - sb / b.length;
  }
  diffs.sort((x, y) => x - y);
  return { lo: quantile(diffs, 0.025), hi: quantile(diffs, 0.975) };
}

const pct = (x) => (x * 100).toFixed(2) + '%';

// One split: report both groups at every horizon, with CI on the difference.
function report(evs, splitKey, label) {
  const A = evs.filter((e) => e[splitKey] < 0);
  const B = evs.filter((e) => e[splitKey] > 0);
  console.log(`\n  ${label}   deleveraging n=${A.length}  leveraging n=${B.length}`);
  if (A.length < 10 || B.length < 10) { console.log('    too few events'); return null; }
  const res = {};
  console.log('    horizon |  deleverage mean/med |  leverage mean/med |      diff |        95% CI | excl 0');
  for (const h of HORIZONS) {
    const a = A.map((e) => e.fwd[h]);
    const b = B.map((e) => e.fwd[h]);
    const d = mean(a) - mean(b);
    const { lo, hi } = bootDiff(a, b);
    const sig = lo > 0 || hi < 0;
    res[h] = { d, lo, hi, sig, nA: a.length, nB: b.length };
    console.log(
      `    ${String(h * 4 + 'h').padStart(7)} | ${pct(mean(a)).padStart(8)} ${pct(median(a)).padStart(8)} | ${pct(mean(b)).padStart(8)} ${pct(median(b)).padStart(8)} | ${pct(d).padStart(9)} | ${pct(lo).padStart(6)} ${pct(hi).padStart(6)} | ${sig ? (d > 0 ? 'YES +' : 'YES -') : 'no'}`,
    );
  }
  return res;
}

console.log('='.repeat(100));
console.log('GATE TEST — does a deleveraging pullback resolve differently from a leveraging one?');
console.log(`data: ${rows.length} 4H bars  ${new Date(rows[0].t).toISOString().slice(0, 10)} -> ${new Date(rows.at(-1).t).toISOString().slice(0, 10)}`);
console.log('='.repeat(100));

// ---- primary test, and criterion 4 across thresholds ----
const primary = {};
for (const D of THRESHOLDS) {
  const evs = events(D);
  const up = evs.filter((e) => e.uptrend);
  console.log(`\n${'-'.repeat(100)}\nD = ${pct(D)} drawdown from 30-bar high — ${evs.length} events (${up.length} in uptrend)`);
  primary[D] = report(up, 'oiChg', 'UPTREND, coin-denom OI  [PRIMARY]');
  if (D === PRIMARY_D) {
    report(evs, 'oiChg', 'ALL regimes, coin-denom OI  [robustness]');
    report(up, 'oiUsdChg', 'UPTREND, USD-denom OI  [contamination control]');
  }
}

// ---- verdict against the pre-registered criterion ----
console.log(`\n${'='.repeat(100)}\nVERDICT vs pre-registered criterion\n${'='.repeat(100)}`);
const p = primary[PRIMARY_D];
const c1 = p && p[HORIZONS[0]].nA >= 30 && p[HORIZONS[0]].nB >= 30;
const posH = p ? HORIZONS.filter((h) => p[h].d > 0) : [];
const c2 = posH.length >= 2;
const sigPos = p ? HORIZONS.filter((h) => p[h].d > 0 && p[h].lo > 0) : [];
const c3 = sigPos.length >= 2;
const signs = THRESHOLDS.map((D) => (primary[D] ? HORIZONS.filter((h) => primary[D][h].d > 0).length >= 2 : false));
const c4 = signs.every(Boolean);

console.log(`  1. n >= 30 per group at D=5%                    ${c1 ? 'PASS' : 'FAIL'}  (${p ? `${p[3].nA} / ${p[3].nB}` : 'n/a'})`);
console.log(`  2. diff > 0 at >= 2 horizons                    ${c2 ? 'PASS' : 'FAIL'}  (positive at ${posH.length}/4: ${posH.map((h) => h * 4 + 'h').join(',') || 'none'})`);
console.log(`  3. bootstrap CI excludes 0, positive, >= 2      ${c3 ? 'PASS' : 'FAIL'}  (${sigPos.length}/4: ${sigPos.map((h) => h * 4 + 'h').join(',') || 'none'})`);
console.log(`  4. sign stable across all 4 thresholds          ${c4 ? 'PASS' : 'FAIL'}  (${THRESHOLDS.map((D, i) => `${pct(D)}:${signs[i] ? '+' : '-'}`).join('  ')})`);

const pass = c1 && c2 && c3 && c4;
console.log(`\n  ${pass ? '>>> PASS — the premise survives. Proceed to build.' : '>>> FAIL — the premise is not supported by six years of BTC 4H data.'}`);
if (!pass) {
  console.log('      Do not re-tune the event definition to make this pass. Re-tuning after');
  console.log('      seeing the result IS the overfitting this test exists to prevent.');
}
