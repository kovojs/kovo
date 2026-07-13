import { performance } from 'node:perf_hooks';

import { expect, it } from 'vitest';

import { canonicalJsonStringify } from './json-clone.js';

it('keeps reverse-key canonical JSON within the SPEC section 9.5 resource floor', () => {
  canonicalJsonStringify({ warmup: true });
  const count = 8_000;
  const value: Record<string, number> = {};
  for (let index = count; index > 0; index -= 1) {
    value[`key-${String(index).padStart(6, '0')}`] = index;
  }

  const started = performance.now();
  const json = canonicalJsonStringify(value);
  const elapsed = performance.now() - started;

  expect(json.indexOf('"key-000001"')).toBeLessThan(json.indexOf('"key-008000"'));
  // The prior insertion sort took about four seconds locally at this size.
  expect(elapsed).toBeLessThan(1_000);
});
