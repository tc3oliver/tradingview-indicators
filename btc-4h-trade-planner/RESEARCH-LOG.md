# BTC 4H Trade Planner — research log

Study TP1. Pre-registered in [`PRE-REGISTRATION.md`](./PRE-REGISTRATION.md)
(commit `05f7434`, written and committed before the first run). Engine:
[`research/engine.mjs`](./research/engine.mjs). Runner:
[`research/phase45.mjs`](./research/phase45.mjs). Full table:
[`research/RESULTS.md`](./research/RESULTS.md). Registry:
[`trials.json`](./trials.json) — 288 entries, plus the 45 prior entries in
`../btc-4h-regime-engine/trials.json`.

Everything below is **RETROSPECTIVE RESEARCH** on 2020-09 → 2026-09 BTC data
this project had already examined. Nothing here is out-of-sample.

---

## Verdict

**All 96 pre-registered configurations failed. 76 REJECTED, 20 INSUFFICIENT,
0 RETROSPECTIVE PASS.**

Per the pre-registration (§6, "If every model fails") and the product brief:
**the Trade Plan Engine is not built.** No `strategy()` script ships, no
BIAS/SETUP/TRIGGER panel ships, and Phase 6 (alternative-data increments) never
starts.

## The four one-gate misses, and why the gate is right

Four configurations passed nine of ten gates and failed only G9, the Deflated
Sharpe Ratio:

| config | dev n / expR | val expR / PF | test expR / PF | comb Sharpe | DSR (N=96 / N=333) |
|---|---|---|---|---|---|
| C pullback50 s1.5 t10 **long** | 76 / **−0.26** | 0.54 / 2.15 | 0.90 / 2.89 | 1.53 | 0.066 / 0.218 |
| C pullback50 s2.0 t10 **long** | 74 / **−0.25** | 0.40 / 2.06 | 0.65 / 2.70 | 1.45 | 0.051 / 0.182 |
| A breakout40 s2.0 t20 **long** | 28 / +0.42 | 0.52 / 2.02 | 0.39 / 1.76 | 0.90 | 0.006 / 0.037 |
| B breakout20 s2.0 t10 **short** | 51 / **−0.08** | 0.53 / 2.66 | 0.20 / 1.44 | 0.68 | 0.002 / 0.014 |

Two independent reasons these are not edges:

1. **The search's own noise floor is higher than its best result.** The 96
   validation-split Sharpes range from −2.22 to +1.61 with a standard deviation
   of 0.97 annualised. The expected *maximum* Sharpe of 96 configurations with
   zero true edge and that dispersion is **≈ 2.47 annualised**. The best
   observed combined Sharpe is 1.53. A coin-flip search of this exact grid
   would typically hand back a better-looking winner than the real one. This is
   the same shape as the prior project's H3 result (candidate 1.06 vs noise
   floor 1.18 at N=15), now at N=96 because the grid was bigger.
2. **Three of the four lose money in development.** C pullback50 long earned
   −0.26R per trade across 76 trades in 2020–2023 and only turns positive in
   the 2024–2026 window — which is one long bull regime. A rule whose entire
   record comes from the most recent regime, selected by scanning 96 cells, is
   the definition of what G9 exists to catch.

The 20 INSUFFICIENT cells are predominantly shorts: BTC 2024–2026 simply does
not contain 40 independent short setups under bias A or C. INSUFFICIENT is not
a pass and none of them enter any product.

## What did replicate

Not nothing, and worth recording:

- **Pullbacks beat breakouts and 10-bar trails beat 20-bar trails on the
  recent data** — consistently across bias rules. Recorded as description, not
  as a tradable claim; the same table shows the ordering *reverses* in
  development.
- **Costs were not the killer.** At 0.14% round trip, gross-vs-net differences
  are ~0.02R/trade; the failures are structural.
- The engine's execution model (signal at confirmed close, fill at next open,
  intrabar stop fills, gap-through-stop at open, forced close at split
  boundaries) produced no degenerate trades and R-multiples bounded where they
  should be. It is reusable as-is if new data (post-2026-09 bars, or another
  asset) ever justifies a new pre-registered study.

## Consequences for the product

The user-facing conclusion, stated without hedging: **six years of BTC data do
not validate any of the 96 pre-registered entry/exit rules, on any timeframe
bias, in either direction.** Publishing a BIAS/TRIGGER/ENTRY panel on top of
them would be publishing noise with good typography.

What survives every audit in this repository and is allowed to ship:

1. **Mechanical stop-based position sizing** (pre-registration §9): pure
   arithmetic, no alpha claim, no validation needed beyond its own algebra.
2. **Descriptive market state** — the frozen Market Radar
   (`../btc-4h-market-intelligence/`, commit `70c96b4`).
3. **Factual structure levels** — the existing session-levels indicator
   (`../session-highs-and-lows-indicator/`).

The product built from this study is therefore a **Trade Risk Planner**: the
trader chooses direction and entry; the tool computes and draws the stop, the
position size for a fixed account risk, the R ladder, and a mechanical
trailing reference level — and its evidence panel states this study's negative
result instead of a confidence score. See [`planner.pine`](./planner.pine).
