// Shared offline test harness.
//
// PineTS runs the real main.pine on Node, but its bundled Binance provider only
// ever calls /klines — it cannot fetch BTCUSDT.P or _OI. Worse, when a plain
// array is the data source, request.security() on a SECOND symbol silently
// returns the chart's own series with no error, so a suite built that way would
// pass while testing nothing.
//
// Symbols are therefore served by a BaseProvider subclass reading locally
// recorded Binance data. Cross-symbol request.security then resolves offline and
// honours lookahead and the [1] offset.

import { PineTS, BaseProvider } from 'pinets';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const SRC_URL = new URL('../main.pine', import.meta.url);
export const RAW = readFileSync(SRC_URL, 'utf8');
export const HASH = createHash('sha256').update(RAW).digest('hex');

// The two indicators this product replaces, frozen as fixtures. They are the
// only way the migration differential can be re-run after the original
// directories are deleted, which is the whole point of keeping them.
export const BASELINE_RADAR = readFileSync(new URL('./baseline/market-radar-v3.3.pine', import.meta.url), 'utf8');
export const BASELINE_PLANNER = readFileSync(new URL('./baseline/trade-risk-planner-v1.0.pine', import.meta.url), 'utf8');

// PineTS-only rewrites, applied to every run. Both are limitations of the
// offline runtime, not of the indicator:
// (a) PineTS implements request.security() by re-running the ENTIRE script in a
//     secondary context at the requested timeframe; TradingView evaluates only
//     the expression. The timeframe guard — correct on TradingView — would
//     therefore fire from inside the "1D" request. Only the runtime.error line
//     is removed; `tfOK` itself stays and is asserted.
// (b) the baseline used request.security_lower_tf for an estimated flow proxy,
//     which PineTS cannot serve and which this product dropped.
export const rewrite = (src, re, to, name) => {
  const next = src.replace(re, to);
  if (next === src) throw new Error(`rewrite "${name}" no longer matches its source — fix the harness`);
  return next;
};

export const stripGuard = (src) => rewrite(src, /if not tfOK\n\s+runtime\.error\([^\n]*\n/, '', 'tf guard');

export const BASE = stripGuard(RAW);

let baseline = stripGuard(BASELINE_RADAR);
baseline = rewrite(baseline,
  /\[perpUp, perpDn\] = request\.security_lower_tf\([^\n]*\n\[spotUp, spotDn\] = request\.security_lower_tf\([^\n]*\n/,
  'perpUp = array.new<float>(0)\nperpDn = array.new<float>(0)\nspotUp = array.new<float>(0)\nspotDn = array.new<float>(0)\n',
  'baseline lower-tf flow');
export const BASELINE = baseline;

// Adapter rewrites. input.source() cannot be wired from Node — there is no
// second indicator to point at — so the four adapter sources are replaced with
// deterministic expressions at exactly the point where the user's plot would
// arrive. Everything downstream (z, percentile, ladder, direction, freshness,
// labels, anomalies, events, alerts) is the real code path.
export const enable = (src, label) =>
  rewrite(src, new RegExp(`input\\.bool\\(false, "Enable ${label} adapter"`), `input.bool(true, "Enable ${label} adapter"`, `enable ${label}`);
export const wire = (src, label, expr) =>
  rewrite(src, new RegExp(`\\w+\\s*= input\\.source\\(close, "  ${label}"[^\\n]*\\n`), `${expr}\n`, `wire ${label}`);
export const setInput = (src, decl, from, to, name) =>
  rewrite(src, new RegExp(`input\\.${decl}\\(${from},`), `input.${decl}(${to},`, name);
export const asMode = (src, m) =>
  m === 'Decision' ? src : rewrite(src, /input\.string\("Decision", "Detail level"/, `input.string("${m}", "Detail level"`, `mode ${m}`);

// ------------------------------------------------------------ market data ---
const all = JSON.parse(readFileSync(new URL('./data/btc-4h.json', import.meta.url), 'utf8'));
export const N_DEFAULT = +(process.env.BARS ?? 1500);
export const rows = all.slice(-N_DEFAULT).filter((r) => r.spotClose != null);

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
// hit once during development; the guard in the suite keeps it shut.
export const CHART = 'BTCUSDT.P';
// A deliberately non-BTC chart series for the independence test: same bar times,
// completely different prices and volumes.
export const ALT = 'ETHUSDT';

export function buildSeries(src, { usdOI = false } = {}) {
  return {
    'BTCUSDT.P': src.map((r) => bar(r.t, r.open, r.high, r.low, r.close, r.volume)),
    'BTCUSDT': src.map((r) => bar(r.t, r.spotOpen, r.spotHigh, r.spotLow, r.spotClose, r.spotVolume)),
    'BTCUSDT.P_OI': src.map((r) => flat(r.t, usdOI ? r.oiValue : r.oi)),
    // Roughly ETH-shaped: ~1/30 of BTC, inverted intrabar shape, different
    // volume scale. Nothing about it may reach a context reading.
    [ALT]: src.map((r, i) => bar(r.t, r.open / 31 + i, r.high / 29 + i, r.low / 33 + i, r.close / 30 + i, r.volume * 7 + 11)),
  };
}

// The provider is TIMEFRAME-AWARE, and it has to be. This indicator requests 4H
// data from a chart that may be running at 1H, so a provider that returned the
// same array whatever timeframe was asked for would make the lower-timeframe
// tests pass while testing nothing at all — request.security(sym, "240") would
// hand back the chart's own bars and the "context is the previous completed 4H
// bar" claim would never be exercised. `byTf` maps a requested timeframe to its
// own series; anything unmapped falls back to 4H, which is what the daily
// request resolves to offline.
export function makeProvider(byTf, opts = {}) {
  const lookup = (id, tf) => (byTf[tf] ?? byTf['240'])?.[String(id).split(':').pop()];
  return new (class extends BaseProvider {
    constructor() { super({ requiresApiKey: false, providerName: 'Local' }); }
    getSupportedTimeframes() { return new Set(['240', '60', '15']); }
    async _getMarketDataNative(id, tf) { return lookup(id, tf) ?? []; }
    async getSymbolInfo(id) {
      // A base-unit OI feed is not a currency amount, so TradingView reports
      // "NONE". oiCurrency lets a test claim otherwise and check the guard.
      const isOI = String(id).includes('_OI');
      return {
        ticker: id, name: id, type: 'crypto', currency: isOI ? (opts.oiCurrency ?? 'NONE') : 'USDT',
        basecurrency: 'BTC', timezone: 'Etc/UTC', minmov: 1, pricescale: 100,
      };
    }
  })();
}

// `opts.byTf` supplies extra timeframes; without it the chart series is served
// for every request, which is correct when the chart already runs at 4H.
export const run = async (src, opts = {}) => {
  const byTf = { '240': buildSeries(src, opts), ...(opts.byTf ?? {}) };
  const p = new PineTS(makeProvider(byTf, opts), opts.chart ?? CHART, opts.tf ?? '240', src.length);
  if (opts.alertMode) p.setAlertMode(opts.alertMode);
  return p.run(opts.source ?? BASE);
};

// ------------------------------------------------------------- accessors ----
export const ser = (ctx, key, len) => {
  const p = ctx.plots?.[key];
  if (!p) return new Array(len ?? rows.length).fill(NaN);
  return p.data.map((d) => (d && typeof d === 'object' ? d.value : d)).map((v) => (v == null ? NaN : v));
};
export const eq = (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b));
export const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
export const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
export const fin = (a) => a.filter(Number.isFinite);

// Bit order is fixed in main.pine and mirrored here.
export const BOOL_BITS = { tfOK: 1, oiObs: 2, partOK: 4, oiOK: 8, oiNotional: 16, changed: 32, newCtx: 64, planOK: 128, capped: 256 };
export const bser = (ctx, name, len) =>
  ser(ctx, 't_boolPack', len).map((v) => (Number.isFinite(v) ? ((Math.round(v) & BOOL_BITS[name]) ? 1 : 0) : NaN));

// Pack decoders. Order must match the plot expressions at the foot of main.pine.
export const unpack = (v, base, n) => {
  if (!Number.isFinite(v)) return new Array(n).fill(NaN);
  const out = []; let x = Math.round(v);
  for (let i = 0; i < n; i++) { out.push(x % base); x = Math.floor(x / base); }
  return out;
};
export const STAT_KEYS = ['ref', 'spot', 'oi', 'daily', 'fd', 'et', 'lL', 'lS'];
export const DIR_KEYS = ['oi24', 'oi4', 'pm', 'fd', 'et', 'pt', 'rs', 'rp', 'lqB', 'mechPx', 'mechOi'];
export const LVL_KEYS = ['oi24', 'oi4', 'pm', 'fd', 'et', 'pt', 'rs', 'rp', 'lqL', 'lqS'];
export const decode = (ctx) => {
  const sp = ser(ctx, 't_statPack'), dp = ser(ctx, 't_dirPack'), lp = ser(ctx, 't_lvlPack');
  const n = sp.length;
  const out = { stat: {}, dir: {}, lvl: {} };
  for (const k of STAT_KEYS) out.stat[k] = new Array(n);
  for (const k of DIR_KEYS) out.dir[k] = new Array(n);
  for (const k of LVL_KEYS) out.lvl[k] = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = unpack(sp[i], 5, 8), d = unpack(dp[i], 3, 11), l = unpack(lp[i], 3, 10);
    STAT_KEYS.forEach((k, j) => { out.stat[k][i] = s[j]; });
    DIR_KEYS.forEach((k, j) => { out.dir[k][i] = Number.isNaN(d[j]) ? NaN : d[j] - 1; });
    LVL_KEYS.forEach((k, j) => { out.lvl[k][i] = l[j]; });
  }
  return out;
};

// The table is DECLARED at its worst-case height and mostly left empty, so the
// raw cell grid always has 76 rows. Only the rows that were actually written are
// returned — "how tall is the panel" is a question about those, not about the
// declaration.
export const readTable = (ctx) => {
  const t = ctx.plots?.__tables__?.data?.at(-1)?.value?.[0];
  if (!t?.cells) return [];
  return t.cells
    .map((row) => row.map((c) => c?.text ?? '').filter((x, i) => i === 0 || x !== '').join(' | '))
    .filter((line) => line.replace(/\|/g, '').trim() !== '');
};

// ------------------------------------------------------------- reporting ----
export const results = { pass: 0, fail: 0, failures: [] };
let n = 0;
export const check = (ok, msg) => {
  n += 1;
  if (ok) results.pass += 1;
  else { results.fail += 1; results.failures.push(msg); }
  console.log(`${String(n).padStart(3)}. ${ok ? '✅' : '❌'} ${msg}`);
  return ok;
};
export const note = (txt) => console.log(`       ${txt}`);
export const section = (txt) => console.log(`\n── ${txt} ${'─'.repeat(Math.max(0, 86 - txt.length))}`);

// ----------------------------------------------------- Pine branch-type lint -
// PineTS performs no type checking whatsoever, so a mismatch Pine refuses to
// compile (CE10235: "Return type of one of the if or switch blocks is not
// compatible with return type of other block(s)") runs happily here. It cost a
// round-trip through the Pine Editor once: array.shift() RETURNS the element it
// removed, so a branch ending on it typed as series int while its sibling branch
// was void.
export function branchTypeLint(text) {
  const VOID = /^(array\.(set|push|unshift|clear|fill|insert|sort|reverse|splice)|table\.(cell|merge_cells|delete|set_\w+)|label\.(delete|set_\w+)|line\.delete|alert|runtime\.error|log\.\w+)\(/;
  const VALUE = /^(array\.(shift|pop|remove|get|size|max|min|avg|sum|indexof|slice|copy|join)|table\.new|label\.new|line\.new|str\.\w+|math\.\w+)\(/;
  const classify = (t) => (VOID.test(t) ? 'void' : VALUE.test(t) ? 'value' : /:=/.test(t) ? 'assign' : 'other');
  const L = text.split('\n');
  const ind = (x) => x.length - x.trimStart().length;
  const bad = [];
  for (let i = 0; i < L.length; i++) {
    if (L[i].trim() !== 'else') continue;
    const d = ind(L[i]);
    let a = null;
    for (let j = i - 1; j >= 0; j--) {
      const t = L[j].trim();
      if (!t || t.startsWith('//')) continue;
      if (ind(L[j]) > d) { a = t; break; }
      break;
    }
    let b = null;
    for (let j = i + 1; j < L.length; j++) {
      const t = L[j].trim();
      if (!t || t.startsWith('//')) continue;
      if (ind(L[j]) > d) b = t;
      break;
    }
    if (!a || !b) continue;
    const ca = classify(a), cb = classify(b);
    if (ca !== cb && (ca === 'void' || cb === 'void') && (ca === 'value' || cb === 'value')) {
      bad.push(`line ${i + 1}: "${a}" (${ca}) vs "${b}" (${cb})`);
    }
  }
  return bad;
}
