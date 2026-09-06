# Research log — Study M1, BTC raw trade microstructure

Pre-registered in [`PRE-REGISTRATION-M1.md`](./PRE-REGISTRATION-M1.md), commit
`1350c08`, before the first estimate existed. Audit:
[`research/AUDIT-M1.md`](./research/AUDIT-M1.md). Tables:
[`research/RESULTS-M1.md`](./research/RESULTS-M1.md). Registry:
[`trials.json`](./trials.json).

Everything before the cutoff is **RETROSPECTIVE — NEW DATA DOMAIN**. The data domain
is new to this repository; the history is not new to the market.

---

## Verdict

**M1 REJECTED. H1 failed all seven information gates, H2 failed five of seven. No
strategy was built, and §7 (economics) and §8 (minimal implementation) of the
pre-registration were never reached.**

The question M1 was asked to answer has an answer, and it is more interesting than a
flat no: **there is a small, stable directional signature in aggressive trade flow,
it points the opposite way from H1, and it is roughly twenty times too small to
trade.**

---

## 1. Data integrity

34 stratified futures days and 7 spot days of raw aggTrades — 53.2 million and 9.0
million trades — were streamed out of the Binance public archives and aggregated to
5-minute signed flow. Full detail in [`research/AUDIT-M1.md`](./research/AUDIT-M1.md).

Clean: 0 duplicate aggTrade ids, 0 out-of-order timestamps, 0 trades outside their
archive's UTC day, 0 unparseable maker flags, archive day boundaries chain exactly by
trade id (2022-12-31 → 2023-01-01 and 2023-03-31 → 2023-04-01), and the futures 5m
kline grid has no gaps in 702,720 bars.

Three things were found and each is resolved rather than waved through:

1. **The raw archive starts a few hundred milliseconds into each UTC day**, so the
   00:00 bar of an archive is short. The kline is complete there.
2. **2021-05-19 13:15 UTC: the archive is missing 557,026 aggTrade ids** — the single
   id gap in the entire sample, during the May 2021 crash. The archive holds $11.5M
   for that bar against the kline's $141.8M over 211,056 trades. The archive is the
   defective source, not the kline. This gap is also the whole explanation for the
   "24-minute interval with no trade" that the raw scan reports.
3. **Millisecond boundary attribution**: a small minority of bars disagree because a
   burst of trades sits within a millisecond or two of a 5m boundary; the differences
   offset exactly between adjacent bars. Bounded, not corrected — p99 |ΔAFI| is
   1.7e-3, under 1% of one AFI standard deviation.

**The declared deviation.** Seven years of BTCUSDT futures aggTrades is roughly 80 GB.
Full-sample features are therefore computed from the 5m klines' taker-buy split, which
is the exchange's own aggregation of the same trade stream. That substitution is
licensed by measurement, not by convenience: over 9,788 reconciled bars the median
relative error between the raw aggregation and the kline split is **4e-16**, and the
same comparison with the maker side flipped has median error **0.15** — so
`is_buyer_maker = false → aggressive buy` is verified against its own negation, not
assumed. Points 1 and 2 above mean the kline is the *more* complete of the two
sources, not a degraded stand-in. The licence covers aggregate signed notional per 5m
bar and nothing else; trade size distribution, sweep size and sub-5-minute timing all
still require raw trades.

---

## 2. H1 — aggressor flow continuation

**Hypothesis: higher AFI predicts a higher next-15-minute return. Rejected on all
seven gates.**

`fwd(15m) ~ AFI + ret5m + rv5m + log(notional) + minute-of-day fixed effects`,
Newey–West lag 12, on every usable 5m bar.

| split | n | β | HAC t | within R² |
|---|---|---|---|---|
| development 2020–2022 | 315,613 | −1.08e-4 | −1.22 | 0.092% |
| validation 2023–2024 | 210,523 | +2.99e-5 | 0.54 | 0.086% |
| locked test 2025–2026 | 176,538 | +4.96e-6 | 0.10 | 0.068% |
| validation ∪ test | 387,061 | +1.68e-5 | **0.46** | 0.077% |

Spearman rank IC of AFI against the forward return: **−0.030**.

| gate | result |
|---|---|
| I1 same sign in all three splits | FAIL (− + +) |
| I2 \|t\| ≥ 2 on validation and on test | FAIL (0.54, 0.10) |
| I3 \|t\| > 3.53 (121 effective trials) | FAIL (0.46) |
| I4 sign in ≥ 5 of 7 years, survives dropping the best year | FAIL (t 0.09 without 2023) |
| I5 decile monotonicity ≥ 0.7 with the hypothesised sign | FAIL (−0.89 — strong, wrong sign) |
| I6 survives removing the 5% largest \|forward return\| | FAIL (β −4.4e-5, t −3.54) |
| I7 spot β has the same sign | FAIL (−3.8e-5) |

### The interesting part: the sign is backwards, and that is stable

The AFI deciles on validation ∪ test are close to monotone in the **opposite**
direction to the hypothesis:

| decile 1 (heaviest aggressive selling) | … | decile 10 (heaviest aggressive buying) |
|---|---|---|
| **+0.449 bp** (t 4.73) | falls through zero around decile 6 | **−0.271 bp** (t −2.80) |

Monotonicity −0.891. Long and short sides separately: AFI > 0 gives β −2.2e-5
(t −0.47), AFI < 0 gives β +8.0e-5 (t 1.28) — both leaning the same reversal way. Spot
agrees, and gets stronger with horizon (15m t −1.84, 30m t −3.19).

Post-hoc, after the gates were closed, the pattern holds in all three splits
(monotonicity −0.976 / −0.879 / −0.673; top-minus-bottom −1.77 / −0.65 / −0.80 bp),
weakening after 2022 but not vanishing. This looks like a real, persistent
microstructure fact: aggressive flow at 5-minute scale is, on average, slightly
*paying* for immediacy rather than predicting the next 15 minutes.

**It does not rescue H1 and it is not acted on.** §3 of the pre-registration says so
explicitly: H1 as written is directional, a reliable negative coefficient is a
different hypothesis, and it would need its own pre-registration. The linear
coefficient itself is nowhere near significant (t 0.46) and flips sign across splits;
what is stable is the tail-decile pattern, which is a different object from the
coefficient that was registered.

Whether that different hypothesis is worth registering is settled in §5 below, and the
answer is no.

---

## 3. H2 — absorption / price response

**Hypothesis: aggressive flow that fails to move price carries different information
from flow that does. Rejected — fails I2, I3, I4, I5, I6.**

Coefficient on `AFI × ret5m`:

| split | n | β | HAC t |
|---|---|---|---|
| development | 315,613 | +2.20e-2 | 0.38 |
| validation | 210,523 | +1.32e-1 | 1.40 |
| locked test | 176,538 | +3.05e-2 | 0.78 |
| validation ∪ test | 387,061 | +8.95e-2 | **1.57** |

The sign is at least consistent (I1 and I7 pass), but it never reaches significance,
never survives the extreme-observation trim (t 0.95), and the decile monotonicity of
the interaction is 0.47 against a 0.7 requirement. Its year-by-year t-stats are −1.02,
1.86, −0.75, 1.13, 1.24, 1.21, −0.47.

The four pre-registered cells say the same thing more directly:

| cell | n | mean 15m forward return | HAC t |
|---|---|---|---|
| absorbed buying (top AFI decile, price flat or down) | 3,165 | −0.301 bp | −0.95 |
| aligned buying (top AFI decile, price up) | 49,893 | −0.269 bp | −2.70 |
| absorbed selling (bottom AFI decile, price flat or up) | 3,828 | +0.495 bp | 1.80 |
| aligned selling (bottom AFI decile, price down) | 51,825 | +0.446 bp | 4.53 |

Absorbed and aligned are indistinguishable — 0.03 bp and 0.05 bp apart on cells whose
own standard errors are an order of magnitude larger. **Whatever small information is
in trade flow is in the flow imbalance itself, not in whether price responded to it.**
The absorption story, as specified, adds nothing.

---

## 4. Trials

| | count |
|---|---|
| raw registry entries (configuration × split) | 36 |
| configurations | 12 |
| mean \|ρ\| between configurations' daily score series | 0.34 |
| eigenvalue estimate (Li & Ji) | 6.0 |
| clusters at \|ρ\| ≥ 0.5 | 2 |
| **effective independent trials (M1)** | **6.0** |

Twelve configurations collapse to six because two hypotheses × three horizons on two
venues are mostly the same measurement repeated. Cumulative across every study in this
repository: **885 raw entries / 303 configurations / 121 effective trials**, giving
the two-sided threshold |t| > 3.53 used by gate I3.

| study | raw entries | configurations | effective |
|---|---|---|---|
| TP1 (4H) | 288 | 96 | 21 |
| Regime engine | 45 | 15 | 15 (upper bound) |
| IT1 (15m) | 432 | 144 | 55 |
| IT2 (replication) | 12 | 12 | 9 |
| IT3 (1H) | 72 | 24 | 12 |
| **M1 (microstructure)** | **36** | **12** | **6** |
| **cumulative** | **885** | **303** | **121** |

The effective column sums to 118, not 121. The difference is real and worth naming:
each study rounds its own running cumulative up to a whole trial before carrying it
forward, and six studies of rounding have accumulated three trials of slack. The
carried figure is the conservative one and is the one gate I3 uses; on 118 the
threshold would be 3.52 instead of 3.53, which changes nothing here.

---

## 5. Economics — why the reversal is not worth a second study

§7 of the pre-registration was **not reached**, because §6 failed. The figures below
were computed anyway so that the question "how large was the edge, before and after
cost" is on the record. They change no verdict; they close a door.

The most favourable simple reading of the whole study — trade the top and bottom
development AFI deciles, fill at the next bar's open, exit three bars later, no stop,
no target — earns, on validation ∪ test over 108,710 signals:

| | value |
|---|---|
| gross per signal, following the flow | **−0.362 bp** (HAC t −5.74) |
| gross per signal, fading the flow | **+0.362 bp** |
| mean absolute 15m move on those bars | 12.8 bp |
| round trip cost, base (0.14%) | 14 bp |
| **COST / EXPECTED EDGE** | **38.7×** at 0.14%, 55.2× at 0.20%, 82.8× at 0.30% |
| **COST / EXPECTED MOVE** | **1.09** at 0.14% |

Net per signal at 0.14% is −14.4 bp; at 0.20%, −20.4 bp; at 0.30%, −30.4 bp. Profit
factor 0.14 / 0.07 / 0.03.

Two numbers matter here. The first is 38.7: the reversal is real and stable, and a
round trip costs thirty-nine times what it is worth. The second is **1.09** — at 5m
resolution the cost of getting in and out is larger than the entire average
15-minute move, signal or no signal. That is not a statement about this signal; it is
a statement about the horizon. Nothing found at this frequency can be traded at these
costs, and no exit rule, filter or sizing scheme changes an edge that is one
thirty-ninth of the toll.

This is the same wall IT1 hit (cost 0.1–0.5 R on tight stops) and IT2 hit (cost/edge
14.0), reached from a completely different data domain. It is now measured three ways.

---

## 6. Consequences

- **M1 is REJECTED. No strategy, no signal engine, no Pine `strategy()`.** Neither
  hypothesis passed, so §8's minimal implementation was never eligible to run.
- **The reversal finding is recorded, not pursued.** It would need its own
  pre-registration, and §5 shows what that study would conclude before it started:
  a 0.36 bp edge against a 14 bp round trip.
- **Prospective capture has started**, per §5 of the pre-registration.
  `data/prospective.mjs` appends closed 5m bars after the cutoff into a separate file
  and stamps every append with wall-clock time. First append 2026-09-06T07:50Z, 94
  bars. Honest reading of that first append: the freeze commit landed at 07:44 UTC, so
  the bars before 07:45 are **backfill of the same day**, not live capture; genuinely
  prospective bars begin with the second append. The append log is what makes that
  distinguishable, which is the whole point of keeping it.
- **Next direction is M2**, fixed in §10 of the pre-registration before M1's outcome
  was known: prospective order-book microstructure. M1's result sharpens what M2 has
  to clear rather than changing what M2 is. If aggregate signed flow is worth 0.4 bp
  over 15 minutes, then depth imbalance, microprice and queue dynamics have to be
  worth more than **14 bp per round trip** to matter at all — and the only honest
  place to find that is at a horizon and a fee tier where the toll is not larger than
  the move. M2's pre-registration must state its target horizon and its assumed fee
  tier *first*, and reject itself if the arithmetic in §5 above cannot be beaten.
- What ships is unchanged: Trade Risk Planner (sizing, no signals), session levels,
  frozen Market Radar. None of them claims direction, and after six studies none of
  them is going to.
