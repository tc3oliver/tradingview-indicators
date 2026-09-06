# DSR trial-count correction

Bailey & López de Prado (2014) define the DSR's N as the number of **independent** trials. The IT1 run used N = 765 by adding every registry entry (configuration × split, plus the two prior studies' entries). That over-counts twice: the three splits of one configuration are the same strategy on different dates, and parameter neighbours are near-duplicates of their primary. This file replaces that count with an estimated effective number and keeps all three numbers side by side.

## Method

- Each configuration's sized equity curve on the **validation** split (the selection set) is compounded into daily returns. The Pearson correlation matrix across configurations is computed.
- **Eigenvalue estimator** (Li & Ji 2005): M_eff = Σ [ 1(λ_i ≥ 1) + (λ_i − ⌊λ_i⌋) ] over the correlation matrix's eigenvalues.
- **Cluster estimator**: number of single-linkage clusters at |ρ| ≥ 0.5 (a simplified form of the ONC clustering López de Prado & Lewis 2019 use to count effective trials).
- The **larger** of the two is used per study (more trials = harder to pass). Studies are treated as independent of each other (their effective counts are summed); this ignores any correlation between the 4H and 15m searches, which is conservative.
- Splits are not counted as separate trials. The regime-engine study's return series cannot be regenerated from a common runner, so its raw configuration count is used as an upper bound.
- V[SR] in SR0 is still the variance of all configurations' validation Sharpes (not cluster-aggregated), which keeps the dispersion term unchanged from the original run.

## Counts

| study | raw registry entries | configurations | mean \|ρ\| | eigen M_eff | clusters (\|ρ\|≥0.5) | effective N used |
|---|---|---|---|---|---|---|
| IT1 (15m intraday) | 432 | 144 | 0.11 | 55.0 | 22 | 55.0 |
| TP1 (4H trade planner) | 288 | 96 | 0.34 | 21.0 | 2 | 21.0 |
| Regime engine | 45 | 15 | n/a | n/a | n/a | 15 (upper bound) |
| **total** | **765** | **255** | | | | **92** |

## IT1 under the corrected N (validation ∪ test, top 10 by Sharpe)

| candidate | Sharpe | expR | SR0 @N=765 | DSR @N=765 | SR0 @N=92 | DSR @N=92 |
|---|---|---|---|---|---|---|
| ORB@NY short +1H | 0.39 | 0.03 | 4.42 | 0.000 | 3.48 | 0.000 |
| SWEEP:PD@NY short +1H | -0.06 | -0.08 | 4.42 | 0.000 | 3.48 | 0.000 |
| ORB:RVOL@NY long | -0.13 | -0.01 | 4.42 | 0.000 | 3.48 | 0.000 |
| ORB@NY short | -0.13 | -0.01 | 4.42 | 0.000 | 3.48 | 0.000 |
| ORB:RVOL@NY short | -0.15 | -0.01 | 4.42 | 0.000 | 3.48 | 0.000 |
| VWAP@NY short +1H | -0.58 | -0.11 | 4.42 | 0.000 | 3.48 | 0.000 |
| VWAP@NY long +1H | -0.68 | -0.08 | 4.42 | 0.000 | 3.48 | 0.000 |
| ORB@NY long +1H | -0.73 | -0.05 | 4.42 | 0.000 | 3.48 | 0.000 |
| SWEEP:LONDON@NY short +1H | -0.79 | -0.21 | 4.42 | 0.000 | 3.48 | 0.000 |
| SWEEP:ASIA@LONDON short +1H | -0.84 | -0.21 | 4.42 | 0.000 | 3.48 | 0.000 |

The corrected N does not change any IT1 verdict: every primary still fails G1 (after-cost expectancy), G2, G3 and G7 regardless of G9. Going forward (IT2, IT3) the DSR uses this effective count, and the study's own trials are added to it with the same estimator.
