# BTC Intraday Trade Planner — research log (study IT1)

Pre-registered in [`PRE-REGISTRATION.md`](./PRE-REGISTRATION.md) (commit
`ab5f599`, written and committed before the first setup backtest). Audit:
[`research/AUDIT.md`](./research/AUDIT.md). Engine:
[`research/engine.mjs`](./research/engine.mjs). Runner:
[`research/run.mjs`](./research/run.mjs). Full tables:
[`research/RESULTS.md`](./research/RESULTS.md). Registry:
[`trials.json`](./trials.json) — 432 entries, plus 333 prior in the two
sibling projects.

Everything below is **RETROSPECTIVE RESEARCH** on 2020-01 → 2026-09 BTCUSDT
perpetual 15m data. Nothing is out-of-sample.

---

## Verdict

**All 36 pre-registered candidates failed. 31 REJECTED, 5 INSUFFICIENT,
0 RETROSPECTIVE PASS.** Neighbours: 18 of 216 split-entries have positive
expectancy; the other 198 are negative.

Per the pre-registration (§7, "If none pass") and the product brief: **no
`strategy()` is built.** No BIAS / SETUP / ENTRY / STOP / TP dashboard ships.
Phase 7 (alternative data) never starts.

## Why they failed — the same reason, three times

The failure is not one family, one session or one direction. Gross of costs
the setups are coin flips; net of a realistic round trip they lose.

| family (validation ∪ test) | n range | **gross** expR range | median planned risk | cost per trade | **net** expR range |
|---|---|---|---|---|---|
| ORB (London, NY, ±RVOL, ±1H) | 147–525 | −0.10 … +0.12 R | 70–196 bp | 0.08–0.23 R | −0.26 … +0.03 R |
| Sweep & reclaim (PD / Asia / London levels) | 37–369 | −0.26 … +0.20 R | 43–157 bp | 0.19–0.48 R | −0.65 … −0.08 R |
| VWAP reclaim (London, NY, ±1H) | 168–536 | −0.00 … +0.13 R | 54–103 bp | 0.17–0.32 R | −0.27 … −0.08 R |

Three facts, each sufficient on its own:

1. **No gross edge.** Before any cost, 36 candidates spread across
   −0.26 … +0.20 R per trade with 2R targets and structural stops; win rates
   31–56%. The break-even win rate for a 2:1 payoff is 33%. That is what a
   random-walk entry looks like — the setups do not move the needle either way.
2. **Costs are the whole story on the net line, and they cannot be
   engineered away.** With planned risk of 40–200 bp, a 0.14% round trip is
   0.1–0.5 R per trade. The only candidate with positive net expectancy
   (ORB NY short +1H, +0.03 R) fails G1 (−0.04 R in development), G2 (PF 1.12),
   G5, G7 (negative at 0.20% RT) and G9. The tightest-stop family (sweep &
   reclaim) is the worst precisely because a structural stop 5 bp from entry
   turns a fixed fee into a 2–3 R loss.
3. **The search's noise floor is far above anything found.** Validation
   Sharpes of the 144 configurations run −5.04 … +1.24 (sd 1.39). The expected
   best Sharpe of 765 zero-edge trials at that dispersion is 4.42. Nothing came
   within a factor of three of it. DSR is 0.000 for every candidate.

## What did replicate

- **Session normalisation matters** (audit): NY open half-hour volume is 3.8×
  the Asia mid-session hour; the 09:30 NY bar is the same bar in summer and
  winter, and a fixed UTC slot mixes it with a pre-open bar for half the
  year. Any future intraday study must keep local-time sessions and same-slot
  RVOL — this part of the design survives.
- **NY is less bad than London, and wider ranges are less bad than tight
  ones.** ORB NY (median risk 145–196 bp) nets −0.01 … +0.03 R; ORB London
  (70–90 bp) nets −0.18 … −0.26 R. This is the cost ratio, not an edge.
- **RVOL confirmation did not help** (ORB NY: −0.07 → −0.01 R long,
  −0.01 → −0.01 R short; ORB London worse with it). **1H context did not
  create an edge** either: it raised gross expectancy by ~0.05–0.1 R on some
  cells and cut trade counts by 20–80%, never enough to clear costs.
- **Pullbacks/reclaims did not beat breakouts at 15m** — the opposite of the
  4H study's ordering. Neither ordering is a claim.
- The engine's execution model (fill at next open, stop/limit active on the
  fill bar, broker-emulator path rule, session-end flat at next open)
  produced no overnight positions, no out-of-session trades, and gross R of
  exactly −1.00 on every stop exit — verified by `research/smoke.mjs`.

## What this rules out, and what it does not

Ruled out for BTC 15m under realistic taker costs: opening-range breakouts
(London, NY, with or without relative-volume or 1H-trend filters), sweep &
reclaim of previous-day / Asia / London highs and lows, and daily-VWAP
reclaims, each with 2R-target / structural-stop / session-flat management.

Not tested, and therefore not ruled out: maker-fee execution (limit entries,
which would need a fill model this dataset cannot support), 1H primary
timeframe with wider stops, non-session-bound holds, and the alternative-data
factors, which by pre-registration are only tested on top of a passing
price-only setup.

## Consequences for the product

**The BTC Intraday Trade Planner is not built.** What a user gets instead is
the same honest set as before, unchanged: the Trade Risk Planner
(`../btc-4h-trade-planner/planner.pine`, any timeframe, sizes risk and draws
the plan), the session-levels indicator (`../session-highs-and-lows-indicator/`)
and the frozen Market Radar. None of them predicts, and this study is the
reason the intraday one does not either.

The next research family, if any, requires a new pre-registration commit.
