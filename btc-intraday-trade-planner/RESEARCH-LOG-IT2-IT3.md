# Research log — IT2 (paper replication) and IT3 (1H fallback)

Pre-registered together in [`PRE-REGISTRATION-IT2-IT3.md`](./PRE-REGISTRATION-IT2-IT3.md)
(commit `b2ac11d`, before any result). Engines: [`research/it2.mjs`](./research/it2.mjs),
[`research/it3.mjs`](./research/it3.mjs). Tables: [`research/RESULTS-IT2.md`](./research/RESULTS-IT2.md),
[`research/RESULTS-IT3.md`](./research/RESULTS-IT3.md). Trial-count correction:
[`research/EFFECTIVE-TRIALS.md`](./research/EFFECTIVE-TRIALS.md).

Everything is **RETROSPECTIVE RESEARCH**; 2022-01 → 2026-09 is a
**POST-PUBLICATION RETROSPECTIVE TEST**, not pristine out-of-sample.

---

## 0. DSR trial-count correction

The IT1 run used N = 765 — every registry entry (configuration × split, plus
prior studies' entries). Bailey & López de Prado define N as *independent*
trials; three splits of one configuration are one strategy, and parameter
neighbours are near-copies. Effective counts were estimated from the
correlation of validation-split daily returns (Li & Ji eigenvalue estimator;
single-linkage clusters at |ρ| ≥ 0.5; the larger is used):

| study | raw entries | configurations | effective N |
|---|---|---|---|
| IT1 (15m) | 432 | 144 | 55 |
| TP1 (4H) | 288 | 96 | 21 |
| Regime engine | 45 | 15 | 15 (upper bound; series not regenerable) |
| IT2 | 12 | 12 | 9 |
| IT3 | 72 | 24 | 12 |
| **cumulative after IT3** | **849** | **291** | **115** |

Under N = 92 (before IT2/IT3) IT1's best candidate has DSR 0.000, as it had
under 765. No IT1 verdict changes: every primary fails after-cost expectancy,
PF and cost stress independently of the DSR.

---

## 1. IT2 — Shen, Urquhart & Wang (2022) replication

### Verdict: **REJECT — NOT REPLICATED.** Failed gates A1 A2 A3 A4 A5 A6 A7 A11.

### 1.1 What the paper says (exact)

Trading day = exchange volume-spike open (09:00–09:40 EST) to 17:00 EST (CME
break). `r_ONFH` = previous 17:00 close → 30 min after open; `r_SLH` = 16:00 →
16:30; `r_LH` = 16:30 → 17:00. Pooled OLS across five USD spot exchanges,
2013–2020, Newey–West. Paper: β_ONFH 0.968 (t 4.38), **R² 1.44%**, R²_OOS
1.09%; stronger in high-volume (t 4.74) and high-volatility (t 6.25)
terciles; timing rule long/short the last half-hour on the sign of r_ONFH:
7.82%/yr, success 51.6%, **profit per trade 0.028%, break-even cost 3 bps**;
the authors themselves note it is unprofitable at a 25 bp fee without
leverage.

### 1.2 Phase 1 — paper period, Binance spot 2017-08-17 → 2020-12-31 (n = 1,225)

| | paper | this study (primary: 09:30 ET open, DST-following) |
|---|---|---|
| β_ONFH (NW t) | 0.968 (4.38) | 0.003 (0.25) |
| R² / R²_OOS | 1.44% / 1.09% | 0.02% / −0.84% |
| β_SLH (t) | −9.778 (−10.22) | 0.02 (0.35) |
| high-volume tercile β (t) | 2.013 (4.74) | −0.005 (−0.33) |
| high-volatility tercile β (t) | 2.012 (6.25) | 0.003 (0.19) |
| η(ONFH) success / profit per trade | 51.6% / 0.028% | 50.9% / 0.003% |

The three alternative timing definitions (09:00 open; fixed UTC−5; both) give
t between 0.39 and 0.53. Descriptive statistics match the paper's Table 2 in
scale (r_ONFH sd 3.3% vs 3.6%, r_LH sd 0.60% vs 0.83%), so the sample is the
right object; the effect is absent on this venue in the paper's own period.
(β is not on the paper's scale because the paper annualises returns before
regressing; t and R² are scale-free and are the comparison.)

Power check: at the paper's R² of 1.44% and n = 1,225, the expected t is
≈ 4.2. Observed 0.25.

### 1.3 Gap year 2021 and Phase 2 — post-publication 2022-01-01 → 2026-09-06

| sample | n | β_ONFH (t) | R² | hit rate | η(ONFH) gross/trade | net @0.14% |
|---|---|---|---|---|---|---|
| 2021 spot / perp | 365 | 0.006 (0.63) / 0.005 (0.59) | 0.10% / 0.09% | 50.7% / 49.3% | −0.040% / −0.037% | −0.180% / −0.177% |
| 2022–26 perp, primary | 1,709 | 0.005 (0.69) | 0.07% | 51.7% | **+0.010%** | **−0.130%** |
| 2022–26 spot, primary | 1,708 | 0.005 (0.64) | 0.06% | 51.8% | +0.011% | −0.129% |
| 2022–26 perp, fixed UTC−5 | 1,709 | 0.017 (2.37) | 0.74% | 50.4% | +0.011% | −0.129% |

By year (perp, primary): β t-stats 1.05, 0.28, −0.56, −0.33, 0.27 — sign flips
twice. Weekday t 0.51, weekend 0.83. Long-signal days +0.005%/trade gross,
short-signal days +0.015%; high-volume tercile +0.030% (t 1.64), other days
0.000%. Nothing reaches t = 1.96 on the primary definition in any subset.

The fixed-UTC−5 variants reach t ≈ 2.4–2.6 post-publication. They are
paper-defined robustness checks, not the primary; and their gross profit per
trade (0.011–0.014%) is the same as the primary's, so they are economically
identical to it. Recorded, not promoted.

### 1.4 Phase 3 — economics, perp, 2022–2026

**Cost / expected move ratio**: 0.14% ÷ mean |r_LH| (0.240%) = **0.58**;
0.14% ÷ gross profit per trade (0.010%) = **14.0**. The rule's gross edge is
one-fourteenth of the round trip. The paper's own break-even was 3 bps; on
this venue and period it is 1 bp.

| rule (0.14% RT) | trades | gross/trade | net/trade | ann. net | success | PF | PF ex-5% |
|---|---|---|---|---|---|---|---|
| η(ONFH) | 1,709 | +0.010% | −0.130% | −47% | 27% | 0.35 | 0.15 |
| η(SLH) | 1,709 | −0.002% | −0.142% | −52% | 27% | 0.31 | 0.14 |
| η(both) | 901 | +0.008% | −0.132% | −25% | 28% | 0.34 | 0.14 |
| always long | 1,709 | −0.005% | −0.145% | −53% | 27% | 0.30 | 0.13 |

Every year 2022–2026 is net negative. Phase 4 (TradingView) is not reached.

### 1.5 Reading

Two independent findings. First, the statistical effect does **not
replicate** on Binance spot in the paper's own period, with adequate power,
under four timing definitions. Second, even the paper's own reported
magnitude — 0.028% per trade, break-even 3 bps — is an order of magnitude
below a realistic taker round trip, so a replication *success* would not have
produced a tradable rule either; the paper says as much in §3.7. The pooled
five-exchange 2013–2020 result may reflect early-period, thin-venue
microstructure (2013–2016 CEX.IO / Kraken with hundreds of BTC per day) that
does not exist on a 2017+ major venue.

---

## 2. IT3 — lower-turnover 1H short-horizon trading (fallback, pre-registered before IT2 ran)

### Verdict: **6 of 6 REJECTED.** Feasibility gate: 6 of 6 feasible.

| # | candidate | 0.14% ÷ median planned risk | n (val ∪ test) | expR | PF | PF ex-5% | dev / val / test expR | failed |
|---|---|---|---|---|---|---|---|---|
| 1 | A 24H range breakout, long | 0.079 (risk 2.1%) | 401 | −0.06 | 0.91 | 0.75 | +0.05 / −0.01 / −0.12 | G1 G2 G3 G5 G7 G8 G9 |
| 2 | A 24H range breakout, short | 0.070 (2.3%) | 374 | +0.01 | 1.02 | 0.86 | −0.10 / +0.04 / −0.01 | G1 G2 G3 G5 G7 G8 G9 |
| 3 | B 24H momentum, long | 0.057 (2.4%) | 140 | −0.12 | 0.79 | 0.62 | −0.10 / −0.12 / −0.13 | G1 G2 G3 G5 G7 G8 G9 |
| 4 | B 24H momentum, short | 0.050 (2.6%) | 118 | **+0.14** | **1.27** | 1.08 | **−0.13** / +0.09 / +0.21 | **G1 G9** |
| 5 | C 24H mean reversion, long | 0.050 (2.6%) | 122 | −0.18 | 0.70 | 0.51 | +0.03 / −0.08 / −0.31 | G1 G2 G3 G5 G7 G8 G9 |
| 6 | C 24H mean reversion, short | 0.056 (2.4%) | 143 | −0.17 | 0.73 | 0.55 | −0.15 / −0.26 / −0.04 | G1 G2 G3 G5 G7 G8 G9 |

**The IT1 diagnosis was correct and it was not the whole story.** Moving to
1H with 2.5-ATR stops puts the round trip at 5–8% of planned risk (IT1:
10–50%), so cost is no longer the mechanism — and the candidates still lose.
Every candidate is negative in at least two of its three splits; two (B long,
C short) are negative in all three; no candidate other than the near-miss
below is positive on validation ∪ test by more than 0.01 R. Gross edge, not
cost, is what is missing.

**The near-miss (B short, 24H momentum short).** +0.14 R on validation ∪
test, PF 1.27, three neighbours all positive (0.10 / 0.07 / 0.04), three
years positive. It fails G1 because it earned **−0.13 R per trade across 154
trades in development (2020–2023)**, and G9 because its Sharpe (0.71) is
below the 115-effective-trial noise floor (SR0 1.53). This is the same shape
as TP1's four near-misses and IT1's ORB NY short: a short rule whose entire
positive record lies in 2024–2026. Per the pre-registration it is REJECTED and
is not carried forward.

---

## 3. Consequences

- **No `strategy()` is built.** No intraday or 1H directional plan has
  evidence.
- Per the pre-registration §6 (IT3): the search for directional strategies on
  OHLCV / standard TradingView data stops here. Three studies (TP1 4H, IT1
  15m, IT3 1H) and one literature replication (IT2) on 2020–2026 Binance BTC
  all fail; 291 configurations, 115 effective trials.
- The only direction not tested is raw market microstructure / order flow,
  which needs data and infrastructure outside TradingView and would be a new
  pre-registration.
- What ships remains what shipped: Trade Risk Planner (sizing, any
  timeframe), session levels, frozen Market Radar — none of which claims
  direction.
