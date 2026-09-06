# BTC Intraday Trade Planner — study IT1

A pre-registered attempt to build a 15m `strategy()` for BTC that tells a
user LONG / SHORT / NO TRADE, entry, stop, targets and what it is waiting
for, with its backtest visible in the Strategy Tester.

**It was not built.** All 36 pre-registered candidates failed. This directory
is the record of why.

## What was tested

Three setup families on Binance BTCUSDT perpetual, 15m, 2020-01 → 2026-09,
with DST-correct London / New York sessions, long and short separately,
sessions separately, with and without a 1H-trend context:

- **Opening Range Breakout** — first 60 minutes of London and New York,
  confirmed close outside the range, stop at the other side of the range;
  plus a same-session relative-volume variant.
- **Liquidity Sweep & Reclaim** — previous-day high/low, Asia high/low
  (in London), London high/low (in New York after London closes); price
  trades through the level, a confirmed 15m close reclaims it, stop at the
  sweep extreme.
- **Session VWAP reclaim** — confirmed close back across the daily VWAP,
  stop at the pullback extreme.

All with a 2R target, a 0.1-ATR stop buffer, one trade per session, flat at
session end, fill at next open, 0.14% round trip. Three robustness neighbours
per candidate (wider buffer, 1R partial, alternative window) = 144
configurations, all registered. Nine gates, frozen before the run.

## Result

| verdict | count |
|---|---|
| RETROSPECTIVE PASS | 0 |
| REJECTED | 31 |
| INSUFFICIENT | 5 |

Gross of costs the candidates are coin flips (−0.26 … +0.20 R per trade);
the round-trip cost on a 40–200 bp stop is 0.1–0.5 R, so 35 of 36 lose net.
The one that does not (ORB NY short +1H, +0.03 R) loses in development, has
PF 1.12, and turns negative at 0.20% round trip. The Deflated Sharpe Ratio is
0.000 for every candidate against a 765-trial noise floor of 4.42.

Details: [`RESEARCH-LOG.md`](./RESEARCH-LOG.md) and
[`research/RESULTS.md`](./research/RESULTS.md). The seasonality audit that
preceded the study — and whose conclusions (local-time sessions, same-slot
volume normalisation) do survive — is in [`research/AUDIT.md`](./research/AUDIT.md).

## Reproduce

```
node data/fetch.mjs            # 15m klines from Binance fapi (not committed)
node research/audit.mjs        # Phase 1 audit -> research/AUDIT.md
npm test                       # engine invariants (session containment, no overnight, R bounds)
node research/run.mjs          # 144 configs -> trials.json, research/RESULTS.md, results.json
```

## Files

| file | what it is |
|---|---|
| `PRE-REGISTRATION.md` | frozen study design, committed before the first run (`ab5f599`) |
| `RESEARCH-LOG.md` | verdict, why, what replicated, what is and is not ruled out |
| `research/AUDIT.md` | Phase 1 intraday seasonality audit |
| `research/sessions.mjs` | DST-correct session logic shared by audit and engine |
| `research/engine.mjs` | trade-level backtest engine (TradingView-compatible execution) |
| `research/run.mjs` | grid runner, trial registry, nine gates, DSR |
| `research/smoke.mjs` | engine invariant checks (`npm test`) |
| `research/RESULTS.md` | full performance tables for all 144 configurations |
| `trials.json` | 432-entry trial registry |
