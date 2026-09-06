# Pre-registration — IT2 (literature replication) and IT3 (pre-registered fallback)

Frozen before any IT2 or IT3 result exists. Not edited afterwards. IT3 is
written here, now, so that its hypotheses cannot be shaped by IT2's outcome;
IT3 runs only if IT2 is REJECTED, and the two are never analysed together.

Everything on historical data is **RETROSPECTIVE RESEARCH**. The 2022-01 →
2026-09 window is a **POST-PUBLICATION RETROSPECTIVE TEST**, not pristine
out-of-sample: the paper was public (online October 2021) and this project has
examined BTC over the window before.

Multiple-testing: the DSR uses the effective independent trial count from
`research/EFFECTIVE-TRIALS.md` (eigenvalue / cluster estimators on validation
daily returns) plus the same estimator applied to each new study's own
configurations. Raw entry count, configuration count and effective count are
always reported together.

---

# IT2 — Bitcoin Intraday Time-Series Momentum Replication

Source: Shen, D., Urquhart, A., & Wang, P. (2022). *Bitcoin intraday
time-series momentum.* Financial Review 57(2), 319–344. doi:10.1111/fire.12290.
Accepted manuscript read in full (`research/paper/`). Their design follows
Gao, Han, Li & Zhou (2018) and Baltussen, Da, Lammers & Martens (2021).

## 0. Exact paper specification (transcribed, not reinterpreted)

| item | paper |
|---|---|
| sample | tick data → 1-minute, BTC/USD on Bitfinex (2013-04-02→), Bitstamp (2013-01-01→, 2011–12 discarded), CEX.IO (2014-07-20→), Coinbase (2014-12-03→), Kraken (2014-01-09→), all to 2020-12-31; pooled across exchanges; every calendar day (≈365 obs/yr — weekends included) |
| trading time | open = each exchange's volume-spike time: Bitfinex 9:05, Bitstamp 9:00, CEX.IO 9:00, Coinbase 9:40, Kraken 9:15 (EST); close = 17:00 EST (start of the CME Bitcoin futures 60-minute break). Times stated as EST; the paper does not discuss daylight-saving handling |
| first half-hour return | `r_ONFH,t = p_{open+30,t} / p_{close,t−1} − 1` — from the previous day's 17:00 close to 30 minutes after the open (eq. 1). Decomposed in §5.1 into overnight `r_ON` (close_{t−1} → open) and `r_FH` (open → open+30) |
| second-to-last half-hour | `r_SLH,t = p_{c−30,t} / p_{c−60,t} − 1` — 16:00 → 16:30 (eq. 2) |
| last half-hour | `r_LH,t = p_{c,t} / p_{c−30,t} − 1` — 16:30 → 17:00 (eq. 3) |
| regressions | pooled OLS `r_LH = α + β_ONFH r_ONFH + ε` (eq. 4) and `+ β_SLH r_SLH` (eq. 5); Newey–West t-statistics; returns annualised in tables; in-sample R²; out-of-sample R² vs the historical-mean forecast with recursively (expanding-window) estimated coefficients (eq. 6) |
| paper results | β_ONFH = 0.968 (NW t 4.38, R² 1.44%, R²_OOS 1.09%); β_SLH = −9.778 (t −10.22); joint 0.937 / −9.720, R² 2.32% |
| volume ranking | days sorted **within each year** into terciles by first-half-hour trading volume, terciles then pooled across years; β_ONFH high 2.013 (t 4.74), medium 1.247 (t 1.78), low 0.430 (n.s.) |
| volatility ranking | days sorted into terciles by first-half-hour volatility computed from 1-minute returns, over the whole sample; β_ONFH high 2.012 (t 6.25), medium 0.586 (t 1.69), low 0.786 (n.s.) |
| timing rule η(r_ONFH) | long the last half-hour if `r_ONFH > 0`, short if `r_ONFH ≤ 0`; position opened at 16:30, closed at 17:00 (eq. 7) |
| timing rule η(r_SLH) | long if `r_SLH < 0`, short if `r_SLH ≥ 0` (eq. 7) |
| timing rule η(both) | long if `r_ONFH > 0 and r_SLH < 0`; short if `r_ONFH ≤ 0 and r_SLH ≥ 0`; otherwise flat (eq. 8) |
| benchmark | "always long" the last half-hour; buy-and-hold |
| paper timing results | η(ONFH) 7.82%/yr, Sharpe 0.65, success 51.6%; η(SLH) 17.3%, 1.72, 56.1%; η(both) 16.7%, 1.72, 58.1%; always-long 6.54%, 0.46 |
| transaction assumptions | zero costs in the main tables; §3.7 break-even cost of η(ONFH) / η(SLH) / η(both) = **3 / 7 / 10 bps** per trade (profit per trade 0.028% / 0.061% / 0.096%); authors state the strategies are "not profitable given that the trading fee of Bitstamp is 25bps" without leverage; leverage tables (2:1, 5:1, 10:1) scale both |
| paper robustness | by year 2013–2020; conditional on sign of r_ONFH (stronger when positive); return decomposition ON vs FH (ON is the stronger predictor, t 5.28 vs 2.09); BTC/JPY and BTC/KRW with local open/close (weaker, 5% level); alternative window 9:30–16:00 EST (β 0.372, t 2.54, weaker); news interaction (n.s.); Corwin–Schultz spread interaction (significant → liquidity-provision explanation); footnote 19: "alternative periods, consistent results" (unspecified) |

## 1. Our data and the differences from the paper (listed before running)

| | paper | this study |
|---|---|---|
| venue | five USD spot exchanges, pooled | Binance **spot BTCUSDT** (2017-08-17→) for the paper-period replication; Binance **USDT-M perpetual BTCUSDT** (2019-09-08→) as the tradable instrument, both single-series (no pooling) |
| quote | USD | USDT |
| granularity | 1-minute | 1-minute klines (`data/fetch-1m.mjs`); boundary prices = close of the 1-minute bar ending at the boundary |
| paper period overlap | 2013–2020 | 2017-08-17 → 2020-12-31 on spot only (≈1,230 days) — the only Phase 1 sample; 2021 is reported separately as the gap year between sample end and publication |
| open time | per-exchange volume spike | **primary: 09:30 ET** — the paper's rule applied to our venue: the Phase 1 audit (`research/AUDIT.md`) shows Binance's volume spike at the 09:30 New York bar (≈1.8× the 09:00 bar). **Paper-defined alternative: 09:00 ET** (the paper's modal time for Bitstamp/CEX.IO). Both reported; only the primary counts for acceptance |
| daylight saving | unstated (EST) | **primary: America/New_York local time (ET, DST-following)** — CME's break follows Chicago local time, so the 17:00 ET boundary moves with DST. **Alternative: fixed UTC−5 all year**. Both reported |
| pooling | across exchanges | none; Newey–West with lag 5 on a single series |
| costs | zero; break-even reported | 0.14% / 0.20% / 0.30% round trip applied to every timing trade |

These four timing definitions (2 opens × 2 DST conventions) are **paper-defined
robustness checks**, not a parameter search. They are registered as trials for
the effective-N count but the acceptance decision is made on the primary only.

## 2. Phase 1 — exact replication (Binance spot, 2017-08-17 → 2020-12-31)

Report, for the primary definition and each alternative: mean and sd of
r_ONFH, r_SLH, r_LH; β_ONFH, NW t, R², R²_OOS (expanding window, first
estimate after 365 days); β_SLH; joint regression; directional hit rate
(sign(r_ONFH) = sign(r_LH)); volume terciles (within-year) and volatility
terciles (1-minute, whole sample) with β and t per tercile; the three timing
rules' annualised return, Sharpe, success rate, gross profit per trade, and
the always-long benchmark. No optimisation.

**Replication verdict** (primary definition): `REPLICATED` if β_ONFH > 0 with
NW t ≥ 1.96 **and** the high-volume tercile β > low-volume tercile β;
`PARTIAL` if β_ONFH > 0 with 1.65 ≤ t < 1.96; else `NOT REPLICATED`. Recorded
as-is.

## 3. Phase 2 — post-publication retrospective test (2022-01-01 → 2026-09-06)

Same rules, frozen. Run on the perpetual (primary, tradable) and on spot
(reported). Report everything in §2 plus the breakdowns: per calendar year
2022, 2023, 2024, 2025, 2026; weekday vs weekend (by ET date); high-volume vs
other terciles; high-volatility vs other terciles; long-signal days vs
short-signal days.

## 4. Phase 3 — economic implementation (perpetual, 2022-01-01 → 2026-09-06)

Timing rule η(r_ONFH), executed as the paper does: enter at the 16:30 ET
price, exit at the 17:00 ET price, every day, 100% of equity, no stop (the
holding period is fixed at 30 minutes). Costs 0.14% / 0.20% / 0.30% RT.
Report trades, gross and net mean per trade, net annualised return, Sharpe,
PF, PF ex-best-5%, max drawdown, longest losing streak, long vs short, weekday
vs weekend, by year, and:

**COST / EXPECTED MOVE RATIO** = round-trip cost ÷ mean |r_LH| over the
period, and round-trip cost ÷ gross mean profit per trade of the rule. Both
reported before any net figure. η(r_SLH) and η(both) are reported identically
but are secondary (the user's hypothesis is ONFH → LH).

## 5. Phase 4 — TradingView

Only if Phases 1–3 pass. Questions to answer, in order: can a 15m/30m chart
of BINANCE:BTCUSDT.P reproduce the 17:00→10:00 and 16:30→17:00 ET boundary
prices exactly (bar closes at :00/:30 ET, `time(timeframe.period, "1630-1700",
"America/New_York")`), the first-half-hour volume and the within-year volume
tercile (needs a rolling per-year sort — feasible with arrays), and the
1-minute volatility tercile (**not** reproducible above 1m on TradingView).
Signal-by-signal reconciliation of engine vs Pine. Any approximation is a new
hypothesis, not an heir to the paper's evidence.

## 6. IT2 acceptance — locked

| gate | rule (primary definition, perpetual unless stated) |
|---|---|
| A1 | Phase 1 verdict is `REPLICATED` (spot, paper period) |
| A2 | Post-publication β_ONFH > 0 with NW t ≥ 1.96 (perpetual), and β_ONFH > 0 on spot |
| A3 | η(r_ONFH) gross mean per trade > 0 with NW t ≥ 1.96 post-publication |
| A4 | η(r_ONFH) net mean per trade > 0 at 0.14% RT |
| A5 | η(r_ONFH) net mean per trade > 0 at 0.20% RT |
| A6 | among 2022–2026 years with ≥ 100 days, ≥ 60% have net (0.14%) > 0, and net > 0 after deleting the best year |
| A7 | PF > 1.0 after removing the best 5% of trades (net, 0.14%) |
| A8 | long-signal days and short-signal days each reported; a direction enters any product only if its own net (0.14%) > 0 with ≥ 100 trades |
| A9 | weekday and weekend reported separately; same product rule as A8 |
| A10 | ≥ 500 trades post-publication |
| A11 | DSR ≥ 0.95 on the post-publication daily strategy returns, N = effective count (prior studies + this study's 12 registered variants reduced by the same estimator) |

Any gate A1–A7, A10, A11 failing → **REJECT**. No repair, no threshold change.
If IT2 is rejected, proceed to IT3 without modification.

Registered IT2 trials: 3 timing rules × 4 timing definitions = 12 strategy
variants (+ regressions, which are not strategies). Recorded in `trials.json`
with `hypothesis: 'IT2'`.

---

# IT3 — Lower-Turnover 1H Short-Horizon Trading (fallback; runs only if IT2 is REJECTED)

Purpose: test whether IT1's economic failure was the 15m tight-stop structure
(planned move too small relative to a 0.14% round trip), by moving to 1H
bars, stops of several percent, no session-end flat and a 6–48 hour expected
holding period.

## 1. Data, execution, splits

Binance USDT-M perpetual BTCUSDT, 1H bars aggregated from the 15m cache
(`data/cache/btc-15m.json`), 2020-01-01 → 2026-09-06. Execution as IT1 §1:
signal on confirmed 1H close, fill at next open, stop/limit active on the
fill bar, broker-emulator path rule, gap fills at the open, cost 0.07%/side
base with 0.10% and 0.15% stress. Sizing 1% of equity per trade on planned
risk, capped at 3× equity. Positions may span nights, weekends and split
boundaries; a position open at a split boundary is assigned to the split of
its signal bar. Splits: development 2020-01-01→2024-01-01, validation
2024-01-01→2025-07-01, test 2025-07-01→2026-09-06.

## 2. Economic feasibility gate (evaluated before any performance metric)

For each candidate, over all signal bars in the development split:
`median round-trip cost (0.14% × fill) ÷ median planned risk (|sigClose − stop|) ≤ 0.10`.
A candidate that fails this is recorded as `INFEASIBLE` and receives no
backtest. This is computed from planned risk alone and cannot leak outcomes.

## 3. Definitions

- `ATR24` = Wilder ATR(24) on 1H bars. `ret24` = close / close[24] − 1.
- `σ24` = standard deviation of the previous 30 **non-overlapping** daily
  (00:00 UTC) 24H returns; undefined for the first 30 days.
- Stop = `sigClose ∓ 2.5 × ATR24`. Target = `sigClose ± 2 × Rp`. Time exit:
  if still open 48 bars after the fill bar, close at the next bar's open.
  One position at a time; no re-entry while in a position.

## 4. Candidates (6 primary, exact)

| # | family | long signal (short mirrors) |
|---|---|---|
| A | 24H range breakout | confirmed 1H close > highest high of the previous 24 bars (excluding the current bar) |
| B | 24H momentum | at the 00:00 UTC bar only: `ret24 > +1.0 × σ24` |
| C | 24H mean reversion | at the 00:00 UTC bar only: `ret24 < −1.0 × σ24` |

× long / short = 6 primaries. Robustness neighbours (3 each, registered, used
only for the neighbourhood gate): n1 stop 2.0 × ATR24; n2 time exit 24 bars;
n3 window: A → 48-bar range, B/C → 0.5 × σ24 threshold. Total 24
configurations. Nothing else is tested.

## 5. Gates

IT1's G1–G9 verbatim (`PRE-REGISTRATION.md` §7), with G4's minimum kept at 60
trades on validation ∪ test, G8 on the three neighbours, and G9 using the
effective N (prior effective count + this study's 24 configurations reduced
by the same estimator). Verdicts `INFEASIBLE` / `INSUFFICIENT` / `REJECTED` /
`RETROSPECTIVE PASS`.

## 6. If IT3 also has no PASS

Stop searching for directional strategies on OHLCV / standard TradingView
data. The only remaining direction is raw market microstructure / order flow,
which requires data and infrastructure outside TradingView; that would be a
new pre-registration, not an extension of this one.
