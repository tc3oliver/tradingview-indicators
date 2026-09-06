# BTC Intraday Trade Planner — studies IT1, IT2, IT3

Three pre-registered attempts to find a directional intraday / short-horizon
rule for BTC that a TradingView `strategy()` could ship with its own
backtest. **None passed. No strategy was built.** This directory is the record.

| study | what | result |
|---|---|---|
| **IT1** — 15m setup families | Opening-range breakout, liquidity sweep & reclaim, VWAP reclaim; London / New York; long / short; ±1H context; 36 primaries + 108 neighbours; nine gates | 31 REJECTED, 5 INSUFFICIENT, 0 PASS. Gross of costs the setups are coin flips; a 0.14% round trip on a 40–200 bp stop is 0.1–0.5 R |
| **IT2** — literature replication | Shen, Urquhart & Wang (2022), *Bitcoin intraday time-series momentum*: first half-hour return predicts the last half-hour (09:30→17:00 ET day). Exact rule, four paper-defined timing variants, paper period on Binance spot + post-publication 2022–2026 on spot and perp | **NOT REPLICATED**: R² 0.02–0.1% vs paper 1.44%, t 0.25 in the paper period, t 0.69 post-publication. Gross edge 0.010%/trade vs 0.14% cost (ratio 14×). REJECT |
| **IT3** — 1H fallback (pre-registered before IT2 ran) | 24H range breakout, 24H momentum, 24H mean reversion; 2.5-ATR stops, 2R target, 48-bar time exit; economic feasibility gate first | Feasibility passed for all 6 (cost 5–8% of planned risk) — and all 6 REJECTED. Every candidate negative in at least two of three splits; the one near-miss lost −0.13 R/trade in 2020–2023 |

Also here: the **DSR trial-count correction** — raw registry entries (849) →
configurations (291) → effective independent trials (**115**), estimated from
return correlations, with method and assumptions
([`research/EFFECTIVE-TRIALS.md`](./research/EFFECTIVE-TRIALS.md)).

Read in order: [`PRE-REGISTRATION.md`](./PRE-REGISTRATION.md) →
[`RESEARCH-LOG.md`](./RESEARCH-LOG.md) (IT1) →
[`PRE-REGISTRATION-IT2-IT3.md`](./PRE-REGISTRATION-IT2-IT3.md) →
[`RESEARCH-LOG-IT2-IT3.md`](./RESEARCH-LOG-IT2-IT3.md). The seasonality audit
whose conclusions do survive (local-time sessions, same-slot volume
normalisation) is [`research/AUDIT.md`](./research/AUDIT.md).

## Reproduce

```
node data/fetch.mjs                          # 15m perp klines (IT1, IT3)
node data/fetch-1m.mjs --market spot         # 1m spot klines from 2017 (IT2)
node data/fetch-1m.mjs --market perp         # 1m perp klines from 2019 (IT2)
node research/audit.mjs                      # Phase 1 audit
npm test                                     # IT1 engine invariants
node research/run.mjs                        # IT1 → trials.json, RESULTS.md
node research/effective-trials.mjs           # effective N (needs ../btc-4h-trade-planner data cache too)
node --max-old-space-size=8192 research/it2.mjs   # IT2 → RESULTS-IT2.md
node research/it3.mjs                        # IT3 (runs only if IT2 is REJECT) → RESULTS-IT3.md
```

The paper PDF is not committed (copyright); `research/paper/SOURCE.md` has
the open-access URL.

## Files

| file | what it is |
|---|---|
| `PRE-REGISTRATION.md` | IT1 design, frozen before the first run (`ab5f599`) |
| `PRE-REGISTRATION-IT2-IT3.md` | IT2 exact paper specification + IT3 fallback, frozen together (`b2ac11d`) |
| `RESEARCH-LOG.md` | IT1 verdict and reading |
| `RESEARCH-LOG-IT2-IT3.md` | DSR correction, IT2 and IT3 verdicts and reading |
| `research/sessions.mjs` | DST-correct session logic |
| `research/engine.mjs`, `run.mjs`, `smoke.mjs` | IT1 engine, runner, invariants |
| `research/stats.mjs` | DSR, effective-N estimators, daily aggregation |
| `research/effective-trials.mjs` | trial-count correction across all studies |
| `research/it2.mjs`, `it3.mjs` | IT2 and IT3 engines |
| `research/AUDIT.md`, `RESULTS.md`, `RESULTS-IT2.md`, `RESULTS-IT3.md`, `EFFECTIVE-TRIALS.md` | outputs |
| `trials.json` | registry: 516 entries (IT1 432, IT2 12, IT3 72) with effective-N estimates |
