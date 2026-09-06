# BTC Order Book / Execution Intelligence

Two things live here, and they are deliberately separate.

**A. Execution Planner — finished, and useful today.** You have already decided to buy
or sell BTC. This tells you what it costs to execute *right now*: spread, walk-the-book
VWAP, slippage, fee, all-in cost in bp and dollars, and how deep the book is. It needs
no directional edge and makes no directional claim.

```bash
cd btc-microstructure && npm start     # then open http://localhost:8787
```

No dependencies, no API key, read-only public market data, no orders ever placed.

**B. Directional research (Study M2) — pre-registered, collecting.** Whether the order
book predicts the next 30 seconds. It may print LONG or SHORT only after passing every
gate in [`research/PRE-REGISTRATION-M2.md`](./research/PRE-REGISTRATION-M2.md), the
economic one included. Right now the honest status is **COLLECTING**, and the planner
shows **NO VALIDATED DIRECTIONAL SIGNAL**.

Also here: **Study M1**, a completed and rejected study of raw aggressive trade flow.

---

## Study M1 — raw trade microstructure (completed, REJECTED)

A pre-registered test of one question: does aggressive buy/sell trade flow predict
short-horizon BTC returns? 53.2 million raw Binance aggTrades, 702,720 five-minute bars.

| | |
|---|---|
| **H1** — higher aggressor flow imbalance predicts a higher next-15m return | **REJECTED**, all seven information gates. β = +1.7e-5, t = 0.46 on validation ∪ test |
| **H2** — flow that fails to move price carries different information (absorption) | **REJECTED**, five of seven gates. Absorbed and aligned flow are 0.03 bp apart |
| **the finding that survives** | flow is mildly *contrarian*: heaviest aggressive selling is followed by +0.45 bp over 15 minutes, heaviest buying by −0.27 bp, monotone across deciles and present in all three splits |
| **why it is still nothing** | that edge is **0.36 bp** against a **14 bp** round trip — COST / EXPECTED EDGE = **38.7×**. At 5-minute resolution the round trip is larger than the entire average 15-minute move (ratio 1.09) |

Read in order: [`PRE-REGISTRATION-M1.md`](./PRE-REGISTRATION-M1.md) →
[`research/AUDIT-M1.md`](./research/AUDIT-M1.md) →
[`RESEARCH-LOG-M1.md`](./RESEARCH-LOG-M1.md) →
[`research/RESULTS-M1.md`](./research/RESULTS-M1.md).

Seven years of futures aggTrades is about 80 GB, so M1's full-sample features come from
the 5m klines' taker-buy split. That deviation is licensed by measurement, not
convenience: across 9,788 bars rebuilt from 53.2 million raw trades the median relative
error is **4e-16**, while the same comparison with the maker side flipped has median
error **0.15** — so `is_buyer_maker = false → aggressive buy` is verified against its own
negation. The audit also found the two places where the *raw archive* is the worse
source: it starts a few hundred milliseconds into each UTC day, and it is missing 557,026
aggTrade ids at 2021-05-19 13:15 UTC.

---

## Study M2 — order book (pre-registered, collecting)

M1 answered its question at 5-minute resolution and the answer was "information yes,
tradability no". M2 goes to the book itself, at 1-second resolution, and puts the
execution question first — because five studies in a row have now found that
short-horizon edges are smaller than the toll.

**What is built and running:**

| piece | state |
|---|---|
| production collector — two websockets, validated local book, append-safe partitioned log | **working** |
| data integrity monitor — book validity, feed ages, sequence gaps, resyncs, disk | **working** |
| Execution Planner UI | **working** |
| research runner with the sample gate wired in | **working**, refuses to analyse below the gate |
| directional verdict | **COLLECTING** — needs 30 calendar days of prospective data |

**What is not built, and why:** no directional signal, because the pre-registered
minimum sample (30 calendar days, 20 weekdays, 8 weekend days, 600 valid-book hours,
and a p90/p10 spread of hourly realised volatility of at least 2.0) has not been
reached. Recent short-capture crypto order-flow work reverses sign on sample extension;
a few days of book data will produce a confident coefficient of either sign. The runner
refuses to compute one. Current progress is on the planner's status panel and in
[`research/STATUS-M2.md`](./research/STATUS-M2.md).

Read: [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`RUNBOOK.md`](./RUNBOOK.md) ·
[`data/SCHEMA.md`](./data/SCHEMA.md) ·
[`research/LITERATURE-M2.md`](./research/LITERATURE-M2.md) ·
[`research/PRE-REGISTRATION-M2.md`](./research/PRE-REGISTRATION-M2.md).

### The cost model, stated plainly

0.14% is **14 bp**. Binance USDⓈ-M, Regular User / VIP 0, read 2026-09-06: taker
**5 bp per side**, maker **2 bp per side**. Three acceptance profiles — commission-only
taker (10 bp plus the spread and impact measured live from the book), conservative taker
(14 bp), stress (20 bp) — and a maker profile that **may never pass a gate**, because a
resting order is not a fill and aggregate L2 gives no queue position. If the taker
economics fail, the answer is REJECT, not "but as a maker it would work".

### What the planner already measures

A live capture is in [`research/PLANNER-SAMPLE.txt`](./research/PLANNER-SAMPLE.txt).
The headline for anyone trading retail size on this instrument: a **$10,000** market
order costs **5.006 bp** all-in — 5 bp commission, 0.006 bp half-spread, **0.000 bp book
impact** — and a **$100,000** order costs the same, because the top of book holds more
than that. Over 99.8% of the cost is commission that no timing decision can change.

That is a useful thing to know and it is also a warning about the execution study: the
part of execution cost you can actually influence at these sizes is a fraction of a
basis point. The acceptance threshold for a timing rule (0.5 bp) was set with that
measurement in hand and written down before the study runs, so "we found a 0.05 bp
saving and it is significant" cannot later be dressed up as useful.

### One thing the documentation would have got wrong

`btcusdt@aggTrade` returns nothing on `/ws`, `/stream` or `/public/stream`; it is served
only on `/market`, while depth is the other way round. Measured against the live
exchange before a line of parser was written
([`research/probe/payloads.json`](./research/probe/)). A single-connection collector
written from the docs alone would have silently recorded no trades at all.

---

## Commands

```bash
npm start              # Execution Planner + collector, http://localhost:8787
npm run collector      # headless 24/7 capture, no UI
npm run research:m2    # STATUS-M2.md now; RESULTS-M2.md once the sample gate is met
npm test               # 91 checks
npm run probe          # re-verify the live payload shapes
```

M1 is reproducible separately — see the commands in
[`RESEARCH-LOG-M1.md`](./RESEARCH-LOG-M1.md) and `data/fetch-*.mjs`.

## Layout

| path | what |
|---|---|
| `collector/` | config and fees, order book, websockets, storage, freeze marker |
| `features/` | book and flow measurements, walk-the-book execution estimate |
| `execution-planner/` | local read-only server and UI |
| `research/` | M1 (done) and M2 (pre-registered) studies, literature audit, live payload probe |
| `tests/` | book, execution, storage, prospective boundary, research pipeline, UI |
| `data/` | schema, manifest, partitioned event log (not committed) |
