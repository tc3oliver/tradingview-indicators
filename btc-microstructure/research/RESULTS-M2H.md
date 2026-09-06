# M2-H results — historical L2 retrospective validation

Generated 2026-09-06T09:49:59.265Z. Pre-registered in [`PRE-REGISTRATION-M2H.md`](./PRE-REGISTRATION-M2H.md).

## Verdict: **PRELIMINARY — BLOCKED BY HISTORICAL DATA ACCESS**

> **These numbers cannot produce a PASS.** only 5 of 2301 days in the acceptance window are present (0.2%); free-tier access serves the first day of each month only
> The pre-registration forbids treating free-tier sample days as the acceptance dataset.
> Everything below is the study running end to end on the days available, which is what
> makes the engineering verifiable — not a verdict on the acceptance window.

## Coverage

| | |
|---|---|
| acceptance window | 2020-05-14 → 2026-08-31 (2301 days) |
| days in the store | 5 (0.2% of the window) |
| by split | dev 5 · val 0 · test 0 |
| 1-second feature rows | 431,992 |
| mean valid-book coverage per day | 100.00% |
| archives read / feature store | 1.0 GB / 114 MB |

## Information — coefficient on the future mid return

Primary horizon **30s**. Non-overlapping observations (step = horizon), hour-of-day fixed effects, controls for the previous 30 s return, spread and log near-touch depth, Newey–West at 60 s.

| feature | dev β (t) | val β (t) | test β (t) | val∪test β (t) | rank IC | decile mono | top−bottom |
|---|---|---|---|---|---|---|---|
| D1_depthImbalance | 6.20e-5 (8.28) | n/a | n/a | n/a | n/a | n/a | n/a |
| D2_micropriceDisplacementBp | 2.63e-4 (1.63) | n/a | n/a | n/a | n/a | n/a | n/a |
| D3_orderFlowImbalance5s | 2.43e-5 (2.99) | n/a | n/a | n/a | n/a | n/a | n/a |
| D4_depthChange | 8.97e-5 (0.52) | n/a | n/a | n/a | n/a | n/a | n/a |
| D5_pressureToCapacity | -7.61e-9 (-3.38) | n/a | n/a | n/a | n/a | n/a | n/a |
| D6_flowTimesFragility | 1.47e-6 (0.29) | n/a | n/a | n/a | n/a | n/a | n/a |

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

Multiple-testing threshold |t| > **3.54** at 125.0 cumulative effective trials.

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
| D1_depthImbalance | 0.579 bp | -9.431 bp net (17.3× cost/edge) | -13.421 bp net (24.2× cost/edge) | -19.421 bp net (34.5× cost/edge) | **no** |
| D2_micropriceDisplacementBp | 0.467 bp | -9.544 bp net (21.5× cost/edge) | -13.533 bp net (30.0× cost/edge) | -19.533 bp net (42.9× cost/edge) | **no** |
| D3_orderFlowImbalance5s | 0.123 bp | -9.887 bp net (81.1× cost/edge) | -13.877 bp net (113.4× cost/edge) | -19.877 bp net (162.0× cost/edge) | **no** |
| D4_depthChange | 0.165 bp | -9.846 bp net (60.6× cost/edge) | -13.835 bp net (84.7× cost/edge) | -19.835 bp net (121.0× cost/edge) | **no** |
| D5_pressureToCapacity | 0.579 bp | -9.432 bp net (17.3× cost/edge) | -13.421 bp net (24.2× cost/edge) | -19.421 bp net (34.5× cost/edge) | **no** |
| D6_flowTimesFragility | 0.048 bp | -9.963 bp net (209.3× cost/edge) | -13.952 bp net (292.6× cost/edge) | -19.952 bp net (418.1× cost/edge) | **no** |

## Walk-the-book backtest

Signal at second *t*, entry at the next executable second, exit 30 s later, both priced by walking the reconstructed book. No stop, no target, no overlapping positions. Commission 5 bp per side. Sample: all stored days (later splits not yet in the store).

| candidate | trades | gross/trade | net/trade | win | PF | Sharpe | max DD | net ex-best-5% | long | short |
|---|---|---|---|---|---|---|---|---|---|---|
| D1_depthImbalance | 10,355 | -0.219 bp | -10.219 bp | 2.2% | 0.01 | -1641.44 | 105820 bp | -10.856 bp | -10.168 bp | -10.268 bp |
| D2_micropriceDisplacementBp | 9,315 | -0.493 bp | -10.493 bp | 2.2% | 0.02 | -1376.75 | 97741 bp | -11.186 bp | -10.350 bp | -10.630 bp |
| D3_orderFlowImbalance5s | 9,188 | -0.185 bp | -10.185 bp | 1.2% | 0.01 | -2212.92 | 93584 bp | -10.668 bp | -10.155 bp | -10.216 bp |
| D4_depthChange | 10,712 | -0.440 bp | -10.440 bp | 2.1% | 0.01 | -1688.71 | 111829 bp | -11.075 bp | -10.251 bp | -10.595 bp |
| D5_pressureToCapacity | 7,928 | -0.233 bp | -10.233 bp | 3.1% | 0.02 | -1233.38 | 81129 bp | -11.009 bp | -10.036 bp | -10.422 bp |
| D6_flowTimesFragility | 9,645 | -0.384 bp | -10.384 bp | 2.5% | 0.02 | -1437.65 | 100153 bp | -11.069 bp | -10.280 bp | -10.489 bp |

### Baselines

| baseline | trades | net/trade | PF |
|---|---|---|---|
| randomEntries | 12,044 | -10.373 bp | 0.01 |
| m1AfiReversal | 9,188 | -10.430 bp | 0.00 |

Sign-shuffled controls: D1_depthImbalance -10.446 bp · D2_micropriceDisplacementBp -10.460 bp · D3_orderFlowImbalance5s -10.330 bp · D4_depthChange -10.370 bp · D5_pressureToCapacity -10.361 bp · D6_flowTimesFragility -10.510 bp

## Execution study (Part B)

Given a decision to trade, immediate execution versus waiting. Implementation shortfall against the decision-time mid, commission included. Acceptance threshold: **0.5 bp** with |t| > 2.

| side | size | immediate | wait 5s − now | wait 30s − now | p95 adverse (30s) | material? |
|---|---|---|---|---|---|---|
| BUY | $10k | 5.173 bp | 0.027 bp (t 1.46) | 0.097 bp (t 2.16) | 6.957 bp | no |
| SELL | $10k | 5.167 bp | -0.009 bp (t -0.51) | -0.096 bp (t -2.17) | 6.486 bp | no |
| BUY | $50k | 5.429 bp | 0.025 bp (t 1.37) | 0.097 bp (t 2.16) | 6.922 bp | no |
| SELL | $50k | 5.433 bp | -0.017 bp (t -0.91) | -0.097 bp (t -2.16) | 6.563 bp | no |

### Passive-order toxicity (measurement, not maker PnL)

| horizon | passive buy | t | passive sell | t |
|---|---|---|---|---|
| 1s | 0.042 bp | 5.95 | 0.030 bp | 4.33 |
| 5s | 0.052 bp | 2.87 | 0.021 bp | 1.14 |
| 30s | 0.132 bp | 2.97 | -0.060 bp | -1.36 |

Queue model: **UNRESOLVED — Tardis aggregate L2 carries no individual order queue identity, so maker fills cannot be modelled and no maker PnL is computed**

## Trials

Raw registry entries 54, configurations 18, effective independent 4.0. Cumulative across every study here: **125.0**.
