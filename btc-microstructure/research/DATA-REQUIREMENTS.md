# M2-H historical data requirements

What the acceptance verdict needs, what free access provides, and the exact gap between
them. Written so the decision to buy data (or not) is a costed one.

## Provider

**Tardis.dev**, exchange `binance-futures`, symbol `BTCUSDT` (perpetual).
`availableSince` reported by the API: **2019-11-17**. Tardis documents capture problems
(missing data, latency) on this exchange before **2020-05-14**, which is why the M2-H
acceptance window starts there and nothing earlier may be used for acceptance.

Two endpoints, used for different jobs:

| endpoint | content | role |
|---|---|---|
| `datasets.tardis.dev/v1/binance-futures/incremental_book_L2/…` | normalised CSV: absolute price levels, `is_snapshot` flag, microsecond exchange and capture timestamps. **No Binance `U`/`u`/`pu`.** | bulk replay source |
| `datasets.tardis.dev/…/trades/…` | normalised trades with a liquidity-taker `side` | bulk flow source |
| `api.tardis.dev/v1/data-feeds/binance-futures` | the **original Binance payloads** — `depthUpdate` with `U`/`u`/`pu`, `depthSnapshot` in REST shape, `aggTrade` with `m` | semantic ground truth, sample windows only |

## Access, measured 2026-09-06

Without `TARDIS_API_KEY` both endpoints serve **the first day of each calendar month
only**; anything else returns HTTP 401 with an explicit message. With a key, the whole
range is available.

| | days |
|---|---|
| acceptance window 2020-05-14 → 2026-08-31 | **2,301** |
| fetchable without a key (first of each month, 2020-06-01 → 2026-08-01) | **75** |
| **missing without a key** | **2,226 (96.7%)** |

## Volume

Measured on real archives, not estimated:

| | 2020-06-01 | 2020-07-01 |
|---|---|---|
| `incremental_book_L2` compressed | 408 MB | 226 MB |
| `trades` compressed | 11.8 MB | 6.0 MB |
| level rows | 62.2 M | 33.5 M |
| depth events | 10.8 M | 8.5 M |
| trades | 922 k | 446 k |
| replay wall-clock | 146 s | 133 s |
| feature store output | 23.3 MB | 22.0 MB |

Extrapolating the 2020 figures across the acceptance window — later years are busier, so
treat this as a floor:

| quantity | free tier (75 days) | full acceptance window (2,301 days) |
|---|---|---|
| archive download | ~20 GB | **~0.9–2.5 TB** |
| replay compute | ~3 h | **~4–8 days single-threaded** |
| feature store on disk | ~1.7 GB | **~50 GB** |

The raw `data-feeds` replay is roughly **26 GB/day uncompressed** (measured: 3.08 MB for
10 s of depth), i.e. ~60 TB for the window. It is therefore never the bulk source; it is
used on sample windows to prove that the CSV path reproduces a sequence-verified book,
which `historical/reconcile.mjs` does.

## What free access can and cannot support

**Can:** the whole engineering path — adapter, canonical schema, book reconstruction,
audit, feature store, reconciliation against the sequence-verified raw feed, the research
runner, the execution study, the backtest, the UI. All of it runs today on 75 days.

**Cannot:** an acceptance verdict. 75 days, one per month, is not the pre-registered
development / validation / locked-test design, and the pre-registration forbids using it
as one. Results computed on it are labelled **PRELIMINARY — NOT AN ACCEPTANCE VERDICT**
and cannot promote a model to PASS.

## To unblock

```bash
export TARDIS_API_KEY=…
npm run m2h:replay          # 2020-05-14 → 2026-08-31, resumable, skips days already built
npm run research:m2h        # writes research/RESULTS-M2H.md
```

Nothing else changes: no code edit, no re-specification. The runner already reads the
whole window and reports the same tables over more days. Budget roughly 1–2.5 TB of
transfer, 50 GB of store, and several days of single-threaded replay — or parallelise by
month, since days are independent.

**What must not be done instead.** Substituting OHLCV bars, Binance REST depth
snapshots sampled at intervals, or any other cheaper proxy. None of them reconstructs an
order book, and a study that silently changes its data source is a different study.
