# Architecture

Two products in one directory, deliberately not merged.

**A. Execution Planner** — works today, needs no directional edge, answers "if I have
already decided to buy or sell, how good is this market to execute in right now?"

**B. M2 directional research** — may emit LONG or SHORT only after passing the gates in
[`research/PRE-REGISTRATION-M2.md`](./research/PRE-REGISTRATION-M2.md), economics
included. If it never passes, A is unaffected.

```
                 ┌──────────────────────────┐   ┌───────────────────────┐
  fstream        │  /stream  depth@100ms    │   │  /market  aggTrade    │
  (two routes,   └────────────┬─────────────┘   └───────────┬───────────┘
   not one)                   │                             │
                       collector/ws.mjs  ── reconnect, rotate at 12h, staleness watchdog
                              │                             │
                     collector/book.mjs                 FlowWindows
                     buffer → snapshot → verify          1s / 5s / 30s
                     pu === previous u                       │
                     any violation ⇒ book_valid = false      │
                              │                             │
                              └──────────┬──────────────────┘
                                         │
                        features/book-features.mjs   (1 Hz, valid books only)
                        features/execution.mjs       (walk the book)
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
          collector/writer.mjs   execution-planner/     research/m2.mjs
          gzip NDJSON, daily     server.mjs + UI        sample gate → Part B → Part C
          partitions, manifest   read-only, no keys     STATUS-M2.md or RESULTS-M2.md
```

## Why two websocket connections

Measured against the live exchange on 2026-09-06 (`research/probe/payloads.json`):
`btcusdt@aggTrade` delivers nothing on `/ws`, `/stream` or `/public/stream` and only
works on `/market`; `depth@100ms` and `bookTicker` are the reverse. A single-connection
collector written from the documentation alone would silently record no trades. Each
connection has its own staleness watchdog; only the depth feed can invalidate the book.

## Book validity is binary

`collector/book.mjs` implements the exchange's published procedure exactly. On any
sequence violation — a `pu` mismatch, a first event that does not bracket the snapshot,
a crossed book, a stale feed, a disconnect — the book is invalidated **immediately**,
`lastUpdateId` is cleared so nothing can quietly resume, and a fresh snapshot is
required. While invalid:

- no feature record is written,
- the planner shows no execution estimate,
- the research loader has nothing to load for those seconds.

There is no "probably still fine" state. That single rule is what makes the prospective
sample worth anything.

## Prospective identity is enforced in code

`research/M2-FREEZE.json` is generated from the pre-registration commit by
`npm run freeze`. The collector reads it and **cannot leave `warmup` without it**, nor
before its timestamp, nor if its `schemaVersion` disagrees. Every record carries its
phase; the manifest counts phases per partition; the research loader takes
`phase === 'prospective'` and the current schema version and nothing else. Backfill
therefore cannot become prospective by accident or by editing a date.

## Storage

Append-only gzip NDJSON, one partition per UTC day per kind, sealed with a sha256 at the
day boundary, manifest written through a temp file and renamed. Restart-safe: the
collector records the last durably written `u` and aggregate trade id and skips anything
at or below them, so a restart cannot double-ingest. Raw depth and trades are kept so
every feature is recomputable; the 1 Hz feature record exists so a 30-day study does not
need a full replay. Schema in [`data/SCHEMA.md`](./data/SCHEMA.md).

## The research runner does not need to be rewritten later

`research/m2.mjs` is frozen (hashed in the pre-registration) and already contains the
whole study. Below the sample gate it writes `STATUS-M2.md` and refuses to compute a
single directional statistic; above it, the same command runs Part B and Part C and
writes `RESULTS-M2.md`. It is verified now, against a synthetic series with a planted
forward-only effect, that it recovers the effect when present and stays quiet when it is
not — a runner that has never been shown to find something cannot be trusted to report
nothing.

## Where a false signal could reach a person, and what stops it

| path | guard |
|---|---|
| UI invents a direction | tests assert LONG / SHORT / BUY NOW / SELL NOW appear nowhere outside the "no validated signal" disclaimer |
| book pressure read as a signal | labelled `CONTEXT — NOT A DIRECTIONAL SIGNAL` in the payload and in the UI, both tested |
| stale or invalid data shown as live | feed ages and book validity rendered; an invalid book blanks the estimate |
| someone flips a "validated" flag by hand | the server derives it from `research/results-m2.json` gate outcomes, tested |
| maker economics used to rescue a failing signal | the maker profile is marked `usableForAcceptance: false`; the economic gate ignores it; tested |
| a fitted "quality score" passed off as alpha | quality is a comparison against a user-set limit, and with no limit it refuses to grade |
