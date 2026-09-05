# TradingView manual validation checklist

`npm test` proves 21 things offline. It cannot prove anything that only exists
inside TradingView: whether a symbol resolves, how far its history goes, whether
`request.security_lower_tf()` returns intrabars, whether the `input.source()`
picker can even see another indicator's plot, what the table looks like, or
whether an alert is delivered.

Everything below is **MANUAL REQUIRED** unless it says otherwise. Nothing here
is marked VERIFIED on the strength of the offline suite.

Work top to bottom. A failure at A1 makes every later row meaningless.

---

## A. It compiles and runs

| # | Check | Expected | Result |
|---|---|---|---|
| A1 | Paste `main.pine` into the Pine Editor, Save, Add to chart | Compiles with no errors | ☐ |
| A2 | Note any compiler **warnings** | Warnings about unused variables are acceptable; a warning that a function "should be called on each calculation for consistency" is **not** — report it, it means a stateful builtin is being called conditionally | ☐ |
| A3 | Chart = `BINANCE:BTCUSDT.P`, timeframe = **4H** | Dashboard renders, no runtime error | ☐ |
| A4 | Switch the chart to 1H, then 1D | Script halts with the 4H-required runtime error, both times | ☐ |
| A5 | Back to 4H, scroll left to the oldest bar | No `array index out of bounds`, no `max_bars_back` error | ☐ |

The offline suite verifies the 4H **predicate** (1 at 240, 0 at 60) and that
`runtime.error` is wired to it. A4 is the only place the error is actually
raised.

---

## B. Symbols and data

| # | Check | Expected | Result |
|---|---|---|---|
| B1 | `BINANCE:BTCUSDT.P` resolves as the reference | DATA HEALTH → Reference = **FRESH** | ☐ |
| B2 | `BINANCE:BTCUSDT` resolves as spot | DATA HEALTH → Spot = **FRESH** | ☐ |
| B3 | `BINANCE:BTCUSDT.P_OI` resolves | DATA HEALTH → Open interest = **FRESH**, and the OI 24H row shows a percentage, not `REJECTED` | ☐ |
| B4 | **OI denomination.** Hover the OI 24H row; if the chart warning label appears, read it | No USD-denomination warning. If it fires, the feed is notional and OI is correctly disabled — find a base-unit symbol | ☐ |
| B5 | `GLASSNODE:BTC_SOPR` resolves | DATA HEALTH → SOPR is FRESH or 1D OLD, not UNAVAILABLE | ☐ |
| B6 | **History depth.** Scroll to the leftmost bar the chart will load | Note the date. The daily 200MA needs 200 daily bars; TREND reads DATA UNAVAILABLE before that, which is correct | ☐ |
| B7 | Put the script on a **non-BTC** chart (e.g. `BINANCE:ETHUSDT`, 4H) | Every reading is **identical** to the BTCUSDT.P chart. This is the one manual check that mirrors an offline test (check 6) — do it anyway, because only TradingView can prove the reference symbol actually resolves from a foreign chart | ☐ |

B4 detail: the script rejects a notional feed two ways — declared currency
(`USD`/`USDT`/`USDC`) and magnitude (> 5e6 for BTC). Both paths are covered
offline. What is not covered offline is *what Binance's `_OI` symbol actually
reports on TradingView*.

---

## C. Lower-timeframe flow

| # | Check | Expected | Result |
|---|---|---|---|
| C1 | FLOW section on a recent bar | PERP DELTA and SPOT DELTA show numbers, not `no intrabar` | ☐ |
| C2 | Scroll back ~12 months | Delta becomes `no intrabar` — `request.security_lower_tf()` is capped at 100,000 intrabars (125K Expert, 200K Ultimate), which at 5m on a 4H chart is roughly 2,000 bars | ☐ |
| C3 | Set the flow timeframe input **above** 4H (e.g. `1D`) | Script does **not** halt. `ignore_invalid_timeframe = true` makes it degrade to `no intrabar` | ☐ |

None of C is testable offline: the local provider has no intrabar series, so the
offline runs exercise the `flowOK == false` branch only.

---

## D. External adapters (`input.source()`)

The single biggest unknown in the whole design. Pine cannot call a built-in
study, so funding, ETF flow and liquidations arrive through `input.source()`
pointed at another indicator's plot.

| # | Check | Expected | Result |
|---|---|---|---|
| D1 | Leave all four adapters off | DATA HEALTH shows Funding / ETF flow / Liquidations = **UNAVAILABLE**; no funding, ETF or liquidation anomaly ever appears | ☐ |
| D2 | Enable the funding adapter, leave its Source on `close` | Reads **MISCONFIGURED** (not STALE, not UNAVAILABLE), and the orange chart warning appears | ☐ |
| D3 | Open the Source dropdown | **Do TradingView's own Fundamentals → Derivatives studies appear as selectable plots?** Record the answer — the docs say a source input can receive "the values plotted by other scripts" but also warn "not all indicators can be calculated based on another indicator" | ☐ |
| D4 | If D3 is no: add a community script that republishes aggregated funding and point the input at its plot | Funding row shows a raw rate, a percentile and a σ | ☐ |
| D5 | Same for ETF net flow | ETF 5D row shows a compact notional and a percentile | ☐ |
| D6 | Same for long and short liquidations, both wired | LONG LIQ, SHORT LIQ and LIQ BALANCE all populate; balance stays between −1 and +1 | ☐ |
| D7 | Wire an adapter to a plot that stops updating (or a weekend-only series) | After 6 bars (funding, liquidations) or 30 bars (ETF), status flips to **STALE** and the readings stop | ☐ |
| D8 | Semantic spot-check with real funding | When the raw funding rate is negative, the label says **SHORT FUNDING**, never LONG | ☐ |

D7 and D8 are verified offline against a substituted series (checks 11, 12, 1);
what is manual is whether a real plot arrives through the picker at all.

---

## E. Display, events and alerts

| # | Check | Expected | Result |
|---|---|---|---|
| E1 | Dashboard at default settings | Sections in order: RECENT EVENTS · WHAT CHANGED · CURRENT ANOMALIES · MARKET MECHANICS · TREND/VOLATILITY · DERIVATIVES · PARTICIPATION · FLOW · SLOW CONTEXT · DATA HEALTH | ☐ |
| E2 | Set **Max anomalies = 9**, all adapters live, wait for a busy bar | Nothing is clipped; the footer rows still render. Offline worst case measured 51 of 64 rows | ☐ |
| E3 | Try each of the five table positions | No overlap with the price scale or the legend | ☐ |
| E4 | Watch a live 4H bar form | RECENT EVENTS does **not** gain a row mid-bar; new rows appear only at the close | ☐ |
| E5 | Let several bars close | Ages count up correctly (`4h`, `8h`, …) and no two adjacent rows are identical | ☐ |
| E6 | Create an alert on the script → "Any alert() function call" | Fires on 4H closes only, never intrabar | ☐ |
| E7 | Leave the alert running through a multi-bar OI expansion | One alert per transition, not one per bar | ☐ |
| E8 | Read every label on screen | No BUY, SELL, LONG READY, DO NOT CHASE, REDUCE, RISK-ON/OFF | ☐ |

E4 is important and offline-untestable: PineTS has no realtime bar, so it treats
the last historical bar as confirmed. What the offline suite proves instead is
structural — every `fire()` call sits inside the `barstate.isconfirmed` block,
and there is exactly one `alert()` call site.

---

## F. Footprint (`footprint-live.pine`) — separate file, optional

Requires a **Premium, Premium+ or Ultimate** plan. Nothing here is tested
offline; PineTS has no implementation of `request.footprint()` at all.

| # | Check | Expected | Result |
|---|---|---|---|
| F1 | Paste `footprint-live.pine`, add to chart in its own pane | Compiles | ☐ |
| F2 | On a lower plan | Record what actually happens — compile error, runtime error, or silent `na`. This determines whether the file is usable at all below Premium | ☐ |
| F3 | Recent 4H bars | Delta columns plot; the readout shows buy/sell volume, delta, POC, VAH, VAL | ☐ |
| F4 | Scroll back | `NO FOOTPRINT DATA` on older bars, no error | ☐ |
| F5 | Watch a live bar, then reload the chart | The bar's delta **changes**. This is expected: TradingView documents footprint as repainting by design. Confirm it, then never use these numbers for anything historical | ☐ |

If F2 shows a compile error on lower plans, that is exactly why this call is not
in `main.pine`, and the README should say so with your plan's result filled in.

---

## G. Report back

For anything that fails, the useful report is: **which row, what the dashboard
said, and a screenshot**. The DATA HEALTH section exists so that "it shows n/a"
can be answered without guessing which feed dropped.

Rows that fail should be recorded here as failures rather than quietly fixed by
loosening a threshold — a threshold change bumps `THRESHOLD-VERSION` in
`main.pine` and starts a new prospective cohort (`audit/cohort.mjs`).
