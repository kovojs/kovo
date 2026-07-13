import { performance } from 'node:perf_hooks';

import { expect, it } from 'vitest';

import { sanitizeRichHtml } from './security-output.js';

it('keeps hostile rich HTML parsing within the SPEC section 6.6 resource floor', () => {
  const count = 20_000;
  const input = '<div>'.repeat(count) + '</span>'.repeat(count);

  const started = performance.now();
  const output = sanitizeRichHtml(input);
  const elapsed = performance.now() - started;

  expect(output).toBe('<div>'.repeat(count) + '</div>'.repeat(count));
  // Before the anchored comment check and open-tag count witness, this 340 KiB input took about
  // five seconds locally because both ordinary tags and unmatched closes triggered suffix scans.
  expect(elapsed).toBeLessThan(1_000);
});
