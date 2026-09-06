# BTC 4H Market Radar

A TradingView Pine Script v6 **monitor**. It watches open interest, funding,
perpetual premium, spot-vs-perp participation, liquidations, ETF flow and SOPR,
normalises each against its own recent history, and answers four questions:

1. **What has happened recently?** — RECENT EVENTS
2. **What is unusual right now?** — CURRENT ANOMALIES
3. **What are price and positioning doing together?** — MARKET MECHANICS
4. **Which feeds can I actually trust?** — DATA HEALTH

It does not tell you what will happen next, and it does not suggest what to do.

> ### Status: CORE READY FOR MANUAL VALIDATION
>
> **Not ready for normal use.** 27 offline checks prove the logic is
> self-consistent and says true things about the data it was given. They cannot
> prove the script compiles on TradingView, that any symbol resolves, or that a
> single number on the chart is what it claims. Core acceptance is **A1–A5,
> B1–B7, C1, E1, E4, E6** in
> [`TRADINGVIEW-VALIDATION.md`](./TRADINGVIEW-VALIDATION.md), plus the D checks
> for each external adapter you actually enable. Until that list is complete this
> is a script under validation, not a tool.

- **License**: [MPL-2.0](../LICENSE) © tc3oliver
- **Audits**: [`audit/AUDIT.md`](./audit/AUDIT.md)
- **Manual checklist**: [`TRADINGVIEW-VALIDATION.md`](./TRADINGVIEW-VALIDATION.md)
- **Underlying research**: [`../btc-4h-regime-engine/RESEARCH-LOG.md`](../btc-4h-regime-engine/RESEARCH-LOG.md)

---

## 1. This is a radar, not a predictor

An earlier version of this project was a trading engine with hard gates, a
pullback-quality score and `LONG READY` output. Every load-bearing claim was
tested before it was built, on 13,164 bars of 4H BTC (2020-09 → 2026-09). All of
them failed:

| claim | result |
|---|---|
| OI direction separates healthy pullbacks from breakdowns | correct sign in 12/12 cells, **not one bootstrap CI excluded zero** |
| Top-trader positioning does it better | failed all four pre-registered criteria, sign reversed out-of-sample |
| Market structure works as a hard gate | **negative** contribution in all three periods |
| Derivatives flag forward risk | matched, never beat, a 30-bar standard deviation |
| A slow EMA filter manages drawdown | reproduced by a constant position that traded 100× less |

A later version shipped an action layer anyway. It was audited against matched
price-environment controls and deleted:

| action | episodes | effect vs matched control | verdict |
|---|---|---|---|
| DO NOT CHASE on a leveraged rally | **13** | 24h MAE −0.16 ATR, CI [−0.83, +0.51] | dev and validation opposite in sign |
| REDUCE EXPOSURE on risk-off | 48 | 3D MAE **+0.53** ATR | episodes had *less* forward drawdown — the state fires after the fall |
| Spot-led rallies are higher quality | 338 vs 363 | 48h MAE **−0.45** ATR, CI [−0.82, −0.11] | the one interval that excluded zero pointed the *opposite* way, and shrank fourfold when the extreme 5% was trimmed |

The Deflated Sharpe Ratio of the best candidate, computed from an honest
15-configuration trial registry, was **0.44** — worse than a coin flip.

So this is a monitor. Everything it says is a description of a measurement.

---

## 2. Raw direction and abnormality are two different things

This is the rule the whole of v3 is built on, and the bug that made v3
necessary.

> **RAW VALUE** → direction. What happened. Nothing else decides it.
> **Z-SCORE** → state intensity, through the hysteresis ladder.
> NORMAL / UNUSUAL / EXTREME. Marked **[σ]** on the dashboard.
> **PERCENTILE** → historical rarity, and the ranking used to order ANOMALIES.

The percentile does not decide the state and never has — the σ ladder does, and
that is what the smoothing and hysteresis audits measured. Three roles, three
statistics, and the dashboard marks which one produced the word.

In v2 the two were fused: a state was `sign(z) × |z|`, so the direction word came
out of a z-score. When the recent mean was strongly negative, an open-interest
change of **−1.0%** could be printed as **EXPANDING**, because it was above
average. That is a false statement about the data, and no amount of hysteresis
or smoothing fixes it.

In v3 every label is `<intensity> <direction>` and the two halves come from
different places:

| role | statistic | vocabulary |
|---|---|---|
| direction — what happened | the sign of the **raw** measurement, nothing else | EXPANSION / REDUCTION, LONG / SHORT FUNDING, INFLOW / OUTFLOW, POSITIVE / NEGATIVE PREMIUM |
| intensity — how far out | the **σ** ladder with hysteresis, marked `[σ]` | NORMAL / UNUSUAL / EXTREME (funding: NORMAL / ELEVATED / EXTREME) |
| rarity — how often | the **percentile**, shown as `99.4p`; also orders the anomaly list | no words of its own |

Eight invariants are asserted on every bar of the test window
(`npm test`, check 1):

```
EXPANSION        ⟹  oiChg24h > 0        REDUCTION        ⟹  oiChg24h < 0
INFLOW           ⟹  etf5d    > 0        OUTFLOW          ⟹  etf5d    < 0
LONG FUNDING     ⟹  funding  > 0        SHORT FUNDING    ⟹  funding  < 0
POSITIVE PREMIUM ⟹  premium  > 0        NEGATIVE PREMIUM ⟹  premium  < 0
```

Any violation fails the suite. Currently: **0 violations across 8,846 signed
bar-observations.**

### Why percentile is shown first

Crypto returns are not normal, so a σ implies a distribution the data does not
have. Every row leads with the raw value, then the empirical percentile rank of
that value in the same 180-bar window, then σ as secondary text:

```
OI 24H       +4.71%   99.4p   +2.71σ    EXTREME EXPANSION
PREMIUM *   -0.0488%  34.4p   -0.51σ    NORMAL
FUNDING     +0.1859%  87.8p   +0.91σ    NORMAL
```

`99.4p` means "higher than 99.4% of the last 180 bars". It is the rank of the
**raw** value, so on a two-sided measure a *low* percentile is just as extreme
as a high one — `RELATIVE 2.2p` is a strong perp surge. Anomalies are therefore
ranked by `max(p, 100−p)`, which makes no normality assumption at all.

**They disagree, and the rate is measured rather than assumed.** Comparing the
σ ladder against percentile-extremeness tiers over all 13,164 bars:

| measure | tiers disagree | rare (top 2.5%) but state NORMAL | state EXTREME but not rare |
|---|---|---|---|
| OI 24H | 20.8% | 0.01% | 0.18% |
| OI 4H | 12.0% | 0.00% | 0.00% |
| PREMIUM | 34.6% | **2.88%** | 0.00% |
| PARTICIP | 6.6% | 0.02% | 0.00% |
| SPOT RVOL | 27.3% | **2.91%** | 0.00% |
| PERP RVOL | 26.5% | **2.94%** | 0.00% |
| **all** | **21.3%** of 78,579 readings | **1.46%** | 0.03% |

A one-in-five disagreement is what you get from two different statistics on a
non-normal distribution, and it is not a defect. The case that *looks* like a
bug — `95.0p ... NORMAL [σ]` — happens on about 1.5% of readings, most of it in
the fat-tailed measures. The `[σ]` marker exists so that row reads as two
statements rather than one contradiction. Percentile tiers here mirror the
two-sided σ gates for comparison only; nothing in the indicator uses them, and
no threshold was changed on the strength of this measurement.

### Participation is the one measure whose direction is *not* raw

"Relative spot surge" is a claim about deviation from normal, which is a
statement about the z-score, not about the ratio. The words say **RELATIVE
SPOT SURGE / RELATIVE PERP SURGE / NORMAL RELATIVE ACTIVITY** precisely so they
cannot be read as dominance. `partRaw > 0` only means spot RVOL exceeded perp
RVOL, which is true most of the time and means nothing on its own. The v2 words
`SPOT DOMINANT` / `PERP DOMINANT` no longer exist in the source, and a test
asserts that.

---

## 3. One price source, one timeframe

**Every price-derived feature comes from the BTC reference symbol**, default
`BINANCE:BTCUSDT.P` — return, ATR, realised volatility, 24H change, trend
distance, the daily 200MA, 12-week momentum, perp RVOL, and the numerator of the
perp premium. `ta.atr()` would read the chart's own bars, so true range is
rebuilt on the reference series instead.

The chart's own `close` is read in exactly **one** place: detecting an
`input.source()` adapter that is still pointed at it. Put the script on any
chart you like — check 6 asserts all 22 radar series are bit-identical on a
BTCUSDT.P chart and on a non-BTC chart.

**The timeframe must be exactly 4H (240 minutes)** or the script refuses to run.
This is not a preference. 24H is six bars, RVOL compares the same UTC slot on
previous days, the OI 24H window and every event definition are all written in
4H bars. On a 1H chart "24H" would silently mean four hours, and nothing would
warn you.

---

## 4. What each measure answers

| measure | question it answers | shape |
|---|---|---|
| TREND | where is price relative to the confirmed daily 200MA, in ATR? | REGIME |
| VOLATILITY | how does current realised vol rank against six years? | REGIME |
| MOMENTUM 12W | is price up or down over twelve weeks? | context |
| OI 24H | did positioning build or unwind over a day, and how unusually? | REGIME (EMA 2) |
| OI 4H | did positioning move sharply on **this** bar? | IMPULSE |
| FUNDING | are perp longs or shorts paying, and how unusually? | CONTEXT (adapter) |
| PREMIUM | is the perp trading above or below spot, and how unusually? | IMPULSE |
| LONG / SHORT LIQ | was there an unusual burst of forced closing on either side? | CONTEXT (adapter) |
| LIQ BALANCE | which side is being liquidated more, on a −1…+1 scale? **Only computed when you declare both feeds share a unit** | CONTEXT (adapter) |
| SPOT / PERP RVOL | is volume unusual against the **same UTC slot** on prior days? | IMPULSE |
| RELATIVE | is spot or perp unusually active relative to the other? | IMPULSE |
| PERP / SPOT DELTA | estimated net up-bar vs down-bar volume inside the bar | ESTIMATED |
| ETF total | is recent US spot ETF flow in or out, and how unusually? The row is named for **what it actually sums** — see §9 | CONTEXT (adapter) |
| SOPR | are coins moving at a profit or a loss versus their last move? | CONTEXT |

### REGIME / IMPULSE / CONTEXT

Not every measurement deserves the same treatment. A stability audit
([`audit/smoothing-audit.mjs`](./audit/smoothing-audit.mjs)) sorted them, using
gates taken from the requirements — label run ≥ 3 bars, median detection delay
≤ 1 bar, ≥ 90% retention of events at and above the measure's own entry
threshold:

| shape | measures | behaviour |
|---|---|---|
| **REGIME** | Trend, OI 24H | persistent state with hysteresis; appears in WHAT CHANGED and RECENT EVENTS as a transition |
| **IMPULSE** | OI 4H, Premium, Participation, Spot RVOL, Perp RVOL | this bar only; no persistent state; appears in ANOMALIES and as a one-shot event, never as a regime transition |
| **CONTEXT** | Funding, ETF flow, SOPR, liquidations | slow or external feeds |

**OI 24H uses EMA(2)** on its z before the ladder — the only candidate that
cleared every gate (label run 2 → 3 bars, 100% retention at 1.5σ/2.0σ/2.5σ,
median delay 0). EMA(3) and EMA(4) pushed P90 delay to 3–4 bars for no gain.

**The other four could not be rescued.** Every candidate either left the label
flickering at a 1–2 bar median or destroyed the extremes the measure exists to
report — OI 4H lost half its 1.5σ events at EMA(3) with peak attenuation of
0.51; Premium lost 46% of its 2σ events at EMA(2). So they report instantaneous
spikes instead: zero latency, no state to flicker, nothing claimed to persist.

**De-seasonalisation was tried and rejected.** See §7.

### Hysteresis

A Schmitt trigger on `|z|`: entering costs more than staying. A readability
device, **not** claimed to improve any decision. Verified in
[`audit/hysteresis-verify.mjs`](./audit/hysteresis-verify.mjs), which first
proves its JavaScript model reproduces the compiled Pine on all 13,164 bars:

| measure | transitions | median label run | retention | detection delay |
|---|---|---|---|---|
| OI 24H | 2123 → **1879** | 2 → **3** | 100% | **0 bars** |
| TREND | 223 → **169** | 5 → **9** | 99% | **0 bars** |

The obvious alternative — requiring two consecutive bars — reaches similar
stability only by **losing 20% of events and delaying every entry by up to eight
hours**.

In v3 the ladder reads magnitude only, so a raw sign flip no longer resets it.
The direction word has no hysteresis of its own, by design. The price of that
was measured: **OI 24H's direction flips on 29 of 3,184 consecutive engaged bars
(0.91%)** — small enough that the label does not rattle.

---

## 5. Market Mechanics replaces v2's alignment count

v2 printed `STRONGLY ALIGNED 5/5` when price, OI, funding, premium and perp RVOL
all moved the same way over 24h. That number had no referent: those are five
different quantities with five different economics, and "agreement" between them
is not one thing.

v3 shows the one pairing whose joint reading has a definition rather than a
vote — price direction against position direction over the same 24 hours:

```
PRICE UP   + POSITION BUILD          PRICE UP   + POSITION REDUCTION
PRICE DOWN + POSITION BUILD          PRICE DOWN + POSITION REDUCTION
```

with funding, premium and perp RVOL attached as description. All four states
occur in the test window and both axes are asserted to carry the sign of their
own raw 24h change (check 14).

It is **not** converted into bullish or bearish. It is a description of what
price and positioning did, together.

---

## 6. Data health — two vocabularies, because two different things are measured

DATA HEALTH is split into two blocks, and they do not share words.

### Timestamp-verified feeds

Reference, spot, open interest, the daily 200MA and SOPR each return **their own
bar time**, so the lag is measured. `request.security()` carries the last value
forward when a symbol has no bar, which is indistinguishable from a fresh repeat
unless the timestamps are compared — so they are.

| status | meaning |
|---|---|
| `FRESH` | current |
| `1 BAR OLD` / `1D OLD` | one period behind — normal for a daily feed |
| `STALE` | measurably too old to describe this bar; readings suppressed |
| `UNAVAILABLE` | nothing there |

| feed | FRESH | OLD | STALE | why |
|---|---|---|---|---|
| reference, spot, OI | 0 bars behind | 1 | > 1 | exchange feeds on the chart's own timeframe; two bars of lag is an outage |
| daily 200MA, SOPR | ≤ 2 days | ≤ 3 | > 3 | one day behind **by construction** — the non-repainting idiom requests the previous completed daily bar |

### External adapters — an update-activity heuristic, not freshness

An `input.source()` delivers a number and nothing else: **no upstream
timestamp**. The only thing that can be observed is whether the number changed.
So these rows report update activity, and the words never say "fresh":

| status | what was actually observed |
|---|---|
| `ACTIVE` | the value moved on this bar |
| `UNCHANGED 1 BAR` | it did not move on this bar |
| `LIKELY STALE` | it has not moved for longer than the feed's own update period |
| `MISCONFIGURED` | enabled but still pointed at the chart's own close |
| `UNAVAILABLE` | the adapter is off |

| adapter | LIKELY STALE after | why that period |
|---|---|---|
| funding | unchanged > 6 bars (24h) | settles every 8h = 2 bars |
| ETF flow | unchanged > 30 bars (5d) | daily and business-day only; a 3-day weekend is normal |
| liquidations | unchanged > 6 bars (24h) | should move most bars |

**`LIKELY STALE` is not proof of anything.** A feed that is alive and
legitimately repeating a value — funding pinned at the same rate, zero ETF flow
on a public holiday, a quiet hour with no liquidations — is *indistinguishable*
from a dead one through an `input.source()`. Readings are still suppressed at
`LIKELY STALE`, because acting on a possibly-dead feed is worse than losing a
possibly-live one, but that is a conservative choice and not a measurement. The
test suite demonstrates the false positive rather than hiding it: a deliberately
constant live feed is fed in and asserted to read `LIKELY STALE` (check 23).

An adapter with fewer than 50 bars of history reads `MISCONFIGURED`, not
`ACTIVE` — it cannot yet be distinguished from the chart's own close, and an
unproven adapter must not produce readings.

### What happens to a missing observation

Three attempts, and the first two were both wrong.

| version | policy | what it actually did |
|---|---|---|
| v3.0 | `nz()` → 0 | injected a value the market never produced, **and** let a −100% artefact into the window |
| v3.1 | carry forward | invented no new number but **weighted the previous observation once per missing bar** |
| **v3.2** | **skip** | a missing bar contributes nothing: not zero, not a repeat, and it does not occupy a slot |

`[+2%, na, na, −1%]` became `[+2%, +2%, +2%, −1%]` under v3.1, so +2% counted
three times in the mean, the deviation and the rank. Carry-forward is not
neutral missing-value handling and it was wrong to describe it as inventing
nothing. A fixture now pins this exactly: on that pattern the window must report
**n = 10, not 20**, mean **0.005, not 0.0125**, and z **exactly 1.0**.

The statistics are no longer left to `ta.sma()` / `ta.stdev()`. The Pine
documentation says *"some built-in functions, such as `ta.sma()`, ignore the
bars with `na` values"* — note "some", and note that no equivalent statement
exists for `ta.stdev()`. Pairing a function that skips `na` with one that does
not would compute the mean and the deviation over two **different** sample sets
and return a z-score that is subtly wrong rather than `na`. So `validNorm()`
walks the window itself, in one pass, using Welford's method, and returns the
z-score, the percentile and the sample count from provably the same samples.

The percentile is defined exactly: **the share of the other valid samples in the
same window that are ≤ the current value**, so a unique maximum ranks 100 and a
unique minimum ranks 0. Asserted as an equality, not a bound.

The original v3.0 defect that started all of this:

- On a *change* series, 0 means "no change" — a reading the market never
  produced, injected into the distribution and understating its variance.
- Worse, the open-interest change was formed as `oi / oi[1] − 1` with only the
  **older** value checked for positivity. A zero open-interest tick therefore
  produced **−100%**, and one −100% inside a 180-bar window inflates the rolling
  standard deviation about 4.5×. That does not make the panel noisy. It makes it
  **silent**.

Measured on the Binance history — 12 zero-OI bars between 2022 and 2025:

| full 13,164-bar history | outside the affected windows | inside them |
|---|---|---|
| bars | 12,405 | **747 (5.8% of history)** |
| median rolling σ — **v3.0** | 0.0168 | **0.0765 — 4.5× inflated** |
| OI 4H firing at \|z\| ≥ 1 — **v3.0** | 21.5% | **1.5%** |
| median rolling σ — **v3.1** | 0.0168 | 0.0164 — **0.98×** |
| OI 4H firing at \|z\| ≥ 1 — **v3.1** | 21.5% | **22.3%** |

For 30 days after each bad tick, the radar under-reported open-interest
anomalies by roughly 14× and nothing on screen said so. That is precisely the
failure mode this project exists to avoid: **a plausible-looking display that is
quietly wrong.**

The fix, in three parts:

1. **Both endpoints must be valid observations.** An observation counts only if
   it is present, positive, base-unit, and timestamped to *this* bar rather than
   carried forward by `request.security()`. A zero tick forms no change at all,
   in either direction.
2. **No `nz()` and no carry-forward.** A bar without an observation is skipped.
   The one exception is the ETF per-bar-increment mode, where a bar with no
   increment genuinely did contribute zero flow.
3. **One pass per measure**, producing the z-score, the percentile and the
   sample count together, so they can never describe different histories.

The contaminated windows are now statistically indistinguishable from the rest
of the history, and the most extreme value the normalisation source ever sees is
**−34.5%** — a real four-hour open-interest move — instead of −100%. Of 13,164
bars, **13,142 carry a valid 4H open-interest observation**; the other 22 are
skipped rather than filled. The v3.0 formula is kept inside the test suite as a
control and must keep showing the damage, or the regression test has gone blind.

**Which feeds are skipped, and which are not.** Skipping is only correct where
`na` means "no observation". It is applied to open interest, premium,
participation, both RVOLs, and SOPR — SOPR gets it through its own daily bar
time, so a new observation is identified exactly rather than guessed from a
value change. It is **not** available for the funding and liquidation adapters:
an `input.source()` is never `na`, so if the upstream plot carries a value
forward, each upstream observation is weighted by however many bars it repeats
across. That is a real limitation of the transport, stated rather than papered
over. Only the ETF adapter can escape it, and only under the na-gated
contract below.

---

## 7. OI 4H de-seasonalization: tested, rejected

Open interest on a 24/7 venue has a time-of-day shape, so a rolling 180-bar
z-score pools slots that are not the same population. The candidate fix
compares each bar only with the **same UTC slot** on previous days.

[`audit/oi4h-deseasonalization.mjs`](./audit/oi4h-deseasonalization.mjs)
pre-registered three variants (rolling, same-slot 30d, same-slot 60d), six
signal-quality metrics, and a four-part adoption rule, all before the first run.
No forward return, MAE, MFE or Sharpe appears anywhere in the file.

There **is** a slot effect — per-slot standard deviation varies 1.39× between
the widest and narrowest slot. It does not help:

| variant | fires | false spikes | retention 1%/0.5%/0.1% | med delay | peak \|z\| | flip rate |
|---|---|---|---|---|---|---|
| **A** rolling 180 | 21.2% | **0.1%** (2) | 97% / 98% / 92% | 0 | 5.57 | 29.7% |
| B30 same-slot 30d | 25.2% | 8.6% (283) | 98% / 98% / 92% | 0 | 8.99 | 34.6% |
| B60 same-slot 60d | 23.1% | 5.1% (153) | 98% / 98% / 92% | 0 | 7.61 | 31.7% |

A "false spike" is a fired bar whose raw |4H OI change| is **below the median**
of the whole sample — the normaliser manufactured an unusual reading out of a
smaller-than-typical move. A 30-day same-slot window contains ~30 observations,
so its standard deviation is small and ordinary moves score high: false spikes
rise from 2 to 283. The small retention gain (+1pp at the 1% tier) does not pay
for it.

Both variants **REJECTED**. OI 4H keeps the rolling z-score and stays an
IMPULSE. Ground truth was deliberately defined on the raw percentage change, not
on variant A's own z-score, so A was not handed the win by construction.

---

## 8. Dashboard

```
BTC 4H MARKET RADAR

RECENT EVENTS                     last 5 confirmed events, with age
  now   OI 24H extreme expansion 99.4p (+4.71%)
  4h    OI 24H unusual expansion 98.3p (+3.32%)
  8h    Short liquidation spike 98.9p

WHAT CHANGED                      NEW / NORMALIZED / CHANGED, vs the last close
CURRENT ANOMALIES: N              ranked by percentile extremeness, impulses *

MARKET MECHANICS                  price 24H × OI 24H, plus description
TREND / VOLATILITY                persistent regime
DERIVATIVES                       OI 24H · OI 4H · funding · premium · liq
PARTICIPATION                     spot RVOL · perp RVOL · relative
FLOW                              estimated lower-TF delta
SLOW CONTEXT                      ETF · SOPR
DATA HEALTH                       every feed's freshness

EVIDENCE: DESCRIPTIVE   ACTION: CONTEXT ONLY
```

**RECENT EVENTS** holds the last five confirmed events with their age, so a
glance answers "what did I miss". Written only on a confirmed 4H close, and
never twice in a row for the same line.

**WHAT CHANGED** covers the last bar only, grouped:

```
NEW:          OI 24H entered unusual expansion
NORMALIZED:   Premium returned from extreme
CHANGED:      ETF unusual inflow → unusual outflow
```

REGIME and CONTEXT transitions only. An impulse has no previous state to have
changed from, so listing one here would report noise as a transition. Fires on
**15.3%** of bars.

Worst case — 9 anomalies, 5 events, all four adapters live — uses **55 of 64**
allocated table rows, and every cell write is bounds-guarded.

### Evidence levels

| Level | Requirement | States here |
|---|---|---|
| DESCRIPTIVE | data and definition verified correct | **all of them** |
| SUPPORTED | retrospective matched analysis shows incremental value | none |
| VALIDATED | prospective out-of-sample on post-freeze data also passes | none |

---

## 9. Setup

Paste [`main.pine`](./main.pine) into the Pine Editor and add to chart. **4H
timeframe required** — the script halts on anything else.

**The first 200 days show no trend regime** — the daily 200MA has not warmed up.
That is correct, not a bug.

### Open interest must be base-unit

The `_OI` input must resolve to open interest denominated in **BTC**, not USD
notional. USD notional is base OI × price, so it falls whenever price falls. In
testing, a USD-notional feed classified **134 of 147** pullbacks (91%) as
"healthy deleveraging" and its sign reversed at 3 of 4 horizons.

TradingView will not tell you which you have — its documentation says
*"Non-aggregated values may be presented in base currency, quote currency, or
contracts, depending on the exchange"*. So the script checks two independent
things at runtime:

1. **What the feed calls itself.** `syminfo.currency` read from the OI symbol's
   own context. `NONE` means the values are not currency amounts, which is what
   a base-unit or contract feed looks like. `USD`/`USDT`/`USDC` means notional.
2. **Magnitude.** Base-unit BTC OI is ~10⁵; USD notional is ~10¹⁰.

Either check failing disables the OI readings and puts a warning on the chart.
Both paths are covered independently by the test suite.

### External adapters

Aggregated funding, ETF flow and liquidations have no Pine-requestable symbol —
TradingView exposes them only as built-in studies, and Pine cannot call one. So
they arrive through `input.source()`: add an indicator that plots the series,
then point the matching input at its plot.

Each adapter has an explicit **enable toggle**, because an unwired
`input.source()` returns exactly its default with no `na` and no sentinel —
there is no way to tell "the user selected close" from "the user selected
nothing".

Open interest needs no adapter: it comes straight from the `_OI` service symbol.

#### The adapter contract

An `input.source()` carries a number and nothing else — no unit, no timestamp,
no statement of what one observation represents. Every assumption the script
would otherwise have to guess is an explicit input, and where an assumption
cannot be checked the reading is **withheld rather than computed from a guess**.

| input | why it exists | what goes wrong without it |
|---|---|---|
| **Funding unit** — decimal / percent / basis points | the z-score and percentile are scale-free, but the printed rate is not | the FUNDING row reads `+0.0002%` when the truth is `+0.02%`, and looks entirely plausible |
| **ETF source shape** — three options, see below | ETF flow is published *daily*, on US trading days only | summing 30 bars counts every day **six times**; sampling calendar days re-counts Friday across a weekend |
| **Liquidation pairing** — "both feeds share one source and unit" | `(long − short) / (long + short)` subtracts one feed from the other | two mismatched scales still land inside [−1, +1] and still look like a reading. Check 22 wires a 1,000,000× mismatch and shows 100% of bars landing in range, pinned at −1 |

#### ETF: the row is named after the arithmetic

ETF flow is published **daily, on US trading days only**. What the script can
compute depends entirely on the shape of your plot, so the row label changes
with it and the words "ETF 5D" no longer exist anywhere in the source:

| shape you declare | row label | what it sums | can it skip weekends? |
|---|---|---|---|
| `na` except on a new observation | **ETF LAST 5 OBS** | the last five bars that carried a figure | **yes** |
| daily value, repeated within the day | **ETF 5 CAL-DAY** | one sample per calendar day | no — a Friday figure is re-counted on Saturday and Sunday |
| per-bar increment | **ETF 30-BAR SUM** | thirty 4H increments | n/a |

Only the first is a genuine five-observation total, and it needs a contract your
source must honour: **plot the figure on one bar per observation and `na` on
every other bar**, including every bar of a weekend or a market holiday. Under
that contract the total skips closed sessions, and two consecutive sessions
reporting the *same* number still count twice — because the gate is the `na`,
not the value. All three cases are fixtures in check 25.

**The technical limitation, stated plainly:** without the `na` gate there is no
way through a single `input.source()` to tell a new observation from a repeated
one. Two consecutive trading days with identical flow are indistinguishable from
one day carried forward. That is why the other two modes are *not* called
five-trading-day flow — the label says calendar day or bar sum, which is what
the arithmetic does.

The pairing declaration defaults to **off**. With it off, LONG LIQ and SHORT LIQ
still work — each is ranked against its own history, which needs no shared
unit — but LIQ BALANCE reads `DATA INCOMPARABLE` and its value, percentile and
σ are all withheld. Landing in range is arithmetic, not evidence.

**Unconfirmed:** whether TradingView's own Fundamentals → Derivatives studies
expose selectable plots. That is item D3 on the manual checklist.

### Footprint — separate file, optional, Premium+

[`footprint-live.pine`](./footprint-live.pine) is a **separate indicator** and
deliberately not part of the Radar. `request.footprint()` requires a Premium,
Premium+ or Ultimate plan, PineTS has no implementation of it, and TradingView
documents footprint data as **repainting by design** — "in real time the chart
may use one intrabar source (e.g. 1T) while the same bar is later recalculated
using a less granular interval (e.g. 1S)".

`request.footprint()` splits a bar's volume by **classifying lower-timeframe
intrabars**. It is not an exchange aggressor feed — nothing in it reports which
side of each trade removed liquidity — so every label reads *classified buy
volume*, *classified sell volume* and *volume delta*, and no wording implies a
live aggressor tape.

It is marked **LIVE / DESCRIPTIVE ONLY — CLASSIFIED, NOT AGGRESSOR — REPAINTS BY
DESIGN**, has no alerts, and never enters the prospective event log. Putting the call inside
`main.pine` would have made the Radar unusable below Premium and taken down the
entire offline test suite in exchange for one feature that cannot be verified.

---

## 10. Alerts

OI 24H regime change and return to normal · funding regime change · ETF regime
change and direction change · slow trend transition · SOPR crossing 1 · OI 4H
spike · premium spike · participation spike · long liquidation spike · short
liquidation spike · any feed becoming STALE · any feed becoming available again

All fire on **confirmed 4H bar close only**, all with
`alert.freq_once_per_bar_close`, and impulse alerts are suppressed while the
previous bar was already spiking so a multi-bar excursion reports once.

No `BUY`, `SELL`, `REDUCE` or `DO NOT CHASE`. None of those survived the audit.

---

## 11. Testing

The dataset is not in the repository — it is 93 MB of Binance history. Build it
once first; everything else reads from the cache it writes.

```bash
cd ../btc-4h-regime-engine/data && node fetch.mjs    # ~2,200 daily OI files, one time
cd ../../btc-4h-market-intelligence

npm install
npm test                             # 27 checks, 1500 bars
node tests.mjs 6000                  # same suite, longer window

node audit/extract-states.mjs        # run the frozen indicator over 13,164 bars
node audit/hysteresis-verify.mjs     # flicker and latency
node audit/smoothing-audit.mjs       # REGIME vs IMPULSE decision
node audit/oi4h-deseasonalization.mjs   # same-slot normalisation, rejected
node audit/event-log.mjs             # prospective log, from the freeze forward
```

### OFFLINE VERIFIED

| # | Check | What it proves |
|---|---|---|
| 0 | runs + **branch-type lint** | transpiles and executes against genuine multi-symbol data, and no `if`/`else` pair mixes a void branch with a value-returning one — a mismatch Pine refuses to compile and PineTS accepts silently |
| 1 | **semantic invariants** | every direction word follows the raw value — 0 violations across OI 24H, OI 4H, premium, funding, ETF and liquidation balance |
| 2 | trend / SOPR signs | the state sign equals the raw deviation's sign on every engaged bar |
| 3 | participation naming | RELATIVE SURGE follows its own z; `SPOT DOMINANT`/`PERP DOMINANT` are gone from the source |
| 4 | **percentile correctness** | in [0,100] across 7 series, and ranks correctly against its own window on 103 checked extremes |
| 5 | **validNorm fixture** | lifted verbatim out of `main.pine`: a rising series ranks 100 and a falling one 0; and on `[+2%, na, na, −1%]` the two gaps add **no weight** — n = 10 not 20, mean 0.005 not 0.0125, z exactly 1.0 |
| 6 | **chart-symbol independence** | all 22 radar series bit-identical on a BTC chart and a non-BTC chart |
| 7 | **exact 4H** | the predicate is 1 at 240 and 0 at 60, and `runtime.error` is wired to it |
| 8 | **no repaint** | truncating and re-running leaves every past bar identical, including hysteresis levels, direction codes, feed statuses and the event counter |
| 9 | **units guard** | USD-notional OI rejected by magnitude *and* by declared currency, tested independently |
| 10 | missing feeds | SOPR and all four disabled adapters produce no value, no level, no anomaly |
| 11 | **liquidation adapters** | both sides end-to-end below `input.source()`; spikes fire on the upper tail only; balance in [−1,1] with the correct sign |
| 12 | **stale / misconfigured** | a frozen feed goes STALE within 6 bars and stops producing readings; an enabled-but-unwired adapter reads MISCONFIGURED, never STALE or UNAVAILABLE |
| 13 | anomaly count | the headline number equals the engaged measurements on every bar; the ranking value stays in [50,100] |
| 14 | **market mechanics** | both axes carry the sign of their own raw 24h change; all four states occur |
| 15 | **recent events** | buffer never exceeds 5, equals min(5, accepted pushes), never decreases, no adjacent duplicates |
| 16 | alert structure | one `alert()` call site, inside `fire()`; all 20 `fire()` calls inside the confirmed block; no message repeats on consecutive bars |
| 17 | **table capacity** | worst case uses 55 of 64 rows; all 14 sections render in priority order with no prescriptive label |
| 18 | z-scores | rolling z-scores are actually standardised |
| 19 | **premium definition** | perp premium correlates with realised funding at **r = 0.63** (0.75 on the 24h mean) — as it must, since Binance derives funding from the premium index |
| 20 | **cohort integrity** | changing any of {schema, freeze, indicator hash, config hash, threshold version} produces a different cohort and refuses the merge; all four routing branches covered |
| 21 | **zero/missing OI contamination** | the 7 real zero-OI bars of 2024-07 form no change, produce no −100% artefact, and invent no value; σ inflation 1.01× and firing 28.3% inside vs 27.8% outside. The v3.0 formula runs alongside as a control and must keep showing 12.4× inflation and 0.0% firing, or the test has gone blind. Injected zeros cover the path on any dataset |
| 22 | **liquidation paired-unit contract** | undeclared pairing withholds the balance, its σ and its percentile and prints DATA INCOMPARABLE; a 1,000,000× scale mismatch still lands 100% inside [−1,+1], which is why range is not treated as validity |
| 23 | **freshness vocabularies do not mix** | adapter rows never say FRESH, timestamped rows never say ACTIVE, and a deliberately constant *live* feed is shown reading LIKELY STALE — the heuristic's false positive, demonstrated not hidden |
| 24 | **adapter unit contracts** | two funding plots 100× apart with their units correctly declared canonicalise to the identical rate and the identical z; declaring the *wrong* unit moves the printed rate by exactly 100×; a daily-shaped ETF plot summed as increments comes out exactly 6× too large |
| 25 | **ETF trading-day semantics** | under the na-gated contract the total is exactly the last five observations across weekends and a holiday, and two consecutive sessions reporting the same value still count twice; the forward-filled mode is shown to differ, which is why it is labelled CAL-DAY |
| 26 | **percentile vs σ disagreement** | measured, not assumed: 21.3% of readings, and 1.46% in the "rare but NORMAL" case that looks like a bug |

The suite also asserts the harness's spot and reference series are genuinely
different. PineTS strips exchange prefixes, so a chart symbol of `BTCUSDT`
collides with the stripped form of `BINANCE:BTCUSDT`; spot then silently
resolves to the reference, premium becomes identically zero, and everything
passes while testing nothing. That trap was hit once during development.

### TRADINGVIEW MANUAL VALIDATION REQUIRED

Not provable offline, and not claimed:

- real symbol spelling and history depth
- what Binance's `_OI` symbol actually reports on TradingView
- `request.security_lower_tf()` — the local provider has no intrabar series, so
  offline runs exercise the `no intrabar` branch only
- whether the `input.source()` **picker** can see another indicator's plot
- visual layout and alert delivery
- everything in `footprint-live.pine`

The checklist is [`TRADINGVIEW-VALIDATION.md`](./TRADINGVIEW-VALIDATION.md),
41 items, each with an expected result.

---

## 12. Prospective evidence, and how it is kept clean

The historical window has been examined too many times to serve as
out-of-sample. [`audit/event-log.mjs`](./audit/event-log.mjs) records every
regime transition and impulse spike **from the freeze forward**, with the
complete fact set at that instant — 18 raw values, 22 percentiles and z-scores,
9 freshness codes and 23 state codes — plus forward outcomes filled in as bars
arrive.

Those outcomes are not evidence today. Reading them before pre-registering a
hypothesis is exactly how the historical window stopped being usable.

### Cohort rule

A log belongs to exactly one **cohort**, identified by five things:

```
schema version · freeze date · sha256(main.pine) · sha256(all input defaults) · THRESHOLD-VERSION
```

Change any one of them and it is a different experiment. `event-log.mjs`
**exits 1** rather than write into a log stamped with a different cohort, and
prints which field moved. `--new-cohort` starts a separate file
(`event-log-v3-<id>.json`) instead of contaminating the old one.

The failure this prevents is specific: a new version re-scanning the bars after
an old freeze with new definitions, merging those rows into the old file, and
producing something that *reads* as accumulated out-of-sample evidence while
being a fresh in-sample fit.

This has now happened twice for real. `event-log-v2-legacy.json` and
`event-log-v3.0-legacy.json` are the retired cohorts, kept and never merged —
both recorded zero events, because the dataset still ends before the freeze. The
v3.1 refusal named all three fields that had moved (indicator hash, config hash,
threshold version) before it declined to write.

---

## 13. Limitations

- **PineTS does no type checking at all.** Pine's compiler rejects an `if`/`else`
  whose branches have incompatible types (CE10235); PineTS runs it happily. That
  cost one round-trip through the Pine Editor: `array.shift()` *returns* the
  element it removed, so a branch ending on it typed as `series int` while its
  sibling was `void`. Check 0 now lints for the pattern across both `.pine`
  files, but a lint is not a compiler — **A1 remains the only real proof the
  script compiles.**
- **PineTS is not TradingView.** Two rewrites are applied for the offline run
  only: PineTS re-runs the whole script inside `request.security()` (TradingView
  evaluates just the expression), and its `na()` cannot handle an `na` array.
  Both are documented in `tests.mjs`. A third quirk is worked around *in* the
  indicator: PineTS drops a bare `time` inside a `request.security` tuple, so
  the freshness checks are written `int(time)` — a no-op cast on TradingView.
- **The four adapters' wiring is not tested offline.** The test suite substitutes
  a deterministic series at the `input.source()` declaration, which exercises
  everything downstream of the value but not the picker itself.
- **The flow proxy has a hard history ceiling.** `request.security_lower_tf()` is
  capped at 100,000 intrabars on Basic through Premium (125K Expert, 200K
  Ultimate). At 5-minute intrabars on a 4H chart that is ~2,000 bars, about 11
  months. Older bars return an empty array.
- **The flow proxy is an estimate.** A lower-timeframe bar is classified buy-side
  if it closes up. Wrong on individual bars, roughly right in aggregate. Real
  aggressor data needs footprint, which repaints by design and is confined to
  `footprint-live.pine`.
- Daily feeds are always **one full day behind** by construction. Glassnode's own
  publication lag stacks on top.
- Binance OI history has 12 bars at exactly zero between 2022 and 2025. They
  form no change in either direction and never reach the normalisation window.
  v3.0 got this wrong and suppressed 93% of OI anomalies for 30 days after each
  one; §6 has the measurement and check 21 is the regression guard.
- **Missing values are skipped, which shrinks the sample rather than the
  variance.** A window with gaps is computed from fewer observations, and below
  45 valid samples (a quarter of the lookback) no reading is produced at all.
  No interpolation, and no future observation is ever used.
- **The funding and liquidation adapters cannot skip repeats.** An
  `input.source()` is never `na`, so if the upstream plot carries a value
  forward, each observation is weighted by the number of bars it repeats across.
  Only the ETF adapter has an escape, and only under the na-gated contract.
- **`ta.sma()` / `ta.stdev()` na behaviour is not relied on.** The docs describe
  skipping for `ta.sma()` and say nothing about `ta.stdev()`; the statistics are
  computed explicitly instead, which costs one 180-iteration pass per measure
  per bar. Whether that is within TradingView's execution-time budget on a long
  chart is check A6 on the manual list — it cannot be measured offline.
- **External adapter "staleness" is a heuristic** and is labelled as one. A live
  feed repeating a legitimate value reads LIKELY STALE, and there is no way to
  tell the difference through an `input.source()`.
- **The direction axis has no hysteresis.** Measured, not assumed: OI 24H's
  direction flips on 0.91% of consecutive engaged bars. Small, but not zero.
- Spot and perp RVOL were classified IMPULSE **by analogy** with the
  participation ratio they compose, not separately audited.
- **The intensity ladder is σ-driven while the displayed abnormality is a
  percentile.** They agree in almost every case but are not the same statistic;
  §2 explains why the ladder was left in σ.
- **Nothing here is SUPPORTED or VALIDATED.** Every state is DESCRIPTIVE. The
  radar organises data correctly; it makes no claim that any reading predicts
  anything, and the research record behind it is a list of things that did not.
