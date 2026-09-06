# M1 results — aggressor flow and short-horizon BTC returns

Pre-registered in [`../PRE-REGISTRATION-M1.md`](../PRE-REGISTRATION-M1.md). Generated 2026-09-06T07:50:41.163Z.
All figures are **RETROSPECTIVE — NEW DATA DOMAIN**, not pristine out-of-sample.

## Verdict: **REJECT**

H1 failed I1 I2 I3 I4 I5 I6 I7; H2 failed I2 I3 I4 I5 I6.

## H1 — aggressor flow continuation

Coefficient on **AFI**, 15m forward return, futures, minute-of-day fixed effects, Newey-West lag 12.

| split | n | β | HAC t | 95% CI | within R² |
|---|---|---|---|---|---|
| dev | 315,613 | -1.081e-4 | -1.22 | [-2.82e-4, 6.58e-5] | 0.092% |
| val | 210,523 | 2.992e-5 | 0.54 | [-7.85e-5, 1.38e-4] | 0.086% |
| test | 176,538 | 4.958e-6 | 0.10 | [-8.97e-5, 9.97e-5] | 0.068% |
| valtest | 387,061 | 1.680e-5 | 0.46 | [-5.55e-5, 8.91e-5] | 0.077% |
| full | 702,674 | -3.334e-5 | -0.73 | [-1.23e-4, 5.65e-5] | 0.080% |

| robustness | n | β | HAC t |
|---|---|---|---|
| futures, 5m horizon | 387,063 | 2.610e-5 | 1.14 |
| futures, 30m horizon | 387,058 | -2.491e-5 | -0.59 |
| spot, 5m horizon | 387,029 | 8.698e-7 | 0.07 |
| spot, 15m horizon | 387,027 | -3.824e-5 | -1.84 |
| spot, 30m horizon | 387,024 | -8.637e-5 | -3.19 |

Spearman rank IC of AFI against the 15m forward return (validation ∪ test): **-0.03018**.

### Deciles of AFI (breakpoints from development), validation ∪ test

| decile | n | mean 15m forward return | HAC t |
|---|---|---|---|
| 1 | 55,653 | 0.449 bp | 4.73 |
| 2 | 39,636 | 0.384 bp | 2.79 |
| 3 | 35,189 | 0.413 bp | 2.53 |
| 4 | 33,526 | 0.204 bp | 1.25 |
| 5 | 32,623 | 0.405 bp | 2.45 |
| 6 | 32,723 | -0.088 bp | -0.53 |
| 7 | 32,967 | 0.031 bp | 0.18 |
| 8 | 34,342 | -0.034 bp | -0.22 |
| 9 | 37,344 | -0.272 bp | -1.96 |
| 10 | 53,058 | -0.271 bp | -2.80 |

Monotonicity (Spearman of decile index vs mean return): **-0.891**. Top − bottom: **-0.720 bp**.

### Year by year (primary specification, futures, 15m)

| year | n | β | HAC t |
|---|---|---|---|
| 2020 | 105,396 | -1.399e-4 | -0.98 |
| 2021 | 105,109 | -1.423e-4 | -0.66 |
| 2022 | 105,108 | -1.165e-5 | -0.18 |
| 2023 | 105,117 | 5.572e-5 | 0.62 |
| 2024 | 105,406 | 6.281e-6 | 0.10 |
| 2025 | 105,117 | 5.630e-6 | 0.08 |
| 2026 | 71,421 | 6.973e-6 | 0.15 |

### Gates

| gate | requirement | result |
|---|---|---|
| I1 | same β sign in all three splits | FAIL (− + +) |
| I2 | \|t\| ≥ 2 on validation and on test | FAIL (0.54, 0.10) |
| I3 | \|t\| > 3.53 on validation ∪ test | FAIL (0.46) |
| I4 | consistent sign in ≥ 5 of 7 years, survives dropping the best year | FAIL (drop 2023: t 0.09) |
| I5 | decile monotonicity ≥ 0.7 with the right sign | FAIL (-0.89) |
| I6 | survives removing the 5% largest \|forward return\| | FAIL (β -4.39e-5, t -3.54) |
| I7 | spot β has the same sign | FAIL (-3.82e-5) |

## H2 — absorption / price response

Coefficient on **AFI × ret5m**, 15m forward return, futures, minute-of-day fixed effects, Newey-West lag 12.

| split | n | β | HAC t | 95% CI | within R² |
|---|---|---|---|---|---|
| dev | 315,613 | 2.201e-2 | 0.38 | [-9.28e-2, 1.37e-1] | 0.092% |
| val | 210,523 | 1.323e-1 | 1.40 | [-5.27e-2, 3.17e-1] | 0.110% |
| test | 176,538 | 3.049e-2 | 0.78 | [-4.58e-2, 1.07e-1] | 0.069% |
| valtest | 387,061 | 8.954e-2 | 1.57 | [-2.20e-2, 2.01e-1] | 0.088% |
| full | 702,674 | 4.224e-2 | 0.99 | [-4.15e-2, 1.26e-1] | 0.082% |

| robustness | n | β | HAC t |
|---|---|---|---|
| futures, 5m horizon | 387,063 | 4.586e-2 | 1.06 |
| futures, 30m horizon | 387,058 | 1.188e-1 | 2.06 |
| spot, 5m horizon | 387,029 | 2.450e-2 | 0.93 |
| spot, 15m horizon | 387,027 | 5.771e-2 | 1.50 |
| spot, 30m horizon | 387,024 | 7.240e-2 | 1.73 |

Spearman rank IC of AFI × ret5m against the 15m forward return (validation ∪ test): **0.00324**.

### Deciles of AFI × ret5m (breakpoints from development), validation ∪ test

| decile | n | mean 15m forward return | HAC t |
|---|---|---|---|
| 1 | 34,736 | 0.035 bp | 0.22 |
| 2 | 43,800 | 0.103 bp | 0.91 |
| 3 | 47,956 | 0.180 bp | 1.77 |
| 4 | 45,232 | -0.183 bp | -1.66 |
| 5 | 43,294 | 0.245 bp | 2.11 |
| 6 | 41,390 | 0.163 bp | 1.36 |
| 7 | 39,292 | -0.013 bp | -0.10 |
| 8 | 36,549 | 0.093 bp | 0.62 |
| 9 | 32,235 | 0.321 bp | 1.89 |
| 10 | 22,577 | 0.468 bp | 1.51 |

Monotonicity (Spearman of decile index vs mean return): **0.467**. Top − bottom: **0.434 bp**.

### Year by year (primary specification, futures, 15m)

| year | n | β | HAC t |
|---|---|---|---|
| 2020 | 105,396 | -1.216e-1 | -1.02 |
| 2021 | 105,109 | 1.714e-1 | 1.86 |
| 2022 | 105,108 | -4.311e-2 | -0.75 |
| 2023 | 105,117 | 2.178e-1 | 1.13 |
| 2024 | 105,406 | 7.443e-2 | 1.24 |
| 2025 | 105,117 | 6.611e-2 | 1.21 |
| 2026 | 71,421 | -2.384e-2 | -0.47 |

### Gates

| gate | requirement | result |
|---|---|---|
| I1 | same β sign in all three splits | pass (+ + +) |
| I2 | \|t\| ≥ 2 on validation and on test | FAIL (1.40, 0.78) |
| I3 | \|t\| > 3.53 on validation ∪ test | FAIL (1.57) |
| I4 | consistent sign in ≥ 5 of 7 years, survives dropping the best year | FAIL (drop 2023: t 1.49) |
| I5 | decile monotonicity ≥ 0.7 with the right sign | FAIL (0.47) |
| I6 | survives removing the 5% largest \|forward return\| | FAIL (β 1.17e-2, t 0.95) |
| I7 | spot β has the same sign | pass (5.77e-2) |

## H2 cells (development AFI deciles, validation ∪ test)

| cell | n | mean 15m forward return | HAC t |
|---|---|---|---|
| absorbedBuy | 3,165 | -0.301 bp | -0.95 |
| alignedBuy | 49,893 | -0.269 bp | -2.70 |
| absorbedSell | 3,828 | 0.495 bp | 1.80 |
| alignedSell | 51,825 | 0.446 bp | 4.53 |

## H1 long and short sides (validation ∪ test)

| side | n | β | HAC t |
|---|---|---|---|
| AFI > 0 | 188,763 | -2.173e-5 | -0.47 |
| AFI < 0 | 198,298 | 7.995e-5 | 1.28 |

## Trials

| raw registry entries | configurations | mean \|ρ\| | eigenvalue estimate | clusters at \|ρ\| ≥ 0.5 | effective |
|---|---|---|---|---|---|
| 36 | 12 | 0.34 | 6.0 | 2 | 6.0 |

Cumulative across every study in this repository: **121.0 effective trials**, giving a two-sided multiple-testing threshold of \|t\| > **3.53** (gate I3).

## Economics

**The information gate did not pass, so §7 was never reached and no strategy is built.** The numbers below are descriptive only, computed so the question "how big was the edge before and after cost" has an answer on the record. They cannot and do not change the verdict.

Signal: top / bottom development AFI decile. Fill at the next bar's open, exit at the open three bars later. No stop, no target, no sizing.

| cost (round trip) | trades | gross/trade | net/trade | annualised net | hit rate | PF |
|---|---|---|---|---|---|---|
| 0.14% | 108,710 | -0.362 bp | -14.362 bp | -4240.2% | 14.5% | 0.14 |
| 0.20% | 108,710 | -0.362 bp | -20.362 bp | -6011.6% | 8.9% | 0.07 |
| 0.30% | 108,710 | -0.362 bp | -30.362 bp | -8963.9% | 4.4% | 0.03 |

Gross edge per signal: **-0.362 bp** (HAC t -5.74); mean absolute 15m move on those bars: **12.799 bp**.
**COST / EXPECTED EDGE** = -38.7 at 0.14%, -55.2 at 0.20%, -82.8 at 0.30%.
**COST / EXPECTED MOVE** = 1.09 at 0.14%.

## Post-hoc

Computed after the gates were evaluated and both hypotheses rejected. It changes no gate and no verdict; it exists so that a future pre-registration has a recorded starting point rather than a memory.

| split | decile monotonicity | top decile mean | bottom decile mean | top − bottom |
|---|---|---|---|---|
| dev | -0.976 | -0.661 bp (t -3.38) | 1.105 bp (t 5.49) | -1.767 bp |
| val | -0.879 | -0.113 bp (t -0.81) | 0.534 bp (t 3.95) | -0.647 bp |
| test | -0.673 | -0.437 bp (t -3.29) | 0.358 bp (t 2.70) | -0.795 bp |
