# Microstructure research line — M1, M2, M2-H

Condensed from the `btc-microstructure/` project, which has been deleted. Git history is
the archive; the commits named at the bottom of this file hold the full sources.

Three studies asked one question in three ways: **does microstructure — aggressive trade
flow, then the order book itself — predict short-horizon BTC returns well enough to
trade?** All three are on the record, none of them shipped anything.

Detailed M2-H write-up: [`../microstructure/m2h.md`](../microstructure/m2h.md).

---

## M1 — raw aggressive trade flow

Pre-registered `1350c08`, result `24cc932`, both 2026-09-06. Binance USDⓈ-M `BTCUSDT`
perpetual, primary; spot as venue robustness only.

### Dataset and data-integrity audit

| | |
|---|---|
| full-sample panel | 5m klines, 2020-01-01 → 2026-09-05, 702,720 futures bars (0 grid gaps), 702,254 spot bars (15 gaps) |
| raw ground truth | Binance public aggTrades archives — **34 stratified futures days, 53,220,709 trades, $497.1B notional**; 7 spot days, 8,973,115 trades |
| reconciled | 9,788 5-minute bars rebuilt from the raw trades and compared to the kline taker-buy split |
| clean | 0 duplicate aggTrade ids, 0 out-of-order timestamps, 0 trades outside their archive's UTC day, 0 unparseable maker flags; archive day boundaries chain exactly by trade id |

Seven years of futures aggTrades is ~80 GB, so full-sample features were computed from
the 5m klines' taker-buy split (`aggressive buy = tbq`, `aggressive sell = qv − tbq`) —
the exchange's own aggregation of the same trade stream. That substitution was a declared
deviation licensed by measurement, not convenience.

**The aggressor mapping was proven, not assumed.** `is_buyer_maker = false → aggressive
buy` was tested against its own negation over the 9,788 reconciled bars:

| comparison | median relative error | p99 | max |
|---|---|---|---|
| Σ(`is_buyer_maker = false`) vs kline taker-buy quote | **4.34e-16** | 6.72e-4 | 6.33e-1 |
| the same with the maker side flipped | **1.53e-1** | 6.34e-1 | 9.06e-1 |
| absolute ΔAFI (AFI sd ≈ 0.23) | 6.87e-16 | 1.73e-3 | 3.55e-1 |

Machine epsilon one way, 0.15 the other. The mapping is verified.

Three defects found, each resolved rather than waved through:

1. **The raw archive is missing 557,026 aggTrade ids at 2021-05-19 13:15 UTC** — the
   single id gap in the entire 53.2M-trade sample, during the May 2021 crash. The archive
   holds $11.5M of notional for that bar against the kline's $141.8M over 211,056 trades.
   ΔAFI 0.3549, relative notional error 0.919. **The archive is the defective source, not
   the kline**, and this gap is also the whole explanation for the "24-minute interval
   with no trade" the raw scan reports.
2. Daily archives start a few hundred milliseconds into each UTC day, so the 00:00 bar of
   an archive is short. The kline is complete there.
3. Millisecond boundary attribution: bursts within 1–2 ms of a 5m boundary land in
   different bars in the two aggregations; the differences offset exactly between adjacent
   bars. Bounded and stated, p99 |ΔAFI| 1.7e-3, under 1% of one AFI standard deviation.

Points 1 and 2 make the kline the *more* complete source, not a degraded stand-in. The
licence covers aggregate signed notional per 5m bar and nothing else — trade size
distribution, sweep size and sub-5-minute timing still require raw trades.

### Hypotheses as pre-registered

`AFI_t = (aggressiveBuyQuote − aggressiveSellQuote) / (aggressiveBuyQuote +
aggressiveSellQuote)`. Splits fixed before any estimate: dev 2020–2022, validation
2023–2024, locked test 2025-01-01 → 2026-09-05.

- **H1 — continuation.** Higher AFI predicts a higher next-15-minute return, β > 0.
  `fwd(3) = α + β·AFI + γ1·ret5 + γ2·rv5 + γ3·lnqv + δ_{minute-of-day} + ε`, Newey–West
  lag 12. Pre-registered explicitly: *a significant negative β does not rescue H1.*
- **H2 — absorption.** Flow that fails to move price carries different information from
  flow that does; the test is on `β3` of the `AFI × ret5` interaction, two-sided.

Seven information gates I1–I7 (sign stability, |t| ≥ 2 on validation and test, multiple-
testing threshold, year stability, decile monotonicity ≥ 0.7, extreme-trim robustness,
spot sign agreement). Any failure rejects the hypothesis.

### Result: REJECT

H1 failed **all seven** gates; H2 failed I2, I3, I4, I5, I6.

| H1, primary 15m | n | β | HAC t |
|---|---|---|---|
| development | 315,613 | −1.08e-4 | −1.22 |
| validation | 210,523 | +2.99e-5 | 0.54 |
| locked test | 176,538 | +4.96e-6 | 0.10 |
| validation ∪ test | 387,061 | +1.68e-5 | **0.46** |

Multiple-testing threshold at the time: |t| > 3.53 (121 cumulative effective trials).

**The interesting part is the sign.** The deciles are near-monotone in the *opposite*
direction to H1: decile 1 (heaviest aggressive selling) +0.449 bp (t 4.73) falling to
decile 10 (heaviest aggressive buying) −0.271 bp (t −2.80), monotonicity **−0.891**,
top − bottom −0.720 bp, rank IC −0.030. Spot agrees and strengthens with horizon (15m
t −1.84, 30m t −3.19). Post-hoc, the pattern holds in all three splits (monotonicity
−0.976 / −0.879 / −0.673), weakening after 2022 but not vanishing. Aggressive flow at
5-minute scale is, on average, slightly *paying* for immediacy.

H2's four pre-registered cells settle the absorption story directly: absorbed buying
−0.301 bp vs aligned buying −0.269 bp; absorbed selling +0.495 bp vs aligned selling
+0.446 bp. Absorbed and aligned are 0.03–0.05 bp apart on cells whose own standard errors
are an order of magnitude larger. Whatever information exists is in the flow imbalance,
not in whether price responded.

### Economics — why the contrarian signature is not worth a second study

§7 of the pre-registration was never reached (§6 failed). The figures were computed anyway
so the door is closed with a number on it. Top/bottom development AFI decile, fill at the
next bar's open, exit three bars later, no stop, no target; 108,710 signals on
validation ∪ test.

| | |
|---|---|
| gross per signal, following the flow | **−0.362 bp** (HAC t −5.74) |
| gross per signal, fading the flow | **+0.362 bp** |
| mean absolute 15m move on those bars | 12.8 bp |
| round trip, base | 0.14% = **14 bp** |
| net per signal | −14.4 bp @ 14 bp · −20.4 bp @ 20 bp · −30.4 bp @ 30 bp |
| profit factor | 0.14 / 0.07 / 0.03 |
| **COST / EXPECTED EDGE** | **38.7×** @ 14 bp · 55.2× @ 20 bp · 82.8× @ 30 bp |
| **COST / EXPECTED MOVE** | **1.09** @ 14 bp |

**Verdict: REJECTED / NOT TRADABLE.** A real but weak contrarian signature worth ~0.36 bp
against a 14 bp round trip. The second number, 1.09, is the more general one: at 5-minute
resolution the cost of getting in and out exceeds the entire average 15-minute move,
signal or no signal. That is a statement about the horizon, not about this signal. The
reversal finding is recorded and not pursued — acting on it would need its own
pre-registration, and §5 of the research log says what that study would conclude before it
started.

---

## M2 — live prospective L2

Pre-registered and frozen `64da583`; prospective capture started and the archive guarded
by a collector lock in `eefe63c`. Status: **COLLECTING — INSUFFICIENT**.

M2 was split so that the useful half does not depend on the speculative half: **Part A/B**
is execution (what does it cost to trade right now, is waiting better) and ships
regardless; **Part C** is direction and may emit LONG/SHORT only after every gate,
economics included.

### Prospective identity

This is the part that matters, because it is what makes any future M2 result mean
something.

| | |
|---|---|
| freeze commit | **`64da583`** (`64da58399bfb6b50f8901b7d2dd1c17ae8903130`) |
| `frozenAt` | **2026-09-06T08:37:24.000Z** |
| `M2_PROSPECTIVE_START` | **2026-09-06T08:37:34.395Z** — the first sequence-verified book after the freeze |
| `schemaVersion` | **v1** |
| marker file | `research/M2-FREEZE.json`, generated from the freeze commit |

Enforced in code, not promised in prose: every persisted record carries
`phase: "warmup" | "prospective"`; with no freeze marker on disk the collector **cannot**
leave `warmup`; a marker whose `schemaVersion` differs from the collector's is refused;
the prospective start is written once and never rewritten; nothing collected before the
freeze may be relabelled — warmup data is engineering data, permanently. Any change to
feature, sequence or event-assignment semantics bumps the schema version, which
*invalidates* the old prospective identity rather than inheriting it. Two post-freeze
changes (a writer pid-lock, and three additive `book.mjs` methods for the M2-H vendor
path) were judged non-semantic, recorded with their new hashes in the pre-registration
appendix, and left `v1` intact.

### Sample gate — the runner refuses to compute anything directional below it

| requirement | minimum | had (2026-09-06T08:43Z) |
|---|---|---|
| calendar days of prospective coverage | **30** | 1 |
| weekday days | **20** | 0 |
| weekend days | **8** | 1 |
| valid-book hours | **600** | 0.1 |
| volatility span, p90 ÷ p10 of hourly realised vol | **2.0** | n/a |

Until every line is met the only deliverable is `STATUS-M2.md` reading **COLLECTING —
INSUFFICIENT**, and no verdict of any kind: not a coefficient, not a t-statistic, not a
direction. The stated reason is that a few days of order-book data can produce a
confident-looking coefficient of *either* sign, which is precisely the failure this gate
exists to prevent. 268 feature records, 1.0 MB on disk at the time of the status file.

**Current status: collecting, below gate.** No directional statistic was ever produced.

### Two measured facts Binance does not document

Both confirmed by `research/probe/probe.mjs` against the live API on 2026-09-06, with the
raw observation kept in `research/probe/payloads.json`.

1. **Stream routing.** `btcusdt@aggTrade` is served **only** on
   `wss://fstream.binance.com/market/stream?streams=` and returns nothing on `/stream`,
   `/ws` or `/public/stream`. `btcusdt@depth@100ms` and `btcusdt@bookTicker` are the other
   way round — they deliver on `/stream` (114 and 1,700 msgs / 12 s) and nothing on
   `/market`. **The collector therefore opens two websocket connections.** Anyone writing
   from the documentation alone would open one and silently collect no trades.
2. **Undocumented wire fields.** `depthUpdate` arrives with keys `e, E, T, s, ps, U, u,
   pu, b, a, st` — **`ps` and `st` are on the wire and absent from the documented schema**.
   `aggTrade` arrives with `e, E, a, s, p, q, nq, f, l, T, m, st` — **`nq` is likewise
   undocumented**; on BTCUSDT it equalled `q` in every sample, so it is recorded and not
   used. Parsers must ignore unknown fields rather than assume a fixed shape.

`bookTicker` was measured at ~140 msg/s against depth's ~10/s and is subscribed by nobody
and persisted by nobody — `depth@100ms` already carries every top-of-book change these
horizons can use. Recorded as a decision, not an oversight.

### Fees, read 2026-09-06

Binance USDⓈ-M futures, Regular User / **VIP 0: taker 0.0500% = 5 bp per side, maker
0.0200% = 2 bp per side.** The 10% BNB discount exists and is deliberately not assumed.
Rates live in `collector/config.mjs` with their read date, overridable by environment
variable, never hard-coded as permanent. **0.14% is 14 bp round trip**, not 140 bp — four
sentences of M1 prose had the unit wrong while the arithmetic underneath was always
0.0014, so no ratio or verdict changed; the wording was corrected and a regression test
now fails if the conversion drifts again.

Cost profiles: **A** 10 bp commission + measured spread and impact · **B** 14 bp all-in ·
**C** 20 bp stress · **M** maker 4 bp, which **may not pass any gate**. A resting order is
not a fill; aggregate L2 gives no queue position, so there is no defensible maker fill
model and "assume we would have been the maker" is not evidence.

---

## M2-H — historical L2 retrospective

Pre-registered `a400f9d`, pipeline `8b3aeb1`, reconciliation made a precondition `8d283a1`,
run `5fac0d2`. Tardis.dev `binance-futures` `BTCUSDT`, replayed through the *same* book and
feature modules the live collector uses. Full detail:
[`../microstructure/m2h.md`](../microstructure/m2h.md).

Short version: **the information is there and the economics destroy it.**

| | |
|---|---|
| information (D1 top-5 depth imbalance, 30 s) | dev t **14.66**, val t **6.38**, rank IC **0.0933**, decile monotonicity **0.85**, top − bottom **1.246 bp** |
| walk-the-book backtest (D1, val ∪ test, 7,021 trades) | gross **+0.236 bp**, net **−9.764 bp**, win rate **2.6%**, profit factor **0.01** |
| random-entry baseline | **−10.019 bp** net — the signal is indistinguishable from noise once the book is walked |
| execution timing (Part B) | best improvement from waiting **~0.02 bp**, against a pre-registered **0.5 bp** threshold; nothing material at either size or side |
| formal status | **PRELIMINARY — BLOCKED BY HISTORICAL DATA ACCESS** |

The block is data access, not engineering: **26 of 2,301 days** in the acceptance window
(1.1%) are in the store, because free-tier Tardis serves the first day of each calendar
month only. The pre-registration forbids treating those days as the acceptance dataset, so
no PASS is reachable from them and none was claimed. Everything else ran end to end —
adapter, replay, audit (mean valid-book coverage 99.84%), reconciliation against the
sequence-verified raw feed (**PASS**, 465 pooled seconds), research runner, execution
study, backtest.

---

## Product conclusion

**NO MICROSTRUCTURE SIGNAL SHIPPED.**

Across three studies and two data domains the finding is the same and it is worth stating
precisely: **the information is statistically real and economically useless for taker
directional trading.** M1 found a stable contrarian signature worth 0.36 bp against a
14 bp round trip. M2-H found genuine order-book information — a t of 14.66 and clean
decile monotonicity — that turns into −9.764 bp per trade the moment entry and exit are
priced by walking the actual book, indistinguishable from random entries at −10.019 bp.
M2's live capture has produced no directional statistic at all and, by design, will not
until its sample gate is met.

Nothing from M1, M2 or M2-H appears in the user-facing indicator. No LONG, no SHORT, no
flow-derived bias, no depth-imbalance overlay, no Pine approximation — TradingView cannot
serve this data, and an approximation would be a new hypothesis inheriting none of this
evidence.

**Being short of a formal PASS/FAIL is not a reason to ship D1.** M2-H's status is
PRELIMINARY because 1.1% of the acceptance window was reachable, and M2's is COLLECTING
because 1 of 30 days is on disk. Neither is a pending verdict that might come back
positive enough to matter: the economics that kill D1 are measured, not gated — a 0.236 bp
gross edge against a 10 bp all-in cost does not become tradable with more days. The
missing verdict is about *statistical* acceptance; the *economic* answer is already in.

---

## Commit references

All 2026-09-06.

| commit | subject |
|---|---|
| `1350c08` | Pre-register Study M1 (BTC raw trade microstructure) with its data integrity audit — the M1 freeze and the audit that licensed the kline-vs-aggTrades substitution |
| `24cc932` | Study M1 result: aggressor flow carries a real signature 39x too small to trade — H1 rejected on all seven gates, H2 on five |
| `64da583` | Pre-register Study M2 and build the BTC Execution Planner and L2 collector — **the M2 freeze**; the commit `M2-FREEZE.json` names |
| `eefe63c` | Freeze M2, start prospective capture, and guard the archive against a second collector — writes the freeze marker, starts the prospective sample at 08:37:34.395Z, adds the writer pid-lock |
| `ac3ed31` | Replace the estimated disk rate with the measured one (3.4 KB/s, ~0.3 GB/day) — collector storage figures measured rather than guessed |
| `a400f9d` | Pre-register Study M2-H: historical L2 retrospective validation — the M2-H freeze, written before any historical feature-to-return relationship was computed |
| `8b3aeb1` | Build the M2-H historical pipeline: Tardis adapter, replay, store, reconciliation, UI |
| `8d283a1` | Make the M2-H reconciliation a precondition of the study, not a footnote — the vendor/live reconciliation must PASS before the study may run at all |
| `5fac0d2` | Run M2-H on 26 replayed days: information exists, none of it survives the cost of trading |

Prior negative verdicts that M2 verified as present and unmodified before it began:
`ab5f599`, `73e08b3`, `b2ac11d`, `22c93e5` (TP1 / IT1 / IT2 / IT3).
