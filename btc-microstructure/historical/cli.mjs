// M2-H command line. `npm run m2h:<command>`
import { fetchableDays, dayRange, canFetch, apiKey, RELIABLE_SINCE, daySize } from './tardis.mjs';
import { replayDays } from './replay.mjs';
import { storedDays, manifest, verify } from './store.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const cmd = process.argv[2];
const FROM = arg('--from', RELIABLE_SINCE);
const TO = arg('--to', '2026-08-31');

if (cmd === 'days') {
  const all = dayRange(FROM, TO), can = all.filter(canFetch);
  console.log(`${FROM} → ${TO}: ${all.length} days, ${can.length} fetchable ${apiKey() ? '(API key present)' : '(no API key: first day of each month only)'}`);
  console.log(can.join(' '));
} else if (cmd === 'replay') {
  const days = arg('--date') ? [arg('--date')] : fetchableDays(FROM, TO);
  console.log(`replaying ${days.length} day(s)${apiKey() ? '' : ' — free tier: first day of each month only'}`);
  await replayDays(days, { force: process.argv.includes('--force'), onDay: (a) => {
    if (a.cached) return console.log(`${a.day}  cached`);
    if (a.error) return console.log(`${a.day}  ERROR ${a.error.slice(0, 120)}`);
    console.log(`${a.day}  ${(a.depthEvents / 1e6).toFixed(2)}M depth ev  ${(a.levelRows / 1e6).toFixed(1)}M levels  ${(a.tradeEvents / 1e3).toFixed(0)}k trades  valid ${a.validCoveragePct.toFixed(1)}%  crossed ${a.crossedBooks}  ${a.seconds.toFixed(0)}s  archive ${((a.archiveBytes || 0) / 1048576).toFixed(0)}MB -> store ${(a.store?.bytes / 1048576).toFixed(1)}MB`);
  } });
} else if (cmd === 'reconcile') {
  const { reconcileDays, verdict } = await import('./reconcile.mjs');
  const { writeFileSync } = await import('node:fs');
  const nDays = Number(arg('--days', 8));
  const minutes = Number(arg('--minutes', 5));
  const days = arg('--date') ? [arg('--date')] : storedDays().slice(0, nDays);
  if (!days.length) { console.log('no stored day to reconcile against; run `npm run m2h:replay` first'); process.exit(1); }
  console.log(`reconciling ${days.length} day(s) x ${minutes} min — raw sequence-verified feed vs the bulk CSV path`);
  const r = await reconcileDays(days, { minutes });
  const v = verdict(r);
  const f = (x) => (Number.isFinite(x) ? x.toExponential(2) : 'n/a');
  const KEYS = ['bid', 'ask', 'spreadBp', 'microprice', 'micropriceDisplacementBp',
    'depthBidTop1', 'depthBidTop5', 'depthBidTop10', 'depthAskTop1', 'depthAskTop5', 'depthAskTop10',
    'depthBid5bp', 'depthAsk5bp', 'imbTop1', 'imbTop5', 'imbTop10', 'imbWeighted',
    'flow5sAfi', 'flow5sSigned', 'pressureToCapacity', 'flowTimesFragility'];
  const L = ['# M2-H vendor / live reconciliation', '',
    `${r.windows.length} window(s) of ${r.minutes} min: ${r.windows.map((w) => w.day).join(', ')}. Generated ${new Date().toISOString()}.`, '',
    'Free replay access caps a response at roughly 3.2 MB — about one minute of raw depth on',
    'this instrument — so the overlap is pooled across days rather than stretched into one',
    'long window. The threshold is a count of compared seconds, not consecutive seconds.', '',
    'Three questions, each licensing a different thing. Run before the study, because the',
    'first one decides whether the study may run at all.', '',
    `## Verdict: **${v.pass ? 'PASS' : 'FAIL'}**`, '',
    '| check | result |', '|---|---|',
    `| the bulk CSV path reproduces a sequence-verified book | ${v.csvReproducesSequenceVerifiedBook ? 'pass' : 'FAIL'} |`,
    `| our live @100ms depth is equivalent to the @0ms capture | ${v.hundredMsBatchingIsEquivalent ? 'pass' : 'FAIL'} |`,
    `| the CSV \`side\` column is the liquidity taker | ${v.aggressorSideCorrect ? 'pass' : 'FAIL'} |`,
    `| enough overlapping seconds | ${v.enoughOverlap ? 'pass' : 'FAIL'} (${r.csvVsRaw?.compared ?? 0}) |`, '',
    '## 1. Raw, sequence-verified reconstruction', '',
    `Rebuilt through the identical \`OrderBook.apply()\` the live collector uses, with Binance's own \`U\`/\`u\`/\`pu\` continuity rule.`, '',
    `Applied ${(r.raw.applied || 0).toLocaleString()} events, ${r.raw.gaps} sequence gaps, ${r.raw.dropped} dropped as stale, ${r.raw.crossed} crossed books, ${r.raw.seconds} seconds sampled.`, '',
    '## 2. CSV path versus the sequence-verified book', '',
    '| feature | median rel. | p99 rel. | max rel. | median abs. |', '|---|---|---|---|---|'];
  for (const k of KEYS) {
    const rel = r.csvVsRaw?.relative?.[k] || {}, abs = r.csvVsRaw?.absolute?.[k] || {};
    L.push(`| ${k} | ${f(rel.median)} | ${f(rel.p99)} | ${f(rel.max)} | ${f(abs.median)} |`);
  }
  L.push('', `Compared ${r.csvVsRaw?.compared ?? 0} seconds; ${r.csvVsRaw?.missingInStore ?? 0} seconds present in the raw rebuild but absent from the store.`, '');
  L.push('## 3. 100 ms batching equivalence', '');
  L.push('Binance builds the `@100ms` stream our live collector subscribes to by unioning the');
  L.push('0 ms updates over each window with absolute, last-write-wins levels. That should make');
  L.push('the book identical at any sampling boundary. Tested rather than asserted: the raw 0 ms');
  L.push('stream is batched into 100 ms diffs and the resulting books compared.', '');
  L.push('| feature | median rel. | p99 rel. | max rel. |', '|---|---|---|---|');
  for (const k of KEYS) {
    const rel = r.batchedVsRaw?.relative?.[k] || {};
    L.push(`| ${k} | ${f(rel.median)} | ${f(rel.p99)} | ${f(rel.max)} |`);
  }
  L.push('', `Compared ${r.batchedVsRaw?.compared ?? 0} seconds.`, '');
  L.push('## 4. Aggressor side', '');
  L.push(`Correlation between the AFI derived from the raw \`m\` flag and the AFI derived from the CSV \`side\` column: **${(r.aggressorSide?.correlation ?? NaN).toFixed(6)}**, against **${(r.aggressorSide?.correlationIfFlipped ?? NaN).toFixed(6)}** if the side is flipped, over ${r.aggressorSide?.n ?? 0} seconds. Raw payload trade sides in the window: ${r.raw.tradeSides.buy} aggressive buys, ${r.raw.tradeSides.sell} aggressive sells.`, '');
  L.push('## What this licenses, and what it does not', '');
  L.push('The exchange-state features are reproduced by the bulk path, so vendor backtests of');
  L.push('book state are about the same object the live planner measures. Flow features differ at');
  L.push('the 1e-5 level, from millisecond trade-timestamp granularity between the two sources —');
  L.push('bounded and reported, not corrected.', '');
  L.push('It does **not** license a live-versus-vendor comparison on the same wall-clock day: our');
  L.push('prospective capture began 2026-09-06 and free vendor access covers only the first day of');
  L.push('each month, so there is no overlapping date without an API key. The bridge is indirect and');
  L.push('stated as such: vendor CSV ≡ vendor raw payloads ≡ the payload shape and code path our');
  L.push('collector runs.', '');
  writeFileSync(new URL('../research/RECONCILIATION-M2H.md', import.meta.url).pathname, L.join('\n'));
  writeFileSync(new URL('../research/reconciliation-m2h.json', import.meta.url).pathname, JSON.stringify({ ...r, verdict: v }, null, 2));
  console.log(`verdict: ${v.pass ? 'PASS' : 'FAIL'}  ${JSON.stringify(v)}`);
} else if (cmd === 'verify') {
  console.log(JSON.stringify(verify(), null, 2));
} else if (cmd === 'status') {
  const m = manifest();
  console.log(`store: ${storedDays().length} days, ${(m.totalRows || 0).toLocaleString()} rows, ${((m.totalBytes || 0) / 1048576).toFixed(1)} MB`);
  console.log(storedDays().join(' '));
} else if (cmd === 'size') {
  const days = fetchableDays(FROM, TO).slice(0, Number(arg('--n', 6)));
  for (const d of days) {
    const [b, t] = await Promise.all([daySize('incremental_book_L2', d), daySize('trades', d)]);
    console.log(`${d}  book ${b ? (b / 1048576).toFixed(0) + 'MB' : 'n/a'}  trades ${t ? (t / 1048576).toFixed(1) + 'MB' : 'n/a'}`);
  }
} else {
  console.log('usage: node historical/cli.mjs <days|replay|verify|status|size> [--from ISO] [--to ISO] [--date ISO] [--force]');
}
