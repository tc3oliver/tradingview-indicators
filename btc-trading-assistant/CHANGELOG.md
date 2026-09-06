# Changelog

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
