// Regression test for the benchmark harness's numeric CLI flags.
//
// plans/good-perf.md O15: every count used to be `Number(readArg(flag) ?? default)`. NaN does not
// throw anywhere downstream — it makes each consuming loop run zero times — so `--bfcache-iterations
// three` published a confident `n/a (same-document)` / `0/0` cell for every entrant from a probe
// that never ran. These flags must refuse a bad value instead of degrading into a plausible one.
//
// Imports only `args.mjs`, which depends on nothing outside node — the rest of the harness needs
// Playwright/Lighthouse from `benchmarks/harness/node_modules`, which the root unit pool does not
// install.
import { describe, expect, it } from 'vitest';

import { parseIntegerFlag, readArg, readIntegerArg } from './args.mjs';

describe('benchmark harness numeric flags', () => {
  it('takes the fallback only when the flag is absent', () => {
    expect(readIntegerArg('--iterations', { argv: ['node', 'run-all.mjs'], fallback: 10 })).toBe(
      10,
    );
    expect(
      readIntegerArg('--iterations', {
        argv: ['node', 'run-all.mjs', '--iterations', '2'],
        fallback: 10,
      }),
    ).toBe(2);
  });

  it('refuses a non-numeric value instead of yielding NaN', () => {
    // The exact reported failure: the probe loop runs zero times and every entrant reports
    // "n/a (same-document)" with 0/0 applicable runs.
    expect(() =>
      readIntegerArg('--bfcache-iterations', {
        argv: ['node', 'run-all.mjs', '--bfcache-iterations', 'three'],
        fallback: 3,
      }),
    ).toThrow(/--bfcache-iterations must be an integer between 1 and \d+, got "three"\./);
    expect(Number('three')).toBeNaN();
  });

  it('refuses a flag given with no value', () => {
    expect(() =>
      readIntegerArg('--lighthouse-runs', {
        argv: ['node', 'run-all.mjs', '--lighthouse-runs'],
        fallback: 3,
      }),
    ).toThrow(/--lighthouse-runs requires a value/);
  });

  it('refuses a flag whose value is the next flag', () => {
    expect(() =>
      readIntegerArg('--iterations', {
        argv: ['node', 'run-all.mjs', '--iterations', '--skip-lighthouse'],
        fallback: 10,
      }),
    ).toThrow(/--iterations must be an integer/);
  });

  it('refuses zero, negatives, fractions, and out-of-range counts', () => {
    const cases = ['0', '-1', '2.5', '1e3000', 'Infinity'];
    for (const value of cases) {
      expect(() =>
        parseIntegerFlag('--settle-quiet-ms', value, { fallback: 750, max: 600_000 }),
      ).toThrow(/--settle-quiet-ms must be an integer/);
    }
    expect(() =>
      parseIntegerFlag('--settle-max-ms', '600001', { fallback: 10_000, max: 600_000 }),
    ).toThrow(/--settle-max-ms must be an integer between 1 and 600000/);
  });

  it('validates BENCH_ITERATIONS the same way as the flag', () => {
    // run-all.mjs feeds the env var through the same parser, so a typo there fails identically.
    expect(() => parseIntegerFlag('--iterations', 'ten', { fallback: 10, max: 1_000 })).toThrow(
      /--iterations must be an integer/,
    );
    expect(parseIntegerFlag('--iterations', '4', { fallback: 10, max: 1_000 })).toBe(4);
    expect(parseIntegerFlag('--iterations', undefined, { fallback: 10, max: 1_000 })).toBe(10);
  });

  it('distinguishes an absent flag from a flag with an empty operand', () => {
    expect(readArg('--apps', ['node', 'run-all.mjs'])).toBeUndefined();
    expect(readArg('--apps', ['node', 'run-all.mjs', '--apps'])).toBe('');
    expect(readArg('--apps', ['node', 'run-all.mjs', '--apps', 'kovo,nextjs'])).toBe('kovo,nextjs');
  });
});
