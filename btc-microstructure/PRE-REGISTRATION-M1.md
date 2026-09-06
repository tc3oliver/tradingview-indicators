# Study M1 — BTC raw trade microstructure: does aggressor flow predict short-horizon returns?

**Frozen 2026-09-06. Committed before the first H1 or H2 estimate was produced.**
Nothing below may be edited once a result exists. If something here turns out to be
wrong or unworkable, it is recorded as a deviation in the research log, not corrected
here.

This study asks one question and refuses to ask a second one until the first is
answered: **is there directional information in aggressive buy/sell trade flow?**
No strategy, no stop, no target, no position size is designed until that question
has a yes. If the answer is no, M1 is REJECTED and nothing is built.

Four earlier studies — TP1 (4H), IT1 (15m), IT2 (literature replication), IT3 (1H)
— rejected every directional rule they tested on OHLCV data. M1 is a deliberate
change of data domain, not another parameter set. It is not a rescue attempt for
any of them, and no rule, indicator or threshold from them appears here.

---

## 0. Preserved evidence

The negative verdicts of the earlier studies stand unmodified. Commits verified
present before M1 began:

| commit | what |
|---|---|
| `ab5f599` | IT1 pre-registration |
| `73e08b3` | IT1 result: 0 of 36 pass |
| `b2ac11d` | DSR effective-trial correction; IT2 + IT3 pre-registration |
| `22c93e5` | IT2 not replicated; IT3 6 of 6 rejected |

M1 lives in its own directory (`btc-microstructure/`) and writes nothing outside it.

---

## 1. Data

### 1.1 Sources

| role | source | period |
|---|---|---|
| **primary venue** | Binance USD-M futures BTCUSDT | 2020-01-01 → 2026-09-05 |
| venue robustness only | Binance spot BTCUSDT | same |
| raw trade ground truth | Binance public archives, `data/futures/um/daily/aggTrades/` and `data/spot/daily/aggTrades/` | 34 futures days, 7 spot days (stratified, list fixed in `data/fetch-aggtrades.mjs`) |

The futures aggTrades archives begin 2019-12-31, which is why the sample starts
2020-01-01: every day in the sample has a raw archive behind it.

### 1.2 Aggressor definition

For each trade: `is_buyer_maker = false` → the buyer was the taker → **aggressive
buy**; `is_buyer_maker = true` → **aggressive sell**. Signed flow is measured in
**quote notional** (USDT), i.e. `price × quantity`, not in contracts.

### 1.3 Where the numbers actually come from — declared deviation

The user's specification names raw aggTrades as the primary source. Seven years of
BTCUSDT futures aggTrades is roughly 80 GB, so the full-sample 5-minute features are
computed instead from the **5m klines' taker-buy split** (`takerBuyQuoteAssetVolume`
and `quoteAssetVolume`), which is the exchange's own aggregation of exactly the same
trade stream:

```
aggressive buy quote  = tbq
aggressive sell quote = qv - tbq
```

This is a deviation and is treated as one. It is licensed only by the reconciliation
in [`research/AUDIT-M1.md`](./research/AUDIT-M1.md), run before this document was
written, over 9,788 5-minute bars rebuilt from 53.2 million raw trades:

- median relative error between the raw aggregation and the kline split: **4e-16**;
- p99 absolute AFI difference: **1.7e-3**, under 1% of one AFI standard deviation;
- the same comparison with the maker side flipped has median error 0.15 — the
  aggressor mapping is verified, not assumed;
- the only large disagreements are places where the **raw archive** is the defective
  source: it starts a few hundred ms into each UTC day, and it is missing 557,026
  aggTrade ids at 2021-05-19 13:15 UTC.

**Limit of the licence.** This covers aggregate signed notional per 5m bar and
nothing else. Any future hypothesis needing trade size distribution, individual sweep
size, or sub-5-minute timing must pull raw aggTrades; this reconciliation does not
transfer to it.

### 1.4 Integrity gate

The audit had to be clean before this document was written. It was, with the six
findings listed in its "Findings and how each is resolved" section — all either
resolved (use the more complete source) or bounded and stated. Zero duplicate trade
ids, zero out-of-order timestamps, zero trades outside their archive's day, archive
day boundaries chain by trade id, 1m OHLC rebuilt from raw trades matches Binance's
own 1m klines outside the boundary-attribution cases described there.

### 1.5 Freeze

| item | value |
|---|---|
| freeze date | 2026-09-06 (this commit) |
| dataset cutoff | `2026-09-06T00:00:00Z` — last in-sample 5m bar opens `2026-09-05T23:55:00Z` |
| futures kline schema | `t,o,h,l,c,v,qv,n,tbb,tbq` from `fapi/v1/klines` fields 0,1,2,3,4,5,7,8,9,10 |
| futures aggTrades schema | `agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker` (7 columns) |
| spot aggTrades schema | the same plus a trailing `is_best_match` (8 columns) |
| feature definition | `research/features.mjs` sha256 `e255ec79c61415a81e7b013d7059ddc700132fcb8b67b13863aa35f5c4a7264e` |
| estimators | `research/stats.mjs` sha256 `6c9683e2662fc59b925a61f67646b1d076ab7538e6247a403c3e27ea02ea76ee` |
| `btc-5m-perp.json` | sha256 `1b70c85bf965f09c9a1912bef587eb67126d5a9062a0a258213e080620484c8e` (702,720 bars, 0 grid gaps) |
| `btc-5m-spot.json` | sha256 `d5121299b463aebb41efe807562435eddaaf9e0fb80351ad7133b06c97f39c12` (702,254 bars, 15 grid gaps) |
| `aggtrades-perp.json` | sha256 `c45ae9cd7d2cf1ab9fea434fdaf2f464500e3d5be083da1ad92e300910deaef9` |
| `aggtrades-spot.json` | sha256 `42f9a8dcc449e25e6fd146100c2750516bd6589aa06823d6a1c821d31887912b` |

Everything up to the cutoff is **RETROSPECTIVE — NEW DATA DOMAIN**. It is not
pristine out-of-sample: the domain is new to this repository, the history is not.

Bars after the cutoff are **PROSPECTIVE** and are captured by
`data/prospective.mjs`, which writes to a separate file and stamps every append with
the wall-clock time it ran. Prospective status is a property of when a bar was
recorded, not of the date on it; a bar collected in one bulk backfill months later is
not prospective and the append log will say so. No retrospective bar is ever moved
into that file.

---

## 2. Features

Computed on the 5m bar grid. `research/features.mjs`, hashed above.

| symbol | definition |
|---|---|
| `AFI_t` | `(aggressiveBuyQuote − aggressiveSellQuote) / (aggressiveBuyQuote + aggressiveSellQuote)` over bar `t`, i.e. `(2·tbq − qv) / qv`. Range [−1, 1] |
| `ret5_t` | `log(close_t / close_{t−1})` |
| `rv5_t` | standard deviation of the last 12 `ret5` values (trailing one hour), computed on bars `t−11 … t` |
| `lnqv_t` | `log(max(1, qv_t))` |
| `mod_t` | minute-of-day bucket, `floor((t mod 86400000) / 300000)`, 0…287 |
| `fwd_t(h)` | `log(close_{t+h} / close_t)` — the target |

A bar is usable only if the preceding 12 bars and the following `h` bars are an
unbroken 5m run, `qv_t > 0`, and every feature is finite. Gaps are never bridged.

`AFI_t` and `ret5_t` are both known at the close of bar `t`; `fwd_t(h)` starts at that
same close. This measures **information**, not tradability — no execution is assumed
at the signal price. Tradability is a separate question, answered in §7 and §8 with a
next-bar-open fill.

---

## 3. Hypotheses

### H1 — aggressor flow continuation

**Hypothesis: higher `AFI` predicts a higher next-15-minute return (β > 0).**

Primary specification, estimated on the 5m panel:

```
fwd_t(3) = α + β·AFI_t + γ1·ret5_t + γ2·rv5_t + γ3·lnqv_t + δ_{mod_t} + ε_t
```

- `δ_{mod}` is a full set of 288 minute-of-day fixed effects, applied as a within
  transformation (subtract the minute-of-day mean of the sample being estimated) —
  algebraically identical to including the dummies, and the group means are computed
  **inside** the sample being regressed, never across splits.
- Standard errors: Newey–West, Bartlett kernel, **lag 12** (one hour, covering the
  overlap induced by a 3-bar forward return).
- No threshold search, no bucketing, no filtering of bars. The primary estimate is a
  single continuous regression on every usable bar.

Reported: β, HAC standard error, t, 95% CI, within-R², Spearman rank IC of `AFI`
against `fwd(3)`, mean `fwd(3)` per `AFI` decile with the monotonicity of that
sequence, and the top-minus-bottom decile spread. Long-side bars (`AFI > 0`) and
short-side bars (`AFI < 0`) are reported separately as well as pooled.

**A significant negative β does not rescue H1.** H1 as stated is directional. A
reliable negative coefficient would be a different hypothesis (short-horizon flow
reversal) and would require its own pre-registration; it is recorded and not acted on.

### H2 — absorption / price response

**Hypothesis: aggressive flow that fails to move price carries different information
from aggressive flow that does move price.**

Primary specification:

```
fwd_t(3) = α + β1·AFI_t + β2·ret5_t + β3·(AFI_t × ret5_t) + γ2·rv5_t + γ3·lnqv_t + δ_{mod_t} + ε_t
```

The hypothesis is about `β3`. Sign is **not** pre-committed in one direction: the
absorption story predicts `β3 < 0` (flow with an aligned price move continues less, or
reverses, relative to flow that was absorbed), the momentum story predicts `β3 > 0`.
Either is a result; the test is two-sided and the doubling of the significance
threshold that implies is already carried by the multiple-testing correction in I7.

Alongside the interaction, four pre-specified cells, so the effect is legible without
reading a coefficient:

| cell | condition |
|---|---|
| absorbed buying | `AFI_t` in the top decile **and** `ret5_t ≤ 0` |
| aligned buying | `AFI_t` in the top decile **and** `ret5_t > 0` |
| absorbed selling | `AFI_t` in the bottom decile **and** `ret5_t ≥ 0` |
| aligned selling | `AFI_t` in the bottom decile **and** `ret5_t < 0` |

Decile breakpoints are estimated **on the development split only** and applied
unchanged to validation and test. Each cell reports n, mean `fwd(3)`, and a
Newey–West t of that mean (lag 12).

---

## 4. Trials

| | count |
|---|---|
| primary configurations | **2** — H1 and H2, 15m horizon, futures |
| robustness horizons | 5m (`h = 1`) and 30m (`h = 6`), both hypotheses → 4 |
| venue robustness | spot, both hypotheses, all three horizons → 6 |
| **total configurations** | **12** |
| raw registry entries (configuration × split) | **36** |

The 15m horizon on futures is the acceptance primary. 5m and 30m are **not**
alternative candidates: they cannot be promoted, and a pass at 5m or 30m with a fail
at 15m is a fail. Spot cannot be used to re-specify anything on futures.

Splits are not trials. Effective independent trials are estimated after the run from
the correlation of the twelve configurations' per-bar signal series, using the same
code as the earlier studies (`effectiveN`: Li & Ji eigenvalue estimator, and
single-linkage clusters at |ρ| ≥ 0.5, taking the larger), and added to the running
cumulative total (849 raw entries / 291 configurations / **115 effective** after IT3).
Every configuration is written to `trials.json` before any gate is evaluated.

---

## 5. Chronological splits

Fixed here, before any outcome was seen.

| split | period | approx. 5m bars |
|---|---|---|
| development | 2020-01-01 → 2022-12-31 | 315,648 |
| validation | 2023-01-01 → 2024-12-31 | 210,528 |
| locked retrospective test | 2025-01-01 → 2026-09-05 | 176,544 |

Development is where anything descriptive may be looked at, including the decile
breakpoints. Validation and test are read once, at the gate.

---

## 6. Information gate

H1 and H2 are each evaluated against all seven. **Any failure rejects that
hypothesis.** No gate may be relaxed, re-weighted, or replaced after seeing a result.

| id | requirement |
|---|---|
| **I1** | the primary 15m β (H1) / β3 (H2) has the same sign in development, validation and test |
| **I2** | validation and test each give \|t\| ≥ 2.0 on the primary specification, with the sign of I1 |
| **I3** | pooled validation ∪ test \|t\| exceeds the multiple-testing threshold `Φ⁻¹(1 − 0.05 / (2·N_eff))`, where `N_eff` is the cumulative effective trial count across every study in this repository including M1 |
| **I4** | year stability: the primary β has the I1 sign in at least 5 of the 7 calendar years 2020–2026, and dropping the single best year leaves pooled validation ∪ test \|t\| ≥ 2.0 |
| **I5** | monotonicity: across the 10 `AFI` deciles on validation ∪ test, the Spearman correlation between decile index and mean `fwd(3)` is ≥ 0.7 in absolute value with the I1 sign, and the top decile differs from the bottom decile in that direction |
| **I6** | robustness to extremes: removing the 5% of observations with the largest \|`fwd(3)`\| leaves the I1 sign and \|t\| ≥ 2.0 on validation ∪ test |
| **I7** | venue compatibility: the spot 15m primary β has the same sign on validation ∪ test. Spot is a consistency check only and cannot be used to modify the futures specification |

If either hypothesis fails, it is REJECTED and no strategy is built from it. If both
fail, **M1 is REJECTED** and the study stops at §6 — §7 and §8 are not run.

---

## 7. Economic gate

Only reached if the information gate passes. Reported before any strategy exists:

- **gross expected move**: mean \|`fwd(3)`\| on the signal bars, and the mean signed
  `fwd(3)` conditioned on the signal, both on validation ∪ test;
- **round-trip cost**: base 0.14%, stress 0.20% and 0.30%, taker both sides including
  slippage, the same schedule as IT1/IT2/IT3;
- **COST / EXPECTED EDGE** = round-trip cost ÷ mean signed `fwd(3)` per signal. This is
  the ratio that killed IT1 (0.1–0.5 R per trade) and IT2 (14.0). It is reported at
  all three cost levels.

Rules, in order:

| id | rule |
|---|---|
| **E1** | if after-cost expectancy per signal at **0.14%** is ≤ 0 → **REJECT**, no strategy |
| **E2** | if the edge is positive at 0.14% but destroyed at **0.20%** → mark **FRAGILE**; recorded, not productionised |
| **E3** | statistical significance is not a substitute for E1. A significant β with a non-positive after-cost expectancy is a REJECT |

---

## 8. Minimal implementation

Only if §6 and §7 both pass. Deliberately the least flexible implementation that
matches the research specification, so that the first economic test is of the finding
and not of a search over exits:

- signal on the **confirmed close** of bar `t`;
- fill at the **open of bar `t+1`**;
- **fixed holding horizon** of 3 bars, matching the primary target;
- exit at the **open of bar `t+4`**;
- no stop, no target, no trailing, no filter, no sizing rule;
- direction: long when `AFI_t` is in the top development decile, short when in the
  bottom development decile; nothing otherwise.

Costs at 0.14% / 0.20% / 0.30% round trip. **No grid search over stops or targets.**
If the simplest version is not profitable after 0.14%, M1 is REJECTED — a version
that only works with a tuned exit is a different, unregistered study.

## 9. What is not allowed in M1

Risk management, stop placement, take-profit, trade suppression, signal blending,
regime filters and position sizing are **out of scope**. Each would be its own
pre-registered study, and only after §8 passes. Nothing from TP1, IT1, IT2 or IT3
appears here: no EMA, RSI, MACD, breakout, pullback, VWAP, session sweep, candle
pattern, or 1H/4H parameter set.

No Pine `strategy()` is promised. If a raw-microstructure signal passes everything
above, the product is an external realtime signal engine, because TradingView cannot
serve the underlying data. A Pine approximation would be a new hypothesis needing its
own validation and would inherit none of the evidence collected here.

---

## 10. If M1 fails — M2

Fixed here so the next direction is not chosen by M1's outcome.

**M2 = prospective order-book microstructure.** There is no multi-year reliable L2
history for this venue that we own, so M2's primary evidence must come from capture
that starts after its own freeze:

- capture Binance depth snapshots + WebSocket `depthUpdate` diffs + `aggTrade`, and
  maintain a local reconstructed order book with sequence-number validation;
- candidate quantities, none of them tested before M2 is pre-registered: bid/ask depth
  imbalance, microprice, spread, liquidity withdrawal, queue pressure, and the
  interaction of trade flow with the book;
- any purchased third-party historical L2 data is recorded separately with vendor,
  schema and coverage, and is never merged into the prospective sample.

M2 is not started inside M1 and does not reuse M1's acceptance thresholds without
restating them.

---

## 11. Completion standard

M1 is complete when it has answered, with evidence, whether raw aggressive trade flow
carries tradable short-horizon information. A LONG/SHORT output is not the completion
standard, and no PASS will be manufactured to produce one.
