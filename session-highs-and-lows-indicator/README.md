# Session Highs and Lows Indicator

A TradingView Pine Script v5 indicator that marks the high and low of each SMC/ICT
killzone with labels and dashed lines extended to the right.

- **Version**: v3.1 — see [CHANGELOG.md](./CHANGELOG.md)
- **License**: [MPL-2.0](../LICENSE) © tc3oliver
- **Reporting a problem**: include symbol, timeframe, chart timezone and a
  screenshot — [why](../README.md#reporting-an-issue)

---

## Sessions

All sessions are defined in **New York local time** (`America/New_York`).
Daylight saving is handled automatically.

| Session | NY time | Purpose |
|---|---|---|
| Asian Range | 20:00–00:00 | Price development during Asia-Pacific activity |
| London Open | 03:00–05:00 | Liquidity grabs and volatility at the European open |
| New York AM | 08:30–11:00 | Sharp moves around the US open and data releases |
| London Close | 10:00–12:00 | Late-morning reversals and continuation |

Each session can be toggled on or off, with configurable line color and width.

> **Note:** `New York AM` (08:30–11:00) and `London Close` (10:00–12:00) overlap
> between 10:00 and 11:00. This is intentional — they are separate ICT killzones
> and each tracks its own high and low independently.

---

## Behaviour

Understanding these two points resolves most "why is the line there?" confusion.

### 1. Lines are drawn after a session ends, and show the last *completed* session

Nothing is drawn while a session is in progress. On the first bar after a session
closes, that session's high and low are drawn and extended to the right with
`extend.right`, staying until the next instance of the same session closes.

So looking at a chart at 09:00 New York time on a Thursday:

- **London Open** shows **Thursday's** levels — the 03:00–05:00 session has closed
- **New York AM** shows **Wednesday's** levels — Thursday's session opened at 08:30
  and has not closed yet

This is by design. The upside is that once a line is drawn it never moves again —
**this indicator does not repaint** (see [Testing](#testing) below).

### 2. Sessions are attributed to a New York date, which may differ from your chart's

`Asian Range` runs 20:00–24:00 NY, crossing the date boundary:

```
NY:     Wed 20:00 → Thu 00:00
Taipei: Thu 08:00 → Thu 12:00
```

Wednesday's Asian Range in New York is Thursday morning for a chart displayed in
Taipei time. `London Close` has the same property (NY Wed 12:00 = Taipei Thu 00:00).

If you are thinking in terms of "yesterday's Asian range" using your local calendar
day, the indicator will look one day off. **The values are correct — the mismatch
is in which day the session is attributed to.**

---

## Usage

Copy the contents of [`main.pine`](./main.pine) into TradingView's Pine Editor and
click *Add to chart*.

**An intraday timeframe (< 1D) is required.** Session windows are meaningless once
a single candle spans the whole day, so the indicator raises an error rather than
silently drawing wrong levels:

```
This indicator requires an intraday timeframe (< 1D).
```

---

## Development

Pine Script has no official local runtime. This project runs the actual `.pine`
source on Node via [PineTS](https://github.com/LuxAlgo/PineTS) to reconcile output
offline.

```bash
npm install
npm test                  # defaults to 1h x 500 bars
node tests.mjs 15m 2000   # explicit timeframe and bar count
```

### Files

| File | Purpose |
|---|---|
| `main.pine` | The indicator. This is what gets pasted into TradingView |
| `main.v1.pine` | The pre-refactor version, frozen as the differential baseline |
| `tests.mjs` | The four test groups below |

`main.pine` ends with 16 `display=display.none` plots exposing each session's
high, low, high-bar and low-bar. They are invisible on the chart and in the Data
Window, and exist purely as stable read points for the tests. Pine allows 64 plots;
this uses 16.

### Testing

| Test | What it proves |
|---|---|
| **differential** | Output is bar-for-bar identical to `main.v1.pine` |
| **no-repaint** | Truncating the data at 50% / 75% / n−10 / n−1 and re-running leaves every past bar unchanged — this is what "does not repaint" means |
| **staleness** | At any bar, the displayed levels come from the *most recently completed* session, never an older one |
| **weekend-gap** | Dropping all bars between Friday 17:00 and Sunday 17:00 NY simulates a forex market close; state survives the gap |

The first three carry an extra safeguard: ground truth is not a re-run of the same
state machine, but is derived independently by grouping bars by New York date and
taking `max(high)` / `min(low)`. The two derivations share no code, so agreement
is meaningful.

### Limitations

- **PineTS is not TradingView.** It is a third-party reimplementation of the
  runtime. Passing tests mean the logic is self-consistent, not that TradingView
  behaves identically. Paste back into the Pine Editor and check the chart before
  publishing.
- Test data comes from Binance (24/7). The real session structure of forex and
  index futures can only be approximated by the `weekend-gap` test; no actual data
  from those markets is used.
- Visual output (label placement, line styling) and alert firing cannot be verified
  locally.
