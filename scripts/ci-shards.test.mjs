import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REQUIRED_CLASSIFIER_CORPORA } from './check-security-classifier-corpus.mjs';

import {
  balanceStarterShards,
  balanceShards,
  combineDurationHistories,
  combineTimingHistoryDirectory,
  collectStarterGroupTestNames,
  createKovoAcceptanceOwners,
  discoverCreateKovoAcceptanceTests,
  extractPlaywrightDurations,
  extractVitestDurations,
  discoverTests,
  groupStarterEntriesForExecution,
  includeVitest,
  mergeDurationHistory,
  runAcceptanceTestProcess,
  runStarterShard,
  ROOT_VITEST_DURATION_FLOOR_SECONDS,
  ROOT_VITEST_JOB_TIMEOUT_SECONDS,
  ROOT_VITEST_SHARD_BUDGET_SECONDS,
  ROOT_VITEST_SHARD_COUNT,
  starterEntries,
  starterEntriesForMode,
  starterGroupVitestArgs,
  starterShardNeedsPacked,
  starterShardNeedsPostgres,
  unknownDurationSeconds,
  validateAcceptanceTopology,
  validateCreateKovoAcceptanceOwnership,
  validatePackedStarterDirectory,
  validateStarterFileTestCoverage,
  validateStarterGroupTestFilters,
  validateShardAssignment,
  writeShardManifests,
} from './ci-shards.mjs';
import {
  ADVERSARIAL_RESIDUAL_TEST_TIMEOUT_MS,
  adversarialResidualTestTimeoutMs,
} from '../packages/create-kovo/src/index.build.prod-artifact.adversarial-deadlines.mjs';
import { generatedStarterTestTimeoutMs } from '../packages/create-kovo/src/index.test-deadlines.mjs';
import {
  KOVO_BUILD_ONE_SHOT_WORKER_TIMEOUT_MS,
  KOVO_BUILD_ONE_SHOT_STATIC_TRUST_PHASES,
  STATIC_TRUST_WORKER_TIMEOUT_MS,
} from '../packages/cli/src/commands/build-security-deadlines.js';
import {
  PARANOID_GATE_CASES,
  PARANOID_NESTED_ONE_SHOT_TIMEOUT_MS,
} from '../packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime-runner.js';

function namedFunctionDeclaration(sourceFile, name) {
  let declaration;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      declaration = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (declaration === undefined) throw new Error(`Missing function declaration: ${name}`);
  return declaration;
}

function directlyNamedCalls(node) {
  const calls = [];
  const visit = (child) => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
      calls.push(child.expression.text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return calls;
}

function workflowJobSource(workflow, job) {
  const lines = workflow.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${job}:`);
  if (start === -1) throw new Error(`CI workflow is missing ${job}.`);
  const end = lines.findIndex((line, index) => index > start && /^  [a-z][a-z0-9-]*:$/u.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

function classifierCheckTopologyIsExact(scripts) {
  const expected = [
    ...scripts['check:pre-classifier'].split(' && '),
    'pnpm run check:security-classifier-corpus',
    ...scripts['check:post-classifier'].split(' && '),
  ].join(' && ');
  return scripts.check === expected;
}

describe('ci-shards', () => {
  it('keeps the classifier corpus mandatory while running it independently from static-core', async () => {
    const [packageSource, workflowSource] = await Promise.all([
      readFile(new URL('../package.json', import.meta.url), 'utf8'),
      readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
    ]);
    const scripts = JSON.parse(packageSource).scripts;
    const checkSteps = scripts.check.split(' && ');
    expect(classifierCheckTopologyIsExact(scripts)).toBe(true);
    expect(
      checkSteps.filter((step) => step === 'pnpm run check:security-classifier-corpus'),
    ).toHaveLength(1);
    expect(
      classifierCheckTopologyIsExact({
        ...scripts,
        check: scripts.check.replace(' && pnpm run check:security-classifier-corpus', ''),
      }),
    ).toBe(false);
    expect(
      classifierCheckTopologyIsExact({
        ...scripts,
        check: scripts.check.replace(
          'pnpm run check:security-classifier-corpus && pnpm run check:security-test-builds',
          'pnpm run check:security-test-builds && pnpm run check:security-classifier-corpus',
        ),
      }),
    ).toBe(false);
    expect(
      classifierCheckTopologyIsExact({
        ...scripts,
        'check:pre-classifier': scripts['check:pre-classifier'].replace(
          'pnpm run check:replay-model',
          'pnpm run check:vp',
        ),
      }),
    ).toBe(false);
    expect(scripts['check:static-core']).toBe(
      'pnpm run check:pre-classifier && pnpm run check:post-classifier',
    );

    const staticCore = workflowJobSource(workflowSource, 'static-core');
    const classifierCorpus = workflowJobSource(workflowSource, 'classifier-corpus');
    const aggregate = workflowJobSource(workflowSource, 'check');
    expect(staticCore).toContain('run: vp exec pnpm run check:static-core');
    expect(staticCore).not.toContain('check:security-classifier-corpus');
    expect(classifierCorpus).toContain('run: vp exec pnpm run check:security-classifier-corpus');
    expect(classifierCorpus).not.toContain('needs:');
    expect(aggregate.match(/^      - classifier-corpus$/gmu)).toHaveLength(1);
    expect(classifierCorpus).toContain("java-version: '21.0.11+10.0.LTS'");
    expect(classifierCorpus).toContain("KOVO_TLA_OFFLINE: '1'");
    expect(classifierCorpus).toContain("rebuild-better-sqlite3: 'true'");
    const postgresBinariesStep = `      - name: Expose hosted PostgreSQL server binaries
        run: |
          postgres_bindir="$(pg_config --bindir)"
          test -x "$postgres_bindir/initdb"
          test -x "$postgres_bindir/postgres"
          echo "$postgres_bindir" >> "$GITHUB_PATH"`;
    expect(classifierCorpus).toContain(postgresBinariesStep);
    expect(classifierCorpus.indexOf(postgresBinariesStep)).toBeLessThan(
      classifierCorpus.indexOf('run: vp exec pnpm run check:security-classifier-corpus'),
    );
    const timeoutMinutes = Number(classifierCorpus.match(/timeout-minutes: (\d+)/u)?.[1]);
    expect(timeoutMinutes).toBeGreaterThanOrEqual(50 + 40);
  });

  it('binds the one-shot timeout plan to the exact production trust preflights', async () => {
    const sourceText = await readFile(
      new URL('../packages/cli/src/commands/build-export.ts', import.meta.url),
      'utf8',
    );
    const sourceFile = ts.createSourceFile(
      'build-export.ts',
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const produceAnalysisCalls = directlyNamedCalls(
      namedFunctionDeclaration(sourceFile, 'produceKovoBuildOneShotAnalysis'),
    );
    const loadAndCheckCalls = directlyNamedCalls(
      namedFunctionDeclaration(sourceFile, 'loadAndCheckBuildApp'),
    );
    expect(produceAnalysisCalls.filter((name) => name === 'loadAndCheckBuildApp')).toHaveLength(1);

    const trustPreflightByPhase = {
      app: 'runPreEvaluationStaticTrustPreflightInWorker',
      config: 'runPreEvaluationBuildConfigTrustPreflightInWorker',
    };
    const plannedTrustPreflights = KOVO_BUILD_ONE_SHOT_STATIC_TRUST_PHASES.map(
      (phase) => trustPreflightByPhase[phase],
    );
    const productionTrustPreflights = [...produceAnalysisCalls, ...loadAndCheckCalls].filter(
      (name) => name.endsWith('TrustPreflightInWorker'),
    );
    expect(productionTrustPreflights).toEqual(plannedTrustPreflights);
  });

  it('keeps the direct-Node paranoid runner and every nested hard deadline loadable and contained', async () => {
    const runnerUrl = new URL(
      '../packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime-runner.ts',
      import.meta.url,
    );
    const directImport = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--experimental-strip-types',
        '--input-type=module',
        '--eval',
        `await import(${JSON.stringify(runnerUrl.href)});`,
      ],
      { encoding: 'utf8' },
    );
    expect(directImport.status, directImport.stderr).toBe(0);

    expect(PARANOID_NESTED_ONE_SHOT_TIMEOUT_MS).toBe(KOVO_BUILD_ONE_SHOT_WORKER_TIMEOUT_MS);

    const workflowSource = await readFile(
      new URL('../.github/workflows/ci.yml', import.meta.url),
      'utf8',
    );
    const paranoidJobStart = workflowSource.indexOf('\n  paranoid:\n');
    const paranoidJobEnd = workflowSource.indexOf('\n  api-surface:\n', paranoidJobStart);
    expect(paranoidJobStart).toBeGreaterThan(-1);
    expect(paranoidJobEnd).toBeGreaterThan(paranoidJobStart);
    const timeoutMatch = workflowSource
      .slice(paranoidJobStart, paranoidJobEnd)
      .match(/^\s+timeout-minutes:\s*(\d+)\s*$/mu);
    expect(timeoutMatch).not.toBeNull();
    const workflowTimeoutMs = Number(timeoutMatch?.[1]) * 60_000;
    const serialSupervisorTimeoutMs = PARANOID_GATE_CASES.reduce(
      (total, testCase) => total + testCase.supervisorTimeoutMs,
      0,
    );
    const workflowSetupAndOrchestrationHeadroomMs = 9 * 60_000;
    expect(workflowTimeoutMs).toBeGreaterThanOrEqual(
      serialSupervisorTimeoutMs + workflowSetupAndOrchestrationHeadroomMs,
    );
  });

  it('packs the verify package required by packed starter installation', async () => {
    const source = await readFile(new URL('./ci-shards.mjs', import.meta.url), 'utf8');
    expect(source).toContain("{ name: '@kovojs/verify', dir: 'verify' }");
    expect(source).toContain('canonicalizePackedTarball(tarball);');
    expect(source).toContain("'../packages/create-kovo/src/index.test-process-supervisor.mjs'");
    expect(source).toContain('supervisorTimeoutMs: 5 * 60_000,');
    expect(source).toContain(
      'if (packedRoot) await rm(packedRoot, { force: true, recursive: true });',
    );
    expect(source).toContain('const MAX_LIVE_ACCEPTANCE_OUTPUT_BYTES = 32 * 1024 * 1024;');
    expect(source.match(/maxOutputBytes: MAX_LIVE_ACCEPTANCE_OUTPUT_BYTES,/gu)).toHaveLength(3);
    expect(source.match(/captureOutput: false,\n\s+forwardOutput: true,/gu)).toHaveLength(3);
  });

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
    expect(ROOT_VITEST_SHARD_COUNT).toBe(5);
    expect(ROOT_VITEST_JOB_TIMEOUT_SECONDS).toBe(60 * 60);
    expect(ROOT_VITEST_SHARD_BUDGET_SECONDS).toBe(50 * 60);
    expect(ROOT_VITEST_SHARD_COUNT / 4).toBe(1.25);
    expect((ROOT_VITEST_SHARD_COUNT * ROOT_VITEST_JOB_TIMEOUT_SECONDS) / 60).toBe(300);
    expect(rootTestJob).toContain('timeout-minutes: 60');
    expect(rootTestJob).toContain('shard: [1, 2, 3, 4, 5]');
    expect(rootTestJob).toContain('total: [5]');
    expect(rootTestJob).toContain('.created_at < \\"$run_created_at\\"');
    expect(rootTestJob).toContain('.workflow_run.head_branch == \\"main\\"');
    expect(rootTestJob).toContain('.workflow_run.id != $GITHUB_RUN_ID');
    expect(rootTestJob).not.toContain('--status success');
    expect(rootTestJob).toContain('for shard in $(seq 1 "${{ matrix.total }}"); do');
    expect(rootTestJob).toContain('actions/artifacts?name=$artifact_name&per_page=100');
    expect(rootTestJob).toContain('artifact_name="kovo-root-timing-history-$shard"');
    expect(rootTestJob).toContain('if ! run_id="$(gh api');
    expect(rootTestJob).toContain('-n "$artifact_name"');
    expect(rootTestJob).toContain('if gh run download "$run_id"');
    expect(rootTestJob).toContain('test -f "$candidate/timing-history.json"');
    expect(rootTestJob).toContain('cp "$candidate/timing-history.json"');
    expect(rootTestJob).toContain('scripts/ci-shards.mjs combine-histories');
    expect(rootTestJob).toContain(
      'Timing history shard $shard is unavailable; using reviewed duration floors.',
    );
    expect(rootTestJob).toContain(
      'Timing history shard $shard disappeared during download; using reviewed duration floors.',
    );
    expect(rootTestJob).toContain(
      'Timing history shard $shard lookup failed; using reviewed duration floors.',
    );
    expect(rootTestJob).toContain(
      '--history "$RUNNER_TEMP/kovo-common-timing/timing-history.json"',
    );
    expect(rootTestJob).toContain('vitest --run --no-file-parallelism');
    expect(rootTestJob).not.toContain(
      'gh run download "$run_id" -n kovo-root-timing-history-${{ matrix.shard }}',
    );
    const extractStep = rootTestJob.slice(rootTestJob.indexOf('name: Extract root timing history'));
    expect(extractStep).not.toContain('merge-vitest --previous');
  });

  it('keeps the measured five-way root plan below the 50-minute execution budget', async () => {
    const files = await discoverTests('vitest');
    const floorFiles = Object.keys(ROOT_VITEST_DURATION_FLOOR_SECONDS);
    expect(floorFiles).toHaveLength(20);
    for (const file of floorFiles) expect(files, file).toContain(file);

    // One second for every unmeasured file makes this a complete assignment proof while the
    // reviewed floors carry the current hosted monolith measurements.
    const history = Object.fromEntries(files.map((file) => [file, { seconds: 1 }]));
    const shards = balanceShards(files, history, ROOT_VITEST_SHARD_COUNT, {
      durationFloors: ROOT_VITEST_DURATION_FLOOR_SECONDS,
    });
    expect(() => validateShardAssignment(files, shards)).not.toThrow();
    expect(Math.max(...shards.map((shard) => shard.seconds))).toBeLessThanOrEqual(
      ROOT_VITEST_SHARD_BUDGET_SECONDS,
    );
    const indexBuildShard = shards.find((shard) =>
      shard.files.includes('packages/cli/src/index.kovo-build.test.ts'),
    );
    expect(indexBuildShard).toEqual({
      files: ['packages/cli/src/index.kovo-build.test.ts'],
      seconds: ROOT_VITEST_DURATION_FLOOR_SECONDS['packages/cli/src/index.kovo-build.test.ts'],
    });
    expect(
      ROOT_VITEST_JOB_TIMEOUT_SECONDS - (indexBuildShard?.seconds ?? 0),
    ).toBeGreaterThanOrEqual(10 * 60);
    const localShard = shards.findIndex((shard) =>
      shard.files.includes(
        'packages/cli/src/commands/build-export-semantic-intrinsics-local.test.ts',
      ),
    );
    const controlsShard = shards.findIndex((shard) =>
      shard.files.includes(
        'packages/cli/src/commands/build-export-semantic-intrinsics-controls.test.ts',
      ),
    );
    expect(localShard).toBeGreaterThan(-1);
    expect(controlsShard).toBeGreaterThan(-1);
    expect(controlsShard).not.toBe(localShard);
  });

  it('preserves all 97 semantic-intrinsic selectors across the five physical buckets', () => {
    const files = ['calls', 'protocols', 'identity', 'local', 'controls'].map(
      (bucket) => `packages/cli/src/commands/build-export-semantic-intrinsics-${bucket}.test.ts`,
    );
    const listed = spawnSync('vp', ['exec', 'vitest', 'list', ...files, '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(listed.error, listed.stderr).toBeUndefined();
    expect(listed.signal, listed.stderr).toBeNull();
    expect(listed.status, listed.stderr).toBe(0);
    const tests = JSON.parse(listed.stdout);
    const counts = Object.fromEntries(
      files.map((file) => [file, tests.filter((test) => test.file.endsWith(`/${file}`)).length]),
    );
    expect(counts).toEqual({
      'packages/cli/src/commands/build-export-semantic-intrinsics-calls.test.ts': 26,
      'packages/cli/src/commands/build-export-semantic-intrinsics-controls.test.ts': 2,
      'packages/cli/src/commands/build-export-semantic-intrinsics-identity.test.ts': 25,
      'packages/cli/src/commands/build-export-semantic-intrinsics-local.test.ts': 18,
      'packages/cli/src/commands/build-export-semantic-intrinsics-protocols.test.ts': 26,
    });
    expect(Object.values(counts).reduce((total, count) => total + count, 0)).toBe(97);
  });

  it('runs source-generated starter fixtures against the same-run current package build', async () => {
    const workflow = await readFile(
      new URL('../.github/workflows/ci.yml', import.meta.url),
      'utf8',
    );
    const starterJob = workflow.slice(
      workflow.indexOf('  starter:'),
      workflow.indexOf('  starter-packed:'),
    );
    const producerJob = workflow.slice(
      workflow.indexOf('  starter-packages:'),
      workflow.indexOf('  starter:'),
    );

    expect(producerJob).toContain(
      'node scripts/ci-shards.mjs pack-starter --outDir "$RUNNER_TEMP/kovo-packed-starter"',
    );
    expect(producerJob).toContain('name: kovo-packed-starter');
    expect(starterJob).toContain('needs: starter-packages');
    expect(starterJob).toContain(
      'uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
    );
    expect(starterJob).toContain('name: kovo-packed-starter');
    expect(starterJob).toContain(
      'KOVO_PACKED_PACKAGES_DIR: ${{ runner.temp }}/kovo-packed-starter',
    );
    expect(starterJob).toContain('KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES: packed-current');
    expect(starterJob).toContain('generate-starter --mode unpacked');
    expect(starterJob).toContain('--cadence per-pr');
    expect(starterJob).toContain('starter-needs-postgres');
    expect(starterJob).toContain("if: steps.starter-shard.outputs.needsPostgres == 'true'");
    expect(starterJob.indexOf('actions/download-artifact@')).toBeLessThan(
      starterJob.indexOf('Generated starter proofs'),
    );
    expect(starterJob).not.toContain('PRODUCTION_ARTIFACT_TEST_TIMEOUT_MS');
  });

  it('wires all-cadence acceptance plus bounded PR, nightly, and release owners', async () => {
    const [pkg, ci, nightly, release] = await Promise.all([
      readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
      readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
      readFile(new URL('../.github/workflows/security-nightly.yml', import.meta.url), 'utf8'),
      readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'),
    ]);
    expect(pkg.scripts.acceptance).toContain('pnpm run test:starter:acceptance');
    expect(pkg.scripts['test:starter:acceptance']).toContain('--mode all --cadence all');
    expect(pkg.scripts['test:starter:security-nightly']).toContain(
      '--mode unpacked --cadence nightly',
    );
    expect(pkg.scripts['test:authz-paranoid']).toContain(
      'index.build.prod-artifact.paranoid-runtime-runner.ts',
    );
    expect(ci).toContain('  static-core:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 90');
    expect(ci).toContain('  paranoid:\n    runs-on: ubuntu-latest');
    expect(ci).toContain(
      '  starter:\n    needs: starter-packages\n    runs-on: ubuntu-latest\n    timeout-minutes: 40',
    );
    expect(ci).toContain('name: Validate acceptance ownership and selector coverage');
    expect(nightly).toContain('  starter-security-residual:');
    expect(nightly).toContain('timeout-minutes: 140');
    expect(nightly).toContain('vp exec pnpm run test:starter:security-nightly');
    expect(release).toContain('  starter-security-residual:');
    expect(release).toContain('      - starter-security-residual');
    expect(release).toContain('"$KOVO_RELEASE_PNPM_CLI" run test:starter:security-nightly');
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
    expect(includeVitest('scripts/g11-cloud-run-journey.test.mjs')).toBe(false);
    expect(includeVitest('scripts/security-gate-mutations.test.mjs')).toBe(false);
    expect(includeVitest('scripts/fixtures/public-api-inventory/tests/api.test.ts')).toBe(false);
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
      includeVitest('packages/create-kovo/src/index.build.prod-artifact.postgres-external.test.ts'),
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
    expect(includeVitest('packages/create-kovo/src/index.example.packed.test.ts')).toBe(false);
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

  it('gives every create-kovo acceptance file exactly one manifest owner', async () => {
    const discovered = await discoverCreateKovoAcceptanceTests();
    const owners = createKovoAcceptanceOwners();
    expect(discovered).toHaveLength(29);
    expect(owners).toHaveLength(discovered.length);
    expect(() => validateCreateKovoAcceptanceOwnership(discovered)).not.toThrow();
    const manuallyBoundEntries = starterEntries();
    expect(() =>
      validateCreateKovoAcceptanceOwnership(
        discovered,
        manuallyBoundEntries.map((entry) =>
          entry.id === 'contacts-add-contact'
            ? { ...entry, timeoutMs: entry.testTimeoutMs + 59_999 }
            : entry,
        ),
      ),
    ).toThrow('must retain 60000ms beyond its test timeout');
    expect(() =>
      validateCreateKovoAcceptanceOwnership(
        discovered,
        manuallyBoundEntries.map((entry) =>
          entry.id === 'contacts-add-contact'
            ? { ...entry, timeoutMs: entry.testTimeoutMs + 60_000 }
            : entry,
        ),
      ),
    ).not.toThrow();
    expect(Object.fromEntries(owners.map((owner) => [owner.file, owner.lane]))).toMatchObject({
      'packages/create-kovo/src/index.build.prod-artifact.client-ip.test.ts': 'classifier',
      'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime-gate.test.ts': 'root',
      'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime-runner.test.ts': 'root',
      'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts': 'paranoid',
      'packages/create-kovo/src/index.build.prod-artifact.sink-census.test.ts': 'c9',
      'packages/create-kovo/src/index.build.prod-artifact.table-security.test.ts': 'starter',
      'packages/create-kovo/src/index.example.packed.test.ts': 'starter-packed',
    });
    const packedExampleFile = 'packages/create-kovo/src/index.example.packed.test.ts';
    const packedExampleEntries = starterEntries().filter(
      (entry) => entry.file === packedExampleFile,
    );
    expect(packedExampleEntries).toMatchObject([
      { cadence: 'per-pr', id: 'starter-packed-examples', needsPacked: true },
    ]);
    expect(() =>
      validateCreateKovoAcceptanceOwnership(
        discovered,
        starterEntries().filter((entry) => entry.file !== packedExampleFile),
      ),
    ).toThrow(`Starter-owned acceptance file has no entries: ${packedExampleFile}`);
    expect(
      includeVitest(
        'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime-gate.test.ts',
      ),
    ).toBe(true);
    expect(
      includeVitest('packages/create-kovo/src/index.build.prod-artifact.client-ip.test.ts'),
    ).toBe(false);
    expect(
      includeVitest('packages/create-kovo/src/index.build.prod-artifact.sink-census.test.ts'),
    ).toBe(false);
    expect(starterEntries().every((entry) => Number.isInteger(entry.timeoutMs))).toBe(true);
  });

  it('proves exact reverse selector ownership against current Vitest identities', async () => {
    const adversarialSource = await readFile(
      new URL(
        '../packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
        import.meta.url,
      ),
      'utf8',
    );
    if (!adversarialSource.includes('keeps BUGZ25/31 production fixtures formatter-clean')) {
      // Integration commit 78513c adds this lightweight identity before the topology commit lands.
      await expect(validateAcceptanceTopology({ spawnSync })).rejects.toThrow(
        /bugz-fixture-format=.*keeps BUGZ25\/31 production fixtures formatter-clean/,
      );
      return;
    }
    const result = await validateAcceptanceTopology({ spawnSync });
    expect(result.discoveredFiles).toHaveLength(29);
    expect(result.selectorFiles).toEqual([
      'packages/create-kovo/src/index.build.prod-artifact.contacts.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.postgres-external.test.ts',
      'packages/create-kovo/src/index.build.scaffold.sqlite.test.ts',
      'packages/create-kovo/src/index.build.scaffold.production.test.ts',
      'packages/create-kovo/src/index.build.scaffold.source-check.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.table-security.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
      'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
    ]);
  });

  it('routes the two Postgres artifact identities explicitly and marks only real PG', () => {
    const file = 'packages/create-kovo/src/index.build.prod-artifact.postgres-external.test.ts';
    expect(includeVitest(file)).toBe(false);
    const entries = starterEntries().filter((entry) => entry.file === file);
    expect(entries.map((entry) => entry.id)).toEqual([
      'postgres-external-pglite-refusal',
      'postgres-external-real-postgres',
    ]);
    expect(entries.filter((entry) => entry.needsPostgres).map((entry) => entry.id)).toEqual([
      'postgres-external-real-postgres',
    ]);
  });

  it('keeps the no-build BUGZ fixture-format regression enrolled in the starter lane', () => {
    const file = 'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts';
    expect(includeVitest(file)).toBe(false);
    expect(starterEntries().filter((entry) => entry.id === 'bugz-fixture-format')).toMatchObject([
      {
        cadence: 'per-pr',
        file,
        id: 'bugz-fixture-format',
        seconds: 10,
        testName: 'keeps BUGZ25/31 production fixtures formatter-clean before build preflight',
        timeoutMs: 300_000,
      },
    ]);
  });

  it('splits loaded proofs and keeps the outer supervisor beyond each test watchdog', () => {
    const rawHtmlProvenanceTestTimeoutMs = generatedStarterTestTimeoutMs(
      { cliProcessCount: 2 },
      { ci: true },
    );
    expect(rawHtmlProvenanceTestTimeoutMs).toBe(1_060_000);
    const affected = Object.fromEntries(
      starterEntries()
        .filter((entry) =>
          [
            'contacts-add-contact',
            'header-artifacts',
            'island-derive-artifacts',
            'island-derive-helper-preflight',
            'm1-raw-html-mutable-alias',
            'm1-raw-html-provenance',
            'm1-storage-write-fixture-contract',
            'm1-storage-write-opaque',
            'm1-storage-write-provenance',
            'm1-postgres-raw-sql',
            'm1-sqlite-raw-sql',
            'runtime-contract-artifacts',
            'security-runtime-wires-postgres',
            'security-runtime-wires-sqlite',
            'starter-production-graph-gate',
            'starter-production-warm-cache',
            'starter-sqlite-check',
            'starter-sqlite-durable-task-refusal',
            'starter-sqlite-parser-dependency',
            'transaction-default-served-artifact',
          ].includes(entry.id),
        )
        .map((entry) => [entry.id, entry]),
    );

    expect(affected).toMatchObject({
      'contacts-add-contact': { seconds: 257, testTimeoutMs: 600_000, timeoutMs: 660_000 },
      'header-artifacts': { seconds: 301, testTimeoutMs: 600_000, timeoutMs: 660_000 },
      'island-derive-artifacts': {
        seconds: 301,
        testName: 'hydrates destructured state aliases',
        testTimeoutMs: 600_000,
        timeoutMs: 660_000,
      },
      'island-derive-helper-preflight': {
        seconds: 67,
        testName: 'rejects unbound module-helper state derives',
        testTimeoutMs: 600_000,
        timeoutMs: 660_000,
      },
      'm1-raw-html-provenance': {
        seconds: 391,
        testName: 'M1:raw-html tracks trusted output provenance',
        testTimeoutMs: rawHtmlProvenanceTestTimeoutMs,
        timeoutMs: rawHtmlProvenanceTestTimeoutMs + 60_000,
      },
      'm1-raw-html-mutable-alias': {
        seconds: 50,
        testName: 'M1:raw-html keeps mutable trusted-output aliases',
        timeoutMs: 300_000,
      },
      'm1-storage-write-fixture-contract': {
        expectedTestCount: 1,
        seconds: 5,
        testName: 'M1:storage-write fixture uses the current app-scoped declaration contract',
        timeoutMs: 300_000,
      },
      'm1-storage-write-opaque': {
        expectedTestCount: 1,
        seconds: 67,
        testName: 'M1:storage-write keeps opaque storage authority on the postgres KV424 path',
        testTimeoutMs: 480_000,
        timeoutMs: 540_000,
      },
      'm1-storage-write-provenance': {
        expectedTestCount: 1,
        seconds: 355,
        testName:
          'M1:storage-write tracks storage write gates from current postgres production source, not stale cache',
        testTimeoutMs: 720_000,
        timeoutMs: 780_000,
      },
      'm1-postgres-raw-sql': {
        seconds: 151,
        testName: 'M1:postgres-raw-sql',
        testTimeoutMs: 480_000,
        timeoutMs: 540_000,
      },
      'm1-sqlite-raw-sql': {
        seconds: 151,
        testName: 'M1:sqlite-raw-sql',
        testTimeoutMs: 480_000,
        timeoutMs: 540_000,
      },
      'runtime-contract-artifacts': {
        seconds: 302,
        testTimeoutMs: 600_000,
        timeoutMs: 660_000,
      },
      'security-runtime-wires-postgres': {
        seconds: 151,
        testName: 'serves postgres runtime-security wire escaping',
        testTimeoutMs: 820_000,
        timeoutMs: 880_000,
      },
      'security-runtime-wires-sqlite': {
        seconds: 151,
        testName: 'serves sqlite runtime-security wire escaping',
        testTimeoutMs: 820_000,
        timeoutMs: 880_000,
      },
      'starter-production-graph-gate': {
        expectedTestCount: 1,
        seconds: 141,
        testName: 'runs the generated production build graph gate',
        testTimeoutMs: 360_000,
        timeoutMs: 420_000,
      },
      'starter-production-warm-cache': {
        expectedTestCount: 1,
        seconds: 277,
        testName: 'rebuilds production artifacts from current source when cache is warm',
        testTimeoutMs: 600_000,
        timeoutMs: 660_000,
      },
      'starter-sqlite-check': {
        seconds: 151,
        testTimeoutMs: 620_000,
        timeoutMs: 680_000,
      },
      'starter-sqlite-durable-task-refusal': {
        seconds: 151,
        testTimeoutMs: 620_000,
        timeoutMs: 680_000,
      },
      'transaction-default-served-artifact': {
        seconds: 301,
        testName:
          'rolls back default mutation transactions and executes webhook mutation composition',
        testTimeoutMs: 600_000,
        timeoutMs: 660_000,
      },
      'starter-sqlite-parser-dependency': { seconds: 5, timeoutMs: 300_000 },
    });
    expect(starterEntries().some((entry) => entry.id === 'm1-raw-sql')).toBe(false);
    expect(starterEntries().some((entry) => entry.id === 'm1-raw-html')).toBe(false);
    expect(starterEntries().some((entry) => entry.id === 'm1-storage-write')).toBe(false);
    expect(starterEntries().some((entry) => entry.id === 'security-runtime-wires')).toBe(false);
    expect(starterEntries().some((entry) => entry.id === 'starter-production')).toBe(false);
    expect(starterEntries().some((entry) => entry.id === 'starter-sqlite')).toBe(false);
    for (const entry of Object.values(affected)) {
      if (entry.testTimeoutMs !== undefined) {
        expect(entry.timeoutMs - entry.testTimeoutMs, entry.id).toBeGreaterThanOrEqual(60_000);
      }
    }
  });

  it('binds every residual adversarial selector to its source watchdog and outer headroom', async () => {
    const source = await readFile(
      new URL(
        '../packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const sourceTimeouts = Object.entries(ADVERSARIAL_RESIDUAL_TEST_TIMEOUT_MS);
    const entries = starterEntries().filter((entry) =>
      Object.hasOwn(ADVERSARIAL_RESIDUAL_TEST_TIMEOUT_MS, entry.id),
    );

    expect(sourceTimeouts).toHaveLength(11);
    expect(entries.map((entry) => entry.id)).toEqual(sourceTimeouts.map(([id]) => id));
    expect(() => adversarialResidualTestTimeoutMs('adversarial-unknown-proof')).toThrow(
      'Unknown adversarial residual proof deadline',
    );

    for (const [id, sourceTimeoutMs] of sourceTimeouts) {
      const entry = entries.find((candidate) => candidate.id === id);
      expect(entry, id).toBeDefined();
      expect(entry).toMatchObject({
        cadence: 'nightly',
        expectedTestCount: 1,
        seconds: 420,
        testTimeoutMs: sourceTimeoutMs,
      });
      expect(entry.timeoutMs, id).toBeGreaterThan(sourceTimeoutMs);
      expect(entry.timeoutMs - sourceTimeoutMs, id).toBeGreaterThanOrEqual(60_000);
    }

    const carrierArrayStart = source.indexOf('const BUGZ31_GLOBAL_MEMBER_CARRIER_PROOFS = [');
    const carrierArrayEnd = source.indexOf('] as const;', carrierArrayStart);
    expect(carrierArrayStart).toBeGreaterThan(-1);
    expect(carrierArrayEnd).toBeGreaterThan(carrierArrayStart);
    const carrierIds = [
      ...source.slice(carrierArrayStart, carrierArrayEnd).matchAll(/^\s+'([^']+)',/gmu),
    ].map(([, proof]) => `adversarial-bugz31-${proof}`);
    expect(carrierIds).toHaveLength(6);
    for (const id of carrierIds) {
      expect(source, id).toContain(`'${id.slice('adversarial-bugz31-'.length)}'`);
    }
    for (const id of sourceTimeouts.map(([id]) => id).filter((id) => !carrierIds.includes(id))) {
      expect(source, id).toContain(`'${id}'`);
    }
    expect(source).toContain(
      'BUGZ31_GLOBAL_MEMBER_CARRIER_PROOFS.map((proof) => `adversarial-bugz31-${proof}`)',
    );
    expect(source).toContain('Residual adversarial proofs must be split by watchdog');

    const diagnosticStart = source.indexOf(
      "'fails the diagnostic assertion when an unchanged production build succeeds'",
    );
    const diagnosticEnd = source.indexOf('\n\n  it.each(', diagnosticStart);
    expect(diagnosticStart).toBeGreaterThan(-1);
    expect(diagnosticEnd).toBeGreaterThan(diagnosticStart);
    expect(source.slice(diagnosticStart, diagnosticEnd)).toContain(
      'diagnosticAssertionProofTimeout',
    );
    expect(source.slice(diagnosticStart, diagnosticEnd)).not.toContain('240_000');
  });

  it('retains measured hosted-runner deadline headroom on timed-out proofs', async () => {
    const [
      asyncContextSource,
      sourceCheckSource,
      postgresSource,
      indexBuildSource,
      runnableBuildSource,
      securityOrderSource,
      redirectSource,
      securitySource,
      deferSource,
      routeOutcomesSource,
      runtimeSource,
      transactionSource,
      productionArtifactSupportSource,
      starterTestSupportSource,
      starterDeadlineSource,
      scaffoldTypecheckSource,
      starterHarnessTemplateSource,
      adversarialSource,
    ] = await Promise.all([
      readFile(new URL('./check-async-context-confinement.test.mjs', import.meta.url), 'utf8'),
      readFile(new URL('../packages/cli/src/index.source-check.test.ts', import.meta.url), 'utf8'),
      readFile(
        new URL(
          '../packages/create-kovo/src/index.build.prod-artifact.postgres-external.test.ts',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(new URL('../packages/cli/src/index.kovo-build.test.ts', import.meta.url), 'utf8'),
      readFile(
        new URL('../packages/cli/src/commands/build-export-runnable.test.ts', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL(
          '../packages/cli/src/commands/build-export-security-order.test.ts',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL(
          '../packages/create-kovo/src/index.build.prod-artifact.redirect-capability.test.ts',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL(
          '../packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL(
          '../packages/create-kovo/src/index.build.prod-artifact.defer.test.ts',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL('../packages/cli/src/index.kovo-route-outcomes.test.ts', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../packages/create-kovo/src/index.build.runtime.test.ts', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL(
          '../packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL('../packages/create-kovo/src/index.build.test-support.ts', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../packages/create-kovo/src/index.test-support.ts', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../packages/create-kovo/src/index.test-deadlines.mjs', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL(
          '../packages/create-kovo/src/index.build.scaffold.typecheck.test.ts',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL('../packages/create-kovo/templates/src/app.test.ts', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL(
          '../packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
          import.meta.url,
        ),
        'utf8',
      ),
    ]);

    expect(asyncContextSource).toContain('}, 60_000);');
    expect(sourceCheckSource).toContain('}, 360_000);');
    expect(postgresSource.match(/\}, 600_000\);/gu)).toHaveLength(2);
    expect(STATIC_TRUST_WORKER_TIMEOUT_MS).toBe(600_000);
    expect(indexBuildSource).toContain('const BUILD_INTEGRATION_TEST_TIMEOUT_MS = 90_000;');
    expect(indexBuildSource).toContain('const HOSTED_SUCCESS_BUILD_PROCESS_DEADLINE_MS = 360_000;');
    expect(indexBuildSource).toContain(
      'const HOSTED_SUCCESS_BUILD_TEST_TIMEOUT_MS = kovoCliTestTimeoutMs(',
    );
    expect(
      [...indexBuildSource.matchAll(/^  hostedSuccessBuildIt\(([^,]+),/gmu)].map(
        ([, testName]) => testName,
      ),
    ).toEqual(['GUARDED_BUILD_SURFACES_TEST_NAME', 'NESTED_ANALYSIS_INPUTS_TEST_NAME']);
    expect(
      indexBuildSource.match(/deadlineMs: HOSTED_SUCCESS_BUILD_PROCESS_DEADLINE_MS/gu),
    ).toHaveLength(2);
    expect(indexBuildSource).toContain('const TRUSTED_ASSIGN_REVIEW_BUILD_COUNT = 3;');
    expect(indexBuildSource).toContain(
      'const TRUSTED_ASSIGN_REVIEW_BUILD_STEP_BUDGET_MS = 90_000;',
    );
    expect(indexBuildSource).toContain('{ length: TRUSTED_ASSIGN_REVIEW_BUILD_COUNT },');
    expect(indexBuildSource).toContain(
      'const TRUSTED_ASSIGN_REVIEW_TEST_TIMEOUT_MS = kovoCliTestTimeoutMs(',
    );
    expect(indexBuildSource).toContain('...TRUSTED_ASSIGN_REVIEW_BUILD_DEADLINES_MS');
    expect(indexBuildSource).toMatch(
      /function trustedAssignReviewIt\([\s\S]*?TRUSTED_ASSIGN_REVIEW_TEST_TIMEOUT_MS,[\s\S]*?\n\}/u,
    );
    const trustedAssignProof = indexBuildSource.match(
      /trustedAssignReviewIt\(async \(\) => \{(?<body>[\s\S]*?)\n  \}\);/u,
    );
    expect(trustedAssignProof).not.toBeNull();
    expect(trustedAssignProof?.groups?.body.match(/mainAsync\(\['build'/gu)).toHaveLength(3);
    expect(indexBuildSource).toContain(
      "describe('kovo build', { concurrent: false, timeout: BUILD_INTEGRATION_TEST_TIMEOUT_MS }",
    );
    expect(indexBuildSource).toContain('afterEach(() => {');
    expect(runnableBuildSource).toContain(
      "describe('build/export single Vite runnable environment', { timeout: 90_000 }",
    );
    expect(securityOrderSource).toContain('const KOVO_CLI_PROCESS_TIMEOUT_MS = 120_000;');
    expect(securityOrderSource).toContain(
      'const STATIC_CACHE_SYMLINK_PROCESS_TIMEOUT_MS = 240_000;',
    );
    expect(securityOrderSource).toContain(
      'const STATIC_CACHE_SYMLINK_TEST_TIMEOUT_MS = kovoCliTestTimeoutMs(',
    );
    expect(securityOrderSource).toContain(
      "describe('build/export security bootstrap ordering', { concurrent: false }",
    );
    expect(securityOrderSource).toContain('timeoutMs: number = KOVO_CLI_PROCESS_TIMEOUT_MS,');
    expect(securityOrderSource).toContain('timeout: timeoutMs,');
    expect(securityOrderSource).toMatch(
      /function staticCacheSymlinkIt\([\s\S]*?STATIC_CACHE_SYMLINK_TEST_TIMEOUT_MS,[\s\S]*?\n\}/u,
    );
    expect(securityOrderSource).toContain(
      'const UNDECLARED_VITE_CONFIG_PROCESS_TIMEOUT_MS = 240_000;',
    );
    expect(securityOrderSource).toContain(
      'const UNDECLARED_VITE_CONFIG_TEST_TIMEOUT_MS = kovoCliTestTimeoutMs(',
    );
    expect(securityOrderSource).toMatch(
      /function undeclaredViteConfigIt\([\s\S]*?UNDECLARED_VITE_CONFIG_TEST_TIMEOUT_MS,[\s\S]*?\n\}/u,
    );
    const cacheSymlinkStart = securityOrderSource.indexOf('staticCacheSymlinkIt(() => {');
    const cacheSymlinkEnd = securityOrderSource.indexOf('\n\n  it(', cacheSymlinkStart);
    expect(cacheSymlinkStart).toBeGreaterThan(-1);
    expect(cacheSymlinkEnd).toBeGreaterThan(cacheSymlinkStart);
    const cacheSymlinkProof = securityOrderSource.slice(cacheSymlinkStart, cacheSymlinkEnd);
    expect(cacheSymlinkProof).toContain('STATIC_CACHE_SYMLINK_PROCESS_TIMEOUT_MS,');
    expect(cacheSymlinkProof).toContain('expect(result.error, result.stderr).toBeUndefined();');
    expect(cacheSymlinkProof).toContain('expect(result.signal, result.stderr).toBeNull();');
    const undeclaredViteStart = securityOrderSource.indexOf('undeclaredViteConfigIt(() => {');
    const undeclaredViteEnd = securityOrderSource.indexOf('\n\n  it(', undeclaredViteStart);
    expect(undeclaredViteStart).toBeGreaterThan(-1);
    expect(undeclaredViteEnd).toBeGreaterThan(undeclaredViteStart);
    const undeclaredViteProof = securityOrderSource.slice(undeclaredViteStart, undeclaredViteEnd);
    expect(undeclaredViteProof.match(/UNDECLARED_VITE_CONFIG_PROCESS_TIMEOUT_MS,/gu)).toHaveLength(
      2,
    );
    expect(
      undeclaredViteProof.match(/expect\(\w+\.error, \w+\.stderr\)\.toBeUndefined\(\);/gu),
    ).toHaveLength(2);
    expect(
      undeclaredViteProof.match(/expect\(\w+\.signal, \w+\.stderr\)\.toBeNull\(\);/gu),
    ).toHaveLength(2);
    expect(redirectSource).toContain('}, 420_000);');
    expect(deferSource).toContain('    480_000,');
    expect(routeOutcomesSource).toContain('KOVO_BUILD_TEST_PROCESS_DEADLINE_MS');
    expect(routeOutcomesSource).toContain(
      'const ROUTE_OUTCOME_TEST_TIMEOUT_MS = kovoCliTestTimeoutMs(',
    );
    expect(productionArtifactSupportSource).toContain(
      'export const PRODUCTION_ARTIFACT_TEST_TIMEOUT_MS = process.env.CI ? 600_000 : 240_000;',
    );
    expect(starterTestSupportSource).toContain(
      'export const STARTER_SERVER_READY_TIMEOUT_MS = starterServerReadyTimeoutMs();',
    );
    expect(starterDeadlineSource).toContain(
      'const CI_GENERATED_STARTER_CLI_PROCESS_TIMEOUT_MS = 420_000;',
    );
    expect(starterDeadlineSource).toContain(
      'options.cliProcessCount * (generatedStarterCliProcessTimeoutMs({ ci }) + cleanupWindowMs)',
    );
    expect(starterTestSupportSource).toContain(
      'const deadline = Date.now() + STARTER_SERVER_READY_TIMEOUT_MS;',
    );
    expect(productionArtifactSupportSource).toContain(
      'const deadline = Date.now() + STARTER_SERVER_READY_TIMEOUT_MS;',
    );
    expect(runtimeSource).toContain(
      'vi.setConfig({ testTimeout: PRODUCTION_ARTIFACT_TEST_TIMEOUT_MS });',
    );
    expect(transactionSource).toContain(
      'vi.setConfig({ testTimeout: PRODUCTION_ARTIFACT_TEST_TIMEOUT_MS });',
    );
    expect(runtimeSource.match(/\}, 180_000\);/gu)).toHaveLength(1);
    expect(runtimeSource.match(/\}, 120_000\);/gu)).toHaveLength(1);
    expect(transactionSource).not.toContain('}, 180_000);');
    expect(scaffoldTypecheckSource.match(/generatedStarterTestTimeout\(/gu)).toHaveLength(3);
    expect(starterHarnessTemplateSource).toContain(
      'const devServerReadyTimeoutMs = process.env.CI ? 180_000 : 90_000;',
    );
    expect(starterHarnessTemplateSource).toContain("detached: process.platform !== 'win32',");
    expect(starterHarnessTemplateSource).toContain('process.kill(-server.pid, signal);');
    const securityAuthStart = securitySource.indexOf(
      "it('blocks local-helper credential-shaped secret laundering",
    );
    const securityAuthEnd = securitySource.indexOf('\n\n  it(', securityAuthStart);
    expect(securityAuthStart).toBeGreaterThan(-1);
    expect(securityAuthEnd).toBeGreaterThan(securityAuthStart);
    expect(securitySource.slice(securityAuthStart, securityAuthEnd)).toContain('}, 660_000);');
    const formErrorStart = securitySource.indexOf(
      'serves component-scoped FormError as a real no-JS 422 output',
    );
    const formErrorEnd = securitySource.indexOf(
      '\n\n  // @kovo-security-certifies M3',
      formErrorStart,
    );
    expect(formErrorStart).toBeGreaterThan(-1);
    expect(formErrorEnd).toBeGreaterThan(formErrorStart);
    expect(securitySource).toContain(
      'vi.setConfig({ testTimeout: PRODUCTION_ARTIFACT_TEST_TIMEOUT_MS });',
    );
    expect(securitySource.slice(formErrorStart, formErrorEnd)).not.toContain('240_000');
    const outputWireStart = adversarialSource.indexOf(
      "it.each([...dialectSpecificRuntimeCases])(\n    'M1:output-wire",
    );
    const outputWireEnd = adversarialSource.indexOf('\n  );\n});', outputWireStart);
    expect(outputWireStart).toBeGreaterThan(-1);
    expect(outputWireEnd).toBeGreaterThan(outputWireStart);
    expect(adversarialSource.slice(outputWireStart, outputWireEnd)).toContain(
      'multiBuildProofTimeout',
    );
    const rawHtmlStart = adversarialSource.indexOf(
      "'M1:raw-html tracks trusted output provenance gates from current %s production source, not stale cache'",
    );
    const rawHtmlEnd = adversarialSource.indexOf('\n\n  it.each(', rawHtmlStart);
    expect(rawHtmlStart).toBeGreaterThan(-1);
    expect(rawHtmlEnd).toBeGreaterThan(rawHtmlStart);
    const rawHtmlProof = adversarialSource.slice(rawHtmlStart, rawHtmlEnd);
    expect(adversarialSource).toContain(
      'const rawHtmlProvenanceProofTimeout = generatedStarterTestTimeout({ cliProcessCount: 2 });',
    );
    expect(rawHtmlProof).toContain('addTrustedOutputProvenanceBuildProof(root, { unsafe: false })');
    expect(rawHtmlProof).toContain(
      'rewriteTrustedOutputProvenanceBuildProof(root, { unsafe: true })',
    );
    expect(rawHtmlProof).toContain("runRawHtmlBuildSuccessPhase(root, 'safe-baseline')");
    expect(rawHtmlProof).toContain("expectRawHtmlBuildFailurePhase(root, 'unsafe-source-flip'");
    expect(rawHtmlProof).not.toContain('buildProductionArtifact(root)');
    expect(rawHtmlProof).not.toContain('expectBuildFailure(root');
    expect(rawHtmlProof).not.toContain('execFileSyncErrorOutput(error)');
    const rawHtmlFailureStart = adversarialSource.indexOf(
      'async function expectRawHtmlBuildFailurePhase(',
    );
    const rawHtmlFailureEnd = adversarialSource.indexOf('\n}\n', rawHtmlFailureStart);
    expect(rawHtmlFailureStart).toBeGreaterThan(-1);
    expect(rawHtmlFailureEnd).toBeGreaterThan(rawHtmlFailureStart);
    const rawHtmlFailureSource = adversarialSource.slice(rawHtmlFailureStart, rawHtmlFailureEnd);
    expect(rawHtmlFailureSource).toContain(
      'requireGeneratedStarterCommandNonzeroExitFailure(error)',
    );
    expect(rawHtmlFailureSource).toContain("output = [failure.stdout, failure.stderr].join('\\n')");
    expect(rawHtmlFailureSource).not.toContain('execFileSyncErrorOutput(error)');
    expect(adversarialSource).toContain(
      'await buildProductionArtifactWithInfrastructureDeadline(root);',
    );
    expect(adversarialSource).toContain(
      '`[m1-raw-html-provenance] phase=${phase} state=${state}\\n`',
    );
    expect(starterTestSupportSource).toContain(
      'const generatedStarterCommandFailureByError = new WeakMap<',
    );
    expect(starterTestSupportSource).toContain(
      "if (kind !== 'success') {\n    const failure = generatedStarterCommandFailureFromOutcome(outcome, kind);",
    );
  });

  it('assigns every newly measured starter proof its observed scheduling weight', () => {
    const measuredIds = new Set([
      'contacts-add-contact',
      'defer-artifacts',
      'durable-task-lifecycle',
      'durable-task-retries',
      'contacts-idempotency-collisions',
      'contacts-sqlite-add-contact',
      'm1-output-wire',
      'm1-raw-html-mutable-alias',
      'm1-raw-html-provenance',
      'm1-postgres-raw-sql',
      'm1-sqlite-raw-sql',
      'header-artifacts',
      'island-derive-artifacts',
      'island-derive-helper-preflight',
      'raw-sql-artifacts',
      'redirect-capability-artifacts',
      'runtime-dev-server',
      'security-auth-helper',
      'security-form-error',
      'security-runtime-wires-postgres',
      'security-runtime-wires-sqlite',
      'starter-sqlite-check',
      'starter-sqlite-durable-task-refusal',
      'security-trusted-output-provenance',
      'security-trusted-url-attributes',
      'starter-typecheck',
      'transaction-sqlite-served-artifact',
      'transaction-webhook-escape-default',
    ]);
    expect(
      Object.fromEntries(
        starterEntries()
          .filter((entry) => measuredIds.has(entry.id))
          .map((entry) => [entry.id, entry.seconds]),
      ),
    ).toEqual({
      'contacts-add-contact': 257,
      'contacts-idempotency-collisions': 252,
      'contacts-sqlite-add-contact': 269,
      'defer-artifacts': 576,
      'durable-task-lifecycle': 563,
      'durable-task-retries': 381,
      'header-artifacts': 301,
      'island-derive-artifacts': 301,
      'island-derive-helper-preflight': 67,
      'm1-output-wire': 748,
      'm1-raw-html-mutable-alias': 50,
      'm1-raw-html-provenance': 391,
      'm1-postgres-raw-sql': 151,
      'm1-sqlite-raw-sql': 151,
      'raw-sql-artifacts': 118,
      'redirect-capability-artifacts': 255,
      'runtime-dev-server': 682,
      'security-auth-helper': 426,
      'security-form-error': 280,
      'security-runtime-wires-postgres': 151,
      'security-runtime-wires-sqlite': 151,
      'starter-sqlite-check': 151,
      'starter-sqlite-durable-task-refusal': 151,
      'security-trusted-output-provenance': 391,
      'security-trusted-url-attributes': 11,
      'starter-typecheck': 454,
      'transaction-sqlite-served-artifact': 210,
      'transaction-webhook-escape-default': 90,
    });
  });

  it('keeps every C13-owned classifier file out of duplicate root Vitest shards', () => {
    const corpusFiles = [
      ...new Set(REQUIRED_CLASSIFIER_CORPORA.flatMap((corpus) => corpus.testFiles)),
    ];
    expect(corpusFiles.length).toBeGreaterThan(0);
    for (const file of corpusFiles) expect(includeVitest(file), file).toBe(false);
    expect(
      corpusFiles.includes(
        'packages/drizzle/src/trust-escapes-static-temporal-final-review.test.ts',
      ),
    ).toBe(true);
    expect(includeVitest('packages/drizzle/src/derive.test.ts')).toBe(true);
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

  it('keeps the per-PR starter route balanced in the existing ten CI shards', () => {
    const entries = starterEntriesForMode('unpacked', 'per-pr');
    const shards = balanceStarterShards(10, entries);
    const assigned = shards.flatMap((shard) => shard.entries.map((entry) => entry.id));

    expect(shards).toHaveLength(10);
    expect(new Set(assigned).size).toBe(entries.length);
    expect(assigned.toSorted(compareStrings)).toEqual(
      entries.map((entry) => entry.id).toSorted(compareStrings),
    );
    expect(shards.map((shard) => shard.seconds)).toEqual([
      1_239, 1_220, 1_244, 1_226, 1_230, 1_224, 1_249, 1_242, 1_235, 1_219,
    ]);
  });

  it('splits starter entries into packed and unpacked shard modes', () => {
    const packedEntries = starterEntriesForMode('packed');
    const unpackedEntries = starterEntriesForMode('unpacked');
    const allEntries = starterEntries();
    const packedIds = packedEntries.map((entry) => entry.id);
    const unpackedIds = unpackedEntries.map((entry) => entry.id);

    expect(packedIds.toSorted(compareStrings)).toEqual([
      'starter-packed-examples',
      'starter-packed-postgres',
      'starter-packed-runtime',
      'starter-packed-sqlite',
    ]);
    expect(packedEntries.find((entry) => entry.id === 'starter-packed-examples')?.seconds).toBe(
      1_200,
    );
    expect(packedEntries.find((entry) => entry.id === 'starter-packed-runtime')?.seconds).toBe(195);
    expect(unpackedEntries.every((entry) => !entry.needsPacked)).toBe(true);
    expect([...packedIds, ...unpackedIds].toSorted(compareStrings)).toEqual(
      allEntries.map((entry) => entry.id).toSorted(compareStrings),
    );
    expect(starterEntriesForMode('unpacked', 'per-pr')).toHaveLength(56);
    expect(starterEntries().find((entry) => entry.id === 'bugz-fixture-format')).toMatchObject({
      cadence: 'per-pr',
      testName: 'keeps BUGZ25/31 production fixtures formatter-clean before build preflight',
    });
    const nightly = starterEntriesForMode('unpacked', 'nightly');
    expect(nightly).toHaveLength(24);
    expect(nightly.filter((entry) => entry.file.endsWith('.security.test.ts'))).toHaveLength(13);
    expect(nightly.filter((entry) => entry.file.endsWith('.adversarial.test.ts'))).toHaveLength(11);
    expect(
      balanceStarterShards(10, unpackedEntries).flatMap((shard) => shard.entries),
    ).toHaveLength(unpackedEntries.length);
    expect(balanceStarterShards(4, packedEntries).map((shard) => shard.entries)).toEqual([
      [{ ...packedEntries.find((entry) => entry.id === 'starter-packed-examples') }],
      [{ ...packedEntries.find((entry) => entry.id === 'starter-packed-runtime') }],
      [{ ...packedEntries.find((entry) => entry.id === 'starter-packed-postgres') }],
      [{ ...packedEntries.find((entry) => entry.id === 'starter-packed-sqlite') }],
    ]);
    expect(() => starterEntriesForMode('other')).toThrow(/Unknown starter mode: other/);
  });

  it('keeps browser-backed starter entries isolated to the shard that needs Chromium', () => {
    const browserShards = balanceStarterShards(10, starterEntriesForMode('unpacked', 'per-pr'))
      .map((shard, index) => ({
        index: index + 1,
        entries: shard.entries.filter((entry) => entry.needsBrowser).map((entry) => entry.id),
      }))
      .filter((shard) => shard.entries.length > 0);

    expect(browserShards).toEqual([{ index: 7, entries: ['island-derive-artifacts'] }]);
  });

  it('marks only packed starter shards as needing the packed package artifact', async () => {
    const root = await fixtureRoot();
    const packedManifest = path.join(root, 'packed.json');
    const plainManifest = path.join(root, 'plain.json');
    await writeFile(
      packedManifest,
      `${JSON.stringify({ kind: 'starter', entries: [{ cadence: 'per-pr', file: 'packed.test.ts', id: 'packed', needsPacked: true, seconds: 1, timeoutMs: 300_000 }] })}\n`,
    );
    await writeFile(
      plainManifest,
      `${JSON.stringify({ kind: 'starter', entries: [{ cadence: 'per-pr', file: 'plain.test.ts', id: 'plain', seconds: 1, timeoutMs: 300_000 }] })}\n`,
    );

    await expect(starterShardNeedsPacked(packedManifest)).resolves.toBe(true);
    await expect(starterShardNeedsPacked(plainManifest)).resolves.toBe(false);
    expect(
      starterEntries()
        .filter((entry) => entry.needsPacked)
        .map((entry) => entry.id)
        .toSorted(compareStrings),
    ).toEqual([
      'starter-packed-examples',
      'starter-packed-postgres',
      'starter-packed-runtime',
      'starter-packed-sqlite',
    ]);
  });

  it('rejects a starter manifest whose outer supervisor cannot outlive its test watchdog', async () => {
    const root = await fixtureRoot();
    const rejectedManifest = path.join(root, 'short-headroom.json');
    const acceptedManifest = path.join(root, 'exact-headroom.json');
    await writeFile(
      rejectedManifest,
      `${JSON.stringify({
        entries: [
          {
            cadence: 'per-pr',
            file: 'proof.test.ts',
            id: 'proof',
            seconds: 151,
            testTimeoutMs: 300_000,
            timeoutMs: 359_999,
          },
        ],
        kind: 'starter',
      })}\n`,
    );
    await writeFile(
      acceptedManifest,
      `${JSON.stringify({
        entries: [
          {
            cadence: 'per-pr',
            file: 'proof.test.ts',
            id: 'proof',
            seconds: 151,
            testTimeoutMs: 300_000,
            timeoutMs: 360_000,
          },
        ],
        kind: 'starter',
      })}\n`,
    );

    await expect(starterShardNeedsPacked(rejectedManifest)).rejects.toThrow(
      'Starter shard manifest has an invalid bounded entry',
    );
    await expect(starterShardNeedsPacked(acceptedManifest)).resolves.toBe(false);
  });

  it('marks only the real-Postgres selector as needing hosted PostgreSQL', async () => {
    const root = await fixtureRoot();
    const realPgManifest = path.join(root, 'real-pg.json');
    const pgliteManifest = path.join(root, 'pglite.json');
    await writeFile(
      realPgManifest,
      `${JSON.stringify({ kind: 'starter', entries: [{ cadence: 'per-pr', file: 'pg.test.ts', id: 'real-pg', needsPostgres: true, seconds: 1, timeoutMs: 300_000 }] })}\n`,
    );
    await writeFile(
      pgliteManifest,
      `${JSON.stringify({ kind: 'starter', entries: [{ cadence: 'per-pr', file: 'pg.test.ts', id: 'pglite', seconds: 1, timeoutMs: 300_000 }] })}\n`,
    );
    await expect(starterShardNeedsPostgres(realPgManifest)).resolves.toBe(true);
    await expect(starterShardNeedsPostgres(pgliteManifest)).resolves.toBe(false);
  });

  it('runs packed starter entries only against the declared same-run package artifact', async () => {
    const manifest = await starterManifest([
      { file: 'packed.test.ts', id: 'packed', needsPacked: true },
    ]);
    const calls = [];
    const spawnSync = (command, args, options) => {
      calls.push({ args, command, options });
      if (args[2] === 'list') {
        return {
          status: 0,
          stderr: '',
          stdout: JSON.stringify([
            { file: '/repo/packed.test.ts', name: 'packed consumer > proof' },
          ]),
        };
      }
      return { status: 0 };
    };
    const packedPackagesDir = await packedStarterFixture();

    await expect(
      runStarterShard(manifest, {
        env: {
          KOVO_PACKED_PACKAGES_DIR: packedPackagesDir,
        },
        spawnSync,
      }),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.options.env).toMatchObject({
        KOVO_PACKED_PACKAGES_DIR: packedPackagesDir,
        KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES: 'packed-current',
      });
    }

    await expect(runStarterShard(manifest, { env: {}, spawnSync })).rejects.toThrow(
      'Packed-current starter execution requires KOVO_PACKED_PACKAGES_DIR.',
    );
    expect(calls).toHaveLength(2);
  });

  it('rejects stale or wrong-producer packed starter manifests before execution', async () => {
    const root = await packedStarterFixture({ generatedBy: 'some-other-producer' });
    await expect(validatePackedStarterDirectory(root)).rejects.toThrow(
      'Packed starter manifest has an untrusted producer.',
    );
    const staleRoot = await packedStarterFixture({
      producer: {
        kind: 'github-actions',
        repository: 'kovojs/kovo',
        runAttempt: '1',
        runId: 'old-run',
        sha: 'old-sha',
      },
    });
    await expect(
      validatePackedStarterDirectory(staleRoot, {
        GITHUB_ACTIONS: 'true',
        GITHUB_REPOSITORY: 'kovojs/kovo',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_RUN_ID: 'current-run',
        GITHUB_SHA: 'current-sha',
      }),
    ).rejects.toThrow('not produced by this GitHub Actions run and SHA');
    const tamperedRoot = await packedStarterFixture();
    await writeFile(path.join(tamperedRoot, 'package-0.tgz'), 'tampered');
    const localProducerEnvironment = {};
    await expect(
      validatePackedStarterDirectory(tamperedRoot, localProducerEnvironment),
    ).rejects.toThrow('digest mismatch for @kovojs/core');
  });

  it('runs each selector as its own bounded process without a file monolith', () => {
    const groups = groupStarterEntriesForExecution([
      { file: 'b.test.ts', id: 'b-two', testName: 'two?' },
      { file: 'a.test.ts', id: 'a-one', testName: 'one' },
      { file: 'b.test.ts', id: 'b-one', testName: 'one' },
    ]);

    expect(groups.map((group) => group.map((entry) => entry.id))).toEqual([
      ['a-one'],
      ['b-one'],
      ['b-two'],
    ]);
    expect(starterGroupVitestArgs(groups[0])).toEqual([
      'exec',
      'vitest',
      '--run',
      'a.test.ts',
      '-t',
      'one',
    ]);
    expect(starterGroupVitestArgs(groups[2])).toEqual([
      'exec',
      'vitest',
      '--run',
      'b.test.ts',
      '-t',
      'two\\?',
    ]);
  });

  it('keeps list JSON capture-only and forwards validated starter execution live', async () => {
    const manifest = await starterManifest([
      { file: 'proof.test.ts', id: 'proof', testName: 'current proof' },
    ]);
    const invocations = [];
    await runStarterShard(manifest, {
      runProcess: async (invocation) => {
        invocations.push(invocation);
        if (invocation.args[2] === 'list') {
          return {
            exitCode: 0,
            stderr: '',
            stdout: JSON.stringify([
              { file: '/repo/proof.test.ts', name: 'suite > current proof' },
            ]),
          };
        }
        return { exitCode: 0, stderr: '', stdout: '' };
      },
    });

    expect(invocations).toHaveLength(2);
    expect(invocations[0]).toMatchObject({
      captureOutput: true,
      forwardOutput: false,
      maxOutputBytes: 16 * 1024 * 1024,
    });
    expect(invocations[1]).toMatchObject({
      captureOutput: false,
      forwardOutput: true,
      maxOutputBytes: 32 * 1024 * 1024,
    });
  });

  it('passes capture and forwarding posture through the shared supervisor adapter', async () => {
    const boundedInvocations = [];
    const outcome = { exitCode: 0, stderr: '', stdout: '' };
    await expect(
      runAcceptanceTestProcess(
        {
          args: ['exec', 'vitest', '--run'],
          captureOutput: false,
          command: 'vp',
          cwd: '/repo',
          env: { CI: 'true' },
          forwardOutput: true,
          maxOutputBytes: 1234,
          supervisorTimeoutMs: 5678,
        },
        {
          runBoundedTestProcess: async (invocation) => {
            boundedInvocations.push(invocation);
            return outcome;
          },
        },
      ),
    ).resolves.toBe(outcome);
    expect(boundedInvocations).toEqual([
      {
        args: ['exec', 'vitest', '--run'],
        captureOutput: false,
        command: 'vp',
        cwd: '/repo',
        env: { CI: 'true' },
        forwardOutput: true,
        maxOutputBytes: 1234,
        supervisorTimeoutMs: 5678,
      },
    ]);

    const collected = await collectStarterGroupTestNames(
      [{ file: 'proof.test.ts', id: 'proof', testName: 'current proof' }],
      async (invocation) => {
        expect(invocation).toMatchObject({ captureOutput: true, forwardOutput: false });
        return {
          exitCode: 0,
          stderr: '',
          stdout: JSON.stringify([{ file: '/repo/proof.test.ts', name: 'current proof' }]),
        };
      },
    );
    expect(collected).toEqual(['current proof']);
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

  it('fails closed when a selector collects more tests than its reviewed topology count', () => {
    const group = [{ file: 'proof.test.ts', id: 'proof', testName: 'current proof' }];
    const collected = ['suite > current proof postgres', 'suite > current proof sqlite'];

    expect(() => validateStarterGroupTestFilters(group, collected)).toThrow(
      'Starter test filters matched an unexpected number of collected tests in proof.test.ts: proof=2/1',
    );
    expect(() =>
      validateStarterGroupTestFilters([{ ...group[0], expectedTestCount: 2 }], collected),
    ).not.toThrow();
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
        'create-kovo starter > keeps query writes KV449-closed when the dedicated KV433 finding is advisory',
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
    ).toHaveLength(entries.length);
  });

  it('treats configured selector text literally instead of loosening it as a regex', () => {
    expect(() =>
      validateStarterGroupTestFilters(
        [{ file: 'proof.test.ts', id: 'regex-entry', testName: 'proof (one|two)$' }],
        ['suite > proof two'],
      ),
    ).toThrow(/matched zero collected tests/);
    expect(() =>
      validateStarterGroupTestFilters(
        [{ file: 'proof.test.ts', id: 'literal-entry', testName: 'proof (one|two)$' }],
        ['suite > proof (one|two)$'],
      ),
    ).not.toThrow();
  });

  it('rejects uncovered identities, multiply owned identities, and stale selectors', () => {
    expect(() =>
      validateStarterFileTestCoverage(
        [{ file: 'proof.test.ts', id: 'first', testName: 'first proof' }],
        ['suite > first proof', 'suite > second proof'],
      ),
    ).toThrow(/unmatched: suite > second proof/);
    expect(() =>
      validateStarterFileTestCoverage(
        [
          { file: 'proof.test.ts', id: 'broad', testName: 'proof' },
          { file: 'proof.test.ts', id: 'exact', testName: 'first proof' },
        ],
        ['suite > first proof'],
      ),
    ).toThrow(/multiply owned: suite > first proof => broad, exact/);
    expect(() =>
      validateStarterFileTestCoverage(
        [
          { file: 'proof.test.ts', id: 'current', testName: 'current proof' },
          { file: 'proof.test.ts', id: 'stale', testName: 'renamed proof' },
        ],
        ['suite > current proof'],
      ),
    ).toThrow(/stale="renamed proof"/);
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

  it('fails closed on supervisor timeout and process-tree cleanup failure', async () => {
    const manifest = await starterManifest([
      { file: 'proof.test.ts', id: 'proof', testName: 'current proof', timeoutMs: 300_000 },
    ]);
    const results = [
      {
        exitCode: 0,
        stderr: '',
        stdout: JSON.stringify([{ file: '/repo/proof.test.ts', name: 'suite > current proof' }]),
      },
      { cleanupError: new Error('marker survived'), exitCode: 0 },
    ];
    await expect(
      runStarterShard(manifest, { runProcess: async () => results.shift() }),
    ).rejects.toThrow('process-tree cleanup failure: marker survived');

    const timeoutResults = [
      {
        exitCode: 0,
        stderr: '',
        stdout: JSON.stringify([{ file: '/repo/proof.test.ts', name: 'suite > current proof' }]),
      },
      { exitCode: null, timedOut: true },
    ];
    await expect(
      runStarterShard(manifest, { runProcess: async () => timeoutResults.shift() }),
    ).rejects.toThrow('bounded-process timeout');
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
  await writeFile(
    file,
    `${JSON.stringify({
      entries: entries.map((entry) => ({
        cadence: 'per-pr',
        seconds: 1,
        timeoutMs: 300_000,
        ...entry,
      })),
      kind: 'starter',
    })}\n`,
  );
  return file;
}

async function packedStarterFixture(options = {}) {
  const root = await fixtureRoot();
  const packageNames = [
    '@kovojs/core',
    '@kovojs/style',
    '@kovojs/browser',
    '@kovojs/server',
    '@kovojs/test',
    '@kovojs/drizzle',
    '@kovojs/headless-ui',
    '@kovojs/icons',
    '@kovojs/ui',
    '@kovojs/better-auth',
    '@kovojs/verify',
    '@kovojs/compiler',
    '@kovojs/cli',
    'create-kovo',
  ];
  const tarballs = {};
  const sha256 = {};
  for (const [index, packageName] of packageNames.entries()) {
    const tarball = `package-${index}.tgz`;
    tarballs[packageName] = tarball;
    await writeFile(path.join(root, tarball), 'fixture');
    sha256[packageName] = createHash('sha256').update('fixture').digest('hex');
  }
  await writeFile(
    path.join(root, 'packed-kovo-packages.json'),
    `${JSON.stringify({
      generatedBy: options.generatedBy ?? 'scripts/ci-shards.mjs pack-starter',
      producer: options.producer ?? { kind: 'local' },
      sha256,
      tarballs,
    })}\n`,
  );
  return root;
}
