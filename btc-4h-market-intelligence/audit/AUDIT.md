# Audits

- [V3 data-product audit](#v3-data-product-audit) — the current version
- [Decision utility audit (v1)](#decision-utility-audit--market-intelligence-v1) — what deleted the action layer

---

# V3 DATA-PRODUCT AUDIT

**Indicator** `main.pine`, threshold version `v3.0`
**Window** 13,164 bars, 2020-09-01 → 2026-09-03
**Reproduce**

```bash
npm test                                # 21 offline checks
node audit/extract-states.mjs           # run the frozen indicator over the full window
node audit/hysteresis-verify.mjs
node audit/smoothing-audit.mjs
node audit/oi4h-deseasonalization.mjs
node audit/event-log.mjs
```

> This audit covers **data-product correctness only**: does the indicator say
> true things about the data. It establishes nothing about predictive value, and
> no test in it computes a forward return. The evidence level of every state is
> still DESCRIPTIVE.

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
| LONG / SHORT FUNDING ⟹ sign(funding) | 1,480 | **0** |
| ETF INFLOW / OUTFLOW ⟹ sign(etf5d) | 1,470 | **0** |
| LIQ BALANCE MORE LONG / SHORT ⟹ sign(balance) | 1,498 | **0** |
| **total** | **8,941** | **0** |

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
| OI 24H | 3,010 | 30 | **1.00%** |

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
| OI 24H | 2016 → 1784 (−12%) | 2 → **3** | 100% | **0** |
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
| **A** rolling 180 | 20.0% | **0.1%** (2) | 94% / 97% / 92% | 0 | 5.57 | 28.1% |
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
small and ordinary moves score high: false spikes rise from 2 to 283. The +4pp
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
**51 of 64** allocated rows. Every cell write is bounds-guarded, so exceeding
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
