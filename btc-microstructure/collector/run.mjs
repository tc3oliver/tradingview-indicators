// Headless 24/7 collector. No web server, no UI — just capture.
// Usage: node collector/run.mjs   (or `npm run collector`)
import { Collector } from './collector.mjs';

const c = new Collector().start();
const stop = () => { console.log('\nstopping, flushing to disk…'); c.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

setInterval(() => {
  const s = c.status();
  console.log([new Date().toISOString(),
    `book=${s.book.valid ? 'VALID' : 'INVALID(' + s.book.reason + ')'}`,
    `phase=${s.phase}`,
    `depth=${s.counters.depth}`, `trades=${s.counters.trades}`,
    `gaps=${s.counters.gaps}`, `resyncs=${s.counters.resyncs}`, `reconnects=${s.counters.reconnects}`,
    `features=${s.counters.featureRecords}`,
    `depthAge=${Math.round(s.feeds.depth.ageMs)}ms`,
    `disk=${(s.storage.diskBytes / 1048576).toFixed(1)}MB`].join('  '));
}, 60_000);
