# Raw data schema

Schema version **`v1`**. A change to event semantics, sequence semantics or event
assignment bumps this version; a version bump starts a new prospective identity rather
than inheriting the old one, and the loader refuses to merge across versions.

## Layout

```
data/
├── MANIFEST.json                 # one entry per partition
├── PROSPECTIVE.json              # M2_PROSPECTIVE_START, written once, never rewritten
├── collector-state.json          # last durably written ids, for restart-safe resume
└── l2/v1/<YYYY-MM-DD>/
    ├── depth.ndjson.gz           # every depthUpdate
    ├── trades.ndjson.gz          # every aggTrade
    ├── meta.ndjson.gz            # snapshots, resyncs, reconnects, invalidations
    └── features.ndjson.gz        # one derived record per second
```

**Format.** Newline-delimited JSON, gzipped per flush batch and appended. Concatenated
gzip members are a valid gzip stream (RFC 1952 §2.2), so `gunzip -c file.ndjson.gz`
reads the whole partition, a crash costs at most the last unflushed batch, and no file
is ever rewritten in place.

**Partitioning.** One directory per UTC day, by *local receive time*, so a partition is
closed by the clock that wrote it.

## `depth.ndjson.gz`

One record per `depthUpdate`, fields kept exactly as they arrive.

| field | meaning |
|---|---|
| `e` | `"depthUpdate"` |
| `E` | exchange event time (ms) |
| `T` | exchange transaction time (ms) |
| `U` | first update id in this event |
| `u` | final update id in this event |
| `pu` | final update id of the *previous* event — the continuity check |
| `b`, `a` | `[[price, qty], …]` as strings; qty is **absolute**, `0` removes the level |
| `recvMs` | local receive time (ms) |
| `phase` | `warmup` or `prospective` |

The wire also carries `s`, `ps` and `st`; they are not needed to rebuild the book and
are not stored. The parser ignores unknown fields rather than assuming a fixed shape.

## `trades.ndjson.gz`

| field | meaning |
|---|---|
| `a` | aggregate trade id |
| `p`, `q` | price and quantity, strings |
| `f`, `l` | first and last trade id in the aggregate |
| `T` | trade time (ms) · `E` event time (ms) |
| `m` | **`true` = the buyer was the maker**, so the seller was the aggressor |
| `recvMs`, `phase` | as above |

Aggressive buy quote notional is `p × q` where `m === false`. The wire field `nq` is
present and equalled `q` in every observed BTCUSDT sample; it is not stored and not used.

## `meta.ndjson.gz`

The audit trail. Without it a gap in the data is indistinguishable from a quiet market.

| `type` | when |
|---|---|
| `ws_open`, `ws_reconnect`, `ws_rotate`, `ws_stale` | connection lifecycle |
| `resync_begin` | a snapshot has been requested, with the reason |
| `snapshot` | a snapshot was applied (`lastUpdateId`, level counts, whether it took) |
| `snapshot_error` | a failed attempt, with the error |
| `book_invalid` | the book lost sequence integrity, with the reason and the ids involved |
| `book_valid` | the book regained integrity |

## `features.ndjson.gz`

One record per second, emitted **only** while the book is sequence-verified. Derived,
and fully recomputable from `depth` and `trades`.

| group | fields |
|---|---|
| identity | `at`, `lastUpdateId`, `eventMs`, `recvMs`, `phase`, `schemaVersion` |
| price | `bid`, `ask`, `bidQty`, `askQty`, `mid`, `spread`, `spreadBp`, `microprice`, `micropriceDisplacementBp` |
| depth | `depth.bid` / `depth.ask` → `top1`, `top5`, `top10`, `within1bp`, `within2bp`, `within5bp`, `within10bp`, all in quote notional |
| imbalance | `imbalance.top1`, `.top5`, `.top10`, `.weighted` |
| liquidity | `slope.bid`, `slope.ask`, `bidLevels`, `askLevels` |
| flow | `flow["1000ms" / "5000ms" / "30000ms"]` → `buyQuote`, `sellQuote`, `signedQuote`, `trades`, `afi` |
| interaction | `interaction.pressureToCapacity`, `.flowOverOppositeNearDepth`, `.flowTimesImbalance`, `.flowTimesFragility` |
| execution | `exec.BUY[10000 \| 50000]` and `exec.SELL[…]` → `vwap`, `slippageBp`, `allInBp`, `complete`, `levels` |

## `MANIFEST.json`

Per partition (`"<day>/<kind>"`):

`day`, `kind`, `events`, `firstMs`, `lastMs`, `phases` (per-phase counts),
`sequenceGaps`, `resyncs`, `reconnects`, `bytes`, `sha256` (set when sealed), `open`,
`collectorVersion`, `schemaVersion`. Top level also carries `updatedAt` and
`diskBytes`.

Partitions are sealed at the day boundary: sized, checksummed and marked `open: false`.
The manifest is written through a temp file and renamed, so a crash never leaves it
half-written.

## Disk

Measured on BTCUSDT: depth ≈ 10 msg/s, aggTrade ≈ 4.5 msg/s, features 1/s, and about
**3.4 KB/s compressed** — roughly **0.3 GB per day**, so a 30-day prospective sample is
on the order of **9 GB**. That figure was taken on a quiet weekend; an active weekday
will be higher. Live usage is reported by the collector and on the planner's integrity
panel. `bookTicker` (~140 msg/s) is deliberately not persisted.


---

# Historical feature store (M2-H)

Separate tree, separate version, and never merged with the live prospective data.

```
data/historical/
├── MANIFEST-M2H.json          # per day: rows, bytes, sha256, coverage, source
├── fs1/<YYYY-MM-DD>.fs.gz     # one columnar file per replayed UTC day
└── .scratch/                  # vendor archives in flight, deleted after each day
```

**Format.** A JSON header line (padded so the data starts on an 8-byte boundary), then the
concatenated Float64 column buffers in the fixed order given by `COLUMNS` in
`historical/store.mjs`, all gzipped. Adding or reordering a column is a **store version
bump**, not an edit. About 23 MB per day for 86,400 rows × 53 columns.

**Columns.** The same measurements the live collector writes, plus the pre-declared
execution estimates: identity (`at`), price (`bid`, `ask`, `mid`, `spreadBp`,
`microprice`, `micropriceDisplacementBp`), depth by band and by level for both sides,
imbalances, flow over 1 s / 5 s / 30 s, the four interactions, and
`exec{Buy,Sell}{10k,50k}{Vwap,SlipBp,Complete}`.

**Provenance.** Every entry in `MANIFEST-M2H.json` records `source`, `depthEvents`,
`tradeEvents`, `snapshots`, `crossedBooks`, `invalidations`, `maxBookLevels`,
`validCoveragePct`, `pruneBandPct`, `archiveBytes`, `bytes` and `sha256`.
`npm run m2h:verify` re-checksums the tree.

**Derived, not a source.** The store is regenerable from the vendor archives by
`npm run m2h:replay`. The raw archives are not kept: they are 400 MB–1 GB per day and
re-downloadable, whereas the live prospective raw log *is* kept because it cannot be.
