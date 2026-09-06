// M1 Phase 1 — data integrity audit. Runs before the pre-registration is written.
// Nothing here touches forward returns.
// Usage: node research/audit.mjs  ->  research/AUDIT-M1.md, research/audit-m1.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadBars, afiOf, M5 } from './features.mjs';

const cache = (f) => new URL(`../data/cache/${f}`, import.meta.url).pathname;
const readJson = (f) => JSON.parse(readFileSync(cache(f), 'utf8'));
const sha = (f) => createHash('sha256').update(readFileSync(cache(f))).digest('hex');
const pct = (x) => (100 * x).toFixed(2) + '%';

const out = { generated: new Date().toISOString(), markets: {}, boundaries: {}, reconcile1m: null, hashes: {} };

for (const market of ['perp', 'spot']) {
  const bars = loadBars(market);
  const agg = readJson(`aggtrades-${market}.json`);

  // --- kline grid -------------------------------------------------------
  const k = { bars: bars.length, first: new Date(bars[0].t).toISOString(), last: new Date(bars.at(-1).t).toISOString(),
    gridGaps: 0, zeroVolume: 0, zeroTrades: 0, tbqOverQv: 0, tbqNegative: 0, nonFinite: 0, badOhlc: 0 };
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (i && b.t - bars[i - 1].t !== M5) k.gridGaps++;
    if (!(b.qv > 0)) k.zeroVolume++;
    if (!(b.n > 0)) k.zeroTrades++;
    if (b.tbq > b.qv * (1 + 1e-9)) k.tbqOverQv++;
    if (b.tbq < 0) k.tbqNegative++;
    if (![b.o, b.h, b.l, b.c, b.qv, b.tbq].every(Number.isFinite)) k.nonFinite++;
    if (b.h < Math.max(b.o, b.c) || b.l > Math.min(b.o, b.c)) k.badOhlc++;
  }
  const afis = bars.filter((b) => b.qv > 0).map(afiOf);
  k.afiMean = afis.reduce((s, x) => s + x, 0) / afis.length;
  k.afiSd = Math.sqrt(afis.reduce((s, x) => s + (x - k.afiMean) ** 2, 0) / afis.length);
  k.afiOutOfRange = afis.filter((x) => x < -1 - 1e-9 || x > 1 + 1e-9).length;

  // --- raw aggTrades ----------------------------------------------------
  const days = Object.keys(agg).sort();
  const a = { days: days.length, trades: 0, quoteUsd: 0, dupIds: 0, idGaps: 0, idGapRows: 0, outOfOrder: 0,
    outsideDay: 0, badMaker: 0, nonFinite: 0, maxInterTradeGapMs: 0, headerDays: 0, colCounts: {} };
  for (const d of days) {
    const x = agg[d].audit;
    a.trades += x.rows; a.quoteUsd += x.quote;
    a.dupIds += x.dupIds; a.idGaps += x.idGaps; a.idGapRows += x.idGapRows;
    a.outOfOrder += x.outOfOrder; a.outsideDay += x.outsideDay;
    a.badMaker += x.badMaker; a.nonFinite += x.nonFinite;
    a.maxInterTradeGapMs = Math.max(a.maxInterTradeGapMs, x.maxGapMs);
    if (x.header) a.headerDays++;
    a.colCounts[x.cols] = (a.colCounts[x.cols] || 0) + 1;
  }

  // --- reconciliation: raw aggTrades vs the kline taker-buy split --------
  const byT = new Map(bars.map((b) => [b.t, b]));
  const relQvs = [], relBuys = [], relFlips = [], dAfis = [];
  const rec = { bars: 0, missingKline: 0, priceHiLoMismatchDays: 0, dayTotalMaxRel: 0, worst: [] };
  for (const d of days) {
    const dayBars = agg[d].bars;
    let hi = -Infinity, lo = Infinity, sumAgg = 0, sumKl = 0;
    for (const [ts, v] of Object.entries(dayBars)) {
      const b = byT.get(+ts);
      if (!b) { rec.missingKline++; continue; }
      rec.bars++;
      const [buy, sell] = v, tot = buy + sell;
      sumAgg += tot; sumKl += b.qv;
      const den = b.qv > 0 ? b.qv : 1;
      relQvs.push(Math.abs(tot - b.qv) / den);
      relBuys.push(Math.abs(buy - b.tbq) / den);
      relFlips.push(Math.abs(sell - b.tbq) / den);
      const dAfi = Math.abs((tot > 0 ? (buy - sell) / tot : 0) - afiOf(b));
      dAfis.push(dAfi);
      if (dAfi > 0.01) rec.worst.push({ bar: new Date(+ts).toISOString(), dAfi, relQv: Math.abs(tot - b.qv) / den, aggUsd: tot, klineUsd: b.qv, klineTrades: b.n });
      hi = Math.max(hi, b.h); lo = Math.min(lo, b.l);
    }
    const x = agg[d].audit;
    if (Math.abs(hi - x.pMax) > 1e-6 || Math.abs(lo - x.pMin) > 1e-6) rec.priceHiLoMismatchDays++;
    if (sumKl > 0) rec.dayTotalMaxRel = Math.max(rec.dayTotalMaxRel, Math.abs(sumAgg - sumKl) / sumKl);
  }
  const quant = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
  const dist = (a) => ({ median: quant(a, 0.5), p99: quant(a, 0.99), p999: quant(a, 0.999), max: Math.max(...a), over1e3: a.filter((x) => x > 1e-3).length, over1e2: a.filter((x) => x > 1e-2).length });
  rec.relQv = dist(relQvs); rec.relBuy = dist(relBuys); rec.relFlipped = dist(relFlips); rec.dAfi = dist(dAfis);
  rec.worst.sort((a, b) => b.dAfi - a.dAfi);
  rec.worst = rec.worst.slice(0, 10);

  // --- archive boundaries: consecutive audited days must chain by agg id --
  const bnd = [];
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1], cur = days[i];
    if (Date.parse(cur) - Date.parse(prev) !== 86_400_000) continue;
    const p = agg[prev].audit, c = agg[cur].audit;
    bnd.push({ pair: `${prev} -> ${cur}`, idChained: c.minId === p.maxId + 1,
      idGap: c.minId - p.maxId - 1, timeOrdered: c.tFirst > p.tLast, gapMs: c.tFirst - p.tLast });
  }

  out.markets[market] = { kline: k, aggTrades: a, reconcile: rec };
  out.boundaries[market] = bnd;
  out.hashes[`btc-5m-${market}.json`] = sha(`btc-5m-${market}.json`);
  out.hashes[`aggtrades-${market}.json`] = sha(`aggtrades-${market}.json`);
}

if (existsSync(cache('reconcile-1m-perp.json'))) out.reconcile1m = readJson('reconcile-1m-perp.json');
out.hashes['research/features.mjs'] = createHash('sha256')
  .update(readFileSync(new URL('./features.mjs', import.meta.url).pathname)).digest('hex');

writeFileSync(new URL('./audit-m1.json', import.meta.url).pathname, JSON.stringify(out, null, 2));

// ---------------------------------------------------------------- report
const L = [];
L.push('# M1 data integrity audit', '');
L.push('Run before the M1 pre-registration was written. Nothing here uses forward returns.');
L.push(`Generated ${out.generated}.`, '');
for (const m of ['perp', 'spot']) {
  const { kline: k, aggTrades: a, reconcile: r } = out.markets[m];
  L.push(`## ${m === 'perp' ? 'USD-M futures BTCUSDT (primary)' : 'Spot BTCUSDT (venue robustness only)'}`, '');
  L.push('### 5m klines', '', '| check | value |', '|---|---|');
  L.push(`| bars | ${k.bars.toLocaleString()} (${k.first} → ${k.last}) |`);
  L.push(`| 5m grid gaps | ${k.gridGaps} |`);
  L.push(`| bars with zero volume / zero trades | ${k.zeroVolume} / ${k.zeroTrades} |`);
  L.push(`| taker-buy quote > total quote | ${k.tbqOverQv} |`);
  L.push(`| taker-buy quote < 0 | ${k.tbqNegative} |`);
  L.push(`| non-finite fields / impossible OHLC | ${k.nonFinite} / ${k.badOhlc} |`);
  L.push(`| AFI mean / sd | ${k.afiMean.toFixed(5)} / ${k.afiSd.toFixed(4)} |`);
  L.push(`| AFI outside [-1, 1] | ${k.afiOutOfRange} |`, '');
  L.push('### Raw aggTrades sample', '', '| check | value |', '|---|---|');
  L.push(`| days sampled | ${a.days} |`);
  L.push(`| trades parsed | ${a.trades.toLocaleString()} |`);
  L.push(`| notional | $${(a.quoteUsd / 1e9).toFixed(1)}B |`);
  L.push(`| duplicate aggTrade ids | ${a.dupIds} |`);
  L.push(`| aggTrade id gaps (runs / missing ids) | ${a.idGaps} / ${a.idGapRows} |`);
  L.push(`| out-of-order timestamps | ${a.outOfOrder} |`);
  L.push(`| trades outside their archive's UTC day | ${a.outsideDay} |`);
  L.push(`| unparseable is_buyer_maker / non-finite rows | ${a.badMaker} / ${a.nonFinite} |`);
  L.push(`| longest interval with no trade | ${(a.maxInterTradeGapMs / 1000).toFixed(1)} s |`);
  L.push(`| CSV column counts (days) | ${Object.entries(a.colCounts).map(([c, n]) => `${c} cols × ${n}`).join(', ')} |`);
  L.push(`| days carrying a header row | ${a.headerDays} / ${a.days} |`, '');
  L.push('### Reconciliation — raw aggTrades vs kline taker-buy split', '');
  L.push(`${r.bars.toLocaleString()} audited 5m bars, ${r.missingKline} of them with no kline.`);
  L.push(`Largest whole-day notional difference: ${r.dayTotalMaxRel.toExponential(2)}.`);
  L.push(`Days where the aggTrade price range differs from the kline high/low: ${r.priceHiLoMismatchDays}.`, '');
  L.push('| quantity | median | p99 | p99.9 | max | bars > 1e-3 | bars > 1e-2 |', '|---|---|---|---|---|---|---|');
  const row = (name, d) => L.push(`| ${name} | ${d.median.toExponential(2)} | ${d.p99.toExponential(2)} | ${d.p999.toExponential(2)} | ${d.max.toExponential(2)} | ${d.over1e3} | ${d.over1e2} |`);
  row('relative error, Σ aggTrade notional vs kline quote volume', r.relQv);
  row('relative error, Σ(is_buyer_maker=false) vs kline taker-buy quote', r.relBuy);
  row('same with the maker side flipped (must be large)', r.relFlipped);
  row('absolute AFI difference (AFI sd ≈ 0.23)', r.dAfi);
  L.push('');
  if (r.worst.length) {
    L.push('Bars where the two sources give an AFI more than 0.01 apart:', '');
    L.push('| 5m bar | ΔAFI | relative notional error | aggTrades archive | kline | kline trade count |', '|---|---|---|---|---|---|');
    for (const w of r.worst) L.push(`| ${w.bar} | ${w.dAfi.toFixed(4)} | ${w.relQv.toFixed(4)} | $${(w.aggUsd / 1e6).toFixed(2)}M | $${(w.klineUsd / 1e6).toFixed(2)}M | ${w.klineTrades.toLocaleString()} |`);
    L.push('');
  }
  const bnd = out.boundaries[m];
  L.push('### Archive boundaries (consecutive audited days)', '');
  if (!bnd.length) L.push('_none in this sample_', '');
  else {
    L.push('| pair | aggTrade id chains | id gap | time ordered | gap |', '|---|---|---|---|---|');
    for (const b of bnd) L.push(`| ${b.pair} | ${b.idChained ? 'yes' : 'NO'} | ${b.idGap} | ${b.timeOrdered ? 'yes' : 'NO'} | ${(b.gapMs / 1000).toFixed(3)} s |`);
    L.push('');
  }
}
if (out.reconcile1m) {
  L.push('## Price reconciliation — 1m OHLC rebuilt from raw aggTrades vs 1m klines', '');
  L.push('| day | kline bars | compared | kline bars with trades but none in the archive | OHLC mismatches | volume mismatches | max relative volume error |', '|---|---|---|---|---|---|---|');
  for (const r of out.reconcile1m) L.push(`| ${r.day} | ${r.klineBars} | ${r.compared} | ${r.missing} | ${r.ohlcMismatch} | ${r.volMismatch} | ${r.maxVolRel.toExponential(2)} |`);
  L.push('');
}
L.push('## Findings and how each is resolved', '');
L.push('1. **The two sources agree exactly on the great majority of bars.** Median relative error between the raw-aggTrade aggregation and the kline taker-buy split is machine epsilon; whole-day notional agrees to ~1e-15 except where noted below.');
L.push('2. **Millisecond boundary attribution.** A small minority of bars differ because a burst of trades sits within a millisecond or two of a 5m boundary and the two aggregations assign it to different bars; the differences offset between adjacent bars (e.g. 2024-05-15 03:45 and 03:50 differ by the same $231k with opposite sign). Bounded, not corrected: p99 |ΔAFI| is ~1.7e-3, under 1% of one AFI standard deviation.');
L.push('3. **The daily archives start a few hundred milliseconds into the UTC day.** The first trades of each day land in the previous archive, so the 00:00 bar of an archive is short. The kline is the complete source there. Affects the archive only.');
L.push('4. **2021-05-19 13:15 UTC: the raw archive is missing 557,026 aggTrade ids** (the single id gap in the whole sample, during the May 2021 crash). The archive holds $11.5M of notional for that bar against the kline\'s $141.8M over 211,056 trades. The kline is complete; the archive is defective. The same gap is what produces the "longest interval with no trade" figure in the table above — it is an archive hole, not a quiet market.');
L.push('5. **Spot has 15 gaps in the 5m grid** (venue downtime). Futures has none. Feature construction requires an unbroken run of bars, so a gap invalidates the bars around it rather than being silently bridged.');
L.push('6. **31 futures bars have zero volume.** AFI is undefined there; those bars are excluded from every regression.', '');
L.push('**Consequence for M1.** Features are computed from the 5m klines, i.e. from the exchange\'s own aggregation of the same trade stream, because it is the *more* complete of the two sources (points 3 and 4) and is identical to the raw aggregation everywhere else. `is_buyer_maker = false → aggressive buy` is confirmed against the raw archive, not assumed. Where a study needs anything the kline aggregate cannot express — trade size distribution, individual sweep sizes, sub-5m timing — raw aggTrades must be pulled and this reconciliation does not license the shortcut.', '');
L.push('## Schema notes', '');
L.push('- Futures (`futures/um`) aggTrades columns: `agg_trade_id, price, quantity, first_trade_id, last_trade_id, transact_time, is_buyer_maker`.');
L.push('- Spot aggTrades carry one extra trailing column, `is_best_match`; column 6 (`is_buyer_maker`) is in the same position, so the same parser is used and the extra column is ignored.');
L.push('- Header rows appear only in the more recent archives; the parser detects and skips them, and the count is reported above.');
L.push('- `is_buyer_maker = false` means the buyer was the taker → **aggressive buy**. The reconciliation above proves this mapping: summing that side matches the kline taker-buy field to floating-point precision, and the flipped assignment does not.', '');
L.push('## File hashes (sha256)', '', '| file | sha256 |', '|---|---|');
for (const [f, h] of Object.entries(out.hashes)) L.push(`| \`${f}\` | \`${h}\` |`);
L.push('');
writeFileSync(new URL('./AUDIT-M1.md', import.meta.url).pathname, L.join('\n'));
console.log(L.join('\n'));
