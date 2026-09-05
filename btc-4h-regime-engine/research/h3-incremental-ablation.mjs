// H3 — bar-level incremental value. Does any layer pay for itself?
//
// H1 and H2 both died on sample size: six years of BTC hold only 79 independent
// uptrend pullback episodes, so any two-way split needs an effect >2.4% to
// resolve and nothing observed exceeded 1.4%. The event-study route is closed.
//
// H3 asks a different question with 166x the data: across all 13,164 bars, does
// adding a layer improve risk-adjusted outcomes over the model without it?
//
// ============================================================================
// PRE-REGISTERED — fixed before the first run.
// ============================================================================
//
// EVALUATION. Long/flat, one unit or nothing. Signal computed at bar close,
// position held from the NEXT bar (one-bar lag, close-to-close). Costs 0.05%
// per side charged on every position change, 0.10% round trip. No stops, no
// targets, no position sizing — those are separate hypotheses and folding them
// in here would destroy attribution.
//
// NO-LOOKAHEAD. Pivots publish only at confirmation (p + rightbars), never
// backdated. OI/funding are last-value-at-or-before-bar-close by construction of
// the dataset. Z-scores use trailing windows only. Signal lag is one full bar.
//
// LAYERS. Each adds exactly one thing to the layer below.
//   A  structure + EMA          bull structure AND close>EMA200 AND EMA50>EMA200
//   B  A + B-Xtrender           AND T3(BX) rising
//   C  B + open interest        AND oiZ < +1.5     veto crowded leverage
//   D  C + taker flow           AND takerZ > -1.5  veto aggressive-sell pressure
//   E  D + funding              AND fundingZ < +1.5 veto crowded longs
//
// The C/D/E vetoes are RISK-OFF filters, not direction calls. This is the only
// use of derivatives data the evidence supports: practitioners agree open
// interest signals cascade potential in both directions (a second-moment
// variable); nobody has shown it predicts direction. Thresholds are the
// original spec's own +/-1.5 z, reused rather than invented, so there is
// nothing here that was tuned. Z-scores use a 180-bar (30-day) trailing window,
// also the spec's own choice.
//
// REFERENCES. Buy & hold, EMA alone, structure alone, B-Xtrender alone.
// Nothing is assumed to work, including structure and EMA.
//
// ROBUSTNESS ARM. B-Xtrender is EMA5-EMA20 (a MACD line) -> RSI -> T3, a
// deterministic function of close that cannot contain information beyond price.
// Layer B is therefore run a second time with plain MACD histogram > 0
// substituted. If results differ materially, that difference is overfit to
// B-Xtrender's 5/20/15+T3 parameterisation, not a discovery.
//
// SPLITS. Holdout is locked before any model is fitted and read once.
//   development 2020-09 -> 2023-12   free experimentation
//   validation  2024-01 -> 2025-06   layer selection happens HERE
//   holdout     2025-07 -> 2026-09   read once, confirms or kills
//
// KEEP CRITERION for a layer, decided on VALIDATION only:
//   Sharpe improves by >= 0.15 over the layer below, OR
//   max drawdown improves by >= 5 percentage points without Sharpe falling.
// Then the holdout must agree in direction. A layer failing either is DELETED,
// not kept for dashboard completeness.
//
// PRIMARY METRIC: net Sharpe after costs. Secondary: max drawdown, profit
// factor excluding the top 5% of winners (fat tails make raw PF a lie),
// expectancy, exposure, bad-entry rate.
// ============================================================================

import { readFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync(new URL('../data/cache/btc-4h.json', import.meta.url), 'utf8'));
const n = rows.length;
const close = rows.map((r) => r.close);
const high = rows.map((r) => r.high);
const low = rows.map((r) => r.low);

const FEE = 0.0005;              // per side
const BARS_PER_YEAR = 6 * 365;
const Z_WIN = 180;
const Z_LIM = 1.5;
const PIVOT_L = 3, PIVOT_R = 2;

const SPLITS = {
  development: [Date.parse('2020-09-01T00:00:00Z'), Date.parse('2024-01-01T00:00:00Z')],
  validation: [Date.parse('2024-01-01T00:00:00Z'), Date.parse('2025-07-01T00:00:00Z')],
  holdout: [Date.parse('2025-07-01T00:00:00Z'), Infinity],
};

// ---------- indicators ----------
const ema = (v, p) => { const k = 2 / (p + 1); let e = v[0]; return v.map((x, i) => (e = i ? x * k + e * (1 - k) : x)); };

// Wilder RSI, tolerant of a negative-valued input series.
function rsi(v, p) {
  const out = new Array(v.length).fill(NaN);
  let ag = 0, al = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    const g = Math.max(d, 0), l = Math.max(-d, 0);
    if (i <= p) { ag += g / p; al += l / p; if (i === p) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
    else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  }
  return out;
}

// Tillson T3, volume factor 0.7
function t3(v, p, a = 0.7) {
  const e1 = ema(v, p), e2 = ema(e1, p), e3 = ema(e2, p), e4 = ema(e3, p), e5 = ema(e4, p), e6 = ema(e5, p);
  const c1 = -(a ** 3), c2 = 3 * a * a + 3 * a ** 3, c3 = -6 * a * a - 3 * a - 3 * a ** 3, c4 = 1 + 3 * a + a ** 3 + 3 * a * a;
  return v.map((_, i) => c1 * e6[i] + c2 * e5[i] + c3 * e4[i] + c4 * e3[i]);
}

// Trailing z-score. Window ends at i inclusive — no future data.
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

const ema50 = ema(close, 50), ema200 = ema(close, 200);

// B-Xtrender: RSI(EMA5 - EMA20, 15) - 50, T3-smoothed
const e5v = ema(close, 5), e20v = ema(close, 20);
const bxRaw = close.map((_, i) => e5v[i] - e20v[i]);
const bxShort = rsi(bxRaw, 15).map((x) => x - 50);
const bxT3 = t3(bxShort.map((x) => (Number.isFinite(x) ? x : 0)), 5);

// MACD histogram, the robustness substitute for B-Xtrender
const macdLine = close.map((_, i) => ema(close, 12)[i] - ema(close, 26)[i]);
const macdHist = macdLine.map((x, i) => x - ema(macdLine, 9)[i]);

// Market structure from CONFIRMED pivots only. A pivot at p becomes visible at
// p + PIVOT_R and not one bar earlier — this is where backtests usually cheat.
const bullStruct = new Array(n).fill(false);
{
  const ph = [], pl = [];       // confirmed pivots, in order
  let hi = 0, li = 0;           // how many are visible at bar i
  const isPH = (p) => { for (let j = p - PIVOT_L; j < p; j++) if (!(high[p] > high[j])) return false; for (let j = p + 1; j <= p + PIVOT_R; j++) if (!(high[p] > high[j])) return false; return true; };
  const isPL = (p) => { for (let j = p - PIVOT_L; j < p; j++) if (!(low[p] < low[j])) return false; for (let j = p + 1; j <= p + PIVOT_R; j++) if (!(low[p] < low[j])) return false; return true; };
  for (let p = PIVOT_L; p < n - PIVOT_R; p++) {
    if (isPH(p)) ph.push({ p, v: high[p], visible: p + PIVOT_R });
    if (isPL(p)) pl.push({ p, v: low[p], visible: p + PIVOT_R });
  }
  for (let i = 0; i < n; i++) {
    while (hi < ph.length && ph[hi].visible <= i) hi++;
    while (li < pl.length && pl[li].visible <= i) li++;
    if (hi >= 2 && li >= 2) {
      bullStruct[i] = ph[hi - 1].v > ph[hi - 2].v && pl[li - 1].v > pl[li - 2].v;
    }
  }
}

// Derivatives features — coin-denominated OI only. USD notional is banned:
// it is coin OI x price and therefore a lagged price transform (see H1).
const oiChg = rows.map((r, i) => (i && rows[i - 1].oi ? (r.oi - rows[i - 1].oi) / rows[i - 1].oi : 0));
const oiZ = zscore(oiChg, Z_WIN);
const takerImb = rows.map((r) => (r.volume > 0 ? (2 * r.takerBuyVolume) / r.volume - 1 : 0));
const takerZ = zscore(takerImb, Z_WIN);
const fundingZ = zscore(rows.map((r) => r.funding ?? 0), Z_WIN);

// ---------- models ----------
const emaBull = (i) => close[i] > ema200[i] && ema50[i] > ema200[i];
const bxUp = (i) => i > 0 && bxT3[i] > bxT3[i - 1];
const macdUp = (i) => macdHist[i] > 0;

const MODELS = {
  'buy & hold': () => true,
  'EMA only': emaBull,
  'structure only': (i) => bullStruct[i],
  'B-Xtrender only': bxUp,
  'A  structure+EMA': (i) => bullStruct[i] && emaBull(i),
  'B  A+BX': (i) => bullStruct[i] && emaBull(i) && bxUp(i),
  'C  B+OI veto': (i) => bullStruct[i] && emaBull(i) && bxUp(i) && !(oiZ[i] > Z_LIM),
  'D  C+taker veto': (i) => bullStruct[i] && emaBull(i) && bxUp(i) && !(oiZ[i] > Z_LIM) && !(takerZ[i] < -Z_LIM),
  'E  D+funding veto': (i) => bullStruct[i] && emaBull(i) && bxUp(i) && !(oiZ[i] > Z_LIM) && !(takerZ[i] < -Z_LIM) && !(fundingZ[i] > Z_LIM),
  "B' A+MACD [robustness]": (i) => bullStruct[i] && emaBull(i) && macdUp(i),
};

// ---------- backtest ----------
function run(signal, from, to) {
  const rets = [];
  const trades = [];
  let pos = 0, entry = null, eq = 1, peak = 1, dd = 0;
  const curve = [];
  for (let i = 1; i < n; i++) {
    if (rows[i].t < from || rows[i].t >= to) continue;
    const want = signal(i - 1) ? 1 : 0;      // one-bar lag: decided at close of i-1
    let r = pos * (close[i] / close[i - 1] - 1);
    if (want !== pos) r -= FEE;
    rets.push(r);
    eq *= 1 + r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, 1 - eq / peak);
    curve.push(eq);
    if (want === 1 && pos === 0) entry = { i, px: close[i], mae: 0 };
    if (entry) { entry.mae = Math.min(entry.mae, low[i] / entry.px - 1); }
    if (want === 0 && pos === 1 && entry) {
      trades.push({ ret: close[i] / entry.px - 1 - 2 * FEE, bars: i - entry.i, mae: entry.mae });
      entry = null;
    }
    pos = want;
  }
  if (!rets.length) return null;
  const m = rets.reduce((s, x) => s + x, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / rets.length);
  const dn = rets.filter((x) => x < 0);
  const dsd = dn.length ? Math.sqrt(dn.reduce((s, x) => s + x * x, 0) / dn.length) : 0;
  const wins = trades.filter((t) => t.ret > 0).map((t) => t.ret);
  const loss = trades.filter((t) => t.ret <= 0).map((t) => -t.ret);
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  // PF with the top 5% of winners removed — on fat-tailed 4H BTC a headline PF
  // can rest entirely on three trades.
  const wSort = [...wins].sort((a, b) => b - a);
  const wTrim = wSort.slice(Math.ceil(wSort.length * 0.05));
  return {
    ret: eq - 1,
    sharpe: sd ? (m / sd) * Math.sqrt(BARS_PER_YEAR) : 0,
    sortino: dsd ? (m / dsd) * Math.sqrt(BARS_PER_YEAR) : 0,
    maxDD: dd,
    pf: sum(loss) ? sum(wins) / sum(loss) : Infinity,
    pfTrim: sum(loss) ? sum(wTrim) / sum(loss) : Infinity,
    expectancy: trades.length ? sum(trades.map((t) => t.ret)) / trades.length : 0,
    trades: trades.length,
    exposure: rets.filter((_, k) => k > 0).length ? curve.length && rets.reduce((s, _, k) => s, 0) : 0,
    expo: (() => { let c = 0, p = 0; for (let i = 1; i < n; i++) { if (rows[i].t < from || rows[i].t >= to) continue; c++; if (signal(i - 1)) p++; } return p / c; })(),
    winRate: trades.length ? wins.length / trades.length : 0,
    badEntry: trades.length ? trades.filter((t) => t.mae < -0.05).length / trades.length : 0,
  };
}

const p2 = (x) => (x * 100).toFixed(1) + '%';
function table(period, [from, to]) {
  console.log(`\n${'='.repeat(118)}\n${period.toUpperCase()}   ${new Date(from).toISOString().slice(0, 10)} -> ${to === Infinity ? 'now' : new Date(to).toISOString().slice(0, 10)}\n${'='.repeat(118)}`);
  console.log('  model                    net ret  Sharpe  Sortino   maxDD      PF  PF-x5%   expect  trades   expo   win%  badEntry');
  const out = {};
  for (const [name, sig] of Object.entries(MODELS)) {
    const r = run(sig, from, to);
    out[name] = r;
    if (!r) { console.log(`  ${name.padEnd(24)} no data`); continue; }
    console.log(
      `  ${name.padEnd(24)}${p2(r.ret).padStart(8)}${r.sharpe.toFixed(2).padStart(8)}${r.sortino.toFixed(2).padStart(9)}${p2(r.maxDD).padStart(8)}${(r.pf === Infinity ? 'inf' : r.pf.toFixed(2)).padStart(8)}${(r.pfTrim === Infinity ? 'inf' : r.pfTrim.toFixed(2)).padStart(8)}${p2(r.expectancy).padStart(9)}${String(r.trades).padStart(8)}${p2(r.expo).padStart(7)}${p2(r.winRate).padStart(7)}${p2(r.badEntry).padStart(10)}`,
    );
  }
  return out;
}

console.log('='.repeat(118));
console.log('H3 — bar-level incremental ablation.  long/flat, 1-bar signal lag, 0.10% round trip');
console.log(`${n} bars  ${new Date(rows[0].t).toISOString().slice(0, 10)} -> ${new Date(rows.at(-1).t).toISOString().slice(0, 10)}`);
console.log('='.repeat(118));

const dev = table('development', SPLITS.development);
const val = table('validation  [layer selection happens here]', SPLITS.validation);

// ---------- selection on validation only ----------
console.log(`\n${'='.repeat(118)}\nLAYER DECISIONS — made on VALIDATION, before the holdout is read\n${'='.repeat(118)}`);
const CHAIN = [['A  structure+EMA', 'buy & hold'], ['B  A+BX', 'A  structure+EMA'], ['C  B+OI veto', 'B  A+BX'], ['D  C+taker veto', 'C  B+OI veto'], ['E  D+funding veto', 'D  C+taker veto']];
const keep = {};
for (const [layer, base] of CHAIN) {
  const a = val[layer], b = val[base];
  const dS = a.sharpe - b.sharpe, dD = b.maxDD - a.maxDD;
  const ok = dS >= 0.15 || (dD >= 0.05 && dS >= 0);
  keep[layer] = ok;
  console.log(`  ${layer.padEnd(22)} vs ${base.padEnd(20)}  dSharpe ${(dS >= 0 ? '+' : '') + dS.toFixed(2)}   dMaxDD ${(dD >= 0 ? '+' : '') + p2(dD)}   -> ${ok ? 'KEEP' : 'DELETE'}`);
}

const hold = table('holdout  [read once — confirms or kills, never re-tunes]', SPLITS.holdout);

console.log(`\n${'='.repeat(118)}\nHOLDOUT AGREEMENT\n${'='.repeat(118)}`);
for (const [layer, base] of CHAIN) {
  const vS = val[layer].sharpe - val[base].sharpe;
  const hS = hold[layer].sharpe - hold[base].sharpe;
  const agree = Math.sign(vS) === Math.sign(hS);
  console.log(`  ${layer.padEnd(22)} validation ${(vS >= 0 ? '+' : '') + vS.toFixed(2)}  holdout ${(hS >= 0 ? '+' : '') + hS.toFixed(2)}  ${agree ? 'agree' : 'DISAGREE'}${keep[layer] ? '' : '   (already deleted on validation)'}`);
}

console.log(`\n${'='.repeat(118)}\nROBUSTNESS: B-Xtrender vs plain MACD in layer B\n${'='.repeat(118)}`);
for (const [k, t] of [['development', dev], ['validation', val], ['holdout', hold]]) {
  console.log(`  ${k.padEnd(12)} BX Sharpe ${t['B  A+BX'].sharpe.toFixed(2)}   MACD Sharpe ${t["B' A+MACD [robustness]"].sharpe.toFixed(2)}   diff ${(t['B  A+BX'].sharpe - t["B' A+MACD [robustness]"].sharpe).toFixed(2)}`);
}
console.log('\n  A large gap here is not evidence B-Xtrender is better. It is a deterministic');
console.log('  function of close, so any gap is overfit to its 5/20/15+T3 parameterisation.');

// ---------- register every configuration whose Sharpe was computed ----------
// All 10 models x 3 splits count as trials, including the ones never seriously
// considered. Under-reporting here would inflate the Deflated Sharpe Ratio.
const { recordTrials } = await import('./lib.mjs');
const entries = [];
for (const [split, t] of [['development', dev], ['validation', val], ['holdout', hold]]) {
  for (const [config, r] of Object.entries(t)) {
    if (r) entries.push({ hypothesis: 'H3', config, split, sharpe: +r.sharpe.toFixed(4), maxDD: +r.maxDD.toFixed(4), bars: null, engine: 'h3-internal (2-bar lag)', selectionSet: split === 'validation' });
  }
}
console.log(`\n  trial registry: ${recordTrials(entries)} entries total`);
