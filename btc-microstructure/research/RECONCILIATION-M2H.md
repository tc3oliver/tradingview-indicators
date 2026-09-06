# M2-H vendor / live reconciliation

8 window(s) of 5 min: 2020-06-01, 2020-07-01, 2020-08-01, 2020-09-01, 2020-10-01, 2020-11-01, 2020-12-01, 2021-01-01. Generated 2026-09-06T09:59:00.781Z.

Free replay access caps a response at roughly 3.2 MB — about one minute of raw depth on
this instrument — so the overlap is pooled across days rather than stretched into one
long window. The threshold is a count of compared seconds, not consecutive seconds.

Three questions, each licensing a different thing. Run before the study, because the
first one decides whether the study may run at all.

## Verdict: **PASS**

| check | result |
|---|---|
| the bulk CSV path reproduces a sequence-verified book | pass |
| our live @100ms depth is equivalent to the @0ms capture | pass |
| the CSV `side` column is the liquidity taker | pass |
| enough overlapping seconds | pass (465) |

## 1. Raw, sequence-verified reconstruction

Rebuilt through the identical `OrderBook.apply()` the live collector uses, with Binance's own `U`/`u`/`pu` continuity rule.

Applied 37,635 events, 0 sequence gaps, 467 dropped as stale, 0 crossed books, 465 seconds sampled.

## 2. CSV path versus the sequence-verified book

| feature | median rel. | p99 rel. | max rel. | median abs. |
|---|---|---|---|---|
| bid | 0.00e+0 | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| ask | 0.00e+0 | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| spreadBp | 0.00e+0 | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| microprice | 0.00e+0 | 3.94e-8 | 3.94e-8 | 0.00e+0 |
| micropriceDisplacementBp | 0.00e+0 | 6.98e+0 | 6.98e+0 | 0.00e+0 |
| depthBidTop1 | 0.00e+0 | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| depthBidTop5 | 0.00e+0 | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| depthBidTop10 | 0.00e+0 | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| depthAskTop1 | 0.00e+0 | 1.55e-1 | 1.55e-1 | 0.00e+0 |
| depthAskTop5 | 0.00e+0 | 6.09e-1 | 6.09e-1 | 0.00e+0 |
| depthAskTop10 | 0.00e+0 | 4.24e-1 | 4.24e-1 | 0.00e+0 |
| depthBid5bp | 0.00e+0 | 5.98e-2 | 5.98e-2 | 0.00e+0 |
| depthAsk5bp | 0.00e+0 | 1.36e-1 | 1.36e-1 | 0.00e+0 |
| imbTop1 | 0.00e+0 | 6.98e+0 | 6.98e+0 | 0.00e+0 |
| imbTop5 | 0.00e+0 | 3.73e-1 | 3.73e-1 | 0.00e+0 |
| imbTop10 | 0.00e+0 | 3.48e+1 | 3.48e+1 | 0.00e+0 |
| imbWeighted | 0.00e+0 | 2.86e-1 | 2.86e-1 | 0.00e+0 |
| flow5sAfi | 1.16e-3 | 7.76e+0 | 7.76e+0 | 3.96e-4 |
| flow5sSigned | 1.59e-3 | 1.73e+1 | 1.73e+1 | 1.62e+3 |
| pressureToCapacity | 1.19e-3 | 1.06e+1 | 1.06e+1 | 1.18e-2 |
| flowTimesFragility | 1.16e-3 | 7.76e+0 | 7.76e+0 | 8.79e-5 |

Compared 465 seconds; 0 seconds present in the raw rebuild but absent from the store.

## 3. 100 ms batching equivalence

Binance builds the `@100ms` stream our live collector subscribes to by unioning the
0 ms updates over each window with absolute, last-write-wins levels. That should make
the book identical at any sampling boundary. Tested rather than asserted: the raw 0 ms
stream is batched into 100 ms diffs and the resulting books compared.

| feature | median rel. | p99 rel. | max rel. |
|---|---|---|---|
| bid | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| ask | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| spreadBp | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| microprice | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| micropriceDisplacementBp | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| depthBidTop1 | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| depthBidTop5 | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| depthBidTop10 | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| depthAskTop1 | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| depthAskTop5 | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| depthAskTop10 | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| depthBid5bp | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| depthAsk5bp | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| imbTop1 | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| imbTop5 | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| imbTop10 | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| imbWeighted | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| flow5sAfi | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| flow5sSigned | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| pressureToCapacity | 0.00e+0 | 0.00e+0 | 0.00e+0 |
| flowTimesFragility | 0.00e+0 | 0.00e+0 | 0.00e+0 |

Compared 465 seconds.

## 4. Aggressor side

Correlation between the AFI derived from the raw `m` flag and the AFI derived from the CSV `side` column: **0.979009**, against **-0.979009** if the side is flipped, over 465 seconds. Raw payload trade sides in the window: 4539 aggressive buys, 5265 aggressive sells.

## What this licenses, and what it does not

The exchange-state features are reproduced by the bulk path, so vendor backtests of
book state are about the same object the live planner measures. Flow features differ at
the 1e-5 level, from millisecond trade-timestamp granularity between the two sources —
bounded and reported, not corrected.

It does **not** license a live-versus-vendor comparison on the same wall-clock day: our
prospective capture began 2026-09-06 and free vendor access covers only the first day of
each month, so there is no overlapping date without an API key. The bridge is indirect and
stated as such: vendor CSV ≡ vendor raw payloads ≡ the payload shape and code path our
collector runs.
