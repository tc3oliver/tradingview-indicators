# M2-H results — historical L2 retrospective validation

Generated 2026-09-06T10:00:52.310Z. Pre-registered in [`PRE-REGISTRATION-M2H.md`](./PRE-REGISTRATION-M2H.md).

## Verdict: **PRELIMINARY — BLOCKED BY HISTORICAL DATA ACCESS**

> **These numbers cannot produce a PASS.** only 8 of 2301 days in the acceptance window are present (0.3%); free-tier access serves the first day of each month only
> The pre-registration forbids treating free-tier sample days as the acceptance dataset.
> Everything below is the study running end to end on the days available, which is what
> makes the engineering verifiable — not a verdict on the acceptance window.

## Coverage

| | |
|---|---|
| acceptance window | 2020-05-14 → 2026-08-31 (2301 days) |
| days in the store | 8 (0.3% of the window) |
| by split | dev 8 · val 0 · test 0 |
| 1-second feature rows | 691,185 |
| mean valid-book coverage per day | 100.00% |
| archives read / feature store | 2.0 GB / 186 MB |
| reconciliation against the sequence-verified feed | **PASS** over 465 pooled seconds |

## Information — coefficient on the future mid return

Primary horizon **30s**. Non-overlapping observations (step = horizon), hour-of-day fixed effects, controls for the previous 30 s return, spread and log near-touch depth, Newey–West at 60 s.

| feature | dev β (t) | val β (t) | test β (t) | val∪test β (t) | rank IC | decile mono | top−bottom |
|---|---|---|---|---|---|---|---|
| D1_depthImbalance | 5.99e-5 (8.25) | n/a | n/a | n/a | n/a | n/a | n/a |
| D2_micropriceDisplacementBp | 3.18e-4 (2.06) | n/a | n/a | n/a | n/a | n/a | n/a |
| D3_orderFlowImbalance5s | 1.31e-5 (1.66) | n/a | n/a | n/a | n/a | n/a | n/a |
| D4_depthChange | 2.02e-4 (1.86) | n/a | n/a | n/a | n/a | n/a | n/a |
| D5_pressureToCapacity | -7.88e-9 (-3.20) | n/a | n/a | n/a | n/a | n/a | n/a |
| D6_flowTimesFragility | 4.77e-6 (0.65) | n/a | n/a | n/a | n/a | n/a | n/a |

### Robustness horizons (val ∪ test)

| feature | 5s β (t) | 30s β (t) | 5m β (t) |
|---|---|---|---|
| D1_depthImbalance | n/a | n/a | n/a |
| D2_micropriceDisplacementBp | n/a | n/a | n/a |
| D3_orderFlowImbalance5s | n/a | n/a | n/a |
| D4_depthChange | n/a | n/a | n/a |
| D5_pressureToCapacity | n/a | n/a | n/a |
| D6_flowTimesFragility | n/a | n/a | n/a |

## Gates

Multiple-testing threshold |t| > **3.54** at 127.0 cumulative effective trials.

| feature | G1 sign stable | G2 \|t\|≥2 val & test | G3 multiple testing | G4 monotonicity | G5 economic | verdict |
|---|---|---|---|---|---|---|
| D1_depthImbalance | FAIL | FAIL | FAIL | FAIL | FAIL | REJECTED |
| D2_micropriceDisplacementBp | FAIL | FAIL | FAIL | FAIL | FAIL | REJECTED |
| D3_orderFlowImbalance5s | FAIL | FAIL | FAIL | FAIL | FAIL | REJECTED |
| D4_depthChange | FAIL | FAIL | FAIL | FAIL | FAIL | REJECTED |
| D5_pressureToCapacity | FAIL | FAIL | FAIL | FAIL | FAIL | REJECTED |
| D6_flowTimesFragility | FAIL | FAIL | FAIL | FAIL | FAIL | REJECTED |

## Economics — information is not tradability

Measured half-spread plus book impact for a $10,000 order, from the reconstructed book: **0.005 bp** per side. Gross edge basis: development only (later splits not yet in the store).

| feature | gross edge | A: commission + measured book cost | B: 14 bp | C: 20 bp | tradable |
|---|---|---|---|---|---|
| D1_depthImbalance | 0.533 bp | -9.478 bp net (18.8× cost/edge) | -13.467 bp net (26.3× cost/edge) | -19.467 bp net (37.6× cost/edge) | **no** |
| D2_micropriceDisplacementBp | 0.613 bp | -9.397 bp net (16.3× cost/edge) | -13.387 bp net (22.8× cost/edge) | -19.387 bp net (32.6× cost/edge) | **no** |
| D3_orderFlowImbalance5s | 0.162 bp | -9.849 bp net (61.7× cost/edge) | -13.838 bp net (86.3× cost/edge) | -19.838 bp net (123.3× cost/edge) | **no** |
| D4_depthChange | 0.146 bp | -9.865 bp net (68.6× cost/edge) | -13.854 bp net (95.9× cost/edge) | -19.854 bp net (137.0× cost/edge) | **no** |
| D5_pressureToCapacity | 0.490 bp | -9.521 bp net (20.4× cost/edge) | -13.510 bp net (28.6× cost/edge) | -19.510 bp net (40.9× cost/edge) | **no** |
| D6_flowTimesFragility | 0.041 bp | -9.970 bp net (244.1× cost/edge) | -13.959 bp net (341.4× cost/edge) | -19.959 bp net (487.7× cost/edge) | **no** |

## Walk-the-book backtest

Signal at second *t*, entry at the next executable second, exit 30 s later, both priced by walking the reconstructed book. No stop, no target, no overlapping positions. Commission 5 bp per side. Sample: all stored days (later splits not yet in the store).

| candidate | trades | gross/trade | net/trade | win | PF | Sharpe | max DD | net ex-best-5% | long | short |
|---|---|---|---|---|---|---|---|---|---|---|
| D1_depthImbalance | 16,828 | -0.238 bp | -10.238 bp | 3.5% | 0.03 | -1312.92 | 172293 bp | -11.050 bp | -10.203 bp | -10.272 bp |
| D2_micropriceDisplacementBp | 15,189 | -0.599 bp | -10.599 bp | 3.9% | 0.03 | -1173.68 | 160984 bp | -11.444 bp | -10.491 bp | -10.705 bp |
| D3_orderFlowImbalance5s | 14,807 | -0.303 bp | -10.303 bp | 2.2% | 0.01 | -1782.14 | 152558 bp | -10.913 bp | -10.236 bp | -10.368 bp |
| D4_depthChange | 16,511 | -0.471 bp | -10.471 bp | 4.0% | 0.03 | -1245.70 | 172890 bp | -11.330 bp | -10.395 bp | -10.535 bp |
| D5_pressureToCapacity | 12,397 | -0.300 bp | -10.300 bp | 5.4% | 0.04 | -961.22 | 127684 bp | -11.318 bp | -10.181 bp | -10.416 bp |
| D6_flowTimesFragility | 15,766 | -0.458 bp | -10.458 bp | 4.1% | 0.03 | -1196.52 | 164884 bp | -11.344 bp | -10.377 bp | -10.541 bp |

### Baselines

| baseline | trades | net/trade | PF |
|---|---|---|---|
| randomEntries | 19,270 | -10.389 bp | 0.02 |
| m1AfiReversal | 14,807 | -10.344 bp | 0.01 |

Sign-shuffled controls: D1_depthImbalance -10.393 bp · D2_micropriceDisplacementBp -10.476 bp · D3_orderFlowImbalance5s -10.377 bp · D4_depthChange -10.378 bp · D5_pressureToCapacity -10.399 bp · D6_flowTimesFragility -10.526 bp

## Execution study (Part B)

Given a decision to trade, immediate execution versus waiting. Implementation shortfall against the decision-time mid, commission included. Acceptance threshold: **0.5 bp** with |t| > 2.

| side | size | immediate | wait 5s − now | wait 30s − now | p95 adverse (30s) | material? |
|---|---|---|---|---|---|---|
| BUY | $10k | 5.192 bp | 0.016 bp (t 0.89) | 0.046 bp (t 1.03) | 8.462 bp | no |
| SELL | $10k | 5.187 bp | -0.022 bp (t -1.25) | -0.046 bp (t -1.03) | 8.399 bp | no |
| BUY | $50k | 5.469 bp | 0.014 bp (t 0.78) | 0.046 bp (t 1.03) | 8.476 bp | no |
| SELL | $50k | 5.473 bp | -0.030 bp (t -1.66) | -0.046 bp (t -1.03) | 8.463 bp | no |

### Passive-order toxicity (measurement, not maker PnL)

| horizon | passive buy | t | passive sell | t |
|---|---|---|---|---|
| 1s | 0.045 bp | 5.95 | 0.039 bp | 5.26 |
| 5s | 0.060 bp | 3.41 | 0.024 bp | 1.36 |
| 30s | 0.088 bp | 1.98 | -0.004 bp | -0.08 |

Queue model: **UNRESOLVED — Tardis aggregate L2 carries no individual order queue identity, so maker fills cannot be modelled and no maker PnL is computed**

## Trials

Raw registry entries 54, configurations 18, effective independent 6.0. Cumulative across every study here: **127.0**.
