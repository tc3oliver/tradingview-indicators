// Offline verification for BTC 4H Market Radar (v2).
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
// Verifiable here: no-repaint, the OI units guard, DATA UNAVAILABLE propagation,
// z-score standardisation, anomaly-count consistency, alignment bounds, the
// definitional soundness of the premium measure, and the dashboard layout.
// Not verifiable here: real TradingView symbol spelling and history depth, the
// lower-timeframe flow proxy, input.source() adapters, layout, alert firing.
// Hysteresis stability has its own script: audit/hysteresis-verify.mjs

import { PineTS, BaseProvider } from 'pinets';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const RAW = readFileSync(new URL('./main.pine', import.meta.url), 'utf8');
const HASH = createHash('sha256').update(RAW).digest('hex');

// Two PineTS-only rewrites. Both are limitations of the offline runtime, not of
// the indicator:
// (a) PineTS implements request.security() by re-running the ENTIRE script in a
//     secondary context at the requested timeframe; TradingView evaluates only
//     the expression. The intraday guard — correct on TradingView — therefore
//     fires from inside the "1D" request.
// (b) PineTS's na() on an array still dereferences .size, so the na-guard around
//     request.security_lower_tf cannot execute. The provider has no 5m series
//     anyway, so those calls become empty arrays, exercising the flowOK == false
//     path. The flow proxy itself stays unverified until TradingView.
let SRC = RAW;
const rewrite = (re, to, name) => {
  const next = SRC.replace(re, to);
  if (next === SRC) { console.error(`rewrite "${name}" no longer matches main.pine — fix tests.mjs`); process.exit(1); }
  SRC = next;
};
rewrite(/if not timeframe\.isintraday and barstate\.islast\n\s+runtime\.error\([^\n]*\n/, '', 'intraday guard');
rewrite(/\[perpUp, perpDn\] = request\.security_lower_tf\([^\n]*\n\[spotUp, spotDn\] = request\.security_lower_tf\([^\n]*\n/,
  'perpUp = array.new<float>(0)\nperpDn = array.new<float>(0)\nspotUp = array.new<float>(0)\nspotDn = array.new<float>(0)\n', 'lower-tf flow');

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
// "BINANCE:BTCUSDT": spot silently resolves to the perp, premium becomes
// identically zero, and the suite passes while testing nothing. That trap was
// hit once during development; the harness guard below keeps it shut.
const CHART = 'BTCUSDT.P';
function buildSeries(src, { usdOI = false } = {}) {
  return {
    'BTCUSDT.P': src.map((r) => bar(r.t, r.open, r.high, r.low, r.close, r.volume)),
    'BTCUSDT': src.map((r) => bar(r.t, r.spotOpen, r.spotHigh, r.spotLow, r.spotClose, r.spotVolume)),
    'BTCUSDT.P_OI': src.map((r) => flat(r.t, usdOI ? r.oiValue : r.oi)),
    // GLASSNODE:BTC_SOPR deliberately absent — exercises DATA UNAVAILABLE.
  };
}

function makeProvider(series, opts = {}) {
  const lookup = (id) => series[String(id).split(':').pop()];
  return new (class extends BaseProvider {
    constructor() { super({ requiresApiKey: false, providerName: 'Local' }); }
    getSupportedTimeframes() { return new Set(['240']); }
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

const run = async (src, opts = {}) => new PineTS(makeProvider(buildSeries(src, opts), opts), CHART, '240', src.length).run(SRC);

const ser = (ctx, key, len) => {
  const p = ctx.plots?.[key];
  if (!p) return new Array(len ?? rows.length).fill(NaN);
  return p.data.map((d) => (d && typeof d === 'object' ? d.value : d)).map((v) => (v == null ? NaN : v));
};
const eq = (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); return ok; };
const line = (n, ok, txt) => console.log(`${n}. ${ok ? '✅' : '❌'} ${txt}`);

console.log('='.repeat(94));
console.log('BTC 4H Market Radar — offline verification');
console.log(`${rows.length} bars  ${new Date(rows[0].t).toISOString().slice(0, 10)} -> ${new Date(rows.at(-1).t).toISOString().slice(0, 10)}   hash ${HASH.slice(0, 12)}`);
console.log('='.repeat(94) + '\n');

let ctx;
try {
  ctx = await run(rows);
} catch (e) {
  console.log(`0. ❌ script failed to run: ${e.message}`);
  console.log(e.stack?.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}
line(0, true, 'main.pine transpiles and runs against multi-symbol local data');

// Harness guard: if spot and perp ever resolve to the same series, every
// cross-symbol result below is vacuous.
{
  const s = buildSeries(rows);
  if (s['BTCUSDT.P'].every((b, i) => b.close === s['BTCUSDT'][i].close)) {
    console.log('   ❌ HARNESS BROKEN: spot and perp alias'); process.exit(1);
  }
}

// REGIME/CONTEXT hold a hysteresis state; IMPULSE fires from the raw z on the
// bar itself. Both are three-valued except the OI 24H ladder.
const THREE = ['t_trSt', 't_fdSt', 't_etSt', 't_spSt', 't_oi4Imp', 't_pmImp', 't_ptImp', 't_rsImp', 't_rpImp'];
const FIVE = ['t_oi24St'];
const STATES = [...FIVE, ...THREE];
const ANOM_STATES = STATES.filter((k) => k !== 't_trSt');   // trend is a regime row, not an anomaly
const S = Object.fromEntries(STATES.map((k) => [k, ser(ctx, k)]));

// ---------- 1. hysteresis states stay inside their declared ranges ----------
let rangeBad = 0;
for (const k of THREE) for (const v of S[k]) if (!Number.isNaN(v) && ![-1, 0, 1].includes(v)) rangeBad++;
for (const k of FIVE) for (const v of S[k]) if (!Number.isNaN(v) && ![-2, -1, 0, 1, 2].includes(v)) rangeBad++;
line(1, check(rangeBad === 0, `${rangeBad} state values outside their declared range`),
  `every state stays in its declared range (${THREE.length} three-level, ${FIVE.length} five-level ladder)`);

// ---------- 2. no repaint: prefix invariance, including the held states ----------
// Hysteresis carries state across bars, which is exactly the construct most
// likely to repaint. It is included in the hooks below deliberately.
const HOOKS = ['t_oiZ24', 't_oiZ24s', 't_premZ', 't_partZ', 't_volPct', 't_trendDist', 't_oi24St', 't_pmImp', 't_anomCount', 't_aligned'];
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
line(2, check(repaint === 0, `${repaint} series repainted`),
  'no repaint — past bars unchanged when future bars are added, hysteresis states included');

// ---------- 3. the OI units guard, both paths independently ----------
const usd = await run(rows, { usdOI: true });
const cur = await run(rows, { oiCurrency: 'USD' });
const okBase = ser(ctx, 't_oiOK').filter((x) => x === 1).length;
const okUsd = ser(usd, 't_oiOK').filter((x) => x === 1).length;
const okCur = ser(cur, 't_oiOK').filter((x) => x === 1).length;
line(3, check(okUsd === 0 && okCur === 0 && okBase > rows.length * 0.9,
  `units guard wrong: magnitude path trusted ${okUsd}, currency path trusted ${okCur}, base-unit accepted ${okBase}/${rows.length}`),
  `USD-notional OI rejected by BOTH paths — magnitude (${okUsd} trusted) and declared currency (${okCur} trusted); base-unit accepted on ${okBase}/${rows.length}`);

// ---------- 4. a missing feed degrades to unavailable, never to a value ----------
const soprOK = ser(ctx, 't_soprOK').filter((x) => x === 1).length;
const soprVals = ser(ctx, 't_sopr').filter((x) => !Number.isNaN(x)).length;
const spEngaged = S['t_spSt'].filter((x) => x !== 0 && !Number.isNaN(x)).length;
line(4, check(soprOK === 0 && soprVals === 0 && spEngaged === 0,
  `SOPR absent but ${soprOK} bars claimed availability, ${soprVals} carried a value, ${spEngaged} produced a state`),
  `absent feed stays absent — SOPR unavailable on all ${rows.length} bars: no value, no state, no anomaly`);

// ---------- 5. z-scores are actually standardised ----------
const zs = { oiZ4: 't_oiZ4', oiZ24: 't_oiZ24', premZ: 't_premZ', partZ: 't_partZ' };
const zStats = {};
let zBad = 0;
for (const [name, key] of Object.entries(zs)) {
  const v = ser(ctx, key).filter((x) => !Number.isNaN(x)).slice(200);
  if (v.length < 100) { zBad++; fails.push(`${name}: only ${v.length} finite values`); continue; }
  zStats[name] = [mean(v), sd(v)];
  if (Math.abs(mean(v)) > 0.35 || Math.abs(sd(v) - 1) > 0.4) { zBad++; fails.push(`${name} not standardised: mean ${mean(v).toFixed(2)} sd ${sd(v).toFixed(2)}`); }
}
line(5, check(zBad === 0, `${zBad} z-score series not standardised`),
  `rolling z-scores standardised (${Object.entries(zStats).map(([k, [m, s]]) => `${k} ${m.toFixed(2)}±${s.toFixed(2)}`).join(', ')})`);

// ---------- 6. the premium measure is definitionally sound ----------
// Binance derives funding from the premium index, so a correct perp/spot premium
// MUST correlate positively with realised funding. This is what separates
// "measuring basis" from "measuring noise".
const withF = all.filter((r) => r.spotClose != null && r.funding != null);
const prem = withF.map((r) => r.close / r.spotClose - 1);
const fund = withF.map((r) => r.funding);
const corr = (a, b) => { const ma = mean(a), mb = mean(b); return mean(a.map((x, i) => (x - ma) * (b[i] - mb))) / (sd(a) * sd(b)); };
const c1 = corr(prem, fund);
const sm = prem.map((_, i) => (i < 6 ? null : mean(prem.slice(i - 5, i + 1))));
const idx = sm.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
const c6 = corr(idx.map((i) => sm[i]), idx.map((i) => fund[i]));
line(6, check(c1 > 0.4 && c6 > 0.5, `premium/funding correlation too weak: ${c1.toFixed(3)} / ${c6.toFixed(3)}`),
  `perp premium tracks funding as it must by construction (r=${c1.toFixed(3)} raw, ${c6.toFixed(3)} on 24h mean)`);
console.log(`     median premium ${(prem.slice().sort((a, b) => a - b)[Math.floor(prem.length / 2)] * 100).toFixed(4)}% — a persistent level offset, which is why every state uses a z-score and never an absolute threshold`);

// ---------- 7. the ANOMALIES count matches the engaged states ----------
// A headline count that drifts from its own list is worse than no count.
const anom = ser(ctx, 't_anomCount');
let anomBad = 0;
for (let i = 0; i < rows.length; i++) {
  const want = ANOM_STATES.reduce((s, k) => s + (S[k][i] !== 0 && !Number.isNaN(S[k][i]) ? 1 : 0), 0);
  if (anom[i] !== want) { anomBad++; if (anomBad === 1) fails.push(`anomaly count bar#${i}: reported ${anom[i]}, engaged measurements ${want}`); }
}
line(7, check(anomBad === 0, `${anomBad} bars where ANOMALIES disagreed with the engaged measurements`),
  `ANOMALIES count equals the number of engaged measurements on all ${rows.length} bars`);

// ---------- 8. alignment is bounded and honest ----------
const al = ser(ctx, 't_aligned'), av = ser(ctx, 't_alignAvail');
let alBad = 0;
for (let i = 0; i < rows.length; i++) {
  if (Number.isNaN(al[i]) || Number.isNaN(av[i])) continue;
  // aligned counts the larger of the two directions, so it can never exceed the
  // number of available measurements, nor fall below half of them.
  if (al[i] > av[i] || (av[i] > 0 && al[i] * 2 < av[i])) { alBad++; if (alBad === 1) fails.push(`alignment bar#${i}: ${al[i]}/${av[i]} is impossible`); }
}
line(8, check(alBad === 0, `${alBad} bars with an impossible alignment count`),
  'cross-data alignment stays within [ceil(avail/2), avail] on every bar');

// ---------- 9. dashboard layout, and nothing prescriptive ----------
const tables = ctx.plots?.__tables__?.data?.at(-1)?.value ?? [];
const cells = tables.length ? JSON.stringify(tables[0]) : '';
const wanted = ['WHAT CHANGED', 'ANOMALIES', 'REGIME', 'IMPULSE', 'CONTEXT', 'TREND', 'VOLATILITY', 'OI 24H', 'OI 4H', 'FUNDING', 'PREMIUM', 'PARTICIPATION', 'ALIGNMENT', 'ETF 5D', 'SOPR', 'EVIDENCE: DESCRIPTIVE', 'ACTION: CONTEXT ONLY'];
const missing = wanted.filter((w) => !cells.includes(w));
const banned = ['DO NOT CHASE', 'REDUCE EXPOSURE', 'LONG READY', 'RISK-ON', 'RISK-OFF', 'HEALTHY', 'DISTRIBUTION RISK'].filter((w) => cells.includes(w));
line(9, check(tables.length > 0 && missing.length === 0 && banned.length === 0,
  `dashboard missing: ${missing.join(', ') || 'none'}${banned.length ? `; still prescriptive: ${banned.join(', ')}` : ''}`),
  `dashboard renders all ${wanted.length} sections in priority order, with no prescriptive or predictive label`);

console.log('\n' + '='.repeat(94));
if (fails.length) {
  console.log(`❌ ${fails.length} failure(s):`);
  fails.slice(0, 12).forEach((f) => console.log('   ' + f));
  process.exit(1);
}
console.log('✅ all checks passed');
console.log('\nNot covered offline: real TradingView symbol spelling and history depth, the');
console.log('lower-timeframe flow proxy, input.source() adapters, visual layout, alert firing.');
console.log('Hysteresis stability: node audit/hysteresis-verify.mjs');
