# BTC Trading Assistant

Plan a BTC trade in 30 seconds.

- Confirmed 4H BTC market context
- A plan from four settings
- Cost-aware position sizing
- Fixed-risk sizing (percent of equity or fixed cash)
- Finite risk / reward zones drawn on the chart
- Live R and estimated net P&L
- Plan alerts
- No automatic signal claims

---

## Quick start

**Install**

1. Open TradingView → Pine Editor.
2. Paste [`main.pine`](./main.pine).
3. Add to chart.

**Then**

1. Enable **Trade plan**.
2. Choose **Long** or **Short**.
3. Type the **Stop price** — where your idea is wrong.
4. Set **Account equity** and **Risk (%)**.

That's it.

Entry follows the current price. The target defaults to 2R. Trading costs are
included. Position size, risk, cost and break-even update as you change it.

Market context needs nothing at all — it is drawn from the moment you add the
indicator, with default symbols and every optional feed off.

Everything under **Advanced** is optional. You never have to open one of those
groups to size a trade.

**Timeframes.** 15m, 1H and 4H. The script refuses anything above 4H, because
requesting the 4H context from a daily chart would mean reading inside an
unfinished bar.

5m also runs, and the offline suite verifies it — the context clock, the
completed-bar guarantee and the absence of lookahead are all asserted on
synthetic 5m bars. It has **not** been confirmed in the TradingView Pine Editor.
[`TRADINGVIEW-VALIDATION.md`](./TRADINGVIEW-VALIDATION.md) carries that check as
manual item 3 and marks it the gate for listing 5m here as supported. Until it is
done, treat 5m as offline-verified, manual-validation pending.

---

## How to read the Decision view

Decision is the default. With no plan entered, the market is the subject:

```
BTC TRADING ASSISTANT
4H CONTEXT · DATA OK · closed 1h 20m ago
MARKET        Strong uptrend    above 200d
VOLATILITY    Elevated          ATR 1.82%
POSITIONING   Normal            OI +0.41% / 24H
SET A PLAN                      Enable Trade plan to size a trade
DISCRETIONARY MODE · NO AUTO ENTRIES
```

Turn the plan on and the first thing it asks for is the only thing it cannot work
out for itself:

```
BTC TRADE PLAN
LONG · PLANNING
SET STOP · enter your invalidation price in the settings
4H CONTEXT                 Uptrend · elevated vol · OI normal
DISCRETIONARY MODE · NO AUTO ENTRIES
```

No size is computed until it has one. An ATR stop is available under **Advanced —
plan** and is deliberately not the default: a stop the tool chose would read as
the tool deciding where your idea is wrong.

| Row | What it means | What it does **not** mean |
|---|---|---|
| `4H CONTEXT` header | Whether the four core feeds are healthy, and how long ago the 4H bar behind these readings closed. Below 4H the readings are the last **completed** 4H bar, held for the period, so they cannot repaint. | Not a live 4H reading on a 15m chart. The panel prints the age precisely so you cannot assume it refreshes. |
| `MARKET` | Where price sits relative to the confirmed daily 200MA, combined with the sign of 12-week momentum. | Not a forecast. "Strong uptrend" describes the past. |
| `VOLATILITY` | How unusual current realised volatility is against its own history. | Not a risk instruction. |
| `POSITIONING` | Whether the 24H open-interest change is unusual, and in which direction. Direction always comes from the raw sign. | Not bullish or bearish. Positions building is not a prediction. |
| `WATCH` | Appears only when something is unusual: one sentence for the anomaly you would most regret not being told about, or a broken feed, which outranks everything. | Not a trigger. |

**Percentiles and σ mean rarity, never direction.** A reading can be extremely
unusual and carry no directional implication whatsoever. An earlier design fused
the two axes and could print "EXPANDING" for a *falling* open-interest number.
Raw value decides what happened; percentile and σ decide only how unusual it is.

Once a plan is on, the plan becomes the subject and the market compresses to one
line. This is a **Planning** plan — you have not entered yet:

```
BTC TRADE PLAN
LONG · PLANNING
ENTRY         79,800.00    planned
STOP          79,200.00    0.75%
TARGET        81,000.00    2.00R · net 1.87R
PRICE→ENTRY   +2.38R       +$1,431 · 1.79%
POSITION      $10,000      0.1253 BTC
MAX LOSS      $85          0.85%  ·  SIZE CAPPED
              requested $100   capped at 1x equity
COST          $10          0.13R  ·  in sizing
BREAKEVEN     79,879.84    10 bp
4H CONTEXT                 Uptrend · elevated vol · OI normal
DISCRETIONARY MODE · NO AUTO ENTRIES
```

That is $10,000 equity, 1% risk, 1.0x max exposure, 5 bp each side, price at
81,231. Two things in it are worth explaining.

**Why the cap binds.** The stop is 600 wide and costs add 79.50 per unit, so the
$100 budget buys 0.1472 BTC — $11,743 of notional on $10,000 of equity, which is
1.17x. The cap is 1.0x, so the size is cut to 0.1253 BTC, exactly $10,000 of
notional. The panel says `SIZE CAPPED` and reports the risk you are **actually**
taking ($85) beside the one you asked for ($100). Raise **Max exposure** or widen
the stop and the cap stops binding.

**Why the target shows two R figures.** R is the gross stop distance, 600, and
the target sits 2R above entry. Costs eat 0.13R of that, so it is worth 1.87R net.
Decision prints the net figure only when costs move it by at least a tenth of an
R; below that it prints the gross R alone. `MAX LOSS` is the money, `COST` is the
friction, and Detailed carries the full breakdown including what one unit really
loses at the stop (1.13R, not 1R — the 600 plus both sides of cost).

Once you are in, switch on **Position opened** and enter your fill. The status
line reads `ACTIVE` and the live numbers lead:

```
BTC TRADE PLAN
LONG · ACTIVE
LIVE          +0.63R
NET P&L       +$37         gross +$47
ENTRY         79,800.00    filled
STOP          79,200.00    0.75%
TARGET        81,000.00    2.00R · net 1.87R
TO STOP       1.63R
TO TARGET     1.37R
POSITION      $10,000      0.1253 BTC
MAX LOSS      $85          0.85%  ·  SIZE CAPPED
              requested $100   capped at 1x equity
COST          $10          0.13R  ·  in sizing
BREAKEVEN     79,879.84    10 bp
4H CONTEXT                 Uptrend · elevated vol · OI normal
DISCRETIONARY MODE · NO AUTO ENTRIES
```

Same plan, price now 80,178. `PRICE→ENTRY` is replaced by `TO STOP` and
`TO TARGET`, and `LIVE` / `NET P&L` appear at the top.

`PRICE→ENTRY` appears only with a **manual planned entry**. With the default live
entry the market *is* the entry, so the row could only ever print `+0.00R`.

### One definition of R

**R is the gross stop distance in price.** The 1R/2R/3R ladder, `LIVE`,
`TO STOP`, `TO TARGET`, `PRICE→ENTRY` and `COST` are all in that same unit, so
any two of them can be compared directly. Costs never move the target; they move
what the target is worth, which is what the net figure reports.

The consequence is the `1.13R` above: with costs included in sizing, the money
lost at the stop is slightly **more** than 1R.

### Display modes

| Mode | For |
|---|---|
| **Decision** | Default. The market in three lines and your plan. No z-scores, percentiles, sample counts or research vocabulary. |
| **Detailed** | Every measure with its raw value, percentile and σ, every feed's freshness, recent events, and what changed. |
| **Debug** | Detailed plus sample counts, exact σ, status codes and internal state codes. |

**Panel size** is Compact / Normal / Large, and scales the Decision view.

**Position** defaults to **Middle right**, arrived at by trying the alternatives
on a real chart rather than by reasoning about them.

The **top** of the chart carries TradingView's symbol and OHLC header, which
covers a panel in either top corner. The **right** carries the price scale, whose
current-price label follows price and can cross a panel at any height. Middle
right avoids the header, which is fixed, and accepts the label, which is not: no
position on a TradingView chart is collision-free, and an obstruction that moves
away is easier to live with than one that is always there.

All six positions are offered. If your layout differs — a hidden price scale, a
different header setting — pick whatever suits it.

The mode is presentation only. It selects which rows are drawn and reaches no
measurement, threshold, state definition, event or alert — every observable
output is identical in all three modes, asserted bar by bar in the test suite.

Colours are derived from `chart.bg_color` using Rec. 601 luma, so the same script
is legible on a light theme and a dark one. There are no colour inputs to
maintain.

---

## How to plan a trade

Turn on **Trade plan**, then:

Four controls, and one of them you set once:

| Setting | Group | |
|---|---|---|
| Enable trade plan | Trade plan | Off by default |
| Direction | Trade plan | Long or Short — yours, not the tool's |
| Stop price | Trade plan | Where your idea is wrong. Type the price |
| Account equity | Account | Set once |
| Risk (%) | Account | What the trade loses if the stop is hit. Default 1% |

Nothing is sized until the stop is set. The panel says `SET STOP` rather than
guessing your invalidation for you — that choice is the one every other number
here depends on.

**Everything else has a default.** Entry follows the current price, the target
sits at 2R, risk is a percentage of equity, costs are in the sizing, and the
position is not open yet. Each is overridable under **Advanced**, and none needs
to be touched.

| Advanced — plan | |
|---|---|
| Use manual entry | Pin the planned entry to a price instead of following the market |
| Use ATR stop | Place the stop a chart ATR(14) multiple from entry. A distance convention, not a prediction, and deliberately off by default |
| Use custom target | A target price instead of a multiple of R |
| Target (R) | Default 2.0 |
| Position opened | Off while planning, on once you are in |
| Actual fill price | Required once the position is open |

| Advanced — risk | |
|---|---|
| Use fixed cash risk | A flat amount instead of a percentage of equity |
| Max exposure (x equity) | Caps position notional. When it binds, the panel says `SIZE CAPPED` |

`Stop price`, `Manual entry price`, `Custom target price` and `Actual fill price`
are `input.float` fields — typed, not dragged. Everything downstream — size, risk,
cost, targets, break-even, the drawn zones — updates as you change them.

They were `input.price` until v1.2.5, which is draggable and was the nicer
interaction. `input.price` also adds a horizontal marker of TradingView's own to
the chart: always, with no parameter to hide or restyle it, and none that binds it
to a price scale. So the chart could show two stops — TradingView's marker and
this script's line — with no way to guarantee they agree. One price you have to
type beats two that disagree, so the draggable marker is gone and the script's own
line is the only stop on the chart.

Two behaviours never need a dropdown, so each of these is a checkbox that says
what it does. An input that cannot affect anything in the current configuration
is still greyed out — an editable ATR multiple beside an ATR stop that is
switched off is an invitation to set a number that is silently ignored.

### Before and after you are in

**Position opened, off** — you are still planning. The panel shows what the
position would be and how far price still is from your entry (`PRICE→ENTRY`, in
R, dollars and percent), and reads `PLANNING`. Alerts watch the entry level.

**Position opened, on** — you are in it. The panel switches to `LIVE` R,
estimated net P&L, `TO STOP` and `TO TARGET`, and reads `ACTIVE`. Alerts watch
the stop and the target instead.

Opening the position requires the **actual fill price** — the price you got. The
panel says `SET ACTUAL FILL PRICE` and computes nothing until it has one, rather
than silently following the market: an entry recomputed every tick has no fill to
measure a live R from, and would report +0.00R forever while the position moved.

### On the chart

Entry, stop and target are drawn as solid lines; the 1R/2R/3R ladder as thin
dashed reference lines; break-even as a dotted line. They span the whole chart,
because a price is true everywhere on it.

Two faint boxes shade the **risk zone** (entry to stop) and the **reward zone**
(entry to target). They are **16 chart bars** wide and hang off the right edge of
whatever you are looking at, so scrolling back through history does not leave the
plan stranded at the last bar:

```
                        ┌─────────────┐  TARGET
                        │ reward      │
◄─── ENTRY ─────────────┼─────────────┤ ───►
                        │ risk        │
                        └─────────────┘  STOP
                        ↑             ↑
                    last bar      +16 bars
```

The lines extend both ways, so the plan's prices are readable wherever you
scroll. The boxes are anchored to the last bar and reach into the empty space to
its right, so they scroll with the candles like any other chart drawing.

v1.2.2 pinned the boxes to the visible range instead, so they could never leave
the screen. That was wrong: a shape that holds its screen position while the
chart slides underneath it reads as a watermark, not as a drawing on the chart —
and reading the visible range made TradingView re-execute the whole script on
every scroll and zoom. Both are gone.

They are deliberately finite. Until v1.2.1 they carried `extend.right`, which on
a real chart is not a zone at all — it is a permanent coloured background over
everything to the right of the plan, burying the candles it is meant to sit
behind. A plan is a compact object near the current price.

For a short the boxes flip: the risk box runs from the stop down to the entry,
and the reward box from the entry down to the target. That assignment is written
out per direction in the source and asserted per direction in the tests, rather
than derived with `max`/`min` — both give the same numbers, and only one of them
notices when a future edit gets the sign wrong.

Each can be switched off. Prices are rounded to the instrument's tick before they
are drawn or printed, because a price the exchange cannot accept is not a price
you can put an order at.

#### Every level is drawn by the script, on the main pane

There is exactly **one** horizontal level per price on the chart, and the script
owns it. Two things make that true:

- **No `input.price` anywhere.** It is draggable, which was nicer, but it also
  adds a marker of TradingView's own that cannot be hidden or bound to a scale
  from Pine — so the chart could show two stops with no guarantee they agreed.
  Prices are typed now.
- **`force_overlay = true` on every line and box.** All seven levels are created
  at a single `line.new()` and both zones at a single `box.new()`, so the
  parameter cannot be missed when a level is added later.

The panel row and the line are the same value in the source — `px(rt(stopPx))`
and `rt(stopPx)` — so a number on the panel and the line beside it cannot
disagree. Pine draws a line at the price it is given.

**If the levels are still at the wrong height,** or they do not move with the
candles when you pan vertically, the indicator instance is bound to the wrong
price scale. One toggle tells you: switch on **Daily 200MA** under Display, which
plots a real price series that should sit on the candles. If *it* is wrong too,
the whole indicator is on the wrong scale, and the remedy is TradingView's —
right-click the indicator's name in the legend → **Pin to Scale** → the scale the
price is on (usually `Scale A` / Right). `No Scale` produces exactly this symptom.

That setting is saved per instance in the chart layout, so re-adding the indicator
clears it. `force_overlay` is the strongest binding to the main pane that Pine
offers and the script now uses it everywhere; whether it *also* overrides a
mis-pinned scale is not documented and is recorded as an open question, manual
item 47. What is not available is a `scale` argument that would help: omitting it,
as the script does, is what binds a script to the chart's existing scale, while
`scale.none` causes this symptom and `scale.right` would attach to a *new* right
scale rather than the candles'.

### Plan alerts

Off by default. When on, they fire on **confirmed bars only**, once per level:
Planning alerts when price touches your entry; Active alerts when it touches your
stop or your target. `1R / 2R / 3R` alerts are separately opt-in.

A level re-arms when it **moves**, so changing your stop to a new price arms it
again while price oscillating around an unchanged stop fires once.

Create the alert on the indicator using **Any alert() function call**.

### When the plan refuses to size

Two conditions block the plan outright. Each says which one it is and what to do; market
context is unaffected by all three, because it comes from `request.security` on
the reference symbol and returns the true series regardless of how your chart is
drawn.

| Condition | What the panel says | What you do |
|---|---|---|
| Non-standard chart type (Heikin Ashi, Renko, Line Break, Kagi, Point & Figure) **with a live entry** | *Non-standard chart type. Its prices are synthetic — switch on Use manual entry to size from a real price.* | Switch on `Use manual entry`, or move to a standard candle chart. A synthetic close would produce a real quantity from an imaginary price. |
| Non-linear instrument (point value ≠ 1) | *Non-linear instrument — sizing assumes one quote unit per unit of price.* | Use BTC spot or a USDⓈ-M linear perpetual. Inverse / coin-margined futures are **not supported**: their payoff is convex in price and the arithmetic here does not describe it. |

An instrument whose runtime reports no point value is treated as unknown and
allowed through — a false rejection on a correct chart is worse than the warning
it replaces.

Two states are **incomplete** rather than blocked, and the panel names the next
action instead of calling them an error: `SET STOP` when no invalidation has been
set, and `SET ACTUAL FILL PRICE` when the position has been marked open without
one.

Two softer warnings do not block at all: a size below the instrument's minimum
order, and a chart that is not BTC (context is always BTC; the plan uses your
chart's price).

---

## Trading costs

`Entry cost (bp)` and `Exit cost (bp)`, both defaulting to **5.0**, are
commission **plus the slippage you expect**, for **one** side, in basis points of
notional. 1 bp = 0.01%.

**This is not a live Binance fee lookup and does not claim to be one.** The
defaults are a round 5 bp — close to a USDⓈ-M taker commission with nothing
allowed for slippage. They are a starting point, not a measurement of your
execution. **Enter your own real cost.** Your maker/taker tier, your order type
and the depth you actually eat are things only you can measure.

With **Include costs in position sizing** on (the default), the risk budget
covers the stop loss *and* the round trip, so being stopped out costs what you
said you would risk. With it off, sizing ignores costs and the panel still
reports what they would be.

The arithmetic, with `e = entryBp / 10000` and `x = exitBp / 10000`:

```
risk per unit  = |entry − stop| + entry × e + stop × x

position size  = risk budget ÷ risk per unit,
                 then capped at maxExposure × equity ÷ entry

break-even     long   entry × (1 + e) / (1 − x)
                short  entry × (1 − e) / (1 + x)
```

Costs are per side, in basis points of the notional traded **at that side's
price**, so the exit cost at a stop and the exit cost at a target are different
numbers — as they are in reality.

---

## What it does **not** do

**It does not currently generate validated automatic long/short signals.** The
panel's footer says so every bar:

```
DISCRETIONARY MODE · NO AUTO ENTRIES
```

That footer replaced v1.0's full-width `AUTOMATIC SIGNAL — NONE VALIDATED` row.
**The form changed, the meaning did not** — it spent the most valuable line on
the panel restating something that never changes, so it moved to the footer. The
substance is unchanged: there is no validated automatic entry model here, and
none is claimed.

That is a finding, not an omission. **Eight pre-registered studies** in
[`research/`](./research/) looked for a tradable directional edge — 4H regime
state, an action-layer audit, a risk-budget module, 96 trade-rule combinations,
intraday breakout / sweep / VWAP setups, a published academic replication, raw
aggressive trade flow, and years of Level-2 order-book data. None produced one
that survives trading costs.

Also absent, deliberately: composite scores, confidence percentages,
probabilities, directional readings of funding or open interest, and any
order-book display.

---

## Evidence and limitations

Start at [`research/EVIDENCE.md`](./research/EVIDENCE.md) — an index of every
study, what it asked and what it found.

The clearest result, and the most tempting one to misuse, is the order book.
Depth imbalance predicts the next 30 seconds with **t = 14.66** in development and
**6.38** in validation. Traded through a walk-the-book fill model it earns
**+0.236 bp** per trade gross against **10 bp** of round-trip commission:
**−9.764 bp** net, indistinguishable from entering at random. Real information,
no tradable edge.

That study is not finished. Its validation split is only **three days** and its
locked test split is **empty**, so the four information gates were never
*evaluable*. It is reported as **`PRELIMINARY — BLOCKED`**, not as a pass or a
fail. The economics, though, are a **ratio rather than a p-value**: more data
could move the t-statistic, but not by the factor of forty the edge would need.

Other limitations worth knowing:

- **Market context is 4H, always.** Below 4H it is the last completed 4H bar,
  held for the period. The panel prints how long ago it closed.
- **Context is BTC, always.** On a non-BTC chart the panel says so rather than
  silently adapting.
- **A USD-notional open-interest feed is rejected outright.** Notional OI moves
  with price; in testing it labelled 91% of pullbacks "healthy deleveraging".
- **Feed freshness is measured, not assumed.** A feed that goes stale has its
  readings withdrawn rather than left standing. The four optional
  `input.source()` adapters have no upstream timestamp, so they report *update
  activity* (`ACTIVE` / `UNCHANGED 1 BAR` / `LIKELY STALE`) and never claim to be
  "fresh".
- **Offline tests are not a TradingView compile.** See
  [`TRADINGVIEW-VALIDATION.md`](./TRADINGVIEW-VALIDATION.md).

### Settings this version deliberately does not expose

The normalisation windows and the hysteresis thresholds are **frozen constants**,
not inputs. Every one was chosen by a study in `research/` — the windows by the
sample-size analysis, the thresholds by the stability audit. They are
research-defined semantics, not user preferences: exposing them invited a user to
retune the meaning of a reading and then compare their panel with someone else's.

The plan's five mode dropdowns — Stage, Entry, Stop, Target and Risk per trade —
are gone as well, replaced by defaults and by checkboxes that say what they do.
Each of them asked a first-time user to learn an internal distinction before they
could size a trade. Flexibility that costs comprehension is not free.

---

## Suggested workflow

Two separate published indicators, used one after the other:

1. **[`session-highs-and-lows-indicator`](../session-highs-and-lows-indicator/)**
   to identify the price levels you care about — session highs and lows.
2. **BTC Trading Assistant** to plan and size the trade against one of them:
   enter the level that would invalidate the idea as the stop, read the size,
   risk and cost, set an alert.

They are not merged, and neither modifies the other. The session indicator is a
separate script with its own release history; this one adds no level detection of
its own.

---

## Tests

```bash
npm install
npm test
```

Runs the Pine suite (PineTS on Node, against locally recorded Binance data) and
the collector suite. Includes the bar-by-bar differential against both indicators
this product replaces, kept under `tests/baseline/` so it stays runnable.

The suite's observation hooks live in `tests/build-instrumented.mjs` and are
appended to the real source at test time. What you paste into TradingView is the
product, with nothing in it that exists only for a test.

Offline tests are not a TradingView compile. See
[`TRADINGVIEW-VALIDATION.md`](./TRADINGVIEW-VALIDATION.md) for what is verified
automatically and what still requires the Pine Editor. Nothing here should be
read as "fully validated" until those manual checks have been done.

---

## Licence

MPL-2.0. See [`../LICENSE`](../LICENSE).
