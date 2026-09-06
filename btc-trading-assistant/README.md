# BTC Trading Assistant

A TradingView indicator for discretionary BTC traders. It tells you what state
the market is in, and it turns a trade you have decided on into a position size.

It does **not** tell you what to buy or when.

---

## What it does

**Market context.** Four lines describing BTC's 4H state: trend, volatility,
positioning, and the one thing currently worth looking at. Every reading comes
from `BINANCE:BTCUSDT.P` and its spot and open-interest feeds, whatever chart you
are on, so the numbers do not change when you switch symbols.

**Trade planning.** You supply direction, entry and invalidation. It computes the
position size that risks a fixed fraction of your account, caps it at the
exposure you allow, and draws the stop and the 1R/2R/3R ladder.

**Data honesty.** Every feed's freshness is measured, not assumed. A feed that
goes stale has its readings withdrawn rather than left standing. A USD-denominated
open-interest feed is rejected outright, because notional OI moves with price and
cannot measure positioning.

---

## Install

1. Open TradingView → Pine Editor.
2. Paste [`main.pine`](./main.pine).
3. Add to chart.

Works on 15m, 1H and 4H BTC charts. Nothing needs configuring — market context
appears immediately, on default symbols, with every optional feed switched off.

---

## Reading the Decision view

```
BTC TRADING ASSISTANT

MARKET            Strong uptrend
VOLATILITY        Elevated
POSITIONING       Normal
WATCH             No unusual market condition

YOUR TRADE
  PLAN            NOT SET

AUTOMATIC SIGNAL  NONE VALIDATED
```

| Row | What it means | What it does **not** mean |
|---|---|---|
| `MARKET` | Where price sits relative to the confirmed daily 200MA, combined with the sign of 12-week momentum. | Not a forecast. "Strong uptrend" describes the past. |
| `VOLATILITY` | How unusual current realised volatility is against its own history. | Not a risk instruction. |
| `POSITIONING` | Whether 24H open-interest change is unusual, and in which direction. Direction comes from the raw sign, always. | Not bullish or bearish. Positions building is not a prediction. |
| `WATCH` | The single most notable current anomaly, in plain English — or a broken feed, which outranks everything. | Not a trigger. |
| `AUTOMATIC SIGNAL` | Permanently `NONE VALIDATED`. | Exactly what it says. |

**Percentiles and σ mean rarity, never direction.** A reading can be extremely
unusual and carry no directional implication whatsoever. That distinction is the
reason this indicator exists in its current form; an earlier version fused the
two axes and could print "EXPANDING" for a *falling* open-interest number.

---

## Planning a trade

Turn on **Trade plan**, then set:

| Input | |
|---|---|
| Direction | Long or Short |
| Entry price | `0` follows the live price; set a value to pin a level you are stalking |
| Invalidation price | `0` places it at an ATR multiple from entry — a distance convention, not a prediction |
| Account equity | |
| Risk per trade (%) | |
| Max exposure (×equity) | Optional cap. When a tight stop would demand leverage you do not allow, the size is capped and the panel shows the risk **actually** taken, not the one you asked for |

The panel then shows direction, entry, stop and its distance, position notional
and size, risk taken, and the three R targets. Entry, stop and the R ladder are
drawn on the chart.

This is arithmetic. It makes no claim about whether the trade is a good one.

---

## Display modes

| Mode | For |
|---|---|
| **Decision** | Default. The four context lines, your plan, and the standing no-signal statement. Nothing that is behaving normally is printed. |
| **Detailed** | Every measure with its raw value, percentile and σ; every feed's freshness; recent events; what changed. |
| **Debug** | Detailed plus sample counts, status codes, the context clock, and unrounded σ. |

The mode is presentation only. Every measurement is identical in all three,
asserted bar by bar in the test suite.

---

## What it does not do

**It does not currently generate validated automatic long/short signals.**

That is a finding, not an omission. Eight pre-registered studies in
[`research/`](./research/) looked for a tradable directional edge — 4H regime
state, 96 trade-rule combinations, intraday breakout and sweep and VWAP setups, a
published academic replication, raw aggressive trade flow, and years of Level-2
order-book data — and none produced one that survives trading costs.

The clearest case is the order book. Depth imbalance predicts the next 30 seconds
with a t-statistic of 14.66 in development and 6.38 in validation. Traded through
a realistic fill model it earns **+0.236 bp** per trade gross against **10 bp** of
commission: **−9.764 bp** net, which is indistinguishable from entering at
random. Real information, no tradable edge.

So the panel says so, every bar, on its last row.

Also absent, deliberately: composite scores, confidence percentages,
probabilities, directional readings of funding or open interest, and any
order-book display.

---

## Research and evidence

Start at [`research/EVIDENCE.md`](./research/EVIDENCE.md) — an index of every
study, what it asked, and what it found.

- [`research/rejected-studies/`](./research/rejected-studies/) — the four
  condensed records: regime, 4H trade plan, intraday, microstructure.
- [`research/microstructure/m2h.md`](./research/microstructure/m2h.md) — the full
  historical Level-2 record.
- [`research/MIGRATION.md`](./research/MIGRATION.md) — how this product was
  consolidated from five earlier projects, and how each claim was verified.

[`tools/microstructure/`](./tools/microstructure/) holds the live order-book
collector for the still-running prospective study. It is research
infrastructure; nothing it records reaches the indicator.

---

## Tests

```bash
npm install
npm test
```

Runs the Pine suite (PineTS on Node, against locally recorded Binance data) and
the collector suite. Includes the bar-by-bar differential against both
indicators this product replaces, kept under `tests/baseline/` so it remains
runnable.

Offline tests are not a TradingView compile. See
[`TRADINGVIEW-VALIDATION.md`](./TRADINGVIEW-VALIDATION.md) for what is verified
automatically and what still requires the Pine Editor.

---

## Licence

MPL-2.0. See [`../LICENSE`](../LICENSE).
