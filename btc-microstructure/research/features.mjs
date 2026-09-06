// M1 feature definitions. Hashed into PRE-REGISTRATION-M1.md; any later edit
// changes the hash and is therefore visible.
//
// Bars are 5-minute klines carrying the exchange's taker-buy split:
//   aggressive BUY quote  = tbq            (buyer was the taker)
//   aggressive SELL quote = qv - tbq       (seller was the taker)
// research/audit.mjs proves this equals the same aggregation over raw aggTrades.
import { readFileSync } from 'node:fs';

export const M5 = 300_000;
export const DAY = 86_400_000;
export const RV_WIN = 12;              // trailing 1 hour of 5m returns

export const loadBars = (market = 'perp') =>
  JSON.parse(readFileSync(new URL(`../data/cache/btc-5m-${market}.json`, import.meta.url), 'utf8'));

// Aggressor Flow Imbalance over one 5m bar, in [-1, 1].
export const afiOf = (b) => (b.qv > 0 ? (2 * b.tbq - b.qv) / b.qv : 0);

export function features(bars) {
  const n = bars.length;
  const t = new Float64Array(n), c = new Float64Array(n);
  const afi = new Float64Array(n), ret5 = new Float64Array(n);
  const rv5 = new Float64Array(n), lnqv = new Float64Array(n), qv = new Float64Array(n);
  const mod = new Int16Array(n);                 // minute-of-day bucket, 0..287
  const contig = new Int32Array(n);              // unbroken 5m bars ending at i (self = 1)

  for (let i = 0; i < n; i++) {
    const b = bars[i];
    t[i] = b.t; c[i] = b.c; qv[i] = b.qv;
    afi[i] = afiOf(b);
    lnqv[i] = Math.log(Math.max(1, b.qv));
    mod[i] = Math.floor((b.t % DAY) / M5);
    contig[i] = i > 0 && b.t - bars[i - 1].t === M5 ? contig[i - 1] + 1 : 1;
    ret5[i] = contig[i] >= 2 ? Math.log(b.c / bars[i - 1].c) : NaN;
  }
  // trailing realised volatility: sd of the last RV_WIN 5m returns
  for (let i = 0; i < n; i++) {
    if (contig[i] < RV_WIN + 1) { rv5[i] = NaN; continue; }
    let s = 0, s2 = 0;
    for (let k = i - RV_WIN + 1; k <= i; k++) { s += ret5[k]; s2 += ret5[k] * ret5[k]; }
    rv5[i] = Math.sqrt(Math.max(0, s2 / RV_WIN - (s / RV_WIN) ** 2));
  }
  return { n, t, c, qv, afi, ret5, rv5, lnqv, mod, contig };
}

// Forward log return over h bars, NaN when the bar grid is broken in between.
export function forward(f, bars, h) {
  const out = new Float64Array(f.n).fill(NaN);
  for (let i = 0; i + h < f.n; i++) {
    if (bars[i + h].t - bars[i].t !== h * M5) continue;
    out[i] = Math.log(f.c[i + h] / f.c[i]);
  }
  return out;
}

// Rows usable by a regression: every feature and the forward return finite.
export function usable(f, fwd) {
  const idx = [];
  for (let i = 0; i < f.n; i++) {
    if (f.contig[i] < RV_WIN + 1 || !(f.qv[i] > 0)) continue;
    if (!Number.isFinite(fwd[i]) || !Number.isFinite(f.rv5[i]) || !Number.isFinite(f.ret5[i])) continue;
    idx.push(i);
  }
  return idx;
}
