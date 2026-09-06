import { results } from './harness.mjs';

// The historical (M2-H) and execution-planner UI suites are gone with the code
// they covered: M2-H answered its question and is condensed into
// research/microstructure/m2h.md, and the planner UI showed order-book
// measurements that this product does not ship. What remains is exactly the
// prospective pipeline — book reconstruction, feature semantics, the append-safe
// writer, the prospective boundary, and the research runner's refusal to compute
// a verdict below its sample gate.
const suites = ['./book.test.mjs', './execution.test.mjs', './writer.test.mjs', './research.test.mjs', './prospective.test.mjs'];
for (const s of suites) await import(s);

console.log(`\n${results.pass} passed, ${results.fail} failed`);
if (results.fail) { console.log('\nfailures:'); for (const f of results.failures) console.log('  - ' + f); }
process.exit(results.fail ? 1 : 0);
