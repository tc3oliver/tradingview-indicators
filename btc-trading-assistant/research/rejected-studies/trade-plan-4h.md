# TP1 — BTC 4H Trade Plan (rejected)

Condensed record of the BTC 4H Trade Planner study. Source directory
`btc-4h-trade-planner/` was deleted after consolidation; git history is the
archive (see §12).

**Verdict: 0 of 96 pre-registered configurations passed. 76 REJECTED, 20
INSUFFICIENT.** The planned `strategy()` was never built. Only the mechanical
Risk Planner arithmetic survives into the product (§11).

Everything below is **RETROSPECTIVE RESEARCH**. The 2020-09 → 2026-09 BTC 4H
series had already been examined by four prior pre-registered hypotheses
(H1–H4) in `btc-4h-regime-engine/`, including the nominal "locked holdout"
2025-07 onward. No period of this study is out-of-sample.

---

## 1. Study identity

| item | value |
|---|---|
| Study id | TP1 |
| Pre-registration | written and committed before the first run, commit `05f7434` |
| Dataset | `btc-4h-regime-engine/data/cache/btc-4h.json` — Binance BTCUSDT perpetual, 4H |
| Bars | 13,164, zero kline gaps |
| Period | 2020-09-01 → 2026-09-03 (start capped by the source dump, not by choice) |
| Engine | `research/engine.mjs` — trade-level (entry price, carried stop, intrabar fill, R multiples), not a per-bar exposure weight |
| Runner | `research/phase45.mjs` — grid + ten gates + DSR |
| Trial registry | 288 entries this study (96 configs × 3 splits) + 45 prior regime-engine entries = 333 |

### Splits

| split | period | role |
|---|---|---|
| Development | 2020-09-01 → 2024-01-01 | model construction |
| Validation | 2024-01-01 → 2025-07-01 | selection |
| Locked test | 2025-07-01 → 2026-09-03 | read once, after selection |

A trade belongs to the split containing its entry bar. A position open at a
split boundary is force-closed at that bar's close, so no trade spans two
splits and no split inherits an unrealised mark. (H3 in the prior project was
materially distorted by exactly that: a positive holdout return carried
entirely by one open position.)

## 2. The 96 configurations

Full factorial, 3 × 4 × 2 × 2 × 2 = 96, declared in advance. No value outside
this table was ever tested — no 1.7/1.8/2.1 ATR, no 15- or 30-bar trail, no
25- or 55-bar Donchian.

| dimension | levels | n |
|---|---|---|
| Bias | **A** daily 200MA · **B** 12-week momentum · **C** both agree | 3 |
| Entry | **pullback20** EMA20 reclaim · **pullback50** EMA50 reclaim · **breakout20** Donchian-20 · **breakout40** Donchian-40 | 4 |
| Initial stop | 1.5 ATR14 · 2.0 ATR14 | 2 |
| Trailing exit | 10-bar extreme · 20-bar extreme | 2 |
| Direction | long · short | 2 |

Long and short are separate models judged separately, never two sides of one
signed variable. A failing short model is deleted, not kept for symmetry.

## 3. Design as actually implemented

### Daily series (bias inputs)

Replicates the frozen Market Radar idiom `main.pine:215`:

```pine
request.security(sym, "1D", [ta.sma(close,200)[1], close[1]/close[85] - 1, int(time[1])],
                 lookahead = barmerge.lookahead_on)
```

`lookahead_on` hands day *D*'s tuple to every 4H bar inside day *D*; the `[1]`
offsets inside the expression mean the tuple only references day *D−1* and
earlier. Net: no lookahead, constant across all six 4H bars of a day. Daily
bars are built from the 4H series on UTC calendar days; the daily close is the
close of the 20:00 UTC bar.

- `dSma200` = 200-day SMA of daily closes through day *D−1*
- `dMom12w` = `dailyClose[D−1] / dailyClose[D−85] − 1` (84 days = 12 weeks)

### Bias (evaluated at every confirmed 4H close)

| id | long | short |
|---|---|---|
| A | `close > dSma200` | `close < dSma200` |
| B | `dMom12w > 0` | `dMom12w < 0` |
| C | A-long and B-long | A-short and B-short |

Warm-up `na` ⇒ NEUTRAL, no entry permitted.

### Entry

Both families require the matching bias at the signal bar's close.

- **Pullback reclaim**, EMA *n* ∈ {20, 50} on 4H closes:
  long `close > ema_n AND close[1] <= ema_n[1]`; short mirrored. The prior
  close on the wrong side *is* the pullback — no depth threshold, no bar-count
  window, no separate reclaim confirmation, because each would be an extra
  swept dimension.
- **Donchian breakout**, *N* ∈ {20, 40}, excluding the current bar:
  long `close > highest(high, N)[1]`; short `close < lowest(low, N)[1]`.

Pine-equivalent indicator implementations: `ema` seeds with `ta.sma(source,
length)` at bar `length−1` and is `na` before it (matching Pine, not the
sibling project's `v[0]` seed); `atr(14)` uses `ta.rma` Wilder smoothing with
`tr = high − low` on the first bar.

### Stop, trail, exit

Fully determined at the close of the signal bar, before the entry fill exists.

| component | rule |
|---|---|
| Entry reference | `sigClose` = close of the signal bar |
| Initial stop | long `sigClose − k × atr14`, short `sigClose + k × atr14`, k ∈ {1.5, 2.0} |
| Trailing exit | long `lowest(low, M)[1]`, short `highest(high, M)[1]`, M ∈ {10, 20}, recomputed each confirmed close |
| Active stop | long `max(initialStop, trailingExit)`, short `min(initialStop, trailingExit)` — the trail only takes over once it passes the initial stop |
| Profit target | none |
| Time stop | none |
| Bias-flip exit | none — stop or trail only |

### Execution model (bar *i* processed in TradingView order)

1. fill an entry signalled at the close of bar *i−1*, at `open[i]`
2. test the stop in force at the close of bar *i−1*; a bar that **gaps
   through** the stop fills at the open, not at the stop price
3. accumulate MAE/MFE, mark equity to `close[i]`
4. ratchet the trail at the confirmed close (the initial stop alone is in force
   during the entry bar — that is the level published as INITIAL INVALIDATION)
5. force-close if the next bar leaves the split or the data ends
6. look for a new signal at the confirmed close

Nothing in step 6 can affect step 1 of the same bar; that is what makes the
engine lookahead-free. One concurrent position per model; a new signal while in
position is ignored, never pyramided.

Sizing: `qty = min(0.01 × cash / |sigClose − initialStop|, cash / fill)` —
1.0% risk of realised equity, notional capped at 1.0× equity (no leverage).
Equity compounds. Metrics are reported in both currency and R multiples,
because a currency result mixes the sizing rule into the edge measurement and
an R result does not.

## 4. Cost assumption

**0.07% per side, 0.14% round trip** = 0.05% Binance futures taker fee +
0.02% assumed slippage. Slippage is folded into commission rather than
expressed separately because Pine's `slippage` input is a tick count, which is
not scale-invariant across a price range running from ~10k to ~120k. This keeps
the research engine and a TradingView `strategy()` bit-comparable. Every number
in this study is after cost; there is no gross-of-cost headline anywhere.

The research log records that gross-vs-net differences are ≈0.02R per trade at
this cost level — **costs were not the killer; the failures are structural.**

## 5. The ten acceptance gates (as pre-registered)

A model is adopted only if it passes **all ten**. Long and short judged
separately.

| # | gate | threshold |
|---|---|---|
| G1 | Expectancy after costs > 0 on **both** validation and locked test | `> 0` each |
| G2 | Profit factor | `≥ 1.20` on validation **and** on locked test |
| G3 | Profit factor after removing the best 5% of trades (validation+test) | `> 1.00` |
| G4 | Independent trades across validation + locked test | `≥ 40`, else **INSUFFICIENT** (never PASS) |
| G5 | Not dependent on one year: of calendar years with ≥ 5 trades, ≥ 50% have positive net R, **and** total net R stays > 0 after deleting the single best year | both |
| G6 | Not dependent on a few winners: largest single winner < 25% of gross profit (validation+test) | `< 25%` |
| G7 | Parameter neighbourhood stable: of the cell's immediate grid neighbours (one of {EMA period / Donchian N, stop k, trail M} moved to its other pre-registered value), ≥ 50% also show positive validation+test expectancy | `≥ 50%` (≥ 2 of 3) |
| G8 | Long and short evaluated separately; a direction that fails is excluded | — |
| G9 | Deflated Sharpe Ratio using the honest registry N | `≥ 0.95` |
| G10 | Beats an exposure-matched, same-direction constant-position baseline over the same period on **both** Sharpe and Calmar | both |

G10's baseline is matched on the model's own realised **average notional
weight**, not on fraction of bars in market: matching on time would hand the
baseline a different position size and prove nothing. This is the control that
killed the prior project's trend filter — halving drawdown is not skill if
simply holding half as much does it for free.

Pre-registered consequence, §6 "If every model fails": *the Trade Plan Engine
is not built. The Pine `strategy()` is not shipped with a rule that failed.*

## 6. Outcome

Verified against `research/results.json` (96 rows) and `research/RESULTS.md`:

| verdict | count |
|---|---|
| RETROSPECTIVE PASS | **0** |
| REJECTED | **76** |
| INSUFFICIENT | **20** |

The brief's counts are correct as stated. Failure frequency across all 96
configurations:

| gate | configs failing |
|---|---|
| G9 (DSR) | 96 |
| G3 (PF ex-best-5%) | 92 |
| G5 (year dependence) | 61 |
| G2 (profit factor) | 58 |
| G1 (expectancy both splits) | 47 |
| G7 (neighbourhood) | 40 |
| G6 (single-winner share) | 39 |
| G10 (matched baseline) | 30 |
| G4 (trade count) | 20 |
| G8 | 0 (separation by construction) |

**Every one of the 96 failed G9.** The 20 INSUFFICIENT cells are 16 shorts and
4 longs: BTC 2024–2026 does not contain 40 independent short setups under bias
A or C. Smallest combined sample in the grid: 25 trades. INSUFFICIENT is a
distinct verdict from REJECTED and neither enters any product.

Four configurations failed **only** G9:

| config | dev n / expR | val expR / PF | test expR / PF | comb n | comb Sharpe | DSR N=96 / N=333 |
|---|---|---|---|---|---|---|
| C pullback50 s1.5 t10 **long** | 76 / **−0.26** | 0.54 / 2.15 | 0.90 / 2.89 | 79 | 1.53 | 0.066 / 0.218 |
| C pullback50 s2.0 t10 **long** | 74 / **−0.25** | 0.40 / 2.06 | 0.65 / 2.70 | 77 | 1.45 | 0.051 / 0.182 |
| A breakout40 s2.0 t20 **long** | 28 / +0.42 | 0.52 / 2.02 | 0.39 / 1.76 | 40 | 0.90 | 0.006 / 0.037 |
| B breakout20 s2.0 t10 **short** | 51 / **−0.08** | 0.53 / 2.66 | 0.20 / 1.44 | 40 | 0.68 | 0.002 / 0.014 |

## 7. Strongest near-miss — `C pullback50 s1.5 t10 long`

Bias C (200MA and 12-week momentum both long) · first confirmed 4H close back
above EMA50 · initial stop 1.5 × ATR14 · 10-bar trailing low.

Combined validation + locked test:

| metric | value |
|---|---|
| Trades | 79 (61 validation, 18 test) |
| Expectancy | +0.623 R/trade |
| Net R | +49.23 |
| Profit factor | 2.32 |
| PF after removing best 5% | 1.088 |
| Sharpe (annualised) | 1.534 |
| Calmar | 1.782 |
| Max drawdown | 10.5% |
| Largest winner share of gross profit | 15.8% |
| Positive neighbours (G7) | 3 of 3 |
| Per-year net R | 2024: +33.8 · 2025: +12.7 · 2026: +2.7 |
| Matched baseline (constant 11.1% long) | Sharpe 0.755, Calmar 0.518 |

**Cleared: G1 ✓ G2 ✓ G3 ✓ G4 ✓ G5 ✓ G6 ✓ G7 ✓ G8 ✓ G10 ✓ — nine of ten.**

**Failed: G9.** DSR = **0.066** against the N=96 selection pool and **0.218**
against the N=333 full registry, versus a threshold of **≥ 0.95**. Not a
marginal miss: the required probability is 14× the observed one on the
selection pool and 4× on the full registry.

The failure restated in Sharpe units: the DSR benchmark `SR₀` — the Sharpe you
expect the *best* of the pool to show with zero true edge — is **2.448
annualised** at N=96 (2.005 at N=333). The observed combined Sharpe is
**1.534**. The best result of the search sits **0.91 annualised Sharpe below
the search's own noise floor.**

Margins on the gates it did clear were also thin where it counts: PF ex-best-5%
of 1.088 against a 1.00 floor means a single trade's removal is worth most of
the cushion.

## 8. Development vs recent-regime instability

Measured: every configuration was run on all three splits, with development
reported for context and never used for selection. Same rule, same parameters,
2020-09 → 2024-01:

`C pullback50 s1.5 t10 long`, development split:

| metric | development (2020–2023) | validation+test (2024–2026) |
|---|---|---|
| Trades | 76 | 79 |
| Expectancy | **−0.264 R** | +0.623 R |
| Profit factor | **0.590** | 2.320 |
| Net R | **−20.05** | +49.23 |
| Sharpe | **−0.745** | +1.534 |
| Max drawdown | 20.0% | 10.5% |
| Win rate | 27.6% | — (41.0% val / 33.3% test) |
| Longest losing streak | 8 | 5 val / 5 test |

Three of the four one-gate misses lose money in development. The entire
positive record of the best configuration comes from 2024–2026 — one long bull
regime — and was surfaced by scanning 96 cells. That is precisely what G9
exists to catch.

The instability is structural, not confined to one cell. Long-side mean
expectancy by design choice, development vs combined recent:

| comparison | development | validation+test |
|---|---|---|
| pullback entries (24 long cells) | −0.113 R | +0.344 R |
| breakout entries (24 long cells) | +0.298 R | +0.315 R |
| 10-bar trail (24 long cells) | +0.024 R | +0.344 R |
| 20-bar trail (24 long cells) | +0.162 R | +0.315 R |

On recent data pullbacks beat breakouts and 10-bar trails beat 20-bar trails;
in development **both orderings reverse**. Recorded as description of the data,
not as a tradable claim.

## 9. Deflated Sharpe Ratio

Bailey & López de Prado (2014), same formulas as
`btc-4h-regime-engine/research/dsr.mjs`, computed on per-bar Sharpes of the
combined validation+test bar-return series, with skew (`g3`) and kurtosis
(`g4`) of that series in the denominator.

```
SR₀   = σ(pool) · [ (1−γ)·Z(1 − 1/N) + γ·Z(1 − 1/(N·e)) ]      γ = Euler–Mascheroni
DSR   = Φ( (SR − SR₀)·√(T−1) / √(1 − g3·SR + ((g4−1)/4)·SR²) )
```

Two honest pools, both reported for every configuration:

| pool | N | derivation | SR₀ (annualised) |
|---|---|---|---|
| Selection pool | **96** | the 288 TP1 registry entries filtered to `selectionSet: true`, i.e. the validation split of each of the 96 configurations — the set selection actually ranged over | 2.448 |
| Everything | **333** | all 288 TP1 entries (96 configs × 3 splits) + 45 prior entries from `btc-4h-regime-engine/trials.json` (H1–H4, exposure control, prior DSR work) | 2.005 |

`σ(pool)` for the selection pool comes from the 96 validation-split Sharpes,
which range **−2.22 to +1.61**, mean +0.094, standard deviation **0.973**
annualised.

The registry is written by `phase45.mjs` *before* any gate is evaluated or any
table printed, so the DSR denominator can never be smaller than the search that
was actually run. Every configuration counts as a trial the moment its
performance is computed, whether or not it was a serious candidate.

Best DSR observed anywhere in the grid: **0.066** (N=96) / **0.218** (N=333),
against the pre-registered `≥ 0.95`.

## 10. Verdict and decision

Six years of BTC 4H data do not validate any of the 96 pre-registered
entry/exit rules, under any bias, in either direction. The best result of the
search is below the noise floor of the search itself. Publishing a
BIAS/TRIGGER/ENTRY panel on top of them would be publishing noise with good
typography.

Consequences, applied as pre-registered:

- The planned `strategy()` **was never built**. No BIAS/SETUP/TRIGGER panel
  shipped.
- Phase 6 (incremental alternative-data tests: OI, premium, funding, spot/perp
  participation, SOPR, ETF, liquidation) **never started** — it was gated on a
  price-only model passing Phase 5 first.
- The Market Radar (`btc-4h-market-intelligence/`, frozen at `70c96b4`) remains
  a descriptive layer and never influenced a trade signal.
- The rejected volatility Risk Budget (6 of 7 gates; G1 failed at 3.2% against
  a 10% threshold) was **not** reinstated; no volatility scaling entered the
  product.
- What shipped is the mechanical **Trade Risk Planner** (§11), whose evidence
  panel prints this study's negative result — `96 entry rules tested, 0
  validated` — in place of any confidence score.

The engine itself is reusable as-is: signal at confirmed close, fill at next
open, intrabar stop fills, gap-through-stop at the open, forced close at split
boundaries. It produced no degenerate trades and R multiples bounded where they
should be. Reusing it requires a new pre-registration.

## 11. What survives into the product

**The Risk Planner arithmetic only. It is arithmetic and it makes no
prediction.** No bias rule, no entry rule, no signal, no backtest claim from
this study carries forward.

Given user-chosen direction, entry price and invalidation price:

```
stopDist  = |entry − stop|                          voided unless the stop is on
                                                    the losing side of entry
allowedLoss = equity × riskPct / 100
qtyRaw    = allowedLoss / stopDist
qtyCap    = maxLev × equity / entry
qty       = min(qtyRaw, qtyCap)                     capped = qtyRaw > qtyCap
notional  = qty × entry
reqLev    = notional / equity                       displayed as "x equity"
actRisk   = qty × stopDist                          < allowedLoss when the cap binds
1R/2R/3R  = entry ± {1,2,3} × stopDist              sign by direction
trailRef  = lowest(low, N)[1]  (long)               previous N bars, excludes the
            highest(high, N)[1] (short)              live bar — never repaints
```

Load-bearing details that must not be lost in a port:

- **Plan voiding, not silent flipping.** A stop on the wrong side of entry
  means the direction and the level disagree; every derived number would be
  nonsense, so the whole plan is voided and reported `INVALID`.
- **Actual risk after the cap.** When the notional cap binds, the position no
  longer risks the full budget. The number displayed is the risk actually
  taken, never the one requested.
- **Non-repainting trailing reference.** The `[1]` offset is what excludes the
  live bar. Without it the level moves within the bar and the alert lies.
- **Optional auto-stop** at an ATR multiple from entry is a *distance
  convention*, not a prediction, and must be labelled as such.
- **Confirmed-bar alerts only**, so an alert never fires on an intrabar wick
  that closes back inside the level.

The shipped indicator carried 17 offline checks (PineTS against recorded
Binance bars) covering the sizing algebra end to end, the leverage cap and the
reported under-cap risk, direction/stop validation, the R ladder, and that the
trailing reference reads only the previous N bars on every sampled bar.

The evidence vocabulary constraint also survives: the product may display
`REJECTED` · `INSUFFICIENT` · `RETROSPECTIVE PASS` · `PROSPECTIVE SUPPORTED`,
and may not display a confidence percentage, star rating, "strong buy", or AI
score. There is no calibrated model behind such a number, so printing one would
be a fabrication.

## 12. Commit references

Verified with `git log --format='%h %s' -1 <hash>`:

| hash | subject |
|---|---|
| `05f7434` | Pre-register the BTC 4H Trade Planner study before running it |
| `c0ae3e7` | Run the pre-registered Trade Planner study: 0 of 96 pass, engine not built |
| `9becc65` | Ship the Trade Risk Planner: sizing arithmetic, no signals |

All three resolve. Deleted source files recoverable from these commits:
`PRE-REGISTRATION.md`, `RESEARCH-LOG.md`, `README.md`, `planner.pine`,
`tests.mjs`, `trials.json`, `research/engine.mjs`, `research/phase45.mjs`,
`research/RESULTS.md` (full 96-row table), `research/results.json`.
