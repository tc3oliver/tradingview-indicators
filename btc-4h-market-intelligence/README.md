# BTC 4H Market Radar

A TradingView Pine Script v6 **monitor**. It watches open interest, funding,
perpetual premium, spot-vs-perp participation, ETF flow and SOPR, normalises
each against its own recent history, and answers three questions:

1. **Which measurements are anomalous right now?**
2. **What changed since the last confirmed bar?**
3. **Which measurements agree with each other, and which conflict?**

It does not tell you what will happen next, and it does not suggest what to do.

- **License**: [MPL-2.0](../LICENSE) © tc3oliver
- **Decision-utility audit**: [`audit/AUDIT.md`](./audit/AUDIT.md)
- **Underlying research**: [`../btc-4h-regime-engine/RESEARCH-LOG.md`](../btc-4h-regime-engine/RESEARCH-LOG.md)

---

## Why there is no signal and no action

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

## Three product shapes

Not every measurement deserves the same treatment. A stability audit
([`audit/smoothing-audit.mjs`](./audit/smoothing-audit.mjs)) sorted them, using
gates taken from the requirements — label run ≥ 3 bars, median detection delay
≤ 1 bar with P90 ≤ 2, ≥ 90% retention of events at and above the measure's own
entry threshold:

| shape | measures | behaviour |
|---|---|---|
| **REGIME** | Trend, OI 24H | persistent state with hysteresis; appears in WHAT CHANGED |
| **IMPULSE** | OI 4H, Premium, Participation, Spot RVOL, Perp RVOL | this bar only; no persistent state; appears in ANOMALIES but never as a regime transition |
| **CONTEXT** | Funding, ETF flow, SOPR | slow external feeds |

**OI 24H uses EMA(2)** on its z-score — the only candidate that cleared every
gate (label run 2 → 3 bars, 100% retention at 1.5σ/2.0σ/2.5σ, median delay 0).
EMA(3) and EMA(4) pushed P90 delay to 3–4 bars for no further gain.

**Trend uses no smoothing.** After hysteresis it already holds a median of 9
bars and transitions about once every 78. Smoothing would buy latency for
nothing.

**The other five could not be rescued**, and the reason matters: every candidate
either left the label flickering at a 1–2 bar median or destroyed the very
extremes the measure exists to report. OI 4H lost half its 1.5σ events at
EMA(3), with peak attenuation of 0.51. Premium lost 46% of its 2σ events at
EMA(2). So they report instantaneous spikes instead — zero latency, no state to
flicker, and nothing claimed to persist.

**Raw z is always displayed**, whatever the shape. A smoothed value that hid the
latest move would defeat the point of a monitor.

---

## Hysteresis

A Schmitt trigger: entering requires more evidence than staying. It is a
readability device and is **not** claimed to improve any decision.

Verified in [`audit/hysteresis-verify.mjs`](./audit/hysteresis-verify.mjs),
which first proves the JavaScript model reproduces the compiled Pine on all
13,164 bars — otherwise the numbers would describe a different state machine:

| measure | transitions | median run | retention | detection delay |
|---|---|---|---|---|
| OI 24H | 2122 → **1889** | 2 → **3** | 100% | **0 bars** |
| Trend | 223 → **169** | 5 → **9** | 99% | **0 bars** |

Because the entry threshold is unchanged, a first crossing is reported on the
same bar. The obvious alternative — requiring two consecutive bars — reaches
similar stability only by **losing 19–7% of events and delaying every entry by
up to 8 hours**.

Effect on the panel: WHAT CHANGED now fires on **15.4%** of bars, down from
64.5% before the REGIME/IMPULSE split.

---

## Dashboard

```
WHAT CHANGED          regime transitions only, vs the last confirmed bar
ANOMALIES: N          ranked by |z|, impulses marked *

REGIME    TREND · VOLATILITY · OI 24H          raw z + smoothed z + state
IMPULSE   OI 4H · PREMIUM · PARTICIPATION      raw z + smoothed z + this bar
          ALIGNMENT
CONTEXT   FUNDING · ETF 5D · SOPR

EVIDENCE: DESCRIPTIVE   ACTION: CONTEXT ONLY
```

### Cross-data alignment

Counts how many of price, OI, funding, premium and perp RVOL moved the same
direction over 24h. `STRONGLY ALIGNED 5/5` means the measurements agree with
each other — **not** that agreement predicts anything. `MIXED 3/5` means they
conflict, which is a reason to be careful reading them, nothing more.

### Evidence levels

| Level | Requirement | States here |
|---|---|---|
| DESCRIPTIVE | data and definition verified correct | **all of them** |
| SUPPORTED | retrospective matched analysis shows incremental value | none |
| VALIDATED | prospective out-of-sample on post-freeze data also passes | none |

---

## Setup

Paste [`main.pine`](./main.pine) into the Pine Editor and add to chart. Intraday
timeframe required; designed for 4H.

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
   The label is shown in the OI 24H row.
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
nothing". The script also warns if an adapter is enabled while its source is
still `close`, which would feed price into a funding z-score.

Open interest needs no adapter: it comes straight from the `_OI` service symbol.

**Unconfirmed:** whether TradingView's own built-in Fundamentals → Derivatives
studies expose selectable plots. The docs confirm a source input can receive
*"the values plotted by other scripts"* but also warn that *"not all indicators
can be calculated based on another indicator"*, and explicitly exclude
strategies. If built-ins are not selectable, these three adapters need a
community script that republishes the data.

---

## Alerts

OI 24H regime change · funding crowded long/short · premium spike · participation
spike · OI 4H spike · large OI reduction after an extreme expansion · ETF flow
regime change · SOPR crossing 1 · slow trend regime change

All fire on **confirmed 4H bar close only**. Impulse alerts are suppressed while
the previous bar was already spiking, so a multi-bar excursion reports once.

No `BUY`, `SELL`, `REDUCE` or `DO NOT CHASE`. None of those survived the audit.

---

## Testing

The dataset is not in the repository — it is 93 MB of Binance history. Build it
once first; everything else reads from the cache it writes.

```bash
cd ../btc-4h-regime-engine/data && node fetch.mjs    # ~2,200 daily OI files, one time
cd ../../btc-4h-market-intelligence

npm install
npm test                      # 1500 bars
node tests.mjs 6000

cd audit
node extract-states.mjs       # run the frozen indicator over the full dataset
node hysteresis-verify.mjs    # flicker and latency
node smoothing-audit.mjs      # REGIME vs IMPULSE decision
node event-log.mjs            # prospective log, from the freeze forward
```

`extract-states.mjs` writes `states.json` (5.8 MB), which is generated and not
committed. `event-log.json` **is** committed: it accumulates, and re-running
must never rebuild what it already recorded.

`decision-utility.mjs` audits the v1 state machine and refuses to run against a
v2 `states.json` rather than silently reporting zero episodes. Its findings live
in [`AUDIT.md`](./audit/AUDIT.md) and are what deleted the Action layer.

| Check | What it proves |
|---|---|
| runs | transpiles and executes against genuine multi-symbol data |
| state ranges | no state ever leaves its declared vocabulary |
| **no repaint** | truncating and re-running leaves every past bar identical, hysteresis states included |
| **units guard** | USD-notional OI is rejected by magnitude *and* by declared currency, tested independently |
| absent feed | SOPR missing → no value, no state, no anomaly |
| z-scores | rolling z-scores are actually standardised |
| **premium definition** | perp premium correlates with realised funding at **r = 0.63** (0.75 on the 24h mean) — as it must, since Binance derives funding from the premium index. This separates "measuring basis" from "measuring noise" |
| anomaly count | the headline number equals the engaged measurements, on every bar |
| alignment bounds | the alignment count is arithmetically possible on every bar |
| dashboard | all sections render, and no prescriptive or predictive text survives |

The suite also asserts the harness's spot and perp series are genuinely
different. PineTS strips exchange prefixes, so a chart symbol of `BTCUSDT`
collides with the stripped form of `BINANCE:BTCUSDT`; spot then silently
resolves to the perp, premium becomes identically zero, and everything passes
while testing nothing. That trap was hit once during development.

### Prospective evidence

The historical window has been examined too many times to serve as
out-of-sample. [`audit/event-log.mjs`](./audit/event-log.mjs) records every
regime transition and impulse spike **from the v2 freeze forward**, with the
full feature vector and forward outcomes filled in as bars arrive.

Those outcomes are not evidence today. Reading them before pre-registering a
hypothesis is exactly how the historical window stopped being usable.

### Limitations

- **PineTS is not TradingView.** Two rewrites are applied for the offline run
  only: PineTS re-runs the whole script inside `request.security()` (TradingView
  evaluates just the expression), and its `na()` cannot handle an `na` array.
  Both are documented in `tests.mjs`.
- Not verified offline: real symbol spelling and history depth, the
  lower-timeframe flow proxy, `input.source()` adapters, visual layout, alerts.
- **The flow proxy has a hard history ceiling.** `request.security_lower_tf()` is
  capped at 100,000 intrabars on Basic through Premium (125K Expert, 200K
  Ultimate). At 5-minute intrabars on a 4H chart that is ~2,000 bars, about 11
  months. Older bars return an empty array.
- Daily feeds are always **one full day behind** by construction — the
  non-repainting idiom requests the previous completed daily value. Glassnode's
  own publication lag stacks on top.
- Binance OI history has 12 bars at exactly zero between 2022 and 2025. The
  script rejects them; a naive `oi/oi[1]-1` would read −100% and poison the
  z-score window.
- The flow proxy classifies a lower-timeframe bar as buy-side if it closes up.
  Wrong on individual bars, roughly right in aggregate. Real aggressor data needs
  footprint, which repaints by design and is barred from anything historical.
- Spot and perp RVOL were classified IMPULSE **by analogy** with the
  participation ratio they compose, not separately audited.
