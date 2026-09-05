// Runs the FROZEN main.pine over the full dataset and caches every per-bar
// number the indicator emits, so the audits measure what the indicator actually
// produces rather than a JavaScript paraphrase of it. A reimplementation would
// be the easiest possible way to accidentally audit a different indicator.
//
// Output: states.json { hash, cohort, generated, bars: [...] }
// Generated, 20+ MB, not committed. Rebuild with `node extract-states.mjs`.

import { PineTS, BaseProvider } from 'pinets';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describeCohort, cohortId } from './cohort.mjs';

const PINE = new URL('../main.pine', import.meta.url);
const RAW = readFileSync(PINE, 'utf8');
const HASH = createHash('sha256').update(RAW).digest('hex');

// Same two PineTS-only rewrites as tests.mjs, for the same reasons: PineTS
// re-runs the whole script inside request.security(), and its na() cannot
// handle an na array. Neither alters a definition.
let SRC = RAW;
const rewrite = (re, to, name) => {
  const next = SRC.replace(re, to);
  if (next === SRC) { console.error(`rewrite "${name}" no longer matches main.pine`); process.exit(1); }
  SRC = next;
};
rewrite(/if not tfOK\n\s+runtime\.error\([^\n]*\n/, '', 'tf guard');
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
  console.error('spot and reference alias — extraction would be meaningless'); process.exit(1);
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
const t0 = Date.now();
const ctx = await new PineTS(provider, 'BTCUSDT.P', '240', rows.length).run(SRC);

const ser = (k) => {
  const p = ctx.plots?.[k];
  if (!p) return new Array(rows.length).fill(NaN);
  return p.data.map((d) => (d && typeof d === 'object' ? d.value : d)).map((v) => (v == null ? NaN : v));
};

// Scalar hooks, stored under their bare names.
const K = ['refClose', 'atr14', 'volPct', 'trendDist', 'mom12w', 'px24',
  'oiChg4', 'oiChg24', 'oiZ4', 'oiZ24', 'oiZ24s', 'oiP4', 'oiP24',
  'premium', 'premZ', 'premP', 'partRaw', 'partZ', 'partP',
  'rvolSpot', 'rvolSpotZ', 'rvolSpotP', 'rvolPerp', 'rvolPerpZ', 'rvolPerpP',
  'fundRaw', 'fundZ', 'fundP', 'etf5d', 'etfZ', 'etfP',
  'liqLZ', 'liqLP', 'liqSZ', 'liqSP', 'liqBal', 'liqBZ',
  'sopr', 'soprDev', 'trSt', 'spSt', 'oi24St', 'anomCount', 'maxExt', 'changed', 'evCount', 'oiOK'];
const D = Object.fromEntries(K.map((k) => [k, ser('t_' + k)]));

// The packed hooks, unpacked back into named fields. Order must match the plot
// expressions at the foot of main.pine.
const unpack = (v, base, n) => {
  if (!Number.isFinite(v)) return new Array(n).fill(0);
  const out = []; let x = Math.round(v);
  for (let i = 0; i < n; i++) { out.push(x % base); x = Math.floor(x / base); }
  return out;
};
const STAT = ['refStat', 'spotStat', 'oiStat', 'dailyStat', 'soprStat', 'fdStat', 'etStat', 'lLStat', 'lSStat'];
const DIRK = ['oi24Dir', 'oi4Dir', 'pmDir', 'fdDir', 'etDir', 'ptDir', 'rsDir', 'rpDir', 'lqBDir', 'mechPx', 'mechOi'];
const LVLK = ['oi24Lvl', 'oi4Lvl', 'pmLvl', 'fdLvl', 'etLvl', 'ptLvl', 'rsLvl', 'rpLvl', 'lqLLvl', 'lqSLvl'];
const sp = ser('t_statPack'), dp = ser('t_dirPack'), lp = ser('t_lvlPack');

const out = rows.map((r, i) => {
  const o = { t: r.t, open: r.open, high: r.high, low: r.low, close: r.close, oiRaw: r.oi };
  for (const k of K) o[k] = D[k][i];
  const s = unpack(sp[i], 5, 9), d = unpack(dp[i], 3, 11), l = unpack(lp[i], 3, 10);
  STAT.forEach((k, j) => { o[k] = s[j]; });
  DIRK.forEach((k, j) => { o[k] = d[j] - 1; });
  LVLK.forEach((k, j) => { o[k] = l[j]; });
  // Composite states, the way the dashboard and the event log read them.
  o.oi4St = o.oi4Lvl * o.oi4Dir;
  o.pmSt = o.pmLvl * o.pmDir;
  o.fdSt = o.fdLvl * o.fdDir;
  o.etSt = o.etLvl * o.etDir;
  o.ptSt = o.ptLvl * o.ptDir;
  return o;
});

const cohort = describeCohort(PINE, null);
writeFileSync(new URL('./states.json', import.meta.url), JSON.stringify({
  hash: HASH, cohort, cohortIdNoFreeze: cohortId({ ...cohort, freeze: 'n/a' }),
  generated: rows.at(-1).t, bars: out,
}));

console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
console.log(`${rows.length} bars  ${new Date(rows[0].t).toISOString().slice(0, 10)} -> ${new Date(rows.at(-1).t).toISOString().slice(0, 10)}\n`);

// ---- how often each measure is engaged, and for how long ----
const MEAS = {
  trSt: 'TREND [regime]', oi24Lvl: 'OI 24H [regime]',
  fdLvl: 'FUNDING [context]', etLvl: 'ETF [context]', spSt: 'SOPR [context]',
  lqLLvl: 'LONG LIQ [context]', lqSLvl: 'SHORT LIQ [context]',
  oi4Lvl: 'OI 4H [impulse]', pmLvl: 'PREMIUM [impulse]', ptLvl: 'PARTICIP [impulse]',
  rsLvl: 'SPOT RVOL [impulse]', rpLvl: 'PERP RVOL [impulse]',
};

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

console.log('MEASURE                  engaged bars   episodes   median len');
for (const [k, name] of Object.entries(MEAS)) {
  const r = runs(out.map((b) => b[k]));
  console.log(`  ${name.padEnd(23)}${String(r.bars).padStart(9)}${String(r.episodes).padStart(11)}${String(r.med).padStart(13)}`);
}

const ac = out.map((b) => b.anomCount).filter(Number.isFinite);
const hist = {};
for (const x of ac) hist[x] = (hist[x] ?? 0) + 1;
console.log(`\nANOMALIES per bar: mean ${(ac.reduce((s, x) => s + x, 0) / ac.length).toFixed(2)}   distribution ${Object.entries(hist).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${((v / ac.length) * 100).toFixed(0)}%`).join('  ')}`);
const ch = out.filter((b) => b.changed === 1).length;
console.log(`bars reporting a change since the last confirmed bar: ${ch} (${((ch / rows.length) * 100).toFixed(1)}%)`);

// ---- the v3 question the v2 design could not answer: how often does the
// direction word flip while the measure is engaged? A direction taken from the
// raw sign is honest but has no hysteresis of its own, so this is the price.
let dirFlips = 0, engagedBars = 0;
for (let i = 1; i < out.length; i++) {
  if (out[i].oi24Lvl > 0 && out[i - 1].oi24Lvl > 0) {
    engagedBars++;
    if (out[i].oi24Dir !== 0 && out[i - 1].oi24Dir !== 0 && out[i].oi24Dir !== out[i - 1].oi24Dir) dirFlips++;
  }
}
console.log(`\nOI 24H direction flips while engaged: ${dirFlips} of ${engagedBars} consecutive engaged bars (${((dirFlips / Math.max(1, engagedBars)) * 100).toFixed(2)}%)`);
console.log('  A raw-sign direction has no hysteresis by design. If this were large, the');
console.log('  label would rattle between EXPANSION and REDUCTION while staying UNUSUAL.');

console.log('\nwrote states.json');
