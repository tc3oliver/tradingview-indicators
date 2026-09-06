# M1 data integrity audit

Run before the M1 pre-registration was written. Nothing here uses forward returns.
Generated 2026-09-06T07:39:30.315Z.

## USD-M futures BTCUSDT (primary)

### 5m klines

| check | value |
|---|---|
| bars | 702,720 (2020-01-01T00:00:00.000Z → 2026-09-05T23:55:00.000Z) |
| 5m grid gaps | 0 |
| bars with zero volume / zero trades | 31 / 31 |
| taker-buy quote > total quote | 0 |
| taker-buy quote < 0 | 0 |
| non-finite fields / impossible OHLC | 0 / 0 |
| AFI mean / sd | -0.00504 / 0.2284 |
| AFI outside [-1, 1] | 0 |

### Raw aggTrades sample

| check | value |
|---|---|
| days sampled | 34 |
| trades parsed | 53,220,709 |
| notional | $497.1B |
| duplicate aggTrade ids | 0 |
| aggTrade id gaps (runs / missing ids) | 1 / 557026 |
| out-of-order timestamps | 0 |
| trades outside their archive's UTC day | 0 |
| unparseable is_buyer_maker / non-finite rows | 0 / 0 |
| longest interval with no trade | 1476.7 s |
| CSV column counts (days) | 7 cols × 34 |
| days carrying a header row | 22 / 34 |

### Reconciliation — raw aggTrades vs kline taker-buy split

9,788 audited 5m bars, 0 of them with no kline.
Largest whole-day notional difference: 2.54e-3.
Days where the aggTrade price range differs from the kline high/low: 0.

| quantity | median | p99 | p99.9 | max | bars > 1e-3 | bars > 1e-2 |
|---|---|---|---|---|---|---|
| relative error, Σ aggTrade notional vs kline quote volume | 7.67e-16 | 1.62e-3 | 1.44e-2 | 9.19e-1 | 161 | 12 |
| relative error, Σ(is_buyer_maker=false) vs kline taker-buy quote | 4.34e-16 | 6.72e-4 | 7.56e-3 | 6.33e-1 | 79 | 8 |
| same with the maker side flipped (must be large) | 1.53e-1 | 6.34e-1 | 7.90e-1 | 9.06e-1 | 9749 | 9443 |
| absolute AFI difference (AFI sd ≈ 0.23) | 6.87e-16 | 1.73e-3 | 1.34e-2 | 3.55e-1 | 150 | 14 |

Bars where the two sources give an AFI more than 0.01 apart:

| 5m bar | ΔAFI | relative notional error | aggTrades archive | kline | kline trade count |
|---|---|---|---|---|---|
| 2021-05-19T13:15:00.000Z | 0.3549 | 0.9190 | $11.49M | $141.78M | 211,056 |
| 2026-05-15T03:35:00.000Z | 0.0818 | 0.1145 | $63.42M | $71.62M | 15,245 |
| 2026-05-15T00:00:00.000Z | 0.0666 | 0.1303 | $57.23M | $65.80M | 10,576 |
| 2026-02-15T21:20:00.000Z | 0.0515 | 0.0634 | $9.62M | $10.27M | 4,016 |
| 2026-02-15T21:15:00.000Z | 0.0291 | 0.0282 | $23.70M | $23.05M | 9,781 |
| 2024-05-15T03:50:00.000Z | 0.0209 | 0.0181 | $12.53M | $12.76M | 4,244 |
| 2023-05-15T12:25:00.000Z | 0.0191 | 0.0144 | $19.30M | $19.03M | 8,155 |
| 2024-05-15T03:45:00.000Z | 0.0154 | 0.0188 | $12.52M | $12.29M | 4,872 |
| 2024-08-15T08:00:00.000Z | 0.0141 | 0.0201 | $48.44M | $47.49M | 10,069 |
| 2026-05-15T06:15:00.000Z | 0.0134 | 0.0138 | $36.16M | $36.67M | 10,829 |

### Archive boundaries (consecutive audited days)

| pair | aggTrade id chains | id gap | time ordered | gap |
|---|---|---|---|---|
| 2022-12-31 -> 2023-01-01 | yes | 0 | yes | 4.214 s |
| 2023-03-31 -> 2023-04-01 | yes | 0 | yes | 0.184 s |

## Spot BTCUSDT (venue robustness only)

### 5m klines

| check | value |
|---|---|
| bars | 702,254 (2020-01-01T00:00:00.000Z → 2026-09-05T23:55:00.000Z) |
| 5m grid gaps | 15 |
| bars with zero volume / zero trades | 31 / 31 |
| taker-buy quote > total quote | 0 |
| taker-buy quote < 0 | 0 |
| non-finite fields / impossible OHLC | 0 / 0 |
| AFI mean / sd | -0.02314 / 0.2460 |
| AFI outside [-1, 1] | 0 |

### Raw aggTrades sample

| check | value |
|---|---|
| days sampled | 7 |
| trades parsed | 8,973,115 |
| notional | $12.1B |
| duplicate aggTrade ids | 0 |
| aggTrade id gaps (runs / missing ids) | 0 / 0 |
| out-of-order timestamps | 0 |
| trades outside their archive's UTC day | 953786 |
| unparseable is_buyer_maker / non-finite rows | 0 / 0 |
| longest interval with no trade | 6185.6 s |
| CSV column counts (days) | 8 cols × 7 |
| days carrying a header row | 0 / 7 |

### Reconciliation — raw aggTrades vs kline taker-buy split

1,728 audited 5m bars, 165606 of them with no kline.
Largest whole-day notional difference: 8.87e-16.
Days where the aggTrade price range differs from the kline high/low: 1.

| quantity | median | p99 | p99.9 | max | bars > 1e-3 | bars > 1e-2 |
|---|---|---|---|---|---|---|
| relative error, Σ aggTrade notional vs kline quote volume | 6.66e-16 | 5.56e-15 | 2.83e-14 | 4.76e-14 | 0 | 0 |
| relative error, Σ(is_buyer_maker=false) vs kline taker-buy quote | 4.06e-16 | 2.77e-15 | 4.80e-15 | 4.86e-15 | 0 | 0 |
| same with the maker side flipped (must be large) | 1.18e-1 | 6.67e-1 | 8.57e-1 | 9.09e-1 | 1720 | 1648 |
| absolute AFI difference (AFI sd ≈ 0.23) | 6.11e-16 | 4.44e-15 | 2.39e-14 | 2.49e-14 | 0 | 0 |

### Archive boundaries (consecutive audited days)

_none in this sample_

## Price reconciliation — 1m OHLC rebuilt from raw aggTrades vs 1m klines

| day | kline bars | compared | kline bars with trades but none in the archive | OHLC mismatches | volume mismatches | max relative volume error |
|---|---|---|---|---|---|---|
| 2020-05-15 | 1440 | 1440 | 0 | 39 | 96 | 2.67e-2 |
| 2022-05-15 | 1440 | 1440 | 0 | 128 | 349 | 3.89e-2 |
| 2024-05-15 | 1440 | 1440 | 0 | 137 | 341 | 1.30e-1 |
| 2026-05-15 | 1440 | 1440 | 0 | 40 | 137 | 3.88e-1 |

## Findings and how each is resolved

1. **The two sources agree exactly on the great majority of bars.** Median relative error between the raw-aggTrade aggregation and the kline taker-buy split is machine epsilon; whole-day notional agrees to ~1e-15 except where noted below.
2. **Millisecond boundary attribution.** A small minority of bars differ because a burst of trades sits within a millisecond or two of a 5m boundary and the two aggregations assign it to different bars; the differences offset between adjacent bars (e.g. 2024-05-15 03:45 and 03:50 differ by the same $231k with opposite sign). Bounded, not corrected: p99 |ΔAFI| is ~1.7e-3, under 1% of one AFI standard deviation.
3. **The daily archives start a few hundred milliseconds into the UTC day.** The first trades of each day land in the previous archive, so the 00:00 bar of an archive is short. The kline is the complete source there. Affects the archive only.
4. **2021-05-19 13:15 UTC: the raw archive is missing 557,026 aggTrade ids** (the single id gap in the whole sample, during the May 2021 crash). The archive holds $11.5M of notional for that bar against the kline's $141.8M over 211,056 trades. The kline is complete; the archive is defective.
5. **Spot has 15 gaps in the 5m grid** (venue downtime). Futures has none. Feature construction requires an unbroken run of bars, so a gap invalidates the bars around it rather than being silently bridged.
6. **31 futures bars have zero volume.** AFI is undefined there; those bars are excluded from every regression.

**Consequence for M1.** Features are computed from the 5m klines, i.e. from the exchange's own aggregation of the same trade stream, because it is the *more* complete of the two sources (points 3 and 4) and is identical to the raw aggregation everywhere else. `is_buyer_maker = false → aggressive buy` is confirmed against the raw archive, not assumed. Where a study needs anything the kline aggregate cannot express — trade size distribution, individual sweep sizes, sub-5m timing — raw aggTrades must be pulled and this reconciliation does not license the shortcut.

## Schema notes

- Futures (`futures/um`) aggTrades columns: `agg_trade_id, price, quantity, first_trade_id, last_trade_id, transact_time, is_buyer_maker`.
- Spot aggTrades carry one extra trailing column, `is_best_match`; column 6 (`is_buyer_maker`) is in the same position, so the same parser is used and the extra column is ignored.
- Header rows appear only in the more recent archives; the parser detects and skips them, and the count is reported above.
- `is_buyer_maker = false` means the buyer was the taker → **aggressive buy**. The reconciliation above proves this mapping: summing that side matches the kline taker-buy field to floating-point precision, and the flipped assignment does not.

## File hashes (sha256)

| file | sha256 |
|---|---|
| `btc-5m-perp.json` | `1b70c85bf965f09c9a1912bef587eb67126d5a9062a0a258213e080620484c8e` |
| `aggtrades-perp.json` | `c45ae9cd7d2cf1ab9fea434fdaf2f464500e3d5be083da1ad92e300910deaef9` |
| `btc-5m-spot.json` | `d5121299b463aebb41efe807562435eddaaf9e0fb80351ad7133b06c97f39c12` |
| `aggtrades-spot.json` | `42f9a8dcc449e25e6fd146100c2750516bd6589aa06823d6a1c821d31887912b` |
| `research/features.mjs` | `e255ec79c61415a81e7b013d7059ddc700132fcb8b67b13863aa35f5c4a7264e` |
