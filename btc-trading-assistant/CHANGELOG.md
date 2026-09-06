# Changelog

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
