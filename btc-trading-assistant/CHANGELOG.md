# Changelog

## 1.2.5

Code hardening for the reported misalignment. v1.2.4 diagnosed it and changed no
Pine, which was not a product outcome; this release changes the product so that
the chart carries exactly one authoritative price geometry and it belongs to the
script.

### Changed

- **No `input.price` anywhere. All four price inputs are `input.float`.**
  `Stop price`, `Manual entry price`, `Custom target price` and `Actual fill
  price` are typed now, not dragged.

  `input.price` adds a horizontal marker of TradingView's own to the chart — *by
  default*, with no `confirm` needed, with **no parameter to hide or restyle it**,
  and with nothing in Pine that binds it to a price scale. So the chart could show
  two stops: TradingView's marker and this script's line, with no way to guarantee
  they agreed, and the blue `72,940.9` on the price scale in the report is almost
  certainly that marker — nothing else in the script draws a price-scale label,
  because `line` objects do not create one and the only `plot` is `na` by default.

  Losing the drag is a real cost and the nicer interaction is gone. One price you
  have to type beats two that disagree.
- **`force_overlay = true` on every line and box.** All seven levels are created
  at one `line.new()` and both zones at one `box.new()`, so a level added later
  cannot miss it.

  Stated honestly: the documentation says `force_overlay` controls **pane** — "the
  drawing will display on the main chart pane, even when the script occupies a
  separate pane" — and says nothing about scale. This script is already
  `overlay = true`, so by that reading the parameter is a no-op here. It is
  carried because it is free, additive, and is the strongest binding to the main
  pane Pine offers, on the chance that it also governs scale resolution. Whether
  it does is manual item 47, and the answer belongs in this file once someone
  looks.
- Panel text and tooltips no longer offer a drag: `SET STOP · drag the stop line`
  became `SET STOP · enter your invalidation price in the settings`.

### Added

- **`poc/scale-binding-poc.pine`** — a minimal reproduction that draws the same
  price as a `force_overlay` line *and* as a plain line, plus an `input.price`
  marker beside a `force_overlay` line at a second shared price. Four visuals, one
  chart: it separates "does `force_overlay` govern scale" from "does the
  `input.price` marker agree with a line" by looking. Its header states what each
  outcome means. This is the only `input.price` left in the repository, and it is
  there because it is the thing under test.
- **Manual items 47–50**, including the hostile state the report asked for:
  deliberately pin the indicator to `No Scale` and record what happens to the
  `force_overlay` drawings versus the marker.
- **11 more offline checks.** Both constructors are asserted to be called exactly
  once and to carry `force_overlay`; each of the nine handles is asserted to route
  through `lvlLine()` / `zoneBox()`, which is what makes the coverage claim
  structural rather than a list someone has to maintain; no `input.price` remains;
  each price input is an `input.float`; no tooltip still promises a drag.

### Unchanged

Sizing, risk budget, cost model, break-even, R, targets, live P&L and market
context. `t_entry`, `t_stop`, `t_target` and `t_riskPerUnit` are identical, and a
stop entered as 72,940.9 is still printed and drawn at 72,940.9.

**Still unconfirmed on a chart.** No one has opened the Pine Editor on this
release. The `input.price` removal closes the two-conflicting-visuals failure by
construction — the call is gone, so the marker cannot be drawn. Whether
`force_overlay` fixes a mis-pinned scale is a question this release does not
answer and does not claim to.

## 1.2.4

No Pine change. A reported misalignment — the panel printing `STOP 72,940.9`
while the stop line sat near 65k of chart height, and the levels not moving with
the price axis under a vertical pan — was diagnosed to the chart's price-scale
binding rather than to this script, and the diagnosis was written down instead of
guessed at.

### Why no code changed

The panel row and the level line are the **same value** in the source: the row is
`px(rt(stopPx))`, the line is `rt(stopPx)`. Pine cannot draw a line at a price
other than the one it is handed, so a line rendering at a different height than
the number beside it is a statement about which scale TradingView has bound the
indicator to. TradingView documents this symptom under `No Scale`: *"The
indicator moves independently from the candles when you scroll or zoom"*, *"The
line 'floats' across the screen and doesn't 'stick' to the price bars."*

The declaration is already the correct one — `overlay = true` with no `scale`
argument, which binds a script to the chart's existing price scale. Both
alternatives are worse and both look like fixes: `scale.none` is the documented
*cause*, and `scale.right` attaches to a *new* right scale rather than the one
the candles use. There is no Pine API that pins an instance to the main scale, so
this is preventable in documentation only.

**This diagnosis is unconfirmed.** Nobody has opened the chart. Manual items
40–46 are what would confirm or refute it.

### Added

- **`PRICE-SCALE ALIGNMENT`, 7 offline checks.** Three assert the declaration and
  that the file never names `scale.none` / `scale.left` / `scale.right`; four
  assert, per level, that the panel row and the line are drawn from the same
  `rt()` of the same variable, and that the printed number equals the drawn
  coordinate for `ENTRY`, `STOP`, `TARGET` and `BREAKEVEN`.

  These prove `panel price == drawing's y value`. They say nothing whatever about
  `drawing's y value == where TradingView renders it`, which is the actual
  complaint. The section's own comment says so, because this is the third visual
  defect in a row that a green suite did not see.
- **Manual items 40–46**, including a one-toggle discriminator: switching on
  `Daily 200MA` plots a real price series that should hug the candles. If it is
  at the wrong height too, the indicator is on the wrong scale and no drawing is
  involved. It also supplies something to right-click — by default this script's
  only plot is `na` on every bar, so there is usually no plotted line on the chart
  to open `Pin to Scale` from.
- **A README section** under *On the chart* with the same discriminator and fix.

## 1.2.3

v1.2.2 fixed the drawing complaint by making the boxes hold their position on
screen. That was the complaint.

### Fixed

- **The plan drawings are anchored to the bar again.** The risk/reward boxes now
  run from the last bar to `PLAN_BARS` in front of it, in the empty space to its
  right, and scroll with the candles like every other drawing on the chart —
  which is what v1.2.1's specification asked for in the first place
  (`leftX = current last bar time`, `rightX = leftX + N bars`).

  v1.2.2 anchored them to `chart.right_visible_bar_time` so they could never
  leave the screen. A shape that keeps its screen position while the chart slides
  underneath it does not read as part of the chart; it reads as a watermark, and
  it is the same "stuck in place" appearance the original report was about. The
  level lines keep `extend.both`, so scrolling away from the boxes still never
  costs you the plan's prices.

### Removed

- **Nothing reads the chart's visible range any more.** That read made
  TradingView re-execute the entire script — 13 `request.security` calls and a
  2,190-bar percentile — on every scroll and zoom, whether or not a plan was
  enabled. Manual item 35 existed to decide whether that cost was worth paying;
  it is not being paid, so it is gone, along with the harness substitution and
  the fallback path that existed only to serve it.

### Notes

Two visual defaults have now been wrong on a real chart three times between
them, and the offline suite passed on every one. The assertion that replaces the
scroll check is the plainest statement of what "moves with the chart" means: the
box's left edge must be a distinct value on every bar, one bar apart. That is
falsifiable offline; "looks right when you pan" is not, which is why manual item
34 stays.

## 1.2.2

A second pass over v1.2.1's visuals, driven the same way: by looking at a real
chart rather than at a test run.

### Fixed

- **The dashboard defaults to `Middle right`.** v1.2.1 moved it to `Top left` to
  get out from under the price scale; on a real chart that put it under
  TradingView's symbol and OHLC header instead. The top of the chart is covered
  by the header, the right is crossed by the current-price label — so the
  default now avoids the header, which is fixed, and accepts the label, which
  moves with price. No position on a TradingView chart is collision-free, and
  this file has now claimed otherwise twice; it does not claim it again.
- **The plan drawings stayed behind when you scrolled.** Anchored to the last
  bar, the risk/reward boxes left the screen as soon as you panned back through
  history, and the level lines ran out 40 bars behind it — so scrolling to look
  at what happened before the trade meant losing the picture of the trade.

  The boxes now hang off `chart.right_visible_bar_time`, the right edge of what
  you are actually looking at, and reach `PLAN_BARS` back from it. Scroll
  anywhere and the plan is on screen, at the same prices. The level lines
  changed from `extend.right` to `extend.both`, because a price is true across
  the whole chart.

### Notes

**Reading the visible range has a cost, and it is not small.** TradingView
re-executes the entire script on every scroll and zoom — 13 `request.security`
calls and a 2,190-bar percentile each time — whether or not a plan is enabled.
That is what the boxes staying on screen costs. Manual item 21 (runtime
performance on a long 5m chart) matters more because of it.

A runtime that reports no visible range anchors on the last bar rather than
erroring. The offline suite substitutes that one read site to test the following
behaviour instead of assuming it.

## 1.2.1

Two things looked wrong in the TradingView Pine Editor that no offline test could
see, because neither was a number. Both are fixed, and both now have assertions
that would catch them again.

### Fixed

- **The dashboard defaulted to Top right, underneath the price scale.** On a real
  chart the current-price label draws straight across it. The default is now
  **Top left**. The right-hand positions are still offered — a different layout
  may suit your chart — but they are not claimed to be collision-free.
- **The risk and reward boxes carried `extend.right`** and started 40 bars in the
  past, which is not a zone: it is a permanent coloured background over
  everything to the right of the plan, burying the candles it is meant to sit
  behind. Both boxes now run from the last bar to **16 chart bars** later, and
  neither extends. The level *lines* still extend, because a level is a price.
  The fills went from 90% to 92% transparent.

### Changed

- **Box edges are assigned per direction rather than by `max`/`min`.** For a long
  the reward box is target-to-entry and the risk box entry-to-stop; for a short
  they mirror. Both constructions produce the same numbers today — which is the
  problem, because only one of them notices when a future edit gets the sign
  wrong. The geometry is now computed in chart scope so the offline suite can
  read the coordinates back and assert each edge by name.
- **Decision panel wording, from a real screenshot.** `SIZE` became `POSITION`
  and now leads with the money rather than the coin amount; `RISK` became
  `MAX LOSS`. The stop row shows the percentage and drops the ATR multiple, and
  the risk row drops its R multiple — both are research units and both are still
  in Detailed. The target row shows its R, adding the net figure only when costs
  move it by at least a tenth of an R.
- **`PRICE→ENTRY` appears only for a manual planned entry.** With the default
  live entry the market *is* the entry, so the row could only ever print
  `+0.00R / $0 / 0.00%`. A row that can say one thing is furniture.

### Notes

No new features, no new setting, no research change. The sizing arithmetic, cost
model, break-even, lifecycle, alerts and market-context semantics are untouched
and re-asserted. `PLAN_BARS = 16` is a constant rather than an input: it is
~80 minutes at 5m and ~2.7 days at 4H, and a control for it would be one more
thing to understand for no decision it changes.

Manual validation matters more than usual for this one — it was driven by
rendering, and rendering is the thing the offline runtime does not do. See
`TRADINGVIEW-VALIDATION.md` items 30–39.

## 1.2.0

A UX release. No new measurement, no new indicator, no new claim — the
arithmetic, the market context and the research position are byte-for-byte the
same product. What changed is how much you have to understand before you can use
it.

### Changed

- **Four controls make a trade plan: Direction, Stop price, Account equity, Risk
  (%).** Everything else has a default, and the defaults are the common case:
  entry follows the current price, the target sits at 2R, risk is a percentage of
  equity, costs are in the sizing, and the position is not open yet. The settings
  dialog now opens on two short groups — `Trade plan` and `Account` — holding
  five controls between them including the enable switch. It previously opened on
  fifteen.
- **Five mode dropdowns are gone**, not hidden: `Stage`, `Entry`, `Stop`,
  `Target` and `Risk per trade`. Each asked a first-time user to learn an
  internal distinction before they could size a trade. Where two behaviours
  exist, there is now a checkbox that says what it does — `Use manual entry`,
  `Use ATR stop`, `Use custom target`, `Use fixed cash risk`, `Position opened`.
  A greyed-out input is still an input the eye has to skip, so the fix was fewer
  declarations rather than more `active =`.
- **`Stage` became `Position opened`.** Planning and Active are still the
  internal states and still what the panel prints as status — but status is an
  output, and choosing between two engineering words was never the user's job.
  Opening the position now switches the entry to the fill price rather than
  leaving the two settings free to disagree, so v1.1's `Active needs the price
  you actually filled at` block cannot arise: the configuration that produced it
  no longer exists.
- **Nothing is sized without a stop.** The ATR stop is available and off by
  default rather than being what happens when you leave the field alone. A stop
  the tool chose would read as the tool deciding where your idea is wrong, which
  is the one decision it has no business making. With no stop the panel says
  `SET STOP` and computes nothing.
- **Settings are grouped by who needs them**: `Trade plan`, `Account`, then
  `Advanced — plan`, `Advanced — risk`, `Advanced — costs`, and the display,
  alert and symbol groups after those. The word "Advanced" is now load-bearing:
  no group carrying it has to be opened to size a trade.
- **Incomplete is not an error.** `SET STOP` and `SET ACTUAL FILL PRICE` name the
  next action rather than reporting an invalid plan. Both still refuse to produce
  a number, which is the part that matters.
- Tooltips on the four core controls are written for someone who has never read
  this repository.

### Unchanged

Cost-aware sizing, break-even, gross and net R, live R and P&L, the exposure cap,
tick rounding, plan alerts and their stage semantics, the risk/reward drawings,
the adaptive palette, 5m/15m/1H/4H behaviour, the confirmed 4H context with no
lookahead or repaint, the external adapter contract, and every research
constant — all verified identical by the same suite that verified them in v1.1.

## 1.1.0

A plan-first release. Nothing in it claims to predict anything: every addition
below is arithmetic, presentation, or a guard against printing something
plausible and wrong.

### Added

- **Plan-first workflow.** With a plan enabled, the plan is the subject of the
  Decision panel and market context compresses to one line. With no plan, the
  market gets three full rows as before.
- **Interactive draggable levels.** Entry, stop and target are `input.price`
  fields — drag the marker on the chart or type the number. Size, risk, cost,
  targets, break-even and the drawn zones all update as you move them.
- **Cost-aware position sizing.** `Entry cost (bp)` and `Exit cost (bp)`,
  default 5.0 each, meaning commission plus expected slippage for one side. With
  costs in sizing, the risk budget covers the stop loss *and* the round trip, so
  being stopped out costs what you said you would risk. It is not a live fee
  lookup: enter your own execution cost. Sizing with costs excluded remains
  available and the panel still reports what they would be.
- **Break-even price**, with its distance from entry in basis points, printed and
  optionally drawn as a dotted line.
- **Plan lifecycle.** `Planning` shows what the position would be and how far
  price is from your entry; `Active` shows live R, estimated net P&L, and
  distance to the stop and the target. Active requires a manual entry price — the
  price you actually filled at — and says so rather than following the market.
- **Plan alerts.** Confirmed bars only, once per level: entry while Planning,
  stop and target while Active, with 1R/2R/3R separately opt-in. A level re-arms
  when it moves, so dragging a stop arms it again while price oscillating around
  an unchanged stop fires once.
- **Risk and reward zones** drawn on the chart as two faint boxes, entry to stop
  and entry to target, alongside the level lines and the R ladder.
- **5m support.** Verified by the offline suite — context clock, completed-bar
  guarantee and absence of lookahead all asserted on synthetic 5m bars. It has
  not been confirmed in the Pine Editor, which is the gate for listing it in the
  README as supported — `TRADINGVIEW-VALIDATION.md` carries it as manual item 3.
- **Non-standard-chart guard.** Heikin Ashi, Renko, Line Break, Kagi and Point &
  Figure do not plot real prices, so with a live entry the plan refuses rather
  than size a real quantity from a synthetic one. Setting a manual entry price
  unblocks it. Market context is unaffected — it comes from `request.security` on
  the reference symbol.
- **Non-linear-instrument guard.** The sizing arithmetic assumes one quote unit
  per unit of price, which is true of BTC spot and USDⓈ-M linear perpetuals and
  false of inverse (coin-margined) futures. A point value other than 1 blocks the
  plan. A runtime that reports no point value is treated as unknown and allowed
  through.
- **Adaptive light/dark palette** derived from `chart.bg_color` (Rec. 601 luma).
  No colour inputs.

### Changed

- **The standing disclaimer changed form, not meaning.** The full-width
  `AUTOMATIC SIGNAL — NONE VALIDATED` row is now the footer `DISCRETIONARY MODE ·
  NO AUTO ENTRIES`. It spent the panel's most valuable line restating something
  that never changes. There is still no validated automatic entry model, and none
  is claimed.
- **Production and test Pine separated.** The offline suite observes values by
  plotting them, which until now meant 57 hidden test plots living in
  `main.pine` and a production script sitting at 63 of Pine's 64 plot outputs.
  They now live in `tests/build-instrumented.mjs` and are appended at test time.
  Production is down to **1** plot output. What you paste into TradingView is the
  product.
- **Settings simplified.** The normalisation windows and the hysteresis
  thresholds are now frozen constants rather than inputs. Every one was chosen by
  a study in `research/`; they are research-defined semantics, not preferences,
  and exposing them invited retuning the meaning of a reading. The offline suite
  substitutes them by rewriting those lines, so they stay testable at other
  values without being tunable in production.
- **Panel size** (Compact / Normal / Large) scales the Decision view. Detailed
  and Debug stay one step smaller — they are reference layouts with four times
  the rows.
- Decision rows that say nothing are absent rather than printed. `WATCH` appears
  only when there is something to watch.

### Removed

- **Trailing reference.** Its job is done by the Active stage's distance to stop
  in R, which is the same information in the unit the rest of the panel uses.

### Notes

R is the gross stop distance in price, unchanged from v1.0, so a 2R target means
the price it has always meant. With costs in sizing, the money lost at the stop
is slightly more than 1R; the RISK row prints that multiple.

Still requires a chart at or below 4H. Offline verification is not a TradingView
compile — see `TRADINGVIEW-VALIDATION.md`.

## 1.0.0

First release. One BTC indicator, replacing two published ones and three
research projects.

### Consolidates

- **BTC 4H Market Radar** (`btc-4h-market-intelligence`, v3.3) — the descriptive
  market context: trend against the confirmed daily 200MA and 12-week momentum,
  volatility percentile, 24H open-interest expansion/reduction, perpetual
  premium, spot-vs-perp relative participation, and data health. Verified
  bar-by-bar against v3.3: every feed status, direction code, hysteresis level,
  anomaly count and event is identical.
- **Trade Risk Planner** (`btc-4h-trade-planner`, v1.0) — the mechanical risk
  converter: stop distance, allowed loss, position size and notional, required
  leverage, exposure cap, risk actually taken after the cap, and the 1R/2R/3R
  ladder. Verified identical across 8 configurations × 1,500 bars.

### Added

- **15m, 1H and 4H support.** Market context is always BTC 4H data, requested
  from the reference symbol whatever chart you are on. Below 4H it is the last
  COMPLETED 4H bar, held for the period, so it cannot repaint — verified against
  1,600 synthetic 1H bars aggregating to 400 real 4H bars, with zero reads of the
  bar the chart is inside.
- **Non-BTC chart warning.** Context is always BTC; if your chart is not, the
  panel says so instead of silently adapting.
- **Required leverage** shown beside the exposure cap. It was always computed;
  it was not previously displayed.
- **Trade plan toggle**, off by default, so the panel reads `NOT SET` until you
  enter a plan.

### Changed

- Panel rewritten around five things: what state the market is in, your trade,
  and the standing statement that no automatic signal is validated. Decision view
  is nine rows with no plan entered.
- Decision view now carries no research vocabulary at all — no σ, percentile,
  sample count, p-value or state code. Those live in Detailed and Debug.
- Optional-adapter housekeeping (`SETUP REQUIRED`, connection counts) moved out
  of Decision into Detailed. Core data failures still surface in Decision,
  because a reading from a feed that is not there is the worst thing the panel
  could print.
- Trend and positioning wording is now plain English (`Strong uptrend`,
  `Unusual reduction`). Same states, same thresholds, different words.
- Daily 200MA plot, trailing reference, chart warning label and all four
  external adapters are off by default. With no plan entered the chart is clean.
- A reference feed that stops producing bars now freezes the context rather than
  letting a carried-forward value be re-counted in every normalisation window.

### Removed

- **Automatic directional models.** None were ever shipped; the studies that
  rejected them are condensed in `research/`.
- **SOPR.** A Glassnode symbol many plans do not resolve, and no retained reading
  depended on it.
- **Estimated flow proxy.** It classified lower-timeframe bars by their own
  direction, which is not aggressor data; it could not be verified offline; and
  Study M1 showed that even real aggressive flow carries no tradable directional
  information.
- **Non-actionable microstructure displays.** The Execution Planner UI, the
  historical replay and backtest interfaces, and every order-book measurement.
  Order-book information is real (depth imbalance, validation t = 6.38) and
  roughly forty times too small to survive commission.

### Notes

Requires a chart at or below 4H; above that the 4H context cannot be requested
without reading inside an unfinished bar, so the script stops rather than print
something plausible and wrong.

Offline verification is not a TradingView compile — see
`TRADINGVIEW-VALIDATION.md`.
