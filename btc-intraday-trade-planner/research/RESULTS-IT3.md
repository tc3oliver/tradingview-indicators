# IT3 — results: lower-turnover 1H short-horizon trading

RETROSPECTIVE RESEARCH, 2020-01 → 2026-09, Binance BTCUSDT perpetual 1H (aggregated from the 15m cache). Rules frozen in PRE-REGISTRATION-IT2-IT3.md (commit b2ac11d) before IT2 ran. IT3 ran because IT2 was REJECT.

Effective N for the DSR: prior 102 + IT3 12.0 (24 configurations, eigen 12.0, clusters 3) = 115. SR0 = 1.53 annualised.

## Verdicts

- **REJECTED**: 6

## Economic feasibility (development split): cost / planned risk

| # | candidate | median planned risk (% of price) | 0.14% RT ÷ median risk | feasible (≤ 0.10) |
|---|---|---|---|---|
| 1 | A long stop2.5 hold48 range24 | 2.1% | 0.079 | ✓ |
| 2 | A short stop2.5 hold48 range24 | 2.3% | 0.070 | ✓ |
| 3 | B long stop2.5 hold48 thr1 | 2.4% | 0.057 | ✓ |
| 4 | B short stop2.5 hold48 thr1 | 2.6% | 0.050 | ✓ |
| 5 | C long stop2.5 hold48 thr1 | 2.6% | 0.050 | ✓ |
| 6 | C short stop2.5 hold48 thr1 | 2.4% | 0.056 | ✓ |

## Primary candidates — validation ∪ test (0.14% RT)

| # | candidate | verdict | failed | n | expR | win | avgW/avgL | PF | PF ex-5% | Sharpe | Sortino | maxDD | Calmar | MAE avg/worst | MFE | expo | trades/yr | hold (bars) | stop% | streak | top win | dev expR (n) | val expR (n) | test expR (n) | @0.20% | @0.30% | DSR |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A long stop2.5 hold48 range24 | REJECTED | G1 G2 G3 G5 G7 G8 G9 | 401 | -0.06 | 38.9% | 1.46/-1.02 | 0.91 | 0.75 | -0.54 | -0.77 | 41.0% | -0.22 | -0.95/-4.39 | 1.16 | 39.5% | 150 | 23 | 54.4% | 16 | 0.9% | 0.05 (565) | -0.01 (228) | -0.12 (173) | -0.10 | -0.17 | 0.000 |
| 2 | A short stop2.5 hold48 range24 | REJECTED | G1 G2 G3 G5 G7 G8 G9 | 374 | 0.01 | 40.4% | 1.55/-1.02 | 1.02 | 0.86 | 0.12 | 0.19 | 22.1% | 0.03 | -0.91/-3.27 | 1.21 | 35.0% | 139 | 22 | 53.7% | 12 | 0.8% | -0.10 (490) | 0.04 (197) | -0.01 (177) | -0.03 | -0.09 | 0.011 |
| 3 | B long stop2.5 hold48 thr1 | REJECTED | G1 G2 G3 G5 G7 G8 G9 | 140 | -0.12 | 40.0% | 1.12/-0.95 | 0.79 | 0.62 | -0.71 | -1.02 | 22.3% | -0.29 | -0.87/-2.23 | 1.03 | 17.5% | 52 | 29 | 51.4% | 6 | 3.1% | -0.10 (195) | -0.12 (80) | -0.13 (60) | -0.16 | -0.21 | 0.000 |
| 4 | B short stop2.5 hold48 thr1 | REJECTED | G1 G9 | 118 | 0.14 | 44.1% | 1.52/-0.95 | 1.27 | 1.08 | 0.71 | 1.12 | 10.8% | 0.55 | -0.83/-2.47 | 1.24 | 13.4% | 44 | 27 | 46.6% | 6 | 2.5% | -0.13 (154) | 0.09 (65) | 0.21 (53) | 0.11 | 0.06 | 0.088 |
| 5 | C long stop2.5 hold48 thr1 | REJECTED | G1 G2 G3 G5 G7 G8 G9 | 122 | -0.18 | 36.1% | 1.17/-0.95 | 0.70 | 0.51 | -1.02 | -1.36 | 25.5% | -0.33 | -0.95/-2.43 | 0.93 | 13.4% | 45 | 26 | 54.1% | 9 | 3.8% | 0.03 (156) | -0.08 (67) | -0.31 (55) | -0.22 | -0.27 | 0.000 |
| 6 | C short stop2.5 hold48 thr1 | REJECTED | G1 G2 G3 G5 G7 G8 G9 | 143 | -0.17 | 36.4% | 1.24/-0.97 | 0.73 | 0.55 | -0.92 | -1.26 | 25.7% | -0.34 | -0.92/-2.48 | 1.06 | 19.0% | 53 | 31 | 53.1% | 6 | 3.0% | -0.15 (202) | -0.26 (81) | -0.04 (62) | -0.20 | -0.26 | 0.000 |

## Year breakdown (validation ∪ test, net R / trades) and neighbours

| # | candidate | 2024 | 2025 | 2026 | n1 stop2.0 | n2 hold24 | n3 window/thr |
|---|---|---|---|---|---|---|---|
| 1 | A long stop2.5 hold48 range24 | 8.7 / 153 | -32.2 / 154 | 1.3 / 94 | -0.05 (450) | -0.08 (443) | -0.04 (291) |
| 2 | A short stop2.5 hold48 range24 | 1.7 / 128 | 8.9 / 142 | -5.4 / 104 | -0.07 (420) | -0.03 (398) | -0.00 (272) |
| 3 | B long stop2.5 hold48 thr1 | 3.2 / 54 | -12.2 / 50 | -8.1 / 36 | -0.11 (143) | -0.10 (141) | -0.12 (229) |
| 4 | B short stop2.5 hold48 thr1 | 2.5 / 38 | 5.1 / 51 | 9.0 / 29 | 0.10 (123) | 0.07 (120) | 0.04 (215) |
| 5 | C long stop2.5 hold48 thr1 | -7.0 / 40 | -5.4 / 52 | -10.1 / 30 | -0.31 (122) | -0.20 (123) | -0.12 (239) |
| 6 | C short stop2.5 hold48 thr1 | -24.0 / 56 | -2.1 / 50 | 2.1 / 37 | -0.15 (144) | -0.16 (145) | -0.19 (258) |

## Gate detail

| # | candidate | G0 | G1 | G2 | G3 | G4 | G5 | G6 | G7 | G8 | G9 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A long stop2.5 hold48 range24 | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| 2 | A short stop2.5 hold48 range24 | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| 3 | B long stop2.5 hold48 thr1 | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| 4 | B short stop2.5 hold48 thr1 | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| 5 | C long stop2.5 hold48 thr1 | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| 6 | C short stop2.5 hold48 thr1 | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |

## All 24 configurations — validation ∪ test

| config | role | feasible | n | expR | PF | Sharpe | maxDD |
|---|---|---|---|---|---|---|---|
| A long stop2.5 hold48 range24 | primary | ✓ | 401 | -0.06 | 0.91 | -0.54 | 41.0% |
| A short stop2.5 hold48 range24 | primary | ✓ | 374 | 0.01 | 1.02 | 0.12 | 22.1% |
| B long stop2.5 hold48 thr1 | primary | ✓ | 140 | -0.12 | 0.79 | -0.71 | 22.3% |
| B short stop2.5 hold48 thr1 | primary | ✓ | 118 | 0.14 | 1.27 | 0.71 | 10.8% |
| C long stop2.5 hold48 thr1 | primary | ✓ | 122 | -0.18 | 0.70 | -1.02 | 25.5% |
| C short stop2.5 hold48 thr1 | primary | ✓ | 143 | -0.17 | 0.73 | -0.92 | 25.7% |
| A long stop2 hold48 range24 | n1 | ✗ | 450 | -0.05 | 0.92 | -0.52 | 45.8% |
| A long stop2.5 hold24 range24 | n2 | ✓ | 443 | -0.08 | 0.85 | -0.91 | 45.3% |
| A long stop2.5 hold48 range48 | n3 | ✓ | 291 | -0.04 | 0.94 | -0.32 | 31.9% |
| A short stop2 hold48 range24 | n1 | ✓ | 420 | -0.07 | 0.90 | -0.64 | 32.7% |
| A short stop2.5 hold24 range24 | n2 | ✓ | 398 | -0.03 | 0.95 | -0.25 | 25.1% |
| A short stop2.5 hold48 range48 | n3 | ✓ | 272 | -0.00 | 1.00 | -0.03 | 23.6% |
| B long stop2 hold48 thr1 | n1 | ✓ | 143 | -0.11 | 0.83 | -0.56 | 21.9% |
| B long stop2.5 hold24 thr1 | n2 | ✓ | 141 | -0.10 | 0.78 | -0.71 | 18.4% |
| B long stop2.5 hold48 thr0.5 | n3 | ✓ | 229 | -0.12 | 0.80 | -0.88 | 29.6% |
| B short stop2 hold48 thr1 | n1 | ✓ | 123 | 0.10 | 1.16 | 0.48 | 13.5% |
| B short stop2.5 hold24 thr1 | n2 | ✓ | 120 | 0.07 | 1.16 | 0.39 | 9.9% |
| B short stop2.5 hold48 thr0.5 | n3 | ✓ | 215 | 0.04 | 1.07 | 0.27 | 13.0% |
| C long stop2 hold48 thr1 | n1 | ✓ | 122 | -0.31 | 0.58 | -1.60 | 34.3% |
| C long stop2.5 hold24 thr1 | n2 | ✓ | 123 | -0.20 | 0.64 | -1.22 | 24.7% |
| C long stop2.5 hold48 thr0.5 | n3 | ✓ | 239 | -0.12 | 0.80 | -0.96 | 32.5% |
| C short stop2 hold48 thr1 | n1 | ✓ | 144 | -0.15 | 0.78 | -0.81 | 24.3% |
| C short stop2.5 hold24 thr1 | n2 | ✓ | 145 | -0.16 | 0.65 | -1.07 | 24.7% |
| C short stop2.5 hold48 thr0.5 | n3 | ✓ | 258 | -0.19 | 0.70 | -1.43 | 42.4% |
