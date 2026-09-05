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
