// Offline verification for BTC 4H Market Radar (v3).
//
// PineTS runs the real main.pine on Node, but its bundled Binance provider only
// ever calls /klines — it cannot fetch BTCUSDT.P, _OI, or any Glassnode symbol.
// Worse, when a plain array is the data source, request.security() on a SECOND
// symbol silently returns the chart's own series with no error, so a suite built
// that way would pass while testing nothing.
//
// Symbols are therefore served by a BaseProvider subclass reading locally
// recorded Binance data. Cross-symbol request.security then resolves offline and
// honours lookahead and the [1] offset.
//
// WHAT IS PROVEN HERE (OFFLINE VERIFIED)
//   chart-symbol independence, the 4H predicate, no-repaint including all held
//   state, the OI units guard on both paths, every raw-direction semantic
//   invariant, percentile range and order-correctness, z standardisation, the
//   liquidation adapters end-to-end below input.source(), stale and
//   misconfigured adapter handling, missing-feed suppression, recent-event
//   dedup and length, market-mechanics arithmetic, table row capacity, and
//   alert gating to confirmed bars.
//
// WHAT IS NOT (TRADINGVIEW MANUAL VALIDATION REQUIRED — see
// TRADINGVIEW-VALIDATION.md)
//   real symbol spelling and history depth, request.security_lower_tf, the
//   input.source() *picker* itself, visual layout, and request.footprint()
//   (separate file, footprint-live.pine — PineTS has no implementation of it).

import { PineTS, BaseProvider } from 'pinets';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cohortId, cohortMatches, resolveLogTarget } from './audit/cohort.mjs';

const RAW = readFileSync(new URL('./main.pine', import.meta.url), 'utf8');
const HASH = createHash('sha256').update(RAW).digest('hex');

// Two PineTS-only rewrites, applied to EVERY run. Both are limitations of the
// offline runtime, not of the indicator:
// (a) PineTS implements request.security() by re-running the ENTIRE script in a
//     secondary context at the requested timeframe; TradingView evaluates only
//     the expression. The 4H guard — correct on TradingView — would therefore
//     fire from inside the "1D" request. Only the runtime.error line is
//     removed; `tfOK` itself stays and is asserted below.
// (b) PineTS's na() on an array still dereferences .size, so the na-guard around
//     request.security_lower_tf cannot execute. The provider has no 5m series
//     anyway, so those calls become empty arrays, exercising the flowOK == false
//     path. The flow proxy itself stays unverified until TradingView.
const rewrite = (src, re, to, name) => {
  const next = src.replace(re, to);
  if (next === src) { console.error(`rewrite "${name}" no longer matches main.pine — fix tests.mjs`); process.exit(1); }
  return next;
};
let BASE = RAW;
BASE = rewrite(BASE, /if not tfOK\n\s+runtime\.error\([^\n]*\n/, '', 'tf guard');
BASE = rewrite(BASE, /\[perpUp, perpDn\] = request\.security_lower_tf\([^\n]*\n\[spotUp, spotDn\] = request\.security_lower_tf\([^\n]*\n/,
  'perpUp = array.new<float>(0)\nperpDn = array.new<float>(0)\nspotUp = array.new<float>(0)\nspotDn = array.new<float>(0)\n', 'lower-tf flow');

// Adapter rewrites. input.source() cannot be wired from Node — there is no
// second indicator to point at — so the four adapter sources are replaced with
// deterministic expressions at exactly the point where the user's plot would
// arrive. Everything downstream (z, percentile, ladder, direction, freshness,
// labels, anomalies, events, alerts) is the real code path.
const enable = (src, label) => rewrite(src, new RegExp(`input\\.bool\\(false, "Enable ${label} adapter"`), `input.bool(true, "Enable ${label} adapter"`, `enable ${label}`);
const wire = (src, label, expr) => rewrite(src, new RegExp(`\\w+\\s*= input\\.source\\(close, "  ${label}"[^\\n]*\\n`), `${expr}\n`, `wire ${label}`);

const all = JSON.parse(readFileSync(new URL('../btc-4h-regime-engine/data/cache/btc-4h.json', import.meta.url), 'utf8'));
const N = +(process.argv[2] ?? 1500);
const rows = all.slice(-N).filter((r) => r.spotClose != null);

const H4 = 4 * 3600_000;
const bar = (t, o, h, l, c, v) => ({
  openTime: t, open: o, high: h, low: l, close: c, volume: v, closeTime: t + H4 - 1,
  quoteAssetVolume: v * c, numberOfTrades: 1, takerBuyBaseAssetVolume: v / 2, takerBuyQuoteAssetVolume: (v / 2) * c, ignore: '0',
});
const flat = (t, x) => bar(t, x, x, x, x, 0);

// The chart runs on BTCUSDT.P so perp and spot are genuinely DIFFERENT series.
// A chart symbol of "BTCUSDT" collides with the stripped form of
// "BINANCE:BTCUSDT": spot silently resolves to the reference, premium becomes
// identically zero, and the suite passes while testing nothing. That trap was
// hit once during development; the harness guard below keeps it shut.
const CHART = 'BTCUSDT.P';
// A deliberately non-BTC chart series for the independence test: same bar
// times, completely different prices and volumes.
const ALT = 'ETHUSDT';

function buildSeries(src, { usdOI = false } = {}) {
  return {
    'BTCUSDT.P': src.map((r) => bar(r.t, r.open, r.high, r.low, r.close, r.volume)),
    'BTCUSDT': src.map((r) => bar(r.t, r.spotOpen, r.spotHigh, r.spotLow, r.spotClose, r.spotVolume)),
    'BTCUSDT.P_OI': src.map((r) => flat(r.t, usdOI ? r.oiValue : r.oi)),
    // Roughly ETH-shaped: ~1/30 of BTC, inverted intrabar shape, different
    // volume scale. Nothing about it may reach a Radar reading.
    [ALT]: src.map((r, i) => bar(r.t, r.open / 31 + i, r.high / 29 + i, r.low / 33 + i, r.close / 30 + i, r.volume * 7 + 11)),
    // GLASSNODE:BTC_SOPR deliberately absent — exercises DATA UNAVAILABLE.
  };
}

function makeProvider(series, opts = {}) {
  const lookup = (id) => series[String(id).split(':').pop()];
  return new (class extends BaseProvider {
    constructor() { super({ requiresApiKey: false, providerName: 'Local' }); }
    getSupportedTimeframes() { return new Set(['240', '60']); }
    async _getMarketDataNative(id) { return lookup(id) ?? []; }
    async getSymbolInfo(id) {
      // A base-unit OI feed is not a currency amount, so TradingView reports
      // "NONE". oiCurrency lets a test claim otherwise and check the guard.
      const isOI = String(id).includes('_OI');
      return { ticker: id, name: id, type: 'crypto', currency: isOI ? (opts.oiCurrency ?? 'NONE') : 'USDT',
        basecurrency: 'BTC', timezone: 'Etc/UTC', minmov: 1, pricescale: 100 };
    }
  })();
}

const run = async (src, opts = {}) => {
  const p = new PineTS(makeProvider(buildSeries(src, opts), opts), opts.chart ?? CHART, opts.tf ?? '240', src.length);
  if (opts.alertMode) p.setAlertMode(opts.alertMode);
  return p.run(opts.source ?? BASE);
};

const ser = (ctx, key, len) => {
  const p = ctx.plots?.[key];
  if (!p) return new Array(len ?? rows.length).fill(NaN);
  return p.data.map((d) => (d && typeof d === 'object' ? d.value : d)).map((v) => (v == null ? NaN : v));
};
const eq = (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const fin = (a) => a.filter(Number.isFinite);

// Pack decoders. Order must match the plot expressions at the foot of main.pine.
const unpack = (v, base, n) => {
  if (!Number.isFinite(v)) return new Array(n).fill(NaN);
  const out = []; let x = Math.round(v);
  for (let i = 0; i < n; i++) { out.push(x % base); x = Math.floor(x / base); }
  return out;
};
const STAT_KEYS = ['ref', 'spot', 'oi', 'daily', 'sopr', 'fd', 'et', 'lL', 'lS'];
const DIR_KEYS = ['oi24', 'oi4', 'pm', 'fd', 'et', 'pt', 'rs', 'rp', 'lqB', 'mechPx', 'mechOi'];
const LVL_KEYS = ['oi24', 'oi4', 'pm', 'fd', 'et', 'pt', 'rs', 'rp', 'lqL', 'lqS'];
const decode = (ctx) => {
  const sp = ser(ctx, 't_statPack'), dp = ser(ctx, 't_dirPack'), lp = ser(ctx, 't_lvlPack');
  const n = sp.length;
  const out = { stat: {}, dir: {}, lvl: {} };
  for (const k of STAT_KEYS) out.stat[k] = new Array(n);
  for (const k of DIR_KEYS) out.dir[k] = new Array(n);
  for (const k of LVL_KEYS) out.lvl[k] = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = unpack(sp[i], 5, 9), d = unpack(dp[i], 3, 11), l = unpack(lp[i], 3, 10);
    STAT_KEYS.forEach((k, j) => { out.stat[k][i] = s[j]; });
    DIR_KEYS.forEach((k, j) => { out.dir[k][i] = Number.isNaN(d[j]) ? NaN : d[j] - 1; });
    LVL_KEYS.forEach((k, j) => { out.lvl[k][i] = l[j]; });
  }
  return out;
};

const readTable = (ctx) => {
  const t = ctx.plots?.__tables__?.data?.at(-1)?.value?.[0];
  if (!t?.cells) return [];
  return t.cells.map((row) => row.map((c) => c?.text ?? '').filter((x, i) => i === 0 || x !== '').join(' | '));
};

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); return ok; };
const line = (n, ok, txt) => console.log(`${String(n).padStart(2)}. ${ok ? '✅' : '❌'} ${txt}`);
const note = (txt) => console.log(`      ${txt}`);

console.log('='.repeat(98));
console.log('BTC 4H Market Radar v3 — offline verification');
console.log(`${rows.length} bars  ${new Date(rows[0].t).toISOString().slice(0, 10)} -> ${new Date(rows.at(-1).t).toISOString().slice(0, 10)}   hash ${HASH.slice(0, 12)}`);
console.log('='.repeat(98) + '\n');

let ctx;
try {
  ctx = await run(rows);
} catch (e) {
  console.log(' 0. ❌ script failed to run: ' + e.message);
  console.log((e.stack ?? '').split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}
line(0, true, 'main.pine transpiles and runs against multi-symbol local data');

// Harness guard: if spot and the reference ever resolve to the same series,
// every cross-symbol result below is vacuous.
{
  const s = buildSeries(rows);
  if (s['BTCUSDT.P'].every((b, i) => b.close === s['BTCUSDT'][i].close)) {
    console.log('   ❌ HARNESS BROKEN: spot and reference alias'); process.exit(1);
  }
  if (s[ALT].every((b, i) => b.close === s['BTCUSDT.P'][i].close)) {
    console.log('   ❌ HARNESS BROKEN: alt chart aliases the reference'); process.exit(1);
  }
}

const D = decode(ctx);
const nb = rows.length;

// ---- one run with every adapter live, reused by several checks below ----
// input.source() is replaced at its own declaration, so the expressions may only
// use identifiers that exist that early: chart builtins. That is faithful — on
// TradingView an input.source() value also arrives from the chart pane. Only the
// four adapters are affected; every Radar price feature still comes from the
// reference symbol, which check 6 proves independently.
const LIQL = 'extLiqL    = math.abs(close - close[1]) * volume';
const LIQS = 'extLiqS    = math.abs(high - low) * volume * 0.7';
const FUND = 'extFunding = (close - ta.sma(close, 20)) / ta.sma(close, 20) * 0.05';
const ETF  = 'extEtf     = (close - close[1]) * 100.0';
const declarePaired = (src) => rewrite(src, /input\.bool\(false, "  Long and short liquidations share one source and unit"/,
  'input.bool(true, "  Long and short liquidations share one source and unit"', 'declare liq pairing');
const declarePairedTest = (src) => declarePaired(src);
const withAdapters = (src) => {
  let x = declarePaired(src);
  for (const l of ['long-liquidation', 'short-liquidation', 'funding', 'ETF flow']) x = enable(x, l);
  x = wire(x, 'Long liquidations', LIQL);
  x = wire(x, 'Short liquidations', LIQS);
  x = wire(x, 'Aggregated funding rate', FUND);
  x = wire(x, 'US spot BTC ETF net flow', ETF);
  return x;
};
// maxAnom at its ceiling so the same run also measures worst-case table height.
const FULL_SRC = withAdapters(rewrite(BASE, /input\.int\(5, "Max anomalies listed", minval = 1, maxval = 9/, 'input.int(9, "Max anomalies listed", minval = 1, maxval = 9', 'maxAnom ceiling'));
const full = await run(rows, { source: FULL_SRC });
const F = decode(full);

// ============================================================ 1. semantics ===
// The v3 rule: a direction word is a function of a raw value's sign and of
// nothing else. Every violation here would be the indicator telling the user
// something the data does not say.
const RAWMAP = [
  ['OI 24H   EXPANSION/REDUCTION', 'oi24', 't_oiChg24', ctx, D],
  ['OI 4H    EXPANSION/REDUCTION', 'oi4', 't_oiChg4', ctx, D],
  ['PREMIUM  POSITIVE/NEGATIVE', 'pm', 't_premium', ctx, D],
  // Funding, ETF and the liquidation balance only exist when an adapter is
  // wired, so their invariants are asserted on the all-adapters run.
  ['FUNDING  LONG/SHORT', 'fd', 't_fundRaw', full, F],
  ['ETF 5D   INFLOW/OUTFLOW', 'et', 't_etf5d', full, F],
  ['LIQ BAL  MORE LONG/SHORT', 'lqB', 't_liqBal', full, F],
];
let semBad = 0;
const semDetail = [];
for (const [name, dirKey, rawKey, C, Dc] of RAWMAP) {
  const raw = ser(C, rawKey), dir = Dc.dir[dirKey];
  let bad = 0, seen = 0;
  for (let i = 0; i < nb; i++) {
    if (!Number.isFinite(raw[i]) || !Number.isFinite(dir[i]) || dir[i] === 0) continue;
    seen++;
    if (Math.sign(raw[i]) !== dir[i]) bad++;
  }
  semBad += bad;
  semDetail.push(`${name}: ${seen} signed bars, ${bad} violations`);
  if (bad) fails.push(`SEMANTIC VIOLATION ${name}: ${bad}/${seen} bars where the direction word contradicts the raw value`);
}
line(1, check(semBad === 0, `${semBad} semantic violations`),
  'direction words follow the RAW value, never the z-score — OI expansion/reduction, premium sign, funding sign, ETF inflow/outflow');
semDetail.forEach(note);

// Trend and SOPR: the raw value IS the deviation, so the state sign must equal
// the raw sign by construction. Asserted rather than assumed.
{
  const pairs = [['TREND', 't_trSt', 't_trendDist'], ['SOPR', 't_spSt', 't_soprDev']];
  let bad = 0;
  for (const [name, st, rawK] of pairs) {
    const s = ser(ctx, st), raw = ser(ctx, rawK);
    for (let i = 0; i < nb; i++) {
      if (!Number.isFinite(s[i]) || s[i] === 0 || !Number.isFinite(raw[i])) continue;
      if (Math.sign(s[i]) !== Math.sign(raw[i])) { bad++; if (bad === 1) fails.push(`${name} state sign disagrees with its raw deviation at bar#${i}`); }
    }
  }
  line(2, check(bad === 0, `${bad} trend/SOPR sign disagreements`),
    'trend and SOPR states carry the sign of their own raw deviation on every engaged bar');
}

// Participation is a RELATIVE measure, so its word is z-driven ON PURPOSE and
// the vocabulary says so. What must never appear is a dominance claim.
{
  const pz = ser(ctx, 't_partZ'), dir = D.dir.pt;
  let bad = 0;
  for (let i = 0; i < nb; i++) {
    if (!Number.isFinite(pz[i]) || !Number.isFinite(dir[i]) || dir[i] === 0) continue;
    if (Math.sign(pz[i]) !== dir[i]) bad++;
  }
  const src = RAW;
  const banned = ['SPOT DOMINANT', 'PERP DOMINANT'].filter((w) => src.includes(w));
  line(3, check(bad === 0 && banned.length === 0, `${bad} participation sign errors; banned vocabulary present: ${banned.join(', ')}`),
    `participation reads RELATIVE SPOT/PERP SURGE from its own z (${bad} sign errors), and the words "SPOT DOMINANT"/"PERP DOMINANT" no longer exist in the source`);
}

// ========================================================== 2. percentiles ===
// Range, and order-correctness against the same window. Both hold under either
// convention for whether the current bar counts itself, so neither test bakes
// in an assumption about TradingView's exact tie handling.
{
  const PCT = ['t_oiP24', 't_oiP4', 't_premP', 't_partP', 't_rvolSpotP', 't_rvolPerpP', 't_volPct'];
  let outOfRange = 0;
  for (const k of PCT) for (const v of ser(ctx, k)) if (Number.isFinite(v) && (v < 0 || v > 100)) outOfRange++;

  // Order-correctness on real data: when the raw value is the maximum of its own
  // 180-bar window, the rank must be at the top of the scale, and vice versa.
  const WIN = 180;
  const pairs = [['OI 24H', 't_oiChg24', 't_oiP24'], ['OI 4H', 't_oiChg4', 't_oiP4'], ['PREMIUM', 't_premium', 't_premP'], ['PARTICIP', 't_partRaw', 't_partP'], ['SPOT RVOL', 't_rvolSpot', 't_rvolSpotP'], ['PERP RVOL', 't_rvolPerp', 't_rvolPerpP']];
  let orderBad = 0, orderSeen = 0;
  for (const [, rawK, pK] of pairs) {
    const raw = ser(ctx, rawK), p = ser(ctx, pK);
    for (let i = WIN + 60; i < nb; i++) {
      if (!Number.isFinite(p[i])) continue;
      const w = raw.slice(i - WIN, i + 1);
      if (w.some((x) => !Number.isFinite(x))) continue;
      const mx = Math.max(...w), mn = Math.min(...w);
      if (raw[i] === mx && w.filter((x) => x === mx).length === 1) { orderSeen++; if (p[i] < 100 * (WIN - 1) / WIN) orderBad++; }
      if (raw[i] === mn && w.filter((x) => x === mn).length === 1) { orderSeen++; if (p[i] > 100 / WIN) orderBad++; }
    }
  }
  line(4, check(outOfRange === 0 && orderBad === 0 && orderSeen > 50,
    `percentile: ${outOfRange} out of [0,100], ${orderBad}/${orderSeen} order violations (need >= 50 samples)`),
    `percentiles stay in [0,100] across ${PCT.length} series, and rank correctly against their own window (${orderSeen} window extremes checked, ${orderBad} wrong)`);
}

// A direct fixture on ta.percentrank itself, since pctOf is a thin wrapper: a
// strictly rising series must rank 100, a strictly falling one must rank at the
// floor of the scale.
{
  const T0 = 1700000000000 - (1700000000000 % H4);
  const synth = (f) => Array.from({ length: 120 }, (_, i) => { const c = f(i); return bar(T0 + i * H4, c, c, c, c, 1); });
  const prov = (s) => new (class extends BaseProvider {
    constructor() { super({ requiresApiKey: false, providerName: 'L' }); }
    getSupportedTimeframes() { return new Set(['240']); }
    async _getMarketDataNative() { return s; }
    async getSymbolInfo(id) { return { ticker: id, name: id, type: 'crypto', currency: 'USDT', basecurrency: 'X', timezone: 'Etc/UTC', minmov: 1, pricescale: 100 }; }
  })();
  const mini = '//@version=6\nindicator("m")\nplot(ta.percentrank(close, 20), "p", display = display.none)\n';
  const up = await new PineTS(prov(synth((i) => 100 + i)), 'X', '240', 120).run(mini);
  const dn = await new PineTS(prov(synth((i) => 1000 - i)), 'X', '240', 120).run(mini);
  const uv = fin(ser(up, 'p', 120)).slice(25), dv = fin(ser(dn, 'p', 120)).slice(25);
  line(5, check(uv.length > 50 && uv.every((v) => v === 100) && dv.every((v) => v <= 5),
    `percentrank fixture: rising max ${Math.min(...uv)}, falling max ${Math.max(...dv)}`),
    `ta.percentrank fixture — a strictly rising series ranks 100 on all ${uv.length} bars, a strictly falling one ranks at the floor (max ${Math.max(...dv)})`);
}

// ================================================ 3. chart-symbol independence
// The whole point of the reference symbol. Put the script on a chart that is
// not BTC and every Radar number must be bit-identical.
{
  const alt = await run(rows, { chart: ALT });
  const HOOKS = ['t_refClose', 't_atr14', 't_volPct', 't_trendDist', 't_px24', 't_oiChg24', 't_oiZ24', 't_oiP24',
    't_premium', 't_premZ', 't_premP', 't_partRaw', 't_partZ', 't_rvolSpot', 't_rvolPerp', 't_mom12w',
    't_trSt', 't_oi24St', 't_anomCount', 't_statPack', 't_dirPack', 't_lvlPack'];
  let diff = 0; const which = [];
  for (const h of HOOKS) {
    const a = ser(ctx, h), b = ser(alt, h);
    for (let i = 0; i < nb; i++) if (!eq(a[i], b[i])) { diff++; which.push(`${h}@${i} ${a[i]} vs ${b[i]}`); break; }
  }
  if (diff) fails.push(`chart dependence: ${which.slice(0, 4).join('; ')}`);
  // And prove the alt chart really is a different asset, or the test is vacuous.
  const chartDiffers = ser(ctx, 't_refClose')[nb - 1] !== buildSeries(rows)[ALT][nb - 1].close;
  line(6, check(diff === 0 && chartDiffers, `${diff} of ${HOOKS.length} hooks changed with the chart symbol`),
    `chart-symbol independence — all ${HOOKS.length} radar series identical on a BTCUSDT.P chart and on a non-BTC chart`);
}

// ======================================================== 4. 4H enforcement ===
{
  const ok240 = ser(ctx, 't_tfOK');
  const h1 = await run(rows, { tf: '60' });
  const ok60 = ser(h1, 't_tfOK');
  // The predicate is what the runtime.error is wired to. Assert the wiring in
  // the source too, since the error line itself is stripped for the offline run.
  const wired = /tfOK = timeframe\.in_seconds\(timeframe\.period\) == 14400/.test(RAW)
    && /if not tfOK\n\s+runtime\.error\(/.test(RAW);
  line(7, check(ok240.every((v) => v === 1) && ok60.every((v) => v === 0) && wired,
    `4H predicate: 240 -> ${[...new Set(ok240)]}, 60 -> ${[...new Set(ok60)]}, wired ${wired}`),
    `exact-4H predicate is 1 on a 240 chart and 0 on a 60 chart, and runtime.error is wired directly to it`);
  note('the error is RAISED only on TradingView — PineTS evaluates it inside the 1D security context too, so the line is stripped offline and the predicate is asserted instead');
}

// ============================================================ 5. no repaint ===
// Held state — hysteresis levels, the event buffer, freshness counters — is
// exactly the construct most likely to repaint, so all of it is in the hooks.
{
  const HOOKS = ['t_oiZ24', 't_oiZ24s', 't_oiP24', 't_premZ', 't_premP', 't_partZ', 't_volPct', 't_trendDist',
    't_oi24St', 't_trSt', 't_anomCount', 't_maxExt', 't_lvlPack', 't_dirPack', 't_statPack', 't_evPush'];
  let repaint = 0;
  for (const frac of [0.6, 0.85]) {
    const k = Math.floor(rows.length * frac);
    const cut = await run(rows.slice(0, k));
    for (const h of HOOKS) {
      const full = ser(ctx, h), part = ser(cut, h, k);
      for (let i = 0; i < k - 1; i++) {
        if (!eq(full[i], part[i])) { repaint++; fails.push(`repaint ${h} bar#${i}: full=${full[i]} truncated@${k}=${part[i]}`); break; }
      }
    }
  }
  line(8, check(repaint === 0, `${repaint} series repainted`),
    `no repaint — past bars unchanged when future bars are added, across all ${HOOKS.length} hooks including every held state and the event counter`);
}

// ======================================================= 6. the units guard ===
{
  const usd = await run(rows, { usdOI: true });
  const cur = await run(rows, { oiCurrency: 'USD' });
  const okBase = ser(ctx, 't_oiOK').filter((x) => x === 1).length;
  const okUsd = ser(usd, 't_oiOK').filter((x) => x === 1).length;
  const okCur = ser(cur, 't_oiOK').filter((x) => x === 1).length;
  line(9, check(okUsd === 0 && okCur === 0 && okBase > rows.length * 0.9,
    `units guard wrong: magnitude path trusted ${okUsd}, currency path trusted ${okCur}, base-unit accepted ${okBase}/${rows.length}`),
    `USD-notional OI rejected by BOTH paths — magnitude (${okUsd} trusted) and declared currency (${okCur} trusted); base-unit accepted on ${okBase}/${rows.length}`);
}

// ================================================= 7. absent / missing feeds ===
{
  const soprVals = fin(ser(ctx, 't_sopr')).length;
  const spEngaged = ser(ctx, 't_spSt').filter((x) => x !== 0 && Number.isFinite(x)).length;
  const soprStat = D.stat.sopr.filter((x) => x !== 0).length;
  // Every adapter is off in the default run, so none of them may ever produce a
  // level, a percentile or an anomaly.
  const offLvl = ['fd', 'et', 'lqL', 'lqS'].map((k) => D.lvl[k].filter((x) => x > 0).length);
  const offVals = ['t_fundRaw', 't_etf5d', 't_liqLZ', 't_liqSZ'].map((k) => fin(ser(ctx, k)).length);
  line(10, check(soprVals === 0 && spEngaged === 0 && soprStat === 0 && offLvl.every((x) => x === 0) && offVals.every((x) => x === 0),
    `absent feed leaked: sopr ${soprVals}v/${spEngaged}s/${soprStat}ok, adapters levels ${offLvl} values ${offVals}`),
    `a missing feed stays missing — SOPR and all four disabled adapters produce no value, no level and no anomaly on any of ${nb} bars`);
}

// ================================================ 8. liquidation adapters ======
// Wired to a deterministic expression at the input.source() boundary, so the
// whole chain below it is the real code.

{
  const lq = full, L = F;
  const lz = ser(lq, 't_liqLZ'), lp = ser(lq, 't_liqLP'), sz = ser(lq, 't_liqSZ'), bal = ser(lq, 't_liqBal');
  const lvlL = L.lvl.lqL, lvlS = L.lvl.lqS;
  // 1. the adapters actually became available
  const availL = L.stat.lL.filter((x) => x >= 3).length;
  // 2. liquidation levels only ever fire on the UPPER tail — a quiet bar is not
  //    "unusually few liquidations"
  let lowerTail = 0;
  for (let i = 0; i < nb; i++) if (lvlL[i] > 0 && Number.isFinite(lz[i]) && lz[i] <= 0) lowerTail++;
  for (let i = 0; i < nb; i++) if (lvlS[i] > 0 && Number.isFinite(sz[i]) && sz[i] <= 0) lowerTail++;
  // 3. spikes are reachable at all, and both sides work
  const spikeL = lvlL.filter((x) => x > 0).length, spikeS = lvlS.filter((x) => x > 0).length;
  // 4. balance is bounded and signed correctly
  let balBad = 0;
  for (let i = 0; i < nb; i++) if (Number.isFinite(bal[i]) && (bal[i] < -1 || bal[i] > 1)) balBad++;
  let balSign = 0;
  for (let i = 0; i < nb; i++) if (Number.isFinite(bal[i]) && Number.isFinite(L.dir.lqB[i]) && L.dir.lqB[i] !== 0 && Math.sign(bal[i]) !== L.dir.lqB[i]) balSign++;
  const tbl = readTable(lq).join('\n');
  const shows = ['LONG LIQ', 'SHORT LIQ'].every((w) => tbl.includes(w));
  line(11, check(availL > nb * 0.5 && lowerTail === 0 && spikeL > 0 && spikeS > 0 && balBad === 0 && balSign === 0 && shows,
    `liq adapters: avail ${availL}, lower-tail fires ${lowerTail}, spikes ${spikeL}/${spikeS}, balance out-of-range ${balBad}, sign errors ${balSign}, rows ${shows}`),
    `liquidation adapters end-to-end — ${availL}/${nb} bars available, ${spikeL} long and ${spikeS} short spikes, ${lowerTail} fires on the lower tail (must be 0), balance in [-1,1] with the correct sign on every bar`);
  note(`percentile present on ${fin(lp).length} bars; both sides appear in the dashboard and in ANOMALIES`);
}

// ============================================= 9. stale and misconfigured ======
{
  // Freezes after 60% of the run. STALE must follow within the documented
  // window, and every reading must stop.
  const cut = Math.floor(nb * 0.6);
  let src = BASE;
  src = enable(src, 'long-liquidation');
  src = wire(src, 'Long liquidations', `extLiqL    = bar_index < ${cut} ? math.abs(close - close[1]) * volume : 4242.0`);
  const st = await run(rows, { source: src });
  const S = decode(st);
  const tail = S.stat.lL.slice(cut + 10);
  const lvlAfter = S.lvl.lqL.slice(cut + 10).filter((x) => x > 0).length;
  const zAfter = fin(ser(st, 't_liqLZ').slice(cut + 10)).length;
  const becameStale = tail.length > 0 && tail.every((x) => x === 2);
  const staleTbl = readTable(st).join('\n');
  const wasFresh = S.stat.lL.slice(200, cut - 10).filter((x) => x >= 3).length > 0;

  // Enabled but never wired: MISCONFIGURED, and distinct from both UNAVAILABLE
  // and STALE.
  const mis = await run(rows, { source: enable(BASE, 'long-liquidation') });
  const M = decode(mis);
  const allMis = M.stat.lL.every((x) => x === 1);
  const misLvl = M.lvl.lqL.filter((x) => x > 0).length;
  const misTbl = readTable(mis).join('\n');

  line(12, check(wasFresh && becameStale && lvlAfter === 0 && zAfter === 0 && allMis && misLvl === 0
    && misTbl.includes('MISCONFIGURED') && staleTbl.includes('LIKELY STALE') && !staleTbl.includes('adapters (update activity only') === false,
    `stale/misconfigured: fresh-before ${wasFresh}, stale-after ${becameStale}, levels after ${lvlAfter}, z after ${zAfter}, misconfigured ${allMis}/${misLvl}`),
    `an adapter that stops changing reads LIKELY STALE within ${+(RAW.match(/BARS_STALE_LIQ\s*=\s*(\d+)/)?.[1] ?? 0)} bars and stops producing readings (${lvlAfter} levels, ${zAfter} values after); an enabled-but-unwired adapter reads MISCONFIGURED on all ${nb} bars, never LIKELY STALE or UNAVAILABLE`);
}

// ========================================================= 10. anomalies ======
{
  const anom = ser(ctx, 't_anomCount');
  const spSt = ser(ctx, 't_spSt');
  let bad = 0;
  for (let i = 0; i < nb; i++) {
    const want = LVL_KEYS.reduce((s, k) => s + (D.lvl[k][i] > 0 ? 1 : 0), 0) + (spSt[i] !== 0 && Number.isFinite(spSt[i]) ? 1 : 0);
    if (anom[i] !== want) { bad++; if (bad === 1) fails.push(`anomaly count bar#${i}: reported ${anom[i]}, engaged ${want}`); }
  }
  const mx = ser(ctx, 't_maxExt');
  let extBad = 0;
  for (let i = 0; i < nb; i++) if (Number.isFinite(mx[i]) && (mx[i] < 50 || mx[i] > 100)) extBad++;
  line(13, check(bad === 0 && extBad === 0, `${bad} count mismatches, ${extBad} ranking values outside [50,100]`),
    `ANOMALIES count equals the engaged measurements on all ${nb} bars, and the percentile-extremeness used to rank them stays in [50,100]`);
}

// =================================================== 11. market mechanics =====
{
  const px = ser(ctx, 't_px24'), oi = ser(ctx, 't_oiChg24');
  const mp = D.dir.mechPx, mo = D.dir.mechOi;
  let bad = 0;
  const seen = new Set();
  for (let i = 0; i < nb; i++) {
    if (Number.isFinite(px[i]) && Number.isFinite(mp[i]) && Math.sign(px[i]) !== mp[i]) bad++;
    if (Number.isFinite(oi[i]) && Number.isFinite(mo[i]) && Math.sign(oi[i]) !== mo[i]) bad++;
    if (mp[i] && mo[i]) seen.add(`${mp[i]}|${mo[i]}`);
  }
  const four = ['1|1', '1|-1', '-1|1', '-1|-1'];
  const missing = four.filter((k) => !seen.has(k));
  line(14, check(bad === 0 && missing.length === 0, `${bad} sign errors; states never observed: ${missing.join(', ') || 'none'}`),
    `MARKET MECHANICS — both axes take the sign of their own raw 24h change (${bad} errors), and all four states occur in the window`);
  note('price up + position build / build-down / reduction-up / reduction-down all observed; the label is a description, and no test asserts anything about what follows');
}

// ===================================================== 12. recent events ======
{
  const cnt = ser(ctx, 't_evCount'), push = ser(ctx, 't_evPush'), dup = ser(ctx, 't_evDup');
  let bad = 0, nonMono = 0;
  for (let i = 0; i < nb; i++) {
    if (Number.isFinite(cnt[i]) && (cnt[i] < 0 || cnt[i] > 5)) bad++;
    if (Number.isFinite(cnt[i]) && Number.isFinite(push[i]) && cnt[i] !== Math.min(5, push[i])) bad++;
    if (i && Number.isFinite(push[i]) && Number.isFinite(push[i - 1]) && push[i] < push[i - 1]) nonMono++;
  }
  // Dedup: no two adjacent lines in the rendered buffer may be identical.
  const evRows = readTable(ctx).slice(2).filter((r) => /^(now|\d+[hd]) \| /.test(r)).map((r) => r.split(' | ')[1]);
  let adj = 0;
  for (let i = 1; i < evRows.length; i++) if (evRows[i] === evRows[i - 1]) adj++;
  line(15, check(bad === 0 && nonMono === 0 && adj === 0 && push.at(-1) > 0,
    `events: ${bad} length/consistency errors, ${nonMono} non-monotonic, ${adj} adjacent duplicates`),
    `RECENT EVENTS — buffer never exceeds 5, always equals min(5, accepted pushes), the counter never decreases (${push.at(-1)} accepted, ${dup.at(-1)} duplicates suppressed), and no two adjacent entries repeat`);
}

// ============================================ 13. alerts: gating and shape ====
// PineTS treats the last historical bar as confirmed — it has no realtime bar —
// so "does not fire on a forming bar" cannot be measured here. What CAN be
// measured offline is that every alert is structurally inside the confirmed
// block, carries once-per-bar-close frequency, and never repeats the same
// message on consecutive bars. Actual firing on a live TradingView bar is
// MANUAL VALIDATION REQUIRED.
{
  const am = await run(rows, { source: FULL_SRC, alertMode: 'all' });
  const alerts = am.alerts ?? [];
  const freqBad = alerts.filter((a) => a.freq !== 'alert.freq_once_per_bar_close').length;

  // Structural: exactly one alert() call in the source, inside fire(); and every
  // fire() call site is indented under the `if conf` block.
  const alertCalls = RAW.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n').match(/\balert\(/g)?.length ?? 0;
  const inFire = /^fire\(txt\) =>\n    alert\(txt, alert\.freq_once_per_bar_close\)\n    pushEvent\(txt\)$/m.test(RAW);
  const lines = RAW.split('\n');
  const confAt = lines.findIndex((l) => l === 'if conf');
  const confEnd = lines.findIndex((l, i) => i > confAt && l.length > 0 && !l.startsWith(' '));
  const fireLines = lines.map((l, i) => [l, i]).filter(([l]) => /(^|\s)fire\(/.test(l) && !l.startsWith('fire(txt)'));
  const outside = fireLines.filter(([, i]) => i < confAt || i > confEnd);

  let repeats = 0;
  const byBar = new Map();
  for (const a of alerts) byBar.set(a.bar_index, [...(byBar.get(a.bar_index) ?? []), a.message]);
  for (const [b, msgs] of byBar) {
    const prev = byBar.get(b - 1) ?? [];
    repeats += msgs.filter((m) => prev.includes(m)).length;
  }

  line(16, check(alerts.length > 0 && freqBad === 0 && alertCalls === 1 && inFire && outside.length === 0 && repeats === 0,
    `alerts: ${alerts.length} fired, ${freqBad} wrong frequency, ${alertCalls} alert() call sites, in fire() ${inFire}, ${outside.length} fire() calls outside the confirmed block, ${repeats} consecutive-bar repeats`),
    `alerts — ${alerts.length} fired, all with freq_once_per_bar_close; the single alert() call site lives in fire(), all ${fireLines.length} fire() calls sit inside the barstate.isconfirmed block, and no message repeats on consecutive bars`);
  note('PineTS has no realtime bar, so "never fires on an unconfirmed bar" is structural here and MANUAL on TradingView');
}

// ======================================================== 14. table capacity ===
{
  // Maximum configuration: 9 anomalies, 5 events, every adapter live — the
  // FULL_SRC run built above.
  const used = ser(full, 't_rowsUsed').at(-1);
  const cap = +(RAW.match(/TBL_ROWS = (\d+)/)?.[1] ?? 0);
  const t = readTable(full);
  const SECTIONS = ['BTC 4H MARKET RADAR', 'RECENT EVENTS', 'WHAT CHANGED', 'CURRENT ANOMALIES',
    'MARKET MECHANICS — description', 'TREND / VOLATILITY — persistent', 'DERIVATIVES',
    'PARTICIPATION — volume', 'FLOW — ESTIMATED', 'SLOW CONTEXT',
    'DATA HEALTH — timestamp-verified', 'DATA HEALTH — external adapters',
    'EVIDENCE: DESCRIPTIVE', 'ACTION: CONTEXT ONLY'];
  const joined = t.join('\n');
  const missing = SECTIONS.filter((w) => !joined.includes(w));
  const banned = ['DO NOT CHASE', 'REDUCE EXPOSURE', 'LONG READY', 'RISK-ON', 'RISK-OFF', 'HEALTHY', 'DISTRIBUTION RISK', 'ALIGNED', 'SPOT DOMINANT', 'PERP DOMINANT'].filter((w) => joined.includes(w));
  line(17, check(used > 0 && used <= cap && cap >= 55 && missing.length === 0 && banned.length === 0,
    `table: used ${used} of ${cap}; missing ${missing.join(', ') || 'none'}; banned ${banned.join(', ') || 'none'}`),
    `table capacity — worst case (9 anomalies, 5 events, all four adapters live) uses ${used} of ${cap} allocated rows, and all ${SECTIONS.length} sections render with no prescriptive or predictive label`);
  note(`headroom ${cap - used} rows; every cell write is bounds-guarded, so exceeding capacity would drop rows rather than corrupt the table`);
  // The dashboard must lead with events and anomalies, not with a reading.
  // Match the section HEADERS, not bare words: an anomaly line reading
  // "ETF 5D UNUSUAL INFLOW" contains "FLOW" and would be mistaken for the FLOW
  // header, which is how this check quietly passed on the wrong rows once.
  const order = ['RECENT EVENTS', 'CURRENT ANOMALIES', 'MARKET MECHANICS — description',
    'TREND / VOLATILITY — persistent', 'DERIVATIVES', 'PARTICIPATION — volume',
    'FLOW — ESTIMATED', 'SLOW CONTEXT', 'DATA HEALTH — timestamp-verified',
    'DATA HEALTH — external adapters'];
  const pos = order.map((w) => t.findIndex((r) => r.includes(w)));
  const ordered = pos.every((v, i) => i === 0 || (v > pos[i - 1] && v >= 0));
  check(ordered, `dashboard sections out of priority order: ${JSON.stringify(pos)}`);
  note(`section order verified: ${ordered ? 'as specified' : 'WRONG'}`);
}

// ================================================ 15. z-score standardisation ==
{
  const zs = { oiZ4: 't_oiZ4', oiZ24: 't_oiZ24', premZ: 't_premZ', partZ: 't_partZ' };
  const stats = {}; let bad = 0;
  for (const [name, key] of Object.entries(zs)) {
    const v = fin(ser(ctx, key)).slice(200);
    if (v.length < 100) { bad++; fails.push(`${name}: only ${v.length} finite values`); continue; }
    stats[name] = [mean(v), sd(v)];
    if (Math.abs(mean(v)) > 0.35 || Math.abs(sd(v) - 1) > 0.4) { bad++; fails.push(`${name} not standardised: mean ${mean(v).toFixed(2)} sd ${sd(v).toFixed(2)}`); }
  }
  line(18, check(bad === 0, `${bad} z-score series not standardised`),
    `rolling z-scores standardised (${Object.entries(stats).map(([k, [m, s]]) => `${k} ${m.toFixed(2)}±${s.toFixed(2)}`).join(', ')})`);
}

// ============================================= 16. the premium is what it says =
// Binance derives funding from the premium index, so a correct perp/spot
// premium MUST correlate positively with realised funding. This is what
// separates "measuring basis" from "measuring noise".
{
  const withF = all.filter((r) => r.spotClose != null && r.funding != null);
  const prem = withF.map((r) => r.close / r.spotClose - 1);
  const fund = withF.map((r) => r.funding);
  const corr = (a, b) => { const ma = mean(a), mb = mean(b); return mean(a.map((x, i) => (x - ma) * (b[i] - mb))) / (sd(a) * sd(b)); };
  const c1 = corr(prem, fund);
  const sm = prem.map((_, i) => (i < 6 ? null : mean(prem.slice(i - 5, i + 1))));
  const idx = sm.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  const c6 = corr(idx.map((i) => sm[i]), idx.map((i) => fund[i]));
  line(19, check(c1 > 0.4 && c6 > 0.5, `premium/funding correlation too weak: ${c1.toFixed(3)} / ${c6.toFixed(3)}`),
    `perp premium tracks funding as it must by construction (r=${c1.toFixed(3)} raw, ${c6.toFixed(3)} on the 24h mean)`);
  note(`median premium ${(prem.slice().sort((a, b) => a - b)[Math.floor(prem.length / 2)] * 100).toFixed(4)}% — a persistent level offset, which is why intensity is a rank and never an absolute threshold`);
}

// ============================================ 17. prospective cohort integrity =
// Pure logic, no dataset needed: the same module audit/event-log.mjs uses.
{
  const a = { schema: 3, freeze: '2026-09-06', indicatorHash: 'aaaa', configHash: 'bbbb', thresholds: 'v3' };
  const b = { ...a, indicatorHash: 'cccc' };
  const c = { ...a, configHash: 'dddd' };
  const d = { ...a, freeze: '2026-10-01' };
  const e = { ...a, schema: 4 };
  const idA = cohortId(a);
  const same = cohortMatches(a, { ...a });
  const rejects = [b, c, d, e].map((x) => cohortMatches(a, x));
  const idsDiffer = new Set([b, c, d, e].map((x) => cohortId(x))).size === 4 && !new Set([b, c, d, e].map((x) => cohortId(x))).has(idA);
  const fname = `event-log-v3-${idA.slice(0, 12)}.json`;
  // The three routing branches, exercised without touching the disk.
  const dflt = 'event-log.json';
  const rAppend = resolveLogTarget({ existing: { cohort: a }, current: a, newCohort: false, defaultPath: dflt });
  const rCreate = resolveLogTarget({ existing: null, current: a, newCohort: false, defaultPath: dflt });
  const rRefuse = resolveLogTarget({ existing: { cohort: b }, current: a, newCohort: false, defaultPath: dflt });
  const rNew = resolveLogTarget({ existing: { cohort: b }, current: a, newCohort: true, defaultPath: dflt });
  const rLegacy = resolveLogTarget({ existing: { indicatorHash: 'old', events: [] }, current: a, newCohort: false, defaultPath: dflt });
  const routing = rAppend.action === 'append' && rAppend.path === dflt
    && rCreate.action === 'create' && rCreate.path === dflt
    && rRefuse.action === 'refuse' && !!rRefuse.hint
    && rNew.action === 'create' && rNew.path !== dflt && rNew.path.startsWith('event-log-v3-')
    && rLegacy.action === 'refuse';

  line(20, check(same && rejects.every((r) => r === false) && idsDiffer && idA.length === 64 && routing,
    `cohort guard: same ${same}, rejects ${rejects}, ids distinct ${idsDiffer}, routing ${routing} (${rAppend.action}/${rCreate.action}/${rRefuse.action}/${rNew.action}/${rLegacy.action})`),
    `prospective cohort identity — a change to ANY of {schema, freeze, indicator hash, config hash, threshold version} produces a different cohort id and fails the match, so v3 events can never merge into a v2 log (new file would be ${fname})`);
  note(`routing: same cohort -> append, no log -> create, mismatch -> REFUSE with a hint, mismatch + --new-cohort -> ${rNew.path}, pre-v3 file with no cohort stamp -> REFUSE`);
}

// ============================== 21. zero / missing OI must not contaminate ====
// The v3.0 defect this suite exists to keep out. `oiChg = oi / oi[1] - 1` only
// checked that the OLDER value was positive, so a zero open-interest tick
// produced -100%, and nz() then fed it straight into a 180-bar window. One
// -100% inflates the rolling standard deviation about 4.5x, which does not make
// the panel noisy — it makes it SILENT, suppressing real anomalies for 30 days.
//
// Binance's history has 12 zero-OI bars. None fall in the default window, so
// this check runs on its own slice around the July-2024 cluster and, separately,
// on an injected one so the path is exercised whatever the data does.
{
  const ZLO = 8200, ZHI = 8700;
  const zrows = all.slice(ZLO, ZHI);
  const zAt = zrows.map((r, i) => (r.oi === 0 ? i : -1)).filter((i) => i >= 0);
  const zn = zrows.length;

  const zser = (c, k) => {
    const p = c.plots?.[k];
    if (!p) return new Array(zn).fill(NaN);
    return p.data.map((d) => (d && typeof d === 'object' ? d.value : d)).map((v) => (v == null ? NaN : v));
  };
  const zrun = async (src) => new PineTS(makeProvider(buildSeries(zrows)), CHART, '240', zn).run(src);

  const fixed = await zrun(BASE);

  // The v3.0 formula, restored verbatim, as a control. If this control ever
  // stops showing the damage, the test has gone blind and must be repaired
  // rather than deleted.
  let poison = BASE;
  poison = rewrite(poison, /oiChg4hRaw  = oiObs and oiObs\[1\] \? oiRaw \/ oiRaw\[1\] - 1 : na/,
    'oiChg4hRaw  = not na(oiRaw) and not na(oiRaw[1]) and oiRaw[1] > 0 ? oiRaw / oiRaw[1] - 1 : na', 'poison chg4');
  poison = rewrite(poison, /oiChg4hFill  = holdLast\(oiChg4hRaw\)/, 'oiChg4hFill  = nz(oiChg4hRaw)', 'poison fill');
  const bad = await zrun(poison);

  const obs = zser(fixed, 't_oiObs');
  const c4 = zser(fixed, 't_oiChg4'), c24 = zser(fixed, 't_oiChg24');
  const fill = zser(fixed, 't_oiFill4'), badFill = zser(bad, 't_oiFill4');
  const zf = zser(fixed, 't_oiZ4'), zb = zser(bad, 't_oiZ4');

  // (a) every zero bar is refused as an observation
  const obsAtZero = zAt.filter((i) => obs[i] !== 0).length;
  // (b) no -100% artefact anywhere, in the displayed change or in the
  //     normalisation source
  const artefact = [...c4, ...c24, ...fill].filter((v) => Number.isFinite(v) && v <= -0.9).length;
  const badArtefact = badFill.filter((v) => Number.isFinite(v) && v <= -0.9).length;
  // (c) both endpoints required: the bar AFTER a zero has no 4H change either
  const afterOK = zAt.every((i) => i + 1 >= zn || !Number.isFinite(c4[i + 1]));
  // (d) no artificial values. On a bar with an observation the fill IS the
  //     observation; on a bar without one it repeats the previous fill. Nothing
  //     else is ever allowed to appear — in particular not a synthetic zero.
  const close9 = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  let invented = 0;
  for (let i = 1; i < zn; i++) {
    if (!Number.isFinite(fill[i])) continue;
    const ok = Number.isFinite(c4[i]) ? close9(fill[i], c4[i]) : close9(fill[i], fill[i - 1]);
    if (!ok) invented++;
  }

  // (e) variance inflation and anomaly suppression, inside vs outside the
  //     180-bar windows that follow a zero bar
  const W = 180;
  const tainted = new Set();
  for (const i of zAt) for (let k = i; k < Math.min(zn, i + W); k++) tainted.add(k);
  const rollSd = (a, i) => { const w = a.slice(i - W + 1, i + 1).filter(Number.isFinite); if (w.length < W) return NaN; const m = w.reduce((x, y) => x + y, 0) / w.length; return Math.sqrt(w.reduce((x, y) => x + (y - m) ** 2, 0) / w.length); };
  const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : NaN);
  const stats = (f, z) => {
    const inSd = [], outSd = [], inFire = [], outFire = [];
    for (let i = W; i < zn; i++) {
      const sdv = rollSd(f, i);
      if (Number.isFinite(sdv)) (tainted.has(i) ? inSd : outSd).push(sdv);
      if (Number.isFinite(z[i])) (tainted.has(i) ? inFire : outFire).push(Math.abs(z[i]) >= 1 ? 1 : 0);
    }
    const rate = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
    return { infl: med(inSd) / med(outSd), fireIn: rate(inFire), fireOut: rate(outFire) };
  };
  const F = stats(fill, zf), B = stats(badFill, zb);

  const inflOK = F.infl < 1.25;
  const supprOK = F.fireIn > F.fireOut * 0.5;
  // The control must actually be broken, or this check proves nothing.
  const controlBroken = badArtefact > 0 && (B.infl > 2 || B.fireIn < B.fireOut * 0.5);

  line(21, check(zAt.length >= 5 && obsAtZero === 0 && artefact === 0 && afterOK && invented === 0
    && inflOK && supprOK && controlBroken,
    `zero-OI: ${zAt.length} zero bars, ${obsAtZero} still treated as observations, ${artefact} artefacts, after-zero clean ${afterOK}, ${invented} invented values, sd inflation ${F.infl.toFixed(2)}x, firing ${(F.fireIn * 100).toFixed(1)}% vs ${(F.fireOut * 100).toFixed(1)}%, control broken ${controlBroken}`),
    `zero-OI contamination — ${zAt.length} real zero-OI bars (2024-07 cluster): none forms a change, no -100% artefact reaches the normalisation source, no value is invented, rolling sd inflation ${F.infl.toFixed(2)}x (was ${B.infl.toFixed(2)}x), anomaly firing ${(F.fireIn * 100).toFixed(1)}% inside the affected windows vs ${(F.fireOut * 100).toFixed(1)}% outside (was ${(B.fireIn * 100).toFixed(1)}% vs ${(B.fireOut * 100).toFixed(1)}%)`);
  note(`the v3.0 formula is re-run as a control and still shows ${badArtefact} artefacts and ${B.infl.toFixed(1)}x inflation — if that control ever goes quiet this test has gone blind`);

  // Injected zeros, so the path is exercised even on a dataset without any.
  const inj = rows.map((r, i) => ([400, 700, 701, 900].includes(i) ? { ...r, oi: 0 } : r));
  const ictx = await new PineTS(makeProvider(buildSeries(inj)), CHART, '240', inj.length).run(BASE);
  const iObs = ser(ictx, 't_oiObs'), iFill = ser(ictx, 't_oiFill4');
  const injOK = [400, 700, 701, 900].every((i) => iObs[i] === 0) && iFill.filter((v) => Number.isFinite(v) && v <= -0.9).length === 0;
  check(injOK, 'injected zero-OI bars still produce an observation or an artefact');
  note(`injected zeros at 4 bar positions: refused as observations and produced no artefact — ${injOK ? 'ok' : 'FAILED'}`);
}

// ================================ 22. liquidation paired-unit contract ========
// (long - short) / (long + short) subtracts one feed from the other. Landing
// inside [-1, +1] is arithmetic, not evidence: two unrelated scales land there
// too, and the number looks entirely reasonable.
{
  const unpaired = await run(rows, { source: withAdapters(BASE) });   // withAdapters declares pairing
  const noDecl = await run(rows, {
    source: rewrite(withAdapters(BASE), /input\.bool\(true, "  Long and short liquidations share one source and unit"/,
      'input.bool(false, "  Long and short liquidations share one source and unit"', 'undeclare pairing'),
  });
  const balPaired = ser(unpaired, 't_liqBal');
  const balNone = ser(noDecl, 't_liqBal');
  const zNone = ser(noDecl, 't_liqBZ'), pNone = ser(noDecl, 't_liqBP');
  const tblNone = readTable(noDecl).join('\n');

  // Mismatched scales, pairing wrongly declared: the balance still sits inside
  // [-1, +1] and still looks like a reading. This is the demonstration that
  // range is not a validity check.
  let misSrc = declarePairedTest(enable(enable(BASE, 'long-liquidation'), 'short-liquidation'));
  misSrc = wire(misSrc, 'Long liquidations', LIQL);
  misSrc = wire(misSrc, 'Short liquidations', 'extLiqS    = math.abs(high - low) * volume * 0.7 * 1000000.0');
  const mismatched = await run(rows, { source: misSrc });
  const balMis = fin(ser(mismatched, 't_liqBal'));
  const inRange = balMis.every((v) => v >= -1 && v <= 1);
  const pinned = balMis.filter((v) => v < -0.99).length / Math.max(1, balMis.length);

  const withheld = balNone.every((v) => Number.isNaN(v)) && zNone.every((v) => Number.isNaN(v))
    && pNone.every((v) => Number.isNaN(v)) && tblNone.includes('DATA INCOMPARABLE');
  const computed = fin(balPaired).length > nb * 0.5;

  line(22, check(withheld && computed && inRange && pinned > 0.99,
    `liq pairing: withheld ${withheld}, computed ${computed}, mismatched in range ${inRange}, pinned ${(pinned * 100).toFixed(1)}%`),
    `liquidation paired-unit contract — with both feeds live but the shared unit NOT declared, the balance, its z and its percentile are all withheld and the row reads DATA INCOMPARABLE; declared, it computes on ${fin(balPaired).length}/${nb} bars`);
  note(`with a 1,000,000x scale mismatch and pairing wrongly declared, ${(pinned * 100).toFixed(1)}% of bars still land inside [-1,+1] (pinned at -1) — which is exactly why staying in range is not treated as a validity check`);
}

// ========================= 23. adapter freshness is a heuristic, and says so ===
// Reference / spot / OI / SOPR return their own bar time, so lag is measured.
// An input.source() returns a number and nothing else. Calling the second one
// "FRESH" would be a claim the script cannot support.
{
  const t = readTable(full);
  const tsStart = t.findIndex((r) => r.includes('DATA HEALTH — timestamp-verified'));
  const adStart = t.findIndex((r) => r.includes('DATA HEALTH — external adapters'));
  const tsRows = t.slice(tsStart + 1, adStart);
  const adRows = t.slice(adStart + 1, adStart + 6);
  const TS_WORDS = ['FRESH', '1 BAR OLD', '1D OLD', 'STALE', 'UNAVAILABLE', 'MISCONFIGURED'];
  const AD_WORDS = ['ACTIVE', 'UNCHANGED', 'LIKELY STALE', 'MISCONFIGURED', 'UNAVAILABLE', 'BALANCE'];
  const adClaimsFresh = adRows.filter((r) => /\bFRESH\b/.test(r)).length;
  const tsClaimsActive = tsRows.filter((r) => /\bACTIVE\b/.test(r)).length;
  const adVocab = adRows.every((r) => AD_WORDS.some((w) => r.includes(w)));
  const tsVocab = tsRows.every((r) => TS_WORDS.some((w) => r.includes(w)));

  // The heuristic's false positive, demonstrated rather than hidden: a feed that
  // is alive and legitimately constant reads LIKELY STALE.
  const constSrc = wire(enable(BASE, 'funding'), 'Aggregated funding rate', 'extFunding = 0.0001 * (bar_index >= 0 ? 1 : 1) + close * 0.0');
  const constRun = await run(rows, { source: constSrc });
  const C = decode(constRun);
  const constTail = C.stat.fd.slice(300);
  const readsLikelyStale = constTail.length > 0 && constTail.every((x) => x === 2 || x === 1);
  const readmeAdmits = readFileSync(new URL('./README.md', import.meta.url), 'utf8')
    .includes('update-activity heuristic');

  line(23, check(adClaimsFresh === 0 && tsClaimsActive === 0 && adVocab && tsVocab && readsLikelyStale && readmeAdmits,
    `vocab split: adapters claiming FRESH ${adClaimsFresh}, timestamped claiming ACTIVE ${tsClaimsActive}, adapter vocab ok ${adVocab}, ts vocab ok ${tsVocab}, constant-feed heuristic ${readsLikelyStale}, README admits ${readmeAdmits}`),
    `freshness vocabularies do not mix — ${tsRows.length} timestamp-verified rows use FRESH/OLD/STALE, ${adRows.length} adapter rows use ACTIVE/UNCHANGED/LIKELY STALE and never say FRESH`);
  note('a live but legitimately constant feed reads LIKELY STALE, which is the heuristic\'s false positive; it is documented as a heuristic in README rather than presented as measured freshness');
}

// ================================= 24. funding unit and ETF source shape =====
{
  // Funding: scale must reach the DISPLAY and nothing else. z and percentile are
  // scale-free, so if they moved, the canonicalisation is wired wrongly.
  const DEF_UNIT = 'Decimal (0.0001 = 0.01%)';
  const fsrc = (unit) => {
    const base = wire(enable(BASE, 'funding'), 'Aggregated funding rate',
      'extFunding = (close - ta.sma(close, 20)) / ta.sma(close, 20) * 0.05');
    return unit === DEF_UNIT ? base
      : rewrite(base, /input\.string\("Decimal \(0\.0001 = 0\.01%\)", "  Funding unit"/,
        `input.string("${unit}", "  Funding unit"`, `funding unit ${unit}`);
  };
  const dec = await run(rows, { source: fsrc('Decimal (0.0001 = 0.01%)') });
  const pct = await run(rows, { source: fsrc('Percent (0.01 = 0.01%)') });
  const rd = ser(dec, 't_fundRaw'), rp = ser(pct, 't_fundRaw');
  const zd = ser(dec, 't_fundZ'), zp = ser(pct, 't_fundZ');
  let scaleBad = 0, zBad = 0;
  for (let i = 0; i < nb; i++) {
    if (!Number.isFinite(rd[i]) || !Number.isFinite(rp[i])) continue;
    if (Math.abs(rp[i] * 100 - rd[i]) > Math.abs(rd[i]) * 1e-9 + 1e-15) scaleBad++;
    // z is scale-free by construction; allow only float-noise, which is orders
    // of magnitude below the 100x a mis-wired canonicalisation would produce.
    if (Number.isFinite(zd[i]) && Number.isFinite(zp[i]) && Math.abs(zd[i] - zp[i]) > 1e-4) zBad++;
  }

  // ETF: a daily value repeated across all six 4H bars of a day. Summing 30 bars
  // counts every day six times; sampling one bar per day does not.
  const DEF_SHAPE = 'Daily value, repeated within the day';
  const esrc = (shape) => {
    const base = wire(enable(BASE, 'ETF flow'), 'US spot BTC ETF net flow',
      'extEtf     = math.floor(bar_index / 6) * 1000.0 + close * 0.0');
    return shape === DEF_SHAPE ? base
      : rewrite(base, /input\.string\("Daily value, repeated within the day", "  ETF source shape"/,
        `input.string("${shape}", "  ETF source shape"`, `etf shape ${shape}`);
  };
  const daily = await run(rows, { source: esrc('Daily value, repeated within the day') });
  const incr = await run(rows, { source: esrc('Per-bar increment') });
  const ed = ser(daily, 't_etf5d'), ei = ser(incr, 't_etf5d');
  let sixBad = 0, dayBad = 0, checked = 0;
  for (let i = 200; i < nb; i++) {
    if (!Number.isFinite(ed[i]) || !Number.isFinite(ei[i])) continue;
    // The 6x relation is exact only on the last bar of a day, where the 30-bar
    // increment window covers five whole days. Off that boundary the window
    // straddles days and the two are legitimately different numbers.
    if (i % 6 !== 5) continue;
    checked++;
    if (Math.abs(ei[i] - 6 * ed[i]) > 1e-6) sixBad++;
    const k = Math.floor(i / 6);
    const want = 1000 * (k + (k - 1) + (k - 2) + (k - 3) + (k - 4));
    if (Math.abs(ed[i] - want) > 1e-6) dayBad++;
  }

  line(24, check(scaleBad === 0 && zBad === 0 && checked > 100 && sixBad === 0 && dayBad === 0,
    `adapter contracts: funding scale errors ${scaleBad}, funding z drift ${zBad}, ETF 6x mismatches ${sixBad}/${checked}, ETF daily-sum errors ${dayBad}`),
    `adapter unit contracts — declaring funding in percent instead of decimal changes only the printed rate (exactly 100x, ${scaleBad} errors) and leaves the z-score bit-identical (${zBad} drifts); a daily-shaped ETF plot summed as per-bar increments comes out exactly 6x too large (${checked} bars checked), which is why the shape is an explicit input`);
  note('these are the two ways an adapter can be off by a constant factor while every label still reads plausibly');
}

console.log('\n' + '='.repeat(98));
if (fails.length) {
  console.log(`❌ ${fails.length} failure(s):`);
  fails.slice(0, 15).forEach((f) => console.log('   ' + f));
  process.exit(1);
}
console.log('✅ all checks passed');
console.log(`\nindicator sha256 ${HASH}`);
console.log('\nOFFLINE VERIFIED above. TRADINGVIEW MANUAL VALIDATION REQUIRED for: symbol');
console.log('spelling and history depth, request.security_lower_tf, the input.source() picker,');
console.log('visual layout, alert delivery, and request.footprint(). See TRADINGVIEW-VALIDATION.md.');
console.log('Stability audits: node audit/hysteresis-verify.mjs · node audit/smoothing-audit.mjs');
console.log('                 node audit/oi4h-deseasonalization.mjs');
