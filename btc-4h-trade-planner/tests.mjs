// Offline verification for the Trade Risk Planner (planner.pine).
//
// PineTS runs the real script on recorded Binance bars. The planner makes no
// request.security calls, so a single-symbol provider is enough. What is
// proven here: the sizing arithmetic, the leverage cap and the risk actually
// taken under it, direction/stop validation, the R ladder, and that the
// trailing reference uses only the PREVIOUS N bars (no repaint). What is not:
// compilation by TradingView, table layout, alerts firing — those need the
// Pine Editor.

import { PineTS, BaseProvider } from 'pinets';
import { readFileSync } from 'node:fs';

const RAW = readFileSync(new URL('./planner.pine', import.meta.url), 'utf8');

const rewrite = (src, re, to, name) => {
  const next = src.replace(re, to);
  if (next === src) { console.error(`rewrite "${name}" no longer matches planner.pine — fix tests.mjs`); process.exit(1); }
  return next;
};
const setInput = (src, cur, next, name) => rewrite(src, cur, next, name);

const all = JSON.parse(readFileSync(new URL('../btc-4h-regime-engine/data/cache/btc-4h.json', import.meta.url), 'utf8'));
const rows = all.slice(-400);
const H4 = 4 * 3600_000;
const bars = rows.map((r) => ({
  openTime: r.t, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
  closeTime: r.t + H4 - 1, quoteAssetVolume: r.volume * r.close, numberOfTrades: 1,
  takerBuyBaseAssetVolume: r.volume / 2, takerBuyQuoteAssetVolume: (r.volume / 2) * r.close, ignore: '0',
}));

const provider = new (class extends BaseProvider {
  constructor() { super({ requiresApiKey: false, providerName: 'Local' }); }
  getSupportedTimeframes() { return new Set(['240']); }
  async _getMarketDataNative() { return bars; }
  async getSymbolInfo(id) {
    return { ticker: id, name: id, type: 'crypto', currency: 'USDT', basecurrency: 'BTC', timezone: 'Etc/UTC', minmov: 1, pricescale: 100 };
  }
})();

const run = async (src) => (await new PineTS(provider, 'BTCUSDT.P', '240', bars.length).run(src)).plots;
const last = (plots, name) => {
  const p = plots[name];
  if (!p) throw new Error(`missing plot ${name}; have: ${Object.keys(plots).join(', ')}`);
  return p.data[p.data.length - 1].value;
};
const series = (plots, name, n) => plots[name].data.slice(-n).map((d) => d.value);

let pass = 0, fail = 0;
const check = (id, desc, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok ${id} ${desc}`); }
  else { fail++; console.error(`FAIL ${id} ${desc}${detail ? ' — ' + detail : ''}`); }
};
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

// ---------------------------------------------------------------------------
const dflt = await run(RAW);

// 0 — defaults: live long plan, auto ATR stop, sizing algebra end to end
{
  const entry = last(dflt, 't_entry'), stop = last(dflt, 't_stop'), atr = last(dflt, 't_atr');
  const qty = last(dflt, 't_qty'), notion = last(dflt, 't_notional'), risk = last(dflt, 't_risk');
  const lastClose = rows[rows.length - 1].close;
  check(0, 'live entry follows close', close(entry, lastClose), `${entry} vs ${lastClose}`);
  check(1, 'auto stop = entry - 1.5*ATR', close(stop, entry - 1.5 * atr), `${stop} vs ${entry - 1.5 * atr}`);
  const dist = entry - stop;
  const qtyRaw = (10000 * 0.01) / dist, qtyCap = 10000 / entry;
  check(2, 'qty = min(risk/dist, equity/entry)', close(qty, Math.min(qtyRaw, qtyCap)));
  check(3, 'notional = qty*entry', close(notion, qty * entry));
  check(4, 'actual risk = qty*dist', close(risk, qty * dist));
  check(5, 'capped flag matches algebra', last(dflt, 't_capped') === (qtyRaw > qtyCap ? 1 : 0));
  check(6, 'R ladder: r1-entry = dist, r3-entry = 3*dist',
    close(last(dflt, 't_r1') - entry, dist) && close(last(dflt, 't_r3') - entry, 3 * dist));
  check(7, 'plan valid by default', last(dflt, 't_planOK') === 1);
}

// 1 — trailing reference excludes the live bar (no repaint) and is the
//     rolling 10-bar low for a long
{
  const tr = series(dflt, 't_trail', 20);
  const lows = rows.map((r) => r.low);
  let ok = true;
  for (let k = 0; k < 20; k++) {
    const i = rows.length - 20 + k;                    // bar index of this sample
    const expect = Math.min(...lows.slice(i - 10, i)); // bars i-10 .. i-1, never i
    if (!close(tr[k], expect)) { ok = false; check(8, `trail bar ${i}`, false, `${tr[k]} vs ${expect}`); break; }
  }
  if (ok) check(8, 'trailing ref = lowest low of PREVIOUS 10 bars on every sampled bar', true);
}

// 2 — short direction flips every level
{
  const src = setInput(RAW, /input\.string\("Long", "Direction"/, 'input.string("Short", "Direction"', 'short');
  const p = await run(src);
  const entry = last(p, 't_entry'), stop = last(p, 't_stop'), atr = last(p, 't_atr');
  check(9, 'short auto stop = entry + 1.5*ATR', close(stop, entry + 1.5 * atr));
  check(10, 'short r1 below entry', last(p, 't_r1') < entry && close(entry - last(p, 't_r1'), stop - entry));
  const tr = last(p, 't_trail');
  const expect = Math.max(...rows.slice(-11, -1).map((r) => r.high));
  check(11, 'short trailing ref = highest high of previous 10 bars', close(tr, expect));
}

// 3 — a manual stop on the wrong side voids the plan instead of flipping it
{
  const src = setInput(RAW, /input\.float\(0\.0, "Invalidation price \(0 = auto\)"/, 'input.float(9e9, "Invalidation price (0 = auto)"', 'bad stop');
  const p = await run(src);
  check(12, 'stop above entry on a long: planOK = 0', last(p, 't_planOK') === 0);
  check(13, 'voided plan produces no size', !Number.isFinite(last(p, 't_qty')) || last(p, 't_qty') === null);
}

// 4 — the leverage cap binds on a tight manual stop, and the displayed risk
//     is the risk actually taken, not the budget
{
  const px = rows[rows.length - 1].close;
  const tight = (px * 0.999).toFixed(1);               // 0.1% stop => raw size ~10x equity
  let src = setInput(RAW, /input\.float\(0\.0, "Entry price \(0 = current price\)"/, `input.float(${px}, "Entry price (0 = current price)"`, 'pin entry');
  src = setInput(src, /input\.float\(0\.0, "Invalidation price \(0 = auto\)"/, `input.float(${tight}, "Invalidation price (0 = auto)"`, 'tight stop');
  const p = await run(src);
  check(14, 'tight stop triggers the cap', last(p, 't_capped') === 1);
  check(15, 'capped notional = maxLev * equity', close(last(p, 't_notional'), 10000));
  check(16, 'actual risk under cap < risk budget', last(p, 't_risk') < 100 - 1e-9);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
