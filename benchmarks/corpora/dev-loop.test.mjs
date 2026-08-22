import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath as fsRealpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertBrowserErrorOverlayAbsent,
  atomicReplaceCorpusSource,
  collectPageTelemetry,
  collectLinuxSocketOwnerEvidence,
  collectEntrantVersions,
  dependencyRootForDevCommand,
  devLoopIntegrityComplete,
  devLoopVerdictStatus,
  DEV_LOOP_REPORT_SCHEMA,
  DEV_SESSION_HANDOFF_SCHEMA,
  DEV_SESSION_STOP_SCHEMA,
  DEV_SOCKET_OWNER_EVIDENCE_SCHEMA,
  diagnosticProfileFindings,
  establishState,
  exactSampleCountFindings,
  freshReadySeriesCanContinue,
  loadCorpusManifest,
  launchDevSessionAfterHandoff,
  measureFreshReady,
  measureSyntaxAndRecovery,
  normalizeDevLoopOptions,
  parseDevLoopArgs,
  parseLinuxSocketTable,
  profileEditToPaint,
  probeOriginPortAvailability,
  profiledDevInvocation,
  runDevLoopBenchmark,
  sourceStabilityFindings,
  stopDevProcessTree,
  summarizeNumbers,
  validateDevSessionHandoffEvidence,
  validateSocketOwnerEvidence,
  verifyCorpusSources,
  waitForPaint,
  waitForReadyPage,
} from './dev-loop.mjs';
import { generateCorpora } from './generate.mjs';
import { DEV_EDIT_PROFILE_CLASSIFIER } from '../../scripts/perf-dev-edit-profile.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('single-entrant developer-loop adapter', () => {
  it('publishes watched source saves only after complete sibling bytes exist', async () => {
    const root = await temporaryRoot();
    const target = path.join(root, 'component.tsx');
    const original = 'export const revision = "before";\n';
    const replacement = 'export const revision = "after-complete";\n';
    await writeFile(target, original);
    let temporaryPath;

    await atomicReplaceCorpusSource(target, replacement, {
      async rename(from, to) {
        expect(await readFile(target, 'utf8')).toBe(original);
        await rename(from, to);
      },
      async writeFile(file, source, options) {
        temporaryPath = file;
        const split = Math.floor(source.length / 2);
        await writeFile(file, source.slice(0, split), options);
        // Even a deliberately paused partial temporary write never truncates the watched target.
        expect(await readFile(target, 'utf8')).toBe(original);
        await writeFile(file, source.slice(split), { encoding: 'utf8', flag: 'a' });
      },
    });

    expect(path.dirname(temporaryPath)).toBe(root);
    expect(path.basename(temporaryPath)).toMatch(/^\.kovo-perf-save-\d+-\d+\.tmp$/u);
    expect(path.basename(temporaryPath)).not.toContain(path.basename(target));
    expect(path.basename(temporaryPath)).not.toContain('.tsx');
    expect(path.extname(temporaryPath)).toBe('.tmp');
    expect(await readFile(target, 'utf8')).toBe(replacement);
    expect((await readdir(root)).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('removes the sibling temporary file when atomic replacement fails', async () => {
    const root = await temporaryRoot();
    const target = path.join(root, 'component.tsx');
    const original = 'export const revision = "before";\n';
    await writeFile(target, original);

    await expect(
      atomicReplaceCorpusSource(target, 'export const revision = "after";\n', {
        rename: async () => {
          throw new Error('expected rename failure');
        },
      }),
    ).rejects.toThrow('expected rename failure');

    expect(await readFile(target, 'utf8')).toBe(original);
    expect((await readdir(root)).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('rejects a stale diagnostic overlay before starting a syntax sample', async () => {
    await expect(
      assertBrowserErrorOverlayAbsent({ evaluate: async () => null }),
    ).resolves.toBeUndefined();
    await expect(
      assertBrowserErrorOverlayAbsent({
        evaluate: async () => 'vite-error-overlay:previous parser diagnostic',
      }),
    ).rejects.toThrow('syntax error measurement found a stale browser error overlay');
  });

  it('aborts the syntax/recovery sequence after the first failed observation', async () => {
    const root = await temporaryRoot();
    await mkdir(path.join(root, 'src'), { recursive: true });
    const leafSource = 'export const node = <div data-revision="leaf-r0" />;\n';
    const page = statePreservingPage();
    const telemetryTransitions = [];
    const telemetry = {
      setIntentionalSyntaxError: (value) =>
        telemetryTransitions.push(`intentional:${String(value)}`),
      setPhase: (value) => telemetryTransitions.push(`phase:${String(value)}`),
    };
    const options = {
      appRoot: root,
      iterations: 3,
      leafSource,
      page,
      profiler: undefined,
      recovery: { evidence: {} },
      session: {},
      state: { property: 'textContent', selector: '[data-state]', value: 'Count 1' },
      syntaxError: {
        file: 'src/component.tsx',
        replacement: 'data-revision={',
        search: 'data-revision="leaf-r0"',
      },
      telemetry,
      warmups: 0,
    };
    let recoveryCalls = 0;
    const restored = [];
    const syntaxFailure = await measureSyntaxAndRecovery(options, {
      applyRecovery: async () => {
        recoveryCalls += 1;
        return successfulEditObservation('recovery', 0);
      },
      applySyntaxError: async ({ iteration }) => {
        telemetry.setPhase('syntaxError');
        telemetry.setIntentionalSyntaxError(true);
        return failedEditObservationForTest('syntaxError', iteration);
      },
      replaceSource: async () => {
        throw new Error('expected restore failure');
      },
    });

    expect(syntaxFailure.all).toHaveLength(1);
    expect(syntaxFailure.measured).toHaveLength(1);
    expect(syntaxFailure.all[0].error).toBe(
      'expected test failure; source restoration: expected restore failure',
    );
    expect(recoveryCalls).toBe(0);
    expect(restored).toEqual([]);
    expect(telemetryTransitions).toEqual([
      'phase:syntaxError',
      'intentional:true',
      'intentional:false',
      'phase:idle',
    ]);

    let syntaxCalls = 0;
    recoveryCalls = 0;
    restored.length = 0;
    telemetryTransitions.length = 0;
    const recoveryFailure = await measureSyntaxAndRecovery(options, {
      applyRecovery: async ({ iteration }) => {
        recoveryCalls += 1;
        return failedEditObservationForTest('recovery', iteration);
      },
      applySyntaxError: async ({ iteration }) => {
        syntaxCalls += 1;
        return successfulEditObservation('syntaxError', iteration);
      },
      replaceSource: async (file, source) => restored.push({ file, source }),
    });

    expect(recoveryFailure.all).toHaveLength(2);
    expect(recoveryFailure.measured).toHaveLength(2);
    expect(syntaxCalls).toBe(1);
    expect(recoveryCalls).toBe(1);
    expect(restored).toEqual([{ file: path.join(root, 'src/component.tsx'), source: leafSource }]);
  });

  it('retains exact syntax and recovery counts for a short successful sequence', async () => {
    const root = await temporaryRoot();
    await mkdir(path.join(root, 'src'), { recursive: true });
    const leafSource = 'export const node = <div data-revision="leaf-r0" />;\n';
    let syntaxCalls = 0;
    let recoveryCalls = 0;
    let restoreCalls = 0;
    const result = await measureSyntaxAndRecovery(
      {
        appRoot: root,
        iterations: 2,
        leafSource,
        page: statePreservingPage(),
        profiler: undefined,
        recovery: { evidence: {} },
        session: {},
        state: { property: 'textContent', selector: '[data-state]', value: 'Count 1' },
        syntaxError: {
          file: 'src/component.tsx',
          replacement: 'data-revision={',
          search: 'data-revision="leaf-r0"',
        },
        telemetry: {},
        warmups: 0,
      },
      {
        applyRecovery: async ({ iteration }) => {
          recoveryCalls += 1;
          return successfulEditObservation('recovery', iteration);
        },
        applySyntaxError: async ({ iteration }) => {
          syntaxCalls += 1;
          return successfulEditObservation('syntaxError', iteration);
        },
        replaceSource: async () => {
          restoreCalls += 1;
        },
      },
    );

    expect(
      result.all.map(({ editClass, iteration }) => `${editClass}:${String(iteration)}`),
    ).toEqual(['syntaxError:0', 'recovery:0', 'syntaxError:1', 'recovery:1']);
    expect(result.measured).toEqual(result.all);
    expect({ recoveryCalls, restoreCalls, syntaxCalls }).toEqual({
      recoveryCalls: 2,
      restoreCalls: 0,
      syntaxCalls: 2,
    });
  });

  it('authenticates every generated source byte and rejects changed or additional sources', async () => {
    const root = await temporaryRoot();
    const [manifestPath] = await generateCorpora({ outDir: root, sizes: [24] });
    const evidence = await loadCorpusManifest(manifestPath);

    await expect(verifyCorpusSources(evidence)).resolves.toBeUndefined();
    expect(evidence.manifest.sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(evidence.manifestDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const target = path.join(evidence.appRoot, 'src/data.tsx');
    const original = await readFile(target, 'utf8');
    await atomicReplaceCorpusSource(target, original);
    await expect(verifyCorpusSources(evidence)).resolves.toBeUndefined();
    expect((await readdir(path.dirname(target))).filter((entry) => entry.endsWith('.tmp'))).toEqual(
      [],
    );
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

  it('rejects a re-digested manifest that changes the atomic edit/save posture', async () => {
    const root = await temporaryRoot();
    const [manifestPath] = await generateCorpora({ outDir: root, sizes: [24] });
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.workload.editSavePosture = 'direct-truncate-write/v1';
    manifest.shapeDigest = createHash('sha256')
      .update(JSON.stringify(manifest.workload))
      .digest('hex');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(loadCorpusManifest(manifestPath)).rejects.toThrow(
      'Corpus workload does not authenticate the atomic edit/save posture',
    );
  });

  it('rejects a re-digested manifest that widens the exact staging watch ignore', async () => {
    const root = await temporaryRoot();
    const [manifestPath] = await generateCorpora({ outDir: root, sizes: [24] });
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.workload.editSavePosture =
      'posix-sibling-.kovo-perf-save-*.tmp-write-rename+all-tmp-watch-ignore/v2';
    manifest.shapeDigest = createHash('sha256')
      .update(JSON.stringify(manifest.workload))
      .digest('hex');
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(loadCorpusManifest(manifestPath)).rejects.toThrow(
      'Corpus workload does not authenticate the atomic edit/save posture',
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

    const packedEntry = path.join(root, 'isolated/node_modules/@kovojs/cli/dist/bin.mjs');
    const packedCommand = {
      argv: [process.execPath, packedEntry, 'dev', './src/app.tsx'],
      cwd: root,
      packedProduct: {
        cliEntry: packedEntry,
        consumerDependencyRoot: path.join(root, 'isolated/node_modules'),
        dependencyRoot: path.join(root, 'isolated/node_modules'),
      },
    };
    expect(profiledDevInvocation(packedCommand, 49_121)).toEqual({
      argv: ['--inspect=127.0.0.1:49121', packedEntry, 'dev', './src/app.tsx'],
      executable: process.execPath,
    });
    expect(profiledDevInvocation(packedCommand, 49_121, { pauseOnStart: true })).toEqual({
      argv: ['--inspect-brk=127.0.0.1:49121', packedEntry, 'dev', './src/app.tsx'],
      executable: process.execPath,
    });
    expect(() => profiledDevInvocation(packedCommand, null, { pauseOnStart: true })).toThrow(
      /requires an Inspector port/u,
    );
    expect(profiledDevInvocation(packedCommand, 49_121).argv).not.toContain(
      '--experimental-transform-types',
    );
    expect(() =>
      profiledDevInvocation(
        { ...packedCommand, argv: [process.execPath, `${packedEntry}.ts`, 'dev'] },
        49_121,
      ),
    ).toThrow(/confused its authenticated dist entry/u);
  });

  it('retains the exact paused packed argv and strips inherited Node loader options', async () => {
    const root = await temporaryRoot();
    const entrypoint = path.join(root, 'node_modules/@kovojs/cli/dist/bin.mjs');
    const devPort = 49_120;
    const inspectorPort = 49_121;
    const argv = [
      process.execPath,
      entrypoint,
      'dev',
      './src/app.tsx',
      '--host',
      'localhost',
      '--strict-port',
      '--port',
      String(devPort),
    ];
    const spawnProcess = vi.fn(() => ({
      once() {},
      pid: 9_121,
      stderr: { on() {} },
      stdout: { on() {} },
    }));
    const launched = await launchDevSessionAfterHandoff(
      {
        appRoot: root,
        command: {
          argv,
          cwd: root,
          env: { NODE_OPTIONS: '--require=/tmp/untrusted.cjs', NODE_PATH: '/tmp/untrusted' },
          origin: `http://localhost:${String(devPort)}`,
          packedProduct: { cliEntry: entrypoint },
        },
        inspectorPauseOnStart: true,
        inspectorPort,
        priorProcessMarker: null,
        priorSession: null,
        spawnProcess,
        targetSession: 'ready[0]',
      },
      {
        now: monotonicTestClock(),
        portAvailability: async () => dualStackPortObservation(),
        wallNow: () => '2026-08-13T00:00:00.000Z',
      },
    );

    const expectedProfiledArgv = [
      `--inspect-brk=127.0.0.1:${String(inspectorPort)}`,
      ...argv.slice(1),
    ];
    expect(launched.session.inspectorInvocation).toEqual({
      argv: expectedProfiledArgv,
      executable: process.execPath,
      pauseOnStart: true,
      port: inspectorPort,
      schema: 'kovo-profiled-process-invocation/v1',
    });
    expect(Object.isFrozen(launched.session.inspectorInvocation)).toBe(true);
    expect(Object.isFrozen(launched.session.inspectorInvocation.argv)).toBe(true);
    expect(spawnProcess).toHaveBeenCalledWith(
      process.execPath,
      expectedProfiledArgv,
      expect.objectContaining({
        env: expect.not.objectContaining({
          NODE_OPTIONS: expect.anything(),
          NODE_PATH: expect.anything(),
        }),
      }),
    );
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
      '49122',
      '--out',
      '/tmp/report.json',
    ]);

    expect(normalizeDevLoopOptions(parsed)).toEqual(parsed);
    expect(() =>
      normalizeDevLoopOptions({ ...parsed, profileDir: '/tmp/ambiguous-profile' }),
    ).toThrow('must use one representation');
  });

  it('requires paired packed-product descriptor arguments', () => {
    const base = [
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
      '--out',
      '/tmp/report.json',
    ];
    const parsed = parseDevLoopArgs([
      ...base,
      '--packed-product',
      '/tmp/consumer/.kovo-perf-packed-product.json',
      '--packed-product-digest',
      `sha256:${'a'.repeat(64)}`,
    ]);
    expect(parsed.packedProduct).toEqual({
      descriptorPath: '/tmp/consumer/.kovo-perf-packed-product.json',
      digest: `sha256:${'a'.repeat(64)}`,
    });
    expect(normalizeDevLoopOptions(parsed)).toEqual(parsed);
    expect(() => parseDevLoopArgs([...base, '--packed-product', '/tmp/descriptor'])).toThrow(
      /packed product digest/u,
    );
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

  it('extends dependency-root authentication to the explicit packed consumer only', async () => {
    const root = await temporaryRoot();
    const appRoot = path.join(root, 'app');
    const consumerDependencyRoot = path.join(root, 'consumer/node_modules');
    const dependencyRoot = path.join(
      consumerDependencyRoot,
      '.pnpm/@kovojs+cli@file+fixture/node_modules',
    );
    const realCliEntry = path.join(dependencyRoot, '@kovojs/cli/dist/bin.mjs');
    const cliEntry = path.join(consumerDependencyRoot, '@kovojs/cli/dist/bin.mjs');
    await mkdir(path.dirname(realCliEntry), { recursive: true });
    await writeFile(realCliEntry, 'export {}\n');
    await mkdir(path.join(dependencyRoot, '@kovojs/cli'), { recursive: true });
    await writeFile(
      path.join(dependencyRoot, '@kovojs/cli/package.json'),
      `${JSON.stringify({ name: '@kovojs/cli', version: '0.3.0' })}\n`,
    );
    await mkdir(path.join(dependencyRoot, 'vite-plus'), { recursive: true });
    await writeFile(
      path.join(dependencyRoot, 'vite-plus/package.json'),
      `${JSON.stringify({ name: 'vite-plus', version: '0.1.24' })}\n`,
    );
    await mkdir(path.join(consumerDependencyRoot, '@kovojs'), { recursive: true });
    await symlink(
      path.join(dependencyRoot, '@kovojs/cli'),
      path.join(consumerDependencyRoot, '@kovojs/cli'),
      'dir',
    );
    await mkdir(appRoot, { recursive: true });
    await symlink(consumerDependencyRoot, path.join(appRoot, 'node_modules'), 'dir');
    const command = {
      argv: [process.execPath, cliEntry, 'dev'],
      cwd: appRoot,
      packedProduct: { cliEntry, consumerDependencyRoot, dependencyRoot },
    };
    await expect(dependencyRootForDevCommand(appRoot, 'kovo', command)).resolves.toBe(
      dependencyRoot,
    );
    await expect(collectEntrantVersions(appRoot, 'kovo', command)).resolves.toEqual({
      '@kovojs/cli': '0.3.0',
      'vite-plus': '0.1.24',
    });
    await expect(
      dependencyRootForDevCommand(appRoot, 'nextjs', command, {
        realpath: async (value) => value,
      }),
    ).rejects.toThrow(/cannot own a non-Kovo corpus/u);
    await expect(
      dependencyRootForDevCommand(appRoot, 'kovo', command, {
        realpath: async (value) =>
          value === path.join(appRoot, 'node_modules')
            ? '/tmp/substituted'
            : await fsRealpath(value),
      }),
    ).rejects.toThrow(/authenticated app binding/u);
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
        '49122',
        '--out',
        '/tmp/report.json',
      ]),
    ).toMatchObject({
      diagnosticProfile: {
        inspectorPort: 49_122,
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

  it('cross-binds the requested Inspector port to the authenticated allocation', () => {
    const report = completeCountFixture();
    report.integrity.inspectorPort = 21_216;
    report.integrity.portAllocation.inspectorPorts = [21_217];

    expect(exactSampleCountFindings(report)).toContain(
      'per-session dev port allocation is incomplete',
    );
  });

  it('requires independently proven browser-context teardown for every raw session', () => {
    const report = completeCountFixture();
    report.readySamples[0].browserContextClosed = false;
    delete report.editSession.browserContextClosed;

    expect(exactSampleCountFindings(report)).toEqual(
      expect.arrayContaining([
        'ready sample 0 is incomplete',
        'edit session readiness or lifecycle is incomplete',
      ]),
    );
  });

  it('cannot mark adapter integrity measured when any browser request failed', () => {
    const integrity = {
      browser: { requestFailedCount: 0, unexpectedErrorCount: 0 },
      corpus: { afterVerified: true, beforeVerified: true },
      errors: [],
      misses: 0,
      source: { stable: true },
    };
    expect(devLoopIntegrityComplete(integrity)).toBe(true);
    expect(devLoopVerdictStatus(devLoopIntegrityComplete(integrity), false)).toBe('measured');

    integrity.browser.requestFailedCount = 1;
    expect(devLoopIntegrityComplete(integrity)).toBe(false);
    expect(devLoopVerdictStatus(devLoopIntegrityComplete(integrity), false)).toBe('unproven');
  });

  it('refuses a spawn when IPv6 becomes busy immediately after a stable teardown', async () => {
    const teardownClock = fakeLifecycleClock();
    const lifecycle = await stopDevProcessTree(
      {
        marker: 'KOVO_PERF_DEV_SESSION_PRIOR',
        origin: 'http://localhost:49120',
        pid: 9_001,
      },
      {
        ...teardownClock,
        portAvailability: async () => dualStackPortObservation(),
        portStabilityWindowMs: 500,
        processGroupAlive: async () => false,
        signalMarkedProcesses: emptyMarkedProcessCensus,
        terminateProcessGroup: () => undefined,
      },
    );
    expect(lifecycle.port).toMatchObject({ available: true, stableMs: 500 });

    const spawnProcess = vi.fn();
    const launch = await launchDevSessionAfterHandoff(
      handoffLaunchOptions({
        origin: 'http://localhost:49120',
        priorProcessMarker: 'KOVO_PERF_DEV_SESSION_PRIOR',
        priorSession: 'ready[0]',
        spawnProcess,
        targetSession: 'ready[1]',
      }),
      {
        collectSocketEvidence: async () => socketOwnerEvidenceFixture(),
        now: monotonicTestClock(),
        portAvailability: async () => dualStackPortObservation({ ipv6Available: false }),
        wallNow: () => '2026-08-13T00:00:00.000Z',
      },
    );

    expect(spawnProcess).not.toHaveBeenCalled();
    expect(launch).toMatchObject({
      handoff: {
        attribution: { from: 'ready[0]', to: 'ready[1]' },
        available: false,
        complete: false,
        schema: DEV_SESSION_HANDOFF_SCHEMA,
        socketEvidence: {
          complete: true,
          sockets: [
            expect.objectContaining({
              state: 'LISTEN',
              owners: [expect.objectContaining({ priorSessionMarkerMatched: true })],
            }),
          ],
        },
      },
      session: null,
      started: null,
    });
    expect(launch.handoff.error).toContain('no process was spawned');
  });

  it('attributes first-start collisions without killing or launching an arbitrary owner', async () => {
    const spawnProcess = vi.fn();
    const launch = await launchDevSessionAfterHandoff(
      handoffLaunchOptions({
        origin: 'http://localhost:49130',
        priorProcessMarker: null,
        priorSession: null,
        spawnProcess,
        targetSession: 'ready[0]',
      }),
      {
        collectSocketEvidence: async () =>
          socketOwnerEvidenceFixture({ origin: 'http://localhost:49130' }),
        now: monotonicTestClock(),
        portAvailability: async () => dualStackPortObservation({ ipv6Available: false }),
        wallNow: () => '2026-08-13T00:00:00.000Z',
      },
    );

    expect(spawnProcess).not.toHaveBeenCalled();
    expect(launch.handoff.attribution).toEqual({
      from: null,
      priorMarkerSha256: null,
      to: 'ready[0]',
    });
    expect(launch.handoff.error).toContain('initial -> ready[0]');
  });

  it('fences the exact Inspector port on both loopback families before profiled timing', async () => {
    const spawnProcess = vi.fn();
    const inspectedOrigins = [];
    const launch = await launchDevSessionAfterHandoff(
      handoffLaunchOptions({
        inspectorPort: 21_216,
        origin: 'http://localhost:20216',
        spawnProcess,
        targetSession: 'edit-session',
      }),
      {
        collectSocketEvidence: async ({ busyAddresses, origin }) =>
          socketOwnerEvidenceFixture({ busyAddresses, origin }),
        now: monotonicTestClock(),
        portAvailability: async (origin) => {
          inspectedOrigins.push(origin);
          return Number(new URL(origin).port) === 21_216
            ? dualStackPortObservation({ ipv6Available: false })
            : dualStackPortObservation();
        },
        wallNow: () => '2026-08-13T00:00:00.000Z',
      },
    );

    expect(spawnProcess).not.toHaveBeenCalled();
    expect(inspectedOrigins.sort()).toEqual(['http://localhost:20216', 'http://localhost:21216']);
    expect(launch.handoff).toMatchObject({
      complete: false,
      inspector: {
        available: false,
        complete: false,
        origin: 'http://localhost:21216',
        socketEvidence: { complete: true },
      },
    });
    expect(launch.handoff.error).toContain('Inspector busy ::1/6');
  });

  it('uses a new exact port so a prior late rebind cannot collide with the next session', async () => {
    const startedOrigins = [];
    const busyPorts = new Set();
    const dependencies = {
      now: monotonicTestClock(),
      portAvailability: async (origin) => {
        const port = Number(new URL(origin).port);
        return dualStackPortObservation({
          ipv4Available: !busyPorts.has(port),
          ipv6Available: !busyPorts.has(port),
        });
      },
      startSession: ({ command }) => {
        startedOrigins.push(command.origin);
        return { pid: 7_001, processMarker: 'KOVO_PERF_DEV_SESSION_NEW' };
      },
      wallNow: () => '2026-08-13T00:00:00.000Z',
    };
    const first = await launchDevSessionAfterHandoff(
      handoffLaunchOptions({ origin: 'http://localhost:49140', targetSession: 'ready[0]' }),
      dependencies,
    );
    expect(first.session).not.toBeNull();
    busyPorts.add(49_140);
    const second = await launchDevSessionAfterHandoff(
      handoffLaunchOptions({
        origin: 'http://localhost:49141',
        priorProcessMarker: first.session.processMarker,
        priorSession: 'ready[0]',
        targetSession: 'ready[1]',
      }),
      dependencies,
    );

    expect(second.session).not.toBeNull();
    expect(startedOrigins).toEqual(['http://localhost:49140', 'http://localhost:49141']);
  });

  it('allows an unavailable IPv6 stack but fails closed on probe errors', async () => {
    const startSession = vi.fn(() => ({
      pid: 7_002,
      processMarker: 'KOVO_PERF_DEV_SESSION_SUPPORTED',
    }));
    const supported = await launchDevSessionAfterHandoff(
      handoffLaunchOptions({ origin: 'http://localhost:49150', targetSession: 'ready[0]' }),
      {
        now: monotonicTestClock(),
        portAvailability: async () =>
          dualStackPortObservation({ ipv6ErrorCode: 'EAFNOSUPPORT', ipv6Supported: false }),
        startSession,
        wallNow: () => '2026-08-13T00:00:00.000Z',
      },
    );
    expect(supported.handoff.complete).toBe(true);
    expect(startSession).toHaveBeenCalledOnce();
    expect(typeof startSession.mock.calls[0][0].spawnProcess).toBe('function');

    startSession.mockClear();
    const failed = await launchDevSessionAfterHandoff(
      handoffLaunchOptions({ origin: 'http://localhost:49151', targetSession: 'ready[0]' }),
      {
        now: monotonicTestClock(),
        portAvailability: async () => {
          throw new Error('synthetic probe failure');
        },
        startSession,
        wallNow: () => '2026-08-13T00:00:00.000Z',
      },
    );
    expect(failed.session).toBeNull();
    expect(failed.handoff.check).toMatchObject({
      addresses: [],
      probeError: 'synthetic probe failure',
    });
    expect(startSession).not.toHaveBeenCalled();
  });

  it('validates bounded kernel socket state and owner identity without retaining argv or env', async () => {
    const table = [
      '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
      '   0: 00000000000000000000000001000000:BFF0 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  501 0 424242 1 0000000000000000 100 0 0 10 0',
    ].join('\n');
    expect(parseLinuxSocketTable(table, 6, 49_136)).toEqual([
      expect.objectContaining({ family: 6, inode: '424242', state: 'LISTEN', stateCode: '0A' }),
    ]);

    const priorMarker = 'KOVO_PERF_DEV_SESSION_OWNER';
    const evidence = await collectLinuxSocketOwnerEvidence(
      {
        busyAddresses: [
          { address: '::1', available: false, errorCode: 'EADDRINUSE', family: 6, supported: true },
        ],
        origin: 'http://localhost:49136',
        priorProcessMarker: priorMarker,
      },
      {
        listDirectory: async (target) => {
          if (target === '/proc') return ['8100'];
          if (target === '/proc/8100/fd') return ['7'];
          throw new Error(`unexpected directory ${target}`);
        },
        platform: 'linux',
        readBoundedFile: async (target) => {
          if (target === '/proc/net/tcp')
            return { bytes: Buffer.from('header\n'), truncated: false };
          if (target === '/proc/net/tcp6') return { bytes: Buffer.from(table), truncated: false };
          if (target === '/proc/8100/comm')
            return { bytes: Buffer.from('node\n'), truncated: false };
          if (target === '/proc/8100/environ') {
            return { bytes: Buffer.from(`SAFE=1\0${priorMarker}=1\0`), truncated: false };
          }
          throw new Error(`unexpected file ${target}`);
        },
        readLink: async () => 'socket:[424242]',
      },
    );
    expect(evidence).toMatchObject({
      complete: true,
      schema: DEV_SOCKET_OWNER_EVIDENCE_SCHEMA,
      sockets: [
        {
          owners: [{ command: 'node', pid: 8_100, priorSessionMarkerMatched: true }],
          state: 'LISTEN',
        },
      ],
    });
    expect(JSON.stringify(evidence)).not.toContain('SAFE=1');
    expect(JSON.stringify(evidence)).not.toContain(priorMarker);

    const malformed = socketOwnerEvidenceFixture();
    malformed.sockets[0].owners[0].priorSessionMarkerMatched = 'yes';
    expect(() => validateSocketOwnerEvidence(malformed)).toThrow('socket owner identity');
    const handoff = completeHandoffFixture(49_120, 0, 1);
    handoff.available = false;
    expect(() => validateDevSessionHandoffEvidence(handoff)).toThrow('summary disagrees');
  });

  it('records Linux owner-census permission failures as explicit limitations', async () => {
    const table = [
      '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
      '   0: 0100007F:BFF1 00000000:0000 0A 00000000:00000000 00:00000000 00000000  501 0 424243',
    ].join('\n');
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
    const evidence = await collectLinuxSocketOwnerEvidence(
      {
        busyAddresses: [
          {
            address: '127.0.0.1',
            available: false,
            errorCode: 'EADDRINUSE',
            family: 4,
            supported: true,
          },
        ],
        origin: 'http://localhost:49137',
        priorProcessMarker: 'KOVO_PERF_DEV_SESSION_OWNER_DENIED',
      },
      {
        listDirectory: async (target) => {
          if (target === '/proc') return ['8101'];
          if (target === '/proc/8101/fd') throw denied;
          throw new Error(`unexpected directory ${target}`);
        },
        platform: 'linux',
        readBoundedFile: async (target) => ({
          bytes: Buffer.from(target === '/proc/net/tcp' ? table : 'header\n'),
          truncated: false,
        }),
      },
    );

    expect(evidence).toMatchObject({ complete: false, sockets: [expect.any(Object)] });
    expect(evidence.limitations).toContain('PID 8101 descriptors were not observable');
  });

  it('records kernel socket parse failures instead of silently dropping malformed rows', async () => {
    const evidence = await collectLinuxSocketOwnerEvidence(
      {
        busyAddresses: [
          {
            address: '127.0.0.1',
            available: false,
            errorCode: 'EADDRINUSE',
            family: 4,
            supported: true,
          },
        ],
        origin: 'http://localhost:49138',
        priorProcessMarker: null,
      },
      {
        platform: 'linux',
        readBoundedFile: async (target) => ({
          bytes: Buffer.from(target === '/proc/net/tcp' ? 'header\nmalformed row\n' : 'header\n'),
          truncated: false,
        }),
      },
    );

    expect(evidence.complete).toBe(false);
    expect(evidence.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/proc/net/tcp could not be parsed'),
        'no matching kernel socket row remained after the busy bind check',
      ]),
    );
  });

  it('proves graceful quiescence and a stable dual-stack exact-port window', async () => {
    const clock = fakeLifecycleClock();
    const signals = [];
    let groupChecks = 0;
    let portChecks = 0;
    const result = await stopDevProcessTree(
      {
        marker: 'KOVO_PERF_DEV_SESSION_TEST_GRACEFUL',
        origin: 'http://localhost:49120',
        pid: 1234,
      },
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
        signalMarkedProcesses: emptyMarkedProcessCensus,
        terminateProcessGroup: (pid, signal) => signals.push([pid, signal]),
      },
    );

    expect(result).toMatchObject({
      complete: true,
      error: null,
      origin: 'http://localhost:49120',
      ownedProcesses: { checks: 2, maxSurvivors: 0, quiescent: true },
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
      {
        marker: 'KOVO_PERF_DEV_SESSION_TEST_REBIND',
        origin: 'http://localhost:49120',
        pid: 1235,
      },
      {
        ...clock,
        portAvailability: async () => {
          portChecks += 1;
          return dualStackPortObservation({ ipv4Available: portChecks !== 3 });
        },
        portStabilityWindowMs: 100,
        processGroupAlive: async () => false,
        signalMarkedProcesses: emptyMarkedProcessCensus,
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
      {
        marker: 'KOVO_PERF_DEV_SESSION_TEST_BOTH_FAMILIES',
        origin: 'http://localhost:49120',
        pid: 1236,
      },
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
        signalMarkedProcesses: emptyMarkedProcessCensus,
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
      {
        marker: 'KOVO_PERF_DEV_SESSION_TEST_IPV6_UNAVAILABLE',
        origin: 'http://localhost:49120',
        pid: 1237,
      },
      {
        ...clock,
        portAvailability: async () =>
          dualStackPortObservation({ ipv6ErrorCode: 'EAFNOSUPPORT', ipv6Supported: false }),
        portStabilityWindowMs: 100,
        processGroupAlive: async () => false,
        signalMarkedProcesses: emptyMarkedProcessCensus,
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
      {
        marker: 'KOVO_PERF_DEV_SESSION_TEST_FORCE',
        origin: 'http://localhost:49120',
        pid: 2345,
      },
      {
        ...clock,
        forceTimeoutMs: 20,
        gracefulTimeoutMs: 20,
        pollIntervalMs: 10,
        portAvailability: async () => dualStackPortObservation(),
        portStabilityWindowMs: 20,
        processGroupAlive: async () => !killed,
        signalMarkedProcesses: emptyMarkedProcessCensus,
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

  it('cleans a detached marked descendant after its original process group is quiescent', async () => {
    const clock = fakeLifecycleClock();
    const markerSignals = [];
    let markerChecks = 0;
    const result = await stopDevProcessTree(
      {
        marker: 'KOVO_PERF_DEV_SESSION_TEST_DETACHED',
        origin: 'http://localhost:49120',
        pid: 3345,
      },
      {
        ...clock,
        pollIntervalMs: 10,
        portAvailability: async () => dualStackPortObservation(),
        portStabilityWindowMs: 20,
        processGroupAlive: async () => false,
        signalMarkedProcesses: async (_marker, signal) => {
          markerChecks += 1;
          const observed = markerChecks === 1 ? [markedProcess(7788)] : [];
          const signaled = observed.map(({ pid }) => pid);
          markerSignals.push(...signaled.map((pid) => [pid, signal]));
          return { observed, signaled };
        },
        terminateProcessGroup: () => undefined,
      },
    );

    expect(result).toMatchObject({
      complete: true,
      ownedProcesses: {
        checks: 3,
        maxSurvivors: 1,
        quiescent: true,
        signalAttempts: 1,
        waitedMs: 20,
      },
      processGroup: { checks: 1, quiescent: true },
    });
    expect(markerSignals).toEqual([[7788, 'SIGTERM']]);
  });

  it('fails closed when a detached marked descendant survives TERM and KILL', async () => {
    const clock = fakeLifecycleClock();
    const markerSignals = [];
    const result = await stopDevProcessTree(
      {
        marker: 'KOVO_PERF_DEV_SESSION_TEST_MARKER_LEAK',
        origin: 'http://localhost:49120',
        pid: 3445,
      },
      {
        ...clock,
        forceTimeoutMs: 20,
        gracefulTimeoutMs: 20,
        pollIntervalMs: 10,
        portAvailability: async () => dualStackPortObservation(),
        portStabilityWindowMs: 20,
        processGroupAlive: async () => false,
        signalMarkedProcesses: async (_marker, signal) => {
          markerSignals.push(signal);
          return { observed: [markedProcess(8899)], signaled: [8899] };
        },
        terminateProcessGroup: () => undefined,
      },
    );

    expect(result).toMatchObject({
      complete: false,
      ownedProcesses: {
        checks: 6,
        maxSurvivors: 1,
        quiescent: false,
        signalAttempts: 6,
        waitedMs: 40,
      },
    });
    expect(result.error).toContain('inherited-marker process tree remained alive');
    expect(markerSignals).toEqual([
      'SIGTERM',
      'SIGTERM',
      'SIGTERM',
      'SIGKILL',
      'SIGKILL',
      'SIGKILL',
    ]);
  });

  it('fails closed with process-group and strict-port diagnostics when teardown leaks', async () => {
    const clock = fakeLifecycleClock();
    const probedOrigins = [];
    const terminateProcessGroup = vi.fn();
    const collectSocketEvidence = vi.fn(async ({ busyAddresses, origin }) =>
      socketOwnerEvidenceFixture({ busyAddresses, origin }),
    );
    const result = await stopDevProcessTree(
      {
        marker: 'KOVO_PERF_DEV_SESSION_TEST_LEAK',
        origin: 'http://localhost:49120',
        pid: 3456,
      },
      {
        ...clock,
        collectSocketEvidence,
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
        signalMarkedProcesses: emptyMarkedProcessCensus,
        terminateProcessGroup,
      },
    );

    expect(result).toMatchObject({
      complete: false,
      origin: 'http://localhost:49120',
      port: { available: false },
      processGroup: { quiescent: false },
      signals: ['SIGTERM', 'SIGKILL'],
      socketEvidence: {
        busyAddresses: [
          { address: '127.0.0.1', errorCode: 'EADDRINUSE', family: 4 },
          { address: '::1', errorCode: 'EADDRINUSE', family: 6 },
        ],
        complete: true,
      },
    });
    expect(result.error).toContain('process group 3456 remained alive');
    expect(result.error).toContain(
      'http://localhost:49120 did not remain available across all resolved addresses',
    );
    expect(new Set(probedOrigins)).toEqual(new Set(['http://localhost:49120']));
    expect(collectSocketEvidence).toHaveBeenCalledOnce();
    expect(terminateProcessGroup.mock.calls).toEqual([
      [3456, 'SIGTERM'],
      [3456, 'SIGKILL'],
    ]);
    expect(JSON.stringify(result.socketEvidence)).not.toMatch(/argv|environ/u);
  });

  it('does not navigate the instrumented browser until the Node readiness probe succeeds', async () => {
    const events = [];
    let attempts = 0;
    const page = {
      goto: async () => {
        events.push('browser:goto');
        return { status: () => 200 };
      },
      locator: () => ({
        first: () => ({ getAttribute: async () => 'ready' }),
      }),
    };
    const result = await waitForReadyPage(
      {
        origin: 'http://localhost:49120',
        page,
        ready: { attribute: 'data-ready', expected: 'ready', path: '/', selector: 'main' },
        session: { exited: () => false, logTail: () => '' },
        timeoutMs: 1_000,
      },
      {
        delay: async () => undefined,
        requestReadyRoute: async () => {
          attempts += 1;
          events.push(`probe:${String(attempts)}`);
          if (attempts === 1) throw new Error('connect ECONNREFUSED');
          return { status: attempts === 2 ? 503 : 200 };
        },
        waitForPaint: async (_page, timeoutMs) => {
          expect(timeoutMs).toBeGreaterThan(0);
          events.push('browser:paint');
          return 1;
        },
      },
    );

    expect(events).toEqual(['probe:1', 'probe:2', 'probe:3', 'browser:goto', 'browser:paint']);
    expect(result.readinessProbe).toEqual({
      attempts: 3,
      path: '/',
      status: 200,
      transientFailures: 2,
    });
  });

  it('fences two animation frames without mutating framework-owned document markup', async () => {
    const frames = [];
    let predicateSource = null;
    let waitOptions = null;
    let documentReads = 0;
    vi.stubGlobal('document', {
      get documentElement() {
        documentReads += 1;
        throw new Error('paint fence touched the hydrated document');
      },
    });
    vi.stubGlobal('requestAnimationFrame', (callback) => {
      frames.push(callback);
      return frames.length;
    });
    try {
      const page = {
        waitForFunction: async (predicate, argument, options) => {
          predicateSource = String(predicate);
          waitOptions = { argument, options };
          return predicate();
        },
      };
      const pending = waitForPaint(page, 12.2);
      expect(frames).toHaveLength(1);
      frames.shift()(0);
      expect(frames).toHaveLength(1);
      frames.shift()(16);

      await expect(pending).resolves.toBeGreaterThanOrEqual(0);
      expect(waitOptions).toEqual({
        argument: undefined,
        options: { polling: 'raf', timeout: 13 },
      });
      expect(documentReads).toBe(0);
      expect(predicateSource).not.toMatch(/document|setAttribute|removeAttribute/u);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('never navigates the browser when the dev process exits during Node readiness polling', async () => {
    let exited = false;
    let navigations = 0;
    await expect(
      waitForReadyPage(
        {
          origin: 'http://localhost:49120',
          page: {
            goto: async () => {
              navigations += 1;
              return null;
            },
          },
          ready: { attribute: 'data-ready', expected: 'ready', path: '/', selector: 'main' },
          session: { exited: () => exited, logTail: () => 'exited' },
          timeoutMs: 1_000,
        },
        {
          delay: async () => undefined,
          requestReadyRoute: async () => {
            exited = true;
            throw new Error('connect ECONNREFUSED');
          },
        },
      ),
    ).rejects.toThrow('dev process exited before ready: exited');
    expect(navigations).toBe(0);
  });

  it('bounds Node response bodies with an absolute readiness deadline even when they trickle', async () => {
    const intervals = new Set();
    const server = createHttpServer((_request, response) => {
      response.writeHead(200, { 'content-length': '100000', 'content-type': 'text/plain' });
      const interval = setInterval(() => response.write('x'), 5);
      intervals.add(interval);
      response.once('close', () => {
        clearInterval(interval);
        intervals.delete(interval);
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('missing test server port');
    let navigations = 0;
    const startedAt = Date.now();
    try {
      await expect(
        waitForReadyPage({
          origin: `http://127.0.0.1:${String(address.port)}`,
          page: {
            goto: async () => {
              navigations += 1;
              return null;
            },
          },
          ready: { attribute: 'data-ready', expected: 'ready', path: '/', selector: 'main' },
          session: { exited: () => false, logTail: () => '' },
          timeoutMs: 75,
        }),
      ).rejects.toThrow('dev ready route probe timed out');
    } finally {
      for (const interval of intervals) clearInterval(interval);
      await new Promise((resolve) => server.close(resolve));
    }
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(navigations).toBe(0);
  });

  it.each(['selector', 'paint'])(
    'rejects a fake-clock deadline crossing during %s',
    async (stage) => {
      let clock = 0;
      let paintCalls = 0;
      let selectorTimeoutMs = null;
      let paintTimeoutMs = null;
      await expect(
        waitForReadyPage(
          {
            origin: 'http://localhost:49120',
            page: {
              goto: async () => {
                clock = 20;
                return { status: () => 200 };
              },
              locator: () => ({
                first: () => ({
                  getAttribute: async (_attribute, options) => {
                    selectorTimeoutMs = options.timeout;
                    if (stage === 'selector') clock = 100;
                    return 'ready';
                  },
                }),
              }),
            },
            ready: { attribute: 'data-ready', expected: 'ready', path: '/', selector: 'main' },
            session: { exited: () => false, logTail: () => '' },
            timeoutMs: 100,
          },
          {
            delay: async () => undefined,
            now: () => clock,
            requestReadyRoute: async () => ({ status: 200 }),
            waitForPaint: async (_page, timeoutMs) => {
              paintCalls += 1;
              paintTimeoutMs = timeoutMs;
              clock = 100;
              return 1;
            },
          },
        ),
      ).rejects.toThrow('dev ready timed out: dev ready shared deadline expired');

      expect(selectorTimeoutMs).toBe(80);
      expect(paintCalls).toBe(stage === 'paint' ? 1 : 0);
      if (stage === 'paint') expect(paintTimeoutMs).toBe(80);
    },
  );

  it('snapshots fresh-ready duration before delayed RSS shutdown work', async () => {
    let clock = 0;
    let lifecycleStops = 0;
    const observation = await measureFreshReady(
      freshReadyMeasurementOptions({
        beforeNewContext: async () => {
          clock = 40;
        },
        closeContext: async () => undefined,
      }),
      {
        createRssSampler: () => ({
          stop: async () => {
            clock = 900;
            return { peakRssBytes: 1_024, sampleCount: 2 };
          },
        }),
        now: () => clock,
        startDevSession: () => {
          clock = 20;
          return {
            pid: 123,
            stop: async () => {
              lifecycleStops += 1;
              return completeLifecycleFixture();
            },
          };
        },
        waitForReadyPage: async ({ deadlineMs }) => {
          expect(clock).toBe(40);
          expect(deadlineMs).toBe(1_000);
          clock = 125;
          return { paintFenceMs: 2, readinessProbe: completeReadinessProbe() };
        },
      },
    );

    expect(observation).toMatchObject({
      browserContextClosed: true,
      durationMs: 125,
      failureStage: 'none',
      success: true,
    });
    expect(lifecycleStops).toBe(1);
  });

  it('captures a one-shot diagnostic at the browser-ready fence before process teardown', async () => {
    const events = [];
    const readyDiagnostic = {
      async abort() {
        events.push('diagnostic-abort-noop');
      },
      async captureAtReady() {
        events.push('diagnostic-capture');
        return { diagnosticOnly: { acceptanceEligible: false }, schema: 'ready-profile-test/v1' };
      },
    };
    const observation = await measureFreshReady(
      freshReadyMeasurementOptions({ closeContext: async () => events.push('context-close') }),
      {
        createRssSampler: () => ({
          stop: async () => {
            events.push('rss-stop');
            return { peakRssBytes: 1_024, sampleCount: 2 };
          },
        }),
        now: () => 10,
        readyDiagnostic,
        startDevSession: () => ({
          pid: 123,
          stop: async () => {
            events.push('session-stop');
            return completeLifecycleFixture();
          },
        }),
        waitForReadyPage: async () => {
          events.push('browser-ready');
          return { paintFenceMs: 2, readinessProbe: completeReadinessProbe() };
        },
      },
    );

    expect(observation.readyDiagnostic).toEqual({
      diagnosticOnly: { acceptanceEligible: false },
      schema: 'ready-profile-test/v1',
    });
    expect(events.indexOf('browser-ready')).toBeLessThan(events.indexOf('diagnostic-capture'));
    expect(events.indexOf('diagnostic-capture')).toBeLessThan(events.indexOf('session-stop'));
    expect(events).toContain('diagnostic-abort-noop');
  });

  it('attributes browser setup, telemetry, and ready-wait failures to finite framework stages', async () => {
    const cases = [
      {
        options: {
          beforeNewContext: async () => {
            throw new Error('private browser context failure');
          },
        },
        stage: 'browser-context',
      },
      {
        options: {
          closeContext: async () => undefined,
          newPage: async () => {
            throw new Error('private browser page failure');
          },
        },
        stage: 'browser-page',
      },
      {
        options: {
          closeContext: async () => undefined,
          page: {
            on() {
              throw new Error('private telemetry failure');
            },
          },
        },
        stage: 'telemetry',
      },
      {
        dependencies: {
          waitForReadyPage: async () => {
            throw new Error('private ready failure');
          },
        },
        options: { closeContext: async () => undefined },
        stage: 'ready-wait',
      },
    ];

    for (const testCase of cases) {
      const observation = await measureFreshReady(
        freshReadyMeasurementOptions(testCase.options),
        freshReadyMeasurementDependencies(testCase.dependencies),
      );
      expect(observation).toMatchObject({
        browserContextClosed: true,
        failureStage: testCase.stage,
        lifecycle: { complete: true },
        success: false,
      });
    }

    const unreadableFailure = new Proxy(Object.create(null), {
      get() {
        throw new Error('proxy getter must not run');
      },
      getPrototypeOf() {
        throw new Error('proxy prototype trap must not escape');
      },
    });
    const unreadable = await measureFreshReady(
      freshReadyMeasurementOptions({
        beforeNewContext: async () => {
          throw unreadableFailure;
        },
      }),
      freshReadyMeasurementDependencies(),
    );
    expect(unreadable).toMatchObject({
      error: 'unreadable fresh-ready failure',
      failureStage: 'browser-context',
      success: false,
    });
  });

  it('preserves concurrent evidence capture while distinguishing RSS and profiler failures', async () => {
    for (const failedCapture of ['rss', 'profiler']) {
      const events = [];
      const observation = await measureFreshReady(
        freshReadyMeasurementOptions({ closeContext: async () => undefined }),
        freshReadyMeasurementDependencies({
          createRssSampler: () => ({
            stop: async () => {
              events.push('rss');
              if (failedCapture === 'rss') throw new Error('private RSS capture failure');
              return { peakRssBytes: 1_024, sampleCount: 2 };
            },
          }),
          readyDiagnostic: {
            abort: async () => undefined,
            captureAtReady: async () => {
              events.push('profiler');
              if (failedCapture === 'profiler') {
                throw new Error('private profiler capture failure');
              }
              return { schema: 'ready-profile-test/v1' };
            },
          },
        }),
      );

      expect(events).toEqual(['rss', 'profiler']);
      expect(observation).toMatchObject({
        failureStage: `evidence-capture-${failedCapture}`,
        success: false,
      });
    }
  });

  it('attributes profiler-abort and lifecycle append failures without replacing prior stages', async () => {
    const aborted = await measureFreshReady(
      freshReadyMeasurementOptions({ closeContext: async () => undefined }),
      freshReadyMeasurementDependencies({
        readyDiagnostic: {
          abort: async () => {
            throw new Error('private abort failure');
          },
          captureAtReady: async () => ({ schema: 'ready-profile-test/v1' }),
        },
      }),
    );
    expect(aborted).toMatchObject({
      failureStage: 'cleanup-profiler-abort',
      success: false,
    });

    const lifecycle = await measureFreshReady(
      freshReadyMeasurementOptions({ closeContext: async () => undefined }),
      freshReadyMeasurementDependencies({
        startDevSession: () => ({
          pid: 123,
          stop: async () => ({
            ...completeLifecycleFixture(),
            complete: false,
            error: 'private lifecycle failure',
          }),
        }),
      }),
    );
    expect(lifecycle).toMatchObject({
      failureStage: 'cleanup-lifecycle',
      success: false,
    });

    const readyThenCleanup = await measureFreshReady(
      freshReadyMeasurementOptions({
        closeContext: async () => {
          throw new Error('private cleanup failure');
        },
      }),
      freshReadyMeasurementDependencies({
        waitForReadyPage: async () => {
          throw new Error('private ready failure');
        },
      }),
    );
    expect(readyThenCleanup).toMatchObject({
      failureStage: 'ready-wait',
      success: false,
    });
  });

  it('fails the observation and stops later starts when browser-context teardown rejects', async () => {
    let lifecycleStops = 0;
    const observation = await measureFreshReady(
      freshReadyMeasurementOptions({
        closeContext: async () => {
          throw new Error('context still busy');
        },
      }),
      {
        createRssSampler: () => ({
          stop: async () => ({ peakRssBytes: 1_024, sampleCount: 2 }),
        }),
        now: () => 10,
        startDevSession: () => ({
          pid: 123,
          stop: async () => {
            lifecycleStops += 1;
            return completeLifecycleFixture();
          },
        }),
        waitForReadyPage: async () => ({
          paintFenceMs: 2,
          readinessProbe: completeReadinessProbe(),
        }),
      },
    );

    expect(observation).toMatchObject({
      browserContextClosed: false,
      error: expect.stringContaining('browser context close: context still busy'),
      failureStage: 'cleanup-browser-context',
      lifecycle: { complete: true },
      success: false,
    });
    expect(lifecycleStops).toBe(1);
    expect(freshReadySeriesCanContinue(observation)).toBe(false);
  });

  it('retains a request failure emitted while a successful browser context closes', async () => {
    const page = new FakePage();
    const observation = await measureFreshReady(
      freshReadyMeasurementOptions({
        closeContext: async () => {
          page.emit(
            'requestfailed',
            requestEvidence({ failure: 'net::ERR_ABORTED', url: 'http://localhost:49120/late.js' }),
          );
        },
        page,
      }),
      {
        createRssSampler: () => ({
          stop: async () => ({ peakRssBytes: 1_024, sampleCount: 2 }),
        }),
        now: () => 10,
        startDevSession: () => ({ pid: 123, stop: async () => completeLifecycleFixture() }),
        waitForReadyPage: async () => ({
          paintFenceMs: 2,
          readinessProbe: completeReadinessProbe(),
        }),
      },
    );

    expect(observation).toMatchObject({
      browser: { requestFailedCount: 1, unexpectedErrorCount: 1 },
      browserContextClosed: true,
      error: expect.stringContaining('browser telemetry recorded 1 request failures'),
      failureStage: 'telemetry',
      success: false,
    });
    const integrity = {
      browser: observation.browser,
      corpus: { afterVerified: true, beforeVerified: true },
      errors: [],
      misses: 0,
      source: { stable: true },
    };
    expect(devLoopIntegrityComplete(integrity)).toBe(false);
    expect(devLoopVerdictStatus(devLoopIntegrityComplete(integrity), false)).toBe('unproven');
  });

  it('fails closed on browser errors outside one exact intentional compiler console', () => {
    const page = new FakePage();
    const telemetry = collectPageTelemetry(page, 'http://localhost:49120', {
      framework: 'nextjs',
      intentionalSyntaxErrorFile: 'src/components/component-000.tsx',
    });
    page.emit('console', { text: () => 'startup runtime error', type: () => 'error' });
    page.emit('pageerror', new Error('startup page error'));
    page.emit('response', responseEvidence({ status: 500, url: 'http://localhost:49120/' }));
    page.emit(
      'requestfailed',
      requestEvidence({
        failure: 'net::ERR_CONNECTION_REFUSED',
        resourceType: 'script',
        url: 'https://cdn.example.invalid/startup.js',
      }),
    );
    page.emit(
      'response',
      responseEvidence({ status: 404, url: 'http://localhost:49120/favicon.ico' }),
    );
    telemetry.markReady();
    telemetry.setPhase('syntaxError');
    telemetry.setIntentionalSyntaxError(true);
    page.emit('console', {
      text: () =>
        './src/components/component-000.tsx\nParsing ecmascript source code failed\nExpected expression',
      type: () => 'error',
    });
    page.emit('console', {
      text: () => './src/components/component-001.tsx\nModule parse failed: Unexpected token',
      type: () => 'error',
    });
    page.emit('console', {
      text: () => './src/components/component-000.tsx runtime invariant failed',
      type: () => 'error',
    });
    page.emit(
      'requestfailed',
      requestEvidence({ failure: 'net::ERR_ABORTED', url: 'http://localhost:49120/' }),
    );
    page.emit('pageerror', new Error('expected parser diagnostic'));
    page.emit('response', responseEvidence({ status: 500, url: 'http://localhost:49120/' }));
    telemetry.setPhase('recovery');
    page.emit('console', {
      text: () => './src/components/component-000.tsx\nModule parse failed: Unexpected token',
      type: () => 'error',
    });

    expect(telemetry.snapshot()).toMatchObject({
      expectedErrors: [
        expect.objectContaining({
          classification: 'browser-incidental',
          kind: 'response',
          status: 404,
        }),
        expect.objectContaining({
          classification: 'intentional-syntax-error',
          kind: 'console',
          phase: 'syntaxError',
        }),
        expect.objectContaining({
          classification: 'intentional-syntax-error',
          kind: 'console',
          phase: 'recovery',
        }),
      ],
      expectedErrorCount: 3,
      requestFailedCount: 2,
      responseCount: 3,
      responseStatusCounts: { 404: 1, 500: 2 },
      unexpectedErrorCount: 9,
      unexpectedErrors: expect.arrayContaining([
        expect.objectContaining({ kind: 'console', message: 'startup runtime error' }),
        expect.objectContaining({ kind: 'pageerror', message: 'startup page error' }),
        expect.objectContaining({ kind: 'response', phase: 'ready', status: 500 }),
        expect.objectContaining({ kind: 'requestfailed', resourceType: 'script' }),
        expect.objectContaining({
          kind: 'console',
          message: expect.stringContaining('component-001.tsx'),
        }),
        expect.objectContaining({ kind: 'requestfailed', phase: 'syntaxError' }),
        expect.objectContaining({ kind: 'pageerror', phase: 'syntaxError' }),
        expect.objectContaining({ kind: 'response', phase: 'syntaxError', status: 500 }),
      ]),
    });
  });

  it('does not exempt the same compiler console for Kovo', () => {
    const page = new FakePage();
    const telemetry = collectPageTelemetry(page, 'http://localhost:49120', {
      framework: 'kovo',
      intentionalSyntaxErrorFile: 'src/components/component-000.tsx',
    });
    telemetry.setPhase('syntaxError');
    telemetry.setIntentionalSyntaxError(true);
    page.emit('console', {
      text: () =>
        './src/components/component-000.tsx\nParsing ecmascript source code failed\nExpected expression',
      type: () => 'error',
    });

    expect(telemetry.snapshot()).toMatchObject({
      expectedErrorCount: 0,
      unexpectedErrorCount: 1,
      unexpectedErrors: [expect.objectContaining({ kind: 'console', phase: 'syntaxError' })],
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
      editSession: {
        pid: 9_001,
        processMarkerSha256: `sha256:${'c'.repeat(64)}`,
      },
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
          workload: {
            inspectorProcess: {
              pid: 9_001,
              processMarkerSha256: `sha256:${'c'.repeat(64)}`,
            },
          },
        },
      },
    };
    expect(diagnosticProfileFindings(report, true)).toEqual([]);
    report.profile.diagnostic.windows[0].artifact.cpu.sha256 = 'forged';
    report.profile.diagnostic.windows[1].editClass = 'leaf';
    report.profile.diagnostic.workload.inspectorProcess.pid = 9_002;
    expect(diagnosticProfileFindings(report, true)).toEqual(
      expect.arrayContaining([
        'diagnostic Inspector target is not bound to the edit-session process',
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
    editSession: {
      browserContextClosed: true,
      lifecycle: completeLifecycleFixture(49_121),
      readinessProbe: completeReadinessProbe(),
    },
    integrity: {
      command: { origin: 'http://localhost:49120' },
      editCounts: {},
      handoffs: [completeHandoffFixture(49_120, 0, 1), completeHandoffFixture(49_121, 1, 1)],
      inspectorPort: null,
      iterations: 2,
      portAllocation: completePortAllocationFixture(49_120, [49_120, 49_121]),
      readyIterations: 1,
    },
    readySamples: [
      {
        durationMs: 10,
        browserContextClosed: true,
        iteration: 0,
        lifecycle: completeLifecycleFixture(49_120),
        peakRssBytes: 1,
        readinessProbe: completeReadinessProbe(),
        success: true,
      },
    ],
    samples,
  };
}

function completeReadinessProbe() {
  return { attempts: 2, path: '/', status: 200, transientFailures: 1 };
}

function completeLifecycleFixture(port = 49_120) {
  return {
    complete: true,
    origin: `http://localhost:${String(port)}`,
    schema: DEV_SESSION_STOP_SCHEMA,
    socketEvidence: null,
  };
}

function completePortAllocationFixture(basePort, ports, inspectorPorts = []) {
  return {
    basePort,
    complete: true,
    errors: [],
    hostEphemeral: {
      complete: true,
      error: null,
      platform: 'linux',
      probe: {
        bytes: 12,
        contentBase64: 'NjAwMDAgNjU1MzUK',
        kind: 'procfs',
        locator: '/proc/sys/net/ipv4/ip_local_port_range',
        sha256: 'sha256:d57b94cd21854bf7ea2ebac4e57725b65b83a11ca7fab9ea7d1701cb6e73e5bf',
      },
      ranges: [{ label: 'default', maximum: 65_535, minimum: 60_000 }],
      schema: 'kovo-host-ephemeral-port-ranges/v1',
      scope: 'tcp-loopback-v4-v6/v1',
    },
    inspectorPorts,
    overlaps: [],
    ports,
    posture: 'unique-exact-port-outside-host-ephemeral/v2',
    schema: 'kovo-dev-port-allocation/v1',
  };
}

function freshReadyMeasurementOptions({
  beforeNewContext = async () => undefined,
  closeContext,
  newPage,
  page = new FakePage(),
}) {
  return {
    appRoot: '/tmp/kovo-fresh-ready-fixture',
    browser: {
      newContext: async () => {
        await beforeNewContext();
        return {
          close: closeContext,
          newPage: newPage ?? (async () => page),
        };
      },
    },
    command: { origin: 'http://localhost:49120' },
    iteration: 0,
    manifest: {
      framework: 'kovo',
      dev: {
        edits: { syntaxError: { file: 'src/components/component-000.tsx' } },
        ready: { attribute: 'data-ready', expected: 'ready', path: '/', selector: 'main' },
      },
    },
    readyTimeoutMs: 1_000,
    spawnProcess: () => undefined,
  };
}

function freshReadyMeasurementDependencies(overrides = {}) {
  return {
    createRssSampler: () => ({
      stop: async () => ({ peakRssBytes: 1_024, sampleCount: 2 }),
    }),
    now: () => 10,
    startDevSession: () => ({ pid: 123, stop: async () => completeLifecycleFixture() }),
    waitForReadyPage: async () => ({
      paintFenceMs: 2,
      readinessProbe: completeReadinessProbe(),
    }),
    ...overrides,
  };
}

function completeHandoffFixture(port, index, readyIterations) {
  return {
    attribution: {
      from: index === 0 ? null : `ready[${String(index - 1)}]`,
      priorMarkerSha256: index === 0 ? null : `sha256:${'a'.repeat(64)}`,
      to: index === readyIterations ? 'edit-session' : `ready[${String(index)}]`,
    },
    available: true,
    check: {
      addresses: [
        {
          address: '127.0.0.1',
          available: true,
          errorCode: null,
          family: 4,
          supported: true,
        },
      ],
      checkedAt: '2026-08-13T00:00:00.000Z',
      durationMs: 1,
      probeError: null,
      sequence: 1,
    },
    complete: true,
    error: null,
    inspector: null,
    origin: `http://localhost:${String(port)}`,
    schema: 'kovo-dev-session-handoff/v2',
    socketEvidence: null,
  };
}

function handoffLaunchOptions({
  inspectorPort = null,
  origin,
  priorProcessMarker = null,
  priorSession = null,
  spawnProcess = vi.fn(),
  targetSession,
}) {
  return {
    appRoot: '/tmp/kovo-handoff-test',
    command: { argv: ['dev'], cwd: '/tmp/kovo-handoff-test', env: {}, origin },
    inspectorPort,
    priorProcessMarker,
    priorSession,
    spawnProcess,
    targetSession,
  };
}

function socketOwnerEvidenceFixture({
  busyAddresses = [{ address: '::1', errorCode: 'EADDRINUSE', family: 6 }],
  origin = 'http://localhost:49120',
} = {}) {
  return {
    busyAddresses,
    census: { fdLinksInspected: 1, processesInspected: 1, socketRecords: 1 },
    complete: true,
    limitations: [],
    origin,
    platform: 'linux',
    schema: DEV_SOCKET_OWNER_EVIDENCE_SCHEMA,
    sockets: [
      {
        family: 6,
        inode: '424242',
        localAddressHex: '00000000000000000000000001000000',
        localPort: Number(new URL(origin).port),
        owners: [{ command: 'node', pid: 8_100, priorSessionMarkerMatched: true }],
        state: 'LISTEN',
        stateCode: '0A',
        uid: 501,
      },
    ],
  };
}

function monotonicTestClock() {
  let value = 0;
  return () => value++;
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

async function emptyMarkedProcessCensus() {
  return { observed: [], signaled: [] };
}

function markedProcess(pid) {
  return { pgid: pid + 1, pid, ppid: 1, state: 'S' };
}

function statePreservingPage() {
  return {
    locator: () => ({ first: () => ({ textContent: async () => 'Count 1' }) }),
  };
}

function successfulEditObservation(editClass, iteration) {
  return {
    durationMs: 1,
    editClass,
    error: null,
    iteration,
    paintFenceMs: 1,
    serverGenerationMs: 1,
    stateSurvived: true,
    success: true,
    writeMs: 1,
  };
}

function failedEditObservationForTest(editClass, iteration) {
  return {
    durationMs: null,
    editClass,
    error: 'expected test failure',
    iteration,
    paintFenceMs: null,
    serverGenerationMs: null,
    stateSurvived: false,
    success: false,
    writeMs: 1,
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

function requestEvidence({ failure = null, resourceType = 'document', status = 200, url }) {
  return {
    failure: () => (failure === null ? null : { errorText: failure }),
    method: () => 'GET',
    resourceType: () => resourceType,
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
