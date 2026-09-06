# Migration record

This directory replaces five standalone projects. They were deleted from the
working tree rather than moved to an `archive/` folder, because git history is
already the archive and a folder full of dead code is not a record, it is a
liability. This file states what moved, what was deliberately dropped, and how
each claim was checked.

| Removed directory | What happened to it |
|---|---|
| `btc-4h-market-intelligence` | Market Context merged into `../main.pine`. Research condensed into [`rejected-studies/market-regime.md`](./rejected-studies/market-regime.md). `main.pine` kept as a test fixture at `../tests/baseline/market-radar-v3.3.pine`. |
| `btc-4h-trade-planner` | Trade planner merged into `../main.pine`. Research condensed into [`rejected-studies/trade-plan-4h.md`](./rejected-studies/trade-plan-4h.md). `planner.pine` kept as a test fixture at `../tests/baseline/trade-risk-planner-v1.0.pine`. |
| `btc-4h-regime-engine` | No runtime code. Research condensed into [`rejected-studies/market-regime.md`](./rejected-studies/market-regime.md). Its 4H data cache moved to `../tests/data/btc-4h.json` (gitignored) and its fetch script to `../tools/fetch-4h.mjs`, because the migration differential runs on that data. |
| `btc-intraday-trade-planner` | No runtime code. Research condensed into [`rejected-studies/intraday.md`](./rejected-studies/intraday.md). Its `stats.mjs` multiple-testing functions were inlined verbatim into `../tools/microstructure/research/stats.mjs` — see "Inlined dependency" below. |
| `btc-microstructure` | Prospective collector migrated to `../tools/microstructure/`. Research condensed into [`rejected-studies/microstructure.md`](./rejected-studies/microstructure.md) and [`microstructure/m2h.md`](./microstructure/m2h.md). Everything else deleted. |

---

## 1. Market Context — what changed and what did not

The Market Context engine was verified against the indicator it replaces, bar by
bar, on 1,500 bars of real 4H BTC data with all four external adapters live. The
test is `../tests/differential.test.mjs` and it runs on every `npm test`; both
originals are kept under `../tests/baseline/` so it can still run now that their
directories are gone.

**Identical, asserted bit-for-bit:** every feed status code, every raw-value
direction code (11 measures), every hysteresis intensity level (10 measures),
the OI units guard, the anomaly count, and the whole event log (1,366 accepted /
1 suppressed).

**Identical, asserted to the precision the offline runtime allows:** the
continuous measurements. The runtime rounds every user-function return and every
`array.get()` to ten decimal places — the suite measures this rather than
assuming it — and this build crosses that boundary where the baseline did not,
because its 4H windows are computed inside a `request.security` context or
through a 4H buffer. The residue is at most 3.1e-4 relative, on the perp
premium's z-score, whose standard deviation is itself ~1e-4. It moves no ladder
level, no direction code and no event, which the bit-exact group proves
independently. TradingView's arrays and function returns are exact float64, so
this residue is expected to be zero there; it is listed as a manual check in
[`../TRADINGVIEW-VALIDATION.md`](../TRADINGVIEW-VALIDATION.md).

### Intentional removals

Two measures were dropped rather than migrated. Neither is a semantics change;
both are absent.

- **SOPR.** A Glassnode symbol many TradingView plans do not resolve, not part
  of the retained descriptive set, and nothing in the panel depended on it.
- **Estimated flow proxy** (`request.security_lower_tf` classifying
  lower-timeframe bars by their own direction). It was labelled ESTIMATED
  because it is not aggressor data, the offline runtime cannot execute it at
  all, so it was never verified, and Study M1 established that even *real*
  aggressor flow carries no tradable directional information.

### Intentional UI-only changes

The measurements underneath are unchanged; only the words differ.

| Was | Is | Note |
|---|---|---|
| `STRONG UP / UP / MIXED / DOWN / STRONG DOWN` | `Strong uptrend / Uptrend / Neutral / Downtrend / Strong downtrend` | Same `trendScore` partition, asserted against the score itself. |
| `HIGH / ELEVATED / NORMAL / LOW` | `High / Elevated / Normal / Low` | Same percentile thresholds. |
| Decision showed `SETUP REQUIRED` and an optional-adapter count | Both moved to Detailed | An optional feed you enabled and did not wire is not a reason to spend the daily panel. Core failures still surface in Decision. |
| Panel title `BTC 4H DECISION RADAR` | `BTC TRADING ASSISTANT` | One product name everywhere. |

### One behaviour change, deliberate

A reference feed that stops producing bars now **freezes** the context instead of
letting `request.security`'s carry-forward push a repeated value into every
normalisation window. Repeating a value re-weights it once per missing bar, which
is precisely the failure the missing-value policy exists to prevent. `DATA`
reports the staleness either way. On the test data — which has no reference gaps
— the two behaviours coincide, which is why the differential is unaffected.

---

## 2. Timeframe support, and a bug it caught

The product now runs on any chart at or below 4H, with Market Context always
reading BTC 4H data. Getting there exposed a real defect worth recording, because
it would have shipped silently.

The obvious way to ask for "the previous completed 4H bar only when the chart is
below 4H" is a conditional history offset:

```pine
OFS = timeframe.in_seconds(timeframe.period) < 14400 ? 1 : 0
x = request.security(sym, "240", close[OFS])          // WRONG
```

A `request.security` expression is evaluated in the **requested** context. Inside
it, `timeframe.period` is `"240"`, so `OFS` evaluates to `0` on every chart —
including exactly the charts it exists to shift. The context silently became the
bar the chart was sitting inside.

The fix is to request both forms and select in chart scope, where `isLTF` means
what it says:

```pine
[rCn, ...] = request.security(refSym, CTX_TF, [close, ...])
[rCp, ...] = request.security(refSym, CTX_TF, [close[1], ...], lookahead = barmerge.lookahead_on)
rC = isLTF ? rCp : rCn
```

Both requests always execute, so neither `ta.*` window develops holes. At 4H the
plain branch is selected and the reading is identical to computing the context
natively, which is what keeps the differential meaningful.

This is verified, not asserted: `../tests/main.test.mjs` builds 1,600 synthetic
1H bars that aggregate exactly to 400 real 4H bars, serves the 1H series to the
chart and the 4H series to `request.security`, and checks every bar. Result:
1,592 of 1,592 read the last completed 4H bar, and **0** read the bar the chart
is inside.

---

## 3. Trade planner

Compared against `planner.pine` across 8 configurations × 1,500 bars — both
directions, pinned and live entry, explicit and ATR-derived stop, the leverage
cap binding and not binding, and a stop on the wrong side of entry. 12,000 bars
compared, 10,461 carrying a live plan, **all outputs identical**.

Entry, stop, size, chart ATR and the trailing reference are compared against the
baseline's own plots. Notional, risk taken, 1R and 3R are *recomputed* from the
new build's outputs and checked against the baseline's plots, which tests the
derivations as well as the values.

Two additions, neither of which changes any existing number:

- `Enable trade plan`, off by default, so the panel reads `NOT SET` until you
  enter a plan. A size printed from numbers you did not type is worse than no
  size.
- Required leverage is now shown next to the cap. It was always computed; it was
  not previously displayed.

---

## 4. M2 prospective collector

**The prospective identity is unchanged. This was the constraint the migration
was planned around, not something checked afterwards.**

| Field | Value | Status |
|---|---|---|
| `M2_PROSPECTIVE_START` | `2026-09-06T08:37:34.395Z` | unchanged |
| `startedAtMs` | `1788683854395` | unchanged |
| `startedLastUpdateId` | `11487726285292` | unchanged |
| Freeze commit | `64da58399bfb6b50f8901b7d2dd1c17ae8903130` | unchanged |
| `frozenAt` | `2026-09-06T08:37:24.000Z` | unchanged |
| `schemaVersion` | `v1` | unchanged |

### Path mapping

| Old | New |
|---|---|
| `btc-microstructure/collector/` | `btc-trading-assistant/tools/microstructure/collector/` |
| `btc-microstructure/features/` | `btc-trading-assistant/tools/microstructure/features/` |
| `btc-microstructure/research/{m2,coverage,stats}.mjs` | `btc-trading-assistant/tools/microstructure/research/` |
| `btc-microstructure/research/M2-FREEZE.json` | `btc-trading-assistant/tools/microstructure/research/M2-FREEZE.json` |
| `btc-microstructure/data/` | `btc-trading-assistant/tools/microstructure/data/` |

`config.mjs` derives every path from its own module location, so the move needed
no code change. The freeze marker stays beside the collector rather than in
`research/microstructure/` because the collector *reads* it — it is operational
state, not narrative evidence.

### How the live process was migrated

The collector was running (PID 47676, ~4h uptime) and writing to the old path
throughout. It was not migrated by copying underneath itself:

1. Captured the running state: 141,316 depth / 63,380 trade / 14,250 feature
   events, `lastU.depth = 11488883470957`, `lastAggId = 3441527301`.
2. `SIGTERM` — `run.mjs` traps it and flushes to disk before exiting.
3. Copied the archive with the source now static, and verified **byte-identical**
   sha256 for all four gzip partitions plus `MANIFEST.json`,
   `PROSPECTIVE.json` and `collector-state.json`.
4. Restarted from the new path.
5. Verified it re-entered `phase=prospective` immediately, with the freeze
   marker recognised and `PROSPECTIVE.json` untouched.
6. Verified **no double ingestion** by reading the whole depth archive back:
   142,714 events, update ids strictly increasing, **0 duplicates and 0
   out-of-order** across the restart boundary. The writer's restart-safe skip
   (`u <= lastU`) is what makes this hold.

There is a short gap in the sample where the process was down. That is an
ordinary restart gap of the kind reconnects already produce; it does not affect
the prospective boundary, and the manifest records phase counts per partition
either way.

**To restart it by hand:**

```bash
cd btc-trading-assistant/tools/microstructure
node collector/run.mjs          # or: npm run collector  (from the product root)
```

### Inlined dependency

`tools/microstructure/research/stats.mjs` previously imported `normInv`,
`normCdf`, `mean`, `stdev`, `effectiveN` and `corrMatrix` from
`btc-intraday-trade-planner/research/stats.mjs`, specifically so that the
effective-trial correction was *literally the same code* in both studies. That
directory is gone, so those functions are inlined **verbatim** rather than
reimplemented — a rewrite would quietly make the two studies' corrections
incomparable, and the whole reason for sharing them was that they were not.
Verified after inlining: `normInv(0.975) = 1.959964`, and `effectiveN` still
collapses two identical series to 2 effective trials.

---

## 5. What was deleted outright

Deleted because it is not needed by the active prospective pipeline and its
result is preserved in a research document:

- **Execution Planner UI and server** — it displayed live order-book
  measurements. M2-H showed there is no tradable directional edge in those, and
  the product ships no order-book display, so a UI for one is not a product.
- **M2-H historical replay infrastructure** (`historical/`: Tardis adapter,
  streaming replay, columnar feature store, reconciliation, replay UI, backtest
  UI) and its ~12 GB of vendor archives. The study is complete and condensed
  into [`microstructure/m2h.md`](./microstructure/m2h.md); the implementation is
  in git history at `8b3aeb1`, `8d283a1` and `5fac0d2`.
- **M1 executable pipeline** — aggTrade/kline fetchers, the M1 runner, the audit
  and smoke scripts, and the 204 MB kline cache. Result in
  [`rejected-studies/microstructure.md`](./rejected-studies/microstructure.md).
- **Failed strategy research code** for TP1, IT1, IT2 and IT3 — every engine,
  runner and results JSON. All rejected; results condensed.
- **Websocket route probe** (`research/probe/`) — its finding (aggTrade is served
  only on `/market`) is recorded in `collector/config.mjs` with the date it was
  observed, which is where it is actually needed.
- **`footprint-live.pine`** — a separate experimental file the offline runtime
  could never execute.

Deleted test suites: `historical.test.mjs` and `ui.test.mjs`, with the code they
covered.

---

## 6. Verification summary

| Claim | How it was checked | Result |
|---|---|---|
| Market Context semantics unchanged | 45 measurements × 1,500 bars vs the baseline | discrete bit-identical; continuous within measured runtime rounding |
| Trade planner unchanged | 8 configurations × 1,500 bars vs the baseline | identical |
| 4H context correct below 4H | 1,600 synthetic 1H bars vs 400 real 4H bars | 1,592/1,592 use the last completed bar |
| No lookahead | same test, checking for reads of the containing bar | 0 |
| No repaint | history-prefix invariance over 4,141 settled values | 0 drift |
| Context ignores the chart symbol | every reading on a BTC chart vs an ETH chart | 3,421 values identical |
| Prospective identity | freeze and prospective JSON before/after | unchanged |
| No double ingestion | full re-read of the depth archive | 0 duplicates in 142,714 events |
| Published indicator untouched | git tree hash before/after | see the final report |

---

## 7. v1.1 — what changed, and what was checked to prove it did not

v1.0 consolidated five projects into one. v1.1 rebuilt the product layer on top
of that consolidation without touching the research layer. The rule was the same
one that governed the consolidation: **nothing that failed a study may reappear
as a feature**, and every claim that a measurement is unchanged must be
demonstrated rather than asserted.

### Market context: unchanged, and proven so

The bar-by-bar differential against the frozen `BTC 4H Market Radar v3.3` still
runs and still passes in full — 45 measurements over 1,500 bars, all four
adapters live. Discrete state is bit-identical: feed status codes, direction
codes, hysteresis levels, the OI units guard, the anomaly count and the whole
event log (1,366 accepted / 1 suppressed). Continuous values differ only within
the offline runtime's measured ten-decimal rounding, worst residue 3.08e-4
relative, which moves no discrete state.

That matters more in v1.1 than it did in v1.0, because v1.1 **froze the
normalisation windows and the hysteresis thresholds into constants**. Turning a
setting into a constant is exactly the kind of change that can silently alter a
default, so the differential is the evidence that it did not.

### Trade plan: identical with costs off, new behaviour tested separately

The planner differential against the frozen `Trade Risk Planner v1.0` runs with
**Include costs in position sizing OFF**, across the same eight configurations.
With costs off, risk per unit collapses to the gross stop distance and the
arithmetic is v1.0's exactly — entry, stop, quantity, notional, risk, 1R and 3R
all identical.

Cost-aware sizing could not be compared against a baseline that never had it, so
it is verified against **independently recomputed ground truth** instead: every
quantity is calculated again in JavaScript from the published formulas and
checked against the Pine, over a grid covering long and short, manual and ATR
stops, live and manual entry, percent and fixed-cash risk, costs on and off, the
exposure cap binding, a manual target, asymmetric per-side costs and zero rates.
Break-even is checked by *simulating the exit* and confirming the net is exactly
zero, not by re-reading the formula that produced it.

Turning costs on and then calling the result identical to v1.0 would have been
comparing two different questions and reporting the answer as a pass.

### Intentional removals

| Removed | Why | Where its job went |
|---|---|---|
| **N-bar trailing reference** (`trailRef`, `showTr`, `trailN`) | A mechanical line that made no claim and answered "how far is price from where this trade stops being alive" badly. | The ACTIVE view's `TO STOP`, in R. |
| **`AUTOMATIC SIGNAL — NONE VALIDATED` row** | Spent the most valuable line on the panel restating something that never changes. | The footer `DISCRETIONARY MODE · NO AUTO ENTRIES`, present in every mode. The meaning is identical; the tests now assert the *behaviour* (the Decision UI issues no directional recommendation) rather than the exact phrase. |
| **23 research parameters as inputs** — the percentile/z window, the volatility percentile lookback, the RVOL window and all twenty hysteresis thresholds | They are research-defined semantics, not preferences. A user retuning them and then comparing their panel with someone else's is the failure the freeze prevents. | Frozen constants, still substitutable by the test suite. |
| **57 hidden `t_*` test plots** | Production sat at 63 of Pine's 64 plot outputs *because of its own tests*. | `tests/build-instrumented.mjs`, appended at test time. Production is now 1 plot. |
| **3 `alertcondition()` outputs** | Consumed output slots and could not carry a computed message. | `alert()` with a message built at fire time, plus a per-level duplicate guard. |

### What did not change

Nothing under `research/` or `tools/microstructure/`. The M2 prospective
collector, its freeze marker and `M2_PROSPECTIVE_START =
2026-09-06T08:37:34.395Z` were not touched by this release: v1.1 is a product
change, and a product change has no business moving a research boundary. The
`session-highs-and-lows-indicator/` directory was not touched either — its git
tree hash is reported unchanged in the release report.
