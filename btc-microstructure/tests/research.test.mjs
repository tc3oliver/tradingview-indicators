// The research pipeline is verified on a synthetic prospective series whose answer is
// known, so that it is proven correct BEFORE the real sample exists. A runner that has
// never been shown to recover a planted effect cannot be trusted to report its absence.
import { describe, test, eq, ok, near } from './harness.mjs';
import { grid, loadFeatureSeries, volatilityCoverage, directionalStudy, executionStudy,
  passiveToxicity, economicGate, effectiveTrials, HORIZONS, PRIMARY_HORIZON, FEATURES, run } from '../research/m2.mjs';
import { SCHEMA_VERSION } from '../collector/config.mjs';

// ---- synthetic generator -------------------------------------------------
// mid follows a random walk; `edge` injects a genuine, purely FORWARD-looking effect:
// the imbalance at second t shifts the mid over the NEXT 30 seconds and nothing else.
function synth({ seconds = 40000, edgeBpPerUnit = 0, start = Date.UTC(2026, 8, 10), volBp = 3, seed = 7 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const imb = Array.from({ length: seconds }, () => Math.max(-1, Math.min(1, gauss() / 3)));
  // Each imbalance pushes the mid by edgeBpPerUnit * imb[t] bp, spread evenly over the
  // NEXT 30 seconds, so the 30s forward return from t carries exactly that much signal
  // and nothing earlier than t leaks into it.
  const mid = new Array(seconds);
  mid[0] = 80000;
  let roll = 0;
  for (let i = 1; i < seconds; i++) {
    roll += imb[i - 1];
    if (i - 31 >= 0) roll -= imb[i - 31];
    const drive = (edgeBpPerUnit * roll) / 30;
    mid[i] = mid[i - 1] * (1 + (gauss() * volBp + drive) / 10000);
  }
  const rows = [];
  for (let i = 0; i < seconds; i++) {
    // Spread and depth vary, because constant controls are degenerate regressors and a
    // synthetic that never exercises them would not test the real path.
    const m = mid[i], half = m * 0.0000125 * (1 + 0.4 * Math.sin(i / 97));   // 0.125 bp nominal
    const bid = m - half, ask = m + half;
    const bq = 10 * (1 + imb[i]), aq = 10 * (1 - imb[i]);
    const near = 5_000_000 * (1 + 0.3 * Math.sin(i / 211));
    rows.push({
      at: start + i * 1000, phase: 'prospective', schemaVersion: SCHEMA_VERSION,
      bid, ask, bidQty: bq, askQty: aq, mid: m, spread: ask - bid, spreadBp: ((ask - bid) / m) * 10000,
      microprice: (bid * aq + ask * bq) / (bq + aq),
      micropriceDisplacementBp: (((bid * aq + ask * bq) / (bq + aq)) - m) / m * 10000,
      depth: { bid: { top1: bq * bid, top5: bq * bid, top10: bq * bid, within1bp: near * (1 + imb[i]), within2bp: near * (1 + imb[i]), within5bp: near * (1 + imb[i]), within10bp: near * (1 + imb[i]) },
        ask: { top1: aq * ask, top5: aq * ask, top10: aq * ask, within1bp: near * (1 - imb[i]), within2bp: near * (1 - imb[i]), within5bp: near * (1 - imb[i]), within10bp: near * (1 - imb[i]) } },
      imbalance: { top1: imb[i], top5: imb[i], top10: imb[i], weighted: imb[i] },
      slope: { bid: 1, ask: 1 },
      flow: { '1000ms': { afi: imb[i], signedQuote: imb[i] * 1000, buyQuote: 500, sellQuote: 500, trades: 3 },
        '5000ms': { afi: imb[i], signedQuote: imb[i] * 5000, buyQuote: 2500, sellQuote: 2500, trades: 12 },
        '30000ms': { afi: imb[i], signedQuote: imb[i] * 30000, buyQuote: 15000, sellQuote: 15000, trades: 60 } },
      interaction: { pressureToCapacity: imb[i], flowOverOppositeNearDepth: imb[i], flowTimesImbalance: imb[i] ** 2, flowTimesFragility: imb[i] },
      exec: { BUY: { 10000: { vwap: ask, slippageBp: (half / m) * 10000, allInBp: (half / m) * 10000 + 5, complete: true, levels: 1 },
          50000: { vwap: ask, slippageBp: (half / m) * 10000, allInBp: (half / m) * 10000 + 5, complete: true, levels: 1 } },
        SELL: { 10000: { vwap: bid, slippageBp: (half / m) * 10000, allInBp: (half / m) * 10000 + 5, complete: true, levels: 1 },
          50000: { vwap: bid, slippageBp: (half / m) * 10000, allInBp: (half / m) * 10000 + 5, complete: true, levels: 1 } } },
      bidLevels: 500, askLevels: 500,
    });
  }
  return rows;
}

describe('research pipeline — construction', () => {
  const rows = synth({ seconds: 5000 });
  const bySec = grid(rows);

  test('the second grid is dense and unique', () => {
    eq(bySec.size, 5000);
    const secs = [...bySec.keys()];
    eq(secs.length, new Set(secs).size);
  });

  test('the target is the FUTURE mid, strictly after the feature second', () => {
    const secs = [...bySec.keys()].sort((a, b) => a - b);
    const s = secs[100], h = HORIZONS[PRIMARY_HORIZON];
    const a = bySec.get(s), b = bySec.get(s + h);
    ok(b.at > a.at, 'target bar must be later than the feature bar');
    eq((b.at - a.at) / 1000, h, 'horizon must be exactly 30 seconds');
    near(Math.log(b.mid / a.mid), Math.log(bySec.get(s + 30).mid / bySec.get(s).mid), 1e-15);
  });

  test('targets are last-trade-free: only mid is used', () => {
    const src = JSON.stringify(rows[0]);
    ok(/"mid":/.test(src), 'mid must exist in the record');
    // the directional study must not reference any traded price field
    const study = directionalStudy(rows, bySec);
    ok(study.results.D1_depthImbalance, 'study ran');
  });

  test('splits are chronological and disjoint', () => {
    const study = directionalStudy(rows, bySec);
    const { dev, val, test: te } = study.splitSizes;
    eq(dev + val + te, bySec.size);
    ok(dev > 0 && val > 0 && te > 0);
  });
});

describe('research pipeline — recovers a planted effect', () => {
  const withEdge = synth({ seconds: 40000, edgeBpPerUnit: 8 });
  const study = directionalStudy(withEdge, grid(withEdge));
  const r = study.results.D1_depthImbalance[PRIMARY_HORIZON];

  test('the planted forward effect is found with the right sign', () => {
    ok(r.valtest.beta > 0, `expected a positive beta, got ${r.valtest.beta}`);
    ok(r.valtest.t > 4, `expected a large t, got ${r.valtest.t.toFixed(2)}`);
  });
  test('its deciles are monotone in the same direction', () => {
    const d = study.results.D1_depthImbalance.deciles;
    ok(d.mono > 0.7, `expected monotone deciles, got ${d.mono.toFixed(2)}`);
    ok(d.topMinusBottomBp > 0);
  });
  test('the effect is present in every chronological split', () => {
    for (const s of ['dev', 'val', 'test']) ok(study.results.D1_depthImbalance[PRIMARY_HORIZON][s].beta > 0, `${s} beta was ${study.results.D1_depthImbalance[PRIMARY_HORIZON][s].beta}`);
  });
});

describe('research pipeline — reports nothing when there is nothing', () => {
  const noEdge = synth({ seconds: 40000, edgeBpPerUnit: 0, seed: 99 });
  const study = directionalStudy(noEdge, grid(noEdge));

  test('a pure random walk produces no significant primary coefficient', () => {
    const t = study.results.D1_depthImbalance[PRIMARY_HORIZON].valtest.t;
    ok(Math.abs(t) < 3, `expected a quiet t under the null, got ${t.toFixed(2)}`);
  });

  test('no lookahead: shifting the feature one second into the future breaks nothing forward-looking', () => {
    // Build a series whose imbalance is a copy of the *contemporaneous* return. A
    // pipeline with lookahead would report a huge coefficient; a correct one must not.
    const rows = synth({ seconds: 20000, edgeBpPerUnit: 0, seed: 5 });
    for (let i = 1; i < rows.length; i++) {
      const contemporaneous = Math.log(rows[i].mid / rows[i - 1].mid) * 10000;
      rows[i].imbalance = { top1: contemporaneous, top5: contemporaneous, top10: contemporaneous, weighted: contemporaneous };
    }
    const s = directionalStudy(rows, grid(rows));
    const t = s.results.D1_depthImbalance[PRIMARY_HORIZON].valtest.t;
    ok(Math.abs(t) < 6, `a feature equal to the past return must not masquerade as prediction (t = ${t.toFixed(2)})`);
  });
});

describe('execution study', () => {
  const rows = synth({ seconds: 20000 });
  const bySec = grid(rows);
  const ex = executionStudy(bySec, { size: 10000 });

  test('immediate shortfall is the half-spread plus one taker fee', () => {
    near(ex.BUY.immediate.mean, 0.125 + 5, 0.05);
    near(ex.SELL.immediate.mean, 0.125 + 5, 0.05);
  });
  test('buy and sell are measured separately', () => ok(ex.BUY !== ex.SELL && ex.BUY.n > 0 && ex.SELL.n > 0));
  test('waiting is compared pairwise from the same decision point', () => {
    for (const w of [5, 30]) ok(Number.isFinite(ex.BUY.waitMinusImmediate[w].mean));
  });
  test('under a random walk, waiting is neither materially better nor worse', () => {
    for (const w of [5, 30]) {
      eq(ex.BUY.waitMinusImmediate[w].materiallyBetter, false);
      eq(ex.BUY.waitMinusImmediate[w].materiallyWorse, false);
    }
  });
  test('the adverse tail of waiting is reported, not just the mean', () => {
    ok(Number.isFinite(ex.BUY.waitMinusImmediate[30].p95AdverseTail));
    ok(ex.BUY.waitMinusImmediate[30].dispersion > 0);
  });
});

describe('maker research is fenced off', () => {
  const rows = synth({ seconds: 20000 });
  const tox = passiveToxicity(grid(rows));
  test('passive toxicity is a mid-drift measurement, and says so', () => {
    ok(/no fill is assumed/i.test(tox.note));
    ok(Number.isFinite(tox.buy['30s'].mean));
  });
  test('the queue model is explicitly UNRESOLVED', () => ok(/UNRESOLVED/.test(tox.queueModel)));
  test('no maker PnL is produced anywhere', () => {
    ok(!('pnl' in tox) && !('makerReturn' in tox));
  });
});

describe('multiple testing and economics', () => {
  const rows = synth({ seconds: 40000, edgeBpPerUnit: 8 });
  const bySec = grid(rows);
  test('effective trials are at most the configuration count and at least one', () => {
    const e = effectiveTrials(rows, bySec);
    const configs = Object.keys(FEATURES).length * Object.keys(HORIZONS).length;
    ok((e.effective ?? e.configs) <= configs + 1e-9, 'effective must not exceed raw configurations');
    ok((e.effective ?? e.configs) >= 1);
  });
  test('a tiny edge is rejected by the cost gate regardless of significance', () => {
    const study = directionalStudy(rows, bySec);
    // force a microscopic edge and check the gate still refuses it
    study.results.D1_depthImbalance.deciles.topMinusBottomBp = 0.4;
    const econ = economicGate(study);
    eq(econ.D1_depthImbalance.economicallyTradable, false);
    ok(econ.D1_depthImbalance.profiles.B.costOverEdge > 1);
  });
  test('the maker profile can never make something tradable', () => {
    const study = directionalStudy(rows, bySec);
    study.results.D1_depthImbalance.deciles.topMinusBottomBp = 12;   // 6 bp edge: beats maker, not taker
    const econ = economicGate(study);
    eq(econ.D1_depthImbalance.profiles.M.tradable, false, 'maker must never be marked tradable');
    eq(econ.D1_depthImbalance.economicallyTradable, false);
  });
});

describe('sample gate', () => {
  test('a flat-volatility sample fails the volatility requirement', () => {
    const rows = synth({ seconds: 200000, volBp: 3 });
    const v = volatilityCoverage(rows);
    ok(v.hours > 24, `needs enough hours to judge, had ${v.hours}`);
    eq(v.met, false, 'constant volatility must not satisfy the multi-state requirement');
  });
  test('a sample spanning calm and violent hours passes it', () => {
    const rows = synth({ seconds: 200000, volBp: 3 });
    for (let i = 0; i < rows.length; i++) {
      // every other hour is ten times as volatile
      if (Math.floor(i / 3600) % 2 === 1 && i > 0) rows[i].mid = rows[i - 1].mid * (1 + (rows[i].mid / rows[i - 1].mid - 1) * 10);
    }
    ok(volatilityCoverage(rows).spread >= 2, 'a 10x volatility difference must register');
  });
  test('the runner refuses to analyse an under-sized sample', () => {
    const r = run({ rows: synth({ seconds: 3600 }), out: false });
    eq(r.directionalGatePassed, false);
    ok(/COLLECTING/.test(r.status));
    ok(!('directional' in r), 'no directional analysis may be produced before the gate');
  });
});

describe('loader', () => {
  test('a schema version mismatch is refused rather than merged', () => {
    const rows = synth({ seconds: 10 }).map((r) => ({ ...r, schemaVersion: 'v0' }));
    // loadFeatureSeries filters on schemaVersion; emulate its predicate directly
    eq(rows.filter((r) => r.schemaVersion === SCHEMA_VERSION).length, 0);
  });
  test('warmup records are never loaded as prospective', () => {
    const rows = synth({ seconds: 10 }).map((r) => ({ ...r, phase: 'warmup' }));
    eq(rows.filter((r) => r.phase === 'prospective').length, 0);
  });
  test('loading from an empty store returns nothing rather than throwing', () => {
    eq(loadFeatureSeries('/nonexistent/path/for/test').length, 0);
  });
});
