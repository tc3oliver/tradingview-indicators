# Trade Risk Planner

A mechanical risk converter for discretionary trades, plus the pre-registered
study that decided what this product is allowed to be.

**[`planner.pine`](./planner.pine)** works on any symbol and any timeframe. You
choose the direction, the entry and the invalidation level; it computes the
position size for a fixed fraction of account risk, draws the stop and the
1R/2R/3R ladder, tracks a rolling N-bar extreme as a reference exit level, and
alerts when the invalidation or entry is touched. It generates no signals.

## Why it generates no signals

This directory started as a **BTC 4H Trade Planner** — a `strategy()` that
would print BIAS / SETUP / TRIGGER / INVALIDATION with its own backtest
alongside. Whether that product could exist was treated as an empirical
question and pre-registered before the first run
([`PRE-REGISTRATION.md`](./PRE-REGISTRATION.md), commit `05f7434`):

- **96 configurations, declared in advance:** {daily 200MA, 12-week momentum,
  both-agree} bias × {EMA20 pullback-reclaim, EMA50 pullback-reclaim,
  Donchian-20, Donchian-40} entry × {1.5, 2.0} ATR initial stop × {10, 20}-bar
  trailing extreme × {long, short}, each with TradingView-compatible execution
  (signal at confirmed close, fill at next open, intrabar stop fills, 0.14%
  round-trip cost, no-leverage stop-based sizing).
- **Ten acceptance gates**, including positive after-cost expectancy on both
  validation and a locked test period, PF ≥ 1.20, PF > 1.0 after removing the
  best 5% of trades, ≥ 40 trades (else INSUFFICIENT, never PASS), per-year
  consistency, parameter-neighbourhood stability, an exposure-matched baseline
  comparison, and a Deflated Sharpe Ratio computed from the honest trial count
  (288 trials this study + 45 prior = 333).

**Result: 0 of 96 passed. 76 REJECTED, 20 INSUFFICIENT.** Four configurations
failed only the DSR gate — and deserved to: the search's own noise floor
(expected best Sharpe of 96 zero-edge configurations, ≈ 2.47 annualised) sits
above the best observed result (1.53), and three of the four lose money in
2020–2023 with their entire positive record inside the 2024–2026 regime.
Details in [`RESEARCH-LOG.md`](./RESEARCH-LOG.md) and
[`research/RESULTS.md`](./research/RESULTS.md).

Per the pre-registration, the strategy was not built. What ships instead is the
one part of the plan that needs no validation because it makes no prediction:
**stop-based position sizing is arithmetic.**

## What the panel shows

```
TRADE RISK PLANNER              LONG
ENTRY           65,250  (pinned)
INVALIDATION    63,900  (2.07%, 1.5 ATR)
RISK            1% = 100.00
SIZE            0.074074  (4,833)
EXPOSURE        0.48x equity
1R / 2R / 3R    66,600 / 67,950 / 69,300
TRAIL REF (10)  64,600
BAR RANGE       1.3x ATR14
EVIDENCE        96 entry rules tested, 0 validated
                sizes risk — does not predict
```

- **Entry** — live (follows price) or pinned to a level you are stalking.
- **Invalidation** — yours, or by default an ATR-multiple distance convention.
  A stop on the wrong side of entry voids the plan instead of silently
  flipping it.
- **Size / exposure** — `equity × risk% ÷ stop distance`, capped at a maximum
  exposure multiple. When the cap binds the panel shows the risk **actually
  taken**, which is then less than the budget — it never pretends the full
  risk% is on.
- **Trail ref** — lowest low (long) / highest high (short) of the *previous*
  N bars. It excludes the live bar, so it never repaints.
- **Evidence** — the study result, in place of a confidence score.

## Tests

```
npm install
npm test    # 17 checks
```

PineTS runs the real `planner.pine` on recorded Binance bars and verifies the
sizing algebra end-to-end, the leverage cap and the reported under-cap risk,
direction/stop validation, the R ladder, and that the trailing reference uses
only the previous N bars on every sampled bar. PineTS performs no type
checking, so compilation is only provable in the Pine Editor.

The research needs the local data cache
(`../btc-4h-regime-engine/data/cache/btc-4h.json`, built by that project's
`data/fetch.mjs`); rerun with `node research/phase45.mjs`.

## Files

| file | what it is |
|---|---|
| `planner.pine` | the indicator |
| `tests.mjs` | offline verification of the indicator |
| `PRE-REGISTRATION.md` | frozen study design, committed before the first run |
| `RESEARCH-LOG.md` | the verdict and why the DSR gate was right |
| `research/engine.mjs` | trade-level backtest engine (Pine-compatible execution) |
| `research/phase45.mjs` | grid runner + ten gates + DSR |
| `research/RESULTS.md` | full 96-row performance table |
| `trials.json` | 288-entry trial registry for this study |
