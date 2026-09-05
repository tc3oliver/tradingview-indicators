import { PineTS, Provider } from 'pinets';
import { readFileSync } from 'node:fs';
const src = readFileSync('./main.pine','utf8').replace(/if not timeframe\.isintraday[\s\S]*?runtime\.error\([^\n]*\n/, '');
const COLORS = { london:'#47abfd', newYork:'#ff6565', asia:'#75ff79', nyClose:'#ff9f43' };
const WINDOWS = { 'EST (winter)': ['2026-01-05','2026-01-20'], 'EDT (summer)': ['2026-07-06','2026-07-21'] };
const nyH = (ms) => new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}).format(ms);

for (const [season,[s,e]] of Object.entries(WINDOWS)) {
  console.log(`\n=== ${season} ===`);
  console.log('tf'.padEnd(5), Object.keys(COLORS).map(k=>k.padEnd(9)).join(''), ' bar opens (NY)');
  for (const tf of ['1h','2h','3h','4h']) {
    const pts = new PineTS(Provider.Binance,'BTCUSDT',tf,400,Date.parse(s),Date.parse(e));
    const ctx = await pts.run(src);
    const last = ctx.plots.__lines__.data.at(-1)?.value ?? [];
    const row = Object.entries(COLORS).map(([k,c]) =>
      String(last.filter(l=>l.color.toLowerCase().startsWith(c)).length).padEnd(9));
    const opens = [...new Set(pts.data.slice(0,24).map(b=>nyH(b.openTime)))].sort().join(' ');
    console.log(tf.padEnd(5), row.join(''), '', opens);
  }
}
