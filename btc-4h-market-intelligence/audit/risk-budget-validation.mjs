// RETROSPECTIVE RISK-CONTROL VALIDATION — BTC 4H Market Radar risk budget
//
// ============================================================================
// RESULT: REJECTED. THE MODULE IS NOT IN main.pine AND MUST NOT BE ADDED BACK.
//
// Six of the seven pre-registered gates passed. G1 — the coefficient of
// variation of rolling 24H realised volatility — improved by 3.3% against a
// requirement of 10%. The pre-registration below says all seven, so the rule
// is not adopted, the floor is not moved, the reference window is not changed,
// and the 10% is not lowered to 3%. This file is kept as the record of a
// negative result, not as a work in progress.
//
// It is self-contained on purpose: it reads only rvol30, which is an existing
// audited measurement that main.pine still plots as a test hook, and applies
// the frozen specification in JavaScript. So it re-runs and reproduces this
// verdict even though the Pine implementation has been deleted.
//
// ONE OBSERVATION, RECORDED AND NOT ACTED ON: a 6-bar standard deviation is a
// very noisy estimator, and its coefficient of variation is dominated by
// sampling error rather than by the volatility regime, which is a plausible
// reason a rule scaled off a 30-bar volatility cannot move it much — the 42-bar
// measure, with far less estimation noise, improved 14.8%. That is a HYPOTHESIS
// FOR A SEPARATELY PRE-REGISTERED TEST. It is not grounds to overturn this one,
// because an argument constructed after seeing which gate failed is exactly the
// thing pre-registration exists to disallow.
// ============================================================================
//
// THIS IS NOT AN OUT-OF-SAMPLE ALPHA PROOF AND NOTHING HERE MAY BE CITED AS ONE.
// It is a retrospective measurement, on the same history the rule will be used
// on, of one question and one question only:
//
//     Does scaling exposure by referenceVol / currentVol make the RISK ACTUALLY
//     CARRIED more stable than holding a constant nominal position?
//
// It does not ask whether that is profitable. There is no return in this file,
// no Sharpe ratio, no drawdown-of-equity, no hit rate, no profit factor. Adding
// one later would not extend this audit, it would replace it with a different
// and much weaker one — the previous three rounds of research in
// ../../btc-4h-regime-engine/RESEARCH-LOG.md all failed precisely because a
// risk claim was validated with a return metric.
//
// ============================================================================
// PRE-REGISTRATION — written and committed BEFORE the first run of this file.
// ============================================================================
//
// SPECIFICATION UNDER TEST (frozen; copied verbatim from main.pine section 5b):
//     currentVol   = rvol30                         30-bar realised volatility,
//                                                   annualised. Already in the
//                                                   indicator, already audited.
//     referenceVol = median(rvol30, 2190 bars)      2190 bars = 365 days at 4H
//     riskMult     = clamp(referenceVol / currentVol, 0.25, 1.00)
//
// The floor (0.25) and the reference window (2190) were chosen a priori — 1/4
// and one calendar year — and are NOT swept here. If the rule only works at
// some other floor, the rule does not work.
//
// EXPOSURE CONVENTION (no lookahead):
//     the multiplier computed at the close of bar t-1 is applied to the return
//     realised over bar t. A multiplier that used bar t's own volatility to
//     scale bar t's own return would be reading the answer.
//
// ARMS:
//     A  CONSTANT      exposure = 1.00 on every bar
//     B  SCALED        exposure = riskMult[t-1]
//     C  FLAT-CONTROL  exposure = mean(riskMult), constant   <-- FALSIFICATION
//
// Arm C is the reason the primary metric is a COEFFICIENT OF VARIATION rather
// than a level. A CV is scale-free, so simply taking smaller size cannot move
// it. If arm B beats arm A on CV but arm C also does, the metric is broken and
// the result means nothing. Arm C is expected to score essentially identically
// to arm A on G1 and G2, and that expectation is part of the pre-registration.
//
// ADOPTION GATES — all six must pass. Fixed before the first run.
//     G1  CV of rolling 24H realised volatility falls by >= 10% vs CONSTANT
//     G2  CV of rolling  7D realised volatility falls by >= 10% vs CONSTANT
//     G3  99th-percentile adverse 24H move does not increase vs CONSTANT
//     G4  worst (maximum) rolling 7D realised volatility falls by >= 20%
//     G5  average exposure >= 0.50
//         — without this, "risk is more stable" can be bought by simply not
//           being in the market, which is not a risk-scaling rule.
//     G6  turnover (mean |exposure change| per 4H bar) <= 0.05
//         — a rule that rebalances violently costs more to run than the risk
//           stability is worth.
//     G7  arm C must FAIL G1 and G2, confirming the metric measures stability
//         and not size.
//
// IF ANY GATE FAILS, THE RISK BUDGET MODULE IS DELETED FROM main.pine.
// It is not re-tuned, the floor is not moved, the window is not changed, and
// the gates are not relaxed. That is the entire point of writing them down
// first.
//
// Run:  node audit/risk-budget-validation.mjs [bars]
// ============================================================================

import { PineTS, BaseProvider } from 'pinets';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const RAW = readFileSync(new URL('../main.pine', import.meta.url), 'utf8');
const HASH = createHash('sha256').update(RAW).digest('hex');

// Same two PineTS-only rewrites the test suite applies, for the same reasons.
let SRC = RAW
  .replace(/if not tfOK\n\s+runtime\.error\([^\n]*\n/, '')
  .replace(/\[perpUp, perpDn\] = request\.security_lower_tf\([^\n]*\n\[spotUp, spotDn\] = request\.security_lower_tf\([^\n]*\n/,
    'perpUp = array.new<float>(0)\nperpDn = array.new<float>(0)\nspotUp = array.new<float>(0)\nspotDn = array.new<float>(0)\n');

const all = JSON.parse(readFileSync(new URL('../../btc-4h-regime-engine/data/cache/btc-4h.json', import.meta.url), 'utf8'));
const N = +(process.argv[2] ?? all.length);
const rows = all.slice(-N);

const H4 = 4 * 3600_000;
const bar = (t, o, h, l, c, v) => ({
  openTime: t, open: o, high: h, low: l, close: c, volume: v, closeTime: t + H4 - 1,
  quoteAssetVolume: v * c, numberOfTrades: 1, takerBuyBaseAssetVolume: v / 2, takerBuyQuoteAssetVolume: (v / 2) * c, ignore: '0',
});
const flat = (t, x) => bar(t, x, x, x, x, 0);
const series = {
  'BTCUSDT.P': rows.map((r) => bar(r.t, r.open, r.high, r.low, r.close, r.volume)),
  'BTCUSDT': rows.map((r) => bar(r.t, r.spotOpen ?? r.open, r.spotHigh ?? r.high, r.spotLow ?? r.low, r.spotClose ?? r.close, r.spotVolume ?? r.volume)),
  'BTCUSDT.P_OI': rows.map((r) => flat(r.t, r.oi)),
};
const provider = new (class extends BaseProvider {
  constructor() { super({ requiresApiKey: false, providerName: 'Local' }); }
  getSupportedTimeframes() { return new Set(['240', '60']); }
  async _getMarketDataNative(id) { return series[String(id).split(':').pop()] ?? []; }
  async getSymbolInfo(id) {
    const isOI = String(id).includes('_OI');
    return { ticker: id, name: id, type: 'crypto', currency: isOI ? 'NONE' : 'USDT', basecurrency: 'BTC', timezone: 'Etc/UTC', minmov: 1, pricescale: 100 };
  }
})();

const ser = (ctx, k) => (ctx.plots?.[k]?.data ?? []).map((d) => (d && typeof d === 'object' ? d.value : d)).map((v) => (v == null ? NaN : v));

// ---------------------------------------------------------------- statistics
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
const quant = (a, q) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * q; const lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo); };
// Rolling realised volatility of an exposure-weighted return stream: the
// standard deviation of the last `w` bar returns. This is the quantity the risk
// budget claims to stabilise, measured on what was actually carried.
const rollVol = (pnl, w) => {
  const out = [];
  for (let i = w - 1; i < pnl.length; i++) out.push(sd(pnl.slice(i - w + 1, i + 1)));
  return out;
};
// Rolling cumulative move over `w` bars — the "how bad was the worst day"
// quantity, as opposed to the "how variable was risk" quantity above.
const rollSum = (pnl, w) => {
  const out = [];
  for (let i = w - 1; i < pnl.length; i++) out.push(pnl.slice(i - w + 1, i + 1).reduce((s, x) => s + x, 0));
  return out;
};

const W24 = 6;    // 24 hours at 4H
const W7D = 42;   // 7 days at 4H

function measure(name, exposure, ret) {
  const pnl = exposure.map((e, i) => e * ret[i]);
  const v24 = rollVol(pnl, W24);
  const v7 = rollVol(pnl, W7D);
  const c24 = rollSum(pnl, W24);
  const adverse = c24.map((x) => -x);           // positive = a move against the position
  const dTurn = exposure.slice(1).map((e, i) => Math.abs(e - exposure[i]));
  return {
    name,
    cv24: sd(v24) / mean(v24),
    cv7: sd(v7) / mean(v7),
    maxV7: Math.max(...v7),
    p95: quant(adverse, 0.95),
    p99: quant(adverse, 0.99),
    down5: quant(c24, 0.05),
    meanExp: mean(exposure),
    turnover: mean(dTurn),
    meanV24: mean(v24),
  };
}

// -------------------------------------------------------------------- run it
console.log('='.repeat(98));
console.log('RETROSPECTIVE RISK-CONTROL VALIDATION — risk budget');
console.log('NOT an out-of-sample alpha proof. No return, Sharpe or profit metric appears in this file.');
console.log('='.repeat(98) + '\n');

const ctx = await new PineTS(provider, 'BTCUSDT.P', '240', rows.length).run(SRC);
const curV = ser(ctx, 't_rvol30');
const close = rows.map((r) => r.close);

// THE FROZEN SPECIFICATION, implemented here rather than in Pine so that this
// audit keeps reproducing after the rejected module was removed from main.pine.
// rvol30 comes from the indicator; everything below is the rule under test.
const REF_LEN = 2190;      // 365 days at 4H
const FLOOR = 0.25;        // 1/4
const CAP = 1.00;          // never leverage up on low volatility
const refV = new Array(curV.length).fill(NaN);
const mult = new Array(curV.length).fill(NaN);
{
  const buf = [];
  for (let i = 0; i < curV.length; i++) {
    if (Number.isFinite(curV[i])) buf.push({ i, v: curV[i] }); else buf.push({ i, v: NaN });
    const win = [];
    for (let j = Math.max(0, i - REF_LEN + 1); j <= i; j++) if (Number.isFinite(curV[j])) win.push(curV[j]);
    // ta.median needs the full window before it returns anything, and so does
    // this: a "one year baseline" computed from four months is a different rule.
    if (win.length < REF_LEN) continue;
    win.sort((a, b) => a - b);
    const m = win.length % 2 ? win[(win.length - 1) / 2] : (win[win.length / 2 - 1] + win[win.length / 2]) / 2;
    refV[i] = m;
    if (Number.isFinite(curV[i]) && curV[i] > 0) mult[i] = Math.min(CAP, Math.max(FLOOR, m / curV[i]));
  }
}

// Usable bars: the multiplier from the PREVIOUS close exists, and this bar has
// a return. That offset is the no-lookahead rule, in one line.
const idx = [];
for (let i = 1; i < rows.length; i++) {
  if (Number.isFinite(mult[i - 1]) && close[i] > 0 && close[i - 1] > 0) idx.push(i);
}
if (idx.length < 500) {
  console.log(`❌ only ${idx.length} usable bars — the 2190-bar reference window needs about a year of history before the rule exists at all.`);
  process.exit(1);
}
const ret = idx.map((i) => Math.log(close[i] / close[i - 1]));
const mScaled = idx.map((i) => mult[i - 1]);
const mConst = idx.map(() => 1.0);
const flatLevel = mean(mScaled);
const mFlat = idx.map(() => flatLevel);

const A = measure('A CONSTANT', mConst, ret);
const B = measure('B SCALED', mScaled, ret);
const C = measure('C FLAT-CONTROL', mFlat, ret);

console.log(`bars ${idx.length}   ${new Date(rows[idx[0]].t).toISOString().slice(0, 10)} -> ${new Date(rows[idx.at(-1)].t).toISOString().slice(0, 10)}`);
console.log(`indicator sha256 ${HASH.slice(0, 12)}`);
console.log(`reference vol (median rvol30, 2190 bars) last = ${refV.at(-1)?.toFixed(4)}   current rvol30 last = ${curV.at(-1)?.toFixed(4)}   multiplier last = ${mult.at(-1)?.toFixed(3)}\n`);

const pad = (s, n) => String(s).padEnd(n);
const num = (x, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a').padStart(9);
console.log(pad('ARM', 16) + ['CV 24H vol', 'CV 7D vol', 'max 7D vol', 'p95 adv', 'p99 adv', '5% down', 'avg exp', 'turnover'].map((h) => h.padStart(11)).join(''));
for (const m of [A, B, C]) {
  console.log(pad(m.name, 16) + [m.cv24, m.cv7, m.maxV7, m.p95, m.p99, m.down5, m.meanExp, m.turnover].map((x) => num(x).padStart(11)).join(''));
}

const rel = (b, a) => (a - b) / a;   // fractional improvement of b over a
const g = [];
g.push(['G1', `CV of rolling 24H realised vol falls >= 10%`, rel(B.cv24, A.cv24) >= 0.10, `${(rel(B.cv24, A.cv24) * 100).toFixed(1)}%`]);
g.push(['G2', `CV of rolling 7D realised vol falls >= 10%`, rel(B.cv7, A.cv7) >= 0.10, `${(rel(B.cv7, A.cv7) * 100).toFixed(1)}%`]);
g.push(['G3', `99th-pct adverse 24H move does not increase`, B.p99 <= A.p99, `${B.p99.toFixed(4)} vs ${A.p99.toFixed(4)}`]);
g.push(['G4', `worst rolling 7D realised vol falls >= 20%`, rel(B.maxV7, A.maxV7) >= 0.20, `${(rel(B.maxV7, A.maxV7) * 100).toFixed(1)}%`]);
g.push(['G5', `average exposure >= 0.50`, B.meanExp >= 0.50, B.meanExp.toFixed(3)]);
g.push(['G6', `turnover <= 0.05 per 4H bar`, B.turnover <= 0.05, B.turnover.toFixed(4)]);
g.push(['G7', `FALSIFICATION: flat control fails G1 and G2`, rel(C.cv24, A.cv24) < 0.10 && rel(C.cv7, A.cv7) < 0.10,
  `control CV moves ${(rel(C.cv24, A.cv24) * 100).toFixed(1)}% / ${(rel(C.cv7, A.cv7) * 100).toFixed(1)}%`]);

console.log('\nPRE-REGISTERED ADOPTION GATES');
for (const [id, desc, ok, val] of g) console.log(`  ${ok ? '✅' : '❌'} ${id}  ${pad(desc, 46)} ${val}`);

const passed = g.every(([, , ok]) => ok);
console.log('\n' + '='.repeat(98));
if (passed) {
  console.log('VERDICT: ADOPTED — the volatility-scaled arm stabilises realised risk on every pre-registered gate,');
  console.log('and the flat control does not, so the improvement is stability and not smaller size.');
} else {
  console.log('VERDICT: REJECTED — the risk budget module is NOT in main.pine. Do not re-tune the floor,');
  console.log('the window, or the gates. The gates were written before this run for exactly this outcome.');
  console.log(`Passed ${g.filter(([, , ok]) => ok).length} of ${g.length}; failing: ${g.filter(([, , ok]) => !ok).map(([id]) => id).join(', ')}.`);
}
console.log('\nThis is a RETROSPECTIVE RISK-CONTROL VALIDATION on the same history the rule is used on.');
console.log('It says nothing about returns, and it is not evidence that the rule improves any decision');
console.log('other than "how much of a position you had already decided to take should you carry".');
process.exit(passed ? 0 : 1);
