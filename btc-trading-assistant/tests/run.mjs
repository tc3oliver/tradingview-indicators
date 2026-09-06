import { results } from './harness.mjs';
import { differential, plannerDifferential } from './differential.test.mjs';
import {
  sourceChecks, timeframeChecks, independenceChecks, dataHonestyChecks,
  semanticChecks, panelChecks, paletteChecks, instrumentChecks,
  plannerChecks, alertChecks, drawingChecks, uxChecks,
} from './main.test.mjs';

console.log('='.repeat(94));
console.log('BTC Trading Assistant — offline verification');
console.log('='.repeat(94));

await sourceChecks();
await differential();
await plannerDifferential();
await timeframeChecks();
await independenceChecks();
await dataHonestyChecks();
await semanticChecks();
await panelChecks();
await paletteChecks();
await instrumentChecks();
await plannerChecks();
await alertChecks();
await drawingChecks();
await uxChecks();

console.log(`\n${'='.repeat(94)}`);
console.log(`${results.pass} passed, ${results.fail} failed`);
if (results.fail) { console.log('\nfailures:'); for (const f of results.failures) console.log('  - ' + f); }
process.exit(results.fail ? 1 : 0);
