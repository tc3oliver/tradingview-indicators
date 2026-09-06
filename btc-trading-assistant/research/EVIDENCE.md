# Evidence

Everything this indicator claims, and everything it refuses to claim, traces to
something in this directory.

The short version: **eight pre-registered studies looked for a tradable
directional edge in BTC. None found one.** That is why the panel's last row says
`AUTOMATIC SIGNAL — NONE VALIDATED` and why there is no BUY, SELL, LONG, SHORT,
confidence percentage, composite score or probability anywhere in the product.

What ships is what survived: descriptive market context, and arithmetic.

---

## What the product is allowed to say, and why

| Shipped | Basis |
|---|---|
| Trend relative to the confirmed daily 200MA, plus 12-week momentum | Descriptive. A statement about where price has been, never about where it goes. |
| Volatility percentile | Descriptive. Rarity of the current realised volatility against its own history. |
| Open-interest expansion / reduction over 24H | Descriptive, and direction comes from the raw sign — never from a z-score. |
| Perpetual premium, spot-vs-perp relative participation | Descriptive anomaly measures. Rarity only. |
| Data health | Operational. A reading from a feed that is not there is the worst thing the panel could print. |
| Position size, R ladder, required leverage | Arithmetic. Given a direction, an entry and an invalidation there is exactly one size that risks a stated fraction of the account. No validation is needed for a division. |

| Not shipped | Why |
|---|---|
| Any automatic entry or exit signal | 96 pre-registered 4H rule combinations, 36 intraday candidates + 108 neighbours, a published-paper replication, a 1H fallback: 0 passed. |
| Any directional reading of open interest, funding or order flow | Falsified directly. Raw value states what happened; percentile states how unusual. Neither is bullish or bearish. |
| Any order-book / L2 display or signal | The information is real and far too small to trade — see below. |
| Any composite score, confidence % or probability | There is no validated model to derive one from. A number like that would be a claim wearing a decimal point. |

---

## The studies

| # | Study | Question | Verdict | Record |
|---|---|---|---|---|
| 1 | Regime engine (H1–H4, P1) | Do OI, positioning and derivatives state predict 4H direction? | **Rejected** — all hypotheses failed under exposure-matched controls | [market-regime.md](./rejected-studies/market-regime.md) |
| 2 | Action layer audit | Do the three candidate Actions improve a decision? | **Rejected** — one pointed the opposite way; one fired *after* the fall | [market-regime.md](./rejected-studies/market-regime.md) |
| 3 | Risk budget (7 gates) | Does volatility-scaled sizing reduce outcome dispersion? | **Rejected** — G1 failed at 3.2% against a required 10%; module removed rather than re-tuned | [market-regime.md](./rejected-studies/market-regime.md) |
| 4 | TP1 — 4H trade plan | Do any of 96 entry/exit rule combinations pass ten pre-registered gates? | **Rejected** — 76 rejected, 20 insufficient, **0 passed** | [trade-plan-4h.md](./rejected-studies/trade-plan-4h.md) |
| 5 | IT1 — intraday setups | ORB / sweep-and-reclaim / VWAP reclaim, London and New York, both directions | **Rejected** — 36 candidates + 108 neighbours, 0 passed | [intraday.md](./rejected-studies/intraday.md) |
| 6 | IT2 — paper replication | Does Shen, Urquhart & Wang's intraday momentum replicate on Binance? | **Not replicated** — t 0.25 in the paper's own period, t 0.69 after | [intraday.md](./rejected-studies/intraday.md) |
| 7 | IT3 — 1H lower turnover | Does a slower version survive costs? | **Rejected** — 6 of 6 | [intraday.md](./rejected-studies/intraday.md) |
| 8 | M1 — raw aggressive flow | Does aggressor trade flow predict short-horizon returns? | **Rejected** — real but *contrarian* signature worth ~0.36 bp against a 14 bp round trip | [microstructure.md](./rejected-studies/microstructure.md) |
| 9 | M2-H — historical L2 | Does the order book predict the next 30 seconds? | **Information yes, economics no** — see below | [m2h.md](./microstructure/m2h.md) |
| 10 | M2 — live L2 prospective | The same question, forward, on data recorded after a public freeze | **Collecting** — below its 30-day sample gate | [microstructure.md](./rejected-studies/microstructure.md) |

---

## The one result that most needs stating plainly

Order-book information is **statistically real and economically useless for taker
directional trading**. This is the clearest finding in the repository and the
most tempting one to misuse.

| | |
|---|---|
| Depth imbalance, development split (23 days) | t = 14.66 |
| Depth imbalance, validation split (3 days) | t = 6.38 |
| Rank IC | 0.0933 |
| Decile monotonicity | 0.85 |
| Top-minus-bottom decile | **1.246 bp** |
| Walk-the-book backtest, gross | **+0.236 bp** per trade |
| Commission alone (10 bp round trip) | **−10 bp** |
| Walk-the-book backtest, net | **−9.764 bp** per trade |
| Win rate / profit factor | 2.6% / 0.01 |
| Random same-frequency entries | −10.019 bp |
| Sign-shuffled signal | ≈ −10 bp |

A t-statistic of 14.66 is not a licence to trade. The edge is roughly forty times
smaller than the cost of harvesting it, and after costs the signal is
indistinguishable from entering at random. Execution timing does not rescue it
either: waiting 5 s or 30 s moves implementation shortfall by ~0.02 bp against a
pre-registered 0.5 bp threshold, because ~5 bp of the 5.115 bp shortfall is
commission and no timing decision can touch it.

Two caveats belong with those numbers, and they cut in opposite directions.

The out-of-sample side is thin: validation is **three days** — 2024-07-01,
2024-08-01 and 2024-09-01 — and the locked test split is **empty**, so the four
information gates were never *evaluable* at all. Only the economic gate was
independently computed, and it failed. M2-H's formal status is therefore
**PRELIMINARY — BLOCKED BY HISTORICAL DATA ACCESS** (26 of 2,301 days; the free
tier serves only the first day of each month), and it should not be read as a
completed falsification of the information claim.

But being short of a formal PASS/FAIL is *not* a reason to ship the feature
anyway. The economic gap is not marginal and does not depend on sample size: a
gross edge of 0.236 bp against 10 bp of commission is a ratio, not a p-value.
More data could raise or lower the t-statistic; it cannot make the edge forty
times bigger.

---

## How to read these records

Every study was **pre-registered**: hypotheses, acceptance gates, cost
assumptions and analysis code were committed before results existed. Deviations
appear in appendices, never by editing a frozen section. `INSUFFICIENT` and
`BLOCKED` are reported as themselves and never quietly upgraded to a pass.

Trial counts are corrected for multiple testing using the effective number of
independent trials rather than the raw count — 849 raw intraday entries reduce to
115 effective, for instance — because correlated trials are not independent ones.

A negative result is a deliverable. Publishing the tests that killed a design is
more useful than publishing the design.

---

## Directories

```
research/
├── EVIDENCE.md                     this file
├── MIGRATION.md                    what moved here from five deleted projects, and how it was checked
├── microstructure/
│   └── m2h.md                      the full historical L2 record: provider, reconciliation, results, economics
└── rejected-studies/
    ├── market-regime.md            regime engine, action-layer audit, risk budget
    ├── trade-plan-4h.md            TP1
    ├── intraday.md                 IT1, IT2, IT3
    └── microstructure.md           M1, M2, M2-H summary
```

The active prospective collector lives in
[`../tools/microstructure/`](../tools/microstructure/). It is research
infrastructure, not part of the indicator, and nothing it records reaches the
panel.
