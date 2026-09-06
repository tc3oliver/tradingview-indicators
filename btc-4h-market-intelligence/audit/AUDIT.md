# Audits

- [V3 data-product audit](#v3-data-product-audit) — the current version
- [Decision utility audit (v1)](#decision-utility-audit--market-intelligence-v1) — what deleted the action layer

---

# V3 DATA-PRODUCT AUDIT

**Indicator** `main.pine`, threshold version `v3.2`
**Window** 13,164 bars, 2020-09-01 → 2026-09-03
**Reproduce**

```bash
npm test                                # 32 offline checks
node audit/extract-states.mjs           # run the frozen indicator over the full window
node audit/hysteresis-verify.mjs
node audit/smoothing-audit.mjs
node audit/oi4h-deseasonalization.mjs
node audit/risk-budget-validation.mjs   # REJECTED — kept as the record
node audit/event-log.mjs
```

> This audit covers **data-product correctness only**: does the indicator say
> true things about the data. It establishes nothing about predictive value, and
> no test in it computes a forward return. The evidence level of every state is
> still DESCRIPTIVE.

## 0. v3.3 — a presentation rewrite, and a feature that failed its own gates

### 0.0.0 The panel was correct and unreadable

Three rounds of correctness work produced a dashboard of up to 55 rows in which
every number was true and almost none of it was legible without knowing what a
σ ladder is. `OI 24H  -1.25% | 22.3p | -0.66σ | UNUSUAL REDUCTION [σ]` is five
statements in one cell, four of which are for the author of the indicator.

The fix is a **Decision** view: ten to fourteen rows, plain English, and nothing
printed about anything behaving normally. The old panel survives as *Detailed*,
and the internals it hid are now explicit in *Debug*.

The risk this creates is obvious and is the reason check 27 exists. A display
rewrite touching a file where display code and measurement code share scope can
silently move a number. So the pre-refactor indicator is frozen in
`audit/main-v3.2-baseline.pine` (sha256 `0919af37…`) and every measured output
is compared against it bar by bar, in both adapter configurations, together with
the whole alert stream. All 61 hooks and all 861 alerts are identical. The one
excluded hook is `t_rowsUsed`, which is the thing that was changed on purpose.

Check 28 asserts the same claim from the other direction: the three modes
produce identical numbers and differ only in panel height (11 / 53 / 63 rows).

### 0.0.0b A risk budget was specified, built, and rejected

The one new decision module in the brief: scale a position by
`referenceVol / currentVol` so the same nominal exposure carries roughly the
same market risk in a quiet month and a violent one. Frozen specification,
written before the first run:

```
currentVol   = rvol30                      (existing, already audited)
referenceVol = median(rvol30, 2190 bars)   (365 days at 4H)
riskMult     = clamp(referenceVol / currentVol, 0.25, 1.00)
```

Seven adoption gates, also fixed before the first run, and no return, Sharpe or
profit metric anywhere in the file. Arms: constant full exposure, the scaled
rule, and a **flat control** at the scaled rule's average exposure — the last
one present because the primary metric is a coefficient of variation, which is
scale-free, so simply taking smaller size must not be able to pass.

| gate | requirement | result | |
|---|---|---|---|
| G1 | CV of rolling 24H realised vol falls ≥ 10% | **3.2%** | ❌ |
| G2 | CV of rolling 7D realised vol falls ≥ 10% | 15.1% | ✅ |
| G3 | 99th-pct adverse 24H move does not increase | 0.0707 vs 0.0800 | ✅ |
| G4 | worst rolling 7D realised vol falls ≥ 20% | 26.4% | ✅ |
| G5 | average exposure ≥ 0.50 | 0.897 | ✅ |
| G6 | turnover ≤ 0.05 per 4H bar | 0.0087 | ✅ |
| G7 | flat control must FAIL G1 and G2 | control moves 0.0% / −0.0% | ✅ |

Six of seven. The pre-registration said all seven, so **the module is not in
`main.pine`**. The floor was not moved, the window was not changed, and the 10%
was not lowered to 3%.

One observation is recorded and was not acted on: a 6-bar standard deviation is
a very noisy estimator, and its coefficient of variation is dominated by
sampling error rather than by the volatility regime — which is a plausible
reason a rule scaled off a 30-bar volatility cannot move it, and is consistent
with the 42-bar measure improving 15.1%. That is a hypothesis for a separately
pre-registered test. It is not grounds to overturn this one, because an argument
constructed after seeing which gate failed is the exact thing pre-registration
exists to disallow.

`audit/risk-budget-validation.mjs` is self-contained — it reads only `rvol30`
and applies the frozen rule in JavaScript — so it keeps reproducing this verdict
now that the Pine implementation is gone.

## 0. v3.2 — three statistical/semantic defects found in review of v3.1

### 0.0.1 Carry-forward re-weighted the previous observation

v3.1 replaced `nz()` with carry-forward and described it as inventing nothing.
That was half true and the wrong half. It invents no NEW number, but it is not
neutral: it weights the previous observation once per missing bar.
`[+2%, na, na, -1%]` became `[+2%, +2%, +2%, -1%]`, so +2% counted three times
in the mean, the standard deviation and the rank.

**Fix.** A missing bar contributes nothing at all — not zero, not a repeat, and
it does not occupy a slot. The statistics are no longer left to `ta.sma()` /
`ta.stdev()` either: the Pine docs describe na-skipping for `ta.sma()` and say
nothing about `ta.stdev()`, and pairing a skipping function with a
non-skipping one would compute the mean and the deviation over two different
sample sets and return a z-score that is subtly wrong rather than na.
`validNorm()` walks the window in one pass with Welford's method and returns z,
percentile and sample count from provably the same samples. The percentile is
defined exactly — the share of the OTHER valid samples in the window that are
<= the current value — so a unique maximum ranks 100 and a unique minimum 0,
asserted as an equality rather than a bound.

Fixture (check 5), lifted verbatim out of `main.pine`: on `[+2%, na, na, -1%]`
the window must report **n = 10 not 20, mean 0.005 not 0.0125, z exactly 1.0**.

Applied to open interest, premium, participation, both RVOLs and SOPR. SOPR uses
its own daily bar time, so a new observation is identified exactly rather than
guessed from a value change. It is NOT available to the funding and liquidation
adapters — an `input.source()` is never na — and that limit is now stated
instead of glossed.

**Side effects, recorded, no threshold touched.** OI 24H engaged bars
3,963 -> 3,992, OI 4H 2,789 -> 2,792, WHAT CHANGED 15.3% -> 15.4%. Full-history
zero-OI windows: sd 0.99x of the rest, firing 21.3% vs 21.5%. 13,142 of 13,164
bars carry a valid 4H OI observation; the other 22 are skipped, not filled.

### 0.0.2 "ETF 5D" was a claim the arithmetic could not support

ETF flow is published daily, on US trading days only. Sampling t, t-6, t-12,
t-18, t-24 is five CALENDAR days: a forward-filled Friday figure is re-counted
on Saturday and Sunday.

**Fix.** Three declared shapes, and the row is named after what it actually
sums — `ETF LAST 5 OBS`, `ETF 5 CAL-DAY`, `ETF 30-BAR SUM`. The string "ETF 5D"
no longer exists in the source. Only the first is a true five-observation total
and it requires a contract: the source plots the figure on ONE bar per
observation and na on every other bar, weekends and holidays included. Under it,
two consecutive sessions reporting the SAME value still count twice, because the
gate is the na and not the value.

**Technical limitation, stated rather than worked around.** Without the na gate
a single `input.source()` cannot distinguish a new observation from a repeated
one. Two identical consecutive trading days look exactly like one carried
forward. That is why the other two modes are not called a five-trading-day flow.

Fixtures (check 25): Fri -> Sat -> Sun -> Mon, a US holiday, and two consecutive
sessions with an identical flow value.

### 0.0.3 The percentile was described as deciding the state

It never did — the sigma ladder does, and that is what the smoothing and
hysteresis audits measured. Three roles are now fixed and labelled: RAW gives
direction, SIGMA gives intensity through the ladder and is marked `[σ]` on the
dashboard, PERCENTILE gives historical rarity and orders the anomaly list.

**Measured disagreement, full 13,164 bars, 78,579 readings:**

| measure | tiers disagree | rare (top 2.5%) but NORMAL | EXTREME but not rare |
|---|---|---|---|
| OI 24H | 20.8% | 0.01% | 0.18% |
| OI 4H | 12.0% | 0.00% | 0.00% |
| PREMIUM | 34.6% | **2.88%** | 0.00% |
| PARTICIP | 6.6% | 0.02% | 0.00% |
| SPOT RVOL | 27.3% | **2.91%** | 0.00% |
| PERP RVOL | 26.5% | **2.94%** | 0.00% |
| **all** | **21.3%** | **1.46%** | 0.03% |

The case that reads like a bug — `95.0p ... NORMAL [σ]` — is 1.46% of readings,
concentrated in the fat-tailed measures. No forward return was used and no
threshold was changed on the strength of this.

### 0.0.4 A branch-type mismatch Pine refuses to compile

`array.shift()` returns the element it removed, so the else-branch of
`pushEvent()` typed as `series int` while the if-branch was `void`. Pine rejects
that pair (CE10235); PineTS does no type checking and had run it since v3.
Found by pasting into the Pine Editor, which is the only place it could be
found. Restructured so every block finishes on a void `array.set()`; output is
bit-identical (same 770 pushes, 2 suppressions, 3,992 engaged OI 24H bars).

Check 0 now lints both .pine files for the pattern and was verified by
reintroducing the defect, which it caught at the exact line. A lint is not a
compiler: A1 stays the only real proof the script compiles.

### 0.0.5 A one-line wrapper that silently zeroed every z-score

`validNorm(src, len, minN) => validNormAt(src, src, len, minN)` looked tidy and
was broken: history indexing on a series parameter does not survive a nested
user-function call, so `src[i]` collapsed to `src[0]`, every sample in the
window became identical, sd went to zero and every z-score read 0.00. Caught by
the standardisation check, not by inspection. Every call site now calls the
function directly.

---

## 0. v3.1 — four defects found in review of v3.0

All four had the same shape: **a display that looked reasonable and was wrong.**
None of them threw an error, and none of them was visible from the chart.

### 0.1 Zero-OI observations contaminated the normalisation window

`oiChg = oi / oi[1] - 1` only checked that the *older* value was positive, so a
zero open-interest tick produced **-100%**, and `nz()` fed it straight into a
180-bar window. The result was not noise. It was silence:

| full 13,164-bar history | outside the affected windows | inside them |
|---|---|---|
| bars | 12,405 | **747 (5.8% of the history)** |
| median rolling sigma — v3.0 | 0.0168 | **0.0765 — 4.5x inflated** |
| OI 4H firing at abs(z) >= 1 — v3.0 | 21.5% | **1.5%** |
| median rolling sigma — **v3.1** | 0.0168 | 0.0164 — **0.98x** |
| OI 4H firing at abs(z) >= 1 — **v3.1** | 21.5% | **22.3%** |

Twelve bad ticks in the Binance history suppressed roughly 93% of the
open-interest anomalies that should have fired over the following 30 days, and
nothing on screen said so.

**Fix.** Three changes: both endpoints of a change must be *valid observations*
(present, positive, base-unit, and timestamped to this bar rather than carried
forward); `nz()` is gone everywhere, replaced by carry-forward of the last
observed value, which invents nothing; and one filled series per measure is
built once and shared by the z-score and the percentile.

**After.** The contaminated windows are statistically indistinguishable from the
rest of the history, and the most extreme value the normalisation source ever
sees is **-34.5%** — a real four-hour move — instead of -100%. The v3.0 formula
is retained inside the test suite as a control and must keep showing the damage,
or check 21 has gone blind.

Side effect, recorded: with the variance no longer inflated, OI anomalies fire
more often across the whole history. OI 24H engaged bars 3,750 -> 3,963, OI 4H
2,627 -> 2,789, WHAT CHANGED 14.6% -> 15.3% of bars. No threshold was touched.

### 0.2 LIQ BALANCE claimed to be unit-free

The v3.0 comment read "unit-free so the two adapters need not share a scale".
That is false. `(L - S) / (L + S)` is *dimensionless*, which is not the same
thing — the subtraction is only meaningful between comparable quantities.
Landing inside [-1, +1] is arithmetic, not validation.

Demonstrated in check 22: with a 1,000,000x scale mismatch and pairing wrongly
declared, **100% of bars still land inside [-1, +1]**, pinned at -1, and the row
still looks like a reading.

**Fix.** An explicit "both feeds share one source and unit" declaration,
defaulting to **off**. Without it the balance, its percentile and its sigma are
all withheld and the row reads `DATA INCOMPARABLE`. The individual LONG LIQ and
SHORT LIQ rows are unaffected — each is ranked against its own history, which
needs no shared unit.

### 0.3 Adapter "freshness" was a heuristic wearing measured-freshness words

Reference, spot, OI and SOPR return their own bar time, so their lag is
measured. An `input.source()` returns a number and nothing else. v3.0 gave both
the same vocabulary, so `FRESH` on a funding adapter was a claim the script
could not support.

**Fix.** Two vocabularies that do not share a word. Timestamp-verified feeds keep
FRESH / 1 BAR OLD / 1D OLD / STALE. Adapters get **ACTIVE / UNCHANGED 1 BAR /
LIKELY STALE / MISCONFIGURED / UNAVAILABLE**, and DATA HEALTH is split into two
labelled blocks. Readings are still suppressed at LIKELY STALE — acting on a
possibly-dead feed is worse than losing a possibly-live one — but that is stated
as a conservative choice, not a measurement.

The heuristic's false positive is **demonstrated rather than hidden**: check 23
feeds in a deliberately constant *live* series and asserts it reads LIKELY
STALE.

### 0.4 Footprint terminology implied an aggressor tape

`request.footprint()` classifies lower-timeframe intrabars. It does not report
which side of a trade removed liquidity. The heading `LIVE ORDER FLOW` implied
otherwise.

**Fix.** `LIVE FOOTPRINT`, `Classified buy volume`, `Classified sell volume`,
`Volume delta`, and an evidence line reading `LIVE / DESCRIPTIVE ONLY —
CLASSIFIED, NOT AGGRESSOR — REPAINTS BY DESIGN`. No user-visible string in the
file uses order-flow wording, and a test asserts that.

### 0.5 Adapter contracts formalised

An `input.source()` carries no unit and no statement of what one observation
represents, so both were made explicit inputs rather than silent assumptions:

| assumption | now | failure it prevents |
|---|---|---|
| funding unit | decimal / percent / basis points, canonicalised to a decimal fraction | the printed rate off by 100x while sigma and percentile — which are scale-free — look perfect |
| ETF source shape | daily value repeated within the day, or per-bar increment | summing 30 bars counts every day **six times**. Verified exactly 6x in check 24 |
| liquidation pairing | explicit declaration, default off | see 0.2 |

### 0.6 A test was matching the wrong rows

The dashboard section-order check searched for the bare word `FLOW`, which also
appears in an anomaly line reading `ETF 5D UNUSUAL INFLOW`. It was matching an
anomaly row and calling it the FLOW header. Now it matches full section headers.
Recorded because a test that passes for the wrong reason is worse than no test.

---

## 1. Semantic correctness — the defect that made v3 necessary

v2 fused direction and abnormality into one signed state, `sign(z) × |z|`. The
direction word therefore came out of a z-score. With a sufficiently negative
recent mean, a **−1.0% open-interest change printed as EXPANDING**. The measure
was not noisy — it was wrong, and no filter fixes a wrong word.

v3 separates the axes. Direction is `sign(raw)` and nothing else; intensity is
the σ ladder. Eight invariants are asserted on every bar:

| invariant | signed bars checked | violations |
|---|---|---|
| OI 24H EXPANSION ⟹ oiChg24h > 0, REDUCTION ⟹ < 0 | 1,494 | **0** |
| OI 4H EXPANSION / REDUCTION | 1,499 | **0** |
| POSITIVE / NEGATIVE PREMIUM ⟹ sign(premium) | 1,500 | **0** |
| LONG / SHORT FUNDING ⟹ sign(funding) | 1,451 | **0** |
| ETF INFLOW / OUTFLOW ⟹ sign(etf5d) | 1,451 | **0** |
| LIQ BALANCE MORE LONG / SHORT ⟹ sign(balance) | 1,451 | **0** |
| **total** | **8,846** | **0** |

Trend and SOPR are separate: their raw value *is* the deviation, so the state
sign equals the raw sign by construction. Asserted rather than assumed —
0 disagreements.

Participation is the deliberate exception. "Relative surge" is a claim about
deviation from normal, so its word is z-driven and the vocabulary says
`RELATIVE`. `SPOT DOMINANT` / `PERP DOMINANT` were removed from the source and a
test asserts the strings are gone.

### Cost of a raw-sign direction

The direction axis has no hysteresis, by design. Measured, not assumed:

| measure | consecutive engaged bars | direction flips | rate |
|---|---|---|---|
| OI 24H | 3,184 | 29 | **0.91%** |

Small enough that the label does not rattle. Recorded because it is a real
property of the design and could have gone the other way.

## 2. A second correctness defect, found while rewriting

v2 called stateful builtins inside ternary branches — `oiOK ? zOf(...) : na` and
eight more. A `ta.*` function skipped on the bars its branch is not taken has
holes in its internal window, which corrupts every later value silently. v3
computes all of them unconditionally and masks afterwards. This is the kind of
error that produces plausible numbers, which is why it survived two versions.

## 3. Percentile validation

| property | method | result |
|---|---|---|
| range | all seven percentile series, every bar | 0 violations outside [0,100] |
| order-correctness | on real data: where a raw value is the unique max of its 180-bar window the rank must be at the top of the scale, and vice versa | 103 window extremes checked, **0 wrong** |
| fixture | `ta.percentrank(close, 20)` on a strictly rising synthetic series | 100 on all 75 post-warmup bars; strictly falling series maxes at 0 |

Both the range and order tests hold under either convention for whether the
current bar counts itself, so neither bakes in an assumption about TradingView's
tie handling.

**Not resolved:** the intensity word comes from the σ ladder while the displayed
abnormality is a percentile. They are not the same statistic. The σ ladder was
kept because the smoothing and hysteresis audits are expressed in σ and were run
against σ thresholds; moving the ladder to percentiles would invalidate both
without being measured. Recorded as a known inconsistency, not as a resolved
question.

## 4. Hysteresis

The JavaScript model is cross-checked against the compiled Pine on all 13,164
bars before any number is reported — **identical on every bar**, both measures.

| measure | transitions raw → schmitt | median label run | retention | median delay |
|---|---|---|---|---|
| OI 24H | 2123 → 1879 (−11%) | 2 → **3** | 100% | **0** |
| TREND | 223 → 169 (−24%) | 5 → **9** | 99% | **0** |

Two-bar confirmation reaches similar stability only by losing 20% of events and
delaying every entry by up to eight hours. Readability property only; no
predictive claim.

The v3 ladder reads magnitude alone, so a z sign flip no longer resets it. The
`mag()` and `sch()` functions also reset to 0 when their input is `na`, so a feed
that goes stale cannot leave its last reading standing as a live anomaly.

## 5. Smoothing — unchanged conclusions under the v3 machine

Re-run with the magnitude-only ladder and raw-sign direction:

| measure | verdict |
|---|---|
| OI 24H | **REGIME with EMA(2)** — the only candidate clearing every gate |
| OI 4H | IMPULSE — EMA(3) cut 1.5σ retention to 72% and the peak to 0.51 |
| PREMIUM | IMPULSE — EMA(2) lost 46% of its 2σ events |
| PARTICIP | IMPULSE — every candidate left a P90 delay of 3–5 bars |
| TREND | REGIME, no smoothing — already a 9-bar median run |

## 6. OI 4H de-seasonalization — tested, REJECTED

Pre-registered before the first run: three variants, six signal-quality metrics,
a four-part adoption rule, and ground truth defined on the **raw** percentage
change so the incumbent was not handed the win. No forward return, MAE, MFE or
Sharpe appears in the script.

A UTC-slot effect does exist — per-slot standard deviation varies **1.39×**
between the widest and narrowest slot, so the question was worth asking.

| variant | fires | false spikes | retention 1% / 0.5% / 0.1% | med delay | peak \|z\| | flip rate |
|---|---|---|---|---|---|---|
| **A** rolling 180 | 21.2% | **0.1%** (2) | 97% / 98% / 92% | 0 | 5.57 | 29.7% |
| B30 same-slot 30d | 25.2% | 8.6% (283) | 98% / 98% / 92% | 0 | 8.99 | 34.6% |
| B60 same-slot 60d | 23.1% | 5.1% (153) | 98% / 98% / 92% | 0 | 7.61 | 31.7% |

| gate | B30 | B60 |
|---|---|---|
| false-spike rate ≥20% lower than A | FAIL | FAIL |
| retention within 2pp at every tier | PASS | PASS |
| median detection delay equal to A | PASS | PASS |
| impulse frequency within ±25% of A | FAIL | PASS |
| **verdict** | **REJECT** | **REJECT** |

A 30-day same-slot window holds ~30 observations, so its standard deviation is
small and ordinary moves score high: false spikes rise from 2 to 283. The +1pp
retention gain at the 1% tier does not pay for that. **OI 4H keeps the rolling
z-score and stays an IMPULSE.** Nothing was re-tuned after seeing these numbers.

## 7. Stale and missing data

| scenario | required behaviour | result |
|---|---|---|
| adapter off | UNAVAILABLE, no value, no level, no anomaly | 0 leaks across 4 adapters × 1,500 bars |
| feed absent (SOPR) | same | 0 values, 0 states, 0 anomalies |
| feed freezes mid-run | STALE within 6 bars, readings stop | 0 levels and 0 values after the freeze |
| adapter enabled, still on chart close | **MISCONFIGURED**, distinct from STALE and UNAVAILABLE | all 1,500 bars, and shown as such on the dashboard |
| adapter with < 50 bars of history | cannot yet be distinguished from close → MISCONFIGURED | conservative by design |

Freshness for exchange feeds is measured against the **bar timestamp the symbol
returned**, not against whether the value changed. `request.security()` carries
the last value forward, which is indistinguishable from a fresh repeat unless
the times are compared.

## 8. Table capacity

Worst case — 9 anomalies, 5 events, all four adapters live — measured at
**65 of 76** allocated rows in Debug mode, and 10–13 in the default Decision
mode. Every cell write is bounds-guarded, so exceeding
capacity would drop rows rather than corrupt the table. Section order is
asserted against the specification.

## 9. Cohort integrity

A prospective log belongs to one cohort, identified by schema version, freeze
date, `sha256(main.pine)`, `sha256(all input defaults)` and an explicitly bumped
`THRESHOLD-VERSION`. All four routing branches are unit-tested:

| situation | action |
|---|---|
| same cohort | append |
| no log yet | create `event-log.json` |
| different cohort | **REFUSE, exit 1**, print which field moved |
| different cohort + `--new-cohort` | create `event-log-v3-<id>.json` |
| pre-v3 file with no cohort stamp | **REFUSE** |

`event-log-v2-legacy.json` is the v2 cohort's file. It recorded zero events and
is kept unmerged.

## 10. What did NOT pass, and what is not covered

| item | status |
|---|---|
| same-slot OI 4H normalisation | **REJECTED** by its own pre-registered rule |
| missing-value handling | **skipped**. Shrinks the sample rather than the variance; below 45 valid samples no reading is produced. No interpolation, no future observation |
| funding / liquidation repeats | an `input.source()` is never na, so a forward-filled upstream plot weights each observation by the bars it repeats across. No escape through this transport |
| ETF without the na gate | cannot distinguish a new observation from a repeat. The label says CAL-DAY or BAR SUM accordingly |
| execution time | seven 180-iteration window walks per bar, eleven with all adapters on. Within TradingView's budget? **Unmeasurable offline** — manual check A6 |
| adapter staleness | an **update-activity heuristic**, not a measurement. A live feed repeating a legitimate value is indistinguishable from a dead one |
| liquidation pairing | **declared, never verified.** The script cannot check that two `input.source()` plots share a unit; it can only refuse to compute until you say they do |
| σ ladder vs percentile display | known inconsistency, documented, not resolved |
| spot / perp RVOL product shape | classified IMPULSE **by analogy**, never separately audited |
| direction-axis hysteresis | none by design; the 1.00% flip rate is the cost |
| `request.security_lower_tf()` | untested offline — no intrabar series in the harness |
| `input.source()` picker | untested offline — the suite substitutes a series at the declaration |
| `request.footprint()` | untestable offline; isolated in `footprint-live.pine`, marked LIVE / DESCRIPTIVE ONLY |
| symbol spelling, history depth, layout, alert delivery | TradingView only — `TRADINGVIEW-VALIDATION.md` |
| any predictive claim | **none made, none tested, none supported** |

---

# Decision Utility Audit — Market Intelligence v1

**Frozen hash** `35b88632358a1b2506b655c9297b2ea593595c9571bc1623a883c7605826235e`
**Window** 13,164 bars, 2020-09-01 → 2026-09-03

> ## RETROSPECTIVE VALIDATION — not an out-of-sample proof
>
> This window has been examined repeatedly across five earlier hypotheses. It can
> **eliminate** Actions that do not work. It cannot **establish** that one does.
> Only BTC 4H data arriving after the freeze hash counts as prospective.

Reproduce: `node extract-states.mjs && node decision-utility.mjs`

---

## Method

States are read from the compiled indicator (`extract-states.mjs` runs the frozen
`main.pine` and caches its output). Nothing is re-derived in JavaScript — a
paraphrase would be the easiest way to accidentally audit a different indicator.

Consecutive bars in the same condition collapse to one **episode**; the entry bar
is the single observation. Each treated entry is compared only with control bars
sharing its price environment — prior-24h-return quintile × realised-vol tercile
× distance-from-EMA200 tercile, plus trend regime where trend is not itself the
treatment. Effect is the count-weighted mean of within-stratum differences.

Outcomes are normalised by entry-bar ATR so 2020 and 2026 are comparable.
Treated side bootstrapped at episode level, control side in 4-day blocks, 2,000
iterations, seeded.

**A matching variable must never include the treatment.** `RISK-OFF` *is* the
bearish trend read, so "bearish but not RISK-OFF" does not exist; matching U2 on
trend left all 48 episodes unmatched until trend was dropped from its stratum.

---

## Evidence table

| State | Action tested | Episodes | Matched-control outcome | Incremental value | Effect (ATR) | 95% CI | dev/val | Evidence | Keep Action |
|---|---|---|---|---|---|---|---|---|---|
| LEVERAGED RALLY | DO NOT CHASE | **13** | 24h MAE −1.48 vs −1.32 | none measurable | −0.16 | [−0.83, +0.51] | **opposite** (+0.42 / −0.98) | DESCRIPTIVE | **DELETE** |
| RISK-OFF / STRONG RISK-OFF | REDUCE EXPOSURE | 48 | 3D MAE −2.01 vs −2.39 | **negative** | **+0.53** | [−0.20, +1.24] | agree | DESCRIPTIVE | **DELETE** |
| " | " | 48 | 7D MAE −2.86 vs −3.64 | **negative** | **+0.87** | [−0.10, +1.74] | agree | DESCRIPTIVE | **DELETE** |
| plain 200-day MA (baseline) | — | 46 | 3D MAE −2.55 vs −2.38 | — | −0.22 | [−0.93, +0.47] | agree | reference | — |
| SPOT-LED vs PERP-LED | spot-led is higher quality | 338 vs 363 | 24h MAE −1.42 vs −1.26 | **reversed** | **−0.32** | **[−0.59, −0.07]** | agree | DESCRIPTIVE | **DELETE** |
| " | " | " | 48h MAE −1.95 vs −1.75 | **reversed** | **−0.45** | **[−0.82, −0.11]** | agree | DESCRIPTIVE | **DELETE** |

Acceptance required all six criteria. None of the three cleared criterion 3.

---

## 1. Is there any reason not to chase a LEVERAGED RALLY?

**No evidence, and the sample cannot support one.**

Six years produced **13 episodes**, median length one bar. Development and
validation disagree in sign on every outcome (24h MAE +0.42 vs −0.98). Every
confidence interval spans zero by a wide margin.

What point estimates there are lean *against* the thesis, not for it. Compared
with matched bullish controls, LEVERAGED RALLY showed **higher** 24h return
(+0.72 vs +0.12 ATR) and **higher** continuation (61.5% vs 52.5%). With n=13 that
is noise, and it is reported only to make clear the data gives no support in
either direction.

Knowing a rally is derivatives-led added nothing to knowing price had already
risen.

**`DO NOT CHASE` deleted.** The state itself is retained as description.

---

## 2. Does RISK-OFF identify risk better than a simple trend filter?

**No. It fires late, and the matched comparison shows it firing after the danger.**

Matched on price environment, RISK-OFF episodes experienced **less** forward
drawdown than comparable bars: 3D MAE −2.01 vs −2.39 (effect **+0.53 ATR**), 7D
−2.86 vs −3.64 (**+0.87 ATR**). Development and validation agree on the sign.
The threshold required −0.50 ATR *worse*; the measurement came out positive.

This is the failure mode anticipated in the brief — the state appears only after
price has already fallen. By then, relative to bars with the same prior return
and volatility, the remaining downside is smaller, not larger.

A plain 200-day moving-average filter was marginally *better* at flagging forward
downside (3D MAE effect −0.22 vs RISK-OFF's +0.53), though neither interval
excludes zero.

There is also a definitional point that no amount of data changes: **RISK-OFF
contains no derivatives, flow or on-chain input.** It is built from trend and
volatility, both price-derived. Its incremental value over a price filter was
never a question about alternative data.

**`REDUCE EXPOSURE` / `RISK OFF` deleted.**

---

## 3. Does the SPOT-LED / PERP-LED distinction carry information?

**A real, direction-consistent difference exists — pointing the opposite way to
the thesis, and it is driven by a handful of episodes.**

This is the only test where a confidence interval excluded zero:

| | effect | 95% CI | trimmed 5% | dev | val |
|---|---|---|---|---|---|
| 24h MAE | −0.32 | **[−0.59, −0.07]** | −0.08 | −0.33 | −0.36 |
| 48h MAE | −0.45 | **[−0.82, −0.11]** | −0.07 | −0.53 | −0.66 |

Three things to read here, in order of importance:

1. **The sign is backwards.** Negative means SPOT-LED rallies had *worse* maximum
   adverse excursion than PERP-LED ones, matched on price environment. The
   premise was that spot-led advances are higher quality.
2. **Removing the extreme 5% at each tail collapses the effect by a factor of
   four** — −0.32 → −0.08, −0.45 → −0.07. A handful of episodes carries almost
   all of it. That is the definition of an effect not to act on.
3. Continuation probability shows nothing at all: −0.3pp at 24h, −3.8pp at 48h,
   both intervals spanning zero.

So the distinction is not empty — but what it measures is not what the label
implies, and its usable magnitude after trimming is roughly one-tenth of an ATR.

**Spot/perp participation stays DESCRIPTIVE. No Action.**

---

## Outcome

All three Actions deleted. Per the brief, no fourth approach was attempted.

Market Intelligence remains what the earlier verification established it to be:
a **correct and honest data organiser**. Its states are definitionally sound,
non-repainting, and refuse to speak when a feed is missing. None of them is
entitled to tell you what to do.

Every state is now labelled `DESCRIPTIVE`, and the dashboard prints
`ACTION: CONTEXT ONLY`.

### Two observations recorded, not acted on

Both would be v2 hypotheses requiring their own pre-registration:

- **The states flicker.** Median episode length is 1–3 bars for most states;
  `STRONG RISK-ON` splits 1,863 bars into 445 episodes. A read that changes every
  8 hours is not decision support. Hysteresis is the obvious remedy and was
  deliberately not added here.
- **`LEVERAGED RALLY` is too narrow to ever be measurable** at 13 episodes in six
  years. It requires four conditions simultaneously while the funding adapter is
  unwired. Loosening it would be a new definition, hence a new hypothesis.

### How a state could earn an Action

| Level | Requirement |
|---|---|
| DESCRIPTIVE | data and definition verified correct — where all states now sit |
| SUPPORTED | retrospective matched analysis shows incremental value |
| VALIDATED | prospective out-of-sample, on data after the freeze hash, also passes |

Nothing reaches SUPPORTED. Reaching it on this window is no longer possible for
these three: they have been tested and failed on it.
