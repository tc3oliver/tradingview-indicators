// The UI is where an unvalidated claim would reach a person, so it gets its own tests.
import { describe, test, eq, ok } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../execution-planner/public/index.html', import.meta.url)), 'utf8');
const server = readFileSync(fileURLToPath(new URL('../execution-planner/server.mjs', import.meta.url)), 'utf8');

describe('planner UI', () => {
  test('it never tells anyone to go long or short', () => {
    // The words may appear only inside the explicit "no validated signal" wording.
    const offenders = [/\bLONG\b/g, /\bSHORT\b/g, /BUY NOW/gi, /SELL NOW/gi];
    for (const re of offenders) {
      for (const m of html.matchAll(re)) {
        const around = html.slice(Math.max(0, m.index - 90), m.index + 90);
        ok(/NO VALIDATED|not a directional|NOT A DIRECTIONAL/i.test(around),
          `"${m[0]}" appears outside the no-signal disclaimer: …${around.replace(/\s+/g, ' ')}…`);
      }
    }
  });

  test('BUY and SELL appear only as order sides, next to a notional', () => {
    ok(/id="buy"[^>]*>BUY</.test(html) && /id="sell"[^>]*>SELL</.test(html));
    ok(/USDT/.test(html), 'the order side must be shown together with a size');
  });

  test('a "NO VALIDATED DIRECTIONAL SIGNAL" banner is present', () => {
    ok(/NO VALIDATED DIRECTIONAL SIGNAL/.test(html));
  });

  test('book pressure is labelled as context and not as a signal', () => {
    ok(/CONTEXT — NOT A DIRECTIONAL SIGNAL/.test(html));
  });

  test('an invalid book blanks the execution estimate instead of guessing', () => {
    ok(/if \(!p\.bookValid\)/.test(html), 'the client must branch on bookValid');
    ok(/NO ESTIMATE/.test(html));
    ok(/Nothing is guessed while the book is invalid/.test(html));
  });

  test('feed staleness is rendered, and rendered as a problem', () => {
    ok(/feeds\.depth\.stale/.test(html) && /feeds\.trades\.stale/.test(html));
    ok(/bad/.test(html.slice(html.indexOf('feeds.depth.stale') - 200, html.indexOf('feeds.depth.stale') + 200)));
  });

  test('the integrity panel exposes gaps, resyncs, reconnects and disk', () => {
    for (const id of ['mGaps', 'mResync', 'mRe', 'mDisk', 'mBook', 'mDepth', 'mTrade']) ok(html.includes(id), `missing ${id}`);
  });

  test('coverage progress against the sample gate is shown', () => {
    ok(/cDays|calendarDays/.test(html) && /validBookHours/.test(html));
  });

  test('execution quality refuses to grade without a configured limit', () => {
    ok(/NOT GRADED/.test(readFileSync(fileURLToPath(new URL('../features/execution.mjs', import.meta.url)), 'utf8')));
    ok(/M2_MAX_COST_BP/.test(html), 'the UI must say how to set a limit');
  });
});

describe('planner server', () => {
  test('the validated-directional flag is read from results, never hand-set', () => {
    ok(/results-m2\.json/.test(server));
    ok(/directionalGatePassed === true && r\.economicGatePassed === true/.test(server));
  });
  test('it is read-only: no order placement, no API key, no signing', () => {
    ok(!/apiKey|API_KEY|signature|hmac|X-MBX-APIKEY/i.test(server), 'no credential handling may exist here');
    ok(!/\/order|POST/i.test(server.replace(/POST\w*ing/gi, '')), 'no order endpoint may exist here');
  });
  test('an invalid book short-circuits the plan endpoint', () => {
    ok(/if \(!st\.book\.valid\)/.test(server));
    ok(/not sequence-verified/.test(server));
  });
});
