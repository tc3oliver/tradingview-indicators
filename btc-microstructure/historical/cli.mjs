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
