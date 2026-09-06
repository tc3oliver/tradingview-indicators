# M2 — exchange documentation and literature audit

Read before any collector code was written. Two purposes only: get the wire format
right, and borrow *feature definitions and falsification ideas* — never results. No
number in this file is evidence for anything we will claim.

Compiled 2026-09-06.

---

## 1. Binance USDⓈ-M, verified against the live endpoints

Documentation on this exchange is not always current, so every fact below that a parser
depends on was confirmed by `research/probe/probe.mjs` against the live API on
**2026-09-06**, and the raw observation is in `research/probe/payloads.json`.

### 1.1 The routing finding the documentation does not state

| stream | `wss://fstream.binance.com/stream?streams=` | `wss://fstream.binance.com/market/stream?streams=` | `/ws/` | `/public/stream?streams=` |
|---|---|---|---|---|
| `btcusdt@depth@100ms` | **114 msgs / 12 s** | 0 | — | — |
| `btcusdt@bookTicker` | **1,700 msgs / 12 s** | 0 | — | — |
| `btcusdt@aggTrade` | 0 | **delivers** | 0 | 0 |

`btcusdt@aggTrade` returns nothing on `/ws`, `/stream` or `/public/stream`, and is
served only on the `/market` route; depth and bookTicker are the other way round.
**The collector therefore opens two connections.** Anyone reading the docs alone would
write one connection and silently collect no trades — which is exactly why the probe
runs first.

### 1.2 Payloads as observed, not as described

`GET /fapi/v1/depth?symbol=BTCUSDT&limit=1000` →
`{ lastUpdateId, E, T, bids: [[price, qty], …], asks: […] }`, prices and quantities as
strings, 1000 levels per side.

`depthUpdate` (100 ms) → keys `e, E, T, s, ps, U, u, pu, b, a, st`. The classic
documented set is `e, E, T, s, U, u, pu, b, a`; **`ps` (pair) and `st` are present on
the wire and absent from the schema we would have written from prose.** Parsers must
ignore unknown fields rather than assume a fixed shape.

`aggTrade` → keys `e, E, a, s, p, q, nq, f, l, T, m, st`. `nq` is also undocumented in
the schema we started from; on BTCUSDT it equalled `q` in every sample, so it is
recorded and not used. `m = true` means the **buyer** was the maker, so the seller was
the aggressor.

`GET /fapi/v1/exchangeInfo` → BTCUSDT PERPETUAL, tick size `0.10`, lot step `0.001`,
market lot max `120`, min notional `50`, price precision 2, quantity precision 3.

### 1.3 Local order book procedure (official, followed exactly)

1. open the depth stream and **buffer** events;
2. take the REST snapshot;
3. drop any buffered event with `u < lastUpdateId`;
4. the first applied event must satisfy `U <= lastUpdateId <= u`;
5. every subsequent event must satisfy `pu === previous u`, otherwise start again from
   the snapshot;
6. quantities are absolute; quantity `0` removes the level;
7. an event removing a level you do not hold is normal and not an error.

Implemented in `collector/book.mjs`. Any violation sets `book_valid = false`
immediately; there is no degraded mode.

*Source:* [How to manage a local order book correctly (USDⓈ-M)](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/How-to-manage-a-local-order-book-correctly).

### 1.4 Connection limits

A single connection is valid for **24 hours**; the server pings every **3 minutes** and
disconnects a client that has not ponged within **10 minutes**; **10 incoming messages
per second** is the limit on messages we may send; **1024 streams** per connection.
Node's `WebSocket` answers pings itself, so the collector's own job is the staleness
watchdog and a pre-emptive rotation at 12 hours.

*Source:* [WebSocket market streams — Connect](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Connect).

### 1.5 Fees

Binance USDⓈ-M futures, Regular User / VIP 0, read **2026-09-06**: **maker 0.0200%
(2 bp), taker 0.0500% (5 bp)** per side. A 10% BNB discount exists and is deliberately
**not** assumed. Configured in `collector/config.mjs` with the read date, overridable by
environment variable, never hard-coded as permanent.

*Source:* [Binance futures fee schedule](https://www.binance.com/en/fee/futureFee) (the
logged-out page renders no table, so the VIP 0 rates were cross-checked against public
fee summaries on the same date — recorded here as a documentation weakness, not as
certainty).

**Unit discipline.** 0.14% is **14 bp**, not 140 bp. Earlier M1 prose said "140 bp" in
four places; the arithmetic underneath was always 0.0014, so no ratio or verdict
changed, but the wording was wrong and is corrected. A regression test in
`tests/execution.test.mjs` now fails if the conversion ever drifts.

### 1.6 Spot is not futures

Spot `aggTrades` carry an extra trailing `is_best_match` column and spot depth is a
different endpoint with different limits. Spot is robustness only in M2 and its schema
is never assumed to match futures.

---

## 2. Literature

Used for feature definitions and for knowing which failure modes to design against.

### 2.1 Cont, Kukanov & Stoikov — order flow imbalance

*The Price Impact of Order Book Events*, Journal of Financial Econometrics 12(1):47–88
(2014); [arXiv:1011.6402](https://arxiv.org/pdf/1011.6402). NYSE TAQ, 50 US stocks.

Over short intervals price changes are driven mainly by **order flow imbalance** —
the net of limit orders, market orders and cancellations at the best quotes — and the
relation is **linear with a slope inversely proportional to depth**. Robust to intraday
seasonality, stable across stocks and time scales; the square-root volume relation
follows from it and is noisier.

**Adopted:** the OFI construction from best-quote events rather than from trades alone,
and the insistence that impact be scaled by depth — which is where our
`pressureToCapacity` and `flowOverOppositeNearDepth` come from. **Not adopted:** the
equity effect sizes, which say nothing about a crypto perpetual in 2026.

### 2.2 Stoikov — the microprice

*The Micro-Price: A High Frequency Estimator of Future Prices*, Quantitative Finance
(2018); [SSRN 2970694](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2970694).

The microprice is the limit of expected mid-prices conditional on book information, a
martingale by construction, expressible as a mid adjusted for spread and top-of-book
imbalance, and computable from level-1 data alone. Volume imbalance
`(q_b − q_a)/(q_b + q_a)` has strong predictive power for the *next mid move*.

**Adopted:** the level-1 microprice `(bid·q_a + ask·q_b)/(q_a + q_b)` as a fixed
definition, and its displacement from mid in bp as a candidate feature. **Not adopted:**
the full Markov-chain estimator — an unnecessary degree of freedom before a linear
baseline has been tested (see PART E of the pre-registration).

### 2.3 Vafin (2026) — OFI and short-horizon predictability in crypto

*Order-Flow Imbalance and Short-Horizon Return Predictability in Cryptocurrency
Markets*, [SSRN 6938742](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6938742),
14 June 2026. (Full text is paywalled to us; this rests on the abstract.)

Consolidates the OFI literature for crypto, where the **aggressor side is reported
rather than inferred**, so no Lee–Ready style classification is needed. Its stated
framework demands out-of-sample evaluation, a realistic transaction-cost model, and
explicit control for data snooping — and it separates genuine prediction from the
**mechanical within-interval relation** by which trades move price.

**Adopted, and it is the single most important design constraint in M2:** the target is
the *future* mid, strictly after the feature window, never a contemporaneous or
overlapping one. A feature measured over `[t−w, t]` against a return over `[t−w, t]`
recovers an accounting identity, not a forecast. **Not adopted:** any claim about
whether the effect exists — that is what we are testing.

### 2.4 Order flow and cryptocurrency returns (2026)

[ScienceDirect S1386418126000029](https://www.sciencedirect.com/science/article/pii/S1386418126000029)
and its [EFMA working-paper version](https://www.efmaefm.org/0EFMAMEETINGS/EFMA%20ANNUAL%20MEETINGS/2025-Greece/papers/OrderFlowpaper.pdf).
(Publisher blocks automated retrieval; this rests on indexed abstract text.)

Argues that a **transitory component that reverses** must be separated from a permanent
component that persists, using lagged returns as the reversal proxy: the part of lagged
order flow *uncorrelated with lagged returns* predicts future returns positively, while
transitory effects dominate daily and adverse selection dominates weekly. The authors
also note out-of-sample predictability is much harder than in-sample.

**Adopted:** contemporaneous return enters every M2 specification as a control, exactly
as it did in M1. This is directly why M1's H1 found a reversal — a raw flow coefficient
mixes the transitory reversal with any permanent information, and the two have opposite
signs. **Adopted as a caution:** in-sample sign is not evidence of out-of-sample sign.

### 2.5 Chang (2026) — passive-buy toxicity in BTC perpetuals

*Do Order-Book States Predict Passive-Buy Toxicity? Evidence from BTC Perpetual
Futures*, [SSRN 6693260](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6693260),
2 May 2026. (Paywalled; abstract only.)

Finds passive-buy toxicity is best understood as a **local imbalance between aggressive
pressure and near-touch absorption capacity under fragile liquidity states**, and that
execution risk depends not only on recent aggressive flow but on the vulnerability of
the surrounding displayed liquidity. Reduced-form, organised around economically
interpretable local state variables rather than raw flow or static depth alone.

**Adopted:** this is the intellectual basis for Part B of M2 — passive-buy toxicity as a
*measurement* (where does mid go after a passive buy would have rested?) rather than a
maker PnL backtest, and `pressureToCapacity` and `flowTimesFragility` as pre-declared
state variables. **Not adopted:** its findings as our evidence, and emphatically not any
implied maker strategy return.

### 2.6 Bieganowski & Ślepaczuk — explainable crypto microstructure

*Explainable Patterns in Cryptocurrency Microstructure*,
[arXiv:2602.00776](https://arxiv.org/abs/2602.00776). Binance Futures perpetual books,
1-second resolution, 2022-01-01 → 2025-10-12, five assets (BTC, LTC, ETC, ENJ, ROSE),
CatBoost with a direction-aware objective plus SHAP.

Reports that engineered book and trade features keep similar predictive importance and
SHAP dependence shapes across assets spanning an order of magnitude of market cap, and
backtests "taker and maker strategies" with a conservative top-of-book taker case.

**Adopted:** 1-second resolution as the right granularity for a book feature record, and
the feature families (imbalance, spread, OFI, adverse selection). **Explicitly not
adopted:** the modelling approach. Gradient boosting on order-book features before a
single interpretable linear baseline has cleared an economic gate is precisely the step
PART E of our pre-registration forbids. Their maker results also carry the fill
assumption we refuse to make.

### 2.7 What the literature does not settle, and we must

No paper reviewed here reports a BTC perpetual order-book signal whose **gross edge
exceeds a 10–14 bp taker round trip** at a 5-second to 5-minute horizon on
out-of-sample data with an explicit cost model. Several report statistical
predictability; the ones that go on to economics either assume maker fills or report
the taker case as marginal. That gap is the whole reason M2's economic gate is
evaluated before any model is called successful, and why a maker profile may never be
used to pass it.

---

## 3. What this audit changed in the design

1. **Two websocket connections**, because the routing demanded it (§1.1).
2. **Parsers ignore unknown fields** and record them, because the wire carries `ps`,
   `st` and `nq` that prose did not mention (§1.2).
3. **`book_valid = false` on any sequence violation**, no degraded mode (§1.3).
4. **12-hour pre-emptive reconnect** inside the 24-hour cap, plus a staleness watchdog
   (§1.4).
5. **Fees as dated configuration**, VIP 0, no BNB discount (§1.5).
6. **Strictly future targets**, never overlapping the feature window (§2.3).
7. **Contemporaneous return as a control in every specification** (§2.4).
8. **Toxicity as a measurement, not a maker backtest** (§2.5).
9. **No gradient boosting until a linear baseline has passed** (§2.6).
10. **The economic gate is not optional and maker economics cannot satisfy it** (§2.7).
