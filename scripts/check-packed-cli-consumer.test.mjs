import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  assertPackedApiV1Result,
  assertPackedCliDependencyClosure,
  assertPackedComponentCatalogJourney,
  assertPackedCliProcessContract,
  assertPackedDocsJourney,
  assertPackedMcpLifecycle,
  assertPackedSemanticApiBoundary,
  preparePackedDevJourney,
  productionDependencyNamesFromLockfile,
  sourceImportsPackage,
} from './check-packed-cli-consumer.mjs';
import {
  createKovoDevReadyReportObserver,
  DEV_READY_LISTENER_INFRASTRUCTURE_TIMEOUT_MS,
  DEV_READY_POST_BIND_BUDGET_MS,
  isKovoDevReadyReportTimeout,
  parseKovoDevReadyReport,
  reserveKovoDevLoopbackPort,
  waitForKovoDevReadiness,
} from './lib/dev-ready-probe-contract.mjs';

function lockfile(...packages) {
  return `lockfileVersion: '9.0'

snapshots:
${packages.map((name) => `  '${name}@1.0.0': {}`).join('\n')}
`;
}

function readyReportFixture(port, host = '127.0.0.1') {
  const localUrl = `http://${host}:${port}/`;
  const expected = {
    appEntry: 'src/app.ts',
    database: 'none configured',
    localUrl,
    mode: 'development',
  };
  return {
    expected,
    report: [
      'Kovo dev ready in 12ms',
      `  Local URL    ${localUrl}`,
      `  Network URL  ${localUrl} (loopback only)`,
      '  Mode         development',
      '  App          src/app.ts',
      '  Database     none configured',
      `  Devtool      ${localUrl}__kovo`,
      '',
    ].join('\n'),
  };
}

function observeFixtureStdout(expected, monotonicNow) {
  const stream = new PassThrough();
  let stdout = '';
  const reportObserver = createKovoDevReadyReportObserver(
    stream,
    expected,
    monotonicNow === undefined ? {} : { monotonicNow },
  );
  stream.on('data', (chunk) => {
    stdout += String(chunk);
  });
  return {
    output: () => ({ stderr: '', stdout }),
    reportObserver,
    stream,
  };
}

async function listenOn(server, host, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host, port }, resolve);
  });
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('packed CLI consumer proof', () => {
  it('keeps listener infrastructure and post-bind reporting separate from G2', () => {
    const budgets = JSON.parse(
      readFileSync(new URL('../devex-budgets.json', import.meta.url), 'utf8'),
    );
    const source = readFileSync(
      new URL('./check-packed-cli-consumer.mjs', import.meta.url),
      'utf8',
    );
    expect(DEV_READY_LISTENER_INFRASTRUCTURE_TIMEOUT_MS).toBe(120_000);
    expect(DEV_READY_POST_BIND_BUDGET_MS).toBe(5_000);
    expect(budgets.metrics['dev.ready.cold.durationMs'].provisionalTarget).toBe(15_000);
    expect(source).toContain('const port = await reserveKovoDevLoopbackPort()');
    expect(source).toContain('waitForKovoDevReadiness({');
    expect(source).not.toContain('waitForKovoDevTcpListener({');
    expect(source).not.toContain('waitForKovoDevReadyReport({');
    expect(source).not.toContain('PACKED_DEV_READY_HARNESS_TIMEOUT_MS');
  });

  it('accepts only a complete structured ready report and fails fast on child exit', async () => {
    const { expected, report } = readyReportFixture(4173);

    expect(parseKovoDevReadyReport(report, expected)).toEqual({
      appEntry: 'src/app.ts',
      database: 'none configured',
      durationMs: 12,
      localUrl: 'http://127.0.0.1:4173/',
    });
    expect(parseKovoDevReadyReport(report.replace(/  Devtool.*\n/u, ''), expected)).toBeNull();
    const observed = observeFixtureStdout(expected);
    observed.stream.write(report.slice(0, 40));
    await expect(
      waitForKovoDevReadiness({
        expected,
        label: 'Fixture kovo dev',
        listenerTimeoutMs: 50,
        port: 4173,
        readOutput: () => ({ ...observed.output(), stderr: 'activation failed' }),
        readStatus: () => ({ exitCode: 2, signalCode: null }),
        reportObserver: observed.reportObserver,
      }),
    ).rejects.toThrow(
      /exited before (?:TCP listener|structured ready report) \(exit=2, signal=null/u,
    );
  });

  it('requires the authenticated report URL to match the selected strict listener', async () => {
    const selectedPort = await reserveKovoDevLoopbackPort();
    const otherPort = selectedPort === 65_535 ? selectedPort - 1 : selectedPort + 1;
    const { expected } = readyReportFixture(otherPort);
    const observed = observeFixtureStdout(expected);
    const baseline = observed.stream.listenerCount('data') - 1;
    await expect(
      waitForKovoDevReadiness({
        expected,
        label: 'Mismatched strict-port fixture',
        listenerTimeoutMs: 50,
        port: selectedPort,
        readOutput: observed.output,
        readStatus: () => ({ exitCode: null, signalCode: null }),
        reportObserver: observed.reportObserver,
        reportTimeoutMs: 50,
      }),
    ).rejects.toThrow(/must target selected strict listener/u);
    expect(observed.stream.listenerCount('data')).toBe(baseline);
  });

  it('interval-censors a strict-port report completed between final refusal and immediate success', async () => {
    const host = '127.0.0.1';
    const port = await reserveKovoDevLoopbackPort(host);
    const { expected, report } = readyReportFixture(port, host);
    const observed = observeFixtureStdout(expected);
    const server = createServer();
    let resolveRefusal;
    const refusal = new Promise((resolve) => {
      resolveRefusal = resolve;
    });

    try {
      const readiness = waitForKovoDevReadiness({
        expected,
        host,
        label: 'Between-refusal-and-bind fixture kovo dev',
        listenerTimeoutMs: 500,
        onTcpObservation: ({ connected }) => {
          if (!connected) resolveRefusal();
        },
        port,
        readOutput: observed.output,
        readStatus: () => ({ exitCode: null, signalCode: null }),
        reportObserver: observed.reportObserver,
        reportTimeoutMs: 100,
      });
      await refusal;
      const reportDeliveredAt = performance.now();
      observed.stream.write(report);
      server.listen({ host, port });
      const bindRequestedAt = performance.now();
      expect(bindRequestedAt - reportDeliveredAt).toBeLessThan(25);
      await expect(readiness).resolves.toMatchObject({
        observedAfterMs: 0,
        observedAfterMsKind: 'interval-censored',
        observedAfterMsUpperBound: expect.any(Number),
      });
    } finally {
      await closeServer(server);
    }
  });

  it('rejects an arbitrary report when its immediate connection still refuses', async () => {
    const host = '127.0.0.1';
    const port = await reserveKovoDevLoopbackPort(host);
    const { expected, report } = readyReportFixture(port, host);
    const observed = observeFixtureStdout(expected);
    const server = createServer();
    let resolveRefusal;
    const refusal = new Promise((resolve) => {
      resolveRefusal = resolve;
    });

    try {
      const readiness = waitForKovoDevReadiness({
        expected,
        host,
        label: 'Forged report fixture kovo dev',
        listenerTimeoutMs: 500,
        onTcpObservation: ({ connected }) => {
          if (!connected) resolveRefusal();
        },
        port,
        readOutput: observed.output,
        readStatus: () => ({ exitCode: null, signalCode: null }),
        reportObserver: observed.reportObserver,
        reportTimeoutMs: 100,
      });
      await refusal;
      observed.stream.write(report);
      await expect(readiness).rejects.toThrow(/ready-before-bind/u);
      await listenOn(server, host, port);
    } finally {
      await closeServer(server);
    }
  });

  it('rejects delayed inspection of a prebuffered report even when the port now listens', async () => {
    const host = '127.0.0.1';
    const port = await reserveKovoDevLoopbackPort(host);
    const { expected, report } = readyReportFixture(port, host);
    const observed = observeFixtureStdout(expected);
    const server = createServer();

    try {
      observed.stream.write(report);
      await listenOn(server, host, port);
      await expect(
        waitForKovoDevReadiness({
          expected,
          host,
          label: 'Prebuffered fixture kovo dev',
          listenerTimeoutMs: 500,
          port,
          readOutput: observed.output,
          readStatus: () => ({ exitCode: null, signalCode: null }),
          reportObserver: observed.reportObserver,
          reportTimeoutMs: 100,
        }),
      ).rejects.toThrow(/ready-before-bind/u);
    } finally {
      await closeServer(server);
    }
  });

  it('accepts a connect-first report split across delivered stdout chunks', async () => {
    const host = '127.0.0.1';
    const port = await reserveKovoDevLoopbackPort(host);
    const { expected, report } = readyReportFixture(port, host);
    const observed = observeFixtureStdout(expected);
    const server = createServer();
    server.on('connection', (socket) => socket.destroy());
    let resolveConnected;
    const connected = new Promise((resolve) => {
      resolveConnected = resolve;
    });

    try {
      await listenOn(server, host, port);
      const readiness = waitForKovoDevReadiness({
        expected,
        host,
        label: 'Split-report fixture kovo dev',
        listenerTimeoutMs: 500,
        onTcpObservation: (observation) => {
          if (observation.connected) resolveConnected();
        },
        port,
        readOutput: observed.output,
        readStatus: () => ({ exitCode: null, signalCode: null }),
        reportObserver: observed.reportObserver,
        reportTimeoutMs: 100,
      });
      await connected;
      const finalLine = report.lastIndexOf('  Devtool');
      observed.stream.write(report.slice(0, finalLine));
      expect(observed.reportObserver.current()).toBeNull();
      observed.stream.write(report.slice(finalLine));
      await expect(readiness).resolves.toMatchObject({
        localUrl: expected.localUrl,
        observedAfterMs: expect.any(Number),
        observedAfterMsKind: 'exact',
      });
    } finally {
      await closeServer(server);
    }
  });

  it('uses callback order when connect and report timestamps are identical', async () => {
    const host = '127.0.0.1';
    const fixedNow = () => 100;

    const reportFirstPort = await reserveKovoDevLoopbackPort(host);
    const reportFirstFixture = readyReportFixture(reportFirstPort, host);
    const reportFirst = observeFixtureStdout(reportFirstFixture.expected, fixedNow);
    const reportFirstServer = createServer();
    try {
      reportFirst.stream.write(reportFirstFixture.report);
      await listenOn(reportFirstServer, host, reportFirstPort);
      await expect(
        waitForKovoDevReadiness({
          expected: reportFirstFixture.expected,
          host,
          label: 'Equal-clock report-first fixture',
          listenerTimeoutMs: 500,
          monotonicNow: fixedNow,
          port: reportFirstPort,
          readOutput: reportFirst.output,
          readStatus: () => ({ exitCode: null, signalCode: null }),
          reportObserver: reportFirst.reportObserver,
          reportTimeoutMs: 100,
          startedAt: 100,
        }),
      ).rejects.toThrow(/ready-before-bind/u);
    } finally {
      await closeServer(reportFirstServer);
    }

    const connectFirstPort = await reserveKovoDevLoopbackPort(host);
    const connectFirstFixture = readyReportFixture(connectFirstPort, host);
    const connectFirst = observeFixtureStdout(connectFirstFixture.expected, fixedNow);
    const connectFirstServer = createServer();
    let resolveConnected;
    const connected = new Promise((resolve) => {
      resolveConnected = resolve;
    });
    try {
      await listenOn(connectFirstServer, host, connectFirstPort);
      const readiness = waitForKovoDevReadiness({
        expected: connectFirstFixture.expected,
        host,
        label: 'Equal-clock connect-first fixture',
        listenerTimeoutMs: 500,
        monotonicNow: fixedNow,
        onTcpObservation: (observation) => {
          if (observation.connected) resolveConnected();
        },
        port: connectFirstPort,
        readOutput: connectFirst.output,
        readStatus: () => ({ exitCode: null, signalCode: null }),
        reportObserver: connectFirst.reportObserver,
        reportTimeoutMs: 100,
        startedAt: 100,
      });
      await connected;
      connectFirst.stream.write(connectFirstFixture.report);
      await expect(readiness).resolves.toMatchObject({
        observedAfterMs: 0,
        observedAfterMsKind: 'exact',
      });
    } finally {
      await closeServer(connectFirstServer);
    }
  });

  it('removes stdout observers after listener and report timeouts', async () => {
    const host = '127.0.0.1';
    const listenerPort = await reserveKovoDevLoopbackPort(host);
    const listenerFixture = readyReportFixture(listenerPort, host);
    const listenerObserved = observeFixtureStdout(listenerFixture.expected);
    const listenerBaseline = listenerObserved.stream.listenerCount('data') - 1;
    await expect(
      waitForKovoDevReadiness({
        expected: listenerFixture.expected,
        host,
        label: 'Listener-timeout fixture',
        listenerTimeoutMs: 30,
        port: listenerPort,
        readOutput: listenerObserved.output,
        readStatus: () => ({ exitCode: null, signalCode: null }),
        reportObserver: listenerObserved.reportObserver,
        reportTimeoutMs: 30,
      }),
    ).rejects.toThrow(/did not acquire TCP listener/u);
    expect(listenerObserved.stream.listenerCount('data')).toBe(listenerBaseline);

    const reportPort = await reserveKovoDevLoopbackPort(host);
    const reportFixture = readyReportFixture(reportPort, host);
    const reportObserved = observeFixtureStdout(reportFixture.expected);
    const reportBaseline = reportObserved.stream.listenerCount('data') - 1;
    const server = createServer();
    server.on('connection', (socket) => socket.destroy());
    try {
      await listenOn(server, host, reportPort);
      let timeoutError;
      try {
        await waitForKovoDevReadiness({
          expected: reportFixture.expected,
          host,
          label: 'Report-timeout fixture',
          listenerTimeoutMs: 500,
          port: reportPort,
          readOutput: reportObserved.output,
          readStatus: () => ({ exitCode: null, signalCode: null }),
          reportObserver: reportObserved.reportObserver,
          reportTimeoutMs: 30,
        });
      } catch (error) {
        timeoutError = error;
      }
      expect(isKovoDevReadyReportTimeout(timeoutError)).toBe(true);
      expect(timeoutError).toEqual(
        expect.objectContaining({
          message: expect.stringMatching(/within the 30ms post-bind budget/u),
        }),
      );
      expect(reportObserved.stream.listenerCount('data')).toBe(reportBaseline);
    } finally {
      await closeServer(server);
    }
  });

  it('binds its authored app fixture to one literal receiver identity', () => {
    const source = readFileSync(
      new URL('./check-packed-cli-consumer.mjs', import.meta.url),
      'utf8',
    );
    expect(source).toContain("defineKovo({ appId: '00000000-0000-4000-8000-000000000001' })");
    expect(source).not.toContain('defineKovo({})');
  });

  it('launches packed dev from a root isolated from cumulative consumer fixtures', () => {
    const consumerRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-packed-dev-root-'));
    try {
      mkdirSync(path.join(consumerRoot, 'src', 'components', 'ui'), { recursive: true });
      writeFileSync(
        path.join(consumerRoot, 'src', 'components', 'ui', 'catalog-marker.tsx'),
        'export const catalogMarker = true;\n',
        'utf8',
      );
      mkdirSync(path.join(consumerRoot, 'api-v1-rewrites'), { recursive: true });
      writeFileSync(
        path.join(consumerRoot, 'api-v1-rewrites', 'migration-marker.ts'),
        'export const migrationMarker = true;\n',
        'utf8',
      );

      const invocation = preparePackedDevJourney(consumerRoot, 4173);
      const rootFlag = invocation.args.indexOf('--root');
      expect(invocation.cwd).toBe(path.join(consumerRoot, 'packed-dev-smoke'));
      expect(invocation.args[0]).toBe(
        path.join(consumerRoot, 'node_modules', '@kovojs', 'cli', 'dist', 'bin.mjs'),
      );
      expect(invocation.args[rootFlag + 1]).toBe(invocation.cwd);
      expect(readFileSync(path.join(invocation.cwd, 'src', 'app.ts'), 'utf8')).toContain(
        "defineKovo({ appId: '00000000-0000-4000-8000-000000000001' })",
      );
      expect(readdirSync(invocation.cwd)).toEqual(['src']);
      expect(readdirSync(path.join(invocation.cwd, 'src'))).toEqual(['app.ts']);
      expect(existsSync(path.join(invocation.cwd, 'src', 'components', 'ui'))).toBe(false);
      expect(existsSync(path.join(invocation.cwd, 'api-v1-rewrites'))).toBe(false);

      const source = readFileSync(
        new URL('./check-packed-cli-consumer.mjs', import.meta.url),
        'utf8',
      );
      expect(source).toContain('preparePackedDevJourney(consumerRoot, port)');
      expect(source).toContain('cwd: invocation.cwd');
    } finally {
      rmSync(consumerRoot, { force: true, recursive: true });
    }
  });

  it('requires the exact cumulative api-v1 protocol and file-count summary', () => {
    const result = {
      batch: 'api-v1',
      files: [
        { batches: ['style-opaque-handles'], path: 'style.ts', state: 'rewritten' },
        { path: 'current.ts', state: 'unchanged' },
      ],
      migrationBatches: [
        'core-task-topology-v1',
        'style-opaque-handles',
        'ui-headless-icons-v1',
        'browser-client-installer-v1',
        'browser-authoring-v1',
        'browser-inline-optimism-v1',
        'server-task-topology-v1',
        'test-harness-v2',
        'drizzle-typed-annotations-v1',
        'better-auth-generated-assembly-v1',
      ],
      schema: 'kovo-api-migration-result/v1',
      summary: { refused: 0, rewritten: 1, unchanged: 1 },
    };
    expect(() =>
      assertPackedApiV1Result(result, { refused: 0, rewritten: 1, unchanged: 1 }),
    ).not.toThrow();
    expect(() =>
      assertPackedApiV1Result(
        { ...result, migrationBatches: result.migrationBatches.slice(1) },
        { refused: 0, rewritten: 1, unchanged: 1 },
      ),
    ).toThrow('drifted from the checked cumulative protocol');
    expect(() =>
      assertPackedApiV1Result(
        { ...result, summary: { refused: 0, rewritten: 2, unchanged: 0 } },
        { refused: 0, rewritten: 1, unchanged: 1 },
      ),
    ).toThrow('drifted from the checked cumulative protocol');
  });

  it('enforces informational, usage/config, and finding process contracts', () => {
    const result = (status, stdout = '', stderr = '') => ({
      error: undefined,
      signal: null,
      status,
      stderr,
      stdout,
    });
    const rootHelp = 'Kovo 0.2.0\n\nUsage:\n  kovo <command> [options]\n';
    const observations = {
      buildHelp: result(
        0,
        'kovo build — Prove and build\n\nUsage:\n  kovo build <app-module>\n\nExit codes: 0 success/help/version; 1 proof or build findings; 2 usage/config error\n',
      ),
      compileConfig: result(2, '', 'kovo: missing registry facts\n'),
      config: result(2, '', 'kovo: missing schema\n'),
      finding: result(1, '', 'kovo: input file not found\n'),
      help: result(0, rootHelp),
      root: result(0, rootHelp),
      rootHelp: result(0, rootHelp),
      usage: result(2, '', 'kovo: unknown command\n'),
      version: result(0, 'kovo 0.2.0\n'),
    };

    expect(() => assertPackedCliProcessContract(observations)).not.toThrow();
    expect(() =>
      assertPackedCliProcessContract({
        ...observations,
        rootHelp: result(1, '', rootHelp),
      }),
    ).toThrow('must exit 0 with stdout only');
    expect(() =>
      assertPackedCliProcessContract({
        ...observations,
        config: result(1, '', 'kovo: missing schema\n'),
      }),
    ).toThrow('must exit 2 with stderr only');
    expect(() =>
      assertPackedCliProcessContract({
        ...observations,
        compileConfig: result(1, '', 'kovo: missing registry facts\n'),
      }),
    ).toThrow('must exit 2 with stderr only');
    expect(() =>
      assertPackedCliProcessContract({
        ...observations,
        finding: result(0, 'OK\n', ''),
      }),
    ).toThrow('must exit 1 with stderr only');
  });

  it('requires the packed public semantic API to close its bootstrap boundary', () => {
    expect(() =>
      assertPackedSemanticApiBoundary('packed-semantic-api-boundary/v1 OK\n'),
    ).not.toThrow();
    expect(() => assertPackedSemanticApiBoundary('intercepted=true\n')).toThrow(
      'did not reject caller execution before lockdown',
    );
  });

  it('reads the finite production graph and rejects every removed SDK subtree family', () => {
    expect(productionDependencyNamesFromLockfile(lockfile('@kovojs/cli', 'esbuild'))).toEqual([
      '@kovojs/cli',
      'esbuild',
    ]);
    expect(() =>
      assertPackedCliDependencyClosure(
        lockfile(
          '@modelcontextprotocol/sdk',
          '@hono/node-server',
          'hono',
          'express',
          'body-parser',
          'ajv',
          'fast-uri',
        ),
      ),
    ).toThrow(
      '@hono/node-server, @modelcontextprotocol/sdk, ajv, body-parser, express, fast-uri, hono',
    );
  });

  it('accepts only the exact finite packed MCP lifecycle and tool vocabulary', () => {
    const initialize = {
      id: 1,
      jsonrpc: '2.0',
      result: { protocolVersion: '2025-11-25' },
    };
    const list = {
      id: 2,
      jsonrpc: '2.0',
      result: {
        tools: [
          { name: 'list_diagnostics' },
          { name: 'kovo_explain' },
          { name: 'compile_component' },
          { name: 'kovo_check' },
          { name: 'kovo_docs' },
        ],
      },
    };
    expect(() =>
      assertPackedMcpLifecycle(`${JSON.stringify(initialize)}\n${JSON.stringify(list)}\n`),
    ).not.toThrow();
    expect(() =>
      assertPackedMcpLifecycle(
        `${JSON.stringify(initialize)}\n${JSON.stringify({ ...list, result: { tools: [] } })}\n`,
      ),
    ).toThrow('tool vocabulary drifted');
  });

  it('accepts only authenticated bounded docs output tied to the selected packed snapshot', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kovo-packed-docs-proof-'));
    const digest = `sha256:${'a'.repeat(64)}`;
    try {
      mkdirSync(path.join(root, '.kovo', 'docs'), { recursive: true });
      writeFileSync(
        path.join(root, '.kovo', 'docs', 'current.json'),
        `${JSON.stringify({ snapshotDigest: digest })}\n`,
      );
      writeFileSync(
        path.join(root, 'AGENTS.md'),
        `source=./.kovo/docs/snapshots/${digest.slice('sha256:'.length)}/kovo-rules.md\n`,
      );
      const update = [
        'kovo-update-docs/v1',
        'OK source=installed-package version=0.2.0 files=77',
        `OK snapshot=${digest} current=.kovo/docs/current.json`,
        '',
      ].join('\n');
      const docs = `${JSON.stringify({
        results: [
          {
            excerpt: 'Create an app and run its first check.',
            path: 'guides/quickstart.md',
            sha256: `sha256:${'b'.repeat(64)}`,
            snapshotDigest: digest,
            version: '0.2.0',
          },
        ],
        version: 'kovo-docs/v1',
      })}\n`;

      expect(() => assertPackedDocsJourney(update, docs, root)).not.toThrow();
      expect(() =>
        assertPackedDocsJourney(
          update,
          docs.replace('Create an app', 'Bundled starter placeholder'),
          root,
        ),
      ).toThrow('malformed, unsafe, or placeholder');
      expect(() =>
        assertPackedDocsJourney(update, docs.replace(digest, `sha256:${'c'.repeat(64)}`), root),
      ).toThrow('does not match the selected snapshot');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('requires packed catalogs and copies the complete direct-subpath Card anatomy', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kovo-packed-catalog-proof-'));
    const uiRoot = path.join(root, 'node_modules', '@kovojs', 'ui');
    const iconsRoot = path.join(root, 'node_modules', '@kovojs', 'icons');
    const names = ['card', ...Array.from({ length: 43 }, (_, index) => `fixture-${index}`)];
    try {
      mkdirSync(uiRoot, { recursive: true });
      mkdirSync(iconsRoot, { recursive: true });
      writeFileSync(
        path.join(uiRoot, 'package.json'),
        `${JSON.stringify({ exports: { './card': './dist/card.mjs' } })}\n`,
      );
      writeFileSync(
        path.join(uiRoot, 'catalog.json'),
        `${JSON.stringify({
          schema: 'kovo-component-catalog/v1',
          entries: names.map((name) => ({ name })),
        })}\n`,
      );
      writeFileSync(
        path.join(uiRoot, 'registry.json'),
        `${JSON.stringify({ components: names.map((name) => ({ name })) })}\n`,
      );
      writeFileSync(
        path.join(iconsRoot, 'catalog.json'),
        `${JSON.stringify({
          schema: 'kovo-component-catalog/v1',
          entries: Array.from({ length: 1_737 }, (_, index) => ({ name: `icon-${index}` })),
        })}\n`,
      );

      expect(() =>
        assertPackedComponentCatalogJourney(root, {
          run(_command, args, cwd) {
            const outIndex = args.indexOf('--out');
            const outDir = args[outIndex + 1];
            mkdirSync(outDir, { recursive: true });
            for (const name of names) {
              writeFileSync(
                path.join(outDir, `${name}.tsx`),
                name === 'card'
                  ? [
                      'Card',
                      'CardHeader',
                      'CardTitle',
                      'CardDescription',
                      'CardContent',
                      'CardFooter',
                    ]
                      .map((symbol) => `export const ${symbol} = component({`)
                      .join('\n')
                  : 'export const Fixture = component({',
              );
            }
            expect(cwd).toBe(root);
            return { stdout: 'SUMMARY total=44\n' };
          },
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('distinguishes executable package imports from documentation examples', () => {
    expect(
      sourceImportsPackage(
        `/** @example import { Accordion } from '@kovojs/ui/accordion'; */\nexport const Accordion = {};\n`,
        '@kovojs/ui',
      ),
    ).toBe(false);
    expect(
      sourceImportsPackage(
        `import type { AccordionProps } from '@kovojs/ui/accordion';\nexport type Props = AccordionProps;\n`,
        '@kovojs/ui',
      ),
    ).toBe(true);
  });
});
