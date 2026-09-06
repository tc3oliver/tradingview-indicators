# Changelog — BTC 4H Market Radar

Paste-ready release notes for TradingView. Newest first.

---

## v3.2 — three statistical / semantic fixes

No new features. Threshold version bumped to v3.2, which correctly forced a new
prospective cohort.

### Fixed

- **Carry-forward re-weighted the previous observation.** v3.1 called it
  "inventing nothing" — half true, wrong half. `[+2%, na, na, −1%]` became
  `[+2%, +2%, +2%, −1%]`, so +2% counted three times in the mean, the deviation
  and the rank. A missing bar now contributes **nothing**: not zero, not a
  repeat, and it does not occupy a slot. A fixture lifted verbatim out of
  `main.pine` pins it — n = 10 not 20, mean 0.005 not 0.0125, z exactly 1.0.
  The statistics are no longer left to `ta.sma()`/`ta.stdev()`: the docs
  describe na-skipping for the first and say nothing about the second, and
  pairing them would compute mean and σ over different sample sets. `validNorm()`
  walks the window itself in one Welford pass and returns z, percentile and
  sample count from provably the same samples.
  Applies to OI 4H/24H, premium, participation, both RVOLs and SOPR — SOPR via
  its own daily bar time, so an observation is identified exactly rather than
  guessed from a value change.
- **"ETF 5D" was a claim the arithmetic could not support.** ETF flow is daily
  and US-trading-day only; sampling five calendar days re-counts a forward-filled
  Friday twice. Three declared shapes now, each labelled for what it actually
  sums: **ETF LAST 5 OBS** (needs the na-gated contract — one bar per
  observation, na everywhere else — and is the only true five-observation
  total), **ETF 5 CAL-DAY**, **ETF 30-BAR SUM**. The string "ETF 5D" no longer
  exists in the source. Fixtures cover Fri→Sat→Sun→Mon, a US holiday, and two
  consecutive sessions with an identical flow value.
- **The percentile was described as deciding the state.** It never did. Three
  roles are now fixed and labelled: RAW → direction, **σ → intensity, marked
  `[σ]` on the dashboard**, percentile → historical rarity and anomaly ranking.
  Their disagreement is measured rather than assumed: **21.3%** of 78,579
  readings, and the case that reads like a bug (`95.0p … NORMAL [σ]`) is
  **1.46%**, concentrated in the fat-tailed measures.
- **A branch-type mismatch Pine refuses to compile.** `array.shift()` returns
  the element it removed, so one branch of `pushEvent()` typed as `series int`
  while its sibling was `void` (CE10235). PineTS does no type checking, so the
  offline suite had run it since v3. Output after the fix is bit-identical.
  Check 0 now lints both `.pine` files for the pattern.
- **A one-line wrapper that silently zeroed every z-score.** History indexing on
  a series parameter does not survive a nested user-function call — `src[i]`
  collapsed to `src[0]`, every window sample became identical, σ went to zero.
  Caught by the standardisation check, not by inspection.

### Stated, not fixed

- The funding and liquidation adapters **cannot** skip repeats: an
  `input.source()` is never `na`, so a forward-filled upstream plot weights each
  observation by the bars it repeats across.
- Without the na gate, no single `input.source()` can tell a new ETF observation
  from a repeated one — two identical consecutive trading days look exactly like
  one carried forward.
- Seven 180-iteration window walks per bar (eleven with every adapter on).
  Whether that fits TradingView's execution-time budget is manual check A6.

### Verification

27 offline checks, up from 25. Full re-run: 13,164-bar extraction, hysteresis
cross-check (still identical to the compiled Pine on every bar), smoothing audit
(conclusions unchanged), OI 4H de-seasonalization (still REJECTED), cohort guard.
No threshold was changed.

---

## v3.1 — four correctness fixes found in review

No new features. Every change below removes a way the panel could display
something plausible and wrong.

### Fixed

- **Zero/missing open-interest observations no longer contaminate
  normalisation.** `oi / oi[1] - 1` only checked the *older* value for
  positivity, so a zero OI tick produced −100%, and `nz()` fed it into a 180-bar
  window. One −100% inflated the rolling σ ~4.5×, which did not make the panel
  noisy — it made it silent. Measured on the Binance history: **747 bars, 5.8%
  of it, OI 4H firing rate 21.5% → 1.5%.** Now both endpoints of a change must
  be valid observations (present, positive, base-unit, timestamped to this bar),
  `nz()` is gone everywhere in favour of carry-forward of the last *observed*
  value, and one filled series per measure is shared by the z-score and the
  percentile. After, on the same full history: σ **0.98×**, firing **22.3% inside
  vs 21.5% outside**, and the worst value the normaliser ever sees is −34.5%
  instead of −100%. With the variance no longer inflated, OI anomalies fire more
  often overall (OI 24H engaged bars 3,750 → 3,963) — no threshold was changed.
- **LIQ BALANCE no longer claims to be unit-free.** `(L−S)/(L+S)` is
  dimensionless, not unit-free — the subtraction needs comparable quantities.
  A new "both feeds share one source and unit" declaration defaults to **off**;
  without it the balance, percentile and σ are withheld and the row reads
  `DATA INCOMPARABLE`. A 1,000,000× scale mismatch still lands 100% inside
  [−1,+1], which is why range was never a validity check.
- **External adapter freshness is no longer worded as measured freshness.**
  DATA HEALTH is split in two. Timestamp-verified feeds keep FRESH / 1 BAR OLD /
  1D OLD / STALE. `input.source()` adapters get **ACTIVE / UNCHANGED 1 BAR /
  LIKELY STALE / MISCONFIGURED / UNAVAILABLE** — update activity, which is the
  only thing observable without an upstream timestamp. Readings are still
  suppressed at LIKELY STALE as a conservative choice, and the false positive
  (a live but constant feed) is demonstrated in the test suite, not hidden.
- **Footprint terminology.** `LIVE ORDER FLOW` → `LIVE FOOTPRINT`, with
  `Classified buy volume`, `Classified sell volume` and `Volume delta`.
  `request.footprint()` classifies lower-timeframe intrabars; it does not report
  which side removed liquidity. No user-visible string implies an aggressor tape.
- **A test that matched the wrong rows.** The section-order check searched for
  the bare word `FLOW`, which also appears in `ETF 5D UNUSUAL INFLOW`.

### Added — contracts, not features

- **Funding unit** input (decimal / percent / basis points), canonicalised to a
  decimal fraction. σ and percentile are scale-free, so a wrong unit was
  invisible everywhere except the printed rate.
- **ETF source shape** input (daily value repeated / per-bar increment). ETF
  flow is published daily; a daily plot carried across six 4H bars and summed as
  30 increments reads exactly **6×** too high.
- Four new regression checks (21–24), bringing the offline suite to **25**. The
  zero-OI check runs the v3.0 formula alongside as a control and fails if that
  control ever stops showing the damage.

### Status

**CORE READY FOR MANUAL VALIDATION**, not ready for normal use. Core acceptance
is A1–A5, B1–B7, C1, E1, E4, E6 in `TRADINGVIEW-VALIDATION.md`, plus the D
checks for each adapter actually enabled.

---

## v3 — fix semantics, add operational intelligence

**This version exists because v2 could print a false statement about the data.**
States were stored as `sign(z) × |z|`, so the direction word came out of a
z-score. With a sufficiently negative recent mean, a **−1.0% open-interest
change printed as EXPANDING**. Two axes had been fused into one number.

### Corrected

- **Direction and abnormality are now separate.** Every label is
  `<intensity> <direction>`. Direction is the sign of the **raw** measurement and
  nothing else; intensity is the σ ladder. Eight invariants (OI expansion,
  premium sign, funding sign, ETF flow, liquidation balance) are asserted on
  every bar of the test window — 0 violations in 8,941 signed observations.
- **One BTC price source.** Every price-derived feature — return, ATR, realised
  volatility, 24H change, trend distance, daily 200MA, 12-week momentum, perp
  RVOL, the premium numerator — now comes from a reference symbol, default
  `BINANCE:BTCUSDT.P`. v2 mixed the chart's own `close` with fixed BTC
  derivatives symbols, so the readings changed depending on which chart you put
  it on. The chart's `close` is now read in exactly one place: detecting an
  unwired adapter.
- **Exactly 4H, enforced.** 24H = 6 bars, same-slot RVOL, OI 24H and every event
  window are written in 4H bars. Any other timeframe now raises a runtime error
  instead of silently redefining "24H".
- **Stateful builtins are no longer called inside ternary branches.** v2 did this
  on nine series; a `ta.*` function skipped on the bars its branch is not taken
  has holes in its window, which corrupts every later value silently.
- **A stale feed can no longer leave a live anomaly standing.** The hysteresis
  ladder resets when its input goes `na`.
- **An adapter with under 50 bars of history reads MISCONFIGURED, not FRESH.**
  It cannot yet be distinguished from the chart's close, and an unproven adapter
  must not produce readings.

### Added

- **Percentile first.** Every row leads with the raw value, then its empirical
  percentile rank over the same window, then σ as secondary text. Crypto
  distributions are not normal; a σ implies one. Anomalies are ranked by
  `max(p, 100−p)`.
- **RECENT EVENTS** — the last five confirmed events with their age, so a glance
  answers "what did I miss". Written only on a confirmed 4H close, never twice
  in a row for the same line.
- **MARKET MECHANICS**, replacing v2's alignment count. `5/5 ALIGNED` was a
  number with no referent — those are five different quantities with different
  economics. The replacement is the one pairing that has a definition rather than
  a vote: price direction × position direction over the same 24 hours.
- **Long and short liquidation adapters**, each with its own enable toggle,
  source, freshness, percentile, spike detection and alert, plus a LIQ BALANCE
  described at the time as "unit-free" — **wrong, corrected in v3.1 above**.
  Spikes fire on the upper tail only — a quiet bar is not "unusually few
  liquidations".
- **DATA HEALTH** — nine feeds with alerts on becoming stale and on recovering.
  Timestamped feeds are measured against the bar time the symbol returned; the
  four `input.source()` adapters were given the same words, which **overstated
  what could be measured — corrected in v3.1 above**.
- **WHAT CHANGED** regrouped into NEW / NORMALIZED / CHANGED, and now fires on a
  direction change at unchanged intensity.
- **12-week momentum** row.
- `footprint-live.pine` — a **separate**, optional, Premium-only companion,
  marked LIVE / DESCRIPTIVE ONLY. TradingView documents footprint data as
  repainting by design, so it has no alerts and never enters the prospective
  event log. Its heading said "order flow", which **implied an aggressor tape it
  does not have — corrected in v3.1 above**.

### Renamed

`SPOT DOMINANT` / `PERP DOMINANT` → `RELATIVE SPOT SURGE` / `RELATIVE PERP
SURGE` / `NORMAL RELATIVE ACTIVITY`. The old words claimed dominance;
`partRaw > 0` only means spot RVOL exceeded perp RVOL, which is true most of the
time and means nothing on its own.

`BULLISH` / `BEARISH` → `ABOVE 200D` / `BELOW 200D` / `NEAR 200D`.

### Research

- **OI 4H same-UTC-slot de-seasonalization: tested and REJECTED.** A slot effect
  exists (per-slot σ varies 1.39×), but a 30-day same-slot window has a small
  standard deviation, so ordinary moves score high — false spikes rose from 2 to
  283. Pre-registered adoption rule, ground truth defined on the raw change, no
  market outcome used anywhere.
- **Prospective cohort integrity.** A log is stamped with schema, freeze,
  indicator hash, config hash and threshold version. The event log now exits 1
  rather than merge a new algorithm's rows into an old cohort's file.

### Verification

21 offline checks (was 9), including chart-symbol independence, semantic
invariants, percentile correctness, liquidation adapters end-to-end, stale and
misconfigured handling, recent-event dedup, market-mechanics arithmetic, table
row capacity and cohort routing. Everything not provable offline is listed in
`TRADINGVIEW-VALIDATION.md` as MANUAL REQUIRED rather than quietly dropped.

### Unchanged

No `BUY`, `SELL`, `LONG READY`, `DO NOT CHASE`, `REDUCE`, `RISK-ON` or
`RISK-OFF`. Every state remains DESCRIPTIVE. Nothing here predicts anything.

---

## v2 — Market Radar

Renamed from Market Intelligence. Action layer deleted after a matched-control
audit failed all three candidates. Measures split into REGIME / IMPULSE /
CONTEXT by a stability audit; hysteresis added for display stability only;
WHAT CHANGED and an anomaly list added; USD-notional open interest rejected at
runtime.

## v1 — Market Intelligence

First monitor build, with an action layer. See `audit/AUDIT.md`.
