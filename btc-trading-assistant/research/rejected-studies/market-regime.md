# Market regime — condensed research record

This file replaces two deleted projects, `btc-4h-regime-engine` and
`btc-4h-market-intelligence`. It is the permanent record of what was tested,
what failed, and the small set of descriptive readings that survived. Git
history is the archive for the code; this is the archive for the evidence.

Every number below is taken from the deleted sources. Where two sources disagree
the discrepancy is stated rather than smoothed over.

**Verdict, stated at the top so it cannot be skipped: no validated directional
model. Five pre-registered hypotheses, three candidate Actions and one risk
module were tested; none was admitted. What remains is description.**

---

## 1. Dataset

Built by `btc-4h-regime-engine/data/fetch.mjs` from free Binance sources — no
vendor API keys, no paid feed. About 2,200 daily open-interest files, fetched
once into a ~93 MB local cache that was deliberately never committed.

| series | source | native granularity | coverage |
|---|---|---|---|
| 4H OHLCV (BTCUSDT perpetual, USDⓈ-M) | `fapi/v1/klines` | 4H | 2020-09-01 → present |
| Open interest, coin **and** USD | `data.binance.vision` metrics dump | 5m → 4H | 2020-09-01 → present |
| Top trader long/short — position ratio (`sum_*`) and account ratio (`count_*`) | same dump | 5m → 4H | same |
| Global long/short account ratio | same dump | 5m → 4H | same |
| Taker buy/sell volume ratio | same dump + klines | 5m / 4H | same |
| Funding rate | `fapi/v1/fundingRate` | 8h → 4H | 2019-09-10 → present |

**13,164 4H bars, 2020-09-01 → 2026-09-03. Zero kline gaps. 2 stale OI bars.**
Of those bars, 13,142 carry a valid 4H open-interest observation; the other 22
are skipped, not filled.

The backtest window is capped at 2020-09-01 by the availability of the OI dump,
not by choice. Spot BTCUSDT is carried alongside the perpetual for the
spot/perp comparisons.

**Sampling contract (the no-lookahead guarantee).** Open interest and funding
are taken as the last value at or before **bar close**. Nothing published later
than a bar's close is visible to a decision made at that close.

**Chronological splits**, fixed before any model was fitted:

| split | period | role |
|---|---|---|
| development | 2020-09 → 2023-12 | free experimentation |
| validation | 2024-01 → 2025-06 | all selection happens here |
| holdout | 2025-07 → 2026-09 | locked, read once |

---

## 2. The pre-registered hypotheses

Governing rule throughout: **try to falsify, not to confirm.** A module entered
the indicator only after surviving falsification, out-of-sample testing, and an
ablation showing incremental value over the model without it. Post-hoc
re-tunings after seeing a result: **0**. Modules admitted: **0**.

### Trial counter (as recorded in the deleted RESEARCH-LOG.md)

| | count |
|---|---|
| Hypotheses formally pre-registered and tested | 4 (plus Phase 1) |
| Event definitions used | 1 (unchanged since H1) |
| Drawdown thresholds scanned | 4 (H1 only, pre-specified) |
| Z-score thresholds used | 1 (±1.5, taken from the original spec, never varied) |
| Models compared in the ablation | 10 (declared before running) |
| Holdout reads | 1 |
| Post-hoc re-tunings after seeing a result | **0** |
| Modules admitted to the indicator | **0** |

The low trial count is the only reason a Deflated Sharpe was worth computing
(§5), and it is why the failures are informative rather than the residue of a
wide search.

---

### H1 — aggregate open interest direction during pullbacks

**Claim.** Forced sellers are price-insensitive and exhaust; discretionary
sellers are not. A pullback that liquidates leveraged longs (OI falling) should
therefore resolve differently from one where new positions are being built (OI
rising). This was the load-bearing claim of the whole original design.

**Prior art.** A sweep of SSRN, arXiv q-fin, Glassnode, CryptoQuant, Kaiko,
Amberdata and CoinGlass found **no published test of this claim**. It is
asserted by vendors — Glassnode's LPOC framework contains zero backtesting, its
only number being an anecdote about SOL after FTX — and narrated after the fact,
never scored. Hong & Yogo (2012, *JFE*) do establish OI growth as a return
predictor, but monthly, sector-aggregated, in commodities, and with a
**positive** sign, i.e. the opposite of the crowding intuition. No intraday
analogue exists in any asset class.

**Test design (pre-registered, `research/h1-aggregate-oi.mjs`).**

- *Event*: over a 30-bar (5-day) lookback ending at bar *i*, `peak` is the
  highest high and `peakBar` its index. Bar *i* is an event iff
  `close[i] <= peak × (1 − D)` and no event fired in the preceding 30 bars.
  Spacing 30 > max horizon 24, so forward windows never overlap.
- *Grouping*: `oiChg = (oi[i] − oi[peakBar]) / oi[peakBar]` on **coin-denominated**
  OI. Group A "deleveraging" `oiChg < 0`; group B "leveraging" `oiChg > 0`.
  USD-denominated OI run separately as a contamination control only.
- *Population*: uptrend only — `close[peakBar] > EMA200[peakBar]`. All-pullbacks
  reported as a robustness arm, not as the test.
- *Outcome*: forward return at h = 3, 6, 12, 24 bars (12h/24h/48h/96h).
- *Thresholds scanned*: D ∈ {0.03, 0.05, 0.08, 0.12}, primary D = 0.05.
- *Statistics*: 10,000-sample bootstrap, deterministic seeded PRNG.

**Pass required all four:** n ≥ 30 per group at D = 0.05; mean(A) − mean(B) > 0
at ≥ 2 of 4 horizons; the 95% bootstrap CI of that difference excludes 0 at
those horizons; and the sign stays positive across all four D values.

**Result: FAIL — recorded as inconclusive, not refuted.**

The direction matched the thesis in **12 of 12 cells** with adequate sample
(3%, 5%, 8% drawdown × four horizons). Not one cell reversed. But **no bootstrap
CI excluded zero.** At the primary cell (D = 5%, 24h) the difference was
**+0.81%, CI [−0.42%, +2.09%]**. Reaching significance at the observed effect
size would need roughly 360 events against the ~25/yr available.

**Corrected downward afterwards.** The H2 audit found H1's reported n counted
raw events, 47% of which were continuations of a live drawdown rather than
independent episodes. H1's confidence intervals were therefore **too narrow**;
the true result is weaker than first reported.

---

### H2 — disaggregated derivatives positioning

**Claim.** The published positioning results (CFTC COT, commercial vs
non-commercial) attach to **disaggregation** — knowing *who* holds the position.
Aggregate OI is a scalar that discards exactly that. The Binance metrics dump
supplies the disaggregation free, so this is a motivated hypothesis rather than
a fishing expedition.

**Test design (pre-registered, `research/h2-disaggregated-positioning.mjs`).**

- *Event definition unchanged from H1*, D = 5% only, no new thresholds scanned.
- *Episode*: consecutive events belong to the same drawdown episode if price
  never exceeded the earlier event's peak between them. The **first** event of
  each episode is the independent unit; all statistics are episode-level.
- *Variables*, all measured `peakBar → event bar`: `oiChg` (coin/contract
  denominated — USD notional banned), `ttlsChg` (top-trader long/short
  **position** ratio, `sum_*`; the account ratio `count_*` deliberately not a
  primary variable), `takerImb` (mean taker imbalance over the leg,
  `2 × takerBuy / vol − 1`).
- *Classification*, three-way and sign-based with nothing tunable:
  `HEALTHY` = `oiChg < 0 AND ttlsChg ≥ 0`; `BEARISH` = `oiChg > 0 AND
  ttlsChg < 0`; everything else `UNCLASSIFIED` and excluded rather than forced
  into a binary.
- *Funding deliberately excluded* to preserve attribution.
- *Statistics*: moving-block bootstrap over the time-ordered episode sequence,
  block length L = 5 episodes primary (L = 1 and 3 for sensitivity), 10,000
  resamples, seeded.
- *Splits*: discovery 2020-09 → 2024-08, chronological holdout 2024-09 → present.

**Audit findings, run before the test and the most useful output of H2:**

1. Forward windows do not overlap — minimum event gap 30 bars > maximum horizon 12.
2. Events double-count episodes: **247 raw events collapse to 102 independent
   episodes**; 145 events were continuations of a drawdown already in progress.
   In the uptrend population with complete data: **79 episodes.**

**Result: FAIL on all four substantive criteria.**

| criterion | result |
|---|---|
| 24h difference > +0.50% | FAIL — **−0.46%** (sign reversed on the full sample) |
| block-bootstrap CI excludes 0 | FAIL — [−1.93%, +0.97%] |
| ≥ 30 independent episodes per group | FAIL — 30 healthy / **11** bearish |
| discovery and holdout agree in direction | FAIL — +0.32% vs **−1.27%** |

The holdout bearish group contains **one** episode; any bootstrap interval
printed for it resamples a single observation and is an artifact, not a finding.

**H2b — taker buy/sell imbalance**, tested as a separate split to preserve
attribution: 48h difference **+2.47% with a CI excluding zero**. Recorded as
**inconclusive and not pursued**: n = 8 in one group, 48h is the secondary
horizon, and the split is 8 vs 71 because taker flow is net-sell during nearly
every pullback — the same mechanical lopsidedness that invalidated USD OI (§3).

---

### The structural finding that closed the event-study route

Six years of BTC contain **79 independent uptrend pullback episodes.** Any
two-way split lands around 30/11. With a 24h return standard deviation of
roughly 3–4%, the standard error of a difference at n = 30 vs n = 11 is about
**1.2%**, so detection requires an effect larger than **~2.4%**. Everything
observed across H1 and H2 sits between **0.3% and 1.4%** — two to eight times
too small to ever resolve on this dataset.

No additional feature fixes this; the binding constraint is the episode count,
and pullbacks are rare by definition. The consequence was to stop classifying
rare events and instead ask whether a feature adds incremental information at
bar level across all 13,164 bars — 166× the sample. That is H3.

---

### H3 — bar-level incremental ablation

**Test design (pre-registered, `research/h3-incremental-ablation.mjs`).**
Long/flat, one unit or nothing. Signal computed at bar close, position held from
the next bar (one-bar lag, close-to-close). Costs 0.05% per side, **0.10% round
trip**, charged on every position change. No stops, no targets, no sizing —
those are separate hypotheses and folding them in would destroy attribution.
Pivots publish only at confirmation (`p + rightbars`), never backdated.
Z-scores use a 180-bar (30-day) trailing window, the original spec's own choice.

Layers, each adding exactly one thing to the layer below:

| layer | addition |
|---|---|
| A | bull structure AND `close > EMA200` AND `EMA50 > EMA200` |
| B | A + B-Xtrender: `T3(BX)` rising |
| C | B + open interest veto: `oiZ < +1.5` |
| D | C + taker flow veto: `takerZ > −1.5` |
| E | D + funding veto: `fundingZ < +1.5` |

C/D/E are **risk-off vetoes at the spec's own ±1.5 z, not direction calls** —
the only use of derivatives data the evidence supports. A robustness arm
substitutes a plain MACD histogram for B-Xtrender: B-Xtrender is
`EMA5 − EMA20` (a MACD line) → RSI → T3, a deterministic function of close that
cannot contain information beyond price, so a material difference between the
two is overfit to its 5/20/15+T3 parameterisation rather than a discovery.

*Keep criterion*, decided on validation only: Sharpe improves by ≥ 0.15 over the
layer below, **or** max drawdown improves by ≥ 5pp without Sharpe falling; then
the holdout must agree in direction. A layer failing either is deleted, not kept
for dashboard completeness.

**Result: the chain breaks at the first layer.** Net Sharpe after costs:

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
| B′ A+MACD (robustness) | 0.47 | 1.17 | 0.55 |

1. **Market structure is a negative contribution.** Adding it to EMA lowers
   Sharpe in all three periods (1.60→0.54, 1.58→0.77, 0.16→−0.54). It cuts
   exposure from 47% to 18% and the part it cuts is disproportionately the
   profitable part. The original spec makes structure an un-overridable Hard
   Gate; the data says it is the first thing to delete. Tested with the spec's
   own pivot parameters (left 3, right 2) — re-parameterising it to look better
   would be post-hoc tuning and would require a new registered hypothesis.
2. **B-Xtrender is not defensible.** Standalone it is negative on validation
   (−0.10) and holdout (−0.82). Against the plain-MACD arm the sign flips every
   period: dev BX +0.46, validation −0.95, holdout −0.19. A sign that flips
   between periods is noise, exactly as predicted for a deterministic function
   of close.
3. **No derivatives veto earns its place.** C is deleted on validation. E
   disagrees between validation and holdout. D agrees (+0.16 / +0.16) but sits
   on an already-broken chain at **3.7% exposure** — 34 holdout trades, an
   interval too wide to mean anything.
4. **Only the simplest filter shows consistency**, and its value is drawdown
   rather than return: holdout buy & hold −24.2% with 53.4% max DD, EMA-only
   +1.4% with 24.6%.

**Caveat that weakens even that.** Reconciliation showed EMA-only's positive
holdout return is carried entirely by an unclosed position: 22 closed trades sum
to **−13.67%**, the open position marks at **+17.10%**. The realised record over
the holdout is negative.

---

### H4 — derivatives as a risk flag (second moment)

**Claim.** A feature that cannot predict direction may still earn its place by
flagging entries with fat left tails. This is the only use the evidence review
found even weakly supported: elevated OI is universally read as cascade
potential *in both directions*, and several sources explicitly decline to claim
directional content.

**Test design (pre-registered, `research/h4-risk-flag.mjs`).** Features, all
coin-denominated: `oiChgZ` (z of 4H OI change, 180-bar trailing — the spec's
variable), `oiLvlZ` (z of the OI **level**, declared up front as arguably the
better crowding proxy, not added after a result), `fundingZ`, `takerZ`. Flag at
z > +1.5, or z < −1.5 for `takerZ`; same thresholds as H3, nothing new tuned.

Outcomes over the next 24h (6 bars) from the decision bar's close: MAE
(`min(low)/close − 1`), MFE, forward realised vol, and a tail indicator
`MAE < −5%`.

*Sampling*: consecutive bars' 6-bar forward windows overlap by 5, which would
inflate significance roughly 6×, so the primary analysis uses **every 6th bar
only — 2,163 independent observations**. A full-sample block bootstrap (L = 60
bars) is secondary.

**The benchmark H1–H3 lacked:** `volZ`, the z-score of trailing 30-bar realised
volatility. Every feature is tested against it *and within its buckets*. A
feature that only matches a standard deviation has produced nothing new.

*Admission required all five*: MAE worse in the flagged group by ≥ 1.0
percentage point; 95% bootstrap CI excludes 0; same direction in development,
validation **and** holdout; ≥ 100 non-overlapping flagged observations; and the
effect survives within trailing-volatility buckets.

**Result: all four features rejected.**

| feature | ≥1pp worse MAE | CI excl 0 | direction agrees | n≥100 | survives vol buckets | admit |
|---|---|---|---|---|---|---|
| oiChgZ | no | yes | **no** | no (63) | no | reject |
| oiLvlZ | no | no | yes | yes | no | reject |
| fundingZ | no | no | **no** | yes | no | reject |
| takerZ | no | yes | **no** | yes | no | reject |
| *volZ (benchmark)* | *−0.79%* | *yes* | *no* | *yes* | *—* | *not a candidate* |

The effects are not trivially small: `oiChgZ` high roughly **doubles the tail
rate, P(MAE < −5%) of 17.5% vs 9.2%**. But its magnitude (−0.72%) merely
*matches* trailing volatility's −0.79%, the direction reverses in the holdout,
and inside volatility buckets it only works in calm regimes. It is largely
restating "the market is currently volatile", which a 30-bar standard deviation
already says. Trailing volatility itself also fails the cross-period agreement
test. Nothing here is stable.

---

### P1 — is the drawdown improvement anything beyond holding less?

**Motivation.** After H1–H4 the only configuration with cross-period consistency
was a slow EMA regime filter. That looks like risk management; it might just be
deleveraging, since the filter sits out ~55% of the time and **any** way of
holding half as much BTC halves the drawdown.

**Test design (pre-registered, `research/phase1-exposure-control.mjs`).**
Candidate locked verbatim from H3 and **not re-tuned**:
`close > EMA200 AND EMA50 > EMA200 → weight 1, else 0`.

| arm | definition |
|---|---|
| control 1 | buy & hold, weight 1 always |
| control 2 | BH @ matched exposure — constant weight = candidate's mean weight |
| control 3 | vol-scaled BH @ matched exposure — `w = clamp(s / trailingVol, 0, 1)`, `s` solved so mean weight equals the candidate's |
| control 4 | vol-scaled BH @ 20% target — the literature-standard reference |

Controls 2 and 3 are calibrated using the candidate's **realised** average
exposure over the period being measured. That is a lookahead advantage granted
**to the controls**, biasing the comparison deliberately against the candidate:
a filter that cannot beat a control holding a generous advantage is not worth
building. One-bar lag, 0.10% round trip, fractional weights, vol-scaling charged
in full for its continuous turnover.

*Pass required* beating **both** exposure-matched controls (2 and 3) on **all
three** of Sharpe, Calmar and Ulcer Index on validation, with each direction
agreeing on the holdout. Beating only control 1 is an explicit FAIL, because it
would mean the effect is exposure reduction obtainable without any signal.

**Result: FAIL.** Validation:

| model | Sharpe | Calmar | Ulcer | turnover/yr |
|---|---|---|---|---|
| EMA slow trend (candidate) | 1.06 | 1.04 | 19.8% | 48.7 |
| **BH @ constant 55%** | **1.47** | **2.58** | **6.6%** | **0.4** |
| vol-scaled BH @ matched exposure | 1.23 | 1.50 | 9.9% | 35.6 |

**A constant 55% position, trading essentially never, beat the filter on every
risk metric.** The filter's 48.7 round trips a year cost roughly 5% annually in
fees for the privilege of being worse.

Development flattered the candidate (Sharpe 1.64 vs 0.92 for buy & hold, Calmar
2.58 vs 0.56) — the textbook shape of in-sample fit that does not survive. On
the holdout the candidate led on Sharpe and Calmar but **trailed on Ulcer Index
(16.1% vs 12.8%)**. No comparison held its direction across all three periods.

**The "53% → 24% drawdown improvement" was exposure reduction.** A constant
position reproduces it for free and does it better. Per the pre-registered
protocol, Phase 2 did not start.

*Discrepancy noted, not resolved:* the holdout figure for the surviving filter
appears as **+1.4% / 24.6% max DD** under H3's internal engine (2-bar lag) and
**+3.4% / 24.0%** under `lib.backtest` (1-bar lag). `trials.json` records holdout
max DD of 0.2456 for "EMA only" (H3 engine) and 0.2396 for "EMA slow trend"
(P1 engine). The gap is the engine, not the rule; neither changes the verdict.

*One contaminated observation.* `vol-scaled BH @ matched exposure` — a control,
never a candidate — was the most stable thing in the study: Sharpe 1.03 / 1.23 /
−0.05 across the three periods, with drawdown below buy & hold in all of them.
Its holdout numbers have now been seen, so promoting it to candidate would leave
it with no clean holdout. It is recorded as a **contaminated observation, not a
result**. The honest routes are: take volatility targeting from the literature
(it is a published, independently replicated position-sizing rule needing no
indicator), re-test it on data this work has never touched, or accept it with
the contamination and DSR penalty stated on its face.

---

## 3. The USD-notional open-interest semantic bug

**What it was.** The original spec computed its leverage state from aggregated
**USD-denominated** open interest. `USD OI = coin OI × price`, so USD OI falls
mechanically whenever price falls, with no contract closed. Any z-score built on
it is a lagged price transform wearing a positioning costume.

**How it was found.** H1 ran the USD-denominated series as an explicit
contamination control alongside the coin-denominated primary — the control was
in the pre-registration, not added after a surprising result.

**What it invalidated.** Measured on the same event population, the USD gate
classified **134 of 147 uptrend pullbacks (91%) as "healthy deleveraging"**, and
its sign **reversed at 3 of 4 horizons** relative to the coin-denominated
measure. An indicator built on it would have printed `HEALTHY DELEVERAGING`
almost permanently while looking entirely reasonable on a chart: a plausible
display of a false statement.

**Consequence:** coin- or contract-denominated OI only, everywhere, permanently.
USD notional is banned as a variable in every later script (H2, H3, H4 all state
the ban in their pre-registration).

**The guard that now exists.** `main.pine` refuses a notional feed through
**two independent paths**, either of which is sufficient:

1. **Declared currency.** TradingView declines to specify the denomination of a
   non-aggregated OI symbol — it "may be presented in base currency, quote
   currency, or contracts, depending on the exchange" — so the feed is asked
   directly: `request.security(oiSym, …, [close, syminfo.currency, int(time)])`.
   `syminfo.currency == "NONE"` means the values are not currency amounts, which
   is what a base-unit or contract feed looks like. Anything else is suspect.
2. **Magnitude.** Base-unit BTC open interest is on the order of 1e5; USD
   notional is on the order of 1e10. A feed in the wrong band is rejected.

If either path fires, the positioning readings are **switched off** rather than
shown wrong, and the panel says why: *"Open interest feed looks USD-denominated.
Positioning readings are switched off — point the OI input at a base-unit
symbol."* The test suite asserts both paths reject a notional feed independently
and that a base-unit feed is accepted on every bar.

### The related data-integrity defect on the same measure

`oiChg = oi / oi[1] − 1` originally checked only that the *older* value was
positive, so a zero open-interest tick produced **−100%**, and `nz()` fed it
straight into the 180-bar normalisation window. Twelve bad ticks in the Binance
history contaminated **747 bars (5.8% of the history)**:

| | outside affected windows | inside them |
|---|---|---|
| bars | 12,405 | **747** |
| median rolling sigma — before | 0.0168 | **0.0765 (4.5× inflated)** |
| OI 4H firing at abs(z) ≥ 1 — before | 21.5% | **1.5%** |
| median rolling sigma — after | 0.0168 | 0.0164 (**0.98×**) |
| OI 4H firing at abs(z) ≥ 1 — after | 21.5% | **22.3%** |

Twelve bad ticks suppressed roughly **93%** of the open-interest anomalies that
should have fired over the following 30 days, and nothing on screen said so.
Fixed by requiring both endpoints of a change to be *valid observations*
(present, positive, base-unit, timestamped to this bar rather than carried
forward), removing `nz()` everywhere, and building one filled series per measure
shared by the z-score and the percentile. Afterwards the most extreme value the
normalisation source ever sees is **−34.5%**, a real four-hour move. The broken
v3.0 formula is retained inside the test suite as a control that must keep
showing the damage.

---

## 4. Deflated Sharpe Ratio

The original spec's acceptance bar of "Sharpe ≥ 1.00" was rejected as
non-discriminating: under multiple testing a strategy with zero true edge
produces a best-of-search Sharpe that rises with the number of trials, and a
fixed bar takes no account of how hard the author searched.

Replaced by a **Deflated Sharpe Ratio computed from the actual search**, not
from an assumed trial count (Bailey & López de Prado 2014, *J. Portfolio
Management* 40(5)), implemented in `research/dsr.mjs`:

```
SR0 = sqrt(Var(SR)) × [ (1−γ)·Z⁻¹(1 − 1/N) + γ·Z⁻¹(1 − 1/(N·e)) ]
DSR = Z[ (SR − SR0)·sqrt(T−1) / sqrt(1 − g3·SR + ((g4−1)/4)·SR²) ]
```

with γ = Euler–Mascheroni, `g3`/`g4` the skewness and non-excess kurtosis of the
candidate's own return series, and all Sharpes taken **per bar** so they share
the frequency of T.

**Registry discipline.** Every configuration whose Sharpe was computed is
recorded in `trials.json` — whether or not it was ever a serious candidate, and
whether or not it was reported. Adding entries can only lower DSR, which is the
point. The registry holds **45 entries**: 30 from H3 (10 configurations × 3
splits) and 15 from P1 (5 configurations × 3 splits). Of these, **15 carry
`selectionSet: true`** — the validation-split rows, the only ones on which
selection actually happened.

**Candidate on validation:** T = **3,282** bars, Sharpe **1.063** annualised,
skewness **0.13**, kurtosis **18.3** (normal = 3).

| N drawn from | N | SR0 (expected max under null) | DSR |
|---|---|---|---|
| configurations evaluated on the selection set | **15** | **1.179** annualised | **0.44** |
| every Sharpe computed in the project | 45 | 1.480 annualised | 0.30 |

**The observed Sharpe sits below the noise floor of a 15-configuration search.**
DSR 0.44 is worse than a coin flip. Even development's flattering 1.644 reaches
only DSR 0.80, short of 0.95. No hypothetical trial count was needed to reach
this conclusion; fifteen honestly recorded configurations were enough.

---

## 5. Exposure-matched controls and the three failed Actions

Two separate matched-control exercises were run. P1 (§2) matched on *exposure*;
the Decision Utility Audit matched on *price environment*. Both concluded that
the thing being credited to a signal was already available without it.

### Design of the decision-utility test

**Frozen indicator hash** `35b88632358a1b2506b655c9297b2ea593595c9571bc1623a883c7605826235e`,
window 13,164 bars, 2020-09-01 → 2026-09-03.

- States are read from the **compiled indicator** (`extract-states.mjs` runs the
  frozen `main.pine` and caches its output). Nothing is re-derived in
  JavaScript — a paraphrase is the easiest way to accidentally audit a different
  indicator.
- Consecutive bars in the same condition collapse to one **episode**; the entry
  bar is the single observation.
- Each treated entry is compared only with control bars sharing its price
  environment: **prior-24h-return quintile × realised-vol tercile ×
  distance-from-EMA200 tercile**, plus trend regime where trend is not itself
  the treatment. Effect is the count-weighted mean of within-stratum differences.
- Outcomes are normalised by entry-bar **ATR** so 2020 and 2026 are comparable.
- Treated side bootstrapped at episode level, control side in **4-day blocks**,
  2,000 iterations, seeded.
- **A matching variable must never include the treatment.** `RISK-OFF` *is* the
  bearish trend read, so "bearish but not RISK-OFF" does not exist; matching it
  on trend left all 48 episodes unmatched until trend was dropped from the
  stratum. This was itself a finding.

**Standing limitation, stated in the audit:** this window has been examined
repeatedly across five earlier hypotheses. It can **eliminate** Actions that do
not work; it cannot **establish** that one does.

### The three Actions, all deleted

| State | Action tested | Episodes | Matched-control outcome | Effect (ATR) | 95% CI | dev/val | Keep |
|---|---|---|---|---|---|---|---|
| LEVERAGED RALLY | DO NOT CHASE | **13** | 24h MAE −1.48 vs −1.32 | −0.16 | [−0.83, +0.51] | **opposite** (+0.42 / −0.98) | **DELETE** |
| RISK-OFF / STRONG RISK-OFF | REDUCE EXPOSURE | 48 | 3D MAE −2.01 vs −2.39 | **+0.53** | [−0.20, +1.24] | agree | **DELETE** |
| " | " | 48 | 7D MAE −2.86 vs −3.64 | **+0.87** | [−0.10, +1.74] | agree | **DELETE** |
| plain 200-day MA (baseline) | — | 46 | 3D MAE −2.55 vs −2.38 | −0.22 | [−0.93, +0.47] | agree | reference |
| SPOT-LED vs PERP-LED | spot-led is higher quality | 338 vs 363 | 24h MAE −1.42 vs −1.26 | **−0.32** | **[−0.59, −0.07]** | agree | **DELETE** |
| " | " | " | 48h MAE −1.95 vs −1.75 | **−0.45** | **[−0.82, −0.11]** | agree | **DELETE** |

Acceptance required all six pre-registered criteria. None of the three cleared
criterion 3 (incremental value over the matched control).

**1. DO NOT CHASE.** Six years produced **13 episodes**, median length one bar.
Development and validation disagree in sign on every outcome (24h MAE +0.42 vs
−0.98) and every interval spans zero by a wide margin. What point estimates
exist lean *against* the thesis: compared with matched bullish controls,
LEVERAGED RALLY showed **higher** 24h return (+0.72 vs +0.12 ATR) and **higher**
continuation (61.5% vs 52.5%). At n = 13 that is noise, reported only to make
clear the data supports neither direction. Knowing a rally was derivatives-led
added nothing to knowing price had already risen.

**2. REDUCE EXPOSURE.** Matched on price environment, RISK-OFF episodes
experienced **less** forward drawdown than comparable bars — 3D MAE −2.01 vs
−2.39 (effect **+0.53 ATR**), 7D −2.86 vs −3.64 (**+0.87 ATR**), with
development and validation agreeing on the sign. The threshold required
−0.50 ATR *worse*; the measurement came out positive. The state fires **after**
the fall: relative to bars with the same prior return and volatility, the
remaining downside is smaller, not larger. A plain 200-day moving-average filter
was marginally better at flagging forward downside (−0.22 vs +0.53), though
neither interval excludes zero. There is also a definitional point no amount of
data changes: **RISK-OFF contains no derivatives, flow or on-chain input** — it
is built from trend and volatility, both price-derived, so its incremental value
over a price filter was never a question about alternative data.

**3. SPOT-LED vs PERP-LED.** The only test where a confidence interval excluded
zero, and it points the wrong way:

| | effect | 95% CI | trimmed 5% | dev | val |
|---|---|---|---|---|---|
| 24h MAE | −0.32 | **[−0.59, −0.07]** | −0.08 | −0.33 | −0.36 |
| 48h MAE | −0.45 | **[−0.82, −0.11]** | −0.07 | −0.53 | −0.66 |

Negative means SPOT-LED rallies had *worse* maximum adverse excursion than
PERP-LED ones, matched on price environment — the premise was the opposite.
Removing the extreme 5% at each tail **collapses the effect fourfold**
(−0.32 → −0.08, −0.45 → −0.07): a handful of episodes carries almost all of it,
which is the definition of an effect not to act on. Continuation probability
shows nothing at all (−0.3pp at 24h, −3.8pp at 48h, both intervals spanning
zero). The distinction is not empty, but what it measures is not what the label
implies and its usable magnitude after trimming is about one-tenth of an ATR.

**Outcome.** All three Actions deleted; per the brief, no fourth approach was
attempted. Every state was relabelled `DESCRIPTIVE` and the dashboard prints
`ACTION: CONTEXT ONLY`.

Two observations were recorded and **not** acted on, each requiring its own
pre-registration to pursue: the states **flicker** (median episode length 1–3
bars for most states; `STRONG RISK-ON` splits 1,863 bars into 445 episodes, and
a read that changes every 8 hours is not decision support), and `LEVERAGED
RALLY` **is too narrow to ever be measurable** at 13 episodes in six years,
requiring four simultaneous conditions while the funding adapter is unwired.

**Evidence ladder, for anything that might later earn an Action:**

| Level | Requirement |
|---|---|
| DESCRIPTIVE | data and definition verified correct — where all states sit |
| SUPPORTED | retrospective matched analysis shows incremental value |
| VALIDATED | prospective out-of-sample, on data after the freeze hash, also passes |

Nothing reached SUPPORTED. For these three it is no longer reachable on this
window: they have been tested and failed on it.

---

## 6. The risk-budget validation — six of seven gates, module removed

The one new decision module specified for v3.3: scale a position by
`referenceVol / currentVol` so the same nominal exposure carries roughly the
same market risk in a quiet month and a violent one.

**Frozen specification, written and committed before the first run:**

```
currentVol   = rvol30                      30-bar realised volatility, annualised
                                           (existing, already audited)
referenceVol = median(rvol30, 2190 bars)   2190 bars = 365 days at 4H
riskMult     = clamp(referenceVol / currentVol, 0.25, 1.00)
```

The floor (0.25 = ¼) and the reference window (2190 = one calendar year) were
chosen a priori and are **not swept**. If the rule only works at some other
floor, the rule does not work. The cap of 1.00 means it never leverages up on
low volatility.

**No-lookahead convention:** the multiplier computed at the close of bar *t−1*
is applied to the return realised over bar *t*.

**Arms:**

| arm | exposure |
|---|---|
| A CONSTANT | 1.00 on every bar |
| B SCALED | `riskMult[t−1]` |
| C FLAT-CONTROL | `mean(riskMult)`, constant — **the falsification arm** |

Arm C exists because the primary metric is a **coefficient of variation**, which
is scale-free, so simply taking smaller size must not be able to pass. If B
beats A on CV but C also does, the metric is broken and the result means
nothing. That expectation was part of the pre-registration.

**No return, Sharpe, drawdown-of-equity, hit rate or profit factor appears
anywhere in the file.** Adding one later would not extend the audit; it would
replace it with a weaker one. The regime-engine hypotheses failed precisely
because risk claims kept being validated with return metrics.

**Seven pre-registered adoption gates, all of which had to pass:**

| gate | requirement | result | |
|---|---|---|---|
| G1 | CV of rolling 24H realised vol falls ≥ 10% | **3.2%** | ❌ |
| G2 | CV of rolling 7D realised vol falls ≥ 10% | 15.1% | ✅ |
| G3 | 99th-pct adverse 24H move does not increase | 0.0707 vs 0.0800 | ✅ |
| G4 | worst rolling 7D realised vol falls ≥ 20% | 26.4% | ✅ |
| G5 | average exposure ≥ 0.50 | 0.897 | ✅ |
| G6 | turnover ≤ 0.05 per 4H bar | 0.0087 | ✅ |
| G7 | flat control must FAIL G1 and G2 | control moves 0.0% / −0.0% | ✅ |

G5 exists so that "risk is more stable" cannot be bought by simply not being in
the market. G6 exists because a rule that rebalances violently costs more to run
than the stability is worth. G7 passing confirms the metric measured stability
and not size — the design worked; the rule did not.

**Six of seven. The pre-registration said all seven, so the module is not in
`main.pine`.** The floor was not moved, the window was not changed, and the 10%
was not lowered to 3%. `audit/risk-budget-validation.mjs` was kept as the record
of a negative result and is self-contained — it reads only `rvol30` (an existing
audited measurement the indicator still plots as a test hook) and applies the
frozen rule in JavaScript, so it keeps reproducing this verdict now that the
Pine implementation is deleted.

**One observation recorded and not acted on:** a 6-bar standard deviation (the
24H window, W24 = 6) is a very noisy estimator, and its coefficient of variation
is dominated by sampling error rather than by the volatility regime — a
plausible reason a rule scaled off a 30-bar volatility cannot move it, and
consistent with the 42-bar (7D) measure improving 15.1%. That is a hypothesis
for a separately pre-registered test. It is **not** grounds to overturn this
one, because an argument constructed after seeing which gate failed is exactly
what pre-registration exists to disallow.

*Two source discrepancies, noted:* the script's header comment records G1 at
**3.3%** and the 42-bar improvement at **14.8%**, while `AUDIT.md` records
**3.2%** and **15.1%** — small drift between runs, both far below and above the
10% bar respectively, and neither changes the verdict. The header also says
"ADOPTION GATES — all six must pass" while listing seven; the code
(`g.every(...)`) and `AUDIT.md` both require all seven, and the header wording is
stale.

---

## 7. Smoothing and de-seasonalisation audits

Both are **data-product** audits. No forward return, MAE, MFE, Sharpe or any
market outcome is permitted as an input to either decision — choosing a display
filter by what it would have earned turns a presentation parameter into an
unregistered trading hypothesis.

Both first prove the JavaScript model reproduces the compiled Pine on all 13,164
bars, otherwise their numbers would describe a different state machine.

### 7.1 Hysteresis (the precondition)

| measure | transitions raw → Schmitt | median label run | retention | median delay |
|---|---|---|---|---|
| OI 24H | 2123 → 1879 (−11%) | 2 → **3** | 100% | **0** |
| TREND | 223 → 169 (−24%) | 5 → **9** | 99% | **0** |

The Schmitt trigger loses no crossing and adds no delay, but the enter–exit gap
absorbs only 34–62% of ordinary bar-to-bar movement in the z-score, so four
measures still flickered. The noise is in the **input**, not the trigger — hence
the smoothing audit. Two-bar confirmation reaches similar stability only by
losing 20% of events and delaying every entry by up to eight hours.

### 7.2 Smoothing audit — which measures are REGIME, which stay IMPULSE

**Candidates, exactly four, no search:** none, EMA(2), EMA(3), EMA(4).
**Scope:** OI 4H, OI 24H, PREMIUM, PARTICIPATION. TREND is excluded — after
hysteresis it already runs a median of 9 bars and transitions roughly once every
78 bars, so smoothing would buy latency for nothing.

**Gates, taken from the brief rather than from taste.** Where the brief named a
number it is used; where it did not, the metric is reported and does not gate:

| gate | requirement |
|---|---|
| duration | median **label** run ≥ 3 bars ("median duration ≤ 2 → do not rescue it") |
| delay | median detection delay ≤ 1 bar **and** P90 ≤ 2 bars |
| retention | ≥ 90% at every tier **at or above the measure's own entry threshold** |

Retention is checked at |z| ≥ 1.5 / 2.0 / 2.5. Only tiers at or above a measure's
own entry threshold count — PREMIUM enters at 2.0σ, so scoring it against a 1.5σ
tier would measure the threshold, not the filter. **False-flip rate and peak
attenuation are reported but do not gate**; inventing thresholds for them would
be choosing the answer. Among qualifying candidates the **least** smoothing wins
(Pareto pick), since every extra tap costs latency and peak.

Definitions: *false flip* = an engaged episode lasting a single bar;
*detection delay* = bars between the raw z crossing its enter threshold and the
smoothed state engaging; *retention* = fraction of raw events at a tier for
which the smoothed state engaged at all; *peak attenuation* = median of
`max|smoothed z| / max|raw z|` within each event.

**Verdicts:**

| measure | verdict | why |
|---|---|---|
| **OI 24H** | **REGIME with EMA(2)** | the only candidate clearing every gate |
| **TREND** | **REGIME, no smoothing** | already a 9-bar median run after hysteresis |
| OI 4H | **IMPULSE** | EMA(3) cut 1.5σ retention to **72%** and the peak to **0.51** |
| PREMIUM | **IMPULSE** | EMA(2) lost **46%** of its 2σ events |
| PARTICIPATION | **IMPULSE** | every candidate left a P90 delay of **3–5 bars** |
| SPOT / PERP RVOL | IMPULSE **by analogy** | never separately audited — a stated gap |
| FUNDING, ETF, SOPR | CONTEXT | slow external adapters, unavailable offline |

Product shapes: **REGIME** = persistent state, appears in WHAT CHANGED as a
regime transition. **IMPULSE** = raw value + percentile + raw z shown, one-shot
spike alert, no persistent state, no smoothing at all, not a regime transition.
**CONTEXT** = slow external feeds, shown when available.

### 7.3 OI 4H de-seasonalisation — tested, REJECTED

Different question from smoothing: not "smooth it more" but "normalise it
better". Open interest on a 24/7 venue has a time-of-day shape — Asian-hours and
US-hours bars are not the same population — so a rolling 180-bar z-score pools
them, and an ordinary 04–08 UTC move can score as unusual simply because the
window is dominated by busier slots.

**The effect is real and was measured first:** per-slot standard deviation
varies **1.39×** between the widest and narrowest of the six UTC slots. The
question was worth asking.

**Variants, exactly three, no search:** A = rolling z over 180 bars (what ships);
B30 = same-UTC-slot z over the previous 30 days; B60 = same-slot z over the
previous 60 days. The current bar is never in its own window.

**Ground truth is method-independent on purpose:** a "real extreme" is defined by
the **raw** percentage change `|oiChg4h|` landing in the top 1% / 0.5% / 0.1% of
all bars. Defining it by variant A's own z-score would hand A the win by
construction. *False spike* = a fired bar (|z| ≥ 1.0, the indicator's own entry
threshold) whose raw move is **below the median** |oiChg4h| of the whole sample —
the normaliser manufactured an "unusual" reading out of a smaller-than-typical
move.

| variant | fires | false spikes | retention 1% / 0.5% / 0.1% | med delay | peak \|z\| | flip rate |
|---|---|---|---|---|---|---|
| **A** rolling 180 | 21.2% | **0.1% (2)** | 97% / 98% / 92% | 0 | 5.57 | 29.7% |
| B30 same-slot 30d | 25.2% | 8.6% (283) | 98% / 98% / 92% | 0 | 8.99 | 34.6% |
| B60 same-slot 60d | 23.1% | 5.1% (153) | 98% / 98% / 92% | 0 | 7.61 | 31.7% |

**Adoption rule, fixed in advance — adopt a B variant only if all four hold:**

| gate | B30 | B60 |
|---|---|---|
| false-spike rate ≥ 20% lower (relative) than A | FAIL | FAIL |
| retention no more than 2pp below A at every tier | PASS | PASS |
| median detection delay equal to A's (which is 0) | PASS | PASS |
| impulse frequency within ±25% of A | FAIL | PASS |
| **verdict** | **REJECT** | **REJECT** |

A 30-day same-slot window holds ~30 observations, so its standard deviation is
small and ordinary moves score high: false spikes rise from 2 to 283. The +1pp
retention gain at the 1% tier does not pay for that. **OI 4H keeps the rolling
z-score and stays an IMPULSE.** Nothing was re-tuned after seeing these numbers.

---

## 8. What descriptive semantics remain useful

**This is the section that carries forward into the product.** Everything below
survived correctness auditing and makes no predictive claim. Every reading is
`DESCRIPTIVE`; the panel prints `ACTION: CONTEXT ONLY` and
`DESCRIPTIVE MARKET DATA — NO VALIDATED ENTRY / EXIT SIGNAL`.

### 8.1 The load-bearing rule: three axes, never fused

The defect that made the whole v3 rewrite necessary was fusing direction and
abnormality into one signed state, `sign(z) × |z|`. The direction word then came
out of a z-score, so with a sufficiently negative recent mean **a −1.0%
open-interest change printed as EXPANDING**. That is a false statement about the
data, and no amount of smoothing or hysteresis fixes a wrong word.

Three axes, from three different statistics, in every label:

| role | statistic | vocabulary |
|---|---|---|
| **direction — what happened** | the sign of the **raw** measurement, nothing else | EXPANSION / REDUCTION, POSITIVE / NEGATIVE PREMIUM, LONG / SHORT FUNDING, INFLOW / OUTFLOW |
| **intensity — how far out** | the **σ** ladder with hysteresis, marked `[σ]` | NORMAL / UNUSUAL / EXTREME (funding: NORMAL / ELEVATED / EXTREME) |
| **rarity — how often** | the **percentile**, shown as `99.4p`; also orders the anomaly list | no words of its own |

**Raw value decides direction. Percentile and z decide only rarity and
intensity. Neither ever produces a bullish or bearish word.** A percentile is
computed on the raw value, so on a two-sided measure a *low* percentile is just
as extreme as a high one — `RELATIVE 2.2p` is a strong perp surge — which is why
anomalies are ranked by distance from the 50th percentile, not by height.

Eight invariants are asserted on every bar of the test window:

```
EXPANSION        ⟹  oiChg24h > 0        REDUCTION        ⟹  oiChg24h < 0
INFLOW           ⟹  etf5d    > 0        OUTFLOW          ⟹  etf5d    < 0
LONG FUNDING     ⟹  funding  > 0        SHORT FUNDING    ⟹  funding  < 0
POSITIVE PREMIUM ⟹  premium  > 0        NEGATIVE PREMIUM ⟹  premium  < 0
```

**0 violations across 8,846 signed bar-observations.** Trend and SOPR are
separate cases: their raw value *is* the deviation, so the state sign equals the
raw sign by construction — asserted rather than assumed, 0 disagreements.

**The one deliberate exception is participation.** "Relative surge" is a claim
about deviation from normal, so its word is z-driven and the vocabulary says so:
`RELATIVE SPOT SURGE` / `RELATIVE PERP SURGE` / `NORMAL RELATIVE ACTIVITY`.
`SPOT DOMINANT` and `PERP DOMINANT` were removed from the source and a test
asserts the strings are gone, because "dominant" is a claim about the ratio and
the statistic is a claim about the z-score.

**Cost of a raw-sign direction axis**, measured rather than assumed: the
direction axis has no hysteresis by design, and over 3,184 consecutive engaged
OI 24H bars it flipped **29 times, 0.91%**. Small enough that the label does not
rattle. (§10 of the deleted AUDIT.md quotes this as 1.00%; the measured table in
§1 says 0.91%.)

**Known unresolved inconsistency, documented rather than papered over:** the
intensity word comes from the σ ladder while the displayed abnormality is a
percentile. They are not the same statistic. Measured disagreement over all
13,164 bars and 78,579 readings:

| measure | tiers disagree | rare (top 2.5%) but NORMAL | EXTREME but not rare |
|---|---|---|---|
| OI 24H | 20.8% | 0.01% | 0.18% |
| OI 4H | 12.0% | 0.00% | 0.00% |
| PREMIUM | 34.6% | **2.88%** | 0.00% |
| PARTICIP | 6.6% | 0.02% | 0.00% |
| SPOT RVOL | 27.3% | **2.91%** | 0.00% |
| PERP RVOL | 26.5% | **2.94%** | 0.00% |
| **all** | **21.3%** | **1.46%** | 0.03% |

The case that reads like a bug — `95.0p … NORMAL [σ]` — is 1.46% of readings,
concentrated in the fat-tailed measures. The ladder was kept in σ because the
smoothing and hysteresis audits are expressed in σ and were run against σ
thresholds; moving it to percentiles would invalidate both without being
measured. No forward return was used and no threshold was changed on the
strength of this.

### 8.2 The readings that survive

| reading | what it says | how it is derived | shape |
|---|---|---|---|
| **TREND vs 200D** | where price sits relative to the confirmed daily 200MA, in ATR | Schmitt state on the 200D distance; the 200MA is requested as the **previous completed daily bar** with `lookahead_on`, the documented non-repainting idiom, so it is fixed for the whole following day | REGIME, no smoothing |
| **VOLATILITY percentile** | how current realised volatility ranks against six years | percentile of `rvol30` — rarity only, no direction word | REGIME |
| **MOMENTUM 12W** | is price up or down over twelve weeks | sign of a 12-week price change | context |
| **OI 24H** | did positioning build or unwind over a day, and how unusually | direction from `sign(oiChg24h)`; intensity from the σ ladder, EMA(2) smoothed | REGIME |
| **OI 4H** | did positioning move sharply on **this** bar | raw value + percentile + raw z, unsmoothed, one-shot spike alert | IMPULSE |
| **PREMIUM sign** | is the perp trading above or below spot, and how unusually | direction from `sign(premium)` | IMPULSE |
| **SPOT / PERP relative participation** | is spot or perp unusually active relative to the other | z-driven word, `RELATIVE …` vocabulary only | IMPULSE |
| **SPOT / PERP RVOL** | is volume unusual against the **same UTC slot** on prior days | same-slot comparison | IMPULSE (by analogy) |
| **FUNDING** | are perp longs or shorts paying, and how unusually | direction from `sign(funding)`; unit declared explicitly (decimal / percent / bps) | CONTEXT (adapter) |
| **ETF flow** | recent US spot ETF flow direction and rarity | row named for what it actually sums — see 8.3 | CONTEXT (adapter) |
| **LONG / SHORT LIQ** | unusual burst of forced closing on either side | each ranked against its own history | CONTEXT (adapter) |
| **LIQ BALANCE** | which side is being liquidated more, on −1…+1 | **only computed when both feeds are declared to share a unit** | CONTEXT (adapter) |
| **SOPR** | are coins moving at a profit or a loss versus their last move | daily; its raw value is the deviation | CONTEXT |
| **DATA HEALTH** | can any of this be trusted | two separate vocabularies — see 8.4 | always |

**Market Mechanics** replaced v2's alignment count. v2 printed `STRONGLY
ALIGNED 5/5` when price, OI, funding, premium and perp RVOL all moved the same
way over 24h — a number with no referent, since those are five different
quantities with five different economics and "agreement" between them is not one
thing. v3 shows the one pairing whose joint reading has a definition rather than
a vote: price direction against position direction over the same 24 hours.

```
PRICE UP   + POSITION BUILD          PRICE UP   + POSITION REDUCTION
PRICE DOWN + POSITION BUILD          PRICE DOWN + POSITION REDUCTION
```

All four states occur in the test window and both axes are asserted to carry the
sign of their own raw 24h change. **It is not converted into bullish or
bearish.** It is a description of what price and positioning did, together.

**The Decision view** answers four questions and stops:

| Row | Question | Source |
|---|---|---|
| TREND | what state is the market in | 200D Schmitt state + 12W momentum sign, summed |
| RISK | is volatility higher than usual | the volatility percentile, unchanged |
| POSITIONING | what is open interest doing | the OI 24H ladder, unchanged |
| MAIN THING TO WATCH | the one thing worth looking at | highest attention priority |
| DATA | can I trust any of this | core feed health, adapter count |

TREND is a deterministic translation of two existing price measurements and is
**not a forecast**: above 200D + 12W up → STRONG UP; above + down/flat → UP;
near → MIXED; below + up/flat → DOWN; below + down → STRONG DOWN. POSITIONING
emits `NORMAL`, `UNUSUAL BUILD / REDUCTION` or `EXTREME BUILD / REDUCTION` —
there is deliberately no intermediate "OI BUILDING" tier, because producing one
would require inventing a new threshold on the raw 24H change.

**Nothing normal is printed.** No z-score, no percentile, no sample count, no
per-feed freshness, no research vocabulary in the default view. MAIN THING TO
WATCH picks one line by *attention priority* — a readability ordering, not a
significance claim: core data failure > open interest > funding > premium >
liquidation spike > trend transition > ETF/SOPR > participation/RVOL. A broken
feed outranks every reading, because a number from a feed that is not there is
the worst thing the panel could print.

**Core is four feeds**, all default symbols needing zero configuration: the
reference perpetual, spot, base-unit open interest, and the confirmed daily
200MA. SOPR is deliberately not core — it is a Glassnode symbol not every plan
resolves, nothing in TREND / RISK / POSITIONING reads it, and letting it turn
Core red would report a working indicator as broken.

### 8.3 Semantics that had to be corrected to stay honest

Each of these was a display that looked reasonable and was wrong. None threw an
error; none was visible from the chart.

- **Missing bars must not be re-weighted.** Carry-forward invents no new number
  but weights the previous observation once per missing bar: `[+2%, na, na, −1%]`
  became `[+2%, +2%, +2%, −1%]`, so +2% counted three times in the mean, the
  standard deviation and the rank. Replaced by `validNorm()`, a single-pass
  Welford walk returning z, percentile and sample count from provably the same
  samples; a missing bar contributes nothing and does not occupy a slot. The
  percentile is defined exactly as the share of the *other* valid samples in the
  window that are ≤ the current value, so a unique maximum ranks 100 and a unique
  minimum 0 — asserted as an equality, not a bound. Below 45 valid samples no
  reading is produced.
- **Name the sum after what it sums.** ETF flow is published daily, on US trading
  days only, so sampling t, t−6, t−12, t−18, t−24 is five *calendar* days: a
  forward-filled Friday figure is re-counted on Saturday and Sunday. Three
  declared shapes now, named honestly — `ETF LAST 5 OBS`, `ETF 5 CAL-DAY`,
  `ETF 30-BAR SUM`. The string "ETF 5D" no longer exists in the source. Only the
  first is a true five-observation total, and it requires the source to plot the
  figure on one bar per observation and `na` on every other bar.
- **Dimensionless is not unit-free.** `(L − S) / (L + S)` landing inside [−1, +1]
  is arithmetic, not validation: with a 1,000,000× scale mismatch, 100% of bars
  still land inside the range, pinned at −1, and the row still looks like a
  reading. LIQ BALANCE now requires an explicit "both feeds share one source and
  unit" declaration, defaulting to **off**, and reads `DATA INCOMPARABLE`
  otherwise.
- **Do not call a heuristic a measurement.** Reference, spot, OI, the daily
  200MA and SOPR return their own bar time, so their lag is measured. An
  `input.source()` returns a number and nothing else.
- **Classified is not aggressor.** `request.footprint()` classifies
  lower-timeframe intrabars; it does not report which side removed liquidity.
  The heading is `LIVE FOOTPRINT`, the rows are `Classified buy volume` /
  `Classified sell volume` / `Volume delta`, and the evidence line reads
  `LIVE / DESCRIPTIVE ONLY — CLASSIFIED, NOT AGGRESSOR — REPAINTS BY DESIGN`.
  No user-visible string uses order-flow wording, and a test asserts that.
- **Adapter contracts are explicit inputs, not silent assumptions:** funding unit
  (decimal / percent / basis points, canonicalised to a decimal fraction —
  without it the printed rate can be off by 100× while the scale-free σ and
  percentile look perfect); ETF source shape (daily value repeated within the day
  vs per-bar increment — summing 30 bars otherwise counts every day **six
  times**, verified as exactly 6× in the suite); liquidation pairing (explicit
  declaration, default off).

### 8.4 Data health — two vocabularies, because two things are measured

They deliberately share no word.

**Timestamp-verified feeds** (reference, spot, OI, daily 200MA, SOPR) each
return their own bar time, so lag is measured: `FRESH` / `1 BAR OLD` / `1D OLD` /
`STALE` (readings suppressed) / `UNAVAILABLE`. Exchange feeds on the chart's own
timeframe are FRESH at 0 bars behind, OLD at 1, STALE beyond — two bars of lag is
an outage. The daily 200MA and SOPR are one day behind **by construction**, since
the non-repainting idiom requests the previous completed daily bar, so their
tolerance is ≤ 2 days FRESH, ≤ 3 OLD, > 3 STALE.

**External adapters** get a different vocabulary because only update *activity*
can be observed: `ACTIVE` / `UNCHANGED 1 BAR` / `LIKELY STALE` / `MISCONFIGURED`
/ `UNAVAILABLE`. Readings are suppressed at LIKELY STALE — acting on a possibly
dead feed is worse than losing a possibly live one — but that is stated as a
conservative choice, not a measurement. The heuristic's false positive is
demonstrated rather than hidden: a deliberately constant *live* series is fed in
and asserted to read LIKELY STALE.

Behaviour under stale and missing data, measured:

| scenario | required behaviour | result |
|---|---|---|
| adapter off | UNAVAILABLE, no value, no level, no anomaly | 0 leaks across 4 adapters × 1,500 bars |
| feed absent (SOPR) | same | 0 values, 0 states, 0 anomalies |
| feed freezes mid-run | STALE within 6 bars, readings stop | 0 levels and 0 values after the freeze |
| adapter enabled, still on chart close | MISCONFIGURED, distinct from STALE and UNAVAILABLE | all 1,500 bars, shown as such |
| adapter with < 50 bars of history | indistinguishable from close → MISCONFIGURED | conservative by design |

The `mag()` and `sch()` ladder functions reset to 0 when their input is `na`, so
a feed that goes stale cannot leave its last reading standing as a live anomaly.

### 8.5 What is explicitly not covered

| item | status |
|---|---|
| any predictive claim | **none made, none tested, none supported** |
| missing-value handling | skipped, not interpolated — shrinks the sample rather than the variance |
| funding / liquidation repeats | an `input.source()` is never `na`, so a forward-filled upstream plot weights each observation by the bars it repeats across. No escape through this transport |
| adapter staleness | an update-activity heuristic, not a measurement |
| liquidation pairing | **declared, never verified** — the script can only refuse to compute until you say the units match |
| σ ladder vs percentile display | known inconsistency, documented, not resolved |
| spot / perp RVOL product shape | classified IMPULSE **by analogy**, never separately audited |
| direction-axis hysteresis | none by design; the ~0.91% flip rate is the cost |
| `request.security_lower_tf()`, `input.source()` picker, `request.footprint()` | untestable offline; footprint isolated in `footprint-live.pine` |
| execution time on TradingView | unmeasurable offline — seven 180-iteration window walks per bar, eleven with all adapters on |
| symbol spelling, history depth, layout, alert delivery | TradingView-only manual validation |

**Cohort integrity.** A prospective log belongs to exactly one cohort, identified
by schema version, freeze date, `sha256(main.pine)`, `sha256(all input defaults)`
and an explicitly bumped `THRESHOLD-VERSION`. Same cohort → append; no log →
create; **different cohort → refuse, exit 1, and print which field moved**;
different cohort with `--new-cohort` → create a new file. A pre-v3 file with no
cohort stamp is refused. This is the mechanism by which any future prospective
evidence stays attributable to a specific frozen indicator.

---

## 9. Commit references

All eight are on `main`, all dated 2026-09-06. Verified with
`git log --format='%h %s' -1 <hash>`.

| hash | subject | what it actually contains |
|---|---|---|
| `1b6dd13` | Add the BTC 4H research record: five hypotheses, all falsified | The whole regime-engine research line in one commit — `RESEARCH-LOG.md`, `data/fetch.mjs`, `research/h1`–`h4`, `phase1-exposure-control.mjs`, `dsr.mjs`, `lib.mjs`, `trials.json` (2,528 insertions). Records H1 inconclusive, H2 failing all four criteria, H3's chain breaking at layer one, H4 matching but never beating a 30-bar stdev, P1 losing to a constant position, DSR 0.44 from a 15-configuration registry, and the withdrawal of USD-notional OI. The 93 MB data cache is deliberately not committed. |
| `71bad46` | Add BTC 4H Market Radar — a monitor, not a signal generator | The first indicator: `main.pine`, `README.md`, `tests.mjs`, package files (1,194 insertions). Sorts measurements into REGIME / IMPULSE / CONTEXT by the stability audit rather than by assumption, and introduces the **two independent USD-notional OI guards** (declared `syminfo.currency`, and magnitude ~1e5 base-unit vs ~1e10 notional) plus the zero-OI-tick handling. Ten offline checks against genuine multi-symbol data through a PineTS `BaseProvider`, including a check that the perp premium correlates with realised funding at r = 0.63. |
| `474f8da` | Add the audit framework that deleted the action layer | `audit/AUDIT.md`, `decision-utility.mjs`, `hysteresis-verify.mjs`, `smoothing-audit.mjs`, `extract-states.mjs`, `event-log.mjs` (1,170 insertions). This is the commit that killed all three Actions (§5) and established that a matching variable must never include the treatment. |
| `6611583` | BTC Market Radar v3: fix semantics and add operational intelligence | The semantic rewrite (3,060 insertions, 726 deletions). Splits direction from abnormality so a −1.0% OI change can no longer print as EXPANDING; consolidates to one BTC price source; enforces an exact 4H timeframe; removes stateful `ta.*` calls from ternary branches on nine series; stops a stale feed leaving a live anomaly standing. Adds `oi4h-deseasonalization.mjs`, `cohort.mjs` and `footprint-live.pine`. |
| `ba285f2` | Fix four ways v3.0 could display something plausible and wrong | The zero-OI normalisation contamination (12 ticks, 747 bars, ~93% of OI anomalies suppressed); the LIQ BALANCE "unit-free" claim; adapter freshness given its own vocabulary; footprint terminology corrected from order-flow wording. All four were displays that looked reasonable and were wrong. |
| `3d8737c` | Stop carry-forward re-weighting, name the ETF sum honestly, fix the sigma wording | Replaces carry-forward with `validNorm()`'s single-pass Welford walk so a missing bar contributes nothing; renames the ETF row after what it actually sums; fixes the description that said the percentile decides the state when the σ ladder does. Also fixes a one-line wrapper that silently zeroed every z-score (history indexing on a series parameter does not survive a nested user-function call, so every sample in the window became identical and sd went to zero) — caught by the standardisation check, not by inspection. |
| `e3e816c` | Fix a branch-type mismatch Pine refuses to compile (CE10235) | `array.shift()` returns the element it removed, so the else-branch of `pushEvent()` typed as `series int` while the if-branch was `void`; Pine rejects that pair, and PineTS does no type checking so it had run since v3. Found only by pasting into the Pine Editor. Restructured so every block finishes on a void `array.set()`; output bit-identical (same 770 pushes, 2 suppressions, 3,992 engaged OI 24H bars). A lint was added and verified by reintroducing the defect. |
| `70c96b4` | Rebuild the panel as a Decision view; reject the risk budget | Three display modes (Decision default at 11 rows, Detailed 53, Debug 63) with the presentation-only claim proved by freezing the pre-refactor indicator in `audit/main-v3.2-baseline.pine` and comparing every measured output bar by bar: **all 61 hooks and all 861 alerts identical**, `t_rowsUsed` the only exclusion because the row count is what changed on purpose. Adds `audit/risk-budget-validation.mjs` — the rejected risk budget (§6), kept as the record of a negative result. |

---

## 10. Verdict

**No validated directional model.**

Across four pre-registered hypotheses, one exposure-matched control phase, three
candidate Actions and one risk-budget module, nothing from the original design
survived falsification. The failures were not marginal: market structure was
actively harmful, the derivatives layers reversed sign between validation and
holdout, the risk-flag interpretation merely reproduced a 30-bar standard
deviation, the surviving EMA filter lost to a constant position trading 100×
less, and the one state whose confidence interval excluded zero pointed the
opposite way to its own thesis and collapsed fourfold under trimming.

This matches the published base rate rather than contradicting it. Anghel (2021,
*Finance Research Letters*) applies White's Reality Check to technical and ML
rules in crypto and finds that after controlling for data snooping *and* market
frictions, significant excess returns are rarely achieved at any sampling
frequency. Falck & Rej find published strategy Sharpes decline roughly 50% after
publication. A design with eight data sources and six tunable thresholds, tested
on 79 independent pullback episodes, was never going to clear that.

What survives is a **correct and honest data organiser**: states that are
definitionally sound, non-repainting, and that refuse to speak when a feed is
missing. None of them is entitled to say what will happen next or what to do.

Reading this record and then re-tuning a threshold does not revise a hypothesis.
It starts a new one, and it needs its own pre-registration, its own holdout, and
its own entry in a trial registry.
