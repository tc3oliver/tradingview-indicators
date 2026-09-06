// M2-H research runner. `npm run research:m2h`
//
// Runs the study frozen in PRE-REGISTRATION-M2H.md over whatever days the feature store
// holds. If the store does not cover the pre-registered acceptance window, every result
// is labelled PRELIMINARY and no PASS can be issued — that decision is made here, once,
// from the coverage, and cannot be overridden downstream.
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { readDay, storedDays, manifest } from '../historical/store.mjs';
import { COST_PROFILES, FEES } from '../collector/config.mjs';
import { RELIABLE_SINCE } from '../historical/tardis.mjs';
import { olsNW, demeanByGroup, rankIC, meanT, quantiles, bucketOf, effectiveN, normInv, mean, stdev } from './stats.mjs';

export const SPLITS = {
  dev: ['2020-05-14', '2022-12-31'],
  val: ['2023-01-01', '2024-12-31'],
  test: ['2025-01-01', '2026-08-31'],
};
export const HORIZONS = { '5s': 5, '30s': 30, '5m': 300 };
export const PRIMARY_HORIZON = '30s';
export const PRIMARY_SIZE = 10000;
export const SECONDARY_SIZE = 50000;
export const HAC_SECONDS = 60;
export const MIN_PRACTICAL_SAVING_BP = 0.5;    // carried unchanged from the M2 freeze
export const PRIOR_EFFECTIVE_N = 121;          // cumulative through M1
export const WAIT_HORIZONS = [5, 30];

// The six frozen feature families, read straight out of the columnar store.
export const FEATURES = {
  D1_depthImbalance: (c, i) => c.imbTop5[i],
  D2_micropriceDisplacementBp: (c, i) => c.micropriceDisplacementBp[i],
  D3_orderFlowImbalance5s: (c, i) => c.flow5sAfi[i],
  D4_depthChange: (c, i, prev) => (prev >= 0
    ? Math.log(Math.max(1, c.depthBid5bp[i] + c.depthAsk5bp[i]) / Math.max(1, c.depthBid5bp[prev] + c.depthAsk5bp[prev])) : NaN),
  D5_pressureToCapacity: (c, i) => c.pressureToCapacity[i],
  D6_flowTimesFragility: (c, i) => c.flowTimesFragility[i],
};

const NEEDED = ['at', 'bid', 'ask', 'mid', 'spreadBp', 'micropriceDisplacementBp',
  'depthBid5bp', 'depthAsk5bp', 'imbTop5', 'flow5sAfi', 'pressureToCapacity', 'flowTimesFragility',
  'execBuy10kVwap', 'execBuy10kSlipBp', 'execBuy10kComplete', 'execSell10kVwap', 'execSell10kSlipBp', 'execSell10kComplete',
  'execBuy50kVwap', 'execBuy50kComplete', 'execSell50kVwap', 'execSell50kComplete'];

// ---------------------------------------------------------------- loading
export function loadPanel(days = storedDays()) {
  let total = 0;
  const perDay = [];
  for (const iso of days) {
    const d = readDay(iso);
    if (!d) continue;
    perDay.push({ iso, d });
    total += d.n;
  }
  const cols = Object.fromEntries(NEEDED.map((k) => [k, new Float64Array(total)]));
  const dayIdx = new Int32Array(total);
  const sec = new Float64Array(total);
  const dayList = [];
  let o = 0;
  for (const { iso, d } of perDay) {
    const di = dayList.push(iso) - 1;
    for (const k of NEEDED) cols[k].set(d.cols[k], o);
    for (let i = 0; i < d.n; i++) { dayIdx[o + i] = di; sec[o + i] = Math.floor(d.cols.at[i] / 1000); }
    o += d.n;
  }
  return { n: total, cols, dayIdx, sec, days: dayList };
}

/** Index of the row exactly `h` seconds after row i, or -1. Two-pointer, so O(n). */
function offsetIndex(p, h) {
  const out = new Int32Array(p.n).fill(-1);
  let j = 0;
  for (let i = 0; i < p.n; i++) {
    const want = p.sec[i] + h;
    if (j < i) j = i;
    while (j < p.n && p.sec[j] < want) j++;
    if (j < p.n && p.sec[j] === want && p.dayIdx[j] === p.dayIdx[i]) out[i] = j;
  }
  return out;
}

const splitOf = (p, i) => {
  const iso = p.days[p.dayIdx[i]];
  if (iso >= SPLITS.dev[0] && iso <= SPLITS.dev[1]) return 'dev';
  if (iso >= SPLITS.val[0] && iso <= SPLITS.val[1]) return 'val';
  if (iso >= SPLITS.test[0] && iso <= SPLITS.test[1]) return 'test';
  return null;
};

// ---------------------------------------------------------------- study
export function buildPanel(days) {
  const p = loadPanel(days);
  p.fwdIdx = Object.fromEntries(Object.entries(HORIZONS).map(([k, h]) => [k, offsetIndex(p, h)]));
  p.pastIdx = offsetIndex(p, -30);
  // -30 needs a backward walk; redo it directly
  {
    const out = new Int32Array(p.n).fill(-1);
    let j = 0;
    for (let i = 0; i < p.n; i++) {
      const want = p.sec[i] - 30;
      while (j < p.n && p.sec[j] < want) j++;
      if (j < p.n && p.sec[j] === want && p.dayIdx[j] === p.dayIdx[i]) out[i] = j;
    }
    p.pastIdx = out;
  }
  p.split = new Array(p.n);
  for (let i = 0; i < p.n; i++) p.split[i] = splitOf(p, i);
  p.featVals = {};
  for (const [name, fn] of Object.entries(FEATURES)) {
    const v = new Float64Array(p.n);
    for (let i = 0; i < p.n; i++) {
      const prev = i > 0 && p.dayIdx[i - 1] === p.dayIdx[i] && p.sec[i - 1] === p.sec[i] - 1 ? i - 1 : -1;
      v[i] = fn(p.cols, i, prev);
    }
    p.featVals[name] = v;
  }
  return p;
}

const fwdRet = (p, hname, i) => {
  const j = p.fwdIdx[hname][i];
  return j < 0 ? NaN : Math.log(p.cols.mid[j] / p.cols.mid[i]);
};
const pastRet = (p, i) => {
  const j = p.pastIdx[i];
  return j < 0 ? NaN : Math.log(p.cols.mid[i] / p.cols.mid[j]);
};

/**
 * Predictive regression on NON-OVERLAPPING observations.
 *
 * At 1 Hz a 30-second forward return overlaps its 29 neighbours, so consecutive rows are
 * 97% the same number. Stepping by the horizon makes the observations independent by
 * construction and keeps the Newey-West lag at the pre-registered 60 SECONDS rather than
 * 60 rows. The point estimate is unaffected; the standard error stops being fiction.
 */
export function fit(p, fname, hname, keep) {
  const h = HORIZONS[hname];
  const lag = Math.max(1, Math.round(HAC_SECONDS / h));
  const idx = [];
  for (let i = 0; i < p.n; i += h) {
    if (!keep(i)) continue;
    const y = fwdRet(p, hname, i), x = p.featVals[fname][i], pr = pastRet(p, i);
    if (![y, x, pr, p.cols.spreadBp[i]].every(Number.isFinite)) continue;
    const dep = p.cols.depthBid5bp[i] + p.cols.depthAsk5bp[i];
    if (!(dep > 0)) continue;
    idx.push(i);
  }
  if (idx.length < 500) return null;
  const g = idx.map((i) => new Date(p.sec[i] * 1000).getUTCHours());
  const y = demeanByGroup(Float64Array.from(idx, (i) => fwdRet(p, hname, i)), g, 24);
  const names = [fname, 'pastReturn', 'spreadBp', 'lnDepth'];
  const raw = [
    Float64Array.from(idx, (i) => p.featVals[fname][i]),
    Float64Array.from(idx, (i) => pastRet(p, i)),
    Float64Array.from(idx, (i) => p.cols.spreadBp[i]),
    Float64Array.from(idx, (i) => Math.log(Math.max(1, p.cols.depthBid5bp[i] + p.cols.depthAsk5bp[i]))),
  ].map((c) => demeanByGroup(c, g, 24));
  const kept = [], keptNames = [], dropped = [];
  for (let j = 0; j < raw.length; j++) {
    if (stdev(Array.from(raw[j])) > 1e-12) { kept.push(raw[j]); keptNames.push(names[j]); } else dropped.push(names[j]);
  }
  if (!keptNames.includes(fname)) return null;
  const X = idx.map((_, r) => kept.map((c) => c[r]));
  const res = olsNW(Array.from(y), X, lag);
  return { n: res.n, beta: res.beta[1], se: res.se[1], t: res.t[1], r2: res.r2, hacLagPeriods: lag,
    ci: [res.beta[1] - 1.96 * res.se[1], res.beta[1] + 1.96 * res.se[1]], droppedControls: dropped,
    rankIC: rankIC(idx.map((i) => p.featVals[fname][i]), idx.map((i) => fwdRet(p, hname, i))) };
}

export function deciles(p, fname, hname, keep, edges) {
  const h = HORIZONS[hname];
  const bins = Array.from({ length: 10 }, () => []);
  for (let i = 0; i < p.n; i += h) {
    if (!keep(i)) continue;
    const x = p.featVals[fname][i], y = fwdRet(p, hname, i);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    bins[bucketOf(x, edges)].push(y);
  }
  const lag = Math.max(1, Math.round(HAC_SECONDS / h));
  const rows = bins.map((b, k) => ({ decile: k + 1, n: b.length, ...meanT(b, lag) }));
  const usable = rows.filter((r) => r.n > 0);
  const total = rows.reduce((s2, r) => s2 + r.n, 0);
  return { rows, n: total, usableDeciles: usable.length,
    mono: usable.length > 2 ? rankIC(usable.map((r) => r.decile), usable.map((r) => r.mean)) : NaN,
    topMinusBottomBp: (rows[9].mean - rows[0].mean) * 10000 };
}

export function devEdges(p, fname) {
  const v = [];
  for (let i = 0; i < p.n; i += 30) if (p.split[i] === 'dev' && Number.isFinite(p.featVals[fname][i])) v.push(p.featVals[fname][i]);
  return v.length > 100 ? quantiles(v, 10) : null;
}

// ---------------------------------------------------------------- backtest
/**
 * Walk-the-book backtest. Entry at the first executable second after the signal, exit at
 * the primary horizon, priced by the reconstructed book on both sides. No stop, no
 * target, no sizing rule, and no overlapping positions: a new signal while a position is
 * open is ignored rather than pyramided.
 */
export function backtest(p, fname, edges, { size = PRIMARY_SIZE, keep, direction = 'signal', shuffleSigns = null, random = null } = {}) {
  const h = HORIZONS[PRIMARY_HORIZON];
  const buyVwap = size === PRIMARY_SIZE ? p.cols.execBuy10kVwap : p.cols.execBuy50kVwap;
  const sellVwap = size === PRIMARY_SIZE ? p.cols.execSell10kVwap : p.cols.execSell50kVwap;
  const buyOk = size === PRIMARY_SIZE ? p.cols.execBuy10kComplete : p.cols.execBuy50kComplete;
  const sellOk = size === PRIMARY_SIZE ? p.cols.execSell10kComplete : p.cols.execSell50kComplete;
  const trades = [];
  let excludedNoBook = 0, excludedIncomplete = 0, openUntil = -1, rnd = 12345;
  const nextRnd = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let i = 0; i < p.n; i++) {
    if (keep && !keep(i)) continue;
    if (p.sec[i] <= openUntil) continue;
    let dir = 0;
    if (random !== null) { dir = nextRnd() < random ? (nextRnd() < 0.5 ? 1 : -1) : 0; }
    else {
      const x = p.featVals[fname][i];
      if (!Number.isFinite(x)) continue;
      const b = bucketOf(x, edges);
      if (b === 9) dir = 1; else if (b === 0) dir = -1; else continue;
      if (direction === 'reverse') dir = -dir;
      if (shuffleSigns) dir *= shuffleSigns[i % shuffleSigns.length];
    }
    if (!dir) continue;

    const e = i + 1 < p.n && p.dayIdx[i + 1] === p.dayIdx[i] && p.sec[i + 1] === p.sec[i] + 1 ? i + 1 : -1;
    if (e < 0) { excludedNoBook++; continue; }
    const xIdx = p.fwdIdx[PRIMARY_HORIZON][e];
    if (xIdx < 0) { excludedNoBook++; continue; }
    const entryOk = dir > 0 ? buyOk[e] : sellOk[e];
    const exitOk = dir > 0 ? sellOk[xIdx] : buyOk[xIdx];
    if (!(entryOk === 1 && exitOk === 1)) { excludedIncomplete++; continue; }
    const entry = dir > 0 ? buyVwap[e] : sellVwap[e];
    const exit = dir > 0 ? sellVwap[xIdx] : buyVwap[xIdx];
    if (!(entry > 0 && exit > 0)) { excludedIncomplete++; continue; }

    const grossBp = dir * ((exit - entry) / entry) * 10000;
    const netBp = grossBp - 2 * FEES.takerBp;
    trades.push({ i, sec: p.sec[i], day: p.days[p.dayIdx[i]], dir, entry, exit, grossBp, netBp });
    openUntil = p.sec[xIdx];
  }
  return { trades, excludedNoBook, excludedIncomplete, size };
}

export function metrics(bt) {
  const t = bt.trades;
  if (!t.length) return { trades: 0 };
  const net = t.map((x) => x.netBp), gross = t.map((x) => x.grossBp);
  const wins = net.filter((x) => x > 0), losses = net.filter((x) => x <= 0);
  const eq = []; let c = 0, peak = 0, maxDD = 0;
  for (const x of net) { c += x; eq.push(c); peak = Math.max(peak, c); maxDD = Math.max(maxDD, peak - c); }
  const m = mean(net), sd = stdev(net);
  const dn = net.filter((x) => x < 0);
  const downside = dn.length ? Math.sqrt(dn.reduce((s, x) => s + x * x, 0) / dn.length) : 0;
  let streak = 0, longest = 0;
  for (const x of net) { if (x <= 0) { streak++; longest = Math.max(longest, streak); } else streak = 0; }
  const sorted = [...net].sort((a, b) => b - a);
  const exBest = sorted.slice(Math.ceil(0.05 * sorted.length));
  const byKey = (fn) => {
    const g = {};
    for (const x of t) { const k = fn(x); (g[k] ??= []).push(x.netBp); }
    return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { n: v.length, meanBp: mean(v), sumBp: v.reduce((s, y) => s + y, 0) }]));
  };
  const days = new Set(t.map((x) => x.day)).size;
  const perDay = days ? t.length / days : 0;
  return {
    trades: t.length, excludedNoBook: bt.excludedNoBook, excludedIncomplete: bt.excludedIncomplete,
    grossBpPerTrade: mean(gross), netBpPerTrade: m, grossTotalBp: gross.reduce((s, x) => s + x, 0),
    netTotalBp: c, winRate: wins.length / t.length,
    profitFactor: losses.length ? wins.reduce((s, x) => s + x, 0) / -losses.reduce((s, x) => s + x, 0) : Infinity,
    sharpe: sd ? (m / sd) * Math.sqrt(perDay * 365) : NaN,
    sortino: downside ? (m / downside) * Math.sqrt(perDay * 365) : NaN,
    maxDrawdownBp: maxDD, calmar: maxDD ? (m * t.length) / maxDD : Infinity,
    avgHoldingSec: HORIZONS[PRIMARY_HORIZON], turnoverPerDay: perDay,
    longestLosingStreak: longest,
    netBpPerTradeExBest5pct: exBest.length ? mean(exBest) : NaN,
    tStat: meanT(net, 1).t,
    long: (() => { const v = t.filter((x) => x.dir > 0).map((x) => x.netBp); return { n: v.length, meanBp: v.length ? mean(v) : NaN, sumBp: v.reduce((s, x) => s + x, 0) }; })(),
    short: (() => { const v = t.filter((x) => x.dir < 0).map((x) => x.netBp); return { n: v.length, meanBp: v.length ? mean(v) : NaN, sumBp: v.reduce((s, x) => s + x, 0) }; })(),
    byYear: byKey((x) => x.day.slice(0, 4)), byMonth: byKey((x) => x.day.slice(0, 7)),
  };
}

// ---------------------------------------------------------------- execution study
export function executionStudy(p, { size = PRIMARY_SIZE, stepSec = 30 } = {}) {
  const buyV = size === PRIMARY_SIZE ? p.cols.execBuy10kVwap : p.cols.execBuy50kVwap;
  const sellV = size === PRIMARY_SIZE ? p.cols.execSell10kVwap : p.cols.execSell50kVwap;
  const buyOk = size === PRIMARY_SIZE ? p.cols.execBuy10kComplete : p.cols.execBuy50kComplete;
  const sellOk = size === PRIMARY_SIZE ? p.cols.execSell10kComplete : p.cols.execSell50kComplete;
  const out = {};
  for (const side of ['BUY', 'SELL']) {
    const V = side === 'BUY' ? buyV : sellV, ok = side === 'BUY' ? buyOk : sellOk, sign = side === 'BUY' ? 1 : -1;
    const immediate = [], paired = Object.fromEntries(WAIT_HORIZONS.map((w) => [w, []]));
    const waitAbs = Object.fromEntries(WAIT_HORIZONS.map((w) => [w, []]));
    const waitIdx = Object.fromEntries(WAIT_HORIZONS.map((w) => [w, offsetIndexCache(p, w)]));
    for (let i = 0; i < p.n; i += stepSec) {
      if (ok[i] !== 1) continue;
      const decisionMid = p.cols.mid[i];
      const isNow = (sign * (V[i] - decisionMid) / decisionMid) * 10000 + FEES.takerBp;
      immediate.push(isNow);
      for (const w of WAIT_HORIZONS) {
        const j = waitIdx[w][i];
        if (j < 0 || ok[j] !== 1) continue;
        const later = (sign * (V[j] - decisionMid) / decisionMid) * 10000 + FEES.takerBp;
        waitAbs[w].push(later);
        paired[w].push(later - isNow);
      }
    }
    out[side] = { size, n: immediate.length, immediate: meanT(immediate, 2),
      wait: Object.fromEntries(WAIT_HORIZONS.map((w) => [w, meanT(waitAbs[w], 2)])),
      waitMinusImmediate: Object.fromEntries(WAIT_HORIZONS.map((w) => {
        const m = meanT(paired[w], 2), s = [...paired[w]].sort((a, b) => a - b);
        return [w, { ...m, p95AdverseTail: s.length ? s[Math.floor(0.95 * s.length)] : NaN, dispersion: stdev(paired[w]),
          materiallyBetterToActNow: m.mean > MIN_PRACTICAL_SAVING_BP && m.t > 2,
          materiallyBetterToWait: m.mean < -MIN_PRACTICAL_SAVING_BP && m.t < -2 }];
      })) };
  }
  return out;
}
const _offCache = new Map();
function offsetIndexCache(p, h) {
  if (!_offCache.has(h)) _offCache.set(h, offsetIndex(p, h));
  return _offCache.get(h);
}

/** Passive-order toxicity: mid drift relative to where a passive order would have rested. */
export function passiveToxicity(p, { stepSec = 30 } = {}) {
  const out = { note: 'MEASUREMENT ONLY — no fill is assumed, no queue position is modelled, this is not maker PnL', buy: {}, sell: {} };
  for (const w of [1, 5, 30]) {
    const idx = offsetIndexCache(p, w);
    const buy = [], sell = [];
    for (let i = 0; i < p.n; i += stepSec) {
      const j = idx[i]; if (j < 0) continue;
      buy.push(((p.cols.mid[j] - p.cols.bid[i]) / p.cols.bid[i]) * 10000);
      sell.push(((p.cols.ask[i] - p.cols.mid[j]) / p.cols.ask[i]) * 10000);
    }
    out.buy[`${w}s`] = meanT(buy, 2);
    out.sell[`${w}s`] = meanT(sell, 2);
  }
  out.queueModel = 'UNRESOLVED — Tardis aggregate L2 carries no individual order queue identity, so maker fills cannot be modelled and no maker PnL is computed';
  return out;
}

// ---------------------------------------------------------------- runner
export function run({ days = storedDays(), out = true } = {}) {
  const generated = new Date().toISOString();
  const man = manifest();
  if (!days.length) {
    const r = { generated, status: 'NO DATA', reason: 'the historical feature store is empty; run `npm run m2h:replay`' };
    if (out) writeStatus(r);
    return r;
  }
  // The pre-registration makes reconciliation a precondition, not a footnote: if the bulk
  // vendor path does not reproduce a sequence-verified book, nothing computed from it may
  // be reported as being about the same market our planner measures.
  const rec = readReconciliation();
  if (rec?.verdict?.csvReproducesSequenceVerifiedBook === false) {
    const r = { generated, status: 'HALTED — RECONCILIATION FAILED',
      reason: 'the vendor CSV path does not reproduce a sequence-verified book, so vendor results may not be carried to the live planner',
      reconciliation: rec.verdict, directionalGatePassed: false };
    if (out) writeStatus(r);
    return r;
  }

  const p = buildPanel(days);
  const coverage = assessCoverage(days, man);

  const results = {}, trials = [], gates = {}, econ = {}, backtests = {};
  const inSplit = (s) => (i) => p.split[i] === s;
  const valtest = (i) => p.split[i] === 'val' || p.split[i] === 'test';

  for (const fname of Object.keys(FEATURES)) {
    const edges = devEdges(p, fname);
    results[fname] = { edges };
    for (const hname of Object.keys(HORIZONS)) {
      const per = {};
      for (const s of ['dev', 'val', 'test']) per[s] = fit(p, fname, hname, inSplit(s));
      per.valtest = fit(p, fname, hname, valtest);
      per.all = fit(p, fname, hname, () => true);
      results[fname][hname] = per;
      for (const s of ['dev', 'val', 'test']) {
        trials.push({ study: 'M2H', feature: fname, horizon: hname, split: s, primary: hname === PRIMARY_HORIZON,
          n: per[s]?.n ?? 0, beta: per[s]?.beta ?? null, t: per[s]?.t ?? null });
      }
    }
    if (edges) {
      const nonEmpty = (d) => (d && d.n > 0 && d.usableDeciles > 2 ? d : null);
      results[fname].decilesBySplit = Object.fromEntries(['dev', 'val', 'test'].map((s) => [s, nonEmpty(deciles(p, fname, PRIMARY_HORIZON, inSplit(s), edges))]));
      results[fname].deciles = nonEmpty(deciles(p, fname, PRIMARY_HORIZON, valtest, edges));
    }
  }

  // effective trials from the daily score series of each configuration
  const eff = effectiveTrials(p);
  const cumulative = PRIOR_EFFECTIVE_N + (eff.effective ?? eff.configs ?? 1);
  const tThreshold = normInv(1 - 0.05 / (2 * cumulative));

  // information gates, then economics, then the backtest — in that order, always
  // Economics is computed for every feature regardless of whether the information gates
  // can even be evaluated. "How big was the edge against the cost of trading it" is the
  // question a reader asks first, and an empty table because a split was thin is not an
  // answer. Whether a feature PASSES is decided by the gates, never by this.
  const measuredSlipBp = medianOf(p.cols.execBuy10kSlipBp);
  for (const fname of Object.keys(FEATURES)) {
    const d = results[fname].deciles ?? results[fname].decilesBySplit?.dev;
    const grossBp = d ? Math.abs(d.topMinusBottomBp) / 2 : NaN;
    econ[fname] = { grossEdgeBp: grossBp, measuredHalfSpreadPlusImpactBp: measuredSlipBp,
      basis: results[fname].deciles ? 'validation ∪ test' : 'development only (later splits not yet in the store)', profiles: {} };
    for (const prof of Object.values(COST_PROFILES)) {
      const rt = prof.id === 'A' ? prof.roundTripBp + 2 * measuredSlipBp : prof.roundTripBp;
      econ[fname].profiles[prof.id] = { name: prof.name, roundTripBp: rt, usableForAcceptance: prof.usableForAcceptance,
        netEdgeBp: grossBp - rt, costOverEdge: grossBp > 0 ? rt / grossBp : Infinity,
        tradable: prof.usableForAcceptance && grossBp > rt };
    }
    econ[fname].economicallyTradable = ['A', 'B'].every((k) => econ[fname].profiles[k].tradable);
  }

  for (const fname of Object.keys(FEATURES)) {
    const per = results[fname][PRIMARY_HORIZON], d = results[fname].deciles;
    const g = { G5_economic: econ[fname].economicallyTradable === true };
    if (!per?.dev || !per?.val || !per?.test || !per?.valtest || !d) {
      g.evaluable = false;
      g.failed = ['insufficient observations in one or more splits'];
      g.informationPass = false; g.pass = false;
      gates[fname] = g;
      continue;
    }
    g.evaluable = true;
    const sign = Math.sign(per.valtest.beta) || 1;
    g.G1_signStableAcrossSplits = Math.sign(per.dev.beta) === sign && Math.sign(per.val.beta) === sign && Math.sign(per.test.beta) === sign;
    g.G2_significantOnValAndTest = Math.abs(per.val.t) >= 2 && Math.abs(per.test.t) >= 2;
    g.G3_multipleTesting = Math.abs(per.valtest.t) > tThreshold;
    g.G4_decileMonotonicity = Math.abs(d.mono) >= 0.7 && Math.sign(d.mono) === sign;
    g.failed = ['G1_signStableAcrossSplits', 'G2_significantOnValAndTest', 'G3_multipleTesting', 'G4_decileMonotonicity', 'G5_economic'].filter((k) => !g[k]);
    g.informationPass = ['G1_signStableAcrossSplits', 'G2_significantOnValAndTest', 'G3_multipleTesting', 'G4_decileMonotonicity'].every((k) => g[k]);
    g.pass = g.informationPass && g.G5_economic;
    gates[fname] = g;
  }

  // Backtests are run for every feature regardless, because "how much would it actually
  // have made" is the question a reader asks first and a table of coefficients does not
  // answer it. Whether a candidate PASSES is decided by the gates above, not by this.
  // Out-of-sample where possible; the whole panel, clearly labelled, when the later
  // splits are not in the store yet.
  let hasValTest = false;
  for (let i = 0; i < p.n; i++) if (valtest(i)) { hasValTest = true; break; }
  const backtestKeep = hasValTest ? valtest : () => true;
  const backtestBasis = hasValTest ? 'validation ∪ test' : 'all stored days (later splits not yet in the store)';
  for (const fname of Object.keys(FEATURES)) {
    const edges = results[fname].edges;
    if (!edges) continue;
    const shuffle = Int8Array.from({ length: 9973 }, (_, k) => ((k * 2654435761) % 2 ? 1 : -1));
    backtests[fname] = {
      primary: metrics(backtest(p, fname, edges, { size: PRIMARY_SIZE, keep: backtestKeep })),
      secondary: metrics(backtest(p, fname, edges, { size: SECONDARY_SIZE, keep: backtestKeep })),
      devSplit: metrics(backtest(p, fname, edges, { size: PRIMARY_SIZE, keep: inSplit('dev') })),
      baselineSignShuffled: metrics(backtest(p, fname, edges, { size: PRIMARY_SIZE, keep: backtestKeep, shuffleSigns: shuffle })),
    };
  }
  const anyEdges = Object.values(results).find((r) => r.edges)?.edges;
  const baselines = {
    randomEntries: metrics(backtest(p, 'D1_depthImbalance', anyEdges, { size: PRIMARY_SIZE, keep: backtestKeep, random: 0.2 })),
    m1AfiReversal: metrics(backtest(p, 'D3_orderFlowImbalance5s', results.D3_orderFlowImbalance5s.edges, { size: PRIMARY_SIZE, keep: backtestKeep, direction: 'reverse' })),
  };

  const execution = { primary: executionStudy(p, { size: PRIMARY_SIZE }), secondary: executionStudy(p, { size: SECONDARY_SIZE }),
    toxicity: passiveToxicity(p) };

  const informationPass = Object.values(gates).some((g) => g.informationPass);
  const fullPass = Object.values(gates).some((g) => g.pass);
  const status = !coverage.acceptanceEligible
    ? 'PRELIMINARY — BLOCKED BY HISTORICAL DATA ACCESS'
    : fullPass ? 'RETROSPECTIVE PASS' : informationPass ? 'NOT TRADABLE' : 'REJECTED';

  const r = { generated, provider: 'tardis.dev', exchange: 'binance-futures', symbol: 'BTCUSDT',
    reliableSince: RELIABLE_SINCE, splits: SPLITS, coverage, status,
    acceptanceEligible: coverage.acceptanceEligible,
    historicalInformationPass: informationPass && coverage.acceptanceEligible,
    historicalPass: fullPass && coverage.acceptanceEligible,
    reconciliation: rec ? { verdict: rec.verdict, comparedSeconds: rec.csvVsRaw?.compared ?? 0, windows: rec.windows?.length ?? 0 } : null,
    results, gates, economics: econ, backtests, backtestBasis, baselines, execution,
    effectiveTrials: eff, cumulativeEffectiveN: cumulative, multipleTestingT: tThreshold,
    trials, panelRows: p.n };
  if (out) { writeResults(r); writeAudit(man); }
  return r;
}

function readReconciliation() {
  const f = new URL('./reconciliation-m2h.json', import.meta.url).pathname;
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}

function medianOf(arr) {
  const v = [];
  for (let i = 0; i < arr.length; i += 997) if (Number.isFinite(arr[i])) v.push(arr[i]);
  v.sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
}

function assessCoverage(days, man) {
  const inWindow = days.filter((d) => d >= RELIABLE_SINCE && d <= SPLITS.test[1]);
  const bySplit = { dev: 0, val: 0, test: 0 };
  for (const d of inWindow) {
    if (d <= SPLITS.dev[1]) bySplit.dev++;
    else if (d <= SPLITS.val[1]) bySplit.val++;
    else bySplit.test++;
  }
  const requiredDays = Math.round((Date.parse(SPLITS.test[1]) - Date.parse(SPLITS.dev[0])) / 86400000) + 1;
  const validPct = inWindow.length
    ? inWindow.reduce((s, d) => s + (man.days[d]?.validCoveragePct ?? 0), 0) / inWindow.length : 0;
  return {
    storedDays: days.length, daysInWindow: inWindow.length, requiredDays,
    coveragePctOfWindow: (inWindow.length / requiredDays) * 100,
    bySplit, meanValidBookCoveragePct: validPct,
    totalRows: Object.values(man.days || {}).reduce((s, d) => s + (d.rows || 0), 0),
    storeBytes: man.totalBytes ?? 0,
    archiveBytes: Object.values(man.days || {}).reduce((s, d) => s + (d.archiveBytes || 0), 0),
    // The acceptance window must be substantially covered, not sampled one day a month.
    acceptanceEligible: (inWindow.length / requiredDays) >= 0.5,
    reason: (inWindow.length / requiredDays) >= 0.5 ? null
      : `only ${inWindow.length} of ${requiredDays} days in the acceptance window are present (${((inWindow.length / requiredDays) * 100).toFixed(1)}%); free-tier access serves the first day of each month only`,
  };
}

export function effectiveTrials(p) {
  const series = [];
  for (const fname of Object.keys(FEATURES)) {
    for (const [hname, h] of Object.entries(HORIZONS)) {
      const daily = new Map();
      for (let i = 0; i < p.n; i += h) {
        const x = p.featVals[fname][i], y = fwdRet(p, hname, i);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const d = p.dayIdx[i];
        daily.set(d, (daily.get(d) || 0) + x * y);
      }
      series.push(daily);
    }
  }
  const days = [...new Set(series.flatMap((m) => [...m.keys()]))].sort((a, b) => a - b);
  if (days.length < 3) return { raw: series.length * 3, configs: series.length, effective: series.length,
    note: 'too few days to estimate correlation; the raw configuration count is used, which is the conservative choice' };
  return effectiveN(series.map((m) => days.map((d) => m.get(d) || 0)), 0.5);
}

// ---------------------------------------------------------------- reports
const f2 = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const bp = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) + ' bp' : 'n/a');

function writeStatus(r) {
  writeFileSync(new URL('./STATUS-M2H.md', import.meta.url).pathname,
    `# M2-H status\n\n${r.status}\n\n${r.reason || ''}\n`);
  writeFileSync(new URL('./results-m2h.json', import.meta.url).pathname, JSON.stringify(r, null, 2));
}

function writeAudit(man) {
  const days = Object.keys(man.days || {}).sort();
  const L = ['# M2-H book reconstruction audit', '',
    'One row per replayed UTC day. Bad intervals are excluded from the study, never interpolated:',
    'a second without a valid book produces no feature record and therefore no observation.', '',
    '| day | depth events | level rows | trades | snapshots | crossed | invalidations | max levels | valid coverage | archive | store |',
    '|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const d of days) {
    const x = man.days[d];
    L.push(`| ${d} | ${((x.depthEvents || 0) / 1e6).toFixed(2)}M | ${((x.rows || 0)).toLocaleString()} | ${((x.tradeEvents || 0) / 1e3).toFixed(0)}k | ${x.snapshots ?? 0} | ${x.crossedBooks ?? 0} | ${x.invalidations ?? 0} | ${x.maxBookLevels ?? 0} | ${f2(x.validCoveragePct, 1)}% | ${((x.archiveBytes || 0) / 1048576).toFixed(0)} MB | ${((x.bytes || 0) / 1048576).toFixed(1)} MB |`);
  }
  const tot = Object.values(man.days || {});
  L.push('', `**${days.length} days.** Mean valid-book coverage ${f2(tot.reduce((s, x) => s + (x.validCoveragePct || 0), 0) / Math.max(1, tot.length), 2)}%. `
    + `Crossed books ${tot.reduce((s, x) => s + (x.crossedBooks || 0), 0)}, invalidations ${tot.reduce((s, x) => s + (x.invalidations || 0), 0)}. `
    + `Archives read ${(tot.reduce((s, x) => s + (x.archiveBytes || 0), 0) / 1073741824).toFixed(1)} GB, feature store ${(tot.reduce((s, x) => s + (x.bytes || 0), 0) / 1048576).toFixed(0)} MB.`, '');
  writeFileSync(new URL('./AUDIT-M2H.md', import.meta.url).pathname, L.join('\n'));
}

function writeResults(r) {
  const L = [];
  L.push('# M2-H results — historical L2 retrospective validation', '');
  L.push(`Generated ${r.generated}. Pre-registered in [\`PRE-REGISTRATION-M2H.md\`](./PRE-REGISTRATION-M2H.md).`, '');
  L.push(`## Verdict: **${r.status}**`, '');
  if (!r.acceptanceEligible) {
    L.push('> **These numbers cannot produce a PASS.** ' + r.coverage.reason);
    L.push('> The pre-registration forbids treating free-tier sample days as the acceptance dataset.');
    L.push('> Everything below is the study running end to end on the days available, which is what');
    L.push('> makes the engineering verifiable — not a verdict on the acceptance window.', '');
  }
  L.push('## Coverage', '', '| | |', '|---|---|');
  const c = r.coverage;
  L.push(`| acceptance window | ${SPLITS.dev[0]} → ${SPLITS.test[1]} (${c.requiredDays} days) |`);
  L.push(`| days in the store | ${c.daysInWindow} (${f2(c.coveragePctOfWindow, 1)}% of the window) |`);
  L.push(`| by split | dev ${c.bySplit.dev} · val ${c.bySplit.val} · test ${c.bySplit.test} |`);
  L.push(`| 1-second feature rows | ${c.totalRows.toLocaleString()} |`);
  L.push(`| mean valid-book coverage per day | ${f2(c.meanValidBookCoveragePct, 2)}% |`);
  L.push(`| archives read / feature store | ${(c.archiveBytes / 1073741824).toFixed(1)} GB / ${(c.storeBytes / 1048576).toFixed(0)} MB |`);
  if (r.reconciliation) {
    L.push(`| reconciliation against the sequence-verified feed | ${r.reconciliation.verdict.pass ? '**PASS**' : 'FAIL'} over ${r.reconciliation.comparedSeconds} pooled seconds |`);
  }
  L.push('');

  L.push('## Information — coefficient on the future mid return', '');
  L.push(`Primary horizon **${PRIMARY_HORIZON}**. Non-overlapping observations (step = horizon), hour-of-day fixed effects, controls for the previous 30 s return, spread and log near-touch depth, Newey–West at ${HAC_SECONDS} s.`, '');
  L.push('| feature | dev β (t) | val β (t) | test β (t) | val∪test β (t) | rank IC | decile mono | top−bottom |', '|---|---|---|---|---|---|---|---|');
  for (const fname of Object.keys(FEATURES)) {
    const per = r.results[fname][PRIMARY_HORIZON], d = r.results[fname].deciles;
    const cell = (x) => (x ? `${x.beta.toExponential(2)} (${f2(x.t)})` : 'n/a');
    L.push(`| ${fname} | ${cell(per.dev)} | ${cell(per.val)} | ${cell(per.test)} | ${cell(per.valtest)} | ${f2(per.valtest?.rankIC, 4)} | ${f2(d?.mono)} | ${bp(d?.topMinusBottomBp)} |`);
  }
  L.push('');
  L.push('### Robustness horizons (val ∪ test)', '', '| feature | 5s β (t) | 30s β (t) | 5m β (t) |', '|---|---|---|---|');
  for (const fname of Object.keys(FEATURES)) {
    const cell = (h) => { const x = r.results[fname][h]?.valtest; return x ? `${x.beta.toExponential(2)} (${f2(x.t)})` : 'n/a'; };
    L.push(`| ${fname} | ${cell('5s')} | ${cell('30s')} | ${cell('5m')} |`);
  }
  L.push('');

  L.push('## Gates', '', `Multiple-testing threshold |t| > **${f2(r.multipleTestingT)}** at ${f2(r.cumulativeEffectiveN, 1)} cumulative effective trials.`, '');
  L.push('| feature | G1 sign stable | G2 \\|t\\|≥2 val & test | G3 multiple testing | G4 monotonicity | G5 economic | verdict |', '|---|---|---|---|---|---|---|');
  for (const [fname, g] of Object.entries(r.gates)) {
    const y = (v) => (v ? 'pass' : 'FAIL');
    L.push(`| ${fname} | ${y(g.G1_signStableAcrossSplits)} | ${y(g.G2_significantOnValAndTest)} | ${y(g.G3_multipleTesting)} | ${y(g.G4_decileMonotonicity)} | ${y(g.G5_economic)} | ${g.pass ? 'PASS' : 'REJECTED'} |`);
  }
  L.push('');

  L.push('## Economics — information is not tradability', '');
  L.push(`Measured half-spread plus book impact for a $${PRIMARY_SIZE.toLocaleString()} order, from the reconstructed book: **${bp(Object.values(r.economics)[0]?.measuredHalfSpreadPlusImpactBp)}** per side. Gross edge basis: ${Object.values(r.economics)[0]?.basis}.`, '');
  L.push('| feature | gross edge | A: commission + measured book cost | B: 14 bp | C: 20 bp | tradable |', '|---|---|---|---|---|---|');
  for (const [fname, e] of Object.entries(r.economics)) {
    const p2 = (k) => `${bp(e.profiles[k].netEdgeBp)} net (${f2(e.profiles[k].costOverEdge, 1)}× cost/edge)`;
    L.push(`| ${fname} | ${bp(e.grossEdgeBp)} | ${p2('A')} | ${p2('B')} | ${p2('C')} | ${e.profiles.A.tradable && e.profiles.B.tradable ? 'yes' : '**no**'} |`);
  }
  L.push('');

  L.push('## Walk-the-book backtest', '');
  L.push(`Signal at second *t*, entry at the next executable second, exit ${HORIZONS[PRIMARY_HORIZON]} s later, both priced by walking the reconstructed book. No stop, no target, no overlapping positions. Commission ${FEES.takerBp} bp per side. Sample: ${r.backtestBasis}.`, '');
  L.push('| candidate | trades | gross/trade | net/trade | win | PF | Sharpe | max DD | net ex-best-5% | long | short |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [fname, b] of Object.entries(r.backtests)) {
    const m = b.primary;
    if (!m.trades) { L.push(`| ${fname} | 0 | — | — | — | — | — | — | — | — | — |`); continue; }
    L.push(`| ${fname} | ${m.trades.toLocaleString()} | ${bp(m.grossBpPerTrade)} | ${bp(m.netBpPerTrade)} | ${f2(100 * m.winRate, 1)}% | ${f2(m.profitFactor)} | ${f2(m.sharpe)} | ${f2(m.maxDrawdownBp, 0)} bp | ${bp(m.netBpPerTradeExBest5pct)} | ${bp(m.long.meanBp)} | ${bp(m.short.meanBp)} |`);
  }
  L.push('');
  L.push('### Baselines', '', '| baseline | trades | net/trade | PF |', '|---|---|---|---|');
  for (const [k, m] of Object.entries(r.baselines)) {
    L.push(`| ${k} | ${(m.trades || 0).toLocaleString()} | ${bp(m.netBpPerTrade)} | ${f2(m.profitFactor)} |`);
  }
  const sh = Object.entries(r.backtests).map(([k, b]) => `${k} ${bp(b.baselineSignShuffled?.netBpPerTrade)}`).join(' · ');
  L.push('', `Sign-shuffled controls: ${sh}`, '');

  L.push('## Execution study (Part B)', '');
  L.push(`Given a decision to trade, immediate execution versus waiting. Implementation shortfall against the decision-time mid, commission included. Acceptance threshold: **${MIN_PRACTICAL_SAVING_BP} bp** with |t| > 2.`, '');
  L.push('| side | size | immediate | wait 5s − now | wait 30s − now | p95 adverse (30s) | material? |', '|---|---|---|---|---|---|---|');
  for (const [label, block] of [[`$${PRIMARY_SIZE / 1000}k`, r.execution.primary], [`$${SECONDARY_SIZE / 1000}k`, r.execution.secondary]]) {
    for (const side of ['BUY', 'SELL']) {
      const e = block[side];
      const w5 = e.waitMinusImmediate[5], w30 = e.waitMinusImmediate[30];
      const mat = w30.materiallyBetterToActNow ? 'act now' : w30.materiallyBetterToWait ? 'wait' : 'no';
      L.push(`| ${side} | ${label} | ${bp(e.immediate.mean)} | ${bp(w5.mean)} (t ${f2(w5.t)}) | ${bp(w30.mean)} (t ${f2(w30.t)}) | ${bp(w30.p95AdverseTail)} | ${mat} |`);
    }
  }
  L.push('');
  L.push('### Passive-order toxicity (measurement, not maker PnL)', '', '| horizon | passive buy | t | passive sell | t |', '|---|---|---|---|---|');
  for (const w of ['1s', '5s', '30s']) {
    const b = r.execution.toxicity.buy[w], s = r.execution.toxicity.sell[w];
    L.push(`| ${w} | ${bp(b.mean)} | ${f2(b.t)} | ${bp(s.mean)} | ${f2(s.t)} |`);
  }
  L.push('', `Queue model: **${r.execution.toxicity.queueModel}**`, '');

  L.push('## Trials', '', `Raw registry entries ${r.trials.length}, configurations ${Object.keys(FEATURES).length * Object.keys(HORIZONS).length}, effective independent ${f2(r.effectiveTrials.effective, 1)}. Cumulative across every study here: **${f2(r.cumulativeEffectiveN, 1)}**.`, '');
  writeFileSync(new URL('./RESULTS-M2H.md', import.meta.url).pathname, L.join('\n'));
  writeFileSync(new URL('./results-m2h.json', import.meta.url).pathname, JSON.stringify(r, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = run();
  console.log(r.status, '—', r.coverage ? `${r.coverage.daysInWindow} days, ${r.panelRows?.toLocaleString()} rows` : r.reason);
}
