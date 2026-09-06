// Trade-level backtest engine for the BTC 4H Trade Planner.
//
// The sibling project's lib.mjs backtests a FRACTIONAL EXPOSURE weight per bar.
// That cannot express a stop: a weight series has no entry price, no
// invalidation level, no R multiple and no intrabar fill. This engine is
// trade-level instead — it opens a position, carries a stop, and closes on a
// touch — because that is the thing the product claims to do.
//
// Every execution assumption is fixed by ../PRE-REGISTRATION.md §1.3 and is
// chosen to be reproducible by a TradingView `strategy()` call, so the two
// trade lists can be reconciled row by row. Where a choice existed, the one
// that a Pine strategy would actually take was taken, not the flattering one.

import { readFileSync } from 'node:fs';

export const ROWS = JSON.parse(readFileSync(new URL('../../btc-4h-regime-engine/data/cache/btc-4h.json', import.meta.url), 'utf8'));
export const N_BARS = ROWS.length;
export const BARS_PER_YEAR = 6 * 365;

// §1.3 — 0.05% Binance futures taker + 0.02% assumed slippage, per side.
// Slippage is folded into commission rather than expressed in ticks because
// Pine's `slippage` is a tick count, which is not scale-invariant across a
// price range running from ~10k to ~120k.
export const COST_PER_SIDE = 0.0007;
export const RISK_PER_TRADE = 0.01;

export const SPLITS = {
  development: [Date.parse('2020-09-01T00:00:00Z'), Date.parse('2024-01-01T00:00:00Z')],
  validation: [Date.parse('2024-01-01T00:00:00Z'), Date.parse('2025-07-01T00:00:00Z')],
  test: [Date.parse('2025-07-01T00:00:00Z'), Infinity],
};
export const SPLIT_NAMES = ['development', 'validation', 'test'];
export const splitOf = (t) => SPLIT_NAMES.find((s) => t >= SPLITS[s][0] && t < SPLITS[s][1]);

const high = ROWS.map((r) => r.high);
const low = ROWS.map((r) => r.low);
const close = ROWS.map((r) => r.close);
const open = ROWS.map((r) => r.open);

// ---------------------------------------------------------------------------
// Pine-equivalent indicators
// ---------------------------------------------------------------------------
// ta.ema seeds with ta.sma(source, length) at bar length-1 and is na before it.
// The sibling lib.mjs seeds with v[0] instead; that diverges from Pine for the
// first few hundred bars, which is exactly the region a reconciliation test
// would flag, so it is not reused here.
export function ema(v, len) {
  const k = 2 / (len + 1);
  const out = new Array(v.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i === len - 1) out[i] = s / len;
    else if (i >= len) out[i] = v[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

// ta.rma — Wilder smoothing, seeded with an SMA of the first `len` values.
function rma(v, len) {
  const out = new Array(v.length).fill(NaN);
  let s = 0, seeded = false;
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) continue;
    if (!seeded) {
      s += v[i];
      if (i === len - 1) { out[i] = s / len; seeded = true; }
    } else out[i] = (out[i - 1] * (len - 1) + v[i]) / len;
  }
  return out;
}

// ta.atr(14). ta.tr on the first bar is high - low (close[-1] does not exist).
export function atr(len = 14) {
  const tr = ROWS.map((r, i) => (i === 0 ? r.high - r.low
    : Math.max(r.high - r.low, Math.abs(r.high - close[i - 1]), Math.abs(r.low - close[i - 1]))));
  return rma(tr, len);
}

// Rolling extreme over the `len` bars ENDING AT i inclusive. Callers that need
// Pine's `[1]` offset read index i-1, which is what excludes the signal bar's
// own high or low from its own channel.
function rollExtreme(v, len, pick) {
  const out = new Array(v.length).fill(NaN);
  for (let i = len - 1; i < v.length; i++) {
    let x = v[i];
    for (let j = i - len + 1; j < i; j++) x = pick(x, v[j]);
    out[i] = x;
  }
  return out;
}
export const highest = (len) => rollExtreme(high, len, Math.max);
export const lowest = (len) => rollExtreme(low, len, Math.min);

// ---------------------------------------------------------------------------
// Daily series — replicates main.pine:215 exactly (PRE-REGISTRATION §1.2)
//
//   request.security(sym, "1D", [ta.sma(close,200)[1], close[1]/close[85]-1],
//                    lookahead = barmerge.lookahead_on)
//
// lookahead_on returns day D's tuple to every 4H bar inside day D; the [1]
// offsets inside the expression mean that tuple only ever references day D-1
// and earlier. Net effect: no lookahead, and the value is constant across all
// six 4H bars of a day. Both halves matter — dropping the [1] would leak the
// future, dropping lookahead_on would lag a further full day.
// ---------------------------------------------------------------------------
function dailySeries() {
  const dayKey = (t) => Math.floor(t / 86400000);
  const dayClose = [], dayOfBar = new Array(N_BARS);
  let cur = null, idx = -1;
  for (let i = 0; i < N_BARS; i++) {
    const k = dayKey(ROWS[i].t);
    if (k !== cur) { cur = k; idx++; dayClose.push(close[i]); }
    else dayClose[idx] = close[i];      // last bar of the day wins = daily close
    dayOfBar[i] = idx;
  }
  // Prefix sums so the 200-day SMA is O(1) per day rather than O(200).
  const pre = [0];
  for (const c of dayClose) pre.push(pre[pre.length - 1] + c);

  const sma200 = new Array(N_BARS).fill(NaN);
  const mom12w = new Array(N_BARS).fill(NaN);
  for (let i = 0; i < N_BARS; i++) {
    const D = dayOfBar[i];
    if (D >= 200) sma200[i] = (pre[D] - pre[D - 200]) / 200;   // days D-200 .. D-1
    if (D >= 85) mom12w[i] = dayClose[D - 1] / dayClose[D - 85] - 1;
  }
  return { sma200, mom12w, days: dayClose.length };
}
export const DAILY = dailySeries();

// ---------------------------------------------------------------------------
// Phase 1 — bias. Long and short are separate predicates, never one signed
// variable, so a failing short model can be deleted without touching long.
// ---------------------------------------------------------------------------
export const BIAS = {
  A: {
    label: 'A 200MA',
    long: (i) => Number.isFinite(DAILY.sma200[i]) && close[i] > DAILY.sma200[i],
    short: (i) => Number.isFinite(DAILY.sma200[i]) && close[i] < DAILY.sma200[i],
  },
  B: {
    label: 'B 12W mom',
    long: (i) => Number.isFinite(DAILY.mom12w[i]) && DAILY.mom12w[i] > 0,
    short: (i) => Number.isFinite(DAILY.mom12w[i]) && DAILY.mom12w[i] < 0,
  },
  C: {
    label: 'C both agree',
    long: (i) => BIAS.A.long(i) && BIAS.B.long(i),
    short: (i) => BIAS.A.short(i) && BIAS.B.short(i),
  },
};

// ---------------------------------------------------------------------------
// Phase 2 — entries. Each returns a predicate on the confirmed close of bar i.
// ---------------------------------------------------------------------------
const EMA = { 20: ema(close, 20), 50: ema(close, 50) };
const DON_HI = { 20: highest(20), 40: highest(40) };
const DON_LO = { 20: lowest(20), 40: lowest(40) };

export const ENTRIES = {
  pullback20: { label: 'Pullback EMA20', kind: 'pullback', p: 20 },
  pullback50: { label: 'Pullback EMA50', kind: 'pullback', p: 50 },
  breakout20: { label: 'Breakout D20', kind: 'breakout', p: 20 },
  breakout40: { label: 'Breakout D40', kind: 'breakout', p: 40 },
};

export function signalFn(entryId, dir) {
  const e = ENTRIES[entryId];
  if (e.kind === 'pullback') {
    const m = EMA[e.p];
    // The first confirmed close back across the EMA after at least one
    // confirmed close on the other side. The prior close IS the pullback; no
    // depth threshold and no lookback window are introduced, because each
    // would be an extra swept dimension (PRE-REGISTRATION §3.1).
    return dir === 'long'
      ? (i) => i > 0 && Number.isFinite(m[i - 1]) && close[i] > m[i] && close[i - 1] <= m[i - 1]
      : (i) => i > 0 && Number.isFinite(m[i - 1]) && close[i] < m[i] && close[i - 1] >= m[i - 1];
  }
  const hi = DON_HI[e.p], lo = DON_LO[e.p];
  return dir === 'long'
    ? (i) => i > 0 && Number.isFinite(hi[i - 1]) && close[i] > hi[i - 1]
    : (i) => i > 0 && Number.isFinite(lo[i - 1]) && close[i] < lo[i - 1];
}

// ---------------------------------------------------------------------------
// Phase 4 — the simulator.
//
// Bar i is processed in the order TradingView would process it:
//   1. fill an entry signalled at the close of bar i-1, at open[i]
//   2. test the stop that was in force at the close of bar i-1 (a gap through
//      it fills at the open, not at the stop price)
//   3. accumulate MAE / MFE and mark equity to close[i]
//   4. at the close of bar i, ratchet the trailing stop
//   5. at the close of bar i, look for a new signal
// Nothing in step 5 can affect step 1 of the same bar, which is what makes the
// engine lookahead-free.
// ---------------------------------------------------------------------------
const ATR14 = atr(14);
const TRAIL_LO = { 10: lowest(10), 20: lowest(20) };
const TRAIL_HI = { 10: highest(10), 20: highest(20) };

export function simulate({ bias, entry, stopATR, trailBars, dir }, splitName) {
  const [from, to] = SPLITS[splitName];
  const sig = signalFn(entry, dir);
  const biasOk = BIAS[bias][dir];
  const trailLo = TRAIL_LO[trailBars], trailHi = TRAIL_HI[trailBars];
  const isLong = dir === 'long';

  const trades = [];
  const barRets = [];
  // `cash` is realised equity; the marked equity used for the return series is
  // cash plus the open position's unrealised P&L. Keeping the two apart is what
  // stops a closing trade from being counted twice.
  let cash = 1, marked = 1, pos = null, pending = null, barsIn = 0, nBars = 0, wSum = 0;

  const closeTrade = (px, reason, i) => {
    const eff = isLong ? px * (1 - COST_PER_SIDE) : px * (1 + COST_PER_SIDE);
    const perUnit = isLong ? eff - pos.eff : pos.eff - eff;
    cash += pos.qty * perUnit;
    trades.push({
      tSig: pos.tSig, tIn: ROWS[pos.i0].t, tOut: ROWS[i].t,
      dir, sigClose: pos.sigClose, entry: pos.fill, exit: px, initStop: pos.initStop,
      qty: pos.qty, pnl: pos.qty * perUnit, r: perUnit / pos.R,
      mae: pos.mae, mfe: pos.mfe, bars: i - pos.i0 + 1, reason,
      year: new Date(ROWS[pos.i0].t).getUTCFullYear(),
    });
    pos = null;
  };

  for (let i = 1; i < N_BARS; i++) {
    if (ROWS[i].t < from || ROWS[i].t >= to) { pending = null; continue; }
    nBars++;

    // 1. fill an entry signalled at the close of bar i-1, at this bar's open
    if (!pos && pending) {
      const fill = open[i];
      const R = Math.abs(pending.sigClose - pending.initStop);
      if (R > 0) {
        // §9 stop-based sizing, capped at 1.0x equity so the rule can never
        // request leverage when ATR is small relative to price.
        const qty = Math.min((RISK_PER_TRADE * cash) / R, cash / fill);
        pos = { ...pending, i0: i, fill, R, qty, stop: pending.initStop, mae: 0, mfe: 0,
          eff: isLong ? fill * (1 + COST_PER_SIDE) : fill * (1 - COST_PER_SIDE) };
      }
    }
    pending = null;

    // 2. test the stop that was in force at the close of bar i-1. A bar that
    //    gaps through it fills at the open, not at the stop price.
    if (pos) {
      barsIn++;
      const s = pos.stop;
      let exitPx = null;
      if (isLong) {
        if (open[i] <= s) exitPx = open[i];
        else if (low[i] <= s) exitPx = s;
      } else {
        if (open[i] >= s) exitPx = open[i];
        else if (high[i] >= s) exitPx = s;
      }
      // Excursions are measured only over the part of the bar actually held.
      const hi = exitPx === null || isLong ? high[i] : Math.max(open[i], exitPx);
      const lo = exitPx === null || !isLong ? low[i] : Math.min(open[i], exitPx);
      pos.mfe = Math.max(pos.mfe, (isLong ? hi - pos.eff : pos.eff - lo) / pos.R);
      pos.mae = Math.min(pos.mae, (isLong ? lo - pos.eff : pos.eff - hi) / pos.R);
      if (exitPx !== null) closeTrade(exitPx, 'stop', i);
    }

    // 3. ratchet the trail at the confirmed close. The initial stop alone is in
    //    force during the entry bar — that is the level published as INITIAL
    //    INVALIDATION at signal time, so the backtest must honour it.
    if (pos) {
      const t = isLong ? trailLo[i] : trailHi[i];
      if (Number.isFinite(t)) pos.stop = isLong ? Math.max(pos.initStop, t) : Math.min(pos.initStop, t);
    }

    // 4. no trade may span a split boundary or dangle open at the end of the
    //    data. H3's holdout result was carried entirely by one unclosed
    //    position; forcing the close here makes that impossible.
    if (pos && (i + 1 >= N_BARS || ROWS[i + 1].t >= to))
      closeTrade(close[i], i + 1 >= N_BARS ? 'end-of-data' : 'split-boundary', i);

    // 5. mark to market and record the bar return
    const prev = marked;
    marked = cash + (pos ? pos.qty * (isLong ? close[i] - pos.eff : pos.eff - close[i]) : 0);
    barRets.push(prev ? marked / prev - 1 : 0);
    // Average NOTIONAL weight, not the fraction of bars in market. G10 matches
    // the baseline on capital actually at risk; matching on time-in-market
    // would hand the baseline a different position size and prove nothing.
    if (pos && marked > 0) wSum += (pos.qty * close[i]) / marked;

    // 6. look for a new signal at the confirmed close. Nothing here can affect
    //    step 1 of the same bar, which is what makes the engine lookahead-free.
    if (!pos && Number.isFinite(ATR14[i]) && ATR14[i] > 0 && biasOk(i) && sig(i))
      pending = {
        tSig: ROWS[i].t, sigClose: close[i],
        initStop: isLong ? close[i] - stopATR * ATR14[i] : close[i] + stopATR * ATR14[i],
      };
  }

  return { trades, barRets, equity: cash, exposure: nBars ? barsIn / nBars : 0,
    avgWeight: nBars ? wSum / nBars : 0, nBars };
}

// ---------------------------------------------------------------------------
// Metrics — PRE-REGISTRATION §5. Everything is after cost; there is no
// gross-of-cost headline anywhere in this study.
// ---------------------------------------------------------------------------
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const stdev = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };

export function profitFactor(rs) {
  const gp = rs.filter((x) => x > 0).reduce((s, x) => s + x, 0);
  const gl = -rs.filter((x) => x < 0).reduce((s, x) => s + x, 0);
  return gl > 0 ? gp / gl : gp > 0 ? Infinity : 0;
}

// G3. Drop the best 5% of trades (at least one whenever any trade exists) and
// recompute. On fat-tailed 4H BTC a profit factor is routinely carried by a
// handful of outliers, so this is the gate that separates an edge from a lottery.
export function pfExBest(rs, frac = 0.05) {
  if (!rs.length) return 0;
  const k = Math.max(1, Math.ceil(rs.length * frac));
  const sorted = [...rs].sort((a, b) => b - a);
  return profitFactor(sorted.slice(k));
}

export function metrics(sim) {
  const { trades, barRets, exposure, avgWeight } = sim;
  const rs = trades.map((t) => t.r);
  const wins = rs.filter((x) => x > 0), losses = rs.filter((x) => x <= 0);
  const years = barRets.length / BARS_PER_YEAR;

  let eq = 1, peak = 1, maxDD = 0;
  const dd = [];
  for (const r of barRets) { eq *= 1 + r; peak = Math.max(peak, eq); const d = 1 - eq / peak; dd.push(d); maxDD = Math.max(maxDD, d); }
  const m = mean(barRets), sd = stdev(barRets);
  const dn = barRets.filter((x) => x < 0);
  const dsd = dn.length ? Math.sqrt(mean(dn.map((x) => x * x))) : 0;
  const cagr = years > 0 && eq > 0 ? eq ** (1 / years) - 1 : 0;

  let streak = 0, worstStreak = 0;
  for (const r of rs) { if (r <= 0) { streak++; worstStreak = Math.max(worstStreak, streak); } else streak = 0; }

  const byYear = {};
  for (const t of trades) byYear[t.year] = (byYear[t.year] ?? 0) + t.r;

  const gp = wins.reduce((s, x) => s + x, 0);
  return {
    trades: trades.length,
    expR: mean(rs),
    expPct: mean(trades.map((t) => t.pnl)),
    winRate: rs.length ? wins.length / rs.length : 0,
    avgWin: mean(wins), avgLoss: mean(losses),
    pf: profitFactor(rs), pfExBest: pfExBest(rs),
    netR: rs.reduce((s, x) => s + x, 0),
    sharpe: sd ? (m / sd) * Math.sqrt(BARS_PER_YEAR) : 0,
    sortino: dsd ? (m / dsd) * Math.sqrt(BARS_PER_YEAR) : 0,
    maxDD, calmar: maxDD ? cagr / maxDD : 0, cagr, netRet: eq - 1,
    avgMAE: mean(trades.map((t) => t.mae)), worstMAE: trades.length ? Math.min(...trades.map((t) => t.mae)) : 0,
    avgMFE: mean(trades.map((t) => t.mfe)),
    exposure, avgWeight, turnoverPerYear: years > 0 ? trades.length / years : 0,
    worstStreak, byYear,
    topWinnerShare: gp > 0 ? Math.max(0, ...wins) / gp : 0,
    barRets,
  };
}

// G10 baseline: a constant same-direction position at the model's own realised
// average exposure, over the identical bar range. This is the control that
// killed the previous project's trend filter — halving drawdown is not a skill
// if simply holding half as much does it for free.
export function matchedBaseline(dir, splitName, weight) {
  const [from, to] = SPLITS[splitName];
  const rets = [];
  for (let i = 1; i < N_BARS; i++) {
    if (ROWS[i].t < from || ROWS[i].t >= to) continue;
    const br = close[i] / close[i - 1] - 1;
    rets.push(weight * (dir === 'long' ? br : -br));
  }
  let eq = 1, peak = 1, maxDD = 0;
  for (const r of rets) { eq *= 1 + r; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak); }
  const years = rets.length / BARS_PER_YEAR;
  const m = mean(rets), sd = stdev(rets);
  const cagr = years > 0 && eq > 0 ? eq ** (1 / years) - 1 : 0;
  return { sharpe: sd ? (m / sd) * Math.sqrt(BARS_PER_YEAR) : 0, maxDD, calmar: maxDD ? cagr / maxDD : 0, netRet: eq - 1 };
}

export const GRID = [];
for (const bias of ['A', 'B', 'C'])
  for (const entry of Object.keys(ENTRIES))
    for (const stopATR of [1.5, 2.0])
      for (const trailBars of [10, 20])
        for (const dir of ['long', 'short'])
          GRID.push({ bias, entry, stopATR, trailBars, dir });
