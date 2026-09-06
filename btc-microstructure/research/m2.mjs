// M2 research runner.  `npm run research:m2`
//
// Refuses to produce any statistical outcome until the pre-registered sample gate is
// met, and says so. When the gate is met it runs the execution study (Part B) and the
// directional study (Part C) exactly as pre-registered, with no code change required.
//
// Analysis functions are exported so tests can drive them with a synthetic series whose
// answer is known — the pipeline is verified before the real sample exists.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { PATHS, COST_PROFILES, FEES, SCHEMA_VERSION } from '../collector/config.mjs';
import { EXEC_SIZES } from '../collector/collector.mjs';
import { coverage, GATE } from './coverage.mjs';
import { olsNW, demeanByGroup, rankIC, meanT, quantiles, bucketOf, effectiveN, normInv, mean, stdev } from './stats.mjs';

// ---------------------------------------------------------------- constants
export const HORIZONS = { '5s': 5, '30s': 30, '5m': 300 };     // seconds; 30s is primary
export const PRIMARY_HORIZON = '30s';
export const WAIT_HORIZONS = [5, 30];                          // Part B; 1s reported descriptively
export const PRIMARY_SIZE = 10000;
export const HAC_LAG = 60;                                     // seconds; covers the 30s overlap
export const PRIOR_EFFECTIVE_N = 121;                          // cumulative through M1
export const MIN_PRACTICAL_SAVING_BP = 0.5;                    // Part B acceptance, pre-registered
export const VOL_SPREAD_MIN = 2.0;                             // p90/p10 of hourly realised vol

// The six pre-registered directional feature families (PART C2).
export const FEATURES = {
  D1_depthImbalance: (r) => r.imbalance.top5,
  D2_micropriceDisplacementBp: (r) => r.micropriceDisplacementBp,
  D3_flowImbalance5s: (r) => r.flow?.['5000ms']?.afi ?? 0,
  D4_depthChange: (r, prev) => (prev ? Math.log(Math.max(1, r.depth.bid.within5bp + r.depth.ask.within5bp) / Math.max(1, prev.depth.bid.within5bp + prev.depth.ask.within5bp)) : 0),
  D5_pressureToCapacity: (r) => r.interaction?.pressureToCapacity ?? 0,
  D6_flowTimesFragility: (r) => r.interaction?.flowTimesFragility ?? 0,
};

// ---------------------------------------------------------------- loading
export function loadFeatureSeries(root = PATHS.events, phase = 'prospective') {
  if (!existsSync(root)) return [];
  const rows = [];
  for (const day of readdirSync(root).sort()) {
    const f = join(root, day, 'features.ndjson.gz');
    if (!existsSync(f)) continue;
    for (const line of gunzipSync(readFileSync(f)).toString('utf8').split('\n')) {
      if (!line) continue;
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (r.phase !== phase) continue;
      if (r.schemaVersion !== SCHEMA_VERSION) continue;    // a version bump never merges
      rows.push(r);
    }
  }
  rows.sort((a, b) => a.at - b.at);
  const out = [];
  for (const r of rows) if (!out.length || r.at > out.at(-1).at) out.push(r);   // drop duplicate seconds
  return out;
}

/** Index by whole second so horizons align exactly and gaps are visible. */
export function grid(rows) {
  const bySec = new Map();
  for (const r of rows) bySec.set(Math.floor(r.at / 1000), r);
  return bySec;
}

// ---------------------------------------------------------------- sample gate
export function volatilityCoverage(rows) {
  const perHour = new Map();
  for (const r of rows) {
    const h = Math.floor(r.at / 3_600_000);
    if (!perHour.has(h)) perHour.set(h, []);
    perHour.get(h).push(r.mid);
  }
  const vols = [];
  for (const mids of perHour.values()) {
    if (mids.length < 60) continue;
    const rets = [];
    for (let i = 1; i < mids.length; i++) rets.push(Math.log(mids[i] / mids[i - 1]));
    vols.push(stdev(rets) * Math.sqrt(3600) * 10000);      // bp per hour
  }
  vols.sort((a, b) => a - b);
  if (vols.length < 24) return { hours: vols.length, p10: NaN, p50: NaN, p90: NaN, spread: NaN, met: false };
  const q = (p) => vols[Math.min(vols.length - 1, Math.floor(p * vols.length))];
  const p10 = q(0.10), p50 = q(0.5), p90 = q(0.90);
  const spread = p10 > 0 ? p90 / p10 : Infinity;
  return { hours: vols.length, p10, p50, p90, spread, met: spread >= VOL_SPREAD_MIN };
}

export function sampleGate(rows) {
  const cov = coverage();
  const vol = volatilityCoverage(rows);
  const met = { ...cov.met, volatilityStates: vol.met };
  return { ...cov, volatility: vol, met, sampleGatePassed: Object.values(met).every(Boolean) };
}

// ---------------------------------------------------------------- Part B
/**
 * Implementation shortfall in bp against the decision-time mid.
 * Immediate: cross now. Wait: cross Δ seconds later, at that book, same size.
 * Commission is included on both, so the comparison is like for like.
 */
export function executionStudy(bySec, { size = PRIMARY_SIZE, stepSec = 30 } = {}) {
  const out = {};
  for (const side of ['BUY', 'SELL']) {
    const sign = side === 'BUY' ? 1 : -1;
    const rowsOut = { immediate: [], waits: Object.fromEntries(WAIT_HORIZONS.map((w) => [w, []])), paired: {} };
    for (const w of WAIT_HORIZONS) rowsOut.paired[w] = [];
    const secs = [...bySec.keys()].sort((a, b) => a - b);
    for (let i = 0; i < secs.length; i += stepSec) {
      const s = secs[i], r = bySec.get(s);
      const now = r?.exec?.[side]?.[size];
      if (!now?.complete) continue;
      const decisionMid = r.mid;
      const isNow = (sign * (now.vwap - decisionMid) / decisionMid) * 10000 + FEES.takerBp;
      rowsOut.immediate.push(isNow);
      for (const w of WAIT_HORIZONS) {
        const later = bySec.get(s + w);
        const l = later?.exec?.[side]?.[size];
        if (!l?.complete) continue;
        const isLater = (sign * (l.vwap - decisionMid) / decisionMid) * 10000 + FEES.takerBp;
        rowsOut.waits[w].push(isLater);
        rowsOut.paired[w].push(isLater - isNow);         // positive => waiting cost more
      }
    }
    const lag = Math.max(1, Math.floor(HAC_LAG / stepSec));
    out[side] = {
      size, n: rowsOut.immediate.length,
      immediate: meanT(rowsOut.immediate, lag),
      wait: Object.fromEntries(WAIT_HORIZONS.map((w) => [w, meanT(rowsOut.waits[w], lag)])),
      waitMinusImmediate: Object.fromEntries(WAIT_HORIZONS.map((w) => {
        const m = meanT(rowsOut.paired[w], lag);
        const p = rowsOut.paired[w];
        const sorted = [...p].sort((a, b) => a - b);
        return [w, { ...m,
          p95AdverseTail: sorted.length ? sorted[Math.floor(0.95 * sorted.length)] : NaN,
          dispersion: stdev(p),
          materiallyBetter: m.mean > MIN_PRACTICAL_SAVING_BP && m.t > 2,   // waiting is worse => act now
          materiallyWorse: m.mean < -MIN_PRACTICAL_SAVING_BP && m.t < -2 }];
      })),
    };
  }
  return out;
}

/** E1–E4: condition the immediate-vs-wait difference on a pre-declared book state. */
export function executionHypotheses(bySec, { size = PRIMARY_SIZE, stepSec = 30, wait = 30 } = {}) {
  const secs = [...bySec.keys()].sort((a, b) => a - b);
  const dev = [];
  for (let i = 0; i < secs.length; i += stepSec) {
    const s = secs[i], r = bySec.get(s), later = bySec.get(s + wait);
    if (!r || !later) continue;
    const now = r.exec?.BUY?.[size], l = later.exec?.BUY?.[size];
    if (!now?.complete || !l?.complete) continue;
    const nearBid = r.depth.bid.within5bp, nearAsk = r.depth.ask.within5bp;
    dev.push({
      s,
      immediateBp: ((now.vwap - r.mid) / r.mid) * 10000 + FEES.takerBp,
      waitMinusImmediate: (((l.vwap - r.mid) / r.mid) * 10000 + FEES.takerBp) - (((now.vwap - r.mid) / r.mid) * 10000 + FEES.takerBp),
      spreadBp: r.spreadBp,
      nearDepth: nearBid + nearAsk,
      sameSidePressure: r.flow?.['5000ms']?.buyQuote ?? 0,
      oppositeDepth: nearAsk,
      replenishment: 0,           // filled below from the depth path
      fragility: r.spreadBp / Math.max(1e-9, (nearBid + nearAsk) / 1e6),
    });
  }
  for (let i = 1; i < dev.length; i++) dev[i].replenishment = dev[i].nearDepth - dev[i - 1].nearDepth;
  if (dev.length < 100) return { insufficient: true, n: dev.length };

  const byState = (pick, label) => {
    const edges = quantiles(dev.map(pick), 3);
    const bins = [[], [], []];
    for (const d of dev) bins[bucketOf(pick(d), edges)].push(d);
    return { label, edges,
      terciles: bins.map((b, k) => ({ tercile: k + 1, n: b.length,
        immediate: meanT(b.map((x) => x.immediateBp), 2),
        waitMinusImmediate: meanT(b.map((x) => x.waitMinusImmediate), 2),
        tailP95: (() => { const a = b.map((x) => x.waitMinusImmediate).sort((p, q) => p - q); return a.length ? a[Math.floor(0.95 * a.length)] : NaN; })(),
        dispersion: stdev(b.map((x) => x.waitMinusImmediate)) })) };
  };
  return {
    n: dev.length,
    E1_spread: byState((d) => d.spreadBp, 'spread (wide spread should cost more immediately)'),
    E1_depth: byState((d) => -d.nearDepth, 'thin near-touch depth (thin should cost more immediately)'),
    E2_pressureVsDepth: byState((d) => d.sameSidePressure / Math.max(1, d.oppositeDepth), 'same-side pressure over opposite depth'),
    E3_replenishment: byState((d) => d.replenishment, 'opposite-side replenishment'),
    E4_fragility: byState((d) => d.fragility, 'book fragility (dispersion and adverse tail of waiting)'),
  };
}

/**
 * B4 — passive-buy toxicity, as a MEASUREMENT.
 * If a passive BUY had rested at the best bid at time t, where is the mid Δ later?
 * This is not a maker return: it says nothing about whether the order would have
 * filled, and no fill is assumed anywhere.
 */
export function passiveToxicity(bySec, { stepSec = 30 } = {}) {
  const secs = [...bySec.keys()].sort((a, b) => a - b);
  const out = { note: 'MEASUREMENT ONLY — no fill is assumed, no queue position is modelled, this is not a maker PnL', buy: {}, sell: {} };
  for (const w of [1, 5, 30]) {
    const buy = [], sell = [];
    for (let i = 0; i < secs.length; i += stepSec) {
      const r = bySec.get(secs[i]), later = bySec.get(secs[i] + w);
      if (!r || !later) continue;
      buy.push(((later.mid - r.bid) / r.bid) * 10000);      // mid drift relative to where a passive bid rested
      sell.push(((r.ask - later.mid) / r.ask) * 10000);
    }
    out.buy[`${w}s`] = meanT(buy, 2);
    out.sell[`${w}s`] = meanT(sell, 2);
  }
  out.queueModel = 'UNRESOLVED — aggregate L2 does not reveal queue position, so actual maker fills cannot be modelled and no maker PnL is computed';
  return out;
}

// ---------------------------------------------------------------- Part C
export function directionalStudy(rows, bySec) {
  const secs = [...bySec.keys()].sort((a, b) => a - b);
  const n = secs.length;
  const third = Math.floor(n / 3);
  const splitOf = (i) => (i < third ? 'dev' : i < 2 * third ? 'val' : 'test');

  // future MID return only; strictly after the feature second (PART C4)
  const target = {};
  for (const [name, h] of Object.entries(HORIZONS)) {
    target[name] = secs.map((s) => {
      const a = bySec.get(s), b = bySec.get(s + h);
      return a && b ? Math.log(b.mid / a.mid) : NaN;
    });
  }
  // contemporaneous control: the return over the 30s BEFORE the feature second
  const past = secs.map((s) => {
    const a = bySec.get(s - 30), b = bySec.get(s);
    return a && b ? Math.log(b.mid / a.mid) : NaN;
  });

  const featVals = {};
  for (const [name, fn] of Object.entries(FEATURES)) {
    featVals[name] = secs.map((s, i) => { const r = bySec.get(s); return fn(r, i ? bySec.get(secs[i - 1]) : null); });
  }
  const spread = secs.map((s) => bySec.get(s).spreadBp);
  const lnDepth = secs.map((s) => { const r = bySec.get(s); return Math.log(Math.max(1, r.depth.bid.within5bp + r.depth.ask.within5bp)); });
  const hourFE = secs.map((s) => new Date(s * 1000).getUTCHours());

  const fit = (fname, hname, keep) => {
    const idx = [];
    for (let i = 0; i < n; i++) {
      if (!keep(i)) continue;
      if (![target[hname][i], past[i], featVals[fname][i], spread[i], lnDepth[i]].every(Number.isFinite)) continue;
      idx.push(i);
    }
    if (idx.length < 500) return null;
    const g = idx.map((i) => hourFE[i]);
    const y = demeanByGroup(Float64Array.from(idx, (i) => target[hname][i]), g, 24);
    const names = [fname, 'pastReturn', 'spreadBp', 'lnDepth'];
    let cols = [featVals[fname], past, spread, lnDepth].map((c) => demeanByGroup(Float64Array.from(idx, (i) => c[i]), g, 24));
    // A control that does not vary in this sample contributes a zero column and makes
    // the normal equations singular, which yields confident nonsense rather than an
    // error. Such columns are dropped and the drop is reported.
    const scale = (c) => { let m = 0; for (const v of c) m = Math.max(m, Math.abs(v)); return m; };
    const keptNames = [], dropped = [];
    const kept = [];
    for (let j = 0; j < cols.length; j++) {
      if (stdev(Array.from(cols[j])) > 1e-12 * Math.max(1, scale(cols[j]))) { kept.push(cols[j]); keptNames.push(names[j]); }
      else dropped.push(names[j]);
    }
    if (!keptNames.includes(fname)) return null;      // the tested feature itself is constant
    cols = kept;
    const X = idx.map((_, r) => cols.map((c) => c[r]));
    const res = olsNW(Array.from(y), X, HAC_LAG);
    return { n: res.n, beta: res.beta[1], se: res.se[1], t: res.t[1], r2: res.r2, droppedControls: dropped,
      ci: [res.beta[1] - 1.96 * res.se[1], res.beta[1] + 1.96 * res.se[1]],
      rankIC: rankIC(idx.map((i) => featVals[fname][i]), idx.map((i) => target[hname][i])) };
  };

  const results = {}, trials = [];
  for (const fname of Object.keys(FEATURES)) {
    results[fname] = {};
    for (const hname of Object.keys(HORIZONS)) {
      const per = {};
      for (const sp of ['dev', 'val', 'test']) per[sp] = fit(fname, hname, (i) => splitOf(i) === sp);
      per.valtest = fit(fname, hname, (i) => splitOf(i) !== 'dev');
      results[fname][hname] = per;
      for (const sp of ['dev', 'val', 'test']) {
        trials.push({ study: 'M2', feature: fname, horizon: hname, split: sp,
          primary: hname === PRIMARY_HORIZON, n: per[sp]?.n ?? 0, beta: per[sp]?.beta ?? null, t: per[sp]?.t ?? null });
      }
    }
    // deciles of the feature against the primary horizon, breakpoints from dev only
    const devIdx = [];
    for (let i = 0; i < n; i++) if (splitOf(i) === 'dev' && Number.isFinite(featVals[fname][i])) devIdx.push(i);
    const edges = quantiles(devIdx.map((i) => featVals[fname][i]), 10);
    const bins = Array.from({ length: 10 }, () => []);
    for (let i = 0; i < n; i++) {
      if (splitOf(i) === 'dev') continue;
      const y = target[PRIMARY_HORIZON][i];
      if (!Number.isFinite(y) || !Number.isFinite(featVals[fname][i])) continue;
      bins[bucketOf(featVals[fname][i], edges)].push(y);
    }
    const drows = bins.map((b, k) => ({ decile: k + 1, n: b.length, ...meanT(b, HAC_LAG) }));
    results[fname].deciles = { rows: drows, mono: rankIC(drows.map((r) => r.decile), drows.map((r) => r.mean)),
      topMinusBottomBp: (drows[9].mean - drows[0].mean) * 10000 };
  }
  return { results, trials, splitSizes: { dev: third, val: third, test: n - 2 * third } };
}

/** Multiple-testing correction on effective trials, same method as every prior study. */
export function effectiveTrials(rows, bySec) {
  const secs = [...bySec.keys()].sort((a, b) => a - b);
  const series = [];
  for (const fname of Object.keys(FEATURES)) {
    for (const [hname, h] of Object.entries(HORIZONS)) {
      const daily = new Map();
      for (let i = 0; i < secs.length; i++) {
        const s = secs[i], a = bySec.get(s), b = bySec.get(s + h);
        if (!a || !b) continue;
        const x = FEATURES[fname](a, i ? bySec.get(secs[i - 1]) : null);
        const y = Math.log(b.mid / a.mid);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const d = Math.floor(s / 86400);
        daily.set(d, (daily.get(d) || 0) + x * y);
      }
      series.push(daily);
    }
  }
  const days = [...new Set(series.flatMap((m) => [...m.keys()]))].sort((a, b) => a - b);
  if (days.length < 3) return { raw: series.length * 3, configs: series.length, effective: series.length, note: 'too few days to estimate correlation; the raw configuration count is used, which is the conservative choice' };
  const eff = effectiveN(series.map((m) => days.map((d) => m.get(d) || 0)), 0.5);
  return eff;
}

/** Economic gate: gross edge in bp against each cost profile (PART C5/C6). */
export function economicGate(directional, deciles) {
  const out = {};
  for (const [fname, byH] of Object.entries(directional.results)) {
    const d = byH.deciles;
    const grossBp = Math.abs(d.topMinusBottomBp) / 2;    // one side of a long/short spread
    out[fname] = { grossEdgeBp: grossBp, profiles: {} };
    for (const p of Object.values(COST_PROFILES)) {
      out[fname].profiles[p.id] = { name: p.name, roundTripBp: p.roundTripBp, usableForAcceptance: p.usableForAcceptance,
        costOverEdge: grossBp > 0 ? p.roundTripBp / grossBp : Infinity,
        tradable: p.usableForAcceptance && grossBp > p.roundTripBp };
    }
    out[fname].economicallyTradable = ['A', 'B'].every((k) => out[fname].profiles[k].tradable);
  }
  return out;
}

// ---------------------------------------------------------------- runner
export function run({ rows = null, out = true } = {}) {
  const series = rows ?? loadFeatureSeries();
  const bySec = grid(series);
  const gate = sampleGate(series);
  const generated = new Date().toISOString();

  if (!gate.sampleGatePassed) {
    const result = { generated, status: 'COLLECTING — INSUFFICIENT', schemaVersion: SCHEMA_VERSION,
      reason: 'the pre-registered minimum prospective sample has not been reached; no statistical outcome analysis was run',
      directionalGatePassed: false, economicGatePassed: false, coverage: gate,
      records: series.length };
    if (out) { writeStatus(result); }
    return result;
  }

  const execution = { primary: executionStudy(bySec, { size: PRIMARY_SIZE }),
    secondary: executionStudy(bySec, { size: EXEC_SIZES[1] }),
    hypotheses: executionHypotheses(bySec), toxicity: passiveToxicity(bySec) };
  const directional = directionalStudy(series, bySec);
  const eff = effectiveTrials(series, bySec);
  const cumulative = PRIOR_EFFECTIVE_N + (eff.effective ?? eff.configs);
  const tThreshold = normInv(1 - 0.05 / (2 * cumulative));
  const econ = economicGate(directional);

  // Directional gates, all of which must hold on the primary horizon.
  const gates = {};
  for (const fname of Object.keys(FEATURES)) {
    const p = directional.results[fname][PRIMARY_HORIZON];
    const d = directional.results[fname].deciles;
    if (!p.dev || !p.val || !p.test || !p.valtest) { gates[fname] = { pass: false, failed: ['insufficient observations'] }; continue; }
    const sign = Math.sign(p.valtest.beta) || 1;
    const g = {
      G1_signStable: Math.sign(p.dev.beta) === sign && Math.sign(p.val.beta) === sign && Math.sign(p.test.beta) === sign,
      G2_significant: Math.abs(p.val.t) >= 2 && Math.abs(p.test.t) >= 2,
      G3_multipleTesting: Math.abs(p.valtest.t) > tThreshold,
      G4_monotone: Math.abs(d.mono) >= 0.7 && Math.sign(d.mono) === sign,
      G5_economic: econ[fname].economicallyTradable,
    };
    g.failed = Object.entries(g).filter(([k, v]) => k.startsWith('G') && !v).map(([k]) => k);
    g.pass = g.failed.length === 0;
    gates[fname] = g;
  }
  const directionalPass = Object.values(gates).some((g) => g.pass);

  const result = { generated, schemaVersion: SCHEMA_VERSION,
    status: directionalPass ? 'DIRECTIONAL MODEL VALIDATED' : 'REJECT — NOT TRADABLE',
    directionalGatePassed: directionalPass,
    economicGatePassed: directionalPass && Object.entries(gates).some(([f, g]) => g.pass && econ[f].economicallyTradable),
    coverage: gate, execution, directional, gates, economics: econ,
    effectiveTrials: eff, cumulativeEffectiveN: cumulative, multipleTestingT: tThreshold,
    records: series.length };
  if (out) writeResults(result);
  return result;
}

// ---------------------------------------------------------------- reports
const p2 = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');

function writeStatus(r) {
  const c = r.coverage;
  const L = [];
  L.push('# M2 status — COLLECTING', '');
  L.push(`Generated ${r.generated}. Schema \`${r.schemaVersion}\`.`, '');
  L.push('**No statistical outcome analysis has been run.** The pre-registered minimum');
  L.push('prospective sample (PART C1) has not been reached, and the runner refuses to');
  L.push('produce a directional verdict before it is. This is the designed behaviour, not');
  L.push('a failure: a few days of order-book data can produce a significant-looking');
  L.push('coefficient of either sign, which is exactly the failure mode the gate exists to');
  L.push('prevent.', '');
  L.push('## Prospective coverage', '');
  L.push('| requirement | have | need | met |', '|---|---|---|---|');
  const rowsOut = [
    ['calendar days', c.days, GATE.minCalendarDays, c.met.calendarDays],
    ['weekday days', c.weekdayDays, GATE.minWeekdayDays, c.met.weekdayDays],
    ['weekend days', c.weekendDays, GATE.minWeekendDays, c.met.weekendDays],
    ['valid-book hours', p2(c.validHours, 1), GATE.minValidBookHours, c.met.validBookHours],
    ['volatility spread (p90/p10 of hourly realised vol)', p2(c.volatility?.spread), VOL_SPREAD_MIN, c.met.volatilityStates],
  ];
  for (const [k, have, need, ok] of rowsOut) L.push(`| ${k} | ${have} | ${need} | ${ok ? 'yes' : 'no'} |`);
  L.push('');
  L.push(`Prospective sample started: **${c.prospectiveStart || 'not yet — the collector has not seen a valid book since the M2 freeze'}**.`);
  L.push(`Feature records loaded: ${r.records.toLocaleString()}. Disk used: ${(c.diskBytes / 1048576).toFixed(1)} MB.`, '');
  L.push('## What runs when the gate is met', '');
  L.push('Nothing needs to be rewritten. `npm run research:m2` will then execute Part B');
  L.push('(execution study: immediate versus waiting 5 s and 30 s, both order sides, both');
  L.push('sizes, the four pre-registered execution hypotheses, and passive-buy toxicity as');
  L.push('a measurement) and Part C (six directional feature families across three');
  L.push('horizons with chronological splits, decile monotonicity, the effective-trial');
  L.push('correction and the three cost profiles), and write `RESULTS-M2.md`.', '');
  writeFileSync(new URL('./STATUS-M2.md', import.meta.url).pathname, L.join('\n'));
  writeFileSync(new URL('./results-m2.json', import.meta.url).pathname, JSON.stringify(r, null, 2));
}

function writeResults(r) {
  const L = [];
  L.push('# M2 results', '');
  L.push(`Generated ${r.generated}. Pre-registered in [\`PRE-REGISTRATION-M2.md\`](./PRE-REGISTRATION-M2.md).`, '');
  L.push(`## Verdict: **${r.status}**`, '');
  L.push(`Prospective sample: ${r.coverage.days} calendar days, ${p2(r.coverage.validHours, 1)} valid-book hours, ${r.records.toLocaleString()} feature records, from ${r.coverage.prospectiveStart}.`, '');
  L.push('## Part B — execution study', '');
  for (const side of ['BUY', 'SELL']) {
    const e = r.execution.primary[side];
    L.push(`### ${side}, $${PRIMARY_SIZE.toLocaleString()}`, '');
    L.push(`Immediate implementation shortfall: **${p2(e.immediate.mean)} bp** (t ${p2(e.immediate.t)}, n ${e.n.toLocaleString()}).`, '');
    L.push('| wait | shortfall | wait − immediate | HAC t | p95 adverse | dispersion | materially better to act now |', '|---|---|---|---|---|---|---|');
    for (const w of WAIT_HORIZONS) {
      const d = e.waitMinusImmediate[w];
      L.push(`| ${w}s | ${p2(e.wait[w].mean)} bp | ${p2(d.mean)} bp | ${p2(d.t)} | ${p2(d.p95AdverseTail)} bp | ${p2(d.dispersion)} bp | ${d.materiallyBetter ? 'yes' : 'no'} |`);
    }
    L.push('');
  }
  L.push(`Acceptance threshold: a saving must exceed **${MIN_PRACTICAL_SAVING_BP} bp** with |t| > 2 to count as material.`, '');
  L.push('### Passive-buy toxicity (measurement, not maker PnL)', '');
  L.push('| horizon | buy-side mid drift | t | sell-side mid drift | t |', '|---|---|---|---|---|');
  for (const w of ['1s', '5s', '30s']) {
    const b = r.execution.toxicity.buy[w], s = r.execution.toxicity.sell[w];
    L.push(`| ${w} | ${p2(b.mean)} bp | ${p2(b.t)} | ${p2(s.mean)} bp | ${p2(s.t)} |`);
  }
  L.push('', `Queue model: **${r.execution.toxicity.queueModel}**`, '');
  L.push('## Part C — directional study', '');
  L.push(`| feature | β (val ∪ test) | HAC t | rank IC | decile monotonicity | top − bottom | gates failed |`, '|---|---|---|---|---|---|---|');
  for (const f of Object.keys(FEATURES)) {
    const p = r.directional.results[f][PRIMARY_HORIZON].valtest, d = r.directional.results[f].deciles, g = r.gates[f];
    L.push(`| ${f} | ${p ? p.beta.toExponential(2) : 'n/a'} | ${p2(p?.t)} | ${p2(p?.rankIC, 4)} | ${p2(d.mono)} | ${p2(d.topMinusBottomBp)} bp | ${g.failed?.join(' ') || 'none'} |`);
  }
  L.push('');
  L.push(`Effective independent trials: ${p2(r.effectiveTrials.effective, 1)} for M2, cumulative **${p2(r.cumulativeEffectiveN, 1)}**, so gate G3 requires |t| > **${p2(r.multipleTestingT)}**.`, '');
  L.push('## Economics', '', '| feature | gross edge | profile A cost/edge | profile B | profile C | tradable |', '|---|---|---|---|---|---|');
  for (const [f, e] of Object.entries(r.economics)) {
    L.push(`| ${f} | ${p2(e.grossEdgeBp)} bp | ${p2(e.profiles.A.costOverEdge, 1)}× | ${p2(e.profiles.B.costOverEdge, 1)}× | ${p2(e.profiles.C.costOverEdge, 1)}× | ${e.economicallyTradable ? 'yes' : 'no'} |`);
  }
  L.push('', 'The maker profile is recorded in `results-m2.json` and may not be used to pass any gate: a resting order is not a fill, and no queue model exists.', '');
  writeFileSync(new URL('./RESULTS-M2.md', import.meta.url).pathname, L.join('\n'));
  writeFileSync(new URL('./results-m2.json', import.meta.url).pathname, JSON.stringify(r, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = run();
  console.log(r.status, '—', r.reason ?? `${r.records} records`);
}
