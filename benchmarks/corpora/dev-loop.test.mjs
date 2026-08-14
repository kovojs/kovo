import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  collectPageTelemetry,
  collectEntrantVersions,
  dependencyRootForDevCommand,
  DEV_LOOP_REPORT_SCHEMA,
  DEV_SESSION_STOP_SCHEMA,
  diagnosticProfileFindings,
  establishState,
  exactSampleCountFindings,
  loadCorpusManifest,
  normalizeDevLoopOptions,
  parseDevLoopArgs,
  profileEditToPaint,
  probeOriginPortAvailability,
  profiledDevInvocation,
  runDevLoopBenchmark,
  sourceStabilityFindings,
  stopDevProcessTree,
  summarizeNumbers,
  verifyCorpusSources,
} from './dev-loop.mjs';
import { generateCorpora } from './generate.mjs';
import { DEV_EDIT_PROFILE_CLASSIFIER } from '../../scripts/perf-dev-edit-profile.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('single-entrant developer-loop adapter', () => {
  it('authenticates every generated source byte and rejects changed or additional sources', async () => {
    const root = await temporaryRoot();
    const [manifestPath] = await generateCorpora({ outDir: root, sizes: [24] });
    const evidence = await loadCorpusManifest(manifestPath);

    await expect(verifyCorpusSources(evidence)).resolves.toBeUndefined();
    expect(evidence.manifest.sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(evidence.manifestDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const target = path.join(evidence.appRoot, 'src/data.tsx');
    const original = await readFile(target, 'utf8');
    await writeFile(target, `${original}// changed\n`);
    await expect(verifyCorpusSources(evidence)).rejects.toThrow(
      'Corpus source integrity mismatch for src/data.ts',
    );
    await writeFile(target, original);

    await writeFile(path.join(evidence.appRoot, 'src/unmanifested.ts'), 'export {};\n');
    await expect(verifyCorpusSources(evidence)).rejects.toThrow(
      'Corpus contains unmanifested source files: src/unmanifested.ts',
    );
  });

  it('rejects a re-digested manifest that weakens the sibling refresh-surface posture', async () => {
    const root = await temporaryRoot();
    const [manifestPath] = await generateCorpora({ outDir: root, sizes: [24] });
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.workload.editStatePosture = 'document-refresh-may-replace-local-state/v1';
    manifest.shapeDigest = createHash('sha256')
      .update(JSON.stringify(manifest.workload))
      .digest('hex');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(loadCorpusManifest(manifestPath)).rejects.toThrow(
      'Corpus workload does not authenticate the edit/state posture',
    );
  });

  it('rejects a dev edit root that drifts from its authenticated refresh surface', async () => {
    const root = await temporaryRoot();
    const [manifestPath] = await generateCorpora({ outDir: root, sizes: [24] });
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.dev.edits.entry.evidence.selector = 'main';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(loadCorpusManifest(manifestPath)).rejects.toThrow(
      'Corpus dev edit entry drifts from its refresh surface',
    );
  });

  it('rejects a report path inside the measured corpus before launching a browser', async () => {
    const root = await temporaryRoot();
    const [manifestPath] = await generateCorpora({ outDir: root, sizes: [24] });
    await expect(
      runDevLoopBenchmark({
        iterations: 1,
        manifestPath,
        outPath: path.join(path.dirname(manifestPath), 'result.json'),
        port: 49_120,
        readyIterations: 1,
        warmups: 0,
      }),
    ).rejects.toThrow('--out must be outside the generated corpus root');
  });

  it('profiles the exact CLI process without changing the ordinary command lane', async () => {
    const root = await temporaryRoot();
    const packageRoot = path.join(root, 'node_modules/@kovojs/cli');
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      path.join(packageRoot, 'package.json'),
      `${JSON.stringify({ bin: { kovo: './src/bin.ts' } })}\n`,
    );
    const command = {
      argv: ['./node_modules/.bin/kovo', 'dev', './src/app.tsx'],
      cwd: root,
    };
    expect(profiledDevInvocation(command, null)).toEqual({
      argv: ['dev', './src/app.tsx'],
      executable: './node_modules/.bin/kovo',
    });
    expect(profiledDevInvocation(command, 49_121)).toEqual({
      argv: [
        '--inspect=127.0.0.1:49121',
        '--disable-warning=ExperimentalWarning',
        '--experimental-transform-types',
        path.join(packageRoot, 'src/bin.ts'),
        'dev',
        './src/app.tsx',
      ],
      executable: process.execPath,
    });
    expect(() =>
      profiledDevInvocation({ ...command, argv: ['./outside/kovo', 'dev'] }, 49_121),
    ).toThrow('must come from a node_modules/.bin directory');
  });

  it('preserves diagnostic options when parsed CLI options cross the benchmark boundary', () => {
    const parsed = parseDevLoopArgs([
      '--manifest',
      '/tmp/manifest.json',
      '--iterations',
      '1',
      '--ready-iterations',
      '1',
      '--warmups',
      '0',
      '--port',
      '49120',
      '--profile-dir',
      '/tmp/kovo-dev-profile',
      '--inspector-port',
      '49121',
      '--out',
      '/tmp/report.json',
    ]);

    expect(normalizeDevLoopOptions(parsed)).toEqual(parsed);
    expect(() =>
      normalizeDevLoopOptions({ ...parsed, profileDir: '/tmp/ambiguous-profile' }),
    ).toThrow('must use one representation');
  });

  it.each([
    ['kovo', 'kovo', 'kovo'],
    ['nextjs', 'nextjs', 'next'],
  ])(
    'binds the default %s corpus to its entrant-local dependency root',
    async (framework, entrantDirectory, executable) => {
      const corpusRoot = path.resolve(
        fileURLToPath(new URL(`../${entrantDirectory}/.corpora/${framework}/n24`, import.meta.url)),
      );
      const dependencyRoot = path.resolve(
        fileURLToPath(new URL(`../${entrantDirectory}/node_modules`, import.meta.url)),
      );
      await expect(
        dependencyRootForDevCommand(
          corpusRoot,
          framework,
          {
            argv: [`../../../node_modules/.bin/${executable}`],
            cwd: corpusRoot,
          },
          { realpath: async (value) => value },
        ),
      ).resolves.toBe(dependencyRoot);
    },
  );

  it('reads versions from the authenticated entrant dependency root', async () => {
    const corpusRoot = path.resolve(
      fileURLToPath(new URL('../kovo/.corpora/kovo/n24', import.meta.url)),
    );
    await expect(
      collectEntrantVersions(corpusRoot, 'kovo', {
        argv: ['../../../node_modules/.bin/kovo'],
        cwd: corpusRoot,
      }),
    ).resolves.toEqual({ '@kovojs/cli': expect.any(String), 'vite-plus': expect.any(String) });
  });

  it('rejects a dev executable outside the app-local or entrant-local dependency root', async () => {
    const root = await temporaryRoot();
    const appRoot = path.join(root, 'corpus');
    await mkdir(appRoot, { recursive: true });
    await expect(
      dependencyRootForDevCommand(appRoot, 'kovo', {
        argv: ['../../untrusted/node_modules/.bin/kovo'],
        cwd: appRoot,
      }),
    ).rejects.toThrow('dependency root is not app-local or entrant-local');
  });

  it('rejects an app-local dependency link that does not resolve to the entrant install', async () => {
    const root = await temporaryRoot();
    const appRoot = path.join(root, 'corpus');
    await mkdir(appRoot, { recursive: true });
    await expect(
      dependencyRootForDevCommand(
        appRoot,
        'kovo',
        { argv: ['node_modules/.bin/kovo'], cwd: appRoot },
        {
          realpath: async (value) =>
            value === path.join(appRoot, 'node_modules') ? '/tmp/untrusted-node-modules' : value,
        },
      ),
    ).rejects.toThrow('does not resolve to the entrant install');
  });

  it('awaits the single captured setup click becoming browser-visible', async () => {
    let value = 'Count 0';
    let clicks = 0;
    const locator = {
      click: async () => {
        clicks += 1;
        setTimeout(() => {
          value = 'Count 1';
        }, 20);
      },
      first: () => locator,
      textContent: async () => value,
    };
    const page = { locator: () => locator };

    await expect(
      establishState(
        page,
        {
          property: 'textContent',
          selector: '[data-benchmark-state]',
          setup: { action: 'click' },
          value: 'Count 1',
        },
        200,
      ),
    ).resolves.toBeUndefined();
    expect(clicks).toBe(1);
    expect(value).toBe('Count 1');
  });

  it('requires an independent exact fresh-ready sample count', () => {
    expect(
      parseDevLoopArgs([
        '--manifest',
        '/tmp/manifest.json',
        '--iterations',
        '30',
        '--ready-iterations',
        '15',
        '--ready-timeout-ms',
        '600000',
        '--warmups',
        '3',
        '--port',
        '49120',
        '--out',
        '/tmp/report.json',
      ]),
    ).toMatchObject({
      iterations: 30,
      readyIterations: 15,
      readyTimeoutMs: 600_000,
      warmups: 3,
    });
    expect(() =>
      parseDevLoopArgs([
        '--manifest',
        '/tmp/manifest.json',
        '--iterations',
        '30',
        '--warmups',
        '3',
        '--port',
        '49120',
        '--out',
        '/tmp/report.json',
      ]),
    ).toThrow('ready iterations must be an integer from 1 through 100');
    expect(
      parseDevLoopArgs([
        '--manifest',
        '/tmp/manifest.json',
        '--iterations',
        '1',
        '--ready-iterations',
        '1',
        '--warmups',
        '0',
        '--port',
        '49120',
        '--profile-dir',
        '/tmp/kovo-dev-profile',
        '--inspector-port',
        '49121',
        '--out',
        '/tmp/report.json',
      ]),
    ).toMatchObject({
      diagnosticProfile: {
        inspectorPort: 49_121,
        profileDir: '/tmp/kovo-dev-profile',
      },
    });
    expect(() =>
      parseDevLoopArgs([
        '--manifest',
        '/tmp/manifest.json',
        '--iterations',
        '1',
        '--ready-iterations',
        '1',
        '--warmups',
        '0',
        '--port',
        '49120',
        '--profile-dir',
        '/tmp/kovo-dev-profile',
        '--out',
        '/tmp/report.json',
      ]),
    ).toThrow('inspector port must be an integer');
  });

  it('fails publication evidence on dirty or changed source provenance', () => {
    const clean = {
      commit: 'a'.repeat(40),
      dirty: false,
      dirtyPaths: [],
      locks: { 'pnpm-lock.yaml': 'sha256:one' },
    };
    expect(sourceStabilityFindings(clean)).toEqual([]);
    expect(
      sourceStabilityFindings({ ...clean, dirty: true, dirtyPaths: [' M source.ts'] }),
    ).toEqual(['pre-run source provenance is dirty']);
    expect(
      sourceStabilityFindings(clean, {
        ...clean,
        commit: 'b'.repeat(40),
        dirty: true,
        dirtyPaths: ['?? output.json'],
        locks: { 'pnpm-lock.yaml': 'sha256:two' },
      }),
    ).toEqual([
      'post-run source provenance is dirty',
      'source commit changed during measurement',
      'dependency lock digests changed during measurement',
      'source dirty paths changed during measurement',
    ]);
    expect(
      sourceStabilityFindings(
        { ...clean, posture: { 'security/posture.json': 'sha256:one' } },
        { ...clean, posture: { 'security/posture.json': 'sha256:two' } },
      ),
    ).toEqual(['framework security posture digests changed during measurement']);
  });

  it('requires every requested ready and edit cell with state and syntax evidence', () => {
    const report = completeCountFixture();
    expect(exactSampleCountFindings(report)).toEqual([]);
    expect(report.integrity.editCounts).toEqual({
      data: 2,
      entry: 2,
      leaf: 2,
      recovery: 2,
      syntaxError: 2,
    });

    report.samples[1].entryMs = null;
    report.samples[0].dataStateSurvived = false;
    report.samples[0].syntaxErrorDiagnosticSignal = '';
    expect(exactSampleCountFindings(report)).toEqual(
      expect.arrayContaining([
        'edit sample 0 lost state during data',
        'edit sample 0 lacks syntax-error diagnostic evidence',
        'edit sample 1 is missing entry timing',
        'entry sample count 1 did not equal 2',
      ]),
    );
  });

  it('proves graceful quiescence and a stable dual-stack exact-port window', async () => {
    const clock = fakeLifecycleClock();
    const signals = [];
    let groupChecks = 0;
    let portChecks = 0;
    const result = await stopDevProcessTree(
      { origin: 'http://localhost:49120', pid: 1234 },
      {
        ...clock,
        portAvailability: async (origin) => {
          expect(origin).toBe('http://localhost:49120');
          portChecks += 1;
          return dualStackPortObservation();
        },
        portStabilityWindowMs: 100,
        processGroupAlive: async () => {
          groupChecks += 1;
          return groupChecks === 1;
        },
        terminateProcessGroup: (pid, signal) => signals.push([pid, signal]),
      },
    );

    expect(result).toMatchObject({
      complete: true,
      error: null,
      origin: 'http://localhost:49120',
      port: {
        addresses: [
          {
            address: '127.0.0.1',
            availableChecks: 3,
            busyChecks: 0,
            checks: 3,
            family: 4,
            supported: true,
            unsupportedChecks: 0,
          },
          {
            address: '::1',
            availableChecks: 3,
            busyChecks: 0,
            checks: 3,
            family: 6,
            supported: true,
            unsupportedChecks: 0,
          },
        ],
        available: true,
        busyChecks: 0,
        checks: 3,
        rebinds: 0,
        requiredStableMs: 100,
        stableMs: 100,
        waitedMs: 100,
      },
      processGroup: { checks: 2, quiescent: true },
      schema: DEV_SESSION_STOP_SCHEMA,
      signals: ['SIGTERM'],
    });
    expect(signals).toEqual([[1234, 'SIGTERM']]);
  });

  it('resets the stability window when a descendant late-rebinds one address', async () => {
    const clock = fakeLifecycleClock();
    let portChecks = 0;
    const result = await stopDevProcessTree(
      { origin: 'http://localhost:49120', pid: 1235 },
      {
        ...clock,
        portAvailability: async () => {
          portChecks += 1;
          return dualStackPortObservation({ ipv4Available: portChecks !== 3 });
        },
        portStabilityWindowMs: 100,
        processGroupAlive: async () => false,
        terminateProcessGroup: () => undefined,
      },
    );

    expect(result.complete).toBe(true);
    expect(result.port).toMatchObject({
      available: true,
      busyChecks: 1,
      checks: 6,
      rebinds: 1,
      requiredStableMs: 100,
      stableMs: 100,
      waitedMs: 250,
    });
    expect(result.port.addresses).toEqual([
      expect.objectContaining({
        address: '127.0.0.1',
        availableChecks: 5,
        busyChecks: 1,
      }),
      expect.objectContaining({ address: '::1', availableChecks: 6, busyChecks: 0 }),
    ]);
  });

  it('requires both IPv4 and IPv6 to be free before starting the stability window', async () => {
    const clock = fakeLifecycleClock();
    let portChecks = 0;
    const result = await stopDevProcessTree(
      { origin: 'http://localhost:49120', pid: 1236 },
      {
        ...clock,
        portAvailability: async () => {
          portChecks += 1;
          if (portChecks === 1) return dualStackPortObservation({ ipv4Available: false });
          if (portChecks === 2) return dualStackPortObservation({ ipv6Available: false });
          return dualStackPortObservation();
        },
        portStabilityWindowMs: 100,
        processGroupAlive: async () => false,
        terminateProcessGroup: () => undefined,
      },
    );

    expect(result.complete).toBe(true);
    expect(result.port).toMatchObject({
      available: true,
      busyChecks: 2,
      checks: 5,
      rebinds: 0,
      stableMs: 100,
      waitedMs: 200,
    });
    expect(result.port.addresses).toEqual([
      expect.objectContaining({ address: '127.0.0.1', busyChecks: 1 }),
      expect.objectContaining({ address: '::1', busyChecks: 1 }),
    ]);
  });

  it('detects an IPv4 localhost collision even when the IPv6 address is free', async () => {
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ exclusive: true, host: '127.0.0.1', port: 0 }, resolve);
    });
    try {
      const address = server.address();
      expect(address).not.toBeNull();
      const observation = await probeOriginPortAvailability(
        `http://localhost:${String(address.port)}`,
      );

      expect(observation.available).toBe(false);
      expect(observation.addresses).toEqual([
        {
          address: '127.0.0.1',
          available: false,
          errorCode: 'EADDRINUSE',
          family: 4,
          supported: true,
        },
        expect.objectContaining({ address: '::1', family: 6 }),
      ]);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('records an unavailable IPv6 stack without treating it as a port collision', async () => {
    const clock = fakeLifecycleClock();
    const result = await stopDevProcessTree(
      { origin: 'http://localhost:49120', pid: 1237 },
      {
        ...clock,
        portAvailability: async () =>
          dualStackPortObservation({ ipv6ErrorCode: 'EAFNOSUPPORT', ipv6Supported: false }),
        portStabilityWindowMs: 100,
        processGroupAlive: async () => false,
        terminateProcessGroup: () => undefined,
      },
    );

    expect(result.complete).toBe(true);
    expect(result.port).toMatchObject({ available: true, busyChecks: 0, checks: 3 });
    expect(result.port.addresses).toEqual([
      expect.objectContaining({
        address: '127.0.0.1',
        availableChecks: 3,
        supported: true,
      }),
      expect.objectContaining({
        address: '::1',
        availableChecks: 0,
        lastErrorCode: 'EAFNOSUPPORT',
        supported: false,
        unsupportedChecks: 3,
      }),
    ]);
  });

  it('escalates a surviving dev process group to SIGKILL before releasing the port', async () => {
    const clock = fakeLifecycleClock();
    const signals = [];
    let killed = false;
    const result = await stopDevProcessTree(
      { origin: 'http://localhost:49120', pid: 2345 },
      {
        ...clock,
        forceTimeoutMs: 20,
        gracefulTimeoutMs: 20,
        pollIntervalMs: 10,
        portAvailability: async () => dualStackPortObservation(),
        portStabilityWindowMs: 20,
        processGroupAlive: async () => !killed,
        terminateProcessGroup: (_pid, signal) => {
          signals.push(signal);
          if (signal === 'SIGKILL') killed = true;
        },
      },
    );

    expect(result.complete).toBe(true);
    expect(result.processGroup.quiescent).toBe(true);
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('fails closed with process-group and strict-port diagnostics when teardown leaks', async () => {
    const clock = fakeLifecycleClock();
    const probedOrigins = [];
    const result = await stopDevProcessTree(
      { origin: 'http://localhost:49120', pid: 3456 },
      {
        ...clock,
        forceTimeoutMs: 20,
        gracefulTimeoutMs: 20,
        pollIntervalMs: 10,
        portAvailability: async (origin) => {
          probedOrigins.push(origin);
          return dualStackPortObservation({ ipv4Available: false, ipv6Available: false });
        },
        portStabilityWindowMs: 10,
        portTimeoutMs: 20,
        processGroupAlive: async () => true,
        terminateProcessGroup: () => undefined,
      },
    );

    expect(result).toMatchObject({
      complete: false,
      origin: 'http://localhost:49120',
      port: { available: false },
      processGroup: { quiescent: false },
      signals: ['SIGTERM', 'SIGKILL'],
    });
    expect(result.error).toContain('process group 3456 remained alive');
    expect(result.error).toContain(
      'http://localhost:49120 did not remain available across all resolved addresses',
    );
    expect(new Set(probedOrigins)).toEqual(new Set(['http://localhost:49120']));
  });

  it('records network failures and explicitly classifies intentional syntax diagnostics', () => {
    const page = new FakePage();
    const telemetry = collectPageTelemetry(page, 'http://localhost:49120');
    page.emit(
      'requestfailed',
      requestEvidence({ failure: 'net::ERR_CONNECTION_REFUSED', url: 'http://localhost:49120/' }),
    );
    page.emit('response', responseEvidence({ status: 200, url: 'http://localhost:49120/' }));
    telemetry.markReady();
    page.emit(
      'response',
      responseEvidence({ status: 404, url: 'http://localhost:49120/favicon.ico' }),
    );
    page.emit('console', { text: () => 'unexpected runtime error', type: () => 'error' });
    telemetry.setPhase('syntaxError');
    telemetry.setIntentionalSyntaxError(true);
    page.emit('pageerror', new Error('expected parser diagnostic'));
    page.emit('response', responseEvidence({ status: 500, url: 'http://localhost:49120/' }));

    expect(telemetry.snapshot()).toMatchObject({
      expectedErrors: [
        expect.objectContaining({
          classification: 'startup-transient',
          kind: 'requestfailed',
        }),
        expect.objectContaining({
          classification: 'browser-incidental',
          kind: 'response',
          status: 404,
        }),
        expect.objectContaining({
          classification: 'intentional-syntax-error',
          kind: 'pageerror',
        }),
        expect.objectContaining({
          classification: 'intentional-syntax-error',
          kind: 'response',
          status: 500,
        }),
      ],
      requestFailedCount: 1,
      responseCount: 3,
      responseStatusCounts: { 200: 1, 404: 1, 500: 1 },
      unexpectedErrors: [
        expect.objectContaining({ kind: 'console', message: 'unexpected runtime error' }),
      ],
    });
  });

  it('summarizes raw cells and ranks only observed edit-to-paint spans', () => {
    expect(summarizeNumbers([4, 1, null, 3, 2])).toEqual({
      mad: 1,
      median: 2,
      p95: 4,
      samples: 4,
    });
    const profile = profileEditToPaint([
      {
        dataMs: 30,
        dataPaintFenceMs: 3,
        dataServerGenerationMs: null,
        dataWriteMs: 1,
        entryMs: 40,
        entryPaintFenceMs: 3,
        entryServerGenerationMs: 25,
        entryWriteMs: 2,
        leafMs: 20,
        leafPaintFenceMs: 4,
        leafServerGenerationMs: 10,
        leafWriteMs: 1,
        recoveryMs: 60,
        recoveryPaintFenceMs: 5,
        recoveryServerGenerationMs: 50,
        recoveryWriteMs: 2,
        syntaxErrorMs: 70,
        syntaxErrorPaintFenceMs: 4,
        syntaxErrorServerGenerationMs: null,
        syntaxErrorWriteMs: 1,
      },
    ]);
    expect(profile.topFive.map(({ editClass, id }) => `${editClass}:${id}`)).toEqual([
      'syntaxError:edit-to-paint',
      'recovery:edit-to-paint',
      'recovery:server-generation',
      'entry:edit-to-paint',
      'data:edit-to-paint',
    ]);
    expect(profile.diagnostic).toBeNull();
  });

  it('fails closed unless every exact diagnostic window has authenticated raw artifacts', () => {
    const windows = ['leaf', 'entry', 'data', 'syntaxError', 'recovery'].map((editClass) => ({
      artifact: {
        cpu: { bytes: 10, file: `${editClass}.cpuprofile`, sha256: `sha256:${'a'.repeat(64)}` },
        heap: { bytes: 10, file: `${editClass}.heapprofile`, sha256: `sha256:${'b'.repeat(64)}` },
      },
      editClass,
      iteration: 0,
    }));
    const report = {
      integrity: { iterations: 1 },
      profile: {
        diagnostic: {
          classifier: DEV_EDIT_PROFILE_CLASSIFIER,
          diagnosticOnly: { profilerPerturbsDurations: true, publishTimingClaims: false },
          profileArtifacts: windows.map(({ artifact, editClass, iteration }) => ({
            artifact,
            editClass,
            iteration,
          })),
          schema: 'kovo-dev-edit-profile/v1',
          windowCount: 5,
          windows,
        },
      },
    };
    expect(diagnosticProfileFindings(report, true)).toEqual([]);
    report.profile.diagnostic.windows[0].artifact.cpu.sha256 = 'forged';
    report.profile.diagnostic.windows[1].editClass = 'leaf';
    expect(diagnosticProfileFindings(report, true)).toEqual(
      expect.arrayContaining([
        'diagnostic window leaf:0 has invalid raw profile evidence',
        'duplicate diagnostic window leaf:0',
        'missing diagnostic window entry:0',
      ]),
    );
  });

  it('writes a fail-closed report and exits nonzero when the manifest is unavailable', async () => {
    const root = await temporaryRoot();
    const outPath = path.join(root, 'failure.json');
    const script = fileURLToPath(new URL('./dev-loop.mjs', import.meta.url));
    const result = spawnSync(
      process.execPath,
      [
        script,
        '--manifest',
        path.join(root, 'missing.json'),
        '--iterations',
        '1',
        '--ready-iterations',
        '1',
        '--warmups',
        '0',
        '--port',
        '49121',
        '--out',
        outPath,
      ],
      { encoding: 'utf8' },
    );
    const report = JSON.parse(await readFile(outPath, 'utf8'));

    expect(result.status).toBe(1);
    expect(report.schema).toBe(DEV_LOOP_REPORT_SCHEMA);
    expect(report.integrity.complete).toBe(false);
    expect(report.integrity.errors[0]).toMatch(/ENOENT/u);
    expect(report.verdict.status).toBe('unproven');
  });
});

function completeCountFixture() {
  const samples = [0, 1].map((iteration) => ({
    dataMs: 10,
    dataStateSurvived: true,
    entryMs: 10,
    entryStateSurvived: true,
    iteration,
    leafMs: 10,
    leafStateSurvived: true,
    recoveryMs: 10,
    recoveryStateSurvived: true,
    syntaxErrorDiagnosticSignal: 'vite-error-overlay:parser error',
    syntaxErrorMs: 10,
    syntaxErrorStateSurvived: true,
  }));
  return {
    editSession: { lifecycle: completeLifecycleFixture() },
    integrity: { editCounts: {}, iterations: 2, readyIterations: 1 },
    readySamples: [
      {
        durationMs: 10,
        iteration: 0,
        lifecycle: completeLifecycleFixture(),
        peakRssBytes: 1,
        success: true,
      },
    ],
    samples,
  };
}

function completeLifecycleFixture() {
  return {
    complete: true,
    schema: DEV_SESSION_STOP_SCHEMA,
  };
}

function fakeLifecycleClock() {
  let value = 0;
  return {
    delay: async (ms) => {
      value += ms;
    },
    now: () => value,
  };
}

function dualStackPortObservation({
  ipv4Available = true,
  ipv6Available = true,
  ipv6ErrorCode = ipv6Available ? null : 'EADDRINUSE',
  ipv6Supported = true,
} = {}) {
  const addresses = [
    {
      address: '127.0.0.1',
      available: ipv4Available,
      errorCode: ipv4Available ? null : 'EADDRINUSE',
      family: 4,
      supported: true,
    },
    {
      address: '::1',
      available: ipv6Available,
      errorCode: ipv6ErrorCode,
      family: 6,
      supported: ipv6Supported,
    },
  ];
  const supported = addresses.filter((address) => address.supported);
  return {
    addresses,
    available: supported.length > 0 && supported.every((address) => address.available),
  };
}

class FakePage {
  #listeners = new Map();

  emit(event, value) {
    for (const listener of this.#listeners.get(event) ?? []) listener(value);
  }

  on(event, listener) {
    const listeners = this.#listeners.get(event) ?? [];
    listeners.push(listener);
    this.#listeners.set(event, listeners);
  }
}

function requestEvidence({ failure = null, status = 200, url }) {
  return {
    failure: () => (failure === null ? null : { errorText: failure }),
    method: () => 'GET',
    resourceType: () => 'document',
    status: () => status,
    url: () => url,
  };
}

function responseEvidence({ status, url }) {
  const request = {
    ...requestEvidence({ status, url }),
    resourceType: () => (new URL(url).pathname === '/favicon.ico' ? 'other' : 'document'),
  };
  return { request: () => request, status: () => status, url: () => url };
}

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-dev-loop-test-'));
  roots.push(root);
  return root;
}
