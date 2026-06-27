import { describe, expect, it } from 'vitest';

import {
  balanceShards,
  extractPlaywrightDurations,
  extractVitestDurations,
  includeVitest,
  mergeDurationHistory,
  unknownDurationSeconds,
  validateShardAssignment,
} from './ci-shards.mjs';

describe('ci-shards', () => {
  it('balances tests with longest-processing-time first', () => {
    const shards = balanceShards(
      ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'],
      {
        'a.test.ts': { seconds: 9 },
        'b.test.ts': { seconds: 6 },
        'c.test.ts': { seconds: 3 },
        'd.test.ts': { seconds: 3 },
      },
      2,
    );

    expect(shards.map((shard) => shard.files)).toEqual([
      ['a.test.ts', 'd.test.ts'],
      ['b.test.ts', 'c.test.ts'],
    ]);
    expect(shards.map((shard) => shard.seconds)).toEqual([12, 9]);
  });

  it('uses p75 duration for unknown tests before the fixed fallback', () => {
    expect(
      unknownDurationSeconds({
        'known-a.test.ts': { seconds: 2 },
        'known-b.test.ts': { seconds: 4 },
        'known-c.test.ts': { seconds: 8 },
        'known-d.test.ts': { seconds: 16 },
      }),
    ).toBe(8);
  });

  it('rejects missing, duplicated, and undiscovered files', () => {
    expect(() =>
      validateShardAssignment(['a.test.ts', 'b.test.ts'], [{ files: ['a.test.ts', 'a.test.ts'] }]),
    ).toThrow(/missing: b\.test\.ts; duplicated: a\.test\.ts/);

    expect(() =>
      validateShardAssignment(['a.test.ts'], [{ files: ['a.test.ts', 'z.test.ts'] }]),
    ).toThrow(/undiscovered test file: z\.test\.ts/);
  });

  it('merges duration history with a rolling average', () => {
    expect(
      mergeDurationHistory(
        { 'a.test.ts': { seconds: 10 }, 'stale.test.ts': { seconds: 3 } },
        { 'a.test.ts': { seconds: 20 }, 'new.test.ts': { seconds: 5 } },
      ),
    ).toEqual({
      'a.test.ts': { seconds: 13 },
      'new.test.ts': { seconds: 5 },
      'stale.test.ts': { seconds: 3 },
    });
  });

  it('extracts vitest per-file durations from tolerant JSON reporter shapes', () => {
    expect(
      extractVitestDurations({
        testResults: [
          { filepath: '/repo/packages/a/src/a.test.ts', duration: 1000 },
          { filepath: '/repo/packages/a/src/a.test.ts', duration: 1200 },
          { file: '/repo/packages/b/src/b.test.ts', duration: 2500 },
        ],
      }),
    ).toEqual({
      '/repo/packages/a/src/a.test.ts': { seconds: 1.2 },
      '/repo/packages/b/src/b.test.ts': { seconds: 2.5 },
    });
  });

  it('extracts playwright durations by project plus file', () => {
    expect(
      extractPlaywrightDurations({
        suites: [
          {
            file: 'tests/integration/specs/counter.spec.ts',
            specs: [
              {
                tests: [
                  {
                    projectName: 'chromium',
                    location: { file: 'tests/integration/specs/counter.spec.ts' },
                    duration: 1000,
                  },
                  {
                    projectName: 'chromium',
                    location: { file: 'tests/integration/specs/counter.spec.ts' },
                    duration: 2500,
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual({
      'chromium:tests/integration/specs/counter.spec.ts': { seconds: 3.5 },
    });
  });

  it('keeps consolidated CI-owned files out of root Vitest shards', () => {
    expect(includeVitest('packages/create-kovo/src/index.test.ts')).toBe(true);
    expect(includeVitest('packages/create-kovo/src/index.build.test.ts')).toBe(false);
    expect(includeVitest('packages/core/src/sql-safety.test.ts')).toBe(false);
    expect(includeVitest('packages/server/src/guards.test.ts')).toBe(false);
  });
});
