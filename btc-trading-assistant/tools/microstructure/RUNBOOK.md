# M2 prospective collector — runbook

This is **research infrastructure, not part of the indicator**. Nothing it
records reaches `main.pine`. It exists to answer one pre-registered question:
does the Binance USDⓈ-M order book predict the next 30 seconds, measured on data
recorded *after* a public freeze?

Everything here is optional. The indicator works without ever running it.

---

## What it does

Two websocket connections to Binance USDⓈ-M futures — they are needed, not
preferred: `btcusdt@aggTrade` is served only on `/market/stream`, while
`depth@100ms` is served only on `/stream`. That was measured against the live
exchange on 2026-09-06, not taken from the documentation; a single-connection
collector written from prose alone silently records no trades.

It reconstructs the local order book by the exchange's published procedure and
invalidates it on **any** sequence violation — a `pu` mismatch, a first event
that does not bracket the snapshot, a crossed book, a stale feed, a disconnect.
While the book is invalid nothing is written. There is no "probably still fine"
state, and that single rule is what makes the sample worth anything.

Raw depth and trade events are archived so every feature is recomputable, plus a
1 Hz feature record so a 30-day study does not need a full replay.

---

## Run it

From the product root:

```bash
npm run collector
```

or directly:

```bash
cd tools/microstructure
node collector/run.mjs
```

It prints a status line every minute: book validity, phase, event counters, sequence
gaps, resyncs, reconnects, feed age and disk use.

Long-running:

```bash
nohup npm run collector > /tmp/collector.log 2>&1 &
```

**Only one collector may run at a time.** A pid lock file prevents a second
process from double-writing the archive; if you see a lock error, check for an
existing process before removing it.

Stopping is safe. `SIGINT`/`SIGTERM` flushes to disk, and on restart the writer
skips anything at or below the last durably written update id and aggregate
trade id, so a restart cannot double-ingest. That is asserted, not assumed: after
the migration into this directory the whole depth archive was re-read and showed
142,714 events with strictly increasing update ids, **0 duplicates and 0
out-of-order** across the restart boundary.

---

## The prospective boundary

This is the point of the whole exercise, so it is enforced in code rather than by
convention.

`research/M2-FREEZE.json` was generated from the pre-registration commit
(`64da583`). The collector **cannot leave `warmup` without it**, nor before its
timestamp, nor if its `schemaVersion` disagrees. Every record carries its phase;
the manifest counts phases per partition; the research loader accepts
`phase === 'prospective'` at the current schema version and nothing else.
Backfill therefore cannot become prospective by accident or by editing a date.

| | |
|---|---|
| Freeze commit | `64da58399bfb6b50f8901b7d2dd1c17ae8903130` |
| Frozen at | `2026-09-06T08:37:24.000Z` |
| Prospective start | `2026-09-06T08:37:34.395Z` |
| Schema version | `v1` |

These values survived the migration from `btc-microstructure/` unchanged — see
[`../../research/MIGRATION.md`](../../research/MIGRATION.md).

`npm run freeze` stamps a new marker from the current `HEAD`. **Do not run it.**
Re-freezing would start a new prospective sample and discard the identity of the
one already collecting.

---

## Run the study

```bash
npm run research:m2
```

Below its sample gate — 30 calendar days, 20 weekdays, 8 weekend days, 600 hours
of valid book — the runner writes `research/STATUS-M2.md` and **refuses to
compute a single directional statistic**. Above it, the same command runs the
whole pre-registered study and writes `research/RESULTS-M2.md`.

The runner is frozen and hashed in the pre-registration, so it does not need to
be written later, when the answer is already visible. It has been verified
against a synthetic series with a planted forward-only effect: it recovers the
effect when present and stays quiet when it is not. A runner that has never been
shown to find something cannot be trusted to report nothing.

---

## Tests

```bash
npm run test:collector
```

79 checks: book reconstruction against the exchange's continuity rule, feature
semantics, the append-safe writer, the prospective boundary, and the research
runner's refusal to produce a verdict below its gate.

---

## Storage

Append-only gzip NDJSON, one partition per UTC day per kind, sealed with a
sha256 at the day boundary, manifest written through a temp file and renamed.
Roughly 0.3 GB/day at the measured rate of 3.4 KB/s.

Data lives in `data/` and is gitignored: it is the study's evidence, not source.

Schema: [`data/SCHEMA.md`](./data/SCHEMA.md).

---

## What was removed

The Execution Planner UI, the M2-H historical replay pipeline and its backtest
interface used to live alongside this. They are gone: M2-H answered its question
— order-book information is real and roughly forty times too small to survive
commission — and it is recorded in
[`../../research/microstructure/m2h.md`](../../research/microstructure/m2h.md).
The implementation remains in git history at `8b3aeb1`, `8d283a1` and `5fac0d2`.

No order-book measurement appears in the indicator, and none should.
