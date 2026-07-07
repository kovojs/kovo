import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  balanceStarterShards,
  balanceShards,
  extractPlaywrightDurations,
  extractVitestDurations,
  discoverTests,
  groupStarterEntriesForExecution,
  includeVitest,
  mergeDurationHistory,
  starterEntries,
  starterEntriesForMode,
  starterGroupVitestArgs,
  starterShardNeedsPacked,
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
          {
            name: '/repo/packages/c/src/c.test.ts',
            assertionResults: [{ duration: 1600 }, { duration: 3000 }],
            startTime: 100,
            endTime: 4700,
          },
        ],
      }),
    ).toEqual({
      '/repo/packages/a/src/a.test.ts': { seconds: 1.2 },
      '/repo/packages/b/src/b.test.ts': { seconds: 2.5 },
      '/repo/packages/c/src/c.test.ts': { seconds: 4.6 },
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
    expect(
      includeVitest('packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts'),
    ).toBe(false);
    expect(
      includeVitest('packages/create-kovo/src/index.build.prod-artifact.contacts.test.ts'),
    ).toBe(false);
    expect(includeVitest('packages/create-kovo/src/index.build.prod-artifact.defer.test.ts')).toBe(
      false,
    );
    expect(includeVitest('packages/create-kovo/src/index.build.prod-artifact.assets.test.ts')).toBe(
      false,
    );
    expect(
      includeVitest(
        'packages/create-kovo/src/index.build.prod-artifact.durable-tasks.lifecycle.test.ts',
      ),
    ).toBe(false);
    expect(
      includeVitest(
        'packages/create-kovo/src/index.build.prod-artifact.durable-tasks.retries.test.ts',
      ),
    ).toBe(false);
    expect(
      includeVitest('packages/create-kovo/src/index.build.prod-artifact.raw-sql.test.ts'),
    ).toBe(false);
    expect(
      includeVitest('packages/create-kovo/src/index.build.prod-artifact.headers.test.ts'),
    ).toBe(false);
    expect(
      includeVitest('packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts'),
    ).toBe(false);
    expect(
      includeVitest('packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts'),
    ).toBe(false);
    expect(
      includeVitest(
        'packages/create-kovo/src/index.build.prod-artifact.redirect-capability.test.ts',
      ),
    ).toBe(false);
    expect(
      includeVitest('packages/create-kovo/src/index.build.prod-artifact.runtime-contracts.test.ts'),
    ).toBe(false);
    expect(
      includeVitest('packages/create-kovo/src/index.build.prod-artifact.security.test.ts'),
    ).toBe(false);
    expect(
      includeVitest('packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts'),
    ).toBe(false);
    expect(includeVitest('packages/create-kovo/src/index.build.runtime.test.ts')).toBe(false);
    expect(
      includeVitest('packages/create-kovo/src/index.build.scaffold.packed-postgres.test.ts'),
    ).toBe(false);
    expect(
      includeVitest('packages/create-kovo/src/index.build.scaffold.packed-runtime.test.ts'),
    ).toBe(false);
    expect(
      includeVitest('packages/create-kovo/src/index.build.scaffold.packed-sqlite.test.ts'),
    ).toBe(false);
    expect(includeVitest('packages/create-kovo/src/index.build.scaffold.production.test.ts')).toBe(
      false,
    );
    expect(includeVitest('packages/create-kovo/src/index.build.scaffold.sqlite.test.ts')).toBe(
      false,
    );
    expect(includeVitest('packages/create-kovo/src/index.build.scaffold.typecheck.test.ts')).toBe(
      false,
    );
    expect(includeVitest('packages/core/src/sql-safety.test.ts')).toBe(false);
    expect(
      includeVitest('packages/conformance-fixtures/src/metamorphic-recognition-fixtures.test.ts'),
    ).toBe(false);
    expect(includeVitest('packages/server/src/guards.test.ts')).toBe(false);
  });

  it('discovers shard inputs through the shared walker without skipped-directory escapes', async () => {
    const root = await fixtureRoot();
    await writeFixture(root, 'packages/a/src/a.test.ts', 'it("a", () => {});\n');
    await writeFixture(root, 'packages/a/src/b.test.js', 'it("b", () => {});\n');
    await writeFixture(root, 'packages/a/src/c.spec.ts', 'test("c", async () => {});\n');
    await writeFixture(root, 'packages/a/src/dist/hidden.test.ts', 'it("hidden", () => {});\n');
    await writeFixture(
      root,
      'packages/a/src/node_modules/pkg/hidden.test.ts',
      'it("hidden", () => {});\n',
    );

    await expect(discoverTests('vitest', { roots: [root] })).resolves.toEqual([
      path.join(root, 'packages/a/src/a.test.ts'),
      path.join(root, 'packages/a/src/b.test.js'),
    ]);
    await expect(discoverTests('integration', { roots: [root] })).resolves.toEqual([
      path.join(root, 'packages/a/src/c.spec.ts'),
    ]);
  });

  it('load-balances starter production artifact entries into ten CI shards', () => {
    const entries = starterEntries();
    const shards = balanceStarterShards(10, entries);
    const assigned = shards.flatMap((shard) => shard.entries.map((entry) => entry.id));

    expect(shards).toHaveLength(10);
    expect(new Set(assigned).size).toBe(entries.length);
    expect(assigned.toSorted(compareStrings)).toEqual(
      entries.map((entry) => entry.id).toSorted(compareStrings),
    );
    expect(shards.map((shard) => shard.seconds)).toEqual([
      381, 361, 363, 372, 371, 370, 373, 374, 396, 379,
    ]);
  });

  it('splits starter entries into packed and unpacked shard modes', () => {
    const packedEntries = starterEntriesForMode('packed');
    const unpackedEntries = starterEntriesForMode('unpacked');
    const allEntries = starterEntries();
    const packedIds = packedEntries.map((entry) => entry.id);
    const unpackedIds = unpackedEntries.map((entry) => entry.id);

    expect(packedIds.toSorted(compareStrings)).toEqual([
      'starter-packed-postgres',
      'starter-packed-runtime',
      'starter-packed-sqlite',
    ]);
    expect(unpackedEntries.every((entry) => !entry.needsPacked)).toBe(true);
    expect([...packedIds, ...unpackedIds].toSorted(compareStrings)).toEqual(
      allEntries.map((entry) => entry.id).toSorted(compareStrings),
    );
    expect(
      balanceStarterShards(10, unpackedEntries).flatMap((shard) => shard.entries),
    ).toHaveLength(unpackedEntries.length);
    expect(balanceStarterShards(3, packedEntries).map((shard) => shard.entries)).toEqual([
      [{ ...packedEntries.find((entry) => entry.id === 'starter-packed-runtime') }],
      [{ ...packedEntries.find((entry) => entry.id === 'starter-packed-postgres') }],
      [{ ...packedEntries.find((entry) => entry.id === 'starter-packed-sqlite') }],
    ]);
    expect(() => starterEntriesForMode('other')).toThrow(/Unknown starter mode: other/);
  });

  it('keeps browser-backed starter entries isolated to the shard that needs Chromium', () => {
    const browserShards = balanceStarterShards(10)
      .map((shard, index) => ({
        index: index + 1,
        entries: shard.entries.filter((entry) => entry.needsBrowser).map((entry) => entry.id),
      }))
      .filter((shard) => shard.entries.length > 0);

    expect(browserShards).toEqual([{ index: 9, entries: ['island-derive-artifacts'] }]);
  });

  it('marks only packed starter shards as needing the packed package artifact', async () => {
    const root = await fixtureRoot();
    const packedManifest = path.join(root, 'packed.json');
    const plainManifest = path.join(root, 'plain.json');
    await writeFile(
      packedManifest,
      `${JSON.stringify({ kind: 'starter', entries: [{ id: 'packed', needsPacked: true }] })}\n`,
    );
    await writeFile(
      plainManifest,
      `${JSON.stringify({ kind: 'starter', entries: [{ id: 'plain' }] })}\n`,
    );

    await expect(starterShardNeedsPacked(packedManifest)).resolves.toBe(true);
    await expect(starterShardNeedsPacked(plainManifest)).resolves.toBe(false);
    expect(
      starterEntries()
        .filter((entry) => entry.needsPacked)
        .map((entry) => entry.id)
        .toSorted(compareStrings),
    ).toEqual(['starter-packed-postgres', 'starter-packed-runtime', 'starter-packed-sqlite']);
  });

  it('groups starter execution by file while preserving assigned test filters', () => {
    const groups = groupStarterEntriesForExecution([
      { file: 'b.test.ts', id: 'b-two', testName: 'two?' },
      { file: 'a.test.ts', id: 'a-one', testName: 'one' },
      { file: 'b.test.ts', id: 'b-one', testName: 'one' },
    ]);

    expect(groups.map((group) => group.map((entry) => entry.id))).toEqual([
      ['b-one', 'b-two'],
      ['a-one'],
    ]);
    expect(starterGroupVitestArgs(groups[0])).toEqual([
      'exec',
      'vitest',
      '--run',
      'b.test.ts',
      '-t',
      'one|two\\?',
    ]);
    expect(starterGroupVitestArgs(groups[1])).toEqual([
      'exec',
      'vitest',
      '--run',
      'a.test.ts',
      '-t',
      'one',
    ]);
  });

  it('runs a starter file once when a grouped manifest entry has no test filter', () => {
    expect(
      starterGroupVitestArgs([
        { file: 'whole-file.test.ts', id: 'whole-file' },
        { file: 'whole-file.test.ts', id: 'narrow', testName: 'narrow case' },
      ]),
    ).toEqual(['exec', 'vitest', '--run', 'whole-file.test.ts']);
  });
});

function compareStrings(a, b) {
  return a.localeCompare(b);
}

async function fixtureRoot() {
  return mkdir(path.join(tmpdir(), `kovo-ci-shards-${process.pid}-${Date.now()}`), {
    recursive: true,
  });
}

async function writeFixture(rootDir, relativePath, source) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, source);
}
