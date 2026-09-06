# TradingView validation

Offline tests are not a compile. PineTS runs the real `main.pine` on Node against
locally recorded Binance data, which covers the arithmetic, the state machine and
the panel contents thoroughly — but it is a reimplementation of Pine, not Pine.
This file separates what is verified automatically from what still needs the Pine
Editor.

**Current status: MANUAL VALIDATION REQUIRED.** No item in the second table has
been performed. Nothing in this repository should be read as "fully validated"
until they have been.

---

## AUTO VERIFIED

Run with `npm test`. Every item below is asserted on every run.

### Migration correctness

| | |
|---|---|
| Market context vs `BTC 4H Market Radar v3.3` | 45 measurements × 1,500 bars, all four adapters live. Feed status codes, 11 direction codes, 10 hysteresis levels, OI units guard, anomaly count and the full event log (1,366 accepted / 1 suppressed) **bit-identical**. |
| Continuous measurements | Identical to within the offline runtime's measured 10-decimal rounding of function returns and array reads; worst residue 3.08e-4 relative, on a z-score whose standard deviation is of the same order. Moves no discrete state. |
| Trade planner vs `Trade Risk Planner v1.0` | 8 configurations × 1,500 bars — both directions, pinned and live entry, ATR and explicit stop, cap binding and not, stop on the wrong side. All outputs identical; notional, risk, 1R and 3R recomputed and checked against the baseline's own plots. |

### Timeframe and repainting

| | |
|---|---|
| Runs at 4H and 1H | yes |
| Refuses above 4H | predicate `chartSec <= 14400`, `runtime.error` present in source |
| 4H context on a 1H chart | 1,592/1,592 bars read the last COMPLETED 4H bar |
| Lookahead | 0 reads of the 4H bar the chart is currently inside |
| Repainting | history-prefix invariance across 4,141 settled values |
| `lookahead_on` usage | every occurrence paired with a `[1]` offset, plus the documented previous-completed-daily idiom |

### Semantics and safety

| | |
|---|---|
| Chart independence | every context reading identical on an ETH chart (3,421 values) |
| Planner follows the chart | live entry differs by symbol, as intended |
| Direction from raw value | 8,846 observations across 6 measures; direction code equals `sign(raw)` everywhere |
| Percentile range | 11,507 observations, all within [0, 100] |
| z standardisation | OI 24H: mean −0.009, sd 1.018 over 1,450 bars |
| Hysteresis ladder | never exceeds level 2; off below its exit; on at its extreme entry |
| USD-notional OI guard | rejected on both the declared-currency and implausible-magnitude paths; no positioning reading produced |
| Unwired adapter | reports MISCONFIGURED, produces no reading |
| Frozen adapter | reports LIKELY STALE past its threshold, reading withdrawn |
| Liquidation balance | withheld until the shared unit is declared |
| Decision view vocabulary | no σ, percentile, p-value, sample count or research term |
| No invented direction | with no plan entered, the panel contains no LONG, SHORT, BUY or SELL |
| Standing disclaimer | `AUTOMATIC SIGNAL — NONE VALIDATED` present with and without a plan |
| Display mode is presentation only | 9,600 values identical across Decision, Detailed and Debug |
| Table capacity | worst case (Debug, all adapters live, anomaly list at ceiling) uses 61 of 76 declared rows |
| Pine resource ceilings | 63 of 64 plots; 13 of 40 `request.*()` calls |
| Branch-type lint | no `if`/`else` mixes a value-returning call with a void one (Pine CE10235) |

---

## MANUAL TRADINGVIEW REQUIRED

None of these can be checked offline. Each needs the Pine Editor and a live
chart.

| # | Check | Why it cannot be automated |
|---|---|---|
| 1 | **Pine v6 compiles** | PineTS does no type checking whatsoever. A branch-type mismatch Pine rejects (CE10235) runs happily offline — it has cost one round trip through the editor already. The lint in the suite catches the known shape, not the language. |
| 2 | **Compiler warnings** are read and resolved | Not modelled offline. |
| 3 | **15m BTCUSDT.P** — context populates, matches the 4H chart's previous completed bar | Requires real HTF aggregation. |
| 4 | **1H BTCUSDT.P** — same | Same. |
| 5 | **4H BTCUSDT.P** — readings match the numbers this suite produces | Confirms the offline provider is faithful. |
| 6 | **Long history loads** without `max_bars_back` errors | The volatility percentile asks for 2,190 4H bars inside a request context; offline data cannot reach that depth. |
| 7 | **Real symbol resolution** — `BINANCE:BTCUSDT.P`, `BINANCE:BTCUSDT`, `BINANCE:BTCUSDT.P_OI` | Symbols are served locally offline; spelling and availability are unverified. |
| 8 | **OI feed denomination** — confirm `_OI` really is base-unit and is not rejected by the units guard | `syminfo.currency` is stubbed offline. |
| 9 | **Decision UI** renders legibly, columns align, nothing truncates | No rendering offline; only cell text is inspected. |
| 10 | **Manual Risk Planner** — enter a plan, confirm the lines land at the right prices and the table agrees | Plot geometry is not rendered offline. |
| 11 | **Detailed and Debug** render within the panel | Row *count* is asserted; visual height is not. |
| 12 | **`input.source()` picker** — wire a real funding/ETF/liquidation plot | The picker cannot be driven from Node; adapters are substituted with expressions. |
| 13 | **Alerts** fire once per confirmed 4H bar, with the right text | `alert()` delivery is not modelled. |
| 14 | **Runtime performance** on a long 15m chart | 13 `request.security` calls and a 2,190-bar percentile; execution time is not measurable offline. |
| 15 | **Float precision residue is zero** | The offline runtime rounds function returns and array reads to 10 dp; TradingView does not. The continuous differences documented above are expected to vanish. Confirm a Detailed reading matches the offline number to full precision. |
| 16 | **Digit grouping renders** — prices should read `79,800.00` and notional `$65,000` | The offline runtime ignores the `,` grouping in `str.tostring(x, "#,###.##")` and prints `79800.00`. Cosmetic only, but it is the Decision view's headline number, so confirm it. |
| 17 | **Volatility percentile populates** | Its 2,190-bar window exceeds any offline sample, so `VOLATILITY` reads `No data` in the fixtures. On a real chart with ~1 year of 4H history it must show a level. |

---

## Not part of this indicator

`tools/microstructure/` is a Node collector for the M2 prospective order-book
study. It has its own test suite (`npm test` runs it) and never touches Pine.
