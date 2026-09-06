# BTC raw trade microstructure — Study M1

A pre-registered test of one question: **does aggressive buy/sell trade flow predict
short-horizon BTC returns?** No strategy was designed until that had an answer, and it
does not have a usable one. **M1 was REJECTED and nothing was built.**

This is a change of data domain, not another parameter search. The four studies before
it ([TP1](../btc-4h-trade-planner/), [IT1, IT2,
IT3](../btc-intraday-trade-planner/)) rejected every directional rule they tested on
OHLCV bars. M1 goes to the trade tape instead: 53.2 million raw Binance aggTrades, the
aggressor side of every one of them, and 702,720 five-minute bars of signed flow.

| | |
|---|---|
| **H1** — higher aggressor flow imbalance predicts a higher next-15m return | **REJECTED**, all seven information gates. β = +1.7e-5, t = 0.46 on validation ∪ test |
| **H2** — flow that fails to move price carries different information (absorption) | **REJECTED**, five of seven gates. Absorbed and aligned flow are 0.03 bp apart |
| **the finding that survives** | flow is mildly *contrarian*: heaviest aggressive selling is followed by +0.45 bp over 15 minutes, heaviest buying by −0.27 bp, monotone across deciles and present in all three splits |
| **why it is still nothing** | that edge is **0.36 bp** against a **140 bp** round trip — COST / EXPECTED EDGE = **38.7×**. At 5-minute resolution the round trip is larger than the entire average 15-minute move (ratio 1.09) |

Read in order: [`PRE-REGISTRATION-M1.md`](./PRE-REGISTRATION-M1.md) →
[`research/AUDIT-M1.md`](./research/AUDIT-M1.md) →
[`RESEARCH-LOG-M1.md`](./RESEARCH-LOG-M1.md) →
[`research/RESULTS-M1.md`](./research/RESULTS-M1.md).

## The data question, and the honest answer to it

Seven years of BTCUSDT futures aggTrades is about 80 GB, so the full-sample features
come from the 5m klines' taker-buy split rather than from the raw tape. That is a
deviation from the specification and it is treated as one. It is licensed by
measurement: across 9,788 bars rebuilt from 53.2 million raw trades, the median
relative error between the raw aggregation and the kline split is **4e-16**, while the
same comparison with the maker side flipped has median error **0.15** — so
`is_buyer_maker = false → aggressive buy` is verified against its own negation rather
than assumed.

The audit also found the two places where the *raw archive* is the worse source: it
begins a few hundred milliseconds into each UTC day, and it is missing 557,026
aggTrade ids at 2021-05-19 13:15 UTC, holding $11.5M where the exchange recorded
$141.8M over 211,056 trades.

The licence covers aggregate signed notional per 5m bar and nothing more. Trade size
distribution, individual sweep size and sub-5-minute timing still require the raw tape.

## Reproduce

```
node data/fetch-klines.mjs --market perp --interval 5m   # 702,720 bars, 0 grid gaps
node data/fetch-klines.mjs --market spot --interval 5m
node data/fetch-aggtrades.mjs --market perp              # 34 stratified days, ~850 MB streamed
node data/fetch-aggtrades.mjs --market spot
node data/reconcile-1m.mjs --market perp                 # 1m OHLC rebuilt from raw trades
node research/audit.mjs                                  # -> research/AUDIT-M1.md
npm test                                                 # estimator and feature invariants
node --max-old-space-size=8192 research/m1.mjs           # -> research/RESULTS-M1.md, trials.json
node data/prospective.mjs                                # append post-cutoff bars (safe to re-run)
```

Archives are streamed through `funzip` and never stored; `data/cache/` is not
committed.

## Files

| file | what it is |
|---|---|
| `PRE-REGISTRATION-M1.md` | frozen before the first estimate (`1350c08`): hypotheses, splits, seven information gates, cost gate, minimal implementation, trial budget, and the M2 fallback |
| `RESEARCH-LOG-M1.md` | verdict and reading |
| `research/AUDIT-M1.md` | data integrity: duplicates, id continuity, archive boundaries, 1m price reconciliation, aggressor-side verification, schema differences |
| `research/features.mjs` | AFI and the controls; sha256 recorded in the pre-registration |
| `research/stats.mjs` | Newey–West OLS, within transformation, rank IC, deciles; sha256 recorded |
| `research/m1.mjs` | H1 and H2, gates, trial registry |
| `research/smoke.mjs` | estimator checks on data with a known answer, plus feature invariants (`npm test`) |
| `data/prospective.mjs` | post-cutoff capture, with an append log so backfill cannot pass as prospective |
| `trials.json` | 36 entries, 12 configurations, 6 effective — written before any gate was evaluated |

## What happens next

Nothing, in this directory. The pre-registration fixed the next direction before M1's
outcome was known: **M2, prospective order-book microstructure** — depth imbalance,
microprice, spread, liquidity withdrawal, queue pressure. M1 does not change what M2
is, but it does set the bar M2 has to clear. If aggregate signed flow is worth 0.4 bp
over fifteen minutes, book-derived features have to be worth more than 1.4 bp per
round trip to matter at all, and M2's pre-registration has to state its horizon and
fee tier first and reject itself if that arithmetic cannot be beaten.

No Pine `strategy()` is promised, then or now. TradingView cannot serve this data, and
an approximation would be a new hypothesis inheriting none of the evidence here.
