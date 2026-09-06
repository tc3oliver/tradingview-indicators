// Engine invariants for the 36 primary candidates. Mechanical checks only —
// nothing here looks at performance, so it can run before or after the gates.
import { simulate, PRIMARY, TIMES, cfgName, bars } from './engine.mjs';
import { sessionFlags } from './sessions.mjs';
let bad = 0;
for (const cfg of PRIMARY) {
  const { trades } = simulate(cfg);
  const sgn = cfg.dir === 'long' ? 1 : -1;
  let inSess = 0, overnight = 0, tpOver = 0, stopOff = 0, costNeg = 0;
  for (const t of trades) {
    if (sessionFlags(t.t)['in' + cfg.session]) inSess++;
    if (Math.floor(TIMES[t.exits.at(-1).i] / 86400000) !== Math.floor(t.t / 86400000)) overnight++;
    if (t.R > t.grossR) costNeg++;                                  // costs only subtract
    // Targets and stops are set from the signal close; the fill is the next open.
    // A single-exit trade filled exactly at its target / stop must therefore be
    // exactly 2R / -1R gross plus the signal-close-to-fill drift.
    const Rp = Math.abs(bars[t.sig].c - t.stop), drift = (sgn * (bars[t.sig].c - t.fill)) / Rp;
    const last = t.exits.at(-1);
    if (t.exits.length === 1 && last.reason === 'tp' && Math.abs(last.px - t.tp) < 1e-6 && Math.abs(t.grossR - (2 + drift)) > 1e-6) tpOver++;
    if (t.exits.length === 1 && last.reason === 'stop' && Math.abs(last.px - t.stop) < 1e-6 && Math.abs(t.grossR - (-1 + drift)) > 1e-6) stopOff++;
  }
  const ok = inSess === trades.length && overnight === 0 && tpOver === 0 && stopOff === 0 && costNeg === 0;
  if (!ok) bad++;
  console.log(`${ok ? 'ok ' : 'BAD'} ${cfgName(cfg).padEnd(44)} n=${String(trades.length).padStart(4)} inSess=${inSess} overnight=${overnight} tp≠2R=${tpOver} stop≠-1R=${stopOff} cost<0=${costNeg}`);
}
console.log(bad ? `${bad} BAD` : 'all invariants hold');
process.exit(bad ? 1 : 0);
