# TradingView validation

Offline tests are not a compile. PineTS runs the real `main.pine` on Node against
locally recorded Binance data, which covers the arithmetic, the state machine and
the panel contents thoroughly — but it is a reimplementation of Pine, not Pine.
It does no type checking, it renders nothing, and several of the `syminfo.*`
values this version reasons about come back `na`. This file separates what is
verified automatically from what still needs the Pine Editor.

**Current status: MANUAL VALIDATION REQUIRED.** No item in the second table has
been performed on v1.2.2. Nothing in this repository should be read as "fully
validated" until they have been.

v1.2 changed the settings dialog and nothing else, which makes it the release
where offline testing is *least* able to stand in for the Pine Editor: the whole
deliverable is a dialog the offline runtime does not render. Items 24–29 exist
for exactly that reason.

**v1.2.1 is the proof of that point.** Someone opened the Pine Editor and two
things were plainly wrong on screen that the entire offline suite had passed:
the dashboard sat under the price scale's current-price label, and the risk /
reward boxes carried `extend.right`, painting a permanent coloured background
across the chart instead of marking a plan. Neither was a number, so nothing
offline could see either one. Both are fixed, both now have structural
assertions and coordinate assertions — and items 30–39 exist because those
assertions still cannot see a rendered pixel.

---

## AUTO VERIFIED

Run with `npm test`. Every item below is asserted on every run, and every claim
here corresponds to an assertion in `tests/`.

**The shipped file at a glance.** 1 plot output and 0 `t_*` test hooks; 13 of
Pine's 40 `request.*()` calls; 45 inputs, 31 of them conditionally greyed out
with `active =`, and **5 of them on the simple path** — `Enable trade plan`,
`Direction`, `Stop price`, `Account equity`, `Risk (%)`. The Decision view with
no plan entered is 8 rows.

### Production / test separation

The offline suite observes a value by plotting it. Until v1.1 that meant the
shipped script carried 57 hidden `plot(..., display = display.none)` hooks and
sat at 63 of Pine's 64 plot outputs — a production file one plot from refusing to
compile, entirely because of its own tests. The hooks now live in
`tests/build-instrumented.mjs` and are appended at test time.

| | |
|---|---|
| Plan geometry | box left edge is the last bar's time, right edge is exactly `PLAN_BARS = 16` bars later, and `box.new()` carries no `extend`. The four box edges are asserted **by name and by direction** — for a long, reward top = target and risk bottom = stop; for a short, they mirror — because `max`/`min` would give the same numbers while noticing nothing if a sign flipped |
| Shipped file carries no instrumentation | `0` occurrences of a `"t_*"` output name in `main.pine` — asserted as exactly zero, not "few" |
| Plot budget | asserted `< 15` and `<= 10`; the file currently uses **1** of Pine's 64. The plan is drawn with lines and boxes, which cost no output slots |
| No `alertcondition()`, no `strategy()` | plan alerts use `alert()`, which consumes no output slot. Checked against code with comments stripped, so the source may still *explain* why it avoids them |
| The instrumented build is never pasted into TradingView | it appends **75** hooks and deliberately exceeds the ceiling at **76** plots. The ceiling is asserted against the shipped file, because checking it on a file nobody pastes in would be checking nothing |
| `missingSymbols()` — hooks cannot rot | every hook expression must reference a symbol that exists in the source. A renamed variable would otherwise turn its hook into an all-`na` series that every downstream test then satisfies vacuously |
| Request budget | **13** `request.*()` calls, asserted `<= 40` |
| Every request bounds its history | zero `request.security` calls without `calc_bars_count`. `CTX_BARS` = 2500 on the twelve 4H requests and `DAILY_BARS` = 400 on the daily one, asserted `>= 2250` and `>= 250` respectively — so both bounds sit *above* the deepest window they contain (~2,220 bars: the 2,190-bar percentile plus the 30-bar stdev) and cannot silently truncate a reading |
| ...and adding them changed nothing | the migration differential still passes bar for bar against baselines that carry no `calc_bars_count`. **That is the whole of what is verified.** The offline runtime accepts the parameter and offers no way to observe whether it honoured it, so the *speedup* — the entire reason the parameter is there — is unverified. See manual item 22 |
| Drawing ceilings declared | `max_lines_count`, `max_boxes_count`, `max_labels_count` all present |
| Branch-type lint | no `if`/`else` mixes a value-returning call with a void one (Pine CE10235) |
| Research parameters are frozen | 7 named constants (`Z_WIN`, `VOL_PCT_WIN`, `RVOL_DAYS`, `OI_ENTER`, `PREM_ENTER`, `TR_ENTER`, `LIQ_XEXIT`) exist as constants and none of the 6 v1.0 tuning inputs survives as a setting |
| Rejected-research vocabulary | 17 banned terms absent from the code (comments excluded) |

### Cost-aware sizing, against independent ground truth

New in v1.1, so it cannot be checked against a baseline that never had it. Every
quantity is recomputed in JavaScript by `truth()` in `tests/main.test.mjs`, from
the brief's formulas, and compared with what the Pine produced. Recomputing is
the point: a test that read the same expression back out of the script would only
prove the script is consistent with itself.

| | |
|---|---|
| The grid | **11 configurations × 12 quantities**, each matched to 1e-9 relative — long and short, manual and ATR stop, live and manual entry, percent and fixed-cash risk, costs on and off, exposure cap binding and not, manual target, asymmetric costs (2 bp in / 12 bp out) and zero rates with costs still enabled |
| Cap state | asserted separately for all 11, so a size that happens to match is not allowed to hide a wrong `capped` flag |
| Costs make the position smaller | asserted as an inequality, and the realised loss at the stop — distance plus both cost legs — is asserted to equal the stated budget exactly |
| Costs off reproduces v1.0 | with costs off, risk per unit **is** the gross stop distance |
| Break-even, by simulation | exiting at the reported break-even price nets exactly zero after both cost legs. Verified by simulating the exit, not by re-reading the formula. Long and short break-even are asserted to sit beyond entry on the correct side |
| Net R at the target, by simulation | net R equals simulated net money divided by one R; gross R is asserted strictly greater than net R; a 65,000 target on a 2,000 stop is asserted at exactly 2.5R gross |
| One definition of R | live R + distance-to-stop satisfies the identity bar by bar over the whole sample |
| Live P&L | gross is quantity × move; net subtracts the round trip at the **current** price, not at the stop |
| Wrong-side levels | a stop on the wrong side voids the plan and produces no size; a target on the wrong side is withheld while the rest of the plan still sizes |
| Tick rounding | levels snap to a substituted 0.5 tick before they are printed |

### Timeframe, repainting and the lower-timeframe contract

| | |
|---|---|
| Runs at 4H | yes, and `tfOK` is true on every bar |
| Refuses above 4H | predicate `chartSec <= 14400`, `runtime.error` present in source, and the refusal message names 5m, 15m, 1H and 4H |
| **5m, 15m and 1H** | each run on real sub-4H bars (48, 16 and 4 per 4H bar) while `request.security(sym, "240")` is served the original 4H series. Without that split the provider would hand the chart's own bars back for the 4H request and every check below would pass while testing nothing |
| Context is the last COMPLETED 4H bar | asserted on every checked bar of all three lower timeframes against the 4H build's own numbers |
| Lookahead | zero reads of the 4H bar the chart is currently inside, on all three |
| Context age | always inside one 4H period, on all three — so the panel can state how old the reading is instead of letting a reader assume it refreshes |
| Context clock | ticks approximately once per 4H period below 4H, and on every bar at 4H |
| Repainting | history-prefix invariance across 9 context measurements × 480 settled bars: extending the chart changes nothing already settled |
| `lookahead_on` usage | every occurrence paired with a `[1]` offset, plus the documented previous-completed-daily idiom |

### Plan lifecycle, instrument and chart guards

The plan refuses rather than produce a confident number it cannot justify.

| | |
|---|---|
| Active requires a manual entry | ACTIVE with a live entry is blocked on every bar, and the panel says to set the price you actually filled at |
| ...and works with one | ACTIVE with a manual entry sizes normally |
| Non-standard chart + live entry | detected, blocked, no size produced at all, and the panel names the problem |
| Non-standard chart + manual entry | allowed — the price is one the user typed, so it is real. Market context is unaffected either way, because it comes from the reference symbol |
| Non-linear instrument | a point value ≠ 1 is detected and the plan refuses rather than size it, in plain words |
| Unknown point value | an instrument reporting no point value is allowed **through**, not rejected. A false refusal on a correct chart is worse than the warning it replaces |
| Below minimum order | a size under the instrument minimum is flagged and named on the panel |

### Plan alerts

Two independent observations. The duplicate guard is measured through
fired/suppressed counters, because a counter is a direct measurement of it. The
message text is read back out of the alerts the run actually emitted, so it is
verified as delivered rather than as spelled in the source.

| | |
|---|---|
| Off by default | with plan alerts off, nothing fires |
| Fire once per level | PLANNING fires exactly once on the entry touch |
| Re-touch suppressed | every later touch of the same unmoved level is counted as suppressed |
| Stage-appropriate | ACTIVE fires on stop or target touches, not on entry |
| R ladder is opt-in | enabling 1R/2R/3R can only add alerts, never remove one |
| Messages are **delivered**, not merely spelled | the offline runtime's default `alertMode: "realtime"` silently drops every alert except on the last bar, which is why an earlier suite could only assert that a string existed somewhere in `main.pine`. `run()` now overrides that mode and reads the emitted messages back out of `ctx.alerts`, so what is asserted is what a user would actually receive |
| ...and their construction is exact | the delivered PLANNING message matches `^BTC Trading Assistant · PLANNING · LONG · Entry touched at [\d,.]+$` in full — product, stage, direction, level type and price. Exit alerts are asserted to name which level was touched (Stop / Target / 1R / 2R / 3R) |
| Stage cannot be misread | ACTIVE messages contain `ACTIVE ·`; ACTIVE never delivers an entry alert for a position already taken, and PLANNING never delivers a stop alert for a trade not yet entered. Both asserted against delivered output, not against source text |
| Confirmed bars only | touches are gated on `barstate.isconfirmed`, so an intrabar wick that closes back inside does not fire |
| v1.0 context alerts | unchanged (`alert.freq_once_per_bar_close`) |

### Drawing lifecycle

The failure this guards against does not show up as a wrong number: the script
quietly reaches `max_lines_count`, Pine drops the **oldest** objects, and the plan
the user is looking at disappears while the chart fills with stale ones.

| | |
|---|---|
| One allocation site each | exactly **1** `line.new()` and **1** `box.new()` call site in the whole script |
| Allocation only when the handle is `na` | asserted structurally on both |
| Persistent handles | **9** `var line` / `var box` handles, so the object count is fixed for the life of the script |
| Updated, not rebuilt | drawings run under `if barstate.islast`, and existing objects are moved with `line.set_xy1` / `box.set_lefttop` rather than replaced |
| Hidden levels cost nothing | a level that should not be shown is drawn fully transparent, so hiding one never changes the object count and the ceiling never becomes a function of the user's settings |
| Declared ceilings | `max_lines_count` 20 and `max_boxes_count` 5, against 7 lines and 2 boxes actually used |

### The Decision UI

| | |
|---|---|
| **No automatic entry recommendation** | with no plan entered, the Decision view contains no `LONG`, `SHORT`, `BUY` or `SELL` anywhere. This is v1.1's **behavioural** replacement for v1.0's exact-phrase assertion on `AUTOMATIC SIGNAL — NONE VALIDATED` |
| The footer carries the same meaning | `DISCRETIONARY MODE · NO AUTO ENTRIES` is asserted present, with and without a plan, and the old full-width headline row is asserted **absent**. The disclaimer changed form, not meaning |
| No entry instruction | 8 imperative phrases (`buy `, `go long`, `take profit`, `signal:`, …) all absent |
| A direction appears only when typed | `LONG` appears once the user has entered one, and not before |
| No research vocabulary | 14 forbidden terms (σ, z-score, percentile, p-value, sample, confidence, …) absent from both the Decision view and the Planning view, and no percentile rank is printed |
| Structure | the three context rows always present; `4H CONTEXT` and its age always stated; VOLATILITY carries a plain ATR percentage, not a rank; a quiet market spends no row saying it is quiet |
| Dynamic hierarchy | with a plan on the plan is first and the market compresses to one line; Planning shows ENTRY / STOP / TARGET / SIZE / RISK / COST / BREAKEVEN / PRICE→ENTRY |
| Active view | shows LIVE, NET P&L, TO STOP, TO TARGET, and drops PRICE→ENTRY |
| Display mode is presentation only | 16 measurement hooks identical across Decision, Detailed and Debug on every bar |
| Panel size is presentation only | Compact, Normal and Large produce the same row content |
| Table capacity | worst case (Debug, all adapters live, anomaly list at ceiling, plan on) stays within the 76 declared rows |
| Defaults | plan off, external context off, alerts off, 200MA off, all four adapters off — and **costs on**, the honest default |

### Data honesty and semantics

| | |
|---|---|
| Chart independence | 9 context measurements identical on an ETHUSDT chart — the chart symbol cannot reach a context reading |
| Planner follows the chart | live entry differs by symbol, as intended, and a non-BTC chart is told so |
| USD-notional OI guard | rejected on both the declared-currency and the implausible-magnitude path; no positioning reading produced, and the rejection is stated on the panel |
| Unwired adapter | reports MISCONFIGURED on every bar and produces no reading |
| Frozen adapter | reports LIKELY STALE past its threshold and its reading is withdrawn |
| Liquidation balance | withheld until the shared unit is declared; once declared, in [−1, +1] |
| Direction from raw value | across 6 measures, the direction code equals `sign(raw)` on every observation |
| Percentile range | across 9 percentile series, every observation lies in [0, 100] |
| z standardisation | OI 24H mean near zero, sd near one, asserted with bounds |
| Hysteresis ladder | never exceeds level 2; off below its exit; on at its extreme entry |
| Trend state sign | an engaged trend state always agrees in sign with its raw ATR distance |

### Palette

| | |
|---|---|
| Derivation is asserted | the palette reads `chart.bg_color`; brightness is Rec. 601 luma, not a channel average; a single `isDark = bgLum < 0.5` threshold decides the theme; panel text is `chart.fg_color`; **0** colour inputs; every palette entry defines both a dark and a light value |
| Rendering is **not** asserted | nothing offline draws anything. Legibility on each theme is manual item 14 |

### Migration differential

Still run against both frozen v1.0 baselines, `tests/baseline/market-radar-v3.3.pine`
and `tests/baseline/trade-risk-planner-v1.0.pine`.

| | |
|---|---|
| Market context vs `BTC 4H Market Radar v3.3` | 45 measurements × 1,500 bars, all four adapters live. Split into **11 EXACT** (inline or discrete: feed status codes, 11 direction codes, 10 hysteresis levels, anomaly count, the full event log) which must be bit-identical, and **34 BOUNDED** (values crossing the offline runtime's measured 10-decimal rounding of function returns and array reads) whose worst relative residue must stay under 1e-3 |
| The rounding boundary is measured, not assumed | a probe script measures it on every run. On TradingView arrays and function returns are exact float64, so this residue is expected to be zero there — which is why it is manual item 7 rather than a result the offline run is allowed to stand in for |
| Structural differences | zero: no BOUNDED measurement may be defined on one build and undefined on the other, and every measurement in both groups must actually carry data |
| Discrete state | every feed status code (SOPR excluded — removed by decision), every direction code, every hysteresis level, the shared boolean state and the event log all bit-identical |
| Trade planner vs `Trade Risk Planner v1.0` | 8 configurations × 1,500 bars — both directions, pinned and live entry, ATR and explicit stop, cap binding and not, stop on the wrong side. Notional, risk, 1R and 3R are recomputed from the new build's outputs and checked against the baseline's own plots, which proves the derivations as well as the values |

> **The caveat that matters: the planner differential runs with costs OFF.**
> Cost-aware sizing is new behaviour that no baseline had, so with costs off
> `riskPerUnit` collapses to the gross stop distance and the arithmetic is v1.0's
> exactly. That is the honest comparison. Turning costs on and then declaring the
> result identical would be comparing two different questions and calling the
> answer a pass. Cost behaviour is covered by the ground-truth tests above
> instead.

---

## MANUAL TRADINGVIEW REQUIRED

None of these can be checked offline. Each needs the Pine Editor and a live
chart. **None has been performed.**

| # | Check | Why it cannot be automated |
|---|---|---|
| 1 | **Pine v6 compiles** | PineTS does no type checking whatsoever. A branch-type mismatch Pine rejects (CE10235) runs happily offline — it has cost one round trip through the editor already. The lint in the suite catches the known shape, not the language. v1.1 also introduces `calc_bars_count` on all 13 requests, which the offline runtime ignores entirely. |
| 2 | **Compiler warnings** are read and resolved | Not modelled offline. |
| 3 | **5m BTCUSDT.P** — context populates and matches the 4H chart's previous completed bar. **This is the gate for the README's 5m claim.** Also 15m, 1H and 4H. | The offline 5m test runs on *synthetic* sub-bars built by splitting real 4H bars, served by a local provider. Real HTF aggregation, real 5m data density and TradingView's own `request.security` semantics are all unexercised. Until this is done, 5m is offline-verified only and the README must say so. Check item 23 at the same time — the OI rows are the part most likely to differ. |
| 4 | **Real symbol resolution** — `BINANCE:BTCUSDT.P`, `BINANCE:BTCUSDT`, `BINANCE:BTCUSDT.P_OI` | Symbols are served locally offline; spelling and availability are unverified. |
| 5 | **OI feed denomination** — confirm `_OI` really is base-unit and is not rejected by the units guard | `syminfo.currency` is stubbed offline. The guard is exercised, but never against the real feed it is meant to admit. |
| 6 | **Long history loads** without `max_bars_back` errors, and `calc_bars_count = 2500` does not truncate the 2,190-bar percentile | The volatility percentile asks for 2,190 4H bars inside a request context; offline data cannot reach that depth, and the bound is not enforced offline at all. |
| 7 | **Float precision residue is zero** | The offline runtime rounds function returns and array reads to 10 dp; TradingView does not. The 34 BOUNDED differences documented above are expected to vanish. Confirm a Detailed reading matches the offline number to full precision. |
| 8 | **Digit grouping renders** — prices should read `79,800.00` and notional `$65,000` | The offline runtime ignores the `,` grouping in `str.tostring(x, "#,###.##")` and prints `79800.00`. Cosmetic only, but it is the Decision view's headline number. |
| 9 | **Volatility percentile populates** | Its 2,190-bar window exceeds any offline sample, so VOLATILITY reads `No data` in the fixtures. On a real chart with ~1 year of 4H history it must show a level. |
| 10 | **`input.source()` picker** — wire a real funding / ETF / liquidation plot | The picker cannot be driven from Node; adapters are substituted with expressions at the point the user's plot would arrive. |
| 11 | **`active =` actually greys out the intended inputs** in the settings dialog | The offline runtime ignores the parameter entirely. All 29 uses are counted, none is observed. An `active =` predicate that is subtly wrong would grey out the wrong field and nothing offline would notice. |
| 12 | **`input.price()` renders a DRAGGABLE marker** for Entry, Stop and Target, and dragging updates size, risk, cost, target and R live | Offline the input is read as a number. That it appears as a chart marker at all, and that the whole panel recomputes as it is dragged, is purely a TradingView UI behaviour. |
| 13 | **Risk and reward BOXES render** at the right prices with readable opacity, and `extend.right` behaves | No geometry is rendered offline. Only the box's arguments are computed; nothing draws them, and opacity has no offline meaning. |
| 14 | **Light theme and dark theme are both legible**, and the `chart.bg_color` luma branch picks the right palette on each | `chart.bg_color` is stubbed offline, so only one side of the `isDark` branch is ever taken. Contrast is a visual judgement no assertion can make. |
| 15 | **Panel size Compact / Normal / Large** all render without truncation or overflow | Row *count* is asserted identical across sizes; text size, column widths and visual height are not modelled. |
| 16 | **Planning view and Active view both render**, and the Active block appears only in Active | Cell text is inspected offline; layout, alignment and truncation are not. |
| 17 | **Plan alerts reach the user** — create the alert with "Any alert() function call" and confirm it arrives | The *message text* is now asserted against delivered output (see Plan alerts above), so what remains is the plumbing either side of it: that the alert dialog offers the option, that TradingView's alert engine picks up the `alert()` call at all, and that it survives the chart being closed. None of that is modelled offline. |
| 18 | **`syminfo.mincontract`, `syminfo.pointvalue` and `syminfo.mintick` return real values** | All three are `na` in the offline runtime. The minimum-order warning, the non-linear-instrument refusal and the tick rounding are therefore structurally tested against *substituted* values and never exercised on real data. Confirm on a real linear perp that the point value is 1, the tick is real, and no false refusal or false warning appears. |
| 19 | **`chart.is_standard` on a real Heikin Ashi / Renko chart** | Always `true` offline; the guard is tested by substitution only. |
| 20 | **Drawing object counts stay within `max_lines_count = 20` / `max_boxes_count = 5`** over a long chart | The `var`-handle lifecycle is proven structurally, but Pine's actual object accounting — and what happens across a chart reload or a settings change — is not modelled. |
| 21 | **Runtime performance on a long 5m chart** | 13 `request.security` calls plus a 2,190-bar percentile. Execution time is not measurable offline, and `calc_bars_count` — the thing meant to bound this work — has no offline effect. |
| 22 | **`calc_bars_count` actually reduces load** on a long 5m chart | The suite proves the bounds are large enough not to truncate a reading, and that adding them changed no value. It cannot prove they *help*: the offline runtime accepts the parameter and gives no way to observe whether it honoured it. Compare load with and without on a real chart, and confirm no `max_bars_back` or truncation error appears at either bound. |
| 23 | **On a 15m or 5m chart, confirm OI 24H and OI 4H readings populate** | A real PineTS/TradingView divergence found during this work: offline, `int(time[1])` inside a `request.security` resolves against the **chart** rather than the requested context, returning the containing 4H bar's open instead of the previous completed one. `barsBehind()` is therefore one bar pessimistic below 4H, which suppresses `oiObs` — the gate on every open-interest change reading — in the offline fixtures. On TradingView the timestamp should resolve in the requested context and the readings should appear. Until this is confirmed, an absent OI row on a lower-timeframe chart cannot be told apart from the offline artefact. The context **age** was deliberately rederived from the chart-scope context clock rather than from the requested timestamp precisely so it stays testable; the freshness path still depends on the requested timestamp and so is not. |
| 24 | **The settings dialog opens on five controls** — `Trade plan` holding Enable / Direction / Stop price, and `Account` holding Account equity / Risk (%), with everything else below under a group named Advanced | The suite asserts the *declarations* in `main.pine`: which group each input belongs to, that the first two groups hold exactly those five labels, and that none of them is a dropdown. It cannot see the rendered dialog. TradingView's own ordering, collapsing and spacing decide what a first-time user actually meets. |
| 25 | **A first-time user creates a valid plan by changing at most four things** — Direction, Stop, Account equity, Risk (%) — without opening an Advanced group or reading the README | This is the release's acceptance criterion and it is a human judgement. Give it to someone who has never seen this repository and watch where they hesitate. |
| 26 | **Dragging the Stop price marker** updates size, risk, cost, break-even and the drawn zones live | Covered in part by item 12, but the stop is now the *primary* interaction rather than one of three, so it is worth its own pass. |
| 27 | **Long and Short both produce a sane panel** from the same stop workflow, and the wrong-side guard still fires when the stop is on the wrong side | Asserted offline as arithmetic; unverified as an interaction. |
| 28 | **`Position opened` on with no fill price** shows `SET ACTUAL FILL PRICE` and no live R, and setting the fill switches the panel to ACTIVE | The state machine and the panel text are asserted offline. What is unverified is that `Actual fill price` renders as a draggable marker and that the transition is legible while it happens. |
| 29 | **Each Advanced override behaves in the dialog** — `Use manual entry`, `Use ATR stop`, `Use custom target`, `Use fixed cash risk` — including that the input each one supersedes reads as superseded | `Stop price` and `Target (R)` are deliberately *not* greyed out when their Advanced override is on, because the group ordering that would allow it would push Advanced above Trade plan. The checkbox label is the only thing telling the user the field is now ignored. Confirm that reads clearly, or accept it as a known rough edge. |
| 30 | **Dashboard at the default Middle right clears the symbol / OHLC header** at the top of the chart | This item has now been wrong twice. v1.2.0 defaulted to `Top right` and the price-scale label crossed it; v1.2.1 moved to `Top left` and the OHLC header covered it. `Middle right` is the third attempt and has not itself been seen on a chart. Offline nothing is rendered, so nothing here can be settled without looking. |
| 31 | **How often the current-price label crosses the panel in practice** — check on **5m, 15m, 1H and 4H desktop charts**, over a session, since the label tracks price and the panel's height tracks content | The right-hand side cannot be made collision-free: the label moves. What is being judged is whether an intermittent overlap is acceptable against a permanent one, which is a judgement, not an assertion. If it is not, the honest answer is `Middle left`, not another claim about the right. |
| 32 | **Risk / reward boxes occupy a compact region to the right of the last bar** and do not extend to the edge of the chart | `extend` is absent from `box.new()` and the coordinates are asserted, but whether 16 bars *looks* right on each timeframe is a visual judgement. |
| 33 | **LONG: the green area is entry→target above, the red area entry→stop below.** **SHORT: red above, green below** | Asserted numerically per direction. What is unverified is that Pine draws a box whose top is below its bottom the way this code assumes it never has to. |
| 34 | **Scrolling and zooming** — the boxes travel *with the candles*, staying glued to the last bar, and scroll off the screen when you pan far enough away. The level lines stay visible the whole time | Offline this reduces to "the left edge equals `time` on every bar", which is asserted. What that cannot show is whether it *looks* like part of the chart while you pan. v1.2.2 held the boxes still on screen and passed its own tests; the defect was that the result read as a watermark. Only looking settles this. |
| 35 | **Panning is no slower than any other indicator**, on a long 5m chart | v1.2.2 read `chart.right_visible_bar_time`, which made TradingView re-execute the whole script on every scroll. That read is gone, so this should now be a non-event — confirm it is, rather than assuming the removal was free. |
| 36 | **The level lines now `extend.both`** — confirm they are visible across the whole chart at every zoom level and do not obscure old price action at 92% opacity... they are lines, so check they read as reference rather than as clutter | Line rendering and visual weight are not modelled offline. |
| 37 | **Dragging the stop** redraws both boxes cleanly, with no ghost objects left behind, over many drags | Object identity is proven structurally (one `box.new()` behind an `na` guard, nine persistent handles). Pine's actual redraw behaviour under repeated input changes is not. |
| 38 | **Switching Long ↔ Short** flips the box assignment on screen without leaving the previous orientation behind | Same reason. |
| 39 | **Both themes** — the 92%-transparent fills are visible but do not dominate the candles on dark *or* light. Confirm the red and green are still distinguishable at that opacity | Opacity has no offline meaning, and `chart.bg_color` is stubbed, so only one side of the `isDark` branch is ever taken. This is a judgement about legibility that no assertion can make. |

---

## PRICE-SCALE ALIGNMENT (items 40–46) — the whole point is that nothing offline covers this

A screenshot showed the panel printing `STOP 72,940.9` while the stop line sat at
roughly 65k of chart height, and the plan levels not moving with the price axis
under a vertical pan.

**Read this before running the items.** In the shipped file the panel row and the
level line are the *same value*: the row is `addRow(..., px(rt(stopPx)), ...)` and
the line is `lvlLine(..., rt(stopPx), ...)`. Pine cannot place a line at a price
other than the one it is given. So a line rendering at a different height than the
number the panel prints is a statement about **which price scale TradingView has
bound this indicator instance to**, not about the arithmetic — and TradingView
documents this exact symptom under *"No Scale"*: *"The indicator moves
independently from the candles when you scroll or zoom the chart"*, *"The line
'floats' across the screen and doesn't 'stick' to the price bars."*

That is a hypothesis from the code and the vendor docs. It is not a finding.
Items 40–46 are what would make it one.

| # | Check | Why it is here |
|---|---|---|
| 40 | **The one-toggle discriminator. Turn on `Daily 200MA` in Display.** It plots a real price series that should hug the candles. If the orange 200MA is *also* at the wrong height → the whole indicator is on the wrong scale and no drawing is involved. If the 200MA sits correctly on the candles while the plan lines do not → the hypothesis is wrong and this becomes a Pine bug | This is the only test that separates "wrong scale" from "wrong drawing" in a single look, and it needs no measurement. Run it first. It also gives you a plotted line to right-click, which matters for item 42: by default this script's only plot is `na` on every bar, so there is often nothing on the chart to open the scale menu from except the legend text. |
| 41 | **Which scale each thing is on.** Record, separately: the scale of the BTC candles, and the scale shown under the indicator's `Pin to Scale` menu | The report asks for these as three distinct facts. Do not infer one from the other. |
| 42 | **`Pin to Scale` → same scale as the candles** (right-click the indicator's name in the legend, or the `⋯` menu next to it → `Pin to Scale` → the scale the price is on, usually `Scale A` / `Right`). Record whether the misalignment disappears | If it disappears, the arithmetic was never involved and no Pine change is warranted. Record that plainly rather than patching something. |
| 43 | **A clean instance.** Remove the indicator from the chart entirely, `Add to chart` again, change no scale setting, repeat items 40–42 | `Pin to Scale` is per-instance and saved with the layout, so an old instance can carry a setting a fresh one never gets. If the fresh instance is correct and the old one is not, this is saved chart state, and the honest conclusion is that Pine cannot prevent it. |
| 44 | **Alignment of each level against the BTC axis** — `ENTRY`, `STOP`, `TARGET`, `BREAKEVEN`. For each: the panel's number, and the price the main scale shows at that line's height. They must agree within one tick | The offline suite proves the panel number equals the drawing's y *value*. Only this item connects that value to a pixel on the BTC axis. |
| 45 | **Vertical pan, vertical zoom, auto-scale on/off.** After each, repeat item 44 | No Pine value changes under any of these — y coordinates are prices, and a price does not know where the viewport is. So a level that moves relative to the candles here is conclusive: it is the scale binding, not the script. |
| 46 | **Horizontal scroll and 4H → 1H → 15m.** Repeat item 44 at each timeframe | A timeframe change re-executes the script, so this catches anything that made a level depend on bar size. `PLAN_BARS` is an x-axis quantity and must not be touched in response to a y-axis symptom. |

**Reproduction for items 40–46:** `BINANCE:BTCUSDT.P`, 4H. Trade plan on,
`Direction = Long`, entry left at the default (current price), `Stop price =
72,940.9`.

**If items 42 and 43 both fix it, do not change the Pine.** The declaration is
already `indicator(..., overlay = true)` with no `scale` argument, which is what
binds a script to the chart's existing price scale. The two available
alternatives are both worse: `scale.none` is the documented *cause* of this
symptom, and `scale.right` attaches the script to a *new* right scale rather than
the existing one. There is no Pine API that forces an instance onto the main
scale, so prevention is a README note, not a code change.

---

## Not part of this indicator

`tools/microstructure/` is a Node collector for the M2 prospective order-book
study. It has its own test suite (`npm test` runs it) and never touches Pine.
