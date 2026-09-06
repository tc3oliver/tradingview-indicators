# BTC Intraday Trade Planner — pre-registration (study IT1)

Frozen before the first setup backtest. This file is not edited after results
exist. New hypotheses need a new pre-registration commit.

Everything on 2020-01 → 2026-09 data is **RETROSPECTIVE RESEARCH**. This
project has examined BTC over this period many times before (see
`../btc-4h-regime-engine/`, `../btc-4h-trade-planner/`); nothing here is
untouched out-of-sample. The only out-of-sample evidence will be the
prospective cohort (§9).

---

## 0. Integrity

- Frozen and untouched by this study: `../btc-4h-market-intelligence/`
  (Market Radar, `70c96b4`), `../btc-4h-trade-planner/` (Trade Risk Planner
  and the rejected 4H study), `../session-highs-and-lows-indicator/`.
- Prior trial registries seed the multiple-testing count: 45
  (`btc-4h-regime-engine/trials.json`) + 288 (`btc-4h-trade-planner/trials.json`)
  = **333 prior entries**.
- This study registers **36 primary candidates** and **108 robustness
  neighbours** (3 per primary) = 144 configurations × 3 splits = **432
  entries**, all written to `trials.json` before any gate is evaluated.
  DSR uses **N = 765**.
- Parameters not listed here are not tested. No 30/90-minute opening ranges,
  no 1.5R/3R targets, no 0.5-ATR buffers, no other levels, no oscillators, no
  additional sessions, ever, within this study.
- The Phase 1 audit (`research/AUDIT.md`) is descriptive and was completed
  before this file; it informed only the session definitions and the
  same-slot RVOL definition below.

## 1. Data, execution, costs

- Binance USDT-M perpetual BTCUSDT, 15m klines (`data/fetch.mjs`),
  2020-01-01 → 2026-09-06, 234,240 bars, no grid gaps.
- Signals are evaluated on the **confirmed close** of a 15m bar. Entries fill
  at the **open of the next bar** (TradingView default order processing).
- Stop orders fill at the stop price; if a bar opens beyond the stop, at the
  open. Limit targets fill at the target price; if a bar opens beyond the
  target, at the open.
- Stop and target orders are active on the fill bar itself (TradingView links
  `strategy.exit` to the entry it protects).
- **Same-bar TP/SL ambiguity** resolved with the TradingView broker-emulator
  path rule: if `high − open ≤ open − low` the bar is assumed to trade
  open → high → low → close, otherwise open → low → high → close.
- Session-end flat: on a session's last bar an open position is closed at the
  **next bar's open** (`strategy.close` semantics). No overnight, no weekend
  positions; no position ever spans a split boundary, so no boundary closes
  are needed.
- Costs: base **0.07% per side** (0.05% taker + 0.02% slippage) = 0.14% round
  trip, applied to notional at each fill. Stress: 0.10%/side (0.20% RT) and
  0.15%/side (0.30% RT). Pine: `commission_type = strategy.commission.percent`,
  `commission_value = 0.07`, `slippage = 0`.
- Sizing: `qty = min(1% × equity / Rp, 3 × equity / fill)`, equity = realised
  cash at signal time, start 10,000. R-multiples do not depend on sizing;
  currency/equity metrics (Sharpe, maxDD, Calmar) do.
- Splits (chronological, by signal bar):
  development 2020-01-01 → 2024-01-01; validation 2024-01-01 → 2025-07-01;
  locked test 2025-07-01 → 2026-09-06. Validation is the selection set; test
  is opened once, at the end, for every configuration at the same time.

## 2. Sessions (local time, DST-correct)

| session | timezone | window | opening range |
|---|---|---|---|
| ASIA | Asia/Tokyo | 09:00–15:00 | — (levels only) |
| LONDON | Europe/London | 08:00–16:30 | 08:00–09:00 (4 bars) |
| NY | America/New_York | 09:30–16:00 | 09:30–10:30 (4 bars) |

A bar is in a session when its open time is inside the window on a local
Monday–Friday. A session's last bar is the one whose close time equals the
window end. Pine: `time(timeframe.period, "0800-1630", "Europe/London")` plus
`dayofweek(time, tz)`, and `hour/minute(time_close, tz)` for the last bar.

Signals are only taken on in-session bars that are **not** the session's last
bar. **One trade per session per configuration.** Only one position at a time.

## 3. Levels (all non-repainting)

- **PDH / PDL**: high / low of the previous completed UTC day
  (Pine: `request.security(syminfo.tickerid, "D", high[1], lookahead = barmerge.lookahead_on)`).
- **ASIA H / L**: high / low of the last completed ASIA session. Used in LONDON.
- **LONDON H / L**: high / low of the completed LONDON session of the same UTC
  day. Used in NY only on bars where the LONDON session has already ended
  (`inNY and not inLONDON and londonDone`).
- **Opening range OR-H / OR-L**: high / low of the session's first 4 bars,
  available from the 5th bar.
- **VWAP**: `ta.vwap(hlc3)`, anchored at 00:00 UTC (the symbol's daily
  session on TradingView). Engine: cumulative Σ(hlc3·vol)/Σvol from UTC midnight.
- **ATR**: `ta.atr(14)` on 15m (Wilder RMA seeded with SMA).
- **1H trend** (context only): previous completed 1H bar's close vs its 50-EMA
  (`request.security(syminfo.tickerid, "60", …[1], lookahead = barmerge.lookahead_on)`).
  Up = close > EMA; down = close < EMA.
- **Same-slot RVOL (ORB confirmation only)**: quote volume of the 4 OR bars
  divided by the median OR quote volume of the previous 20 sessions of the
  same session type. Undefined (no signal) until 20 prior sessions exist.

## 4. Setup families — exact rules

Notation: `sigClose` = close of the signal bar; `Rp` = planned risk per unit
= `|sigClose − stop|`; `buf` = 0.10 × ATR14 at the signal bar. Shorts mirror
longs exactly. Entry fills at next open. `TP = sigClose ± 2·Rp`.

### A. Opening Range Breakout (ORB) — LONDON, NY

- Long signal: in-session bar after the OR is complete, `close > OR-H`, first
  such bar in the session.
- Stop: `OR-L − buf`. (Structural: the breakout is wrong if the range's other
  side trades.)
- RVOL variant (separate candidate): additionally `RVOL_OR ≥ 1.0`.

### B. Liquidity Sweep & Reclaim — level ∈ {PD, ASIA, LONDON}

- Long signal on bar i: in-session; `close_i > L`; and some bar k with
  `i − 7 ≤ k ≤ i`, in the same session, had `low_k < L`
  (Pine: `ta.barssince(inSess and low < L) <= 7`). First such bar in the
  session.
- Stop: `lowest(low, 8) − buf` at the signal bar (the sweep low).
- Sessions: PD in LONDON and in NY; ASIA in LONDON; LONDON in NY (after
  London close).

### C. VWAP Pullback / Reclaim — LONDON, NY

- Long signal on bar i: in-session; `close_i > vwap_i` and
  `close_{i−1} ≤ vwap_{i−1}`. First such bar in the session.
- Stop: `lowest(low, 8) − buf`.

### Context increment (Phase 3)

`+1H`: the signal additionally requires 1H trend up (long) / down (short).
Applied to every base candidate except the ORB-RVOL candidates.

## 5. Candidate table (36 primary)

| # | family | level/variant | session | context | directions |
|---|---|---|---|---|---|
| 1–4 | ORB | base | LONDON, NY | none | L, S |
| 5–8 | ORB | RVOL ≥ 1.0 | LONDON, NY | none | L, S |
| 9–12 | ORB | base | LONDON, NY | +1H | L, S |
| 13–20 | SWEEP | PD@LONDON, PD@NY, ASIA@LONDON, LONDON@NY | — | none | L, S |
| 21–28 | SWEEP | same four | — | +1H | L, S |
| 29–32 | VWAP | — | LONDON, NY | none | L, S |
| 33–36 | VWAP | — | LONDON, NY | +1H | L, S |

**Robustness neighbours** (3 per primary, registered as trials, used only by
gate G8): n1 `buf = 0.25 × ATR`; n2 exit = 50% at `sigClose ± 1·Rp` then
remainder at 2R / stop / session end, stop unchanged; n3 window = OR of 3
bars (ORB) or lookback 12 bars in the sweep condition and stop (SWEEP, VWAP).

## 6. Metrics (per configuration, per split, and on validation ∪ test)

trades; expectancy (R and %); win rate; avg win / avg loss (R); profit
factor; PF after removing the best 5% of trades (ceil); net R; per-bar Sharpe
and Sortino (annualised ×√(96·365)); max drawdown; Calmar; MAE / MFE (R, mean
and worst); exposure (share of bars in position); turnover (round trips per
year); longest losing streak; largest winner's share of gross profit; by
calendar year; by weekday; expectancy at 0.20% and 0.30% round-trip cost.

## 7. Gates — locked

Evaluated on validation ∪ test unless stated. Trades assigned by signal bar.

| gate | rule |
|---|---|
| G1 | expectancy in R after base cost **> 0 in development, in validation, and in test, each separately** |
| G2 | profit factor ≥ 1.20 |
| G3 | PF > 1.0 after removing the best 5% of trades |
| G4 | ≥ 60 trades — otherwise the verdict is **INSUFFICIENT** regardless of other gates |
| G5 | among calendar years with ≥ 10 trades, ≥ 50% have net R > 0, **and** net R > 0 after deleting the best year |
| G6 | largest single winner < 25% of gross profit |
| G7 | expectancy in R > 0 at 0.20% round-trip cost |
| G8 | ≥ 2 of the 3 robustness neighbours have expectancy in R > 0 |
| G9 | Deflated Sharpe Ratio ≥ 0.95, per-bar Sharpe of the sized equity curve on validation ∪ test, N = 765, Var(SR) from the 144 validation Sharpes of this study, skew/kurtosis from the candidate's own bar returns |

Verdict: `INSUFFICIENT` if G4 fails; else `RETROSPECTIVE PASS` if all gates
pass; else `REJECTED`. Long and short, and each session, are separate
candidates and never pooled. Thresholds are not moved after results.

**Context rule.** A `+1H` candidate ships only if it passes and (its base
fails, or its expectancy exceeds the base's by ≥ 0.10 R). If a base passes,
the context version is not added merely for being "also positive".

**Multiple passes.** If more than one candidate passes, the product runs them
all with one position at a time; priority when signals coincide: SWEEP, ORB,
VWAP. If none pass: **no strategy is built.**

## 8. Phase 7 — alternative data

Only after a RETROSPECTIVE PASS, one factor at a time, base vs base + factor,
adopted only if expectancy, MAE and tail loss all improve on validation ∪
test with the same gates. No composite score. Footprint: live context only
unless a historical equivalence can be demonstrated.

## 9. Prospective cohort

At freeze: record the commit hash and SHA-256 of the strategy source, the
freeze timestamp, and the configuration. Every signal after the freeze is
logged with its full plan. Evidence label is `PROSPECTIVE INSUFFICIENT` until
30 prospective trades exist, then `PROSPECTIVE SUPPORTED` if expectancy > 0
and PF > 1.0, else `PROSPECTIVE FAILED`.

## 10. Vocabulary

`REJECTED` · `INSUFFICIENT` · `RETROSPECTIVE PASS` · `PROSPECTIVE
INSUFFICIENT / SUPPORTED / FAILED`. No confidence percentages, no scores.
