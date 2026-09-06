// Minimal assertion harness. No framework, no fixtures.
export const results = { pass: 0, fail: 0, failures: [] };
let group = '';

export function describe(name, fn) { group = name; console.log(`\n${name}`); fn(); }

export function test(name, fn) {
  try {
    fn();
    results.pass++;
    console.log(`  ok    ${name}`);
  } catch (e) {
    results.fail++;
    results.failures.push(`${group} / ${name}: ${e.message}`);
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

export function eq(a, b, msg = '') {
  if (a !== b && !(Number.isNaN(a) && Number.isNaN(b))) throw new Error(`${msg} expected ${b}, got ${a}`);
}
export function near(a, b, tol = 1e-9, msg = '') {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg} expected ${b} ± ${tol}, got ${a}`);
}
export function ok(cond, msg = 'expected truthy') { if (!cond) throw new Error(msg); }
export function throws(fn, msg = 'expected a throw') { try { fn(); } catch { return; } throw new Error(msg); }
