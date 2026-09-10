# TradingView Indicators

## BTC Trading Assistant

One BTC TradingView indicator. A trade plan takes four settings — direction,
stop, account equity, risk % — and everything else has a default:

- confirmed 4H market context — trend, volatility, positioning
- entry follows the market, the stop is yours, and the target defaults to 2R
- cost-aware, fixed-risk position sizing
- break-even, risk and reward zones, R targets
- live R and estimated net P&L once the trade is on
- plan alerts

It does not generate buy or sell signals, and says so on the panel every bar.
Eight pre-registered studies looked for a tradable directional edge and none found
one — see [`btc-trading-assistant/research/EVIDENCE.md`](./btc-trading-assistant/research/EVIDENCE.md).

Path:
`btc-trading-assistant/main.pine`

## Session Highs and Lows

Published session indicator.

Path:
`session-highs-and-lows-indicator/main.pine`

---

Research evidence and rejected hypotheses are documented under
[`btc-trading-assistant/research/`](./btc-trading-assistant/research/).

---

## How this repo works

### One directory per indicator

```
<indicator-name>/
├── README.md      # Purpose, inputs, behaviour notes, limitations
├── CHANGELOG.md   # TradingView release notes, kept in sync and paste-ready
├── main.pine      # The indicator itself — this is what you paste into Pine Editor
├── tests/         # Offline test suite
└── package.json
```

### Verification is offline, not eyeballed

Pine Script has no official local runtime. The usual workflow is to paste a
change back into TradingView and check the chart by eye, which says very little
about whether the *numbers* are right — and is close to useless for cases like
daylight saving transitions or weekend market gaps.

So the indicators here run their actual `.pine` source on Node through
[PineTS](https://github.com/LuxAlgo/PineTS) and reconcile the output offline:

```bash
cd <indicator-name>
npm install
npm test
```

Ground truth in these tests is deliberately **not** a re-run of the same logic.
It is computed by a different algorithm and then compared — agreement only means
something if the two derivations are independent. Indicators that involve time,
persistent state, or drawings also carry a no-repaint prefix-invariance test.

`btc-trading-assistant` needs a local 4H dataset built once with
`btc-trading-assistant/tools/fetch-4h.mjs` — Binance history, deliberately not
committed. It also keeps the two indicators it replaced under `tests/baseline/`,
so its migration differential stays runnable.

Where a test genuinely cannot run offline, it is listed as **TRADINGVIEW MANUAL
VALIDATION REQUIRED** rather than quietly dropped — see each indicator's
`TRADINGVIEW-VALIDATION.md`.

### Research is published even when it fails

`btc-trading-assistant/research/` documents eight pre-registered studies that
looked for a tradable directional edge in BTC — 4H regime state, 96 trade-rule
combinations, intraday breakout/sweep/VWAP setups, a published academic
replication, raw aggressive trade flow, and years of Level-2 order-book data.
**None produced one that survives trading costs**, which is why neither indicator
here generates buy or sell signals.

Publishing the tests that killed a design is more useful than publishing the
design.

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
   TradingView it is shown in the script title.
2. **Symbol and timeframe** — e.g. `BINANCE:BTCUSDT.P`, 4H.
3. **What you expected** and **what you saw**.
4. **A screenshot** of the chart, with the indicator's panel visible.
5. **Your input settings**, if you changed any from the defaults.

## Licence

MPL-2.0. See [`LICENSE`](./LICENSE).
