# TradingView Indicators

Pine Script indicators I use for my own trading, published as open source.

Each indicator lives in its own directory with full documentation, its release
history, and **tests you can run locally**.

---

## Indicators

| Indicator | Description | Version |
|---|---|---|
| [session-highs-and-lows-indicator](./session-highs-and-lows-indicator/) | Marks the high and low of each SMC/ICT killzone with labels and extended dashed lines | v3.1 |
| [btc-4h-market-intelligence](./btc-4h-market-intelligence/) | **BTC 4H Market Radar** — monitors OI, funding, perp premium, spot-vs-perp participation, liquidations, ETF flow and SOPR. Default **Decision** view answers four questions in ten to fourteen rows of plain English: what state the market is in, whether volatility is higher than usual, the one thing worth looking at, and whether the data is healthy. Detailed and Debug modes expose every number behind it. Direction from raw values, abnormality from percentiles. No score, no signal, no action, no position size | v3.3 |
| [btc-4h-trade-planner](./btc-4h-trade-planner/) | **Trade Risk Planner** — mechanical risk converter for discretionary trades on any symbol and timeframe: you pick direction, entry and invalidation; it computes position size for a fixed account risk, draws the stop and R ladder, and tracks a non-repainting trailing reference. Generates no signals, because the same directory's pre-registered study of 96 entry/exit rules validated none of them | v1.0 |

## Research

| Directory | What it is |
|---|---|
| [btc-4h-regime-engine](./btc-4h-regime-engine/) | The falsification record behind the indicator above. Five pre-registered hypotheses on 13,164 bars of 4H BTC, all failed, with a trial registry and a Deflated Sharpe Ratio computed from the actual search |
| [btc-4h-trade-planner/research](./btc-4h-trade-planner/) | Study TP1: 96 pre-registered trade-rule configurations (bias × entry × stop × trail × direction) against ten acceptance gates. 76 rejected, 20 insufficient, 0 passed — so the planned `strategy()` was not built, and the Trade Risk Planner shipped without signals |
| [btc-intraday-trade-planner](./btc-intraday-trade-planner/) | Three pre-registered studies, all failed. **IT1**: 36 15m setup candidates (opening-range breakout, sweep & reclaim, VWAP reclaim; London / New York; long / short) + 108 neighbours — 31 rejected, 5 insufficient. **IT2**: replication of Shen, Urquhart & Wang (2022) *Bitcoin intraday time-series momentum* — not replicated on Binance in the paper's own period (t 0.25) or post-publication (t 0.69); gross edge 0.01%/trade vs 0.14% cost. **IT3**: 1H fallback with 2.5-ATR stops (cost only 5–8% of risk) — 6 of 6 rejected. Includes the DSR effective-trial-count correction (849 raw entries → 115 effective) and a DST-correct session seasonality audit |

Those last two entries have no indicator in them, deliberately. Publishing the
tests that killed a design is more useful than publishing the design.

---

## How this repo works

### One directory per indicator

```
<indicator-name>/
├── README.md      # Purpose, session/input definitions, behaviour notes, limitations
├── CHANGELOG.md   # TradingView release notes, kept in sync and paste-ready
├── main.pine      # The indicator itself — this is what you paste into Pine Editor
├── tests.mjs      # Offline test suite
└── package.json
```

### Verification is offline, not eyeballed

Pine Script has no official local runtime. The usual workflow is to paste a change
back into TradingView and check the chart by eye, which says very little about
whether the *numbers* are right — and is close to useless for cases like daylight
saving transitions or weekend market gaps.

So the indicators here run their actual `.pine` source on Node through
[PineTS](https://github.com/LuxAlgo/PineTS) and reconcile the output offline:

```bash
cd <indicator-name>
npm install
npm test
```

`btc-4h-market-intelligence` additionally needs a local dataset built once with
`btc-4h-regime-engine/data/fetch.mjs` — 93 MB of Binance history, deliberately
not committed.

Where a test genuinely cannot run offline, it is listed as **TRADINGVIEW MANUAL
VALIDATION REQUIRED** rather than quietly dropped — see
`btc-4h-market-intelligence/TRADINGVIEW-VALIDATION.md`. That indicator is
currently **CORE READY FOR MANUAL VALIDATION**, not ready for normal use.

Ground truth in these tests is deliberately **not** a re-run of the same logic. It
is computed by a different algorithm and then compared — agreement only means
something if the two derivations are independent. Indicators that involve time,
persistent state, or drawings also carry a no-repaint prefix-invariance test.

See each indicator's own README for details.

### Shared limitations

- **PineTS is not TradingView.** It is a third-party reimplementation of the
  runtime. Passing tests mean the logic is self-consistent, not that TradingView
  will behave identically. Always paste back into the Pine Editor and check the
  chart before publishing.
- Visual output (label placement, line styling) and alert firing cannot be
  verified locally.
- **No CI.** The tests fetch candles from Binance's public API, which blocks the
  US-based GitHub Actions runners. Run the tests locally.

---

## Reporting an issue

Please include these five things when opening an [issue](../../issues). Without
them there is no way to tell which version the report is even about:

1. **Indicator name and version** — see that indicator's `CHANGELOG.md`; on
   TradingView, check which release you have loaded
2. **Symbol** (e.g. `BINANCE:BTCUSDT`, `OANDA:EURUSD`)
3. **Timeframe** (e.g. 15m)
4. **Chart timezone** — the setting in TradingView's bottom-right corner
5. **A screenshot**

Items 1 and 4 are the most common root causes. Session definitions have changed
between releases, and the timezone a session is attributed to is not necessarily
the one your chart displays.

---

## Contributing

Issues and pull requests are welcome. For a pull request that changes indicator
logic, please run `npm test` in that indicator's directory and include the output.
If the change is intentionally meant to alter plotted values, say so explicitly —
the differential test is expected to fail in that case, and the baseline needs to
be updated deliberately rather than silently.

---

## License

[MPL-2.0](./LICENSE) © tc3oliver

[PineTS](https://github.com/LuxAlgo/PineTS), used by the test harness, is AGPL-3.0.
It is a development-time dependency only and is not part of the published `.pine`
files.
