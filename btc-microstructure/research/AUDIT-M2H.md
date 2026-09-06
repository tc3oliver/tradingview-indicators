# M2-H book reconstruction audit

One row per replayed UTC day. Bad intervals are excluded from the study, never interpolated:
a second without a valid book produces no feature record and therefore no observation.

| day | depth events | level rows | trades | snapshots | crossed | invalidations | max levels | valid coverage | archive | store |
|---|---|---|---|---|---|---|---|---|---|---|
| 2020-06-01 | 10.76M | 86,396 | 922k | 1 | 0 | 0 | 4069 | 100.0% | 0 MB | 23.3 MB |
| 2020-07-01 | 8.45M | 86,400 | 446k | 2 | 0 | 0 | 4502 | 100.0% | 0 MB | 22.0 MB |
| 2020-08-01 | 10.65M | 86,400 | 1058k | 1 | 0 | 0 | 3090 | 100.0% | 403 MB | 23.9 MB |
| 2020-09-01 | 9.80M | 86,397 | 688k | 5 | 0 | 0 | 3320 | 100.0% | 340 MB | 22.1 MB |
| 2020-10-01 | 5.96M | 86,399 | 795k | 1 | 0 | 0 | 3744 | 100.0% | 256 MB | 22.5 MB |
| 2020-11-01 | 6.55M | 86,400 | 885k | 1 | 0 | 0 | 4386 | 100.0% | 260 MB | 22.9 MB |
| 2020-12-01 | 2.03M | 86,400 | 2558k | 1 | 0 | 0 | 4158 | 100.0% | 395 MB | 24.6 MB |
| 2021-01-01 | 4.72M | 86,393 | 1512k | 1 | 0 | 0 | 5160 | 100.0% | 367 MB | 24.3 MB |

**8 days.** Mean valid-book coverage 100.00%. Crossed books 0, invalidations 0. Archives read 2.0 GB, feature store 186 MB.
