# M2 status — COLLECTING

Generated 2026-09-06T08:43:49.492Z. Schema `v1`.

**No statistical outcome analysis has been run.** The pre-registered minimum
prospective sample (PART C1) has not been reached, and the runner refuses to
produce a directional verdict before it is. This is the designed behaviour, not
a failure: a few days of order-book data can produce a significant-looking
coefficient of either sign, which is exactly the failure mode the gate exists to
prevent.

## Prospective coverage

| requirement | have | need | met |
|---|---|---|---|
| calendar days | 1 | 30 | no |
| weekday days | 0 | 20 | no |
| weekend days | 1 | 8 | no |
| valid-book hours | 0.1 | 600 | no |
| volatility spread (p90/p10 of hourly realised vol) | n/a | 2 | no |

Prospective sample started: **2026-09-06T08:37:34.395Z**.
Feature records loaded: 268. Disk used: 1.0 MB.

## What runs when the gate is met

Nothing needs to be rewritten. `npm run research:m2` will then execute Part B
(execution study: immediate versus waiting 5 s and 30 s, both order sides, both
sizes, the four pre-registered execution hypotheses, and passive-buy toxicity as
a measurement) and Part C (six directional feature families across three
horizons with chronological splits, decile monotonicity, the effective-trial
correction and the three cost profiles), and write `RESULTS-M2.md`.
