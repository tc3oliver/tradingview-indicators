# Changelog

An archive of this script's TradingView release notes. Each entry below the
`Unreleased` section is paste-ready for TradingView's release notes field.

---

## Unreleased — Internal refactor, intraday guard, offline test suite

**No change to plotted values.** Every session high/low, label position, and line
coordinate is bit-identical to the previous version, verified bar-by-bar by an
automated differential test.

### Added

- **Intraday guard.** The indicator now raises a clear error instead of silently
  drawing wrong levels when applied to a 1D-or-higher timeframe. Session windows
  are meaningless once a single candle spans the whole day:
  `This indicator requires an intraday timeframe (< 1D).`
- **Offline test suite** (`tests.mjs`, runs on Node via PineTS). Four groups:
  differential vs. the previous version, no-repaint prefix-invariance, session
  staleness, and a simulated Friday-17:00→Sunday-17:00 market close.
- **16 hidden plots** (`display=display.none`) exposing each session's
  high/low/high-bar/low-bar as stable test hooks. Invisible on the chart and in
  the Data Window.

### Changed

- **Unified the four duplicated session blocks into a single `trackSession()`
  function.** 197 → 112 lines. Uses Pine's function-local `var` (each call site
  holds independent state) rather than arrays or UDTs, deliberately avoiding
  container rollback behaviour on realtime bars.
- Corrected a stale comment that described the Asia session as Taipei
  07:00–16:00; it has been NY 20:00–24:00 since the 2025-08-22 release.

### Removed

- Four redundant state variables. `*HighStartBar` and `*LowStartBar` were always
  assigned together at session start and never diverged; merged into a single
  `startBar` per session.

---

## 2025-08-22 — SMC/ICT Killzones, New York time

This indicator marks the high and low levels for SMC/ICT Killzones widely used by
crypto traders. All sessions are defined in New York local time
(`America/New_York`), and daylight saving time (DST) adjustments are handled
automatically. Each session's highs and lows are labeled directly on the chart and
extended with dashed horizontal lines for clear visualization.

### Included Sessions (Crypto Version, New York Time)

- **Asian Range (20:00–00:00 NY)** — price development during Asia-Pacific activity.
- **London Open (03:00–05:00 NY)** — liquidity grabs and volatility at the European open.
- **New York AM (08:30–11:00 NY)** — sharp moves and setups around the US open and data releases.
- **London Close (10:00–12:00 NY)** — late-morning reversals and continuation as London closes.

### What's New

- Switched to Crypto Killzone timings (New York time, DST auto-adjust).
- Simplified session handling by unifying all times to `America/New_York`.
- Removed old UTC-based logic and custom DST functions — now fully DST-safe.
- Updated labels to SMC/ICT terminology (e.g. *London Open Killzone High*).
- Improved code clarity for easier maintenance and extension
  (e.g. future Midnight Open, Power Hour).

---

## 2025-06-20 — Automatic DST handling, per-session styling

Session times are defined in UTC and align with the chart's local timezone. The
indicator updates in real time with clearly labeled session highs and lows, and
dashed horizontal lines for improved visualization.

### Included Sessions

- **London Session (08:00–10:00 local)** — early European trading hours.
  Auto-adjusts between UTC and UTC+1 for DST.
- **New York Session (08:00–10:00 local)** — the overlap with London.
  Auto-adjusts between UTC−5 and UTC−4 for DST.
- **Asia Session (07:00–09:00 GMT+8)** — early Asian market activity.
  Fixed; not affected by DST.
- **New York Close Session (15:00–17:00 local)** — late-day reversals and
  positioning. Adjusts for DST as with the New York session.

### What's New

- Added automatic daylight saving time (DST) support for London and New York.
- Introduced custom line color and width settings for each session.
- Unified and optimized timestamp handling with clearer session definitions.
- Maintained full compatibility with existing label and line rendering.
- Improved internal structure for better performance and readability.

---

## 2024-12-05 — Initial release

This indicator marks the high and low levels for key trading sessions, allowing
traders to identify significant price zones across different markets. The default
session times are defined in UTC and will automatically adjust to your local
timezone.

- **London Session (07:00–09:00 UTC)** — intraday liquidity zones for potential highs/lows.
- **New York Session (12:00–14:00 UTC)** — volatility during market overlaps with Europe.
- **Asia Session (23:00–01:00 UTC)** — trend continuation and retracement opportunities.
- **New York Close Session (19:00–21:00 UTC)** — reversals and breakout tests during global transitions.

The script dynamically updates session highs and lows with clear labels and dashed
horizontal lines for better visualization. Time ranges can be adjusted to suit your
trading preferences, making the indicator flexible and effective for liquidity
hunting, trend trading, and breakout strategies.

---

## Maintainer notes (do not paste into TradingView)

### How the session definitions evolved

| Release | Timezone basis | DST handling |
|---|---|---|
| 2024-12-05 | Fixed UTC | None — sessions tracked UTC, so they drifted an hour against the actual market open across summer/winter |
| 2025-06-20 | Local time + custom DST functions | Hand-written offset switching |
| 2025-08-22 onward | `America/New_York` | Delegated to `time(..., "America/New_York")`, handled by Pine itself |

**When a bug report arrives, establish which release the reporter is on before
anything else.** The first two releases used different session boundaries, and the
UTC release had no DST compensation at all. Reports of being "a day off" or "an
hour off" around a date boundary or a DST changeover are very likely artifacts of
those older releases and will not reproduce on the current one.

### Known perception gaps (not bugs)

- Sessions are attributed to a **New York date**. Wednesday's Asian Range in NY
  falls on Thursday morning for a chart displayed in Asian timezones, which reads
  as being a day off.
- Lines show the **last completed** session; a session in progress is not drawn.
  See [README](./README.md#behaviour).
