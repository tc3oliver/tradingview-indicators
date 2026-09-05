# Changelog

An archive of this script's TradingView release notes. Each dated entry is
paste-ready for TradingView's release notes field.

> **Do not add links.** TradingView's script publishing rules ban links *and
> plain-text references to any website* from descriptions, source code and
> release notes alike. The only place an external link is permitted is the
> Signature profile field, which requires a Premium/Expert/Ultimate plan.
> The Mozilla license URL in `main.pine` is exempt — it is TradingView's own
> default header template.

---

## 2026-09-05 — Naming fixes, timeframe warnings

This update corrects a naming mismatch between the settings panel and the chart
labels, and makes the indicator tell you when a session cannot be drawn on your
current timeframe instead of silently showing nothing.

### Fixed

- **Session toggles now match the labels on the chart.** The setting previously
  named *"Show New York Close High/Low"* controlled the levels labelled *"London
  Close Killzone"* — a leftover from the 2025-08-22 rename to ICT terminology.
  Checking it looked like it did nothing, or like it drew the wrong session. All
  four sessions now use one consistent name in the settings and on the chart:
  **London Open**, **New York AM**, **Asian Range**, **London Close**.

### Added

- **Updated to Pine Script v6.** Required for public scripts on TradingView. The
  migration changed no behaviour — output was compared bar by bar against the v5
  version before publishing.

- **A warning when a session cannot be drawn on your timeframe.** A session is
  only detected if a bar *opens* inside its window. On 3h and 4h charts a 2-hour
  killzone can contain no bar opens at all, so those levels silently never
  appeared. The indicator now says so on the chart, naming the session and the
  timeframe. Which sessions are affected also shifts with daylight saving.

  **Use 30m or lower for all four killzones to work correctly.** Note that New
  York AM starts at 08:30, which no hourly bar aligns to — on a 1h chart that
  level is really the 09:00–11:00 range, not 08:30–11:00.

- **An explicit error on daily and higher timeframes.** Session windows are
  meaningless once a single candle spans the whole day. The indicator now refuses
  to load rather than drawing misleading levels.

### Unchanged

- **Every session high and low is identical to the previous version**, verified
  bar by bar against the 2025-08-22 release. This update changes naming, adds
  warnings, and cleans up the code internally — it does not move a single level.

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

### 2026-09-05 internal changes

Not in the published notes because they are invisible to users:

- **v5 -> v6 migration.** Only one breaking change actually applied: `nz()` no
  longer accepts `bool` arguments. Since a `bool` can never be `na` in v6,
  `nz(inSess[1], false)` became plain `inSess[1]`. Everything else in this script
  was already v6-clean (no `transp`, no implicit numeric-to-bool casts, no `[]` on
  literals or UDT fields, `linewidth` minimums already 1).
  `main.v1.pine` is deliberately left on v5 — the differential test now compares
  the v5 baseline against the v6 script, which is exactly the migration check.

- Unified the four duplicated session blocks into a single `trackSession()`
  function, 197 -> 128 lines. Uses Pine's function-local `var` (independent state
  per call site) rather than arrays or UDTs, deliberately avoiding container
  rollback behaviour on realtime bars.
- Renamed the fourth session's internal identifiers from `nyClose` /
  `newYorkClose` to `londonClose` — the same naming drift that caused the visible
  bug, one layer down.
- Removed four redundant state variables; `*HighStartBar` and `*LowStartBar` never
  diverged and were merged into a single `startBar` per session.
- Added 16 `display=display.none` plots as stable test hooks, and an offline test
  suite (`tests.mjs`) with five groups: differential against the frozen
  pre-refactor baseline, no-repaint prefix invariance, session staleness,
  simulated weekend gap, and coarse-timeframe warning coverage.
- The warning label is held in a `var` and deleted before redraw: `barstate.islast`
  is true on every forming bar and the label commits at bar close, so without the
  delete one label accumulates per bar.

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
