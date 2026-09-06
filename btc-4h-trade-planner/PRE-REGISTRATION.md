# BTC 4H Trade Planner — pre-registration

**Written and committed before the first backtest was run.** Everything below is
fixed. Nothing in this file may be edited after results are seen; a change to
any definition starts a new hypothesis with its own entry and its own trial
count.

---

## 0. Research integrity

### 0.1 This is retrospective research. It is not out-of-sample.

BTC 4H data from **2020-09-01 to 2026-09-03** has already been examined
extensively by this project across four pre-registered hypotheses (H1–H4), one
exposure-control phase, and a Deflated Sharpe computation — see
[`../btc-4h-regime-engine/RESEARCH-LOG.md`](../btc-4h-regime-engine/RESEARCH-LOG.md).
The "locked holdout" period 2025-07 → present **has already been read once.**

Therefore every result produced by this study is labelled:

> **RETROSPECTIVE RESEARCH**

No period of it may be described as untouched out-of-sample. The three-way split
below exists to impose *selection discipline* — to stop the author from picking
a model on the same data that scores it — not to manufacture an OOS claim it
cannot support.

The only genuinely out-of-sample data this project will ever have is bars that
**do not exist yet**. That is what the prospective cohort in §7 is for.

### 0.2 Trial registry

Every configuration counts as a trial the moment its performance is computed —
whether or not it was a serious candidate, whether or not it is reported.
Entries are never deleted to improve a number.

The registry seeds from the 45 trials already recorded in
`../btc-4h-regime-engine/trials.json`. The Deflated Sharpe Ratio is reported
against two honest pools: this study alone, and this study plus all prior work.

**Pre-declared trial count for this study:**

| dimension | values | count |
|---|---|---|
| Bias | A 200MA · B 12W momentum · C both agree | 3 |
| Entry | EMA20 pullback · EMA50 pullback · Donchian20 · Donchian40 | 4 |
| Initial stop | 1.5 ATR · 2.0 ATR | 2 |
| Trailing exit | 10-bar extreme · 20-bar extreme | 2 |
| Direction | long · short | 2 |
| | **total** | **96** |

96 configurations × 3 splits. This is a large grid and it is declared in advance
precisely so the multiple-testing penalty is paid honestly rather than hidden.
It is the grid specified in the product brief; no lookback, stop or exit value
outside this table may be tested. **In particular: no 1.7 / 1.8 / 2.1 ATR, no
15-bar or 30-bar trail, no 25-bar or 55-bar Donchian, ever.** Adding one after
seeing results is the exact failure mode this file exists to prevent.

### 0.3 Market Radar is frozen

`../btc-4h-market-intelligence/main.pine` at commit `70c96b4` is frozen and is
not modified by this study. It remains a descriptive context layer. None of its
derivatives, flow or on-chain measurements may influence a trade signal unless
they clear the incremental test in Phase 6 — which cannot start until a
price-only model has passed Phase 5.

---

## 1. Data and execution assumptions

### 1.1 Dataset

`../btc-4h-regime-engine/data/cache/btc-4h.json` — 13,164 Binance BTCUSDT
perpetual 4H bars, 2020-09-01 → 2026-09-03, zero kline gaps. Backtest window is
capped at 2020-09-01 by the source dump, not by choice.

### 1.2 Daily series

Bias uses daily values resolved by the **same non-repainting idiom the frozen
indicator uses** (`main.pine:215`):

```pine
request.security(sym, "1D", [ta.sma(close,200)[1], close[1]/close[85] - 1, int(time[1])],
                 lookahead = barmerge.lookahead_on)
```

`lookahead_on` combined with `[1]` returns the **previous completed daily bar**.
For any 4H bar inside UTC day *D*:

- `dSma200` = 200-day SMA of daily closes through day *D−1*
- `dMom12w` = `dailyClose[D−1] / dailyClose[D−85] − 1` (84 days = 12 weeks)

Daily bars are built from the 4H series on UTC calendar days; the daily close is
the close of the 20:00 UTC bar. The research engine replicates this exactly so
the Pine strategy can reconcile against it.

### 1.3 Execution model (must match TradingView `strategy()` exactly)

| assumption | value |
|---|---|
| Decision point | confirmed 4H close only |
| Entry fill | **open of the next bar** (Pine default for `strategy.entry` with `calc_on_every_tick=false`) |
| Stop fill | intrabar at the stop price; if the bar **opens beyond** the stop, fill at the open |
| Stop level in force during bar *i* | the level computed at the close of bar *i−1* |
| Lookahead | none. No pivot backdating, no same-bar signal-and-fill |
| Intrabar path assumption | if a bar touches both the stop and nothing else, the stop fills. No optimistic "target first" assumption exists because there are no targets |
| Commission | **0.07% per side** = 0.05% Binance futures taker + 0.02% assumed slippage |
| Slippage (separate) | 0 — folded into commission so the Pine `strategy()` and this engine are bit-comparable. Pine's `slippage` is in ticks, which is not scale-invariant over a 10k→120k price range |
| Round-trip cost | 0.14% |
| Concurrent positions | 1 per model. A new signal while in position is ignored, never pyramided |
| Position sizing | risk 1.0% of equity: `qty = 0.01 × equity / abs(entry − initialStop)`, notional capped at 1.0× equity (no leverage) |
| Equity | compounds |

Metrics are reported both in currency (equity-compounded) and in **R multiples**
(sizing-independent), because a currency result mixes the sizing rule into the
edge measurement and an R result does not.

### 1.4 Splits

| split | period | role |
|---|---|---|
| Development | 2020-09-01 → 2024-01-01 | model construction |
| Validation | 2024-01-01 → 2025-07-01 | **selection happens here** |
| Locked test | 2025-07-01 → 2026-09-03 | read once, after selection |

A trade is assigned to the split containing its **entry bar**. Trades open at a
split boundary are closed at the boundary at that bar's close, so no trade
spans two splits and no split inherits an unrealised mark. (The H3 result was
materially distorted by exactly that: a positive holdout return carried entirely
by one open position.)

---

## 2. Phase 1 — Bias

Evaluated at every confirmed 4H close. Long and short are separate conditions,
never two sides of one variable.

| id | definition (long) | definition (short) |
|---|---|---|
| **A** 200MA | `close > dSma200` | `close < dSma200` |
| **B** 12W momentum | `dMom12w > 0` | `dMom12w < 0` |
| **C** agreement | A-long **and** B-long | A-short **and** B-short |

`close` is the confirmed 4H close of the chart symbol. If `dSma200` or
`dMom12w` is unavailable (warm-up), bias is NEUTRAL and no entry is permitted.

**A failing short model is deleted, not kept for symmetry.** If the study ends
with LONG / CASH and no short at all, that is the result.

---

## 3. Phase 2 — Entry models

Both families require the corresponding bias to be active at the signal bar's
close.

### 3.1 Pullback continuation — exact reclaim rule

EMA period *n* ∈ {20, 50}, computed on 4H closes.

- **Long:** `bias_long AND close > ema_n AND close[1] <= ema_n[1]`
- **Short:** `bias_short AND close < ema_n AND close[1] >= ema_n[1]`

That is: *the first confirmed 4H close back above the EMA after at least one
confirmed close at or below it.* The prior close being on the wrong side **is**
the pullback; this deliberately introduces no depth threshold, no bar-count
window, and no separate "reclaim confirmation" parameter, because each of those
would be a new swept dimension.

### 3.2 Breakout continuation

Donchian lookback *N* ∈ {20, 40} bars, excluding the current bar.

- **Long:** `bias_long AND close > highest(high, N)[1]`
- **Short:** `bias_short AND close < lowest(low, N)[1]`

`[1]` excludes the signal bar's own high/low from its own channel.

---

## 4. Phase 3 — Exit and invalidation

Every model carries a complete trade plan that is fully determined **at the
close of the signal bar**, before the entry fill exists.

| component | rule |
|---|---|
| Entry reference | close of the signal bar (`sigClose`) |
| Initial stop, long | `sigClose − k × atr14`, k ∈ {1.5, 2.0} |
| Initial stop, short | `sigClose + k × atr14` |
| ATR | `ta.atr(14)` on 4H, value at the signal bar |
| Trailing exit, long | `lowest(low, M)[1]`, M ∈ {10, 20}, recomputed each confirmed close |
| Trailing exit, short | `highest(high, M)[1]` |
| Active stop, long | `max(initialStop, trailingExit)` — the trail only takes over once it rises above the initial stop |
| Active stop, short | `min(initialStop, trailingExit)` |
| Profit target | **none** |
| Time stop | **none** |
| Bias flip exit | **none** — exits are by stop or trail only |

The three lines the product must be able to print at signal time are therefore
`ENTRY` (next bar open, level shown as `sigClose`), `INITIAL INVALIDATION`
(the initial stop price), and `EXIT RULE` (the M-bar trailing extreme).

---

## 5. Phase 4 — Reported metrics

Per setup **and per direction**, never blended, for each split and for
validation+test combined:

trades · net expectancy per trade (currency and R) · win rate · average winner ·
average loser · profit factor · Sharpe · Sortino · max drawdown · Calmar ·
average and worst MAE · average MFE · exposure (fraction of bars in market) ·
turnover · longest losing streak · profit factor after removing the best 5% of
trades · per-calendar-year net R.

All figures are after the costs in §1.3. There is no gross-of-cost headline.

---

## 6. Phase 5 — Acceptance gates

**Fixed before the first run.** A model is adopted only if it passes **all ten**.
Long and short are judged separately.

| # | gate | threshold |
|---|---|---|
| **G1** | Expectancy after costs > 0 on **both** validation and locked test | `> 0` each |
| **G2** | Profit factor | `≥ 1.20` on validation **and** on locked test |
| **G3** | Profit factor after removing the best 5% of trades (validation+test) | `> 1.00` |
| **G4** | Independent trades across validation + locked test | `≥ 40`, else **INSUFFICIENT** (never PASS) |
| **G5** | Not dependent on one year: of calendar years with ≥ 5 trades, ≥ 50% have positive net R, **and** total net R stays > 0 after deleting the single best year | both |
| **G6** | Not dependent on a few winners: largest single winner < 25% of gross profit (validation+test) | `< 25%` |
| **G7** | Parameter neighbourhood stable: of the cell's immediate grid neighbours (one of {EMA period / Donchian N, stop k, trail M} moved to its other pre-registered value), ≥ 50% also show positive validation+test expectancy | `≥ 50%` |
| **G8** | Long and short evaluated separately; a direction that fails is excluded from the product | — |
| **G9** | Deflated Sharpe Ratio using the honest registry N | `≥ 0.95` |
| **G10** | Beats an exposure-matched, same-direction constant-position baseline over the same period on **both** Sharpe and Calmar | both |

**INSUFFICIENT is a distinct verdict from PASS.** A model with 12 trades and a
profit factor of 3.0 is INSUFFICIENT, and it does not enter the product.

### If every model fails

**The Trade Plan Engine is not built.** The Pine `strategy()` is not shipped
with a rule that failed. The deliverable in that case is the negative result and
the frozen Market Radar, and that is a complete and acceptable outcome.

---

## 7. Phase 6 — Alternative data, and only then

Runs **only if** a price-only model has already passed §6. One factor at a time,
base model versus base + factor, in this fixed order:

OI · premium · funding · spot/perp participation · SOPR · ETF · liquidation.

A factor may influence trading only if it produces a stable improvement in at
least one of expectancy, MAE, tail loss, false-setup rate, or drawdown, **and**
damages none of the other primary metrics. Otherwise the Market Radar keeps
displaying it and the Trade Planner ignores it completely.

---

## 8. Prospective cohort

At model freeze the study records: code hash, config hash, model version, and
freeze timestamp. **Only 4H bars closing after that timestamp are prospective.**
Re-scanning history can never produce a prospective trade. The dashboard reports
`Prospective trades: N`, and while N is below the §6 G4 threshold it reports
**INSUFFICIENT** rather than a performance figure.

---

## 9. Position sizing is not an alpha claim

Sizing is mechanical stop-based risk conversion:

```
allowedLoss  = equity × riskPerTrade      (default 1.0%)
positionSize = allowedLoss / abs(entry − initialStop)
```

capped at 1.0× equity. The rejected volatility Risk Budget
(`../btc-4h-market-intelligence/audit/risk-budget-validation.mjs`, 6 of 7 gates,
G1 failed at 3.2% against 10%) **is not reinstated** and no volatility scaling
enters this product.

---

## 10. Evidence vocabulary

The product may display exactly these verdicts:

`REJECTED` · `INSUFFICIENT` · `RETROSPECTIVE PASS` · `PROSPECTIVE SUPPORTED`

It may not display a confidence percentage, a star rating, a "strong buy", or an
AI score. There is no calibrated model behind such a number, so printing one
would be a fabrication.
