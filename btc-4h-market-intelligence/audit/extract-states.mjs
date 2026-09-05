// Runs the FROZEN main.pine over the full dataset and caches per-bar state
// codes, so the audit measures what the indicator actually emits rather than a
// JavaScript paraphrase of it. A reimplementation would be the easiest possible
// way to accidentally audit a different indicator.
//
// Output: states.json  { hash, bars:[{t, market, trend, part, crowd, lev, risk, atr}] }

import { PineTS, BaseProvider } from 'pinets';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const RAW = readFileSync(new URL('../main.pine', import.meta.url), 'utf8');
const HASH = createHash('sha256').update(RAW).digest('hex');

// Same two PineTS-only rewrites as tests.mjs, for the same reasons: PineTS
// re-runs the whole script inside request.security(), and its na() cannot
// handle an na array. Neither alters a state definition.
let SRC = RAW;
const rewrite = (re, to, name) => {
  const next = SRC.replace(re, to);
  if (next === SRC) { console.error(`rewrite "${name}" no longer matches main.pine`); process.exit(1); }
  SRC = next;
};
rewrite(/if not timeframe\.isintraday and barstate\.islast\n\s+runtime\.error\([^\n]*\n/, '', 'intraday guard');
rewrite(/\[perpUp, perpDn\] = request\.security_lower_tf\([^\n]*\n\[spotUp, spotDn\] = request\.security_lower_tf\([^\n]*\n/,
  'perpUp = array.new<float>(0)\nperpDn = array.new<float>(0)\nspotUp = array.new<float>(0)\nspotDn = array.new<float>(0)\n', 'lower-tf flow');

const all = JSON.parse(readFileSync(new URL('../../btc-4h-regime-engine/data/cache/btc-4h.json', import.meta.url), 'utf8'));
const rows = all.filter((r) => r.spotClose != null && r.oi != null);

const H4 = 4 * 3600_000;
const bar = (t, o, h, l, c, v) => ({
  openTime: t, open: o, high: h, low: l, close: c, volume: v, closeTime: t + H4 - 1,
  quoteAssetVolume: v * c, numberOfTrades: 1, takerBuyBaseAssetVolume: v / 2, takerBuyQuoteAssetVolume: (v / 2) * c, ignore: '0',
});
const flat = (t, x) => bar(t, x, x, x, x, 0);

// Chart is the perp, so BINANCE:BTCUSDT (spot) cannot alias onto it.
const series = {
  'BTCUSDT.P': rows.map((r) => bar(r.t, r.open, r.high, r.low, r.close, r.volume)),
  'BTCUSDT': rows.map((r) => bar(r.t, r.spotOpen, r.spotHigh, r.spotLow, r.spotClose, r.spotVolume)),
  'BTCUSDT.P_OI': rows.map((r) => flat(r.t, r.oi)),
};
if (series['BTCUSDT.P'].every((b, i) => b.close === series['BTCUSDT'][i].close)) {
  console.error('spot and perp alias — extraction would be meaningless'); process.exit(1);
}

const provider = new (class extends BaseProvider {
  constructor() { super({ requiresApiKey: false, providerName: 'Local' }); }
  getSupportedTimeframes() { return new Set(['240']); }
  async _getMarketDataNative(id) { return series[String(id).split(':').pop()] ?? []; }
  async getSymbolInfo(id) {
    const isOI = String(id).includes('_OI');
    return { ticker: id, name: id, type: 'crypto', currency: isOI ? 'NONE' : 'USDT', basecurrency: 'BTC', timezone: 'Etc/UTC', minmov: 1, pricescale: 100 };
  }
})();

console.log(`running frozen main.pine (${HASH.slice(0, 12)}) over ${rows.length} bars...`);
const ctx = await new PineTS(provider, 'BTCUSDT.P', '240', rows.length).run(SRC);

const ser = (k) => {
  const p = ctx.plots?.[k];
  if (!p) return new Array(rows.length).fill(NaN);
  return p.data.map((d) => (d && typeof d === 'object' ? d.value : d)).map((v) => (v == null ? NaN : v));
};
// v2 hooks: normalised inputs plus the hysteresis-held state of each measure.
const K = ['t_oiZ4', 't_oiZ24', 't_premZ', 't_partZ', 't_rvolSpotZ', 't_rvolPerpZ', 't_volPct', 't_trendDist',
           't_oiZ24s', 't_trSt', 't_oi24St', 't_fdSt', 't_etSt', 't_spSt',
           't_oi4Imp', 't_pmImp', 't_ptImp', 't_rsImp', 't_rpImp',
           't_anomCount', 't_aligned', 't_alignAvail', 't_changed'];
const D = Object.fromEntries(K.map((k) => [k.slice(2), ser(k)]));

const out = rows.map((r, i) => {
  const o = { t: r.t, open: r.open, high: r.high, low: r.low, close: r.close };
  for (const k of Object.keys(D)) o[k] = D[k][i];
  return o;
});

writeFileSync(new URL('./states.json', import.meta.url), JSON.stringify({ hash: HASH, generated: rows.at(-1).t, bars: out }));

// ---- how often each measure is engaged, and for how long ----
const MEAS = { trSt: 'TREND [regime]', oi24St: 'OI 24H [regime]', fdSt: 'FUNDING [context]',
               etSt: 'ETF [context]', spSt: 'SOPR [context]', oi4Imp: 'OI 4H [impulse]',
               pmImp: 'PREMIUM [impulse]', ptImp: 'PARTICIP [impulse]',
               rsImp: 'SPOT RVOL [impulse]', rpImp: 'PERP RVOL [impulse]' };

function runs(v) {
  const lens = [];
  let cur = 0;
  for (let i = 0; i < v.length; i++) {
    const on = v[i] !== 0 && Number.isFinite(v[i]);
    if (on) cur++;
    else if (cur) { lens.push(cur); cur = 0; }
  }
  if (cur) lens.push(cur);
  lens.sort((a, b) => a - b);
  return { episodes: lens.length, bars: lens.reduce((s, x) => s + x, 0), med: lens.length ? lens[lens.length >> 1] : 0 };
}

console.log(`
${rows.length} bars  ${new Date(rows[0].t).toISOString().slice(0, 10)} -> ${new Date(rows.at(-1).t).toISOString().slice(0, 10)}
`);
console.log('MEASURE                  engaged bars   episodes   median len');
for (const [k, name] of Object.entries(MEAS)) {
  const r = runs(D[k]);
  console.log(`  ${name.padEnd(23)}${String(r.bars).padStart(9)}${String(r.episodes).padStart(11)}${String(r.med).padStart(13)}`);
}
const ac = D.anomCount.filter(Number.isFinite);
const hist = {};
for (const x of ac) hist[x] = (hist[x] ?? 0) + 1;
console.log(`
ANOMALIES per bar: mean ${(ac.reduce((s, x) => s + x, 0) / ac.length).toFixed(2)}   distribution ${Object.entries(hist).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${((v / ac.length) * 100).toFixed(0)}%`).join('  ')}`);
const ch = D.changed.filter((x) => x === 1).length;
console.log(`bars reporting a change since the last confirmed bar: ${ch} (${((ch / rows.length) * 100).toFixed(1)}%)`);
console.log(`
wrote states.json`);
