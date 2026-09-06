# Runbook

## Use it

```bash
cd btc-microstructure
npm start
```

Open **http://localhost:8787**. That is the whole setup: no `npm install` (there are no
dependencies), no API key, no configuration file. Node 22 or newer.

The book needs a few seconds to sequence-verify after start; until then the page shows
`INVALID` and no execution estimate, which is correct behaviour rather than a fault.

**It is read-only.** It subscribes to public market data and places no orders, ever.
There is no credential handling in the codebase and a test enforces that.

## What you see

- pick **BUY** or **SELL**, type a size in USDT (or use the 1k / 10k / 50k / 100k presets);
- the planner walks the current order book and shows estimated VWAP, worst fill,
  slippage against the mid, the book impact separately from the half-spread, the taker
  fee, and the all-in cost in bp and in dollars;
- liquidity state and book pressure as **context**;
- a data-integrity panel: book validity, feed ages, sequence gaps, resyncs, reconnects,
  disk used.

There is **no LONG/SHORT output** and there will not be one until the directional study
passes its gates.

## Get a GOOD / POOR verdict

The planner will not grade your execution unless you tell it what "good" means:

```bash
M2_MAX_COST_BP=8 npm start
```

Now an all-in cost at or below 8 bp reads GOOD and anything above reads POOR. Without
it the verdict is `NOT GRADED` and the numbers are shown plainly — the tool does not
invent a threshold on your behalf.

## Collect data 24/7

```bash
npm run collector          # headless, no web server
```

Prints one status line per minute. Stop with Ctrl-C; it flushes to disk on the way out
and resumes without re-ingesting anything.

To keep it running across logouts on macOS or Linux:

```bash
nohup npm run collector > collector.log 2>&1 &
```

Expect roughly **0.3–0.6 GB per day**. A 30-day prospective sample is 10–20 GB.

## Run the research

```bash
npm run research:m2
```

Below the pre-registered sample gate this writes `research/STATUS-M2.md` saying
**COLLECTING — INSUFFICIENT** and computes no directional statistic at all. Once the
gate is met, the same command runs the execution study and the directional study and
writes `research/RESULTS-M2.md`. **No code needs to change in between.**

## Tests

```bash
npm test        # 89 checks: book, execution, storage, prospective boundary, research, UI
npm run test:m1 # the earlier study's estimator and feature invariants
```

## Configuration

Everything is an environment variable; nothing needs editing.

| variable | default | meaning |
|---|---|---|
| `M2_PORT` | `8787` | planner port |
| `M2_MAX_COST_BP` | unset | your maximum acceptable all-in cost, in bp |
| `M2_SYMBOL` | `BTCUSDT` | symbol |
| `M2_TAKER_BP` / `M2_MAKER_BP` | `5` / `2` | fee rates, read 2026-09-06, VIP 0 |
| `M2_RECONNECT_HOURS` | `12` | pre-emptive rotation inside the exchange's 24 h cap |
| `M2_STALE_MS` | `5000` | depth feed staleness threshold |

## Operating notes

**The book keeps going invalid.** Normal in bursts: a sequence gap forces a resync, and
a resync takes a few hundred milliseconds. Persistent invalidity means the depth feed is
not arriving — check `meta.ndjson.gz` for `ws_reconnect` and `snapshot_error` records.

**Sequence gaps are counted, not hidden.** A rising gap count with a healthy feed
usually means the process is CPU-starved and dropping messages behind the socket.

**Disk.** `data/l2/` is not committed and is not pruned automatically. Check the
integrity panel or `data/MANIFEST.json` → `diskBytes`.

**Restarting is safe** at any time. The collector records the last durably written
update id and aggregate trade id and skips anything at or below them, so no record is
ingested twice. Restarting does *not* restart the prospective sample: that boundary is
fixed once by `data/PROSPECTIVE.json` and never rewritten.

**If a collector bug changes what a field means**, bump `SCHEMA_VERSION` in
`collector/config.mjs`. That deliberately invalidates the existing prospective identity —
old data stays readable but the loader will not merge it, and the sample starts again.
That is the intended cost of a semantic change, not something to work around.

## Freezing (already done — for reference)

`npm run freeze` stamps `research/M2-FREEZE.json` from the current `HEAD`, which is what
authorises the collector to leave WARMUP. It refuses to overwrite an existing marker.
