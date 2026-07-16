import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  balanceStarterShards,
  balanceShards,
  combineDurationHistories,
  combineTimingHistoryDirectory,
  extractPlaywrightDurations,
  extractVitestDurations,
  discoverTests,
  groupStarterEntriesForExecution,
  includeVitest,
  mergeDurationHistory,
  runStarterShard,
  starterEntries,
  starterEntriesForMode,
  starterGroupVitestArgs,
  starterShardNeedsPacked,
  unknownDurationSeconds,
  validateStarterGroupTestFilters,
  validateShardAssignment,
  writeShardManifests,
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

  it('combines every prior shard history deterministically', () => {
    const first = {
      'b.test.ts': { seconds: 10 },
      'a.test.ts': { seconds: 4 },
    };
    const second = {
      'c.test.ts': { seconds: 7 },
      'a.test.ts': { seconds: 10 },
    };
    const expected = {
      'a.test.ts': { seconds: 7 },
      'b.test.ts': { seconds: 10 },
      'c.test.ts': { seconds: 7 },
    };

    expect(combineDurationHistories([first, second])).toEqual(expected);
    expect(combineDurationHistories([second, first])).toEqual(expected);
    expect(() => combineDurationHistories([{ 'a.test.ts': { seconds: 0 } }])).toThrow(
      /invalid duration for a\.test\.ts/,
    );
  });

  it('gives independently generated jobs one complete, duplicate-free assignment', async () => {
    const root = await fixtureRoot();
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      await writeFixture(root, `tests/${name}.test.ts`, `it("${name}", () => {});\n`);
    }
    const discovered = await discoverTests('vitest', { roots: [root] });
    const priorRoot = path.join(root, 'prior-timing');

    for (let jobIndex = 0; jobIndex < 4; jobIndex += 1) {
      const history = Object.fromEntries(
        discovered.map((file, fileIndex) => [file, { seconds: fileIndex === jobIndex ? 100 : 1 }]),
      );
      await writeFixture(
        priorRoot,
        `shard-${jobIndex + 1}/timing-history.json`,
        `${JSON.stringify(history, null, 2)}\n`,
      );
    }

    const divergentJobs = await Promise.all(
      [1, 2, 3, 4].map((jobIndex) =>
        writeShardManifests({
          kind: 'vitest',
          shardCount: 4,
          shardIndex: jobIndex,
          historyPath: path.join(priorRoot, `shard-${jobIndex}`, 'timing-history.json'),
          outputDir: path.join(root, `divergent-job-${jobIndex}`),
          roots: [root],
        }),
      ),
    );
    expect(() =>
      validateShardAssignment(
        discovered,
        divergentJobs.map((job) => job.selected),
      ),
    ).toThrow(/missing: .*d\.test\.ts; duplicated: .*a\.test\.ts/);

    const commonHistoryPath = path.join(root, 'common-timing', 'timing-history.json');
    const commonHistory = await combineTimingHistoryDirectory(priorRoot, commonHistoryPath);
    expect(JSON.parse(await readFile(commonHistoryPath, 'utf8'))).toEqual(commonHistory);
    expect(commonHistory).toEqual(
      Object.fromEntries(
        discovered.map((file, fileIndex) => [file, { seconds: fileIndex < 4 ? 25.75 : 1 }]),
      ),
    );

    const commonJobs = await Promise.all(
      [1, 2, 3, 4].map((jobIndex) =>
        writeShardManifests({
          kind: 'vitest',
          shardCount: 4,
          shardIndex: jobIndex,
          historyPath: commonHistoryPath,
          outputDir: path.join(root, `common-job-${jobIndex}`),
          roots: [root],
        }),
      ),
    );
    const commonAssignments = commonJobs.map((job) => job.selected);
    expect(() => validateShardAssignment(discovered, commonAssignments)).not.toThrow();
    const assigned = commonAssignments.flatMap((shard) => shard.files);
    expect(assigned.toSorted(compareStrings)).toEqual(discovered);
    expect(new Set(assigned).size).toBe(discovered.length);
  });

  it('wires every root test job to the same combined history', async () => {
    const workflow = await readFile(
      new URL('../.github/workflows/ci.yml', import.meta.url),
      'utf8',
    );
    const rootTestJob = workflow.slice(
      workflow.indexOf('  test:'),
      workflow.indexOf('  starter-packages:'),
    );

    expect(workflow).toContain('permissions:\n  contents: read\n  actions: read');
    const actionRefs = [...workflow.matchAll(/uses:\s+[^\s@]+@([^\s]+)/gu)].map(
      (match) => match[1],
    );
    expect(actionRefs.length).toBeGreaterThan(0);
    for (const ref of actionRefs) expect(ref).toMatch(/^[0-9a-f]{40}$/u);
    expect(rootTestJob).toContain('select(.updatedAt < \\"$run_created_at\\")');
    expect(rootTestJob).toContain('for shard in $(seq 1 "${{ matrix.total }}"); do');
    expect(rootTestJob).toContain('-n "kovo-root-timing-history-$shard"');
    expect(rootTestJob).toContain('scripts/ci-shards.mjs combine-histories');
    expect(rootTestJob).toContain(
      '--history "$RUNNER_TEMP/kovo-common-timing/timing-history.json"',
    );
    expect(rootTestJob).not.toContain(
      'gh run download "$run_id" -n kovo-root-timing-history-${{ matrix.shard }}',
    );
    const extractStep = rootTestJob.slice(rootTestJob.indexOf('name: Extract root timing history'));
    expect(extractStep).not.toContain('merge-vitest --previous');
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
      399, 414, 405, 379, 378, 414, 374, 377, 417, 383,
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

  it('fails closed before execution when a starter filter matches no collected test', async () => {
    const manifest = await starterManifest([
      { file: 'stale.test.ts', id: 'stale-entry', testName: 'renamed proof' },
    ]);
    const calls = [];
    const spawnSync = (command, args, options) => {
      calls.push({ args, command, options });
      return {
        status: 0,
        stderr: '',
        stdout: JSON.stringify([{ file: '/repo/stale.test.ts', name: 'suite > current proof' }]),
      };
    };

    await expect(runStarterShard(manifest, { spawnSync })).rejects.toThrow(
      'Starter test filters matched zero collected tests in stale.test.ts: stale-entry="renamed proof"',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      args: ['exec', 'vitest', 'list', 'stale.test.ts', '--json'],
      command: 'vp',
    });
  });

  it('matches every corrected starter filter against the current quoted test titles', async () => {
    const correctedIds = new Set([
      'security-auth-helper',
      'transaction-managed-write-escape-default',
      'transaction-managed-write-escape-sqlite',
      'transaction-readonly-escape-default',
      'transaction-readonly-escape-sqlite',
      'transaction-readonly-runtime-floor',
      'transaction-sqlite-served-artifact',
      'transaction-webhook-escape-default',
      'transaction-webhook-escape-sqlite',
    ]);
    const entries = starterEntries().filter((entry) => correctedIds.has(entry.id));
    expect(entries).toHaveLength(correctedIds.size);
    const manifest = await starterManifest(entries);
    const collectedByFile = {
      'packages/create-kovo/src/index.build.prod-artifact.security.test.ts': [
        'create-kovo starter > blocks local-helper credential-shaped secret laundering from the production build artifact',
      ],
      'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts': [
        "create-kovo starter > blocks managed write raw-driver escapes before 'default' artifact emission",
        "create-kovo starter > blocks managed write raw-driver escapes before 'SQLite' artifact emission",
        "create-kovo starter > blocks 'default' readonly DB computed-method escapes before artifact emission",
        "create-kovo starter > blocks 'SQLite' readonly DB computed-method escapes before artifact emission",
        'create-kovo starter > keeps the production readonly DB floor active when KV433 static findings are advisory',
        'create-kovo starter > serves SQLite readonly reads and executes webhook mutation composition in the production artifact',
        "create-kovo starter > blocks 'default' webhook context.tx raw-driver escapes before artifact emission",
        "create-kovo starter > blocks 'SQLite' webhook context.tx raw-driver escapes before artifact emission",
      ],
    };
    const calls = [];
    const spawnSync = (command, args) => {
      calls.push({ args, command });
      if (args[2] === 'list') {
        const file = args[3];
        return {
          status: 0,
          stderr: '',
          stdout: JSON.stringify(
            collectedByFile[file].map((name) => ({ file: `/repo/${file}`, name })),
          ),
        };
      }
      return { status: 0 };
    };

    await expect(runStarterShard(manifest, { spawnSync })).resolves.toBeUndefined();
    expect(calls.filter((call) => call.args[2] === 'list')).toHaveLength(2);
    expect(
      calls.filter((call) => call.args[1] === 'vitest' && call.args[2] === '--run'),
    ).toHaveLength(2);
  });

  it('applies each configured starter filter as a regular expression', () => {
    expect(() =>
      validateStarterGroupTestFilters(
        [{ file: 'proof.test.ts', id: 'regex-entry', testName: 'proof (one|two)$' }],
        ['suite > proof two'],
      ),
    ).not.toThrow();
  });

  it('keeps file-wide starter entries supported after live test collection', async () => {
    const manifest = await starterManifest([{ file: 'whole-file.test.ts', id: 'whole-file' }]);
    const calls = [];
    const spawnSync = (command, args) => {
      calls.push({ args, command });
      if (args[2] === 'list') {
        return {
          status: 0,
          stderr: '',
          stdout: JSON.stringify([
            { file: '/repo/whole-file.test.ts', name: 'whole file > first proof' },
          ]),
        };
      }
      return { status: 0 };
    };

    await expect(runStarterShard(manifest, { spawnSync })).resolves.toBeUndefined();
    expect(calls[1]).toMatchObject({
      args: ['exec', 'vitest', '--run', 'whole-file.test.ts'],
      command: 'vp',
    });
  });

  it('fails closed when starter test collection cannot start or returns invalid output', async () => {
    const manifest = await starterManifest([
      { file: 'proof.test.ts', id: 'proof', testName: 'current proof' },
    ]);

    await expect(
      runStarterShard(manifest, {
        spawnSync: () => ({ error: new Error('spawn ENOENT'), status: null }),
      }),
    ).rejects.toThrow('Starter test collection for proof.test.ts could not start: spawn ENOENT');
    await expect(
      runStarterShard(manifest, {
        spawnSync: () => ({ status: 2, stderr: 'collection failed', stdout: '' }),
      }),
    ).rejects.toThrow('Starter test collection for proof.test.ts failed with exit code 2');
    await expect(
      runStarterShard(manifest, {
        spawnSync: () => ({ status: 0, stderr: '', stdout: 'not-json' }),
      }),
    ).rejects.toThrow('Starter test collection for proof.test.ts returned invalid JSON');
  });

  it('fails closed when the validated starter test process cannot start', async () => {
    const manifest = await starterManifest([
      { file: 'proof.test.ts', id: 'proof', testName: 'current proof' },
    ]);
    let call = 0;
    const spawnSync = () => {
      call += 1;
      if (call === 1) {
        return {
          status: 0,
          stderr: '',
          stdout: JSON.stringify([{ file: '/repo/proof.test.ts', name: 'suite > current proof' }]),
        };
      }
      return { error: new Error('spawn EACCES'), status: null };
    };

    await expect(runStarterShard(manifest, { spawnSync })).rejects.toThrow(
      'Starter entries proof could not start: spawn EACCES',
    );

    call = 0;
    const exitedSpawnSync = () => {
      call += 1;
      if (call === 1) {
        return {
          status: 0,
          stderr: '',
          stdout: JSON.stringify([{ file: '/repo/proof.test.ts', name: 'suite > current proof' }]),
        };
      }
      return { status: 7 };
    };
    await expect(runStarterShard(manifest, { spawnSync: exitedSpawnSync })).rejects.toThrow(
      'Starter entries proof failed with exit code 7',
    );
  });
});

function compareStrings(a, b) {
  return a.localeCompare(b);
}

let fixtureSequence = 0;

async function fixtureRoot() {
  fixtureSequence += 1;
  const root = path.join(
    process.env.RUNNER_TEMP ?? tmpdir(),
    `kovo-ci-shards-${process.pid}-${Date.now()}-${fixtureSequence}`,
  );
  await mkdir(root, { recursive: true });
  return root;
}

async function writeFixture(rootDir, relativePath, source) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, source);
}

async function starterManifest(entries) {
  const root = await fixtureRoot();
  const file = path.join(root, 'starter.json');
  await writeFile(file, `${JSON.stringify({ entries, kind: 'starter' })}\n`);
  return file;
}
