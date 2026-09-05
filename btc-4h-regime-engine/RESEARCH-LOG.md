# Research log — BTC 4H Regime & Pullback Engine

Every hypothesis tested, in order, including the ones that failed. A log that
only records successes cannot support a Deflated Sharpe Ratio, because DSR needs
an honest trial count. Failures below are not embarrassments; they are the
denominator.

**Governing rule: try to falsify, not to confirm.** A module enters the
indicator only after surviving falsification, out-of-sample testing, and an
ablation showing incremental value over the model without it.

---

## Trial counter

| | count |
|---|---|
| Hypotheses formally pre-registered and tested | 4 |
| Event definitions used | 1 (unchanged since H1) |
| Drawdown thresholds scanned | 4 (H1 only, pre-specified) |
| Z-score thresholds used | 1 (±1.5, taken from the original spec, never varied) |
| Models compared in the ablation | 10 (declared before running) |
| Holdout reads | 1 |
| Post-hoc re-tunings after seeing a result | **0** |
| Modules admitted to the indicator | **0** |

Trial count is low by design, which is the only reason a Deflated Sharpe would
be worth computing here. It is also why the failures are informative: they are
not the residue of a wide search.

---

## Dataset

Built by [`data/fetch.mjs`](./data/fetch.mjs) from free Binance sources. No
vendor API keys, no paid feed.

| series | source | granularity | coverage |
|---|---|---|---|
| 4H OHLCV | `fapi/v1/klines` | 4H | 2020-09-01 → present |
| Open interest (coin + USD) | `data.binance.vision` metrics dump | 5m → 4H | 2020-09-01 → present |
| Top trader long/short — position and account ratio | same dump | 5m → 4H | same |
| Global long/short account ratio | same dump | 5m → 4H | same |
| Taker buy/sell volume ratio | same dump + klines | 5m / 4H | same |
| Funding rate | `fapi/v1/fundingRate` | 8h → 4H | 2019-09-10 → present |

**13,164 4H bars, zero kline gaps, 2 stale OI bars.**

Sampling contract: open interest and funding are taken as the last value at or
before **bar close**. Nothing later is visible to a bar-close decision. This is
the no-lookahead guarantee for the whole dataset.

Backtest window is capped at 2020-09-01 by the OI dump, not by choice.

---

## H1 — aggregate open interest direction during pullbacks

**Script:** [`research/h1-aggregate-oi.mjs`](./research/h1-aggregate-oi.mjs)

**Theory.** Forced sellers are price-insensitive and exhaust; discretionary
sellers are not and do not. A pullback that liquidates leveraged longs (OI
falling) should therefore resolve differently from one where new positions are
being built (OI rising). This is the load-bearing claim of the original design.

**Prior art.** A literature sweep across SSRN, arXiv q-fin, Glassnode,
CryptoQuant, Kaiko, Amberdata and CoinGlass found **no published test of this
claim.** It is asserted by vendors (Glassnode's LPOC framework contains zero
backtesting; its only number is an anecdote about SOL after FTX) and narrated
after the fact, never scored. Hong & Yogo (2012, JFE) do establish OI growth as
a return predictor — but monthly, sector-aggregated, in commodities, with a
**positive** sign, i.e. the opposite of the crowding intuition. No intraday
analogue exists in any asset class.

**Definitions (pre-registered).** 30-bar lookback; event when close ≤ 5% below
the running high; 30-bar spacing; uptrend only (close > EMA200 at the peak).
Split on coin-denominated OI change over the pullback leg. Horizons 12/24/48/96h.

**Result: FAIL.**

The direction matched the thesis in **12 of 12 cells** with adequate sample
(3%, 5%, 8% drawdown × four horizons). Not one cell reversed. But **no bootstrap
CI excluded zero.** At the primary cell (D=5%, 24h) the difference was +0.81%
with CI [−0.42%, +2.09%].

**Verdict: inconclusive, not refuted.** Direction consistent, statistically
underpowered. This is explicitly *not* treated as evidence the effect exists.

**Corrected downward by the H2 audit** — see below. H1's reported n counted raw
events, 47% of which were continuations of a live drawdown rather than
independent episodes. H1's confidence intervals were **too narrow**. The true
result is weaker than first reported.

### Withdrawn as invalid: the USD-notional OI gate

The original spec computed its leverage state from aggregated **USD-denominated**
OI. USD OI = coin OI × price, so it falls mechanically whenever price falls.

Measured: it classified **134 of 147** uptrend pullbacks (91%) as "healthy
deleveraging", and its sign **reversed at 3 of 4 horizons** relative to the
coin-denominated measure.

An indicator built on it would have printed `HEALTHY DELEVERAGING` almost
permanently while looking entirely reasonable on a chart. **Removed. Coin- or
contract-denominated OI only, everywhere, permanently.**

---

## H2 — disaggregated derivatives positioning

**Script:** [`research/h2-disaggregated-positioning.mjs`](./research/h2-disaggregated-positioning.mjs)

**Theory.** The published positioning results (CFTC COT, commercial vs
non-commercial) attach to **disaggregation** — knowing *who* holds the position.
Aggregate OI is a scalar that discards exactly that. The Binance metrics dump
provides the disaggregation free. This is a motivated hypothesis, not a fishing
expedition.

**Definitions (pre-registered).** Event definition **unchanged from H1**, D=5%
only, no new thresholds scanned. Primary horizon fixed at 24h; 48h secondary.
Three-way sign-based classification with nothing tunable:

- `HEALTHY` — OI falling **and** top-trader long/short *position* ratio not falling
- `BEARISH` — OI rising **and** top-trader position ratio falling
- `UNCLASSIFIED` — everything else, excluded rather than forced into a binary

Account ratio (`count_*`) deliberately not used as a primary variable. Funding
deliberately excluded to preserve attribution. Moving-block bootstrap (L=5
episodes) over the time-ordered episode sequence. Chronological holdout from
2024-09.

### Audit findings (run before the test, and the most useful output of H2)

1. **Forward windows do not overlap.** Min event gap 30 bars > max horizon 12.
2. **Events double-count episodes.** 247 raw events collapse to **102
   independent episodes**; 145 events were continuations of a drawdown already
   in progress. In the uptrend population with complete data: **79 episodes.**

This is why H1 is now recorded as weaker than originally reported.

**Result: FAIL on all four substantive criteria.**

| criterion | result |
|---|---|
| 24h difference > +0.50% | FAIL — **−0.46%** (sign reversed on the full sample) |
| block-bootstrap CI excludes 0 | FAIL — [−1.93%, +0.97%] |
| ≥ 30 independent episodes per group | FAIL — 30 healthy / **11** bearish |
| discovery and holdout agree in direction | FAIL — +0.32% vs **−1.27%** |

**Do not read the holdout cells that print `excl 0`.** The holdout bearish group
contains **one** episode; the bootstrap resamples that single observation, so
the interval is an artifact, not a finding. Logged for completeness only.

**H2b — taker buy/sell imbalance**, tested separately to preserve attribution:
48h difference +2.47% with CI excluding zero. **Recorded as inconclusive and not
pursued.** n=8 in one group, 48h is the secondary horizon, and the split is 8 vs
71 because taker flow is net-sell during nearly every pullback — the same
mechanical lopsidedness that invalidated USD OI. Chasing this would be exactly
the post-hoc threshold hunting this log exists to prevent.

---

## Structural finding: the event-study route is exhausted

Six years of BTC contain **79 independent uptrend pullback episodes.** Any
two-way split lands around 30/11.

With a 24h return standard deviation of roughly 3–4%, the standard error of a
difference at n=30 vs n=11 is about 1.2%, so **detection requires an effect
larger than ~2.4%.** Everything observed across H1 and H2 sits between 0.3% and
1.4% — **two to eight times too small to ever resolve on this dataset.**

No additional feature fixes this. The binding constraint is the episode count,
and pullbacks are rare by definition.

**Consequence:** stop trying to classify rare events. Ask instead whether a
feature adds **incremental information at bar level**, across all 13,164 bars —
166× the sample. That is a different question with real statistical power, and
it is the question an ablation is supposed to answer.

---

## Status of the original spec's modules

| module | status | basis |
|---|---|---|
| USD-notional OI leverage gate | **removed, invalid** | mechanically price-contaminated; H1 |
| Aggregate OI pullback classifier | **inconclusive, not admitted** | H1 |
| Top-trader positioning classifier | **rejected** | H2, all four criteria |
| Taker imbalance classifier | **inconclusive, not pursued** | H2b |
| Funding | **untested** | held back for attribution |
| ETF flow | **not started** | daily, lagged, reflexive (returns→flows t=9.75 vs flows→returns t=3.12); structurally mismatched to a 4H grid |
| SOPR | **not started** | acknowledged-false identifying assumption; daily; stale 5 of 6 bars |
| Footprint | **excluded** | Premium-gated **and officially documented as repainting by design** — excluded from any historical backtest core. Live confirmation only. *(Citation pending: not present on the Pine "Other timeframes and data" page or the footprint launch blog post, the two pages checked here.)* |
| B-Xtrender | **untested** | is `EMA5−EMA20` (a MACD line) → RSI → T3; a deterministic function of close, so it cannot add information beyond price. To be tested against plain MACD/RSI as a permanent robustness arm |
| Structure / EMA | **untested** | to be validated as baseline, not assumed |

**Modules admitted to the indicator: none.**

---

## Calibration: what result would even be meaningful

The original spec's acceptance bar of Sharpe ≥ 1.00 is rejected as
non-discriminating: under multiple testing, a strategy with zero true edge
produces a best-of-search Sharpe that rises with the number of trials, and a
fixed bar takes no account of how hard the author searched.

**Replaced by a Deflated Sharpe Ratio computed from the actual search, not from
an assumed trial count.** An earlier draft of this log illustrated the problem
with a generic 20/100/500-trial table; that has been removed because plugging in
a hypothetical N is exactly the guesswork DSR exists to eliminate.

Every strategy configuration whose Sharpe has been evaluated is recorded in
[`trials.json`](./trials.json). DSR is computed by
[`research/dsr.mjs`](./research/dsr.mjs) from:

- **N** — the actual number of trials in the registry
- **Var(SR)** — the observed dispersion of Sharpe across those trials
- **skew and kurtosis** of the candidate strategy's own return series
- **T** — its number of observations

Registry discipline: a configuration counts as a trial the moment its Sharpe is
computed, whether or not it was ever a serious candidate, and whether or not it
was reported. Adding entries can only lower DSR, which is the point.

Also reported, never a point estimate alone:

- Sharpe with confidence intervals
- **Profit factor excluding the top 5% of winning trades** — PF on fat-tailed 4H
  BTC returns is dominated by a handful of outliers
- Drawdown, Calmar, Ulcer Index, exposure-adjusted return, turnover

Realistic planning number for a live, cost-aware, single-asset BTC trend system:
**0.8–1.0 net Sharpe**, with the value coming from drawdown reduction rather
than return enhancement.

---

## H3 — bar-level incremental ablation

**Script:** [`research/h3-incremental-ablation.mjs`](./research/h3-incremental-ablation.mjs)

**Theory.** Stop classifying rare events. Ask whether each layer improves
risk-adjusted outcomes across all 13,164 bars — 166× the sample.

**Design (pre-registered).** Long/flat, one-bar signal lag, 0.10% round trip.
Confirmed pivots only (published at `p + rightbars`, never backdated). Layers add
exactly one thing each. Derivatives enter as **risk-off vetoes at the spec's own
±1.5 z**, not as direction calls — the only use the evidence supports. Selection
on validation; holdout read once.

| | period |
|---|---|
| Development | 2020-09 → 2023-12 |
| Validation | 2024-01 → 2025-06 (selection happens here) |
| Locked holdout | 2025-07 → 2026-09 (read once) |

**Result: the chain breaks at the first layer.**

Sharpe after costs:

| model | dev | validation | holdout |
|---|---|---|---|
| buy & hold | 0.91 | 1.47 | −0.37 |
| **EMA only** | **1.60** | **1.58** | 0.16 |
| structure only | 0.30 | 0.26 | −0.73 |
| B-Xtrender only | 0.44 | −0.10 | −0.82 |
| A structure+EMA | 0.54 | 0.77 | −0.54 |
| B A+BX | 0.93 | 0.21 | 0.36 |
| C B+OI veto | 0.99 | −0.33 | 0.58 |
| D C+taker veto | 1.09 | −0.17 | 0.74 |
| E D+funding veto | 0.81 | 0.09 | 0.26 |

1. **Market structure is a negative contribution.** Adding it to EMA lowers
   Sharpe in all three periods (1.60→0.54, 1.58→0.77, 0.16→−0.54). It cuts
   exposure from 47% to 18% and the part it cuts is disproportionately the
   profitable part. The original spec makes structure an un-overridable Hard
   Gate; the data says it is the first thing to delete. Tested with the spec's
   own pivot parameters (left 3, right 2). *Re-parameterising it to look better
   would be post-hoc tuning and must be registered as a new hypothesis.*
2. **B-Xtrender is not defensible.** Standalone it is negative on validation
   (−0.10) and holdout (−0.82). Against the plain-MACD robustness arm the sign
   flips every period — dev BX +0.46, validation −0.95, holdout −0.19. A sign
   that flips between periods is noise, exactly as predicted for a deterministic
   function of close.
3. **No derivatives veto earns its place.** C is deleted on validation. E
   disagrees between validation and holdout. D agrees (+0.16 / +0.16) but sits
   on an already-broken chain at **3.7% exposure** — 34 holdout trades, an
   interval too wide to mean anything.
4. **Only the simplest filter shows consistency**, and its value is drawdown, not
   return: holdout buy & hold −24.2% with 53.4% max DD, EMA only +1.4% with
   24.6%.

**Caveat that weakens even that.** Reconciliation showed EMA-only's positive
holdout return is carried entirely by an unclosed position: 22 closed trades sum
to **−13.67%**, the open position marks at **+17.10%**. The realised record over
the holdout is negative.

---

## H4 — derivatives as a risk flag (second moment)

**Script:** [`research/h4-risk-flag.mjs`](./research/h4-risk-flag.mjs)

**Theory.** A feature that cannot predict direction may still earn its place by
flagging entries with fat left tails. This is the only use the evidence review
found even weakly supported: elevated OI is universally read as cascade
potential *in both directions*.

**Design (pre-registered).** Every 6th bar only, so 24h forward windows never
overlap (2,163 independent observations). Outcome is maximum adverse excursion.
**Critically, a benchmark H1–H3 lacked:** every feature is also tested against,
and within buckets of, plain 30-bar trailing volatility. A feature that only
matches `volZ` has produced nothing a standard deviation did not already have.

**Result: all four features rejected.**

| feature | ≥1pp worse MAE | CI excl 0 | direction agrees | n≥100 | survives vol buckets | admit |
|---|---|---|---|---|---|---|
| oiChgZ | no | yes | **no** | no (63) | no | reject |
| oiLvlZ | no | no | yes | yes | no | reject |
| fundingZ | no | no | **no** | yes | no | reject |
| takerZ | no | yes | **no** | yes | no | reject |
| *volZ (benchmark)* | *−0.79%* | *yes* | *no* | *yes* | *—* | *not a candidate* |

The effects are not trivially small — `oiChgZ` high roughly doubles the tail
rate, P(MAE < −5%) of **17.5% vs 9.2%**. But the magnitude (−0.72%) merely
*matches* trailing volatility's −0.79%, the direction reverses in the holdout,
and inside volatility buckets it only works in calm regimes. It is largely
restating "the market is currently volatile", which a 30-bar stdev already says.

Trailing volatility itself also fails the cross-period agreement test. Nothing
here is stable.

---

# Evidence table

| feature | theoretical reason | in-sample | out-of-sample | ablation impact | keep |
|---|---|---|---|---|---|
| EMA regime | trend persistence; the most replicated result in the literature | dev 1.60, val 1.58 Sharpe | holdout 0.16; realised trades −13.7% | best single model; every addition made it worse | **only survivor, and weakly** |
| Market structure | HH/HL defines trend | dev 0.30 | val 0.26, holdout −0.73 | **−1.06 Sharpe** vs EMA alone on dev | delete |
| B-Xtrender | momentum timing | dev 0.44 | val −0.10, holdout −0.82 | sign vs MACD flips every period | delete |
| Aggregate OI (direction) | deleveraging vs distribution | 12/12 cells correct sign | no CI excludes 0 | H1 | inconclusive, not admitted |
| Top-trader positioning | disaggregation is what predicts in COT literature | dev +0.32% | holdout −1.27%, sign reversed | H2, 4/4 criteria failed | delete |
| Taker imbalance | aggressive flow | 48h +2.47% (n=8) | direction reverses in holdout | H2b/H4 | delete |
| OI as risk flag | cascade potential (second moment) | tail rate 17.5% vs 9.2% | direction reverses in holdout | matches, does not beat, 30-bar stdev | delete |
| Funding | crowding | no effect at any horizon | — | H4 | delete |
| USD-notional OI | — | — | — | mechanically price-contaminated, 91% false positives | **invalid** |
| ETF flow | institutional bid | not tested | — | daily, lagged, reflexive (returns→flows t=9.75 > flows→returns t=3.12) | not built |
| SOPR | on-chain profit-taking | not tested | — | identifying assumption acknowledged false; stale 5 of 6 bars | not built |
| Footprint | order flow | not tested | — | Premium-gated; **repainting by design per TradingView** — barred from any historical core | not built |

**Modules admitted: none.** The only configuration with cross-period consistency
is a plain EMA regime filter, and its holdout record is negative once the open
position is excluded.

---

---

# Phase 1 — is the slow-trend drawdown improvement anything beyond holding less?

**Script:** [`research/phase1-exposure-control.mjs`](./research/phase1-exposure-control.mjs)

After H1–H4, the original design was abandoned. The one configuration with any
cross-period consistency was a slow EMA regime filter, which over the holdout
turned buy & hold's −24.2% / 53.4% max drawdown into +3.4% / 24.0%.

That looks like risk management. It might just be deleveraging: the filter sits
out ~55% of the time, and **any** way of holding half as much BTC halves the
drawdown. So the candidate was run against controls holding the same average
exposure with no signal at all.

**Design (pre-registered).** Candidate locked verbatim from H3, not re-tuned.
Controls 2 and 3 are calibrated using the candidate's *realised* average exposure
in the period being measured — a lookahead advantage granted **to the controls**,
biasing against the candidate deliberately.

**Result: FAIL.**

Validation:

| model | Sharpe | Calmar | Ulcer | turnover/yr |
|---|---|---|---|---|
| EMA slow trend (candidate) | 1.06 | 1.04 | 19.8% | 48.7 |
| **BH @ constant 55%** | **1.47** | **2.58** | **6.6%** | **0.4** |
| vol-scaled BH @ matched exposure | 1.23 | 1.50 | 9.9% | 35.6 |

**A constant 55% position, trading essentially never, beat the filter on every
risk metric.** The filter's 48.7 round trips a year cost ~5% annually in fees for
the privilege of being worse.

Development flattered the candidate (Sharpe 1.64 vs 0.92 for buy & hold, Calmar
2.58 vs 0.56) — the textbook shape of in-sample fit that does not survive. On the
holdout the candidate led on Sharpe and Calmar but **trailed on Ulcer Index**
(16.1% vs 12.8%). No comparison held its direction across all three periods.

**The "53% → 24% drawdown improvement" was exposure reduction.** A constant
position reproduces it for free and does it better.

Per the pre-registered protocol, **Phase 2 does not start.**

---

# Deflated Sharpe Ratio — measured, not assumed

**Script:** [`research/dsr.mjs`](./research/dsr.mjs) · registry: [`trials.json`](./trials.json)

Computed from the actual registry rather than a hypothetical trial count.

Candidate on validation: T = 3,282 bars, Sharpe 1.063 annualised, skewness 0.13,
**kurtosis 18.3** (normal = 3).

| N drawn from | N | SR0 (expected max under null) | DSR |
|---|---|---|---|
| configurations evaluated on the selection set | 15 | **1.179** annualised | **0.44** |
| every Sharpe computed in this project | 45 | 1.480 annualised | 0.30 |

**The observed Sharpe sits below the noise floor of a 15-configuration search.**
DSR 0.44 is worse than a coin flip. Even development's flattering 1.644 reaches
only DSR 0.80, short of 0.95.

No hypothetical trial count was needed to reach this. Fifteen honestly recorded
configurations were enough.

---

# Conclusion

**The available data does not support a BTC 4H trading signal, and does not
support a BTC 4H trend risk engine either.**

Across four pre-registered hypotheses, no feature from the original design
survived falsification. The failures were not marginal: market structure was
actively harmful, the derivatives layers reversed sign between validation and
holdout, and the risk-flag interpretation merely reproduced a 30-bar standard
deviation.

This matches the published base rate rather than contradicting it. Anghel (2021,
*Finance Research Letters*) applies White's Reality Check to technical and ML
rules in crypto and finds that after controlling for data snooping *and* market
frictions, significant excess returns are rarely achieved at any sampling
frequency. Falck & Rej find published strategy Sharpes decline ~50% after
publication. A design with eight data sources and six tunable thresholds, tested
on 79 independent pullback episodes, was never going to clear that.

**What cannot be said:** that any of it produces `LONG READY`, or that the EMA
filter manages risk. Phase 1 showed its drawdown reduction is exposure reduction,
reproducible for free by a constant position that trades 100× less.

### The one contaminated observation

`vol-scaled BH @ matched exposure` — a control, never a candidate — was the most
stable thing in the whole study: Sharpe 1.03 / 1.23 / −0.05 across the three
periods, with drawdown well below buy & hold in all of them. It is also the first
item on the intended Phase 3 list.

**Its holdout numbers have now been seen.** Promoting it from control to
candidate on that basis would leave it with no clean holdout, which is precisely
the failure mode this log exists to prevent. It is recorded as a
**contaminated observation, not a result.**

Three honest ways forward, in order of preference:

1. **Take it from the literature instead.** Volatility targeting on BTC is a
   published, independently replicated result. It needs no validation here and
   no indicator built — it is a position-sizing rule, not a signal.
2. **Re-test it on data this project has never touched** — another asset, or BTC
   data after 2026-09. A new hypothesis, a new holdout, a new registry entry.
3. **Accept it with the contamination and the DSR penalty stated on its face.**

What it is *not* is a trend engine. Volatility targeting uses no trend signal at
all, which is itself the finding: across four hypotheses and one phase, the
component with the best risk behaviour was the one that ignores direction
entirely.

Reading this log and then re-tuning a threshold does not revise a hypothesis. It
starts a new one, and it goes in this file with its own entry.
