# M2-H results — historical L2 retrospective validation

Generated 2026-09-06T11:46:16.050Z. Pre-registered in [`PRE-REGISTRATION-M2H.md`](./PRE-REGISTRATION-M2H.md).

## Verdict: **PRELIMINARY — BLOCKED BY HISTORICAL DATA ACCESS**

> **These numbers cannot produce a PASS.** only 26 of 2301 days in the acceptance window are present (1.1%); free-tier access serves the first day of each month only
> The pre-registration forbids treating free-tier sample days as the acceptance dataset.
> Everything below is the study running end to end on the days available, which is what
> makes the engineering verifiable — not a verdict on the acceptance window.

## Coverage

| | |
|---|---|
| acceptance window | 2020-05-14 → 2026-08-31 (2301 days) |
| days in the store | 26 (1.1% of the window) |
| by split | dev 23 · val 3 · test 0 |
| 1-second feature rows | 2,242,898 |
| mean valid-book coverage per day | 99.84% |
| archives read / feature store | 12.2 GB / 605 MB |
| reconciliation against the sequence-verified feed | **PASS** over 465 pooled seconds |

## Information — coefficient on the future mid return

Primary horizon **30s**. Non-overlapping observations (step = horizon), hour-of-day fixed effects, controls for the previous 30 s return, spread and log near-touch depth, Newey–West at 60 s.

| feature | dev β (t) | val β (t) | test β (t) | val∪test β (t) | rank IC | decile mono | top−bottom |
|---|---|---|---|---|---|---|---|
| D1_depthImbalance | 6.30e-5 (14.66) | 5.26e-5 (6.38) | n/a | 5.26e-5 (6.38) | 0.0933 | 0.85 | 1.246 bp |
| D2_micropriceDisplacementBp | 3.13e-4 (2.79) | 4.25e-4 (0.39) | n/a | 4.25e-4 (0.39) | 0.0946 | 0.09 | -0.462 bp |
| D3_orderFlowImbalance5s | 9.91e-6 (1.81) | 1.94e-5 (2.29) | n/a | 1.94e-5 (2.29) | 0.0243 | 0.55 | 0.256 bp |
| D4_depthChange | 5.31e-5 (1.31) | 3.63e-5 (0.53) | n/a | 3.63e-5 (0.53) | 0.0111 | 0.22 | -0.241 bp |
| D5_pressureToCapacity | 4.79e-9 (3.03) | 1.37e-6 (0.41) | n/a | 1.37e-6 (0.41) | 0.0555 | 0.83 | 0.660 bp |
| D6_flowTimesFragility | 1.52e-6 (0.25) | -1.95e-3 (-1.83) | n/a | -1.95e-3 (-1.83) | 0.0272 | -0.26 | -10.776 bp |

### Robustness horizons (val ∪ test)

| feature | 5s β (t) | 30s β (t) | 5m β (t) |
|---|---|---|---|
| D1_depthImbalance | 5.91e-5 (44.48) | 5.26e-5 (6.38) | 4.25e-5 (0.56) |
| D2_micropriceDisplacementBp | 1.57e-3 (4.56) | 4.25e-4 (0.39) | 6.35e-3 (1.35) |
| D3_orderFlowImbalance5s | 1.95e-5 (12.28) | 1.94e-5 (2.29) | -9.18e-5 (-1.19) |
| D4_depthChange | 3.82e-5 (1.40) | 3.63e-5 (0.53) | 1.09e-3 (1.34) |
| D5_pressureToCapacity | 1.91e-7 (1.97) | 1.37e-6 (0.41) | 1.94e-5 (1.84) |
| D6_flowTimesFragility | -7.13e-5 (-0.27) | -1.95e-3 (-1.83) | 1.40e-3 (0.11) |

## Gates

Multiple-testing threshold |t| > **3.55** at 131.0 cumulative effective trials.

| feature | G1 sign stable | G2 \|t\|≥2 val & test | G3 multiple testing | G4 monotonicity | G5 economic | verdict |
|---|---|---|---|---|---|---|
| D1_depthImbalance | FAIL | FAIL | FAIL | FAIL | FAIL | REJECTED |
| D2_micropriceDisplacementBp | FAIL | FAIL | FAIL | FAIL | FAIL | REJECTED |
| D3_orderFlowImbalance5s | FAIL | FAIL | FAIL | FAIL | FAIL | REJECTED |
| D4_depthChange | FAIL | FAIL | FAIL | FAIL | FAIL | REJECTED |
| D5_pressureToCapacity | FAIL | FAIL | FAIL | FAIL | FAIL | REJECTED |
| D6_flowTimesFragility | FAIL | FAIL | FAIL | FAIL | FAIL | REJECTED |

## Economics — information is not tradability

Measured half-spread plus book impact for a $10,000 order, from the reconstructed book: **0.013 bp** per side. Gross edge basis: validation ∪ test.

| feature | gross edge | A: commission + measured book cost | B: 14 bp | C: 20 bp | tradable |
|---|---|---|---|---|---|
| D1_depthImbalance | 0.623 bp | -9.403 bp net (16.1× cost/edge) | -13.377 bp net (22.5× cost/edge) | -19.377 bp net (32.1× cost/edge) | **no** |
| D2_micropriceDisplacementBp | 0.231 bp | -9.795 bp net (43.4× cost/edge) | -13.769 bp net (60.6× cost/edge) | -19.769 bp net (86.6× cost/edge) | **no** |
| D3_orderFlowImbalance5s | 0.128 bp | -9.898 bp net (78.3× cost/edge) | -13.872 bp net (109.3× cost/edge) | -19.872 bp net (156.1× cost/edge) | **no** |
| D4_depthChange | 0.121 bp | -9.905 bp net (83.1× cost/edge) | -13.879 bp net (116.1× cost/edge) | -19.879 bp net (165.9× cost/edge) | **no** |
| D5_pressureToCapacity | 0.330 bp | -9.696 bp net (30.4× cost/edge) | -13.670 bp net (42.4× cost/edge) | -19.670 bp net (60.6× cost/edge) | **no** |
| D6_flowTimesFragility | 5.388 bp | -4.638 bp net (1.9× cost/edge) | -8.612 bp net (2.6× cost/edge) | -14.612 bp net (3.7× cost/edge) | **no** |

## Walk-the-book backtest

Signal at second *t*, entry at the next executable second, exit 30 s later, both priced by walking the reconstructed book. No stop, no target, no overlapping positions. Commission 5 bp per side. Sample: validation ∪ test.

| candidate | trades | gross/trade | net/trade | win | PF | Sharpe | max DD | net ex-best-5% | long | short |
|---|---|---|---|---|---|---|---|---|---|---|
| D1_depthImbalance | 7,021 | 0.236 bp | -9.764 bp | 2.6% | 0.01 | -1836.18 | 68552 bp | -10.371 bp | -9.739 bp | -9.788 bp |
| D2_micropriceDisplacementBp | 711 | 0.069 bp | -9.931 bp | 4.8% | 0.03 | -420.78 | 7061 bp | -10.800 bp | -10.134 bp | -9.696 bp |
| D3_orderFlowImbalance5s | 6,312 | 0.111 bp | -9.889 bp | 2.1% | 0.01 | -1944.40 | 62422 bp | -10.459 bp | -9.962 bp | -9.821 bp |
| D4_depthChange | 3,789 | -0.135 bp | -10.135 bp | 3.5% | 0.02 | -1205.79 | 38401 bp | -10.833 bp | -10.173 bp | -10.087 bp |
| D5_pressureToCapacity | 2,411 | 0.412 bp | -9.588 bp | 6.4% | 0.04 | -768.41 | 23116 bp | -10.519 bp | -9.618 bp | -9.553 bp |
| D6_flowTimesFragility | 313 | 0.023 bp | -9.977 bp | 7.3% | 0.06 | -239.38 | 3123 bp | -11.085 bp | -9.993 bp | -9.957 bp |

### Baselines

| baseline | trades | net/trade | PF |
|---|---|---|---|
| randomEntries | 7,226 | -10.019 bp | 0.01 |
| m1AfiReversal | 6,312 | -10.167 bp | 0.01 |

Sign-shuffled controls: D1_depthImbalance -10.019 bp · D2_micropriceDisplacementBp -10.047 bp · D3_orderFlowImbalance5s -10.056 bp · D4_depthChange -9.967 bp · D5_pressureToCapacity -10.088 bp · D6_flowTimesFragility -9.616 bp

## Execution study (Part B)

Given a decision to trade, immediate execution versus waiting. Implementation shortfall against the decision-time mid, commission included. Acceptance threshold: **0.5 bp** with |t| > 2.

| side | size | immediate | wait 5s − now | wait 30s − now | p95 adverse (30s) | material? |
|---|---|---|---|---|---|---|
| BUY | $10k | 5.115 bp | 0.004 bp (t 0.43) | 0.024 bp (t 0.96) | 9.505 bp | no |
| SELL | $10k | 5.115 bp | -0.009 bp (t -0.83) | -0.024 bp (t -0.97) | 9.550 bp | no |
| BUY | $50k | 5.296 bp | 0.004 bp (t 0.34) | 0.024 bp (t 0.96) | 9.543 bp | no |
| SELL | $50k | 5.296 bp | -0.012 bp (t -1.13) | -0.024 bp (t -0.97) | 9.544 bp | no |

### Passive-order toxicity (measurement, not maker PnL)

| horizon | passive buy | t | passive sell | t |
|---|---|---|---|---|
| 1s | 0.025 bp | 5.93 | 0.031 bp | 7.36 |
| 5s | 0.034 bp | 3.35 | 0.023 bp | 2.24 |
| 30s | 0.052 bp | 2.12 | 0.005 bp | 0.20 |

Queue model: **UNRESOLVED — Tardis aggregate L2 carries no individual order queue identity, so maker fills cannot be modelled and no maker PnL is computed**

## Trials

Raw registry entries 54, configurations 18, effective independent 10.0. Cumulative across every study here: **131.0**.
