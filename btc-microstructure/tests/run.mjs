import { results } from './harness.mjs';

const suites = ['./book.test.mjs', './execution.test.mjs', './writer.test.mjs', './research.test.mjs', './prospective.test.mjs', './ui.test.mjs'];
for (const s of suites) await import(s);

console.log(`\n${results.pass} passed, ${results.fail} failed`);
if (results.fail) { console.log('\nfailures:'); for (const f of results.failures) console.log('  - ' + f); }
process.exit(results.fail ? 1 : 0);
