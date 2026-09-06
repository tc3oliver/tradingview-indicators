# Study M2 — BTC order-book microstructure

**This commit is the M2 freeze.** Everything below was written before any M2 outcome
existed, and the collector cannot label a single record `prospective` until
`research/M2-FREEZE.json` — generated from *this* commit — is present on disk.

M2 has two independent halves and they must not be confused:

- **Part A / B — execution.** Useful without any directional edge. What does it cost to
  execute right now, and is there a state in which waiting is materially better?
- **Part C — direction.** May output LONG or SHORT only if it survives every gate below,
  economics included. If it does not, nothing directional ships and Part A still does.

Five studies have already been run and rejected in this repository (TP1, IT1, IT2, IT3,
M1). None of their rules, thresholds or indicators appear here. M2 is not a rescue of
any of them.

---

## 0. Preserved evidence

Verified present and pushed to `origin/main` before M2 began: `ab5f599`, `73e08b3`,
`b2ac11d`, `22c93e5`, `1350c08`, `24cc932`. No prior verdict is modified by this study.

**Cost-unit correction.** Four sentences of M1 prose said "140 bp" where the arithmetic
was 0.0014 — that is **14 bp**. The underlying computations were always right, so no
ratio or verdict changed; the wording is corrected and
`tests/execution.test.mjs` now fails if the conversion ever drifts again.

---

## 1. Market and data

**Primary: Binance USDⓈ-M `BTCUSDT` perpetual, and only that.** Spot may later serve as
venue robustness; a spot result may never be used to re-specify a futures feature.

| stream | route | why |
|---|---|---|
| `btcusdt@depth@100ms` | `wss://fstream.binance.com/stream?streams=` | book reconstruction |
| `btcusdt@aggTrade` | `wss://fstream.binance.com/market/stream?streams=` | aggressor flow |
| `GET /fapi/v1/depth?limit=1000` | REST | snapshots and resync |

The two websocket routes are not interchangeable: measured 2026-09-06, `aggTrade`
returns nothing on `/stream`, `/ws` or `/public/stream`, and depth returns nothing on
`/market`. Details and payload shapes in [`LITERATURE-M2.md`](./LITERATURE-M2.md) §1.

`bookTicker` is subscribed by nobody and persisted by nobody: measured at ~140 msg/s
against depth's ~10/s, and `depth@100ms` already carries every top-of-book change these
horizons can use. Recorded as a decision, not an oversight.

### 1.1 Book validity

The exchange's published procedure is implemented verbatim in `collector/book.mjs`:
buffer, snapshot, drop `u < lastUpdateId`, require `U <= lastUpdateId <= u` on the first
applied event, require `pu === previous u` thereafter, treat quantities as absolute and
zero as removal. **Any violation sets `book_valid = false` immediately** and forces a
resync. There is no degraded mode, and no feature record is ever emitted from an invalid
book.

### 1.2 Persistence

Append-safe gzip NDJSON, one partition per UTC day per kind (`depth`, `trades`, `meta`,
`features`), with `data/MANIFEST.json` recording per partition: event count, first and
last event time, sequence gaps, resyncs, reconnects, byte size, sha256 once sealed,
phase counts, and the collector and schema versions. Raw depth and trades are kept so
every feature can be recomputed; the 1 Hz feature record exists so that a 30-day study
does not require replaying tens of gigabytes.

---

## 2. Cost model

Read 2026-09-06 from Binance's USDⓈ-M schedule, Regular User / VIP 0: **taker 0.0500%
(5 bp) per side, maker 0.0200% (2 bp) per side.** The 10% BNB discount exists and is not
assumed. All rates live in `collector/config.mjs` with their read date and are
overridable by environment variable.

| profile | round trip | use |
|---|---|---|
| **A** commission-only taker | 10 bp + the spread and impact measured from the live book | acceptance |
| **B** conservative taker | 14 bp all-in (the baseline carried from IT1/IT2/IT3/M1) | acceptance |
| **C** stress taker | 20 bp all-in | acceptance |
| **M** maker | 4 bp | **never for acceptance** |

**Profile M may not pass any gate.** A resting order is not a fill. We cannot observe
queue position from aggregate L2, so we have no defensible fill model, and "assume we
would have been the maker" is not evidence. If the taker economics fail, the answer is
REJECT — not "but as a maker it would work".

---

## 3. Prospective boundary

`M2_PROSPECTIVE_START` = the first sequence-verified order book observed **after** the
timestamp of this commit, as recorded in `research/M2-FREEZE.json`.

- Every persisted record carries `phase: "warmup" | "prospective"`.
- With no freeze marker present the collector *cannot* leave `warmup`; this is enforced
  in code and tested (`tests/prospective.test.mjs`), not promised in prose.
- The prospective start is written once and never rewritten.
- If a bug changes feature semantics, sequence semantics or event assignment, the
  **schema version is bumped**, which invalidates the old prospective identity rather
  than inheriting it. A marker whose `schemaVersion` differs from the collector's is
  refused.
- Nothing collected before the freeze may be relabelled. Warmup data is engineering
  data, permanently.

### Frozen code hashes (sha256)

| file | sha256 |
|---|---|
| `collector/config.mjs` | `a567e0a17f848f5e746702f7e35a3ae94e57fa42eb79c393eb9491d4ee1599b1` |
| `collector/book.mjs` | `c60a6b1bfb005bbc7dbc14de2007d0de4a7f2c36a0a9452485d69698f254d129` |
| `collector/ws.mjs` | `74e97be25cda9cc9197bf065888e9c871a91f6abf0beb3dd8a9e6ea12d1d80e1` |
| `collector/writer.mjs` | `21480fbedaba6c3f7a795cbb17d5e66d3422418b38efa551413826ec76ba4b92` |
| `collector/collector.mjs` | `a3984efda929a4a80baf963361b500a0aab405e379a018ef0e72032d90fc3ece` |
| `features/book-features.mjs` | `909312d0f3c328e01fa6def26710b87224a206512197d09d6fae5e8668ad18e6` |
| `features/execution.mjs` | `445d5d9937d942aa37c5f1843261137de75e8e0364ad878d01681c60ac5a743c` |
| `research/m2.mjs` | `e3f8be3e3079887ecb2f65f56b286f85554b9d364bb05729083c031f5542ccae` |
| `research/coverage.mjs` | `b1448988ad5b8ce0095191d0e389581589fef552b986e48d5e27313248ce1096` |
| `research/stats.mjs` | `6c9683e2662fc59b925a61f67646b1d076ab7538e6247a403c3e27ea02ea76ee` |

The analysis code is frozen alongside the design. `npm run research:m2` needs no edit
when the sample gate is reached; if it is edited, the hash says so.

---

## 4. Features

Fixed here, implemented in `features/book-features.mjs`. Depth bands, top-N levels and
flow windows are a short declared list, not a search space.

**Price** — best bid, best ask, mid, spread in bp, microprice
`(bid·q_ask + ask·q_bid)/(q_bid + q_ask)` and its displacement from mid in bp.
**Depth** (quote notional, each side separately) — top 1 / 5 / 10 levels, and everything
within 1 / 2 / 5 / 10 bp of mid.
**Imbalance** — top1, top5, top10, and a distance-weighted version with weight
`1/(1 + bp distance)` out to 50 bp. All notional-based.
**Liquidity** — spread, near-touch depth, depth slope, and the change in near-touch
depth from one second to the next (withdrawal when negative, replenishment when
positive).
**Flow** (from aggTrade, quote notional) — aggressive buy, aggressive sell, signed, and
AFI over exactly **1 s, 5 s, 30 s**.
**Interaction** — exactly four: `pressureToCapacity`, `flowOverOppositeNearDepth`,
`flowTimesImbalance`, `flowTimesFragility`.

---

## PART A — Execution Planner (ships regardless of Part C)

Given a decided side and size, walk the current valid book: estimated VWAP, best price,
worst fill, slippage against decision-time mid (which includes the half-spread, because
crossing is a cost), book impact, fee, all-in cost in bp and in dollars, depth consumed,
and the round trip at this book. Sizes: 10,000 USDT default, presets 1k / 10k / 50k /
100k.

**This is arithmetic, not forecasting.** If the visible book cannot fill the order, that
is reported; nothing is extrapolated. If the book is invalid, no estimate is shown at
all.

**EXECUTION QUALITY** is mechanical: GOOD when the all-in immediate cost is at or below
a user-configured maximum, POOR above it or when depth is insufficient. **With no
maximum configured the planner shows the numbers and refuses to grade them.** No
composite score, nothing fitted to historical returns.

The planner may output `MARKET ORDER COST: LOW / NORMAL / HIGH` and
`LIQUIDITY: DEEP / NORMAL / THIN / VERY THIN`. It may **not** output LONG, SHORT, BUY
NOW or SELL NOW unless Part C passes, and a test enforces that the strings do not appear
outside the no-signal disclaimer.

---

## PART B — Execution research

**Question: given that the decision to buy or sell is already made, is immediate
execution better or worse than waiting?**

Decision points every 30 seconds. For each, implementation shortfall in bp against the
**decision-time mid**, including commission, for immediate execution and for the same
order 5 s and 30 s later. 1 s is reported descriptively only. BUY and SELL separately.
Primary size **10,000 USDT**; 50,000 as secondary robustness — the larger size may not
be promoted over the smaller.

### Pre-registered hypotheses

| id | hypothesis |
|---|---|
| **E1** | wide spread / thin near-touch depth → higher immediate execution cost (a measurement validation: if this fails, the instrument is broken) |
| **E2** | high same-side pressure with weak opposite depth → higher implementation shortfall |
| **E3** | strong opposite-side replenishment → lower short-horizon execution cost |
| **E4** | high book fragility → larger dispersion and a worse adverse tail from waiting |

Each is evaluated across terciles of the relevant state, with mean, HAC t, dispersion
and the 95th-percentile adverse outcome.

### Acceptance

A timing rule counts as useful only if it changes expected implementation shortfall by
more than **0.5 bp** with |t| > 2, or materially reduces the 95th-percentile adverse
tail.

That threshold is set now, with the reason stated now. A live measurement on
2026-09-06 gives, for a $10,000 BTCUSDT market order: half-spread **0.006 bp**, book
impact **0.000 bp**, commission **5 bp** — an all-in of 5.006 bp of which **99.9% is
commission that no timing decision can change.** So 0.5 bp is 10% of the total and
roughly a hundred times the controllable spread cost: a saving that size would be worth
having and is not reachable by noise-mining. **If nothing clears it, the honest finding
is that at this size on this instrument there is nothing to optimise**, and that is a
result, not a failure.

### B4 — maker research, fenced

Permitted: **passive-buy toxicity as a measurement** — if a passive BUY had rested at
the best bid at time *t*, where is the mid 1 s, 5 s and 30 s later? Mirror for sell.

Forbidden: any maker PnL. No fill may be assumed from a touch, from a bar high or low,
or from anything else. Without an identifiable queue position — which aggregate L2 does
not provide — the fill question is recorded as **UNRESOLVED** and no maker return is
computed. Enforced by test.

---

## PART C — Directional research

### C1. Minimum sample gate

The runner **refuses to produce any directional statistic** until all of the following
hold. Recent short-capture crypto OFI work reverses sign on sample extension; a few days
of book data can produce a confident coefficient of either sign, and that is exactly what
this gate exists to prevent.

| requirement | minimum |
|---|---|
| calendar days of prospective coverage | **30** |
| weekday days | 20 |
| weekend days | 8 |
| valid-book hours | 600 |
| volatility span: p90 ÷ p10 of hourly realised volatility | **2.0** |

Until then the deliverable is `research/STATUS-M2.md` reading **COLLECTING —
INSUFFICIENT**, and no verdict of any kind.

### C2. Feature families — six, continuous, no threshold search

`D1` top-5 depth imbalance · `D2` microprice displacement · `D3` 5 s order-flow
imbalance · `D4` near-touch depth change (withdrawal / replenishment) · `D5`
pressure-to-capacity · `D6` flow × fragility.

### C3. Horizons

5 s, **30 s (primary)**, 5 min. The primary is fixed here. A pass at 5 s or 5 min with a
fail at 30 s is a fail; horizons are robustness, not candidates.

### C4. Target

**Future midprice log return only**, strictly after the feature second, never
overlapping it. Last-trade prices are not used as a target, to keep bid-ask bounce out
of the measurement. Every specification controls for the previous 30 s mid return, for
spread and for log near-touch depth, with hour-of-day fixed effects, and uses
Newey–West standard errors at lag 60 s.

### C5 / C6. Gates

| id | requirement |
|---|---|
| **G1** | the primary 30 s coefficient has the same sign in development, validation and locked test |
| **G2** | \|t\| ≥ 2 on validation and on test separately |
| **G3** | \|t\| on validation ∪ test exceeds `Φ⁻¹(1 − 0.05/(2·N_eff))`, `N_eff` cumulative across every study in this repository including M2 |
| **G4** | decile monotonicity ≥ 0.7 in absolute value with the sign of G1, breakpoints from development only |
| **G5** | **economic**: gross edge in bp exceeds the round trip under profile **A** *and* profile **B** |

Splits are chronological thirds of the prospective sample, fixed before any outcome.
Splits are not trials. Raw configurations, unique configurations and effective
independent trials are all reported, effective trials estimated from the correlation of
the configurations' daily score series by the same estimator used in every prior study.

**Decision order, and it is not negotiable:** information exists → stable → economic
magnitude → execution feasibility → multiple-testing adjusted. A significant coefficient
whose gross edge is below the executable cost is **NOT ECONOMICALLY TRADABLE**, at t = 3
or t = 30. The DSR machinery is a check on the survivors, never a rescue for obviously
negative economics.

### C7. No maker rescue

If the taker model fails, the study fails. Maker economics may be invoked only after a
fill model, a queue model, an adverse-selection treatment and a fee treatment have each
passed independently — none of which is in scope here.

---

## PART E — No machine learning yet

No XGBoost, CatBoost, LSTM, Transformer or Hawkes ensemble in M2. A nonlinear study
(`M2-NL`) becomes permissible only after at least one simple interpretable feature shows
stable information on validation and prospective data *and* an economic magnitude near
the tradable threshold, and it would need its own pre-registration.

---

## Decision tree

| case | outcome |
|---|---|
| planner works, sample insufficient | ship planner and collector, status **COLLECTING**, build no signal |
| directional information fails | **REJECT** directional M2, keep the planner |
| information exists but is smaller than cost | **NOT ECONOMICALLY TRADABLE**, keep the planner, no LONG/SHORT |
| information stable, tradable and adjusted-significant | build the signal engine, reconcile it event by event against this specification |

No Pine `strategy()` is promised in any branch. TradingView cannot serve this data; an
approximation would be a new hypothesis inheriting none of the evidence collected here.

---

## Completion standard

M2 is complete when a person who has already decided to buy or sell can see what it
costs to execute right now, and when the question of whether the book predicts the next
30 seconds has been answered with evidence or is honestly marked as still collecting.
Producing a LONG or SHORT is not the completion standard, and no PASS will be
manufactured to produce one.


---

## Appendix — post-freeze changes

The frozen sections above are not edited. Any change to the code they hash is recorded
here instead, with the reason and the judgement about whether it touches data semantics.

### 2026-09-06, after the freeze: collector lock

`collector/writer.mjs` sha256 `21480fbe…` → **`b2485a20e9288739d649db96418b73f03f776dd6b0172c81068988e7f9f57f63`**

Two collector processes pointed at the same data directory would both append to the same
partitions and duplicate every raw event — an archive corrupted silently and discovered
weeks later. The writer now takes a pid lock on the data directory and refuses to start
if a live collector already holds it; a lock left by a killed process is reclaimed.

**This changes no event semantics, no sequence semantics and no event assignment**, so
by the rule in §3 it does not require a schema bump, and `SCHEMA_VERSION` stays `v1`. It
adds a precondition on starting the process and touches no field, no feature and no
record already written. The prospective sample that began at
`2026-09-06T08:37:34.395Z` continues unbroken. Covered by two new tests.

### 2026-09-06, after the freeze: additive book methods for the historical path

`collector/book.mjs` sha256 `c60a6b1b…` → **`6177d514f382576ba542e08e98e83251c2bb949e2ad7ae08de0ec8e7bdc00444`**

Study M2-H replays years of vendor L2 through the same book and the same feature engine.
Three methods were added, none of which changes a single existing line:

- `applyVendor(ev)` — applies levels from a source with no Binance `U`/`u`/`pu`. The live
  `apply()` is untouched, and the two cannot be confused: the vendor path refuses to
  become valid without an explicit snapshot.
- `checkCrossed()` — the crossed-book test, callable on demand. `apply()` still runs it
  inline on every event exactly as before; the vendor path calls it once per sampled
  second, because it applies two million events a day and checking each one costs two
  full book sorts.
- `pruneFarLevels(pct)` — drops levels beyond ±2% of mid. The collector never calls it.

Live feature values are therefore unchanged and `SCHEMA_VERSION` stays `v1`. The
prospective sample that began at `2026-09-06T08:37:34.395Z` continues unbroken.
