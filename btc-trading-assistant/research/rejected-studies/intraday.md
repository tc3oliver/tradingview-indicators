# Rejected: intraday and short-horizon directional strategies (IT1, IT2, IT3)

**Read this before proposing any intraday setup.** Three pre-registered studies on
Binance BTCUSDT, 2020-01 → 2026-09, tested and rejected the following. They are
not open questions; re-testing them is repeating work that has already been done
and logged:

- **Opening-range breakout (ORB)** — London and New York, with and without a
  relative-volume filter, with and without a 1H-trend filter, long and short.
- **Liquidity sweep & reclaim** — previous-day, Asia and London highs/lows.
- **Daily-VWAP pullback / reclaim** — London and New York.
- **Session breakout in general at 15m** with 2R targets and structural stops.
- **Intraday time-series momentum** (first-half-hour return → last-half-hour
  return), i.e. the published Shen–Urquhart–Wang effect.
- **1H range breakout, 24H momentum and 24H mean reversion** with 2.5-ATR stops.

Nothing passed. No `strategy()` was ever built, and all executable strategy code
from these studies has been deleted. This file is the whole surviving record.

Source projects (deleted; git history is the archive):
`btc-intraday-trade-planner/`. Commits:

| commit | subject |
|---|---|
| `ab5f599` | Pre-register the BTC Intraday Trade Planner study (IT1) with its seasonality audit |
| `73e08b3` | Study IT1 result: 0 of 36 intraday candidates pass; no intraday strategy is built |
| `b2ac11d` | Correct the DSR trial count to effective independent trials; pre-register IT2 (paper replication) and IT3 (1H fallback) |
| `22c93e5` | IT2 (paper replication) not replicated, IT3 (1H fallback) 6/6 rejected; no strategy is built |

All three studies are **retrospective research**. Nothing in them is
out-of-sample; the same BTC 2020–2026 window had already been examined by the 4H
studies in this repo.

---

## 0. Shared method (IT1 and IT3)

| item | value |
|---|---|
| instrument | Binance USDT-M perpetual BTCUSDT (IT2 Phase 1 uses Binance **spot**) |
| data | 15m klines, 2020-01-01 → 2026-09-06, 234,240 bars, no grid gaps |
| execution | signal on confirmed close → fill at **next bar's open**; stop/limit active on the fill bar; gap fills at the open |
| same-bar TP/SL | TradingView broker-emulator path rule: `high − open ≤ open − low` ⇒ open→high→low→close, else open→low→high→close |
| cost | base **0.07%/side = 0.14% round trip** (0.05% taker + 0.02% slippage), applied to notional at each fill; stress 0.20% and 0.30% RT |
| sizing | `qty = min(1% × equity / Rp, 3 × equity / fill)`, equity = realised cash, start 10,000 |
| splits | development 2020-01-01→2024-01-01 · validation 2024-01-01→2025-07-01 · locked test 2025-07-01→2026-09-06; trades assigned by signal bar |

Gates G1–G9, frozen before any result, evaluated on validation ∪ test:

| gate | rule |
|---|---|
| G1 | expectancy in R after base cost > 0 in development **and** validation **and** test, each separately |
| G2 | profit factor ≥ 1.20 |
| G3 | PF > 1.0 after removing the best 5% of trades |
| G4 | ≥ 60 trades, else verdict is `INSUFFICIENT` regardless of the rest |
| G5 | among years with ≥ 10 trades, ≥ 50% have net R > 0, **and** net R > 0 after deleting the best year |
| G6 | largest single winner < 25% of gross profit |
| G7 | expectancy in R > 0 at 0.20% round-trip cost |
| G8 | ≥ 2 of the 3 pre-registered robustness neighbours have expectancy in R > 0 |
| G9 | Deflated Sharpe Ratio ≥ 0.95 against the effective trial count (§4) |

Verdict vocabulary: `INFEASIBLE` · `INSUFFICIENT` · `REJECTED` ·
`RETROSPECTIVE PASS`. No scores, no confidence percentages. Thresholds were
never moved after results existed.

---

## 1. IT1 — 15m opening-range breakout / sweep & reclaim / VWAP reclaim

Pre-registered `ab5f599`; result `73e08b3`.

### 1.1 Pre-registered logic

Notation: `sigClose` = close of the signal bar; `Rp = |sigClose − stop|`;
`buf = 0.10 × ATR14`; target `TP = sigClose ± 2·Rp`. Shorts mirror longs.
Sessions are defined in **local time with DST** (see §3), one trade per session
per configuration, one position at a time, flat at session end (closed at the
next bar's open). Levels are all non-repainting.

| family | long signal | stop |
|---|---|---|
| **A. ORB** (London 08:00–09:00 local, NY 09:30–10:30 local; OR = first 4 bars) | first in-session bar after the OR completes with `close > OR-H` | `OR-L − buf` |
| **A′. ORB + RVOL** | same, plus `RVOL_OR ≥ 1.0` (OR quote volume ÷ median OR quote volume of the previous 20 **same-session** sessions) | `OR-L − buf` |
| **B. Sweep & reclaim** (level ∈ {previous-day, Asia, London}) | in-session bar `i` with `close_i > L` where some bar `k ∈ [i−7, i]` in the same session had `low_k < L`; first such bar | `lowest(low, 8) − buf` |
| **C. VWAP reclaim** (daily VWAP anchored 00:00 UTC) | `close_i > vwap_i` and `close_{i−1} ≤ vwap_{i−1}`; first such bar | `lowest(low, 8) − buf` |

Context increment `+1H`: signal additionally requires the previous completed 1H
close above (long) / below (short) its 50-EMA. Applied to every base candidate
except the ORB-RVOL pair.

Sessions: ASIA `Asia/Tokyo` 09:00–15:00 (levels only, no signals),
LONDON `Europe/London` 08:00–16:30, NY `America/New_York` 09:30–16:00.
Sweep pairings: PD@LONDON, PD@NY, ASIA@LONDON, LONDON@NY (the last only after
London has closed).

### 1.2 Candidate count — verified against `trials.json`

| | count |
|---|---|
| primary candidates | **36** (4 ORB base + 4 ORB-RVOL + 4 ORB+1H + 8 SWEEP + 8 SWEEP+1H + 4 VWAP + 4 VWAP+1H) |
| robustness neighbours (3 per primary) | **108** (n1 `buf = 0.25 × ATR`; n2 scale 50% out at 1R then 2R; n3 shorter window — OR of 3 bars, or lookback 12) |
| configurations | 144 |
| registry entries (144 × 3 splits) | **432** |
| prior entries from sibling studies | 333 (45 regime engine + 288 4H trade planner) |
| DSR N as originally run | 765 (later corrected — §4) |

### 1.3 Result

**0 of 36 passed. 31 REJECTED, 5 INSUFFICIENT** (the five are the low-count
`SWEEP:PD@LONDON ±1H`, `SWEEP:PD@NY ±1H` and `SWEEP:LONDON@NY short +1H` cells,
n = 37–54 < 60). Neighbours: of the 216 neighbour split-entries on
validation/test, **18 are positive and 198 are negative** — verified by direct
recount of the registry.

Every single primary failed G1, G2, G3, G5, G7 and G9. Only one candidate
(`ORB@NY short +1H`) also cleared G8.

**Family summary, validation ∪ test, at 0.14% RT:**

| family | n range | **gross** expR | median planned risk | cost in R | **net** expR |
|---|---|---|---|---|---|
| ORB (London, NY, ±RVOL, ±1H) | 147–525 | −0.10 … +0.12 R | 70–196 bp | 0.08–0.23 R | −0.26 … +0.03 R |
| Sweep & reclaim (PD / Asia / London) | 37–369 | −0.26 … +0.20 R | 43–157 bp | 0.19–0.48 R | −0.65 … −0.08 R |
| VWAP reclaim (London, NY, ±1H) | 168–536 | −0.00 … +0.13 R | 54–103 bp | 0.17–0.32 R | −0.27 … −0.08 R |

**Worst and best cells (net expR, validation ∪ test):**

| candidate | n | net expR | PF | Sharpe | verdict |
|---|---|---|---|---|---|
| `ORB@NY short +1H` (best) | 266 | **+0.03** | 1.12 | 0.39 | REJECTED — G1 (−0.04 dev), G2, G3, G5, G7, G9 |
| `ORB@NY short` | 342 | −0.01 | 0.97 | −0.13 | REJECTED |
| `ORB:RVOL@NY long` | 147 | −0.01 | 0.95 | −0.13 | REJECTED |
| `VWAP@NY short` | 403 | −0.10 | 0.81 | −1.09 | REJECTED |
| `ORB@LONDON long` | 519 | −0.24 | 0.66 | −2.69 | REJECTED |
| `SWEEP:ASIA@LONDON long` (worst) | 347 | **−0.65** | 0.34 | −4.54 | REJECTED |

### 1.4 Economics — why they failed

1. **No gross edge.** Before any cost the 36 candidates spread over
   −0.26 … +0.20 R with 2R targets and structural stops; win rates 31–56%. The
   break-even win rate at a 2:1 payoff is 33%. This is what a random-walk entry
   looks like.
2. **Cost is the entire net line and cannot be engineered away.** With planned
   risk of 40–200 bp, a 0.14% round trip is **0.1–0.5 R per trade**. The
   tightest-stop family (sweep & reclaim, structural stop sometimes 5 bp from
   entry) is worst precisely because a fixed fee becomes a 2–3 R loss there.
   NY (median risk 145–196 bp) nets −0.01 … +0.03 R while London (70–90 bp)
   nets −0.18 … −0.26 R — that ordering is the cost ratio, not an edge.
3. **The noise floor is far above anything found.** Validation Sharpes of the
   144 configurations run −5.04 … +1.24 (sd 1.39). The expected best Sharpe of
   765 zero-edge trials at that dispersion is **4.42**; nothing came within a
   factor of three. **DSR = 0.000 for every candidate**, and it stays 0.000
   under the corrected N = 92 (SR0 3.48).

Filters did not rescue anything: RVOL confirmation moved ORB@NY from
−0.07 → −0.01 R (long) and −0.01 → −0.01 R (short) and made ORB@London worse;
the 1H-trend context raised gross expectancy by ~0.05–0.10 R on some cells while
cutting trade counts by 20–80%, never enough to clear costs.

### 1.5 Effective trials (IT1's own contribution)

432 raw entries → 144 configurations → **55 effective** (eigenvalue estimator
55.0; single-linkage clusters 22; mean |ρ| 0.11 — the larger is used).

### 1.6 Rejection reason (one line)

No gross edge at 15m, and a 0.14% round trip is 10–50% of planned risk, so every
family is net negative; DSR 0.000 against any trial count.

---

## 2. IT2 — replication of Shen, Urquhart & Wang (2022)

Pre-registered `b2ac11d` (before any IT2 result existed); result `22c93e5`.

**Citation (exact, from `research/paper/SOURCE.md`):**

> Shen, D., Urquhart, A., & Wang, P. (2022). *Bitcoin intraday time-series
> momentum.* Financial Review 57(2), 319–344. doi:10.1111/fire.12290

Accepted manuscript (open access, read in full before designing the test):
`https://centaur.reading.ac.uk/100181/3/21Sep2021Bitcoin%20Intraday%20Time-Series%20Momentum.R2.pdf`
The PDF itself was never committed (copyright).

### 2.1 The paper's specification, transcribed

Trading day runs from each exchange's volume-spike open (09:00–09:40 EST) to
17:00 EST (the start of the CME Bitcoin futures 60-minute break).

- `r_ONFH = p_{open+30,t} / p_{close,t−1} − 1` (previous 17:00 close → 30 min after open)
- `r_SLH  = p_{c−30,t} / p_{c−60,t} − 1` (16:00 → 16:30)
- `r_LH   = p_{c,t} / p_{c−30,t} − 1` (16:30 → 17:00)

Pooled OLS `r_LH = α + β_ONFH·r_ONFH + ε` across five USD spot exchanges
(Bitfinex, Bitstamp, CEX.IO, Coinbase, Kraken), 2013–2020, Newey–West t.
Timing rule η(r_ONFH): long the last half-hour if `r_ONFH > 0`, short otherwise,
opened 16:30, closed 17:00.

Paper's headline results: β_ONFH **0.968 (NW t 4.38)**, R² 1.44%, R²_OOS 1.09%;
β_SLH −9.778 (t −10.22); high-volume tercile β 2.013 (t 4.74), high-volatility
tercile β 2.012 (t 6.25); η(ONFH) 7.82%/yr, Sharpe 0.65, success 51.6%.
Critically, the paper's own §3.7 reports profit per trade of **0.028%** and a
**break-even cost of 3 bps**, and the authors state the strategies are "not
profitable given that the trading fee of Bitstamp is 25bps" without leverage.

### 2.2 Pre-registered design

Phase 1 replicates on Binance **spot** over the paper's own period
(2017-08-17 → 2020-12-31, the overlap available on this venue). Phase 2 is a
**post-publication retrospective test** on the perpetual, 2022-01-01 →
2026-09-06 (the paper went online October 2021). Phase 3 is the economic
implementation. Four timing definitions were registered as paper-defined
robustness checks — 09:30 ET (primary, chosen because the Phase 1 audit shows
Binance's volume spike at the 09:30 NY bar, ≈1.8× the 09:00 bar) vs 09:00 ET,
each with DST-following ET (primary) vs fixed UTC−5. **Only the primary counts
for acceptance.** Registered trials: 3 rules × 4 definitions = **12**.

Acceptance gates A1–A11 (replication verdict, post-publication significance,
gross and net per-trade significance at 0.14% and 0.20% RT, year consistency,
PF ex-best-5%, direction and weekday splits, ≥ 500 trades, DSR ≥ 0.95).

### 2.3 Result: **REJECT — NOT REPLICATED.** Failed A1, A2, A3, A4, A5, A6, A7, A11 (A10 passed)

**Phase 1 — paper's own period, Binance spot, n = 1,225:**

| | paper | this study (primary) |
|---|---|---|
| β_ONFH (NW t) | 0.968 (**4.38**) | 0.003 (**0.25**) |
| R² / R²_OOS | 1.44% / 1.09% | 0.02% / −0.84% |
| β_SLH (t) | −9.778 (−10.22) | 0.02 (0.35) |
| high-volume tercile β (t) | 2.013 (4.74) | −0.005 (−0.33) |
| high-volatility tercile β (t) | 2.012 (6.25) | 0.003 (0.19) |
| η(ONFH) success / profit per trade | 51.6% / 0.028% | 50.9% / 0.003% |

The three alternative timing definitions give t between 0.39 and 0.53.
Descriptive statistics match the paper's Table 2 in scale (r_ONFH sd 3.3% vs
3.6%; r_LH sd 0.60% vs 0.83%), so the sample is the right object — the effect is
simply absent on this venue. **Power check:** at the paper's R² of 1.44% and
n = 1,225 the expected t is ≈ 4.2. Observed 0.25. (β is not on the paper's scale
because the paper annualises returns before regressing; t and R² are scale-free
and are the comparison.)

**Gap year and post-publication:**

| sample | n | β_ONFH (t) | R² | hit rate | η(ONFH) gross/trade | net @0.14% |
|---|---|---|---|---|---|---|
| 2021 spot / perp | 365 | 0.006 (0.63) / 0.005 (0.59) | 0.10% / 0.09% | 50.7% / 49.3% | −0.040% / −0.037% | −0.180% / −0.177% |
| 2022–26 perp, primary | 1,709 | 0.005 (**0.69**) | 0.07% | 51.7% | **+0.010%** | **−0.130%** |
| 2022–26 spot, primary | 1,708 | 0.005 (0.64) | 0.06% | 51.8% | +0.011% | −0.129% |
| 2022–26 perp, fixed UTC−5 | 1,709 | 0.017 (2.37) | 0.74% | 50.4% | +0.011% | −0.129% |

By year (perp, primary), the β t-statistics are 1.05, 0.28, −0.56, −0.33, 0.27 —
the sign flips twice. Weekday t 0.51, weekend t 0.83. Long-signal days
+0.005%/trade gross, short-signal days +0.015%, high-volume tercile +0.030%
(t 1.64), all other days 0.000%. **Nothing reaches t = 1.96 on the primary
definition in any subset.** The fixed-UTC−5 variants do reach t ≈ 2.4–2.6, but
they are registered robustness checks rather than the primary, and their gross
profit per trade (0.011–0.014%) is economically identical to the primary's —
recorded, not promoted.

### 2.4 Economics — the decisive number

**COST / EXPECTED MOVE RATIO** (perp, 2022–2026, primary):

- 0.14% RT ÷ mean |r_LH| (0.240%) = **0.58**
- 0.14% RT ÷ gross mean profit per trade (0.010%) = **14.0**

The rule's gross edge is **one-fourteenth of the round trip**. The paper's own
break-even was 3 bps; on this venue and period it is 1 bp.

| rule (0.14% RT) | trades | gross/trade | net/trade | ann. net | success | PF | PF ex-5% |
|---|---|---|---|---|---|---|---|
| η(ONFH) | 1,709 | +0.010% | −0.130% | −47% | 27% | 0.35 | 0.15 |
| η(SLH) | 1,709 | −0.002% | −0.142% | −52% | 27% | 0.31 | 0.14 |
| η(both) | 901 | +0.008% | −0.132% | −25% | 28% | 0.34 | 0.14 |
| always long | 1,709 | −0.005% | −0.145% | −53% | 27% | 0.30 | 0.13 |

At zero cost η(ONFH) earns +0.010%/trade (NW t 1.12, Sharpe 0.48, PF 1.09).
Every year 2022–2026 is net negative. Phase 4 (TradingView reconciliation) was
never reached.

### 2.5 Effective trials and rejection reason

12 raw entries = 12 configurations → **9 effective** (eigen 9.0, clusters 7,
mean |ρ| 0.16). Prior effective N 92 → N = 102, SR0 2.31, **DSR 0.000**.

**Two independent reasons, either sufficient.** First, the statistical effect
does not replicate on Binance spot in the paper's own period, with adequate
power, under all four timing definitions. Second, even the paper's *own reported
magnitude* — 0.028% per trade, break-even 3 bps — is an order of magnitude below
a realistic taker round trip, so a replication *success* would still not have
produced a tradable rule; the paper says as much in §3.7. The pooled
five-exchange 2013–2020 result plausibly reflects early-period thin-venue
microstructure (2013–2016 CEX.IO / Kraken, hundreds of BTC/day) that no longer
exists on a 2017+ major venue.

---

## 3. IT3 — 1H lower-turnover fallback

Pre-registered in the same commit `b2ac11d`, **written before IT2 ran** so its
hypotheses could not be shaped by IT2's outcome. It ran only because IT2 was
REJECT (`it3.mjs` reads `results-it2.json` and exits otherwise).

### 3.1 Purpose and pre-registered logic

Purpose: test whether IT1's failure was specifically the 15m tight-stop
structure — planned move too small relative to a 0.14% round trip — by moving to
1H bars, stops of several percent, no session-end flat, and a 6–48 hour holding
period.

1H bars aggregated from the 15m cache. `ATR24` = Wilder ATR(24) on 1H;
`ret24 = close/close[24] − 1`; `σ24` = sd of the previous 30 **non-overlapping**
daily (00:00 UTC) 24H returns. Stop = `sigClose ∓ 2.5 × ATR24`;
target = `sigClose ± 2 × Rp`; time exit at 48 bars after the fill bar; one
position at a time; positions may span nights, weekends and split boundaries.

| # | family | long signal (short mirrors) |
|---|---|---|
| A | 24H range breakout | confirmed 1H close > highest high of the previous 24 bars |
| B | 24H momentum | at the 00:00 UTC bar only: `ret24 > +1.0 × σ24` |
| C | 24H mean reversion | at the 00:00 UTC bar only: `ret24 < −1.0 × σ24` |

× long/short = **6 primaries**, plus 3 neighbours each (n1 stop 2.0×ATR24;
n2 time exit 24 bars; n3 window: A → 48-bar range, B/C → 0.5×σ24) = 24
configurations, 72 registry entries. Verified against `trials.json`.

**Economic feasibility gate (G0)**, evaluated on development-split planned risk
alone, before any performance metric, so it cannot leak outcomes:
`median 0.14% round-trip cost ÷ median planned risk ≤ 0.10`.

### 3.2 Result: **6 of 6 REJECTED**; feasibility 6 of 6 feasible

The design goal was met — cost is 5.0–7.9% of planned risk, versus 10–50% in
IT1 — and the candidates still lose.

| # | candidate | cost ÷ risk (median risk) | n | expR | PF | PF ex-5% | dev / val / test expR | failed |
|---|---|---|---|---|---|---|---|---|
| 1 | A 24H range breakout, long | 0.079 (2.1%) | 401 | −0.06 | 0.91 | 0.75 | +0.05 / −0.01 / −0.12 | G1 G2 G3 G5 G7 G8 G9 |
| 2 | A 24H range breakout, short | 0.070 (2.3%) | 374 | +0.01 | 1.02 | 0.86 | −0.10 / +0.04 / −0.01 | G1 G2 G3 G5 G7 G8 G9 |
| 3 | B 24H momentum, long | 0.057 (2.4%) | 140 | −0.12 | 0.79 | 0.62 | −0.10 / −0.12 / −0.13 | G1 G2 G3 G5 G7 G8 G9 |
| 4 | B 24H momentum, short | 0.050 (2.6%) | 118 | **+0.14** | **1.27** | 1.08 | **−0.13** / +0.09 / +0.21 | **G1 G9** |
| 5 | C 24H mean reversion, long | 0.050 (2.6%) | 122 | −0.18 | 0.70 | 0.51 | +0.03 / −0.08 / −0.31 | G1 G2 G3 G5 G7 G8 G9 |
| 6 | C 24H mean reversion, short | 0.056 (2.4%) | 143 | −0.17 | 0.73 | 0.55 | −0.15 / −0.26 / −0.04 | G1 G2 G3 G5 G7 G8 G9 |

Every candidate is negative in at least two of its three splits; two (B long,
C short) are negative in all three; apart from the near-miss below, none is
positive on validation ∪ test by more than 0.01 R.

**The near-miss — `B short` (24H momentum short).** +0.14 R on validation ∪ test,
PF 1.27, Sharpe 0.71, all three neighbours positive (+0.10 / +0.07 / +0.04),
three positive years. It fails **G1** because it earned **−0.13 R per trade over
154 trades in development (2020–2023)**, and **G9** because its Sharpe 0.71 is
below the 115-effective-trial noise floor SR0 = 1.53 (DSR 0.088). This is the
same shape as the 4H study's near-misses and IT1's `ORB@NY short +1H`: a short
rule whose entire positive record lies in 2024–2026. Per the pre-registration it
is REJECTED and not carried forward.

### 3.3 Effective trials and rejection reason

72 raw entries → 24 configurations → **12 effective** (eigen 12.0, clusters 3,
mean |ρ| 0.25). Cumulative N = 115, SR0 = 1.53 annualised.

**The IT1 diagnosis was correct and it was not the whole story.** Removing cost
as the binding constraint did not produce a profitable rule. **Gross edge, not
cost, is what is missing.**

---

## 4. The DST-correct session seasonality audit

Descriptive Phase 1 work, completed *before* the IT1 pre-registration was frozen
and used only to fix session definitions and the RVOL definition. 234,240 15m
bars, 2020-01-01 → 2026-09-05. (No order-book history exists in this dataset, so
spread/slippage is folded into the per-side cost rate rather than measured.)

**What it corrected, and why it mattered:**

| slot | bars | median $vol (M) | realised vol (ann. %) |
|---|---|---|---|
| 09:30 NY open bar, **summer** (= 13:30 UTC) | 1,150 | 283.0 | 105 |
| 09:30 NY open bar, **winter** (= 14:30 UTC) | 593 | 302.6 | 114 |
| fixed 13:30 UTC bar, all year | 1,743 | 232.3 | 100 |
| fixed 14:30 UTC bar, all year | 1,743 | 243.6 | 91 |
| 03:00 UTC hour (Asia mid-session) | 6,972 | 72.2 | 59 |
| 09:30–10:00 NY (open half-hour) | 3,486 | 271.1 | 100 |

Two conclusions, both adopted into the pre-registration:

1. **Session windows must be defined in local session time, not fixed UTC.** The
   09:30 NY bar behaves identically in summer and winter (283.0M vs 302.6M
   median volume), but *any fixed UTC slot mixes the open bar with an ordinary
   pre-open bar for half the year* — visible as the dilution to 232.3M / 243.6M.
   A fixed-UTC study would have been measuring a blend of two different bars and
   reporting it as one. Implemented via `Intl.DateTimeFormat` per IANA timezone
   (`Asia/Tokyo`, `Europe/London`, `America/New_York`), mirroring Pine's
   `time(timeframe.period, "0800-1630", "Europe/London")`.
2. **Any volume threshold must be relative to the same session and same local
   time-of-day, never a global median.** Median 15m volume in the NY opening
   half-hour is **3.8×** the 03:00 UTC hour. A global RVOL threshold would fire
   on every NY open and almost never in Asia regardless of whether anything
   unusual happened. Implemented as same-slot RVOL: OR quote volume ÷ median OR
   quote volume of the previous 20 sessions **of the same session type**,
   undefined (no signal) until 20 prior sessions exist.

Supporting structure the audit established (all descriptive, no trading rule):
London+NY overlap carries 228.3M median 15m volume at 89% annualised realised
vol against 53.7M / 50% on weekends; NY-only 125.4M / 69%; Asia 78.8M / 65%.
Realised vol by year falls from 91% (2021) to 44–45% (2023, 2025, 2026).

**This part of the design survives the rejections.** Any future intraday work in
this repo must keep local-time sessions and same-slot normalisation; the
alternative is a known measurement error, not a modelling choice.

---

## 5. The effective-trial-count correction and the multiple-testing threshold

### 5.1 What was wrong

IT1 originally computed its Deflated Sharpe Ratio with **N = 765**, obtained by
summing every registry entry: 144 configurations × 3 splits = 432, plus 333
entries from the two sibling studies. Bailey & López de Prado (2014) define N as
the number of **independent** trials, and that count over-states it twice over:
the three splits of one configuration are the same strategy evaluated on
different dates, and each parameter neighbour is a near-copy of its primary.

### 5.2 The method actually used (as stated in `research/EFFECTIVE-TRIALS.md`)

Each configuration's sized equity curve on the **validation** split (the
selection set) is compounded into daily returns and a Pearson correlation matrix
is computed across configurations. **Both** estimators are then applied:

- **Eigenvalue estimator (Li & Ji 2005):**
  `M_eff = Σ_i [ 1(λ_i ≥ 1) + (λ_i − ⌊λ_i⌋) ]` over the correlation matrix's
  eigenvalues.
- **Cluster estimator:** the number of single-linkage clusters at |ρ| ≥ 0.5 — a
  simplified form of the ONC clustering that López de Prado & Lewis (2019) use
  for the same purpose.

**The larger of the two is used per study** (more trials = a harder bar). Splits
are not counted as separate trials. Studies are summed as if independent, which
ignores any correlation between the 4H and 15m searches and is therefore
conservative. The regime-engine study's return series cannot be regenerated from
a common runner, so its raw configuration count is used as an upper bound.
`V[SR]` inside SR0 remains the variance of *all* configurations' validation
Sharpes, not cluster-aggregated, which leaves the dispersion term unchanged from
the original run.

### 5.3 The counts

| study | raw entries | configurations | mean \|ρ\| | eigen M_eff | clusters (\|ρ\|≥0.5) | **effective N used** |
|---|---|---|---|---|---|---|
| IT1 (15m intraday) | 432 | 144 | 0.11 | 55.0 | 22 | **55** |
| TP1 (4H trade planner) | 288 | 96 | 0.34 | 21.0 | 2 | **21** |
| Regime engine | 45 | 15 | n/a | n/a | n/a | **15** (upper bound; series not regenerable) |
| IT2 | 12 | 12 | 0.16 | 9.0 | 7 | **9** |
| IT3 | 72 | 24 | 0.25 | 12.0 | 3 | **12** |
| **cumulative after IT3** | **849** | **291** | | | | **115** |

Verified: 516 entries in `trials.json` (432 + 12 + 72) + 333 prior = 849.

### 5.4 The threshold that followed

The DSR gate (G9 / A11) is `DSR ≥ 0.95`. Operationally this sets a **noise
floor SR0** — the expected maximum annualised Sharpe of N zero-edge trials at
the study's own dispersion — which a candidate's Sharpe must clear before its
DSR can be non-trivial:

| trial count | SR0 (annualised) | context |
|---|---|---|
| N = 765 (raw, IT1 as originally run) | **4.42** | IT1 dispersion, sd of validation Sharpes 1.39 |
| N = 92 (corrected, before IT2/IT3) | **3.48** | IT1 dispersion |
| N = 102 (after IT2) | **2.31** | IT2 daily-return dispersion |
| N = 115 (after IT3) | **1.53** | IT3 dispersion |

SR0 differs across rows because each study contributes its own `V[SR]`; the
count fell from 765 to 115 and the bar fell with it, from 4.42 to 1.53.

**The correction changed no verdict.** IT1's best candidate has DSR 0.000 at
N = 92 exactly as it did at N = 765, and every IT1 primary still fails G1, G2,
G3 and G7 independently of the DSR. IT2's η(ONFH) has DSR 0.000 at N = 102.
IT3's best candidate reaches Sharpe 0.71 against SR0 1.53 — DSR 0.088, less than
half the floor. Across three studies the best observed Sharpe never came within a
factor of two of the noise floor, at any trial count anyone could reasonably
argue for.

---

## 6. Final verdict

**No intraday strategy was built. No `strategy()` was ever written. All
executable strategy code from these studies has been deleted.** Phase 7
(alternative data) never started, because by pre-registration it only runs on
top of a passing price-only setup.

**Ruled out** for BTC at 15m under realistic taker costs: opening-range
breakouts (London, NY, with or without relative-volume or 1H-trend filters),
sweep & reclaim of previous-day / Asia / London highs and lows, and daily-VWAP
reclaims — each with 2R targets, structural stops and session-flat management.
Ruled out at 1H with 2.5-ATR stops: 24H range breakout, 24H momentum and 24H
mean reversion. Ruled out as a published effect: Shen–Urquhart–Wang intraday
time-series momentum, which neither replicates on this venue nor would have been
tradable if it had.

Counting the sibling 4H studies, **four studies on 2020–2026 Binance BTC — TP1
(4H), IT1 (15m), IT3 (1H) and the IT2 literature replication — all fail: 291
configurations, 115 effective trials, zero passes.** Per IT3 §6 of the
pre-registration, the search for directional strategies on OHLCV / standard
TradingView data **stops here**.

**Not tested, therefore not ruled out** (each would need a new pre-registration,
not an extension of these):

- Maker-fee execution via limit entries — needs a fill model this dataset cannot
  support.
- Raw market microstructure / order flow — needs data and infrastructure outside
  TradingView. This is the only remaining direction the pre-registration
  acknowledges.
- The alternative-data factors, which by design only get tested on top of a
  price-only setup that has already passed.

What ships is what shipped before: risk/position sizing, session levels, and
regime context — **none of which claims direction.** These studies are the
reason the intraday product does not claim it either.
