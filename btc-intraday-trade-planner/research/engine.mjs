// Study IT1 — trade-level backtest engine for the three intraday families.
// Implements PRE-REGISTRATION.md §1–§6 and nothing else. Execution mirrors
// TradingView's strategy() defaults: signal on confirmed close, fill at next
// open, stop/limit active on the fill bar, broker-emulator path rule for
// same-bar ambiguity, session-end flat at the next open.
import { readFileSync } from 'node:fs';
import { sessionFlags, local, utcDay, M15, SESSIONS } from './sessions.mjs';

export const COST_BASE = 0.0007;                 // per side
export const COST_STRESS = [0.0010, 0.0015];     // per side (0.20% / 0.30% RT)
export const RISK = 0.01, MAX_LEV = 3, START_EQ = 10_000;
export const BARS_PER_YEAR = 96 * 365;
export const SPLITS = {
  development: [Date.parse('2020-01-01T00:00:00Z'), Date.parse('2024-01-01T00:00:00Z')],
  validation:  [Date.parse('2024-01-01T00:00:00Z'), Date.parse('2025-07-01T00:00:00Z')],
  test:        [Date.parse('2025-07-01T00:00:00Z'), Date.parse('2026-09-07T00:00:00Z')],
};
export const splitOf = (t) => Object.keys(SPLITS).find((k) => t >= SPLITS[k][0] && t < SPLITS[k][1]);

export const bars = JSON.parse(readFileSync(new URL('../data/cache/btc-15m.json', import.meta.url), 'utf8'));
const N = bars.length;
const O = bars.map((b) => b.o), H = bars.map((b) => b.h), L = bars.map((b) => b.l), C = bars.map((b) => b.c), QV = bars.map((b) => b.qv), V = bars.map((b) => b.v), T = bars.map((b) => b.t);

// ---------------------------------------------------------------- features
const F = bars.map((b) => sessionFlags(b.t));

// ATR14 Wilder, seeded with SMA (ta.atr)
export const ATR = new Array(N).fill(NaN);
{ let sum = 0, rma = null; for (let i = 1; i < N; i++) { const tr = Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])); if (i <= 14) { sum += tr; if (i === 14) rma = sum / 14; } else rma = (rma * 13 + tr) / 14; if (rma !== null) ATR[i] = rma; } }

// Daily VWAP anchored 00:00 UTC (ta.vwap(hlc3))
export const VWAP = new Array(N);
{ let day = -1, pv = 0, vv = 0; for (let i = 0; i < N; i++) { const d = utcDay(T[i]); if (d !== day) { day = d; pv = 0; vv = 0; } pv += ((H[i] + L[i] + C[i]) / 3) * V[i]; vv += V[i]; VWAP[i] = pv / vv; } }

// Previous completed UTC day high/low
export const PDH = new Array(N).fill(NaN), PDL = new Array(N).fill(NaN);
{ let day = -1, h = -Infinity, l = Infinity, ph = NaN, pl = NaN; for (let i = 0; i < N; i++) { const d = utcDay(T[i]); if (d !== day) { if (day >= 0) { ph = h; pl = l; } day = d; h = -Infinity; l = Infinity; } PDH[i] = ph; PDL[i] = pl; h = Math.max(h, H[i]); l = Math.min(l, L[i]); } }

// Session high/low tracking: XH/XL = running; XDONE = completed for the last instance
const sessTrack = (key) => {
  const doneH = new Array(N).fill(NaN), doneL = new Array(N).fill(NaN), done = new Array(N).fill(false);
  let h = -Infinity, l = Infinity, fh = NaN, fl = NaN, isDone = false, lastDay = -1;
  for (let i = 0; i < N; i++) {
    if (F[i]['first' + key]) { h = -Infinity; l = Infinity; isDone = false; }
    if (F[i]['in' + key]) { h = Math.max(h, H[i]); l = Math.min(l, L[i]); }
    if (F[i]['last' + key]) { fh = h; fl = l; isDone = true; lastDay = utcDay(T[i]); }
    doneH[i] = fh; doneL[i] = fl; done[i] = isDone && utcDay(T[i]) === lastDay; // same UTC day as completion
  }
  return { H: doneH, L: doneL, done };
};
const ASIA = sessTrack('ASIA'), LON = sessTrack('LONDON');
// Asia level: "last completed Asia session" — same-day restriction is what
// makes it the one before this London session (Asia ends 06:00 UTC).

// Opening range per session for windows 4 and 3; RVOL (4-bar OR) vs previous 20 sessions
const orTrack = (key, win) => {
  const oh = new Array(N).fill(NaN), ol = new Array(N).fill(NaN), ready = new Array(N).fill(false), rvol = new Array(N).fill(NaN);
  let cnt = 0, h = -Infinity, l = Infinity, qv = 0, cur = NaN; const hist = [];
  for (let i = 0; i < N; i++) {
    if (F[i]['first' + key]) { cnt = 0; h = -Infinity; l = Infinity; qv = 0; cur = NaN; }
    if (!F[i]['in' + key]) continue;
    if (isOrBar(i, key, win)) {
      h = Math.max(h, H[i]); l = Math.min(l, L[i]); qv += QV[i]; cnt++;
      if (cnt === win) { // OR complete: RVOL vs median of the previous 20 sessions' OR volume
        if (hist.length >= 20) { const s = [...hist].sort((a, b) => a - b); cur = qv / s[Math.floor(s.length / 2)]; }
        hist.push(qv); if (hist.length > 20) hist.shift();
      }
    } else if (cnt === win) { ready[i] = true; oh[i] = h; ol[i] = l; } // signals only after the OR
    rvol[i] = cur;
  }
  return { H: oh, L: ol, ready, rvol };
};
// bar i is one of the first `win` bars of session `key`
const isOrBar = (i, key, win) => { const s = SESSIONS[key]; const a = local(T[i], s.tz); return a.hm < s.start + win * 15; };
const ORB = { LONDON: { 4: orTrack('LONDON', 4), 3: orTrack('LONDON', 3) }, NY: { 4: orTrack('NY', 4), 3: orTrack('NY', 3) } };

// 1H context: previous completed hour's close vs EMA50 of hourly closes
export const H1UP = new Array(N).fill(false), H1DN = new Array(N).fill(false);
{
  const hc = []; let hour = -1, ema = null, sum = 0, up = null, dn = null;
  for (let i = 0; i < N; i++) {
    const hr = Math.floor(T[i] / 3600_000);
    if (hr !== hour) {
      if (hour >= 0) { // close of previous hour = C[i-1]
        const c = C[i - 1]; hc.push(c);
        if (hc.length <= 50) { sum += c; if (hc.length === 50) ema = sum / 50; } else ema = (c - ema) * (2 / 51) + ema;
        if (ema !== null) { up = c > ema; dn = c < ema; }
      }
      hour = hr;
    }
    H1UP[i] = up === true; H1DN[i] = dn === true;
  }
}

const rollLow = (win) => { const r = new Array(N).fill(NaN); for (let i = win - 1; i < N; i++) { let m = Infinity; for (let k = i - win + 1; k <= i; k++) m = Math.min(m, L[k]); r[i] = m; } return r; };
const rollHigh = (win) => { const r = new Array(N).fill(NaN); for (let i = win - 1; i < N; i++) { let m = -Infinity; for (let k = i - win + 1; k <= i; k++) m = Math.max(m, H[k]); r[i] = m; } return r; };
const LOW = { 8: rollLow(8), 12: rollLow(12) }, HIGH = { 8: rollHigh(8), 12: rollHigh(12) };

// ---------------------------------------------------------------- candidates
// cfg = { family: 'ORB'|'SWEEP'|'VWAP', session: 'LONDON'|'NY', level?: 'PD'|'ASIA'|'LONDON',
//         dir: 'long'|'short', ctx: bool, rvol: bool, buf: 0.10|0.25, exit: '2R'|'1R+2R', win: 4|3|8|12 }
export const cfgName = (c) => `${c.family}${c.level ? ':' + c.level : ''}${c.rvol ? ':RVOL' : ''}@${c.session} ${c.dir}${c.ctx ? ' +1H' : ''} buf${c.buf} ${c.exit} w${c.win}`;

function levelAt(cfg, i) {
  switch (cfg.level) {
    case 'PD': return cfg.dir === 'long' ? PDL[i] : PDH[i];
    case 'ASIA': return cfg.dir === 'long' ? ASIA.L[i] : ASIA.H[i];
    case 'LONDON': return (LON.done[i] && !F[i].inLONDON) ? (cfg.dir === 'long' ? LON.L[i] : LON.H[i]) : NaN;
  }
}

// eligibility: in the trade session, level available (SWEEP), OR ready (ORB)
function eligible(cfg, i) {
  if (!F[i]['in' + cfg.session]) return false;
  if (cfg.family === 'SWEEP') return Number.isFinite(levelAt(cfg, i));
  return true;
}

// Returns {stop} if a signal fires at bar i, else null. Pure function of bars ≤ i.
function signal(cfg, i) {
  const long = cfg.dir === 'long';
  if (!eligible(cfg, i) || !Number.isFinite(ATR[i])) return null;
  if (cfg.ctx && !(long ? H1UP[i] : H1DN[i])) return null;
  const buf = cfg.buf * ATR[i];
  if (cfg.family === 'ORB') {
    const o = ORB[cfg.session][cfg.win];
    if (!o.ready[i]) return null;
    if (cfg.rvol && !(o.rvol[i] >= 1.0)) return null;
    if (!(long ? C[i] > o.H[i] : C[i] < o.L[i])) return null;
    return { stop: long ? o.L[i] - buf : o.H[i] + buf };
  }
  if (cfg.family === 'SWEEP') {
    const lv = levelAt(cfg, i);
    if (!(long ? C[i] > lv : C[i] < lv)) return null;
    let swept = false;
    for (let k = i; k > i - cfg.win && k >= 0; k--) { if (!eligible(cfg, k)) continue; const lk = levelAt(cfg, k); if (long ? L[k] < lk : H[k] > lk) { swept = true; break; } }
    if (!swept) return null;
    return { stop: long ? LOW[cfg.win][i] - buf : HIGH[cfg.win][i] + buf };
  }
  if (cfg.family === 'VWAP') {
    if (i === 0) return null;
    if (!(long ? (C[i] > VWAP[i] && C[i - 1] <= VWAP[i - 1]) : (C[i] < VWAP[i] && C[i - 1] >= VWAP[i - 1]))) return null;
    return { stop: long ? LOW[cfg.win][i] - buf : HIGH[cfg.win][i] + buf };
  }
}

// ---------------------------------------------------------------- simulation
export function simulate(cfg, costSide = COST_BASE) {
  const long = cfg.dir === 'long', sgn = long ? 1 : -1;
  const sessKey = cfg.session;
  let cash = START_EQ, pending = null, pos = null, sessTrades = 0;
  const trades = [], barRets = new Array(N).fill(0);
  let prevMark = cash, expBars = 0;

  const closePart = (i, px, q, reason) => {
    const gross = sgn * (px - pos.fill) * q, cost = costSide * px * q;
    cash += gross - cost; pos.qty -= q; pos.costs += cost; pos.gross += gross;
    pos.exits.push({ i, px, q, reason });
    if (pos.qty <= 1e-12) {
      const Rd = pos.Rp * pos.qty0;
      trades.push({ sig: pos.sig, t: T[pos.sig], fill: pos.fill, stop: pos.stop, tp: pos.tp, exits: pos.exits, exitBar: i, reason,
        R: (pos.gross - pos.costs - pos.entryCost) / Rd, grossR: pos.gross / Rd, mae: pos.mae, mfe: pos.mfe, qty: pos.qty0, notional: pos.qty0 * pos.fill,
        split: splitOf(T[pos.sig]), year: new Date(T[pos.sig]).getUTCFullYear(), dow: local(T[pos.sig], SESSIONS[sessKey].tz).dow, bars: i - pos.fillBar + 1 });
      pos = null;
    }
  };

  for (let i = 0; i < N; i++) {
    if (F[i]['first' + sessKey]) sessTrades = 0;
    // 1. orders at the open
    if (pos && pos.closeAtOpen) closePart(i, O[i], pos.qty, 'session');
    if (pending) {
      const fill = O[i], qty = Math.min((RISK * cash) / pending.Rp, (MAX_LEV * cash) / fill);
      const entryCost = costSide * fill * qty; cash -= entryCost;
      pos = { ...pending, fill, fillBar: i, qty, qty0: qty, entryCost, costs: 0, gross: 0, exits: [], mae: 0, mfe: 0, tp1Done: false };
      pending = null;
    }
    // 2. intrabar: TradingView path rule
    if (pos) {
      pos.mae = Math.min(pos.mae, sgn * ((long ? L[i] : H[i]) - pos.fill) / pos.Rp);
      pos.mfe = Math.max(pos.mfe, sgn * ((long ? H[i] : L[i]) - pos.fill) / pos.Rp);
      const highFirst = H[i] - O[i] <= O[i] - L[i];
      const path = highFirst ? [O[i], H[i], L[i]] : [O[i], L[i], H[i]];
      for (const px of path) {
        if (!pos) break;
        const stopHit = long ? px <= pos.stop : px >= pos.stop;
        const tp1Hit = cfg.exit === '1R+2R' && !pos.tp1Done && (long ? px >= pos.tp1 : px <= pos.tp1);
        const tpHit = long ? px >= pos.tp : px <= pos.tp;
        // At a given price point a stop and a limit cannot both be crossed unless the
        // point is the open (gap); orders are then filled at the open in order.
        if (stopHit) { closePart(i, px === O[i] ? O[i] : pos.stop, pos.qty, 'stop'); continue; }
        if (tp1Hit) { pos.tp1Done = true; closePart(i, px === O[i] ? O[i] : pos.tp1, pos.qty0 / 2, 'tp1'); }
        if (pos && tpHit) closePart(i, px === O[i] ? O[i] : pos.tp, pos.qty, 'tp');
      }
    }
    // 3. session end -> flat at next open
    if (pos && F[i]['last' + sessKey]) pos.closeAtOpen = true;
    // 4. mark to market
    const mark = cash + (pos ? sgn * (C[i] - pos.fill) * pos.qty : 0);
    barRets[i] = mark / prevMark - 1; prevMark = mark;
    if (pos) expBars++;
    // 5. signal on confirmed close
    if (!pos && !pending && sessTrades === 0 && F[i]['in' + sessKey] && !F[i]['last' + sessKey]) {
      const s = signal(cfg, i);
      if (s && Number.isFinite(s.stop) && (long ? s.stop < C[i] : s.stop > C[i])) {
        const Rp = Math.abs(C[i] - s.stop);
        pending = { sig: i, stop: s.stop, Rp, tp: C[i] + sgn * 2 * Rp, tp1: C[i] + sgn * Rp };
        sessTrades++;
      }
    }
  }
  return { trades, barRets, exposure: expBars / N };
}

// ---------------------------------------------------------------- metrics
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
export const profitFactor = (rs) => { const g = rs.filter((r) => r > 0).reduce((s, r) => s + r, 0), l = -rs.filter((r) => r < 0).reduce((s, r) => s + r, 0); return l > 0 ? g / l : g > 0 ? Infinity : 0; };
export const pfExBest = (rs, frac = 0.05) => { const s = [...rs].sort((a, b) => b - a); return profitFactor(s.slice(Math.ceil(s.length * frac))); };

export function metrics(trades, barRets, splitNames, tradesAll = trades) {
  const rng = splitNames.map((k) => SPLITS[k]);
  const inR = (t) => rng.some(([a, b]) => t >= a && t < b);
  const tr = trades.filter((t) => inR(t.t));
  const rs = tr.map((t) => t.R);
  const br = barRets.filter((_, i) => inR(T[i]));
  const nBars = br.length, years = nBars / BARS_PER_YEAR;
  let eq = 1, peak = 1, maxDD = 0; for (const r of br) { eq *= 1 + r; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, 1 - eq / peak); }
  const m = mean(br), s = sd(br), ddev = Math.sqrt(mean(br.map((r) => Math.min(0, r) ** 2)));
  const wins = rs.filter((r) => r > 0), losses = rs.filter((r) => r <= 0);
  let streak = 0, worst = 0; for (const r of rs) { streak = r <= 0 ? streak + 1 : 0; worst = Math.max(worst, streak); }
  const byYear = {}; for (const t of tr) { byYear[t.year] ??= { n: 0, netR: 0 }; byYear[t.year].n++; byYear[t.year].netR += t.R; }
  const byDow = {}; for (const t of tr) { const k = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.dow]; byDow[k] ??= { n: 0, netR: 0 }; byDow[k].n++; byDow[k].netR += t.R; }
  const gross = wins.reduce((a, b) => a + b, 0);
  const expBars = tr.reduce((a, t) => a + t.bars, 0);
  return {
    trades: rs.length, expR: mean(rs), winRate: rs.length ? wins.length / rs.length : 0,
    avgWin: mean(wins), avgLoss: mean(losses), pf: profitFactor(rs), pfExBest: pfExBest(rs), netR: rs.reduce((a, b) => a + b, 0),
    sharpe: s ? (m / s) * Math.sqrt(BARS_PER_YEAR) : 0, sortino: ddev ? (m / ddev) * Math.sqrt(BARS_PER_YEAR) : 0,
    maxDD, cagr: years > 0 ? eq ** (1 / years) - 1 : 0, calmar: maxDD > 0 && years > 0 ? (eq ** (1 / years) - 1) / maxDD : 0, netRet: eq - 1,
    avgMAE: mean(tr.map((t) => t.mae)), worstMAE: tr.length ? Math.min(...tr.map((t) => t.mae)) : 0, avgMFE: mean(tr.map((t) => t.mfe)),
    exposure: nBars ? expBars / nBars : 0, turnoverPerYear: years > 0 ? rs.length / years : 0, worstStreak: worst,
    topWinnerShare: gross > 0 && wins.length ? Math.max(...wins) / gross : 0, byYear, byDow, barRets: br,
    stopRate: rs.length ? tr.filter((t) => t.reason === 'stop').length / rs.length : 0,
    sessionExitRate: rs.length ? tr.filter((t) => t.reason === 'session').length / rs.length : 0,
  };
}

// ---------------------------------------------------------------- the registered grid
const DIRS = ['long', 'short'];
const base = [];
for (const session of ['LONDON', 'NY']) for (const dir of DIRS) base.push({ family: 'ORB', session, dir, ctx: false, rvol: false });
for (const session of ['LONDON', 'NY']) for (const dir of DIRS) base.push({ family: 'ORB', session, dir, ctx: false, rvol: true });
for (const session of ['LONDON', 'NY']) for (const dir of DIRS) base.push({ family: 'ORB', session, dir, ctx: true, rvol: false });
const SW = [['PD', 'LONDON'], ['PD', 'NY'], ['ASIA', 'LONDON'], ['LONDON', 'NY']];
for (const ctx of [false, true]) for (const [level, session] of SW) for (const dir of DIRS) base.push({ family: 'SWEEP', level, session, dir, ctx, rvol: false });
for (const ctx of [false, true]) for (const session of ['LONDON', 'NY']) for (const dir of DIRS) base.push({ family: 'VWAP', session, dir, ctx, rvol: false });

const primaryWin = (f) => (f === 'ORB' ? 4 : 8);
const altWin = (f) => (f === 'ORB' ? 3 : 12);
export const PRIMARY = base.map((c) => ({ ...c, buf: 0.10, exit: '2R', win: primaryWin(c.family), role: 'primary' }));
export const NEIGHBOURS = PRIMARY.flatMap((p, k) => [
  { ...p, buf: 0.25, role: 'n1', of: k },
  { ...p, exit: '1R+2R', role: 'n2', of: k },
  { ...p, win: altWin(p.family), role: 'n3', of: k },
]);
export const GRID = [...PRIMARY, ...NEIGHBOURS];
if (PRIMARY.length !== 36 || GRID.length !== 144) throw new Error(`grid size ${PRIMARY.length}/${GRID.length} != 36/144`);
export { T as TIMES, N as NBARS };
