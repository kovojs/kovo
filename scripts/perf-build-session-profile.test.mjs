import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BUILD_PROFILE_ARTIFACT_NAME,
  BUILD_PROFILE_MAX_PROCESS_TRACE_BYTES,
  BUILD_PROFILE_MODES,
  BUILD_PROFILE_PROCESS_ROLE_CLASSIFIER,
  BUILD_PROFILE_SAMPLING_INTERVAL_US,
  BUILD_PROFILE_WARMUPS,
  assertBuildProcessTraceSize,
  deriveBuildProcessCpuEvidence,
  mergeBuildProcessProfiles,
  parseBuildProfileArgs,
  produceBuildSessionProfiles,
  runProfiledBuildBenchmarkAdapter,
  sanitizeBuildProcessTrace,
} from './perf-build-session-profile.mjs';
import { KOVO_BUILD_SOURCE_PHASES } from './perf-build-benchmark.mjs';
import { performanceExecutionIdentity } from './lib/perf-execution.mjs';
import { canonicalJson, performanceHostFingerprint } from './lib/perf-host.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const temporaryRoots = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('N=216 build profile producer', () => {
  it('reduces a process trace to exact roles without retaining static-trust secrets', () => {
    const sentinel = 'do-not-retain-static-trust-sentinel';
    const root = '/workspace/kovo';
    const request = JSON.stringify({
      authenticationKey: sentinel,
      challenge: sentinel,
      paddingBeforeKind: 'x'.repeat(256),
      kind: 'app',
    });
    const trace = Buffer.from(
      [
        execLine(100, '/usr/bin/time', ['/usr/bin/time', 'command']),
        '100 clone(child_stack=NULL, flags=CLONE_VM|SIGCHLD) = 101',
        execLine(101, '/usr/bin/env', ['/usr/bin/env', 'node', 'kovo']),
        execLine(101, '/opt/node/bin/node', ['node', `${root}/packages/cli/src/bin.ts`, 'build']),
        '101 clone3({flags=CLONE_VM|CLONE_VFORK, exit_signal=SIGCHLD} <unfinished ...>',
        '101 <... clone3 resumed>, 88) = 102',
        execLine(102, '/opt/node/bin/node', [
          'node',
          '--experimental-transform-types',
          `${root}/packages/cli/src/bin.ts`,
          'build',
        ]),
        '102 clone(child_stack=NULL, flags=CLONE_VM|CLONE_THREAD|SIGCHLD) = 9001',
        '102 clone(child_stack=NULL, flags=CLONE_VM|SIGCHLD) = 103',
        execLine(103, '/opt/node/bin/node', [
          'node',
          `${root}/packages/cli/src/commands/build-static-trust-worker.ts`,
          request,
        ]),
      ].join('\n'),
    );

    const sanitized = sanitizeBuildProcessTrace(trace, { cwd: root });

    expect(sanitized.classifier).toBe(BUILD_PROFILE_PROCESS_ROLE_CLASSIFIER);
    expect(sanitized.processes.map(({ pid, role }) => ({ pid, role }))).toEqual([
      { pid: 100, role: 'collector-time' },
      { pid: 101, role: 'bootstrap' },
      { pid: 102, role: 'orchestrator' },
      { pid: 103, role: 'app-static-trust' },
    ]);
    expect(JSON.stringify(sanitized)).not.toContain(sentinel);
    expect(JSON.stringify(sanitized)).not.toContain('authenticationKey');
    expect(JSON.stringify(sanitized)).not.toContain('challenge');
  });

  it('never reflects a secret-bearing malformed exec line through diagnostics', () => {
    const sentinel = 'malformed-secret-sentinel';
    let error;
    try {
      sanitizeBuildProcessTrace(
        Buffer.from(
          execLine(1, '/opt/node/bin/node', [
            'node',
            '/workspace/kovo/packages/cli/src/commands/build-static-trust-worker.ts',
            JSON.stringify({ authenticationKey: sentinel, kind: 'wrong' }),
          ]),
        ),
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).not.toContain(sentinel);
    expect(error.message).not.toContain('authenticationKey');
  });

  it('admits the prior greater-than-16-MiB trace class through the exact private bound', () => {
    const priorCeiling = 16 * 1024 * 1024;

    expect(() => assertBuildProcessTraceSize(priorCeiling + 1)).not.toThrow();
    expect(() => assertBuildProcessTraceSize(BUILD_PROFILE_MAX_PROCESS_TRACE_BYTES)).not.toThrow();
    expect(() => assertBuildProcessTraceSize(BUILD_PROFILE_MAX_PROCESS_TRACE_BYTES + 1)).toThrow(
      `exceeds its ${String(BUILD_PROFILE_MAX_PROCESS_TRACE_BYTES)}-byte private capture limit (observed ${String(BUILD_PROFILE_MAX_PROCESS_TRACE_BYTES + 1)} bytes)`,
    );
  });

  it('retains native launcher execs and compresses fork-only shell ancestry', () => {
    const root = '/workspace/kovo';
    const sanitized = sanitizeBuildProcessTrace(
      Buffer.from(
        [
          execLine(200, '/usr/bin/time', ['/usr/bin/time', 'command']),
          '200 clone(child_stack=NULL, flags=CLONE_VM|SIGCHLD) = 201',
          execLine(201, '../../../node_modules/.bin/kovo', ['kovo', 'build']),
          '201 clone(child_stack=NULL, flags=CLONE_VM|SIGCHLD) = 202',
          '202 clone(child_stack=NULL, flags=CLONE_VM|SIGCHLD) = 203',
          execLine(203, '/usr/bin/uname', ['uname']),
          execLine(201, '/opt/node/bin/node', ['node', `${root}/packages/cli/src/bin.ts`, 'build']),
        ].join('\n'),
      ),
      { cwd: `${root}/benchmarks/kovo/.corpora/kovo/n216` },
    );

    expect(sanitized.forkOnlyProcesses).toBe(1);
    expect(sanitized.processes).toEqual([
      expect.objectContaining({ parentPid: null, pid: 200, role: 'collector-time' }),
      expect.objectContaining({ parentPid: 200, pid: 201, role: 'bootstrap' }),
      expect.objectContaining({
        executable: '/usr/bin/uname',
        parentPid: 201,
        pid: 203,
        role: 'native-one-shot',
        roleEvidence: 'native-unprofiled-exec/v1',
      }),
    ]);
  });

  it('derives only a conservative native residual outside decimal and profiler uncertainty', () => {
    const profileInputs = [profileFacts(4, 1), profileFacts(6, 2)];
    const processCensus = { processes: [] };
    const evidence = deriveBuildProcessCpuEvidence({
      processCensus,
      processCpuBytes: Buffer.from(
        `kovo-build-process-cpu/v1 interval=${BUILD_PROFILE_SAMPLING_INTERVAL_US} user=0.20 system=0.10 exit=0\n`,
      ),
      profileInputs,
    });

    expect(evidence).toMatchObject({
      cause: { equivalentSamples: 14, sessionEligibility: 'one-shot-or-ineligible' },
      profiledActiveMicros: 100_000,
      residualMicros: 200_000,
      totalMicros: 300_000,
      uncertainty: {
        systemResolutionMicros: 10_000,
        totalMicros: 60_000,
        userResolutionMicros: 10_000,
      },
    });
  });

  it.each(BUILD_PROFILE_MODES)(
    'keeps %s warmups and the sole strace profile in one adapter invocation',
    (mode) => {
      const originalCommand = ['/workspace/node_modules/.bin/kovo', 'build', './src/app.tsx'];
      const commandOptions = {
        cwd: '/workspace/corpus',
        env: { KOVO_DEVEX_BUILD_PHASE_CENSUS_SOURCE: 'src/app.tsx' },
        timeoutMs: 123_456,
      };
      const observed = [];
      const adapterOptions = [];
      let adapterCalls = 0;
      const report = runProfiledBuildBenchmarkAdapter(
        {
          corpusManifest: '/workspace/corpus/manifest.json',
          existingNodeOptions: '--experimental-transform-types',
          mode,
          processCpuPath: '/tmp/process-cpu.txt',
          profilerDir: '/tmp/process-profiles',
          tracePath: '/tmp/process.trace',
        },
        {
          measureProcessTreeCommand(command, options) {
            observed.push({ command, options });
            return { exitCode: 0 };
          },
          runBuildBenchmark(options, dependencies) {
            adapterCalls += 1;
            adapterOptions.push(options);
            for (let index = 0; index < BUILD_PROFILE_WARMUPS + 1; index += 1) {
              dependencies.measureProcessTreeCommand(originalCommand, commandOptions);
            }
            return { mode, sentinel: 'adapter-report' };
          },
        },
      );

      expect(adapterCalls).toBe(1);
      expect(adapterOptions).toEqual([
        expect.objectContaining({
          corpus: '/workspace/corpus/manifest.json',
          framework: 'kovo',
          iterations: 1,
          mode,
          warmups: BUILD_PROFILE_WARMUPS,
        }),
      ]);
      expect(report).toEqual({ mode, sentinel: 'adapter-report' });
      expect(observed).toHaveLength(BUILD_PROFILE_WARMUPS + 1);
      expect(observed.slice(0, BUILD_PROFILE_WARMUPS)).toEqual(
        Array.from({ length: BUILD_PROFILE_WARMUPS }, () => ({
          command: originalCommand,
          options: commandOptions,
        })),
      );
      const profiled = observed.at(-1);
      expect(profiled.command).toEqual([
        '/usr/bin/strace',
        '-f',
        '-qq',
        '-s',
        '16384',
        '-e',
        'trace=clone,clone3,fork,vfork,execve',
        '-o',
        '/tmp/process.trace',
        '/usr/bin/time',
        '-f',
        `kovo-build-process-cpu/v1 interval=${String(BUILD_PROFILE_SAMPLING_INTERVAL_US)} user=%U system=%S exit=%x`,
        '-o',
        '/tmp/process-cpu.txt',
        '/usr/bin/env',
        `NODE_OPTIONS=--experimental-transform-types --cpu-prof --cpu-prof-dir="/tmp/process-profiles" --cpu-prof-interval=${String(BUILD_PROFILE_SAMPLING_INTERVAL_US)}`,
        ...originalCommand,
      ]);
      expect(profiled.options).toEqual({
        ...commandOptions,
        env: {
          ...commandOptions.env,
          LC_ALL: 'C',
          NODE_OPTIONS: '--experimental-transform-types',
        },
      });
      expect(
        observed.filter(({ command }) =>
          command.some((argument) => argument.includes('--cpu-prof')),
        ),
      ).toHaveLength(1);
    },
  );

  it('rejects an adapter that attempts a second profiled command', () => {
    expect(() =>
      runProfiledBuildBenchmarkAdapter(
        {
          corpusManifest: '/workspace/corpus/manifest.json',
          existingNodeOptions: '',
          mode: 'unchanged',
          processCpuPath: '/tmp/process-cpu.txt',
          profilerDir: '/tmp/process-profiles',
          tracePath: '/tmp/process.trace',
        },
        {
          measureProcessTreeCommand: () => ({ exitCode: 0 }),
          runBuildBenchmark(_options, dependencies) {
            for (let index = 0; index < BUILD_PROFILE_WARMUPS + 2; index += 1) {
              dependencies.measureProcessTreeCommand(['kovo', 'build'], { env: {} });
            }
          },
        },
      ),
    ).toThrow('attempted more than one measured command');
  });

  it('rejects negative, uncertain, wrong-interval, and unsupported native residuals', () => {
    const profileInputs = [profileFacts(10, 0)];
    const derive = (line, processes = []) =>
      deriveBuildProcessCpuEvidence({
        processCensus: { processes },
        processCpuBytes: Buffer.from(`${line}\n`),
        profileInputs,
      });
    expect(() =>
      derive(
        `kovo-build-process-cpu/v1 interval=${BUILD_PROFILE_SAMPLING_INTERVAL_US} user=0.05 system=0.00 exit=0`,
      ),
    ).toThrow('V8 sample CPU exceeds recursive CPU');
    expect(() =>
      derive(
        `kovo-build-process-cpu/v1 interval=${BUILD_PROFILE_SAMPLING_INTERVAL_US} user=0.12 system=0.01 exit=0`,
      ),
    ).toThrow('within measurement uncertainty');
    expect(() =>
      derive('kovo-build-process-cpu/v1 interval=500 user=0.20 system=0.10 exit=0'),
    ).toThrow('malformed');
    expect(() =>
      derive(
        `kovo-build-process-cpu/v1 interval=${BUILD_PROFILE_SAMPLING_INTERVAL_US} user=0.10 system=0.00 exit=0`,
        [{ role: 'native-one-shot' }],
      ),
    ).toThrow('native descendant');
  });

  it('makes the merged profile a derived convenience view while retaining process identities', () => {
    const inputs = [
      processProfile('analyze', 'produceKovoBuildOneShotAnalysis', 11),
      processProfile('client', 'produceKovoBuildOneShotClientPhase', 12),
      processProfile('server', 'produceKovoBuildOneShotServerPhase', 13),
      processProfile('final', 'finishKovoBuildOneShot', 14),
    ];

    const merged = mergeBuildProcessProfiles(inputs);
    const parsed = JSON.parse(merged.bytes.toString('utf8'));

    expect(merged.census).toMatchObject({
      complete: true,
      includedProfiles: 4,
      inputProfiles: 4,
      merger: 'lossless-node-id-remap-with-synthetic-root/v1',
    });
    expect(parsed.kovoProcessTree.includedProfiles.map(({ pid, role }) => ({ pid, role }))).toEqual(
      [...inputs]
        .sort((left, right) => left.member.localeCompare(right.member))
        .map(({ pid, role }) => ({ pid, role })),
    );
    expect(parsed.samples).toHaveLength(8);
    expect(parsed.timeDeltas).toHaveLength(8);
  });

  it('produces two atomic mode archives with exact authenticated identities and byte readback', async () => {
    const fixture = await producerFixture();

    const result = await produceBuildSessionProfiles(fixture.options, fixture.dependencies);

    expect(result.artifactName).toBe(BUILD_PROFILE_ARTIFACT_NAME);
    expect(fixture.calls).toEqual({
      profile: [...BUILD_PROFILE_MODES],
      source: 4,
    });
    const members = (await readdir(fixture.outDir)).sort((left, right) =>
      left.localeCompare(right),
    );
    const declaredMembers = Object.values(result.reports)
      .flatMap(({ artifactMembers }) => artifactMembers)
      .sort((left, right) => left.localeCompare(right));
    expect(members).toEqual(declaredMembers);
    expect(result.files.sort((left, right) => left.localeCompare(right))).toEqual(members);
    expect(members).toHaveLength(24);

    for (const mode of BUILD_PROFILE_MODES) {
      const reportBytes = await readFile(path.join(fixture.outDir, `profile-${mode}.json`));
      const report = JSON.parse(reportBytes.toString('utf8'));
      expect(report).toEqual(result.reports[mode]);
      expect(report.source).toEqual(fixture.source);
      expect(report.sourceAfter).toEqual(fixture.source);
      expect(report.execution).toEqual(fixture.execution);
      expect(report.host).toEqual(fixture.host);
      expect(report.integrity).toMatchObject({ complete: true, sourceStable: true });
      expect(report.sourcePhasePosture).toEqual({
        complete: true,
        phases: KOVO_BUILD_SOURCE_PHASES.map((name) => ({ name, status: 'executed' })),
        schema: 'kovo-build-source-phase-posture/v1',
      });
      expect(JSON.stringify(report.sourcePhasePosture)).not.toContain('duration');
      expect(report.profileArtifacts).toHaveLength(9);
      expect(
        report.capture.processCensus.processes.filter(({ role }) => role !== 'collector-time'),
      ).toHaveLength(9);

      await expectArtifactIdentity(
        fixture.outDir,
        report.profileArtifact.fileName,
        report.profileArtifact,
      );
      await expectArtifactIdentity(
        fixture.outDir,
        report.processCpuArtifact.fileName,
        report.processCpuArtifact,
      );
      for (const identity of report.profileArtifacts) {
        await expectArtifactIdentity(fixture.outDir, identity.member, identity);
      }
      const { digest: reportDigest, ...facts } = report;
      expect(reportDigest).toBe(digest(Buffer.from(canonicalJson(facts))));
    }

    expect((await readdir(fixture.root)).filter((member) => member.includes('-stage-'))).toEqual(
      [],
    );
  });

  it.each([
    ['source', 'source changed across the two-mode capture'],
    ['provider', 'execution provider is local'],
    ['census', 'process census differs from its raw profile custody'],
    ['warmth', 'adapter integrity census is incomplete'],
  ])('refuses %s drift without publishing a partial artifact', async (drift, message) => {
    const fixture = await producerFixture({ drift });

    await expect(
      produceBuildSessionProfiles(fixture.options, fixture.dependencies),
    ).rejects.toThrow(message);
    await expect(readdir(fixture.outDir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(fixture.root)).filter((member) => member.includes('-stage-'))).toEqual(
      [],
    );
  });

  it('parses only the exact complete CLI option contract', () => {
    const parsed = parseBuildProfileArgs([
      '--corpus',
      './fixture/manifest.json',
      '--out-dir',
      './artifacts/profiles',
      '--require-provider',
      'github-actions',
    ]);
    expect(parsed).toEqual({
      corpusManifest: path.resolve('./fixture/manifest.json'),
      outDir: path.resolve('./artifacts/profiles'),
      requireProvider: 'github-actions',
    });
    expect(() => parseBuildProfileArgs(['--out-dir'])).toThrow('unknown or incomplete');
    expect(() => parseBuildProfileArgs(['--out-dir', './one', '--out-dir', './two'])).toThrow(
      'duplicate',
    );
    expect(() => parseBuildProfileArgs(['--output', './one'])).toThrow('unknown or incomplete');
  });
});

async function producerFixture({ drift = null } = {}) {
  const root = await mkdtemp(path.join(repoRoot, '.perf-build-profile-test-'));
  temporaryRoots.push(root);
  const outDir = path.join(root, 'artifact');
  const corpusManifest = path.join(root, 'manifest.json');
  const sourceCommit = '1'.repeat(40);
  const workflowSha = '2'.repeat(40);
  const eventSha = '3'.repeat(40);
  const source = {
    commit: sourceCommit,
    dirty: false,
    dirtyPaths: [],
    locks: Object.fromEntries(
      [
        'pnpm-lock.yaml',
        'benchmarks/nextjs/pnpm-lock.yaml',
        'benchmarks/harness/pnpm-lock.yaml',
      ].map((member) => [member, digest(Buffer.from(member))]),
    ),
  };
  vi.stubEnv('KOVO_PERF_SOURCE_SHA', sourceCommit);
  const manifest = {
    build: {
      command: { argv: ['node', './build.mjs'], cwd: '.', env: {} },
      edit: { path: 'src/routes/route-001.tsx', replacement: 'edited', search: 'original' },
    },
    framework: 'kovo',
    modules: 216,
    schema: 'kovo-dev-corpus/v1',
    shapeDigest: createHash('sha256').update('shape').digest('hex'),
    sourceDigest: digest(Buffer.from('source')),
  };
  await writeFile(corpusManifest, `${JSON.stringify(manifest)}\n`);

  const execution =
    drift === 'provider'
      ? performanceExecutionIdentity({
          env: {},
          nonce: '4'.repeat(32),
          pid: 42,
          startedAt: '2026-08-14T00:00:00.000Z',
        })
      : performanceExecutionIdentity({
          env: {
            GITHUB_JOB: 'build-profile',
            GITHUB_REPOSITORY: 'kovojs/kovo',
            GITHUB_RUN_ATTEMPT: '1',
            GITHUB_RUN_ID: '1234',
            GITHUB_SERVER_URL: 'https://github.com',
            GITHUB_SHA: eventSha,
            GITHUB_WORKFLOW_REF: 'kovojs/kovo/.github/workflows/perf-realistic.yml@refs/heads/main',
            GITHUB_WORKFLOW_SHA: workflowSha,
            KOVO_PERF_SOURCE_SHA: sourceCommit,
          },
          startedAt: '2026-08-14T00:00:00.000Z',
        });
  const host = performanceHostFingerprint({
    runnerImage: 'ubuntu24',
    totalMemoryBytes: 16 * 1024 ** 3,
  });
  const workloadFacts = {
    cells: ['build'],
    lanes: ['corpus-n216'],
    policies: {
      buildModes: ['clean', 'unchanged', 'edit'],
      buildSamples: 10,
      corpusSize: 216,
      warmups: 3,
    },
  };
  const workloadIdentity = {
    complete: true,
    digest: digest(Buffer.from(canonicalJson(workloadFacts))),
    identity: workloadFacts,
    schema: 'kovo-performance-workload-identity/v1',
  };
  const calls = { profile: [], source: 0 };
  const dependencies = {
    collectSource() {
      calls.source += 1;
      return {
        ...structuredClone(source),
        ...(drift === 'source' && calls.source === 4 ? { commit: '5'.repeat(40) } : {}),
      };
    },
    executionIdentity: () => execution,
    hostFingerprint: () => host,
    runProfiledBuild({ mode }) {
      calls.profile.push(mode);
      const capture = profiledCapture({
        manifest,
        mode,
        source,
        warmups: drift === 'warmth' && mode === 'unchanged' ? 0 : BUILD_PROFILE_WARMUPS,
      });
      if (drift === 'census' && mode === 'unchanged') {
        capture.processCensus.processes.find(({ role }) => role === 'final').pid += 50_000;
      }
      return capture;
    },
    workloadIdentity: () => workloadIdentity,
  };
  return {
    calls,
    dependencies,
    execution,
    host,
    options: { corpusManifest, outDir, requireProvider: 'github-actions' },
    outDir,
    root,
    source,
  };
}

function profiledCapture({ manifest, mode, source, warmups }) {
  const roles = [
    'bootstrap',
    'orchestrator',
    'analyze',
    'typescript',
    'config-static-trust',
    'app-static-trust',
    'client',
    'server',
    'final',
  ];
  const profileInputs = roles.map((role, index) => roleProfile(role, 1_001 + index));
  const tools = {
    env: executableIdentity('env'),
    node: executableIdentity('node'),
    strace: executableIdentity('strace'),
    time: executableIdentity('time'),
  };
  const processCensus = {
    classifier: BUILD_PROFILE_PROCESS_ROLE_CLASSIFIER,
    complete: true,
    forkOnlyProcesses: 0,
    processes: [
      {
        entry: null,
        executable: structuredClone(tools.time),
        parentPid: null,
        pid: 900,
        role: 'collector-time',
        roleEvidence: 'gnu-time-exec/v1',
      },
      ...profileInputs.map(({ pid, role }) => ({
        entry: executableIdentity(`entry-${role}`),
        executable: structuredClone(tools.node),
        parentPid: 900,
        pid,
        role,
        roleEvidence: `${role}-fixture-exec/v1`,
      })),
    ],
    schema: 'kovo-build-process-census/v1',
    tools,
  };
  const processCpuBytes = Buffer.from(
    `kovo-build-process-cpu/v1 interval=${BUILD_PROFILE_SAMPLING_INTERVAL_US} user=0.09 system=0.00 exit=0\n`,
  );
  return {
    processCensus,
    processCpu: deriveBuildProcessCpuEvidence({
      processCensus,
      processCpuBytes,
      profileInputs,
    }),
    processCpuBytes,
    profileInputs,
    report: buildReport({ iterations: 1, manifest, mode, source, warmups }),
  };
}

function buildReport({ iterations, manifest, mode, source, warmups }) {
  return {
    corpus: { modules: 216 },
    framework: 'kovo',
    integrity: {
      command: { argv: [...manifest.build.command.argv], cwd: manifest.build.command.cwd },
      complete: true,
      corpus: { stable: true },
      errors: [],
      iterations,
      misses: 0,
      source: { stable: true },
      warmups,
    },
    mode,
    samples: Array.from({ length: iterations }, () => ({
      corpus: { stable: true },
      exitCode: 0,
      outputCensus: { complete: true },
      phaseAttribution: { complete: true },
      phaseCensus: {
        source: {
          complete: true,
          phases: KOVO_BUILD_SOURCE_PHASES.map((name) => ({
            durationMs: 1,
            name,
            status: 'executed',
          })),
          schema: 'kovo-build-source-phase-census/v1',
        },
      },
    })),
    schema: 'kovo-build-benchmark/v1',
    source: structuredClone(source),
    sourceAfter: structuredClone(source),
  };
}

function roleProfile(role, pid) {
  const marker = {
    analyze: [
      'produceKovoBuildOneShotAnalysis',
      '/workspace/packages/cli/src/commands/build-export.ts',
    ],
    'app-static-trust': [
      'runPreEvaluationStaticTrustPreflight',
      '/workspace/packages/cli/src/commands/build-export.ts',
    ],
    bootstrap: ['bootstrap', '/workspace/packages/cli/src/bin.ts'],
    client: [
      'produceKovoBuildOneShotClientPhase',
      '/workspace/packages/cli/src/commands/build-export.ts',
    ],
    'config-static-trust': [
      'runPreEvaluationBuildConfigTrustPreflight',
      '/workspace/packages/cli/src/commands/build-export.ts',
    ],
    final: ['finishKovoBuildOneShot', '/workspace/packages/cli/src/commands/build-export.ts'],
    orchestrator: [
      'runKovoIsolatedOneShotInvocationAsync',
      '/workspace/packages/cli/src/commands/build-one-shot-orchestrator.ts',
    ],
    server: [
      'produceKovoBuildOneShotServerPhase',
      '/workspace/packages/cli/src/commands/build-export.ts',
    ],
    typescript: ['executeCommandLine', '/workspace/node_modules/typescript/lib/_tsc.js'],
  }[role];
  const bytes = Buffer.from(
    JSON.stringify({
      endTime: 10_000,
      nodes: [
        {
          callFrame: {
            columnNumber: 0,
            functionName: '(root)',
            lineNumber: 0,
            scriptId: '0',
            url: '',
          },
          children: [2],
          id: 1,
        },
        {
          callFrame: {
            columnNumber: 1,
            functionName: marker[0],
            lineNumber: 1,
            scriptId: '1',
            url: marker[1],
          },
          id: 2,
        },
      ],
      samples: [2],
      startTime: 0,
      timeDeltas: [10_000],
    }),
  );
  return {
    bytes,
    facts: {
      activeSamples: 1,
      idleSamples: 0,
      negativeTimeDeltas: 0,
      nodes: 2,
      samples: 1,
      waitSamples: 0,
    },
    pid,
    role,
  };
}

function executableIdentity(label) {
  return {
    bytes: 1,
    path: `/fixture/${label}`,
    realPath: `/fixture/${label}`,
    sha256: digest(Buffer.from(label)),
  };
}

async function expectArtifactIdentity(root, member, identity) {
  const bytes = await readFile(path.join(root, member));
  expect(bytes.length).toBe(identity.bytes);
  expect(digest(bytes)).toBe(identity.sha256);
}

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function execLine(pid, executable, argv) {
  return `${String(pid)} execve(${JSON.stringify(executable)}, [${argv
    .map((value) => JSON.stringify(value))
    .join(', ')}], 0xfeed /* 1 var */) = 0`;
}

function profileFacts(activeSamples, idleSamples) {
  return { facts: { activeSamples, idleSamples, waitSamples: 0 } };
}

function processProfile(role, functionName, pid) {
  const profile = {
    endTime: 10,
    nodes: [
      {
        callFrame: {
          columnNumber: 0,
          functionName: '(root)',
          lineNumber: 0,
          scriptId: '0',
          url: '',
        },
        children: [2],
        id: 1,
      },
      {
        callFrame: {
          columnNumber: 1,
          functionName,
          lineNumber: 1,
          scriptId: '1',
          url: 'file:///workspace/packages/cli/src/commands/build-export.ts',
        },
        id: 2,
      },
    ],
    samples: [2, 2],
    startTime: 0,
    timeDeltas: [5, 5],
  };
  const bytes = Buffer.from(JSON.stringify(profile));
  return {
    bytes,
    facts: {
      activeSamples: 2,
      idleSamples: 0,
      negativeTimeDeltas: 0,
      nodes: 2,
      samples: 2,
      waitSamples: 0,
    },
    member: `raw-unchanged-${role}-pid-${String(pid)}.cpuprofile`,
    pid,
    role,
  };
}
