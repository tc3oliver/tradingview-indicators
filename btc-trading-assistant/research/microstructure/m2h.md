# M2-H — historical L2 retrospective validation

Permanent record of the BTC microstructure historical-replay study. The implementation
(`btc-microstructure/historical/`, the replay UI, the backtest UI, ~12 GB of vendor
archives) was deleted from the working tree after this file was written; it survives in
git history at the commits listed in §12.

**Status: PRELIMINARY — BLOCKED BY HISTORICAL DATA ACCESS.** No microstructure signal
ships.

Sources: `research/PRE-REGISTRATION-M2H.md` (frozen before any feature-to-return
relationship was computed), `research/results-m2h.json` (authoritative numbers),
`research/reconciliation-m2h.json`, `research/AUDIT-M2H.md`,
`research/DATA-REQUIREMENTS.md`, `research/m2h.mjs`, `historical/tardis.mjs`,
`features/book-features.mjs`, `features/execution.mjs`,
`data/historical/MANIFEST-M2H.json`.

---

## 1. Provider

**Tardis.dev**, exchange `binance-futures`, symbol `BTCUSDT` (perpetual).

| endpoint | content | role |
|---|---|---|
| `https://datasets.tardis.dev/v1/binance-futures/incremental_book_L2/{YYYY}/{MM}/{DD}/BTCUSDT.csv.gz` | Tardis-normalised CSV: absolute price levels, `is_snapshot` flag, microsecond exchange + capture timestamps. **No Binance `U`/`u`/`pu`.** | bulk book source |
| `https://datasets.tardis.dev/v1/binance-futures/trades/{YYYY}/{MM}/{DD}/BTCUSDT.csv.gz` | normalised trades with a liquidity-taker `side` column | bulk flow source |
| `https://api.tardis.dev/v1/data-feeds/binance-futures?from=…&to=…&filters=…` | the **original Binance payloads**: `depthUpdate` with `U`/`u`/`pu`, `depthSnapshot` in REST shape, `aggTrade` with `m` | semantic ground truth, sample windows only |

### Earliest acceptable date

`AVAILABLE_SINCE` reported by the API is **2019-11-17**. Tardis documents capture
problems (missing data, latency) on this exchange before **2020-05-14**, so
`RELIABLE_SINCE = '2020-05-14'` (`historical/tardis.mjs:32`) is the start of the
acceptance window. Earlier data may be described; it may never rescue a model.

### Free-tier limitation

Without `TARDIS_API_KEY`, both the datasets and the replay endpoint serve **the first day
of each calendar month only** (`isFreeDay = iso.slice(8,10) === '01'`); anything else
returns HTTP 401 with an explicit message.

| | days |
|---|---|
| acceptance window 2020-05-14 → 2026-08-31 | **2,301** |
| fetchable without a key (first of each month, 2020-06-01 → 2026-08-01) | **75** |
| missing without a key | **2,226 (96.7%)** |

Free replay access additionally caps a single response at roughly **3.2 MB** — about one
minute of raw depth on this instrument — which is why the reconciliation overlap is
*pooled across days* rather than stretched into one long window. The raw `data-feeds`
replay is ~**26 GB/day** uncompressed (measured: 3.08 MB for 10 s of depth, ≈60 TB for
the window), so it is never the bulk source.

**What this means for formal acceptance.** 75 scattered days, one per month, is not the
pre-registered development / validation / locked-test design. The pre-registration
(§1 Credentials, §20) forbids treating them as the acceptance dataset: results computed
on them are labelled **PRELIMINARY — NOT AN ACCEPTANCE VERDICT**, cannot produce a PASS,
and the verdict is reported as **BLOCKED BY HISTORICAL DATA ACCESS**. Substituting OHLCV
bars, sampled REST depth snapshots, or any other cheaper proxy is forbidden — none of
them reconstructs an order book, and a study that silently changes its data source is a
different study.

---

## 2. Coverage

| | |
|---|---|
| acceptance window | 2020-05-14 → 2026-08-31 (**2,301 days**) |
| days replayed and stored | **26** (1.13% of the window) |
| by split | dev **23** · val **3** · test **0** |
| 1-second feature rows | **2,242,898** |
| mean valid-book coverage per day | **99.844%** |
| crossed books / invalidations (all 26 days) | **1 / 1** (both on 2021-07-01, 96.0% coverage) |
| archive bytes read | **13,065,248,826 (12.2 GB)** |
| feature store on disk | **634,754,517 (605 MB)** |
| store version / manifest written | `fs1` / 2026-09-06T11:42:17Z |

### Split definitions (frozen, chronological, retrospective)

| split | period | stored days | which |
|---|---|---|---|
| Development | 2020-05-14 → 2022-12-31 | 23 | 2020-06-01 … 2021-10-01 (17, monthly), 2022-05-01 … 2022-10-01 (6, monthly) |
| Validation | 2023-01-01 → 2024-12-31 | 3 | 2024-07-01, 2024-08-01, 2024-09-01 |
| Locked retrospective test | 2025-01-01 → 2026-08-31 | **0** | — |

The locked test may not be used to modify any specification. With zero test days it is
untouched and unspent; it is also the reason no gate can be evaluated (§5).

Bad intervals are excluded, never interpolated: a second without a valid book produces no
feature record and therefore no observation. Coverage is reported, not repaired. Levels
beyond ±2% of mid are pruned every 60 s on the vendor path only (Binance stops
maintaining levels outside its tracked depth, so a book replayed for hours accumulates
levels the exchange abandoned; the pruned levels are stale by construction).

Per-day audit (depth events, level rows, trades, snapshots, crossed books,
invalidations, max book levels, coverage %, archive and store bytes) is in
`research/AUDIT-M2H.md` at the commits in §12. Representative extremes: max book levels
ranged 3,090 (2020-08-01) to 17,719 (2024-09-01); depth events per day 1.64 M (2024-07-01)
to 10.76 M (2020-06-01); trades per day 446 k (2020-07-01) to 6.15 M (2022-07-01).

---

## 3. Reconciliation — the load-bearing section

**The problem.** The Tardis-normalised CSV carries absolute price levels and an
`is_snapshot` flag but **no Binance `U`/`u`/`pu` sequence ids**. The exchange's own
continuity rule therefore *cannot be applied to it*. A book rebuilt from the CSV cannot
prove its own correctness from within the CSV.

**How it was validated anyway.** Run *before* the study, because it decides whether the
study may run at all (`m2h.mjs` halts with `HALTED — RECONCILIATION FAILED` if
`csvReproducesSequenceVerifiedBook` is false — this is a precondition, not a footnote).
Three questions, each licensing a different thing:

1. **Rebuild the same window from the replay API's ORIGINAL Binance payloads** —
   `depthSnapshot` + `depthUpdate` with `U`/`u`/`pu` — through the **same strict
   `OrderBook.apply()` the live collector uses**, enforcing the exchange's continuity
   rule, then compare **second by second** against the book the CSV path produced for the
   same seconds.
2. **0 ms → 100 ms batching equivalence.** Binance builds the `@100ms` stream the live
   collector subscribes to by unioning the 0 ms updates over each window with absolute,
   last-write-wins levels. That *should* make the book identical at any sampling
   boundary. Tested rather than asserted: the raw 0 ms stream is batched into 100 ms
   diffs and the resulting books compared.
3. **Is the CSV `side` column the liquidity taker?** Correlate the AFI derived from it
   against the AFI derived from the raw `m` flag, and against its negation.

### Sample

8 windows × 5 minutes, first-of-month days 2020-06-01, 2020-07-01, 2020-08-01,
2020-09-01, 2020-10-01, 2020-11-01, 2020-12-01, 2021-01-01. Pooled: **465 compared
seconds** (53–60 per window). Raw rebuild: **37,635 events applied, 0 sequence gaps, 467
dropped as stale, 0 crossed books**. 0 seconds present in the raw rebuild but absent from
the store.

### Pre-registered thresholds and results

| check | threshold | measured | verdict |
|---|---|---|---|
| exchange-state features vs sequence-verified book | median relative difference ≤ **1e-3** | **0.0** on every book-state feature | pass |
| 100 ms batching equivalence, same features | median relative difference ≤ **1e-6** | **0.0** on every feature, including flow | pass |
| aggressor side | correlation with raw-`m` AFI > **+0.9** | **+0.979009** (**−0.979009** flipped) | pass |
| overlap | ≥ **300** compared seconds | **465** | pass |

**Verdict: PASS.**

#### Check 2 detail — CSV path vs sequence-verified book (465 s)

| feature | median rel. | p99 rel. | max rel. |
|---|---|---|---|
| bid | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| ask | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| spreadBp | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| microprice | 0.00e+0 | 3.94e−8 | 3.94e−8 |
| micropriceDisplacementBp | 0.00e+0 | 6.98e+0 | 6.98e+0 |
| depthBidTop1 / Top5 / Top10 | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| depthAskTop1 | 0.00e+0 | 1.55e−1 | 1.55e−1 |
| depthAskTop5 | 0.00e+0 | 6.09e−1 | 6.09e−1 |
| depthAskTop10 | 0.00e+0 | 4.24e−1 | 4.24e−1 |
| depthBid5bp | 0.00e+0 | 5.98e−2 | 5.98e−2 |
| depthAsk5bp | 0.00e+0 | 1.36e−1 | 1.36e−1 |
| imbTop1 | 0.00e+0 | 6.98e+0 | 6.98e+0 |
| imbTop5 | 0.00e+0 | 3.73e−1 | 3.73e−1 |
| imbTop10 | 0.00e+0 | 3.48e+1 | 3.48e+1 |
| imbWeighted | 0.00e+0 | 2.86e−1 | 2.86e−1 |
| flow5sAfi | 1.16e−3 | 7.76e+0 | 7.76e+0 |
| flow5sSigned | 1.59e−3 | 1.73e+1 | 1.73e+1 |
| pressureToCapacity | 1.19e−3 | 1.06e+1 | 1.06e+1 |
| flowTimesFragility | 1.16e−3 | 7.76e+0 | 7.76e+0 |

Every **book-state** feature has median relative difference exactly 0. The four **flow**
features sit at ~1.2e−3 to 1.6e−3, from millisecond trade-timestamp granularity differing
between the two sources — bounded, reported, and not corrected. (The pre-registered ≤1e−3
threshold names the exchange-state features; the flow deltas are reported alongside.)

The 100 ms batching test returned **0.00e+0 median, p99 and max on all 21 features**,
including the flow features — i.e. exact.

Raw payload trade sides in the window: **4,539 aggressive buys, 5,265 aggressive sells**.
A correlation near +1 confirms the CSV `side` column is the liquidity-taker side; near −1
would have meant every flow feature was sign-flipped.

### What this licenses, and what it does not

Licensed: vendor backtests of **book state** are about the same object the live planner
measures, because the bulk CSV path reproduces a sequence-verified book exactly, and the
live `@100ms` sampling is provably equivalent to the `@0ms` capture.

Not licensed: a live-versus-vendor comparison on the same wall-clock day. The prospective
capture began 2026-09-06 and free vendor access covers only the first of each month, so
without an API key there is no overlapping date. The bridge is **indirect and stated as
such**: vendor CSV ≡ vendor raw payloads ≡ the payload shape and code path the live
collector runs.

---

## 4. Feature definitions

One feature engine. Historical and live both translate into canonical events and then
call the same modules (`collector/book.mjs`, `features/book-features.mjs`,
`features/flow-features.mjs`, `features/execution.mjs`). There is no historical-only
implementation of any measure.

### Book primitives (per sampled second, from a valid two-sided book)

```
bid, ask            = best bid / best ask price
bq, aq              = quantity at best bid / best ask
mid                 = (bid + ask) / 2
spreadBp            = (ask − bid) / mid × 10⁴
microprice          = (bid·aq + ask·bq) / (bq + aq)          # Stoikov L1
depth.bid.topN      = Σ_{i<N} p_i · q_i   over sorted bids   # notional
depth.ask.topN      = Σ_{i<N} p_i · q_i   over sorted asks
depth.bid.within_k  = Σ p·q over bids with p ≥ mid·(1 − k/10⁴)
depth.ask.within_k  = Σ p·q over asks with p ≤ mid·(1 + k/10⁴)
imb(b, a)           = (b − a) / (b + a)   if b + a > 0, else 0
nearBid             = depth.bid.within2bp || depth.bid.top5   # 2 bp band, top-5 fallback
nearAsk             = depth.ask.within2bp || depth.ask.top5
```

Declared bands `[1, 2, 5, 10]` bp, top levels `[1, 5, 10]`, flow windows
`[1000, 5000, 30000]` ms. An invalid or one-sided book produces `null` — no record, ever.

### Flow primitive

Over the trailing 5,000 ms of trades, in quote (USDT) notional, with `buy` = aggressive
buy (liquidity taker lifted the ask):

```
buyQuote₅ = Σ quote over aggressive buys      sellQuote₅ = Σ quote over aggressive sells
afi₅      = (buyQuote₅ − sellQuote₅) / (buyQuote₅ + sellQuote₅),  0 if the total is 0
```

### The six frozen features

| id | name | formula |
|---|---|---|
| **D1** | static depth imbalance (top-5, notional) | `imb(depth.bid.top5, depth.ask.top5)` |
| **D2** | microprice displacement from mid, bp | `(microprice − mid) / mid × 10⁴` |
| **D3** | order-flow imbalance, 5 s AFI | `afi₅` |
| **D4** | liquidity withdrawal / replenishment | `log( max(1, depthBid5bp[t] + depthAsk5bp[t]) / max(1, depthBid5bp[t−1] + depthAsk5bp[t−1]) )`, where `t−1` is the immediately preceding second **within the same UTC day**; `NaN` (no observation) otherwise |
| **D5** | pressure-to-capacity | `buyQuote₅ / max(1, nearAsk) − sellQuote₅ / max(1, nearBid)`; 0 if both near depths are 0 |
| **D6** | flow × fragility | `afi₅ × ( spreadBp / max(1e−9, (nearBid + nearAsk) / 10⁶) )` |

No additions. Not RSI, EMA, MACD, VWAP, opening ranges, session setups or candle
patterns. More data is not a licence for more features.

### Horizons, targets, stride

| | |
|---|---|
| horizons | **5 s, 30 s (primary), 5 min** — primary fixed at pre-registration; a pass at 5 s or 5 min with a fail at 30 s is a fail |
| target | **future mid-price return only**: `y_h(t) = log( mid(t + h) / mid(t) )`. Never last trade — bid-ask bounce would manufacture predictability |
| forward index | exact match on `sec(t) + h` **within the same day**; no match ⇒ no observation |
| **non-overlapping stride** | observations are taken at `i += h` (5, 30 or 300 seconds). At 1 Hz a 30 s forward return overlaps its 29 neighbours, so consecutive rows are ~97% the same number. Stepping by the horizon makes observations independent by construction. The point estimate is unaffected; the standard error stops being fiction |
| HAC | Newey–West at **60 s**, i.e. `lag = max(1, round(60 / h))` **periods** → 12 at 5 s, 2 at 30 s, 1 at 5 m |
| controls | previous 30 s mid return `log(mid(t)/mid(t−30))`, `spreadBp`, `ln(max(1, depthBid5bp + depthAsk5bp))` |
| fixed effects | hour-of-day (24 groups), applied by demeaning the target and every regressor within group |
| minimum sample | a fit with fewer than 500 usable observations returns `null` |
| decile edges | computed from **development only**, at the 30 s stride, requiring >100 values; applied unchanged to every split |

The feature window ends at second *t* and the target may not overlap it. Lookahead unit
tests were part of the suite: a feature equal to the past return must not register as
prediction.

---

## 5. Key results — coefficient on the future mid return

Primary horizon **30 s**, non-overlapping, hour-of-day fixed effects, controls as above,
Newey–West at 60 s. `test` is `null` everywhere because **zero test days are in the
store**; `val∪test` therefore equals `val`.

| feature | split | n | β | t | 95% CI | R² | rank IC | decile mono | top−bottom bp |
|---|---|---|---|---|---|---|---|---|---|
| **D1** depthImbalance | dev | 66,075 | 6.296e−5 | **14.66** | [5.455e−5, 7.138e−5] | 0.00334 | 0.0738 | **1.000** | 1.149 |
| | val | 8,634 | 5.256e−5 | **6.378** | [3.641e−5, 6.871e−5] | 0.00528 | 0.0933 | 0.855 | 1.246 |
| | test | — | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| | val∪test | 8,634 | 5.256e−5 | 6.378 | [3.641e−5, 6.871e−5] | 0.00528 | 0.0933 | 0.855 | 1.246 |
| **D2** micropriceDisplacementBp | dev | 66,075 | 3.129e−4 | **2.785** | [9.273e−5, 5.332e−4] | 0.00163 | 0.0643 | 0.988 | 1.240 |
| | val | 8,634 | 4.248e−4 | 0.385 | [−1.736e−3, 2.586e−3] | 0.00026 | 0.0946 | 0.091 | −0.462 |
| | test | — | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| | val∪test | 8,634 | 4.248e−4 | 0.385 | [−1.736e−3, 2.586e−3] | 0.00026 | 0.0946 | 0.091 | −0.462 |
| **D3** orderFlowImbalance5s | dev | 66,075 | 9.908e−6 | 1.805 | [−8.489e−7, 2.066e−5] | 0.00042 | −0.0058 | 0.224 | 0.0007 |
| | val | 8,634 | 1.943e−5 | **2.287** | [2.778e−6, 3.609e−5] | 0.00069 | 0.0243 | 0.552 | 0.256 |
| | test | — | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| | val∪test | 8,634 | 1.943e−5 | 2.287 | [2.778e−6, 3.609e−5] | 0.00069 | 0.0243 | 0.552 | 0.256 |
| **D4** depthChange | dev | 66,075 | 5.306e−5 | 1.313 | [−2.612e−5, 1.322e−4] | 0.00056 | −0.0005 | −0.358 | −0.118 |
| | val | 8,634 | 3.627e−5 | 0.528 | [−9.829e−5, 1.708e−4] | 0.00024 | 0.0111 | 0.224 | −0.241 |
| | test | — | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| | val∪test | 8,634 | 3.627e−5 | 0.528 | [−9.829e−5, 1.708e−4] | 0.00024 | 0.0111 | 0.224 | −0.241 |
| **D5** pressureToCapacity | dev | 66,075 | 4.790e−9 | **3.030** | [1.692e−9, 7.889e−9] | 0.00200 | 0.0251 | 0.952 | 0.623 |
| | val | 8,634 | 1.368e−6 | 0.410 | [−5.177e−6, 7.913e−6] | 0.00026 | 0.0555 | 0.830 | 0.660 |
| | test | — | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| | val∪test | 8,634 | 1.368e−6 | 0.410 | [−5.177e−6, 7.913e−6] | 0.00026 | 0.0555 | 0.830 | 0.660 |
| **D6** flowTimesFragility | dev | 66,075 | 1.522e−6 | 0.246 | [−1.060e−5, 1.364e−5] | 0.00038 | −0.0059 | 0.261 | −0.134 |
| | val | 8,634 | −1.954e−3 | −1.835 | [−4.041e−3, 1.331e−4] | 0.00089 | 0.0272 | −0.261 | **−10.776** |
| | test | — | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| | val∪test | 8,634 | −1.954e−3 | −1.835 | [−4.041e−3, 1.331e−4] | 0.00089 | 0.0272 | −0.261 | −10.776 |

`decile mono` is the rank correlation between decile index and decile mean return
(1.0 = perfectly monotone); `top−bottom` is `(decile 10 mean − decile 1 mean) × 10⁴`,
in bp of the 30 s mid return. Every decile row used dev-derived edges. All splits had 10
usable deciles.

### Robustness horizons (val∪test, β and t)

| feature | 5 s | 30 s | 5 m |
|---|---|---|---|
| D1_depthImbalance | 5.914e−5 (44.48) | 5.256e−5 (6.38) | 4.254e−5 (0.56) |
| D2_micropriceDisplacementBp | 1.57e−3 (4.56) | 4.248e−4 (0.39) | 6.35e−3 (1.35) |
| D3_orderFlowImbalance5s | 1.95e−5 (12.28) | 1.943e−5 (2.29) | −9.18e−5 (−1.19) |
| D4_depthChange | 3.82e−5 (1.40) | 3.627e−5 (0.53) | 1.09e−3 (1.34) |
| D5_pressureToCapacity | 1.91e−7 (1.97) | 1.368e−6 (0.41) | 1.94e−5 (1.84) |
| D6_flowTimesFragility | −7.13e−5 (−0.27) | −1.954e−3 (−1.83) | 1.40e−3 (0.11) |

### Gates

| gate | requirement |
|---|---|
| G1 sign stable | `sign(β_dev) = sign(β_val) = sign(β_test) = sign(β_val∪test)` |
| G2 significant | `\|t_val\| ≥ 2` **and** `\|t_test\| ≥ 2` |
| G3 multiple testing | `\|t_val∪test\| >` threshold, **3.5524** at 131.0 cumulative effective trials |
| G4 monotonicity | `\|mono\| ≥ 0.7` **and** `sign(mono) = sign(β)` on val∪test deciles |
| G5 economic | tradable under profiles A **and** B |

| feature | G1 | G2 | G3 | G4 | G5 | verdict |
|---|---|---|---|---|---|---|
| D1_depthImbalance | — | — | — | — | FAIL | REJECTED |
| D2_micropriceDisplacementBp | — | — | — | — | FAIL | REJECTED |
| D3_orderFlowImbalance5s | — | — | — | — | FAIL | REJECTED |
| D4_depthChange | — | — | — | — | FAIL | REJECTED |
| D5_pressureToCapacity | — | — | — | — | FAIL | REJECTED |
| D6_flowTimesFragility | — | — | — | — | FAIL | REJECTED |

The rendered `RESULTS-M2H.md` table prints "FAIL" in every cell. The underlying JSON is
more precise and is what this record follows: for all six features
`evaluable: false`, `failed: ["insufficient observations in one or more splits"]`,
`informationPass: false`, `pass: false`. G1–G4 were **never evaluated** — the locked test
split is empty, so the runner short-circuits before computing them. G5 *was* evaluated
independently and failed for all six on its own terms (§6). The correct reading is
**not** "the information gates were tested and failed"; it is "the information gates
could not be tested, and the economic gate failed outright".

There is real short-horizon information here. D1 at 30 s is β = 5.26e−5 with t = 6.38 on
validation and monotone deciles in both splits; at 5 s it is t = 44.5. It is not enough
to pay for a round trip.

---

## 6. Economics — information is not tradability

Measured **half-spread + book impact** for a $10,000 market order, taken as the median of
`execBuy10kSlipBp` across the whole panel (slippage measured against the decision-time
mid, so it contains the half-spread): **0.013031 bp per side**.

| profile | round trip |
|---|---|
| **A** commission-only taker | 2 × 5 bp commission **+ 2 × 0.013031 bp measured book cost = 10.026062 bp** |
| **B** conservative taker | 14 bp (all-in allowance, used as stated) |
| **C** stress taker | 20 bp (all-in allowance, used as stated) |
| *(M maker, 4 bp — recorded but `usableForAcceptance: false`, may never rescue a failing taker strategy)* |

Gross edge = `|top−bottom bp| / 2` on the val∪test deciles at the primary horizon. Basis:
validation ∪ test.

| feature | gross edge | A: net (cost/edge) | B: net (cost/edge) | C: net (cost/edge) | tradable |
|---|---|---|---|---|---|
| D1_depthImbalance | 0.6231 bp | −9.4030 bp (16.1×) | −13.3769 bp (22.5×) | −19.3769 bp (32.1×) | **no** |
| D2_micropriceDisplacementBp | 0.2310 bp | −9.7951 bp (43.4×) | −13.7690 bp (60.6×) | −19.7690 bp (86.6×) | **no** |
| D3_orderFlowImbalance5s | 0.1281 bp | −9.8980 bp (78.3×) | −13.8719 bp (109.3×) | −19.8719 bp (156.1×) | **no** |
| D4_depthChange | 0.1206 bp | −9.9055 bp (83.1×) | −13.8794 bp (116.1×) | −19.8794 bp (165.9×) | **no** |
| D5_pressureToCapacity | 0.3300 bp | −9.6961 bp (30.4×) | −13.6700 bp (42.4×) | −19.6700 bp (60.6×) | **no** |
| D6_flowTimesFragility | 5.3881 bp | −4.6379 bp (1.9×) | −8.6119 bp (2.6×) | −14.6119 bp (3.7×) | **no** |

**The execution cost is essentially all commission.** The book itself costs 0.013 bp per
side; the exchange costs 5 bp per side. The best feature by decile spread (D6) is short by
a factor of 1.9 even on the most generous acceptance profile, and D6's spread comes from a
non-monotone decile curve (mono = −0.261) on 313 tradable signals, so it is a tail
artefact rather than an edge. Under the pre-registration, gross edge ≤ executable cost is
**NOT TRADABLE**, and no strategy is built, at any t-statistic.

---

## 7. Backtest result

Walk-the-book on **both** legs. Signal at second *t*; entry at the first executable
second after the signal (*t*+1, same day); exit at the primary horizon, **30 s** later.
Entry and exit priced by walking the reconstructed historical book — VWAP over consumed
levels, not `mid ± a slippage constant`. No stop, no target, no sizing rule, no
overlapping positions (a signal while a position is open is ignored, not pyramided).
Direction: top dev decile → long, bottom dev decile → short. Commission **5 bp per side**.
If either leg cannot be completely filled from the visible book, the trade is **invalid
and excluded**, and the exclusion count is reported. Primary size **$10,000**, secondary
robustness **$50,000** (the larger size may not be promoted over the smaller).

**Sample: validation ∪ test** — which here is three days, 2024-07-01, 2024-08-01,
2024-09-01.

| candidate | trades | excl. no-book | gross/trade | net/trade | win | PF | Sharpe | Sortino | max DD | net ex-best-5% | long | short | longest losing streak |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D1_depthImbalance | 7,021 | 16 | +0.236 bp | **−9.764 bp** | 2.6% | 0.012 | −1836.18 | −818.75 | 68,552 bp | −10.371 bp | −9.739 bp (n 3,469) | −9.788 bp (n 3,552) | 798 |
| D2_micropriceDisplacementBp | 711 | 0 | +0.069 bp | **−9.931 bp** | 4.8% | 0.031 | −420.78 | −238.99 | 7,061 bp | −10.800 bp | −10.134 bp (n 381) | −9.696 bp (n 330) | 102 |
| D3_orderFlowImbalance5s | 6,312 | 33 | +0.111 bp | **−9.889 bp** | 2.1% | 0.009 | −1944.40 | −793.37 | 62,422 bp | −10.459 bp | −9.962 bp (n 3,066) | −9.821 bp (n 3,246) | 572 |
| D4_depthChange | 3,789 | 1 | −0.135 bp | **−10.135 bp** | 3.5% | 0.016 | −1205.79 | −584.28 | 38,401 bp | −10.833 bp | −10.173 bp (n 2,118) | −10.087 bp (n 1,671) | 405 |
| D5_pressureToCapacity | 2,411 | 3 | +0.412 bp | **−9.588 bp** | 6.4% | 0.041 | −768.41 | −436.82 | 23,116 bp | −10.519 bp | −9.618 bp (n 1,289) | −9.553 bp (n 1,122) | 289 |
| D6_flowTimesFragility | 313 | 0 | +0.023 bp | **−9.977 bp** | 7.3% | 0.055 | −239.38 | −149.67 | 3,123 bp | −11.085 bp | −9.993 bp (n 171) | −9.957 bp (n 142) | 38 |

`excludedIncomplete` was 0 for every candidate: the visible book always filled $10k.

### Secondary size ($50,000)

| candidate | trades | gross/trade | net/trade |
|---|---|---|---|
| D1_depthImbalance | 7,021 | +0.132 bp | −9.868 bp |
| D2_micropriceDisplacementBp | 711 | +0.000 bp | −10.000 bp |
| D3_orderFlowImbalance5s | 6,312 | +0.050 bp | −9.950 bp |
| D4_depthChange | 3,789 | −0.195 bp | −10.195 bp |
| D5_pressureToCapacity | 2,411 | +0.329 bp | −9.671 bp |
| D6_flowTimesFragility | 313 | −0.044 bp | −10.044 bp |

Going from $10k to $50k costs 0.06–0.10 bp of gross — the book is deep enough that size is
not the problem.

### Development-split backtest (in-sample, for the record)

| candidate | trades | gross/trade | net/trade |
|---|---|---|---|
| D1_depthImbalance | 50,028 | −0.102 bp | −10.102 bp |
| D2_micropriceDisplacementBp | 42,818 | −0.246 bp | −10.246 bp |
| D3_orderFlowImbalance5s | 41,987 | −0.236 bp | −10.236 bp |
| D4_depthChange | 47,583 | −0.370 bp | −10.370 bp |
| D5_pressureToCapacity | 37,551 | −0.295 bp | −10.295 bp |
| D6_flowTimesFragility | 44,243 | −0.333 bp | −10.333 bp |

Gross is **negative in-sample for every feature**. The positive val∪test gross figures
come from three days.

### Baselines

Absolute PnL alone means nothing. Every candidate against:

| baseline | trades | gross/trade | net/trade | win | PF | net ex-best-5% |
|---|---|---|---|---|---|---|
| random entries, same frequency | 7,226 | −0.019 bp | −10.019 bp | 2.1% | 0.010 | −10.606 bp |
| M1 raw-AFI reversal (heaviest aggressive selling → long) | 6,312 | −0.167 bp | −10.167 bp | 1.6% | 0.007 | −10.701 bp |

Sign-shuffled controls (net/trade): D1 −10.019 · D2 −10.047 · D3 −10.056 · D4 −9.967 ·
D5 −10.088 · D6 −9.616 bp.

**Read the spread, not the level.** Every strategy and every baseline nets ≈ −10 bp,
because the round trip is 10 bp of commission and nothing here earns it back. The
candidates beat random entries by 0.1–0.4 bp of gross edge. That gap is real and it is an
order of magnitude too small.

---

## 8. Execution research (Part B)

Runs regardless of the directional outcome, and can pass on its own. Given a decision to
buy or sell at second *t*: **immediate market execution vs waiting 5 s vs 30 s**.
Implementation shortfall measured against the **decision-time mid**, commission included,
sampled every 30 s across the whole panel. Both sides, sizes $10k primary and $50k
secondary.

```
IS(now)   = sign · (VWAP(t) − mid(t)) / mid(t) × 10⁴ + takerBp
IS(wait w)= sign · (VWAP(t+w) − mid(t)) / mid(t) × 10⁴ + takerBp     # paired, same decision
```

Pre-registered acceptance (carried unchanged from the M2 freeze): a timing rule must
change expected implementation shortfall by more than **0.5 bp** with **|t| > 2**, or
materially reduce the 95th-percentile adverse tail.

| side | size | n | immediate | wait 5 s − now | wait 30 s − now | p95 adverse (5 s) | p95 adverse (30 s) | material? |
|---|---|---|---|---|---|---|---|---|
| BUY | $10k | 74,764 | **5.1154 bp** | +0.0044 bp (t 0.43) | +0.0236 bp (t 0.96) | 3.894 bp | 9.505 bp | no |
| SELL | $10k | 74,764 | **5.1147 bp** | −0.0085 bp (t −0.83) | −0.0237 bp (t −0.97) | 3.897 bp | 9.550 bp | no |
| BUY | $50k | 74,764 | **5.2959 bp** | +0.0035 bp (t 0.34) | +0.0236 bp (t 0.96) | 3.902 bp | 9.543 bp | no |
| SELL | $50k | 74,764 | **5.2964 bp** | −0.0116 bp (t −1.13) | −0.0238 bp (t −0.97) | 3.904 bp | 9.544 bp | no |

Effects are **two orders of magnitude below the 0.5 bp threshold** and none reaches
|t| > 2. `materiallyBetterToActNow` and `materiallyBetterToWait` are both `false` in every
cell. Waiting also *widens* the outcome: paired dispersion grows from ~2.75 bp at 5 s to
~6.77 bp at 30 s, and the p95 adverse tail from ~3.9 bp to ~9.5 bp. Waiting buys nothing
and costs variance.

**Roughly 5 bp of the 5.115 bp shortfall is commission** (`takerBp = 5`, added into IS
directly) and cannot be improved by timing. The part execution timing could in principle
address is the remaining ~0.115 bp of half-spread and impact at $10k (~0.30 bp at $50k).
There is no timing rule to find in a 0.1 bp budget.

---

## 9. Passive / maker research

Passive-order toxicity measured as **mid drift relative to where a passive order would
have rested** — for a passive buy, `(mid(t+w) − bid(t)) / bid(t) × 10⁴`; for a passive
sell, `(ask(t) − mid(t+w)) / ask(t) × 10⁴`. Sampled every 30 s, n = 74,764 / 74,763 /
74,737 at 1 s / 5 s / 30 s.

| horizon | passive buy | t | passive sell | t |
|---|---|---|---|---|
| 1 s | 0.0254 bp | 5.93 | 0.0315 bp | 7.36 |
| 5 s | 0.0342 bp | 3.35 | 0.0227 bp | 2.24 |
| 30 s | 0.0521 bp | 2.12 | 0.0048 bp | 0.20 |

Drift is mildly *favourable* on both sides at short horizons and statistically distinct
from zero, but the magnitudes (0.005–0.052 bp) are far below the 4 bp maker round trip.

**Queue model: UNRESOLVED.** Tardis aggregate L2 carries **no individual order queue
identity**, so it is impossible to know whether a resting order would have been filled,
or where in the queue it sat. Therefore:

- these numbers are **measurement only** — no fill is assumed, no queue position is
  modelled;
- **no maker PnL may be computed or claimed**;
- maker fees (profile M, 4 bp round trip) are recorded as `usableForAcceptance: false`
  and may never be used to rescue a failing taker strategy.

This is a data limitation, not a modelling choice. It is unfixable with this vendor
product regardless of API key.

---

## 10. Multiple testing

| | |
|---|---|
| raw registry entries (6 features × 3 horizons × 3 splits) | **54** |
| unique configurations (6 features × 3 horizons) | **18** |
| eigenvalue estimate | **10.0** |
| clustering estimate | 5 |
| mean absolute pairwise ρ of daily score series | 0.290 |
| **effective independent trials, this study** | **10.0** |
| prior cumulative through M1 | 121 |
| **cumulative effective N across every study in the repository** | **131.0** |
| Bonferroni-style threshold, `normInv(1 − 0.05 / (2 × 131))` | **\|t\| > 3.5524** |

Method: each configuration's daily score series is correlated with every other's; the
effective count is taken from the eigenvalue spectrum of that correlation matrix (the
larger, more conservative of the eigen and cluster estimates). Splits, robustness
horizons and robustness order sizes are **not** counted as independent trials. Every
configuration was written to the registry before any gate was evaluated.

**Statistics may not overturn economics.** With net edge negative under every acceptance
cost profile, the multiple-testing threshold is moot.

---

## 11. Limitations

Everything that stops this being a formal PASS, stated plainly:

1. **1.13% coverage.** 26 of 2,301 days. The acceptance window is not covered and the
   pre-registration forbids treating the free-tier sample as the acceptance dataset.
2. **Zero locked-test days.** The test split (2025-01-01 → 2026-08-31) is empty, so
   gates G1–G4 could not be evaluated at all. `val∪test` is really just `val`.
3. **Three validation days.** All of validation is 2024-07-01, 2024-08-01, 2024-09-01 —
   consecutive months of one year, one regime. Every out-of-sample number in §5 and §7
   rests on those three days.
4. **Days are not contiguous.** First-of-month sampling means no multi-day dynamics, no
   weekday/weekend structure, no event windows, and no ability to test persistence.
5. **Dev-split gross PnL is negative for every feature.** The positive val∪test gross is
   a three-day result and should not be read as evidence of edge.
6. **No live-vs-vendor overlap.** The prospective capture began 2026-09-06; free vendor
   access covers only first-of-month days. The reconciliation bridge is indirect
   (vendor CSV ≡ vendor raw payloads ≡ the live payload shape and code path) and is
   stated as such.
7. **Vendor CSV has no `U`/`u`/`pu`.** Continuity is proven only on 465 sampled seconds
   drawn from 8 windows in 2020-06 → 2021-01, all in the development period. No
   reconciliation window exists in 2022, 2024, or later.
8. **Flow features reconcile at ~1.2e−3, not 0**, from millisecond trade-timestamp
   granularity between the two sources. Bounded and reported; not corrected.
9. **Maker/queue is unresolvable with this data.** No maker PnL, ever, from this dataset.
10. **Prospective confirmation has not happened.** Under the pre-registration the UI may
    say `RETROSPECTIVE PASS / PROSPECTIVE COLLECTING` at best, and it may not say
    VALIDATED. Here it cannot even say that.
11. **Execution study covers only the same 26 days**, so its null result inherits the
    same coverage limitation — though a null on 74,764 paired decisions with effects
    100× below threshold is unlikely to reverse.

---

## 12. Commit hashes

Verified with `git log --format='%h %s' -1 <hash>`:

| hash | subject |
|---|---|
| `a400f9d` | Pre-register Study M2-H: historical L2 retrospective validation |
| `8b3aeb1` | Build the M2-H historical pipeline: Tardis adapter, replay, store, reconciliation, UI |
| `8d283a1` | Make the M2-H reconciliation a precondition of the study, not a footnote |
| `5fac0d2` | Run M2-H on 26 replayed days: information exists, none of it survives the cost of trading |

All four resolve in this repository. The deleted implementation is recoverable from
`5fac0d2` and earlier.

### The commands that did the work

These `npm` scripts existed in `btc-microstructure/package.json` and are gone from the
working tree after the consolidation cleanup — they exist in git history at **`5fac0d2`**
(and the pipeline itself at **`8b3aeb1`**):

```bash
npm run m2h:days        # node historical/cli.mjs days       — enumerate fetchable days
npm run m2h:replay      # node --max-old-space-size=8192 historical/cli.mjs replay
npm run m2h:verify      # node historical/cli.mjs verify      — store integrity (sha256)
npm run m2h:status      # node historical/cli.mjs status      — coverage report
npm run m2h:reconcile   # node historical/cli.mjs reconcile   — writes RECONCILIATION-M2H.md
npm run research:m2h    # node --max-old-space-size=8192 research/m2h.mjs — writes RESULTS-M2H.md
npm run replay          # node historical/replay-server.mjs   — replay UI (deleted)
```

### Unblocking with an API key

With `TARDIS_API_KEY` set, **the same pipeline covers the full window with no code
change**. The runner already reads the whole window and reports the same tables over more
days. No re-specification, no edits:

```bash
export TARDIS_API_KEY=…
npm run m2h:replay          # 2020-05-14 → 2026-08-31, resumable, skips days already built
npm run research:m2h        # writes research/RESULTS-M2H.md
```

Budget, extrapolated from measured 2020 archives (later years are busier, so treat as a
floor):

| quantity | free tier (75 days) | full window (2,301 days) |
|---|---|---|
| archive download | ~20 GB | **~0.9–2.5 TB** |
| replay compute | ~3 h | **~4–8 days single-threaded** (days are independent — parallelise by month) |
| feature store on disk | ~1.7 GB | **~50 GB** |

---

## 13. Final status and product decision

> **PRELIMINARY — BLOCKED BY HISTORICAL DATA ACCESS**

The engineering is complete and verified end to end: provider adapter, canonical event
schema, strict book reconstruction, per-day audit, columnar feature store, reconciliation
against a sequence-verified feed, the research runner, the walk-the-book backtest, the
execution study, and the UI. All of it ran. The reconciliation **passed**. The pipeline is
correct.

The evidence it produced does not support shipping anything:

- **Information gates: not evaluable** (zero locked-test days). No PASS is possible.
- **Economic gate: FAIL for all six features**, by 1.9× to 165.9× cost-over-edge.
- **Backtest: net −9.6 to −10.1 bp per trade** for every candidate, indistinguishable
  from random entries and sign-shuffled controls at the level, and separated from them
  only by 0.1–0.4 bp of gross edge.
- **Execution timing: null**, 100× below the pre-registered 0.5 bp threshold.
- **Maker: unresolvable** with this data product.

There is genuine, statistically strong short-horizon information in the order book —
D1 depth imbalance at 5 s reaches t = 44.5, and its deciles are monotone in both splits.
It is worth roughly 0.6 bp against a 10 bp round trip.

**Product decision: no microstructure signal ships.** No LONG/SHORT recommendation, no
directional model, no maker strategy is derived from this work. The execution-timing
research is also a null and produces no "wait for a better price" advice. The historical
replay infrastructure is retired; this document and the four commits above are the record.
