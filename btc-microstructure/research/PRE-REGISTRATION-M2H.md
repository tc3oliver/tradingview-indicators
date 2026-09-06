# Study M2-H — historical L2 retrospective validation

**This commit freezes M2-H.** It is written before any historical feature-to-return
relationship has been computed or looked at.

M2-H exists so that "is there anything here?" is answered **now**, from years of real
order-book data, instead of in thirty days. The live prospective capture keeps running
and becomes the confirmation step, not the first look.

```
historical L2  →  retrospective evidence, today
live L2        →  prospective confirmation, later
```

Both must use the same feature semantics, or the second confirms nothing about the first.

---

## 0. What M2-H may not touch

The existing M2 prospective study is immutable. `64da583` and `eefe63c` stand, and

```
M2_PROSPECTIVE_START = 2026-09-06T08:37:34.395Z
```

is not moved, not recomputed and not reinterpreted by anything here. No vendor record
ever enters the prospective sample: the two live in different directories, under
different schema versions, and the prospective loader filters on `phase` and
`schemaVersion`. Historical results may not modify a single prospective record.

### Post-freeze changes to M2 code, and why they are not semantic

M2-H needs the historical path to run through the same book and the same features. Three
additive changes were made to `collector/book.mjs`, all after the M2 freeze:

| addition | effect on the live path |
|---|---|
| `applyVendor(ev)` | none — a new method; `apply()` is untouched |
| `checkCrossed()` | none — extracts a check the vendor path calls once per sampled second; `apply()` still checks inline on every event as before |
| `pruneFarLevels(pct)` | none — never called by the collector; only the vendor replay calls it |

No existing line changed, so live feature values are unchanged and `SCHEMA_VERSION`
stays `v1`. The amended hash is recorded in the appendix of
[`PRE-REGISTRATION-M2.md`](./PRE-REGISTRATION-M2.md).

---

## 1. Provider and dataset

**Tardis.dev**, `binance-futures`, `BTCUSDT` perpetual.

| channel | use |
|---|---|
| `incremental_book_L2` (CSV) | book reconstruction |
| `trades` (CSV) | aggressor flow |
| `data-feeds` replay (raw Binance payloads, `U`/`u`/`pu`, `depthSnapshot`, `aggTrade`) | reconciliation ground truth |

Both CSV channels carry an exchange timestamp and a capture-side `local_timestamp`, both
in microseconds. Coverage, cost and the access limit are in
[`DATA-REQUIREMENTS.md`](./DATA-REQUIREMENTS.md).

**Acceptance dataset starts 2020-05-14.** Tardis documents capture problems before that
date for this exchange. Earlier data may be described but may never rescue a model.

### Credentials

`TARDIS_API_KEY` if set. Without it the provider serves the first day of each month
only — 75 of the 2,301 days in the window. In that case:

- the entire engineering path is still built and run;
- results on those 75 days are labelled **PRELIMINARY — NOT AN ACCEPTANCE VERDICT** and
  **cannot produce a PASS**, because 75 scattered days are not the split design below;
- the verdict is reported as **BLOCKED BY HISTORICAL DATA ACCESS**.

Substituting OHLCV bars, sampled REST snapshots or any other cheaper proxy is forbidden.

---

## 2. One feature engine

Historical and live both translate into the canonical events in
`historical/canonical.mjs`, and from there call **the same modules**:
`collector/book.mjs`, `features/book-features.mjs`, `features/flow-features.mjs`,
`features/execution.mjs`. There is no historical-only implementation of any measure. A
backtest computed by different code from the live tool is a backtest of a different tool.

---

## 3. Reconciliation, and the right to proceed

Run **before** the study, because it decides whether the study may run at all.
`historical/reconcile.mjs` answers three questions on an overlapping window:

1. **Does the bulk CSV path reproduce a sequence-verified book?** Rebuild the same
   window from the raw Binance payloads through `OrderBook.apply()` with the exchange's
   own `U`/`u`/`pu` rule, and compare second by second.
2. **Is our live `@100ms` depth equivalent to the `@0ms` stream Tardis captures?** Batch
   the raw 0 ms stream into 100 ms diffs and compare the resulting books.
3. **Does the CSV `side` column mean the liquidity taker?** Correlate the resulting AFI
   against the AFI derived from the raw `m` flag, and against its negation.

### Acceptance thresholds

| check | requirement |
|---|---|
| exchange-state features (bid, ask, spread, microprice, top-5 and top-10 depth, top-5 and top-10 imbalance) | median relative difference ≤ **1e-3** between CSV and sequence-verified |
| 100 ms batching equivalence, same features | median relative difference ≤ **1e-6** |
| aggressor side | correlation with the raw-`m` AFI > **+0.9** |
| overlap | ≥ **300** compared seconds |

Timestamp-alignment and capture-latency differences are reported separately and are not
folded into these numbers.

**If the exchange-state check fails, M2-H stops.** Vendor backtest evidence may not be
carried to the live planner, and no result is reported as if it were about our own feed.

---

## 4. Book reconstruction audit

Per day, into [`AUDIT-M2H.md`](./AUDIT-M2H.md): depth events, level rows, trades,
snapshots, crossed books, invalidations, timestamp regressions, rows dropped before the
first snapshot, pruned phantom levels, maximum book size, valid-book coverage %, missing
seconds and the longest gap.

**Bad intervals are excluded, never interpolated.** A second with no valid book produces
no feature record and therefore no observation. Coverage is reported, not repaired.

Phantom-level pruning: Binance stops maintaining levels outside the depth it tracks, so a
book replayed for hours accumulates levels the exchange abandoned. Levels beyond **±2% of
mid** are dropped every 60 s. This is a fidelity improvement — the pruned levels are
stale by construction — and it is applied only on the vendor path.

---

## 5. Periods

Chronological, fixed here, **RETROSPECTIVE** throughout.

| split | period |
|---|---|
| Development | 2020-05-14 → 2022-12-31 |
| Validation | 2023-01-01 → 2024-12-31 |
| Locked retrospective test | 2025-01-01 → 2026-08-31 |

The locked test may not be used to modify any specification. If a specification changes
after seeing development or validation, that is a **new study version** and the locked
test is spent — it may not be reused as an untouched test.

---

## 6. Features — the M2 six, unchanged

| id | feature |
|---|---|
| D1 | static depth imbalance (top-5, notional) |
| D2 | microprice displacement from mid, bp |
| D3 | order-flow imbalance from L2 changes (5 s AFI) |
| D4 | liquidity withdrawal / replenishment (change in near-touch depth) |
| D5 | pressure-to-capacity |
| D6 | flow × fragility |

No additions. Not RSI, EMA, MACD, VWAP, opening ranges, session setups or candle
patterns. More data is not a licence for more features.

## 7. Horizons

**5 s, 30 s (primary), 5 min.** The primary is fixed here and cannot be reassigned after
seeing results. A pass at 5 s or 5 min with a fail at 30 s is a fail.

## 8. Targets

**Future mid-price return only.** Never last trade — bid-ask bounce would manufacture
predictability. The feature window ends at second *t*; the target is
`log(mid(t + h) / mid(t))` and may not overlap it. Lookahead unit tests are part of the
suite and a feature equal to the past return must not register as prediction.

Controls in every specification: the previous 30 s mid return, spread, log near-touch
depth, hour-of-day fixed effects, Newey–West standard errors at lag 60 s.

---

## 9. Information study

Per feature, per horizon, **separately for development, validation and locked test** —
never only pooled:

β · HAC t · 95% CI · rank IC · decile monotonicity (breakpoints from development only) ·
top-minus-bottom spread **in bp**.

## 10. Economic gate — information is not tradability

| profile | round trip |
|---|---|
| **A** | 10 bp taker commission + the spread and book impact reconstructed from the historical book |
| **B** | 14 bp conservative |
| **C** | 20 bp stress |

Reported per signal: **gross edge bp**, **all-in expected cost bp**, **net edge bp**.

**If gross edge ≤ executable cost, the verdict is NOT TRADABLE** and no strategy is
built, at any t-statistic.

## 11. Strategy translation

Only if the information gates and the economics both pass. No reinvented stops or
targets:

- signal confirmed at second *t*;
- entry at the first executable state after the signal;
- exit at the primary horizon, 30 s later;
- entry and exit priced by **walking the reconstructed historical book**, not mid-to-mid;
- primary size **10,000 USDT**, secondary robustness **50,000 USDT** — the larger size
  may not be promoted over the smaller.

### Fill model

Taker only. Commission, spread, impact, slippage and VWAP all come from the book as it
stood. `mid ± an arbitrary slippage constant` is not acceptable. **If the book cannot be
reconstructed at a moment, that trade is invalid and excluded**, and the exclusion count
is reported.

## 12. Backtest metrics

Trades · gross PnL · net PnL · net expectancy bp/trade · win rate · profit factor ·
Sharpe · Sortino · max drawdown · Calmar · average holding · turnover · longest losing
streak · **best 5% removed** · month-by-month · year-by-year · **long and short reported
separately**.

## 13. Baselines

Absolute PnL alone means nothing. Every candidate is compared against:

1. **random entries** at the same frequency,
2. the **sign-shuffled** signal,
3. the **M1 raw-AFI reversal** baseline (heaviest aggressive selling → long).

## 14. Multiple testing

Raw configurations, unique configurations and **effective independent trials**, estimated
from the correlation of the configurations' daily score series, cumulative across every
study in this repository. Splits, robustness horizons and robustness order sizes are not
counted as independent.

**Statistics may not overturn economics.** If the net edge is negative, the DSR is
irrelevant.

## 15. Stability

Every near-miss in this repository so far has had the same shape: flat or negative early,
positive in the last two years. So:

**The effect direction must be consistent across development, validation and the locked
test.** A pattern that is negative in 2020–22, flat in 2023–24 and positive in 2025–26 is
**REJECTED as REGIME DEPENDENT**, however good the recent part looks.

## 16. Regime analysis

High/low volatility and high/low liquidity splits may be reported **descriptively**. A
regime discovered after the fact may **not** be used to select where to trade. Any such
finding is labelled **EXPLORATORY ONLY** and cannot enter a strategy without its own
pre-registration.

---

## 17. Execution study (Part B), on historical data

Runs regardless of the directional outcome, and can pass on its own.

Given a decision to buy or sell: **immediate market execution vs waiting 5 s vs 30 s**,
implementation shortfall against the decision-time mid, including commission, both sides,
sizes 10k primary and 50k secondary.

Acceptance threshold, carried unchanged from the M2 freeze: a timing rule must change
expected implementation shortfall by more than **0.5 bp** with |t| > 2, or materially
reduce the 95th-percentile adverse tail.

## 18. Maker research

Unchanged and still fenced. Tardis's aggregate L2 carries no individual order queue
identity, so the maker fill model remains **UNRESOLVED**. Passive-order toxicity may be
measured as mid drift; **maker PnL may not be computed**, and maker fees may never be
used to rescue a failing taker strategy.

---

## 19. Reporting, whatever the outcome

The Execution Planner must show the historical evidence either way — a rejection is a
result users deserve to see, not something to bury in a README.

If historical passes but prospective has not yet confirmed, the UI says
**RETROSPECTIVE PASS / PROSPECTIVE COLLECTING**. It may not say VALIDATED. Only
historical PASS *and* prospective PASS earns **PROSPECTIVE SUPPORTED**.

## 20. Decision tree

| outcome | consequence |
|---|---|
| historical information FAIL | directional model **REJECTED**; prospective capture continues as independent future evidence; Execution Planner unaffected |
| information PASS, economics FAIL | **NOT TRADABLE**; no LONG/SHORT |
| historical PASS | build a **retrospective** signal engine; UI shows RETROSPECTIVE PASS / PROSPECTIVE COLLECTING |
| historical PASS + prospective PASS | **PROSPECTIVE SUPPORTED** |
| data access blocked | full engineering delivered, preliminary results labelled as such, verdict **BLOCKED BY HISTORICAL DATA ACCESS** |

The prospective confirmation, when it comes, uses the **frozen historical-selected
model**. No retraining, no retuning.

## 21. Trial budget

6 features × 3 horizons × 1 venue = **18 configurations**, times 3 splits = 54 registry
entries. Two order sizes and the execution study's wait horizons are robustness, not
candidates. Every configuration is written to the registry before any gate is evaluated.
