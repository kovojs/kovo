#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { applyEgressFloorEnv, ciEgressPolicies } from '../egress-floor.mjs';
import { packedFirstLoopContractOutcome } from '../lib/known-failure-probe-classifier.mjs';
import {
  createKnownFailurePackedScaffold,
  knownFailurePackedRuntimeEnvironment,
  materializeKnownFailurePackedRelease,
} from '../lib/known-failure-packed-release.mjs';
import { rewriteScaffoldDependenciesToPackedTarballs } from '../lib/authenticated-packed-consumer.mjs';
import {
  KNOWN_FAILURE_DEV_STOP_PHASE_TIMEOUT_MS,
  KNOWN_FAILURE_FIRST_RESPONSE_INFRASTRUCTURE_TIMEOUT_MS,
  KNOWN_FAILURE_HTTP_ATTEMPT_TIMEOUT_MS,
  KNOWN_FAILURE_LOGIN_RESPONSE_TIMEOUT_MS,
  KNOWN_FAILURE_PACKED_INSTALL_TIMEOUT_MS,
  KNOWN_FAILURE_PACKED_LIFECYCLE_TIMEOUT_MS,
  KNOWN_FAILURE_PACKED_REBUILD_TIMEOUT_MS,
  KNOWN_FAILURE_PACKED_BUILD_TIMEOUT_MS,
  KNOWN_FAILURE_PACKED_CHECK_TIMEOUT_MS,
  KNOWN_FAILURE_RESPONSE_STABILITY_DELAY_MS,
} from '../lib/known-failure-probe-deadlines.mjs';
import {
  isKnownFailurePackedHealthResponse,
  requestKnownFailureHttpResponse,
} from '../lib/known-failure-http-response.mjs';
import { runKnownFailureProbeCommand } from '../lib/known-failure-probe-process.mjs';
import {
  createKovoDevReadyReportObserver,
  DEV_READY_LISTENER_INFRASTRUCTURE_TIMEOUT_MS,
  DEV_READY_POST_BIND_BUDGET_MS,
  isKovoDevReadyReportTimeout,
  kovoDevLoopbackTcpConnects,
  waitForKovoDevReadiness,
} from '../lib/dev-ready-probe-contract.mjs';
import { collectProcessTreeRssKiB } from '../security-cost-budget-runner.mjs';

const MODES = new Set([
  'dev-ready',
  'fresh-check',
  'full-catalog',
  'opaque-boundary',
  'sqlite-login',
  'transactional-build',
]);
const mode = process.argv[2];
const idArgument = process.argv.indexOf('--id');
const manifestArgument = process.argv.indexOf('--packed-manifest');
const evidenceArgument = process.argv.indexOf('--evidence');
const id = process.argv[idArgument + 1];
const packedManifest = process.argv[manifestArgument + 1];
const evidencePath = evidenceArgument === -1 ? null : process.argv[evidenceArgument + 1];
if (
  !MODES.has(mode) ||
  idArgument === -1 ||
  manifestArgument === -1 ||
  !/^KF-DEVEX-\d{3}$/u.test(id ?? '') ||
  !packedManifest ||
  (evidenceArgument !== -1 &&
    (mode !== 'full-catalog' || typeof evidencePath !== 'string' || !path.isAbsolute(evidencePath)))
) {
  process.stderr.write(
    'Usage: node packed-first-loop-contract.mjs <dev-ready|fresh-check|full-catalog|opaque-boundary|sqlite-login|transactional-build> --id <KF-DEVEX-NNN> --packed-manifest <path> [--evidence <absolute-path>]\n',
  );
  process.exit(2);
}

let release;
try {
  release = materializeKnownFailurePackedRelease(packedManifest);
  const observation =
    mode === 'sqlite-login'
      ? await sqliteLoginObservation(release)
      : mode === 'dev-ready'
        ? await devReadyObservation(release)
        : mode === 'transactional-build'
          ? await transactionalBuildObservation(release)
          : mode === 'fresh-check'
            ? await freshCheckObservation(release)
            : mode === 'full-catalog'
              ? await fullCatalogObservation(release)
              : await opaqueBoundaryObservation(release);
  if (evidencePath !== null) writeFullCatalogEvidence(evidencePath, observation);
  const outcome = packedFirstLoopContractOutcome(mode, observation);
  if (outcome === null) {
    throw new Error(
      `${mode} returned an unclassified packed contract observation: ${boundedDiagnostic(
        JSON.stringify(observation),
      )}`,
    );
  }
  emitResult(id, outcome);
} catch (error) {
  process.stderr.write(
    `packed first-loop probe infrastructure failure: ${error.stack ?? error.message}\n`,
  );
  process.exitCode = 2;
} finally {
  release?.cleanup();
}

async function sqliteLoginObservation(packedRelease) {
  await requireAvailablePort(5173);
  const { appRoot, installedCli } = await createKnownFailureServedScaffold(packedRelease, {
    dialect: 'sqlite',
    directory: 'sqlite-login-app',
    name: 'known-failure-sqlite-login',
  });
  const dev = startDevServer(packedRelease, appRoot, installedCli, 5173, './src/app.tsx');
  try {
    const listener = await waitForPackedDevListener(dev, 5173, 'Packed SQLite kovo dev');
    const health = await waitForHttpResponse(
      'http://127.0.0.1:5173/api/health',
      dev,
      KNOWN_FAILURE_FIRST_RESPONSE_INFRASTRUCTURE_TIMEOUT_MS,
      {
        acceptResponse: isKnownFailurePackedHealthResponse,
        requestAccept: 'application/json',
        phaseLabel: 'first-response infrastructure',
        requiredStatus: 200,
      },
    );
    const login = await waitForHttpResponse(
      'http://127.0.0.1:5173/login',
      dev,
      KNOWN_FAILURE_LOGIN_RESPONSE_TIMEOUT_MS,
    );
    await delay(KNOWN_FAILURE_RESPONSE_STABILITY_DELAY_MS);
    return {
      body: login.body,
      healthStatus: health.status,
      listened: true,
      listenerElapsedMs: listener.listenerElapsedMs,
      serverOutput: dev.output(),
      status: login.status,
    };
  } finally {
    await stopDevServer(dev);
  }
}

async function devReadyObservation(packedRelease) {
  const port = await reservePort();
  const { appRoot, installedCli } = await createKnownFailureServedScaffold(packedRelease, {
    dialect: 'sqlite',
    directory: 'dev-ready-app',
    name: 'known-failure-dev-ready',
  });
  const entry = path.join(appRoot, 'src', 'ready.tsx');
  writeFileSync(entry, minimalAppSource('packed ready probe'), 'utf8');
  const expectedReadyReport = packedDevReadyReport(port, 'src/ready.tsx');
  const dev = startDevServer(
    packedRelease,
    appRoot,
    installedCli,
    port,
    './src/ready.tsx',
    expectedReadyReport,
  );
  try {
    try {
      const ready = await waitForPackedDevReadiness(
        dev,
        port,
        expectedReadyReport,
        'Packed known-failure kovo dev',
      );
      return {
        graceExpired: false,
        listened: true,
        readyDelayKind: ready.observedAfterMsKind,
        readyDelayMs: ready.observedAfterMs,
        stdout: dev.stdout(),
      };
    } catch (error) {
      if (!isKovoDevReadyReportTimeout(error)) throw error;
      return {
        graceExpired: true,
        listened: true,
        readyDelayKind: null,
        readyDelayMs: null,
        stdout: dev.stdout(),
      };
    }
  } finally {
    await stopDevServer(dev);
  }
}

async function transactionalBuildObservation(packedRelease) {
  const appRoot = createKnownFailurePackedScaffold(packedRelease, {
    dialect: 'sqlite',
    directory: 'transactional-build-app',
    name: 'known-failure-transactional-build',
  });
  prepareInstalledCommandScaffoldFixture(appRoot);
  const configPath = path.join(appRoot, 'kovo.config.ts');
  const originalConfig = readFileSync(configPath, 'utf8');
  writeFileSync(configPath, retentionConfigSource(originalConfig), 'utf8');
  // SPEC §5.2.4 requires both the successful promotion and the deliberately failed build. Each
  // invocation owns its command deadline and verified descendant cleanup inside the row deadline.
  const initial = await runPackedCli(
    packedRelease,
    appRoot,
    ['build', './src/app.tsx', '--no-cache'],
    KNOWN_FAILURE_PACKED_BUILD_TIMEOUT_MS,
    'initial packed build',
  );
  requireOrdinaryExit(initial, 'initial packed build');
  if (initial.status !== 0) {
    throw new Error(`initial packed build failed: ${combinedOutput(initial)}`);
  }

  const dist = path.join(appRoot, 'dist');
  const graph = path.join(dist, '.kovo', 'graph.json');
  if (!existsSync(graph))
    throw new Error('initial packed build did not emit dist/.kovo/graph.json');
  const beforeDigest = digestDirectory(dist);
  const beforeGraphDigest = digestFile(graph);

  const appPath = path.join(appRoot, 'src', 'app.tsx');
  const source = readFileSync(appPath, 'utf8');
  if (!source.includes('Kovo Starter')) {
    throw new Error('packed starter source no longer contains the transactional-build sentinel');
  }
  writeFileSync(appPath, source.replace('Kovo Starter', 'Kovo Failed Build Sentinel'), 'utf8');
  writeFileSync(configPath, originalConfig, 'utf8');
  const failed = await runPackedCli(
    packedRelease,
    appRoot,
    ['build', './src/app.tsx', '--no-cache'],
    KNOWN_FAILURE_PACKED_BUILD_TIMEOUT_MS,
    'deliberately failed packed build',
  );
  requireOrdinaryExit(failed, 'deliberately failed packed build');
  const afterDigest = existsSync(dist) ? digestDirectory(dist) : 'missing';
  const afterGraphDigest = existsSync(graph) ? digestFile(graph) : 'missing';
  return {
    afterDigest,
    beforeDigest,
    failedExit: failed.status,
    failedGraphPromoted: beforeGraphDigest !== afterGraphDigest,
    failedOutput: combinedOutput(failed),
    initialExit: initial.status,
  };
}

async function freshCheckObservation(packedRelease) {
  const variants = [];
  for (const dialect of ['postgres', 'sqlite']) {
    const appRoot = createKnownFailurePackedScaffold(packedRelease, {
      dialect,
      directory: `fresh-check-${dialect}-app`,
      name: `known-failure-fresh-check-${dialect}`,
    });
    prepareInstalledCommandScaffoldFixture(appRoot);
    const result = await runPackedCli(
      packedRelease,
      appRoot,
      ['check', '--no-cache'],
      KNOWN_FAILURE_PACKED_CHECK_TIMEOUT_MS,
      `fresh packed ${dialect} scaffold check`,
    );
    requireOrdinaryExit(result, `fresh packed ${dialect} scaffold check`);
    variants.push({
      dialect,
      exit: result.status,
      output: combinedOutput(result),
    });
  }
  return { variants };
}

async function fullCatalogObservation(packedRelease) {
  const appRoot = createKnownFailurePackedScaffold(packedRelease, {
    dialect: 'sqlite',
    directory: 'full-catalog-app',
    name: 'known-failure-full-catalog',
  });
  prepareInstalledCommandScaffoldFixture(appRoot);
  declareCatalogDependencies(packedRelease, appRoot);
  const componentNames = packedUiComponentNames(packedRelease);
  const add = await runPackedCli(
    packedRelease,
    appRoot,
    ['add', ...componentNames, '--out', 'src/components/ui'],
    90_000,
    'packed full-catalog copy-in',
  );
  requireOrdinaryExit(add, 'packed full-catalog copy-in');
  if (
    add.status !== 0 ||
    !new RegExp(`SUMMARY total=${componentNames.length}\\b`, 'u').test(add.stdout)
  ) {
    throw new Error(`packed full-catalog copy-in failed: ${combinedOutput(add)}`);
  }
  const copiedRoot = path.join(appRoot, 'src', 'components', 'ui');
  const copied = componentNames.filter((name) => existsSync(path.join(copiedRoot, `${name}.tsx`)));
  if (copied.length !== 44) {
    throw new Error(`packed full-catalog copy-in emitted ${copied.length} of 44 components`);
  }
  const unimported = !recursiveSource(appRoot, 'src')
    .filter((file) => !file.startsWith('src/components/ui/'))
    .some((file) => readFileSync(path.join(appRoot, file), 'utf8').includes('components/ui/'));

  const boundedEnvironment = knownFailurePackedRuntimeEnvironment(packedRelease);
  const typecheck = await runBoundedCommand(
    path.join(packedRelease.nodeModules, '.bin', 'tsc'),
    ['--noEmit'],
    appRoot,
    boundedEnvironment,
    150_000,
    2_048,
  );
  requireBoundedPhase(typecheck, 'full-catalog typecheck');
  const check = await runBoundedCommand(
    process.execPath,
    [path.join(packedRelease.packageRoot('@kovojs/cli'), 'dist', 'bin.mjs'), 'check', '--no-cache'],
    appRoot,
    boundedEnvironment,
    150_000,
    2_048,
  );
  requireBoundedPhase(check, 'full-catalog check');

  const configPath = path.join(appRoot, 'kovo.config.ts');
  writeFileSync(configPath, retentionConfigSource(readFileSync(configPath, 'utf8')), 'utf8');
  const build = await runBoundedCommand(
    process.execPath,
    [
      path.join(packedRelease.packageRoot('@kovojs/cli'), 'dist', 'bin.mjs'),
      'build',
      './src/app.tsx',
      '--no-cache',
    ],
    appRoot,
    boundedEnvironment,
    240_000,
    2_048,
  );
  requireBoundedPhase(build, 'full-catalog build');
  return {
    buildExit: normalizedExit(build),
    buildDurationMs: build.durationMs,
    buildMemoryExceeded: build.memoryExceeded,
    buildOutput: combinedOutput(build),
    buildPeakRssMiB: build.peakRssMiB,
    checkExit: normalizedExit(check),
    checkDurationMs: check.durationMs,
    checkMemoryExceeded: check.memoryExceeded,
    checkOutput: combinedOutput(check),
    checkPeakRssMiB: check.peakRssMiB,
    componentCount: copied.length,
    typecheckExit: normalizedExit(typecheck),
    typecheckDurationMs: typecheck.durationMs,
    typecheckMemoryExceeded: typecheck.memoryExceeded,
    typecheckOutput: combinedOutput(typecheck),
    typecheckPeakRssMiB: typecheck.peakRssMiB,
    unimported,
  };
}

async function opaqueBoundaryObservation(packedRelease) {
  const port = await reservePort();
  const { appRoot, installedCli } = await createKnownFailureServedScaffold(packedRelease, {
    dialect: 'sqlite',
    directory: 'opaque-boundary-app',
    name: 'known-failure-opaque-boundary',
  });
  const dev = startDevServer(packedRelease, appRoot, installedCli, port, './src/app.tsx');
  try {
    const listener = await waitForPackedDevListener(dev, port, 'Packed opaque-boundary kovo dev');
    const health = await waitForHttpResponse(
      `http://127.0.0.1:${port}/api/health`,
      dev,
      KNOWN_FAILURE_FIRST_RESPONSE_INFRASTRUCTURE_TIMEOUT_MS,
      {
        acceptResponse: isKnownFailurePackedHealthResponse,
        requestAccept: 'application/json',
        phaseLabel: 'first-response infrastructure',
        requiredStatus: 200,
      },
    );
    const login = await waitForHttpResponse(
      `http://127.0.0.1:${port}/login`,
      dev,
      KNOWN_FAILURE_LOGIN_RESPONSE_TIMEOUT_MS,
    );
    await delay(KNOWN_FAILURE_RESPONSE_STABILITY_DELAY_MS);
    return {
      body: login.body,
      healthStatus: health.status,
      listened: true,
      listenerElapsedMs: listener.listenerElapsedMs,
      serverOutput: dev.output(),
      status: login.status,
    };
  } finally {
    await stopDevServer(dev);
  }
}

async function createKnownFailureServedScaffold(packedRelease, options) {
  const appRoot = createKnownFailurePackedScaffold(packedRelease, {
    ...options,
    linkPackedNodeModules: false,
  });
  const packedPackages = packedRelease.packedPackages();
  rewriteScaffoldDependenciesToPackedTarballs(appRoot, packedPackages);

  const storeRoot = path.join(packedRelease.root, `${options.directory}-pnpm-store`);
  mkdirSync(storeRoot, { mode: 0o700 });
  const installEnvironment = applyEgressFloorEnv(
    knownFailurePackedRuntimeEnvironment(packedRelease, {
      CI: '1',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    }),
    { allowlist: ciEgressPolicies.install, mode: 'deny' },
  );
  await runSuccessfulPackedInstallPhase(
    packedRelease,
    appRoot,
    [
      'install',
      '--ignore-workspace',
      '--no-frozen-lockfile',
      '--ignore-scripts',
      '--strict-peer-dependencies',
      '--store-dir',
      storeRoot,
    ],
    installEnvironment,
    KNOWN_FAILURE_PACKED_INSTALL_TIMEOUT_MS,
    'isolated packed consumer install',
  );

  assertInstalledPackedCli(appRoot, packedPackages);
  await runSuccessfulPackedInstallPhase(
    packedRelease,
    appRoot,
    ['exec', 'kovo', 'check', 'lifecycle'],
    applyEgressFloorEnv(
      knownFailureInstalledRuntimeEnvironment(packedRelease, appRoot, {
        BETTER_AUTH_URL: null,
        NODE_ENV: 'development',
      }),
      { allowlist: [], mode: 'deny' },
    ),
    KNOWN_FAILURE_PACKED_LIFECYCLE_TIMEOUT_MS,
    'installed packed consumer lifecycle check',
  );
  await runSuccessfulPackedInstallPhase(
    packedRelease,
    appRoot,
    ['rebuild'],
    applyEgressFloorEnv(
      knownFailurePackedRuntimeEnvironment(packedRelease, {
        CI: '1',
        npm_config_audit: 'false',
        npm_config_fund: 'false',
      }),
      { allowlist: [], mode: 'deny' },
    ),
    KNOWN_FAILURE_PACKED_REBUILD_TIMEOUT_MS,
    'isolated packed consumer rebuild',
  );
  return { appRoot, installedCli: assertInstalledPackedCli(appRoot, packedPackages) };
}

async function runSuccessfulPackedInstallPhase(
  packedRelease,
  appRoot,
  pnpmArgs,
  env,
  timeoutMs,
  label,
) {
  const result = await runKnownFailureProbeCommand({
    args: ['exec', 'pnpm', ...pnpmArgs],
    command: path.join(packedRelease.nodeModules, '.bin', 'vp'),
    cwd: appRoot,
    env,
    label,
    timeoutMs,
  });
  requireOrdinaryExit(result, label);
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${boundedDiagnostic(combinedOutput(result))}`);
  }
}

function assertInstalledPackedCli(appRoot, packedPackages) {
  const nodeModules = path.join(appRoot, 'node_modules');
  if (
    !existsSync(nodeModules) ||
    lstatSync(nodeModules).isSymbolicLink() ||
    !lstatSync(nodeModules).isDirectory()
  ) {
    throw new Error('served packed consumer requires an installed app-local node_modules tree');
  }
  const realNodeModules = realpathSync(nodeModules);
  const packageRoot = realpathSync(path.join(nodeModules, '@kovojs', 'cli'));
  assertContainedPath(realNodeModules, packageRoot, 'installed @kovojs/cli package');
  const installedCli = realpathSync(path.join(packageRoot, 'dist', 'bin.mjs'));
  assertContainedPath(realNodeModules, installedCli, 'installed @kovojs/cli executable');
  if (!lstatSync(installedCli).isFile() || lstatSync(installedCli).isSymbolicLink()) {
    throw new Error('installed @kovojs/cli executable is not a regular package file');
  }

  const authenticatedCli = packedPackages
    .get('@kovojs/cli')
    ?.entries.find((entry) => entry.name === 'package/dist/bin.mjs');
  if (!Buffer.isBuffer(authenticatedCli?.data)) {
    throw new Error('authenticated @kovojs/cli tarball is missing package/dist/bin.mjs');
  }
  const expectedDigest = `sha256:${createHash('sha256')
    .update(authenticatedCli.data)
    .digest('hex')}`;
  if (digestFile(installedCli) !== expectedDigest) {
    throw new Error('installed @kovojs/cli executable differs from its authenticated tarball');
  }
  return installedCli;
}

function assertContainedPath(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} resolves outside the app-local node_modules tree`);
  }
}

function knownFailureInstalledRuntimeEnvironment(packedRelease, appRoot, overrides = {}) {
  const env = knownFailurePackedRuntimeEnvironment(packedRelease, overrides);
  env.PATH = `${path.join(appRoot, 'node_modules', '.bin')}${path.delimiter}${
    process.env.PATH ?? ''
  }`;
  return env;
}

function startDevServer(packedRelease, appRoot, installedCli, port, entry, expectedReadyReport) {
  const startedAt = performance.now();
  const child = spawn(
    process.execPath,
    [installedCli, 'dev', entry, '--host', '127.0.0.1', '--port', String(port), '--strict-port'],
    {
      cwd: appRoot,
      detached: process.platform !== 'win32',
      env: applyEgressFloorEnv(
        knownFailureInstalledRuntimeEnvironment(packedRelease, appRoot, {
          BETTER_AUTH_URL: null,
          HOST: null,
          KOVO_NODE_ORIGIN: null,
          KOVO_NODE_TRUSTED_PROXY: null,
          NODE_ENV: 'development',
          PORT: null,
        }),
        { allowlist: [], mode: 'deny' },
      ),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const readyReportObserver =
    expectedReadyReport === undefined
      ? undefined
      : createKovoDevReadyReportObserver(child.stdout, expectedReadyReport);
  let stdout = '';
  let stderr = '';
  let outputExceeded = false;
  let closed = false;
  const close = new Promise((resolve) => {
    child.once('close', (exitCode, signalCode) => {
      closed = true;
      resolve({ exitCode, signalCode });
    });
  });
  child.stdout.on('data', (chunk) => {
    ({ outputExceeded, value: stdout } = appendBounded(stdout, chunk, outputExceeded));
  });
  child.stderr.on('data', (chunk) => {
    ({ outputExceeded, value: stderr } = appendBounded(stderr, chunk, outputExceeded));
  });
  const bounded = (value) => {
    if (outputExceeded) throw new Error('packed dev probe output exceeded 4 MiB');
    return value;
  };
  return {
    child,
    close,
    closed: () => closed,
    output: () => bounded(`${stdout}\n${stderr}`),
    readyReportObserver,
    stderr: () => bounded(stderr),
    startedAt,
    stdout: () => bounded(stdout),
  };
}

function packedDevReadyReport(port, appEntry) {
  return {
    appEntry,
    localUrl: `http://127.0.0.1:${port}/`,
    mode: 'development',
  };
}

async function waitForPackedDevListener(dev, port, label) {
  const deadline = dev.startedAt + DEV_READY_LISTENER_INFRASTRUCTURE_TIMEOUT_MS;
  for (;;) {
    const now = performance.now();
    if (now >= deadline) {
      throw new Error(
        `${label} did not acquire its loopback listener within the ${DEV_READY_LISTENER_INFRASTRUCTURE_TIMEOUT_MS}ms infrastructure deadline (elapsed=${Math.ceil(
          now - dev.startedAt,
        )}ms)\n${boundedDiagnostic(dev.output())}`,
      );
    }
    assertChildRunning(dev, `${label} loopback listener`);
    const abortController = new AbortController();
    const attemptTimeoutMs = Math.max(1, Math.ceil(Math.min(250, deadline - now)));
    const timer = setTimeout(() => abortController.abort(), attemptTimeoutMs);
    let listened;
    try {
      listened = await kovoDevLoopbackTcpConnects(port, '127.0.0.1', {
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (listened) {
      return { listenerElapsedMs: Math.ceil(performance.now() - dev.startedAt) };
    }
    await delay(Math.max(0, Math.min(25, deadline - performance.now())));
  }
}

async function waitForPackedDevReadiness(dev, port, expected, label) {
  // SPEC §9.5.1's complete structured report is the behavior owned by KF-DEVEX-002. Served-app
  // rows own listener acquisition and first response as separate phases instead.
  return waitForKovoDevReadiness({
    expected,
    label,
    listenerTimeoutMs: DEV_READY_LISTENER_INFRASTRUCTURE_TIMEOUT_MS,
    port,
    readOutput: () => ({ stderr: dev.stderr(), stdout: dev.stdout() }),
    readStatus: () => ({
      exitCode: dev.child.exitCode,
      signalCode: dev.child.signalCode,
    }),
    reportObserver: dev.readyReportObserver,
    reportTimeoutMs: DEV_READY_POST_BIND_BUDGET_MS,
    startedAt: dev.startedAt,
  });
}

function appendBounded(current, chunk, alreadyExceeded) {
  if (alreadyExceeded) return { outputExceeded: true, value: current };
  const next = `${current}${String(chunk)}`;
  if (next.length > 4 * 1024 * 1024) {
    return {
      outputExceeded: true,
      value: next.slice(0, 4 * 1024 * 1024),
    };
  }
  return { outputExceeded: false, value: next };
}

async function waitForHttpResponse(url, dev, timeoutMs, options = {}) {
  const startedAt = performance.now();
  const deadline = startedAt + timeoutMs;
  let lastResponse;
  let lastError;
  while (performance.now() < deadline) {
    assertChildRunning(dev, `HTTP response for ${url}`);
    try {
      const response = await requestKnownFailureHttpResponse(
        url,
        Math.ceil(
          Math.max(
            1,
            Math.min(KNOWN_FAILURE_HTTP_ATTEMPT_TIMEOUT_MS, deadline - performance.now()),
          ),
        ),
        { accept: options.requestAccept },
      );
      lastResponse = response;
      if (
        (options.requiredStatus === undefined || response.status === options.requiredStatus) &&
        (options.acceptResponse === undefined || options.acceptResponse(response))
      ) {
        return response;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(Math.max(0, Math.min(50, deadline - performance.now())));
  }
  throw new Error(
    `packed dev server did not return ${
      options.requiredStatus === undefined ? 'an HTTP response' : `HTTP ${options.requiredStatus}`
    } within its ${timeoutMs}ms ${options.phaseLabel ?? 'response'} deadline (elapsed=${Math.ceil(
      performance.now() - startedAt,
    )}ms)${lastResponse ? `; last status=${lastResponse.status}` : ''}${
      lastResponse?.headers['content-type']
        ? `; last content-type=${String(lastResponse.headers['content-type'])}`
        : ''
    }${lastResponse ? `; last body=${boundedHttpResponseBody(lastResponse.body)}` : ''}${
      lastError instanceof Error ? `; last error=${lastError.message}` : ''
    }\n${boundedDiagnostic(dev.output())}`,
  );
}

function assertChildRunning(dev, label) {
  if (dev.child.exitCode !== null || dev.child.signalCode !== null) {
    throw new Error(
      `packed dev server exited before ${label}: exit=${String(dev.child.exitCode)} signal=${String(
        dev.child.signalCode,
      )}\n${dev.output()}`,
    );
  }
}

async function stopDevServer(dev) {
  if (dev.closed()) return;
  signalChildTree(dev.child, 'SIGTERM');
  if (await waitForClose(dev, KNOWN_FAILURE_DEV_STOP_PHASE_TIMEOUT_MS)) return;
  signalChildTree(dev.child, 'SIGKILL');
  if (await waitForClose(dev, KNOWN_FAILURE_DEV_STOP_PHASE_TIMEOUT_MS)) return;
  throw new Error('packed dev process-group streams did not close after bounded TERM/KILL cleanup');
}

function signalChildTree(child, signal) {
  try {
    if (process.platform !== 'win32' && child.pid !== undefined) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The process may have exited between the status check and signal delivery.
  }
}

function waitForClose(dev, timeoutMs) {
  if (dev.closed()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (closed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(closed);
    };
    timer = setTimeout(() => finish(false), timeoutMs);
    void dev.close.then(() => finish(true));
  });
}

async function reservePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('unable to reserve a loopback port');
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function requireAvailablePort(port) {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  }).catch((error) => {
    throw new Error(`required first-run port ${port} is unavailable: ${error.message}`);
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function runPackedCli(packedRelease, cwd, args, timeoutMs, label) {
  return runKnownFailureProbeCommand({
    args: [path.join(packedRelease.packageRoot('@kovojs/cli'), 'dist', 'bin.mjs'), ...args],
    command: process.execPath,
    cwd,
    env: knownFailurePackedRuntimeEnvironment(packedRelease, {
      BETTER_AUTH_URL: null,
      NODE_ENV: 'development',
    }),
    label,
    timeoutMs,
  });
}

async function runBoundedCommand(executable, args, cwd, env, timeoutMs, memoryCeilingMiB) {
  const startedAt = process.hrtime.bigint();
  const child = spawn(executable, args, {
    cwd,
    detached: process.platform !== 'win32',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const outputLimit = 16 * 1024 * 1024;
  let stdout = '';
  let stderr = '';
  let outputExceeded = false;
  let memoryExceeded = false;
  let peakRssKiB = 0;
  let rssAvailable = false;
  let timedOut = false;
  let killTimer;
  const terminate = () => {
    signalChildTree(child, 'SIGTERM');
    if (killTimer === undefined) {
      killTimer = setTimeout(() => signalChildTree(child, 'SIGKILL'), 1_000);
    }
  };
  const append = (current, chunk) => {
    if (outputExceeded) return current;
    const next = `${current}${String(chunk)}`;
    if (next.length <= outputLimit) return next;
    outputExceeded = true;
    terminate();
    return next.slice(0, outputLimit);
  };
  child.stdout.on('data', (chunk) => {
    stdout = append(stdout, chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr = append(stderr, chunk);
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    terminate();
  }, timeoutMs);
  const sampleMemory = () => {
    const rssKiB = collectProcessTreeRssKiB(child.pid);
    if (rssKiB === null) return;
    rssAvailable = true;
    peakRssKiB = Math.max(peakRssKiB, rssKiB);
    if (rssKiB / 1_024 > memoryCeilingMiB && !memoryExceeded) {
      memoryExceeded = true;
      terminate();
    }
  };
  sampleMemory();
  const memorySampler = setInterval(sampleMemory, 250);
  memorySampler.unref();

  try {
    const { signal, status } = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (status, signal) => resolve({ signal, status }));
    });
    return {
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      error: null,
      memoryExceeded,
      outputExceeded,
      peakRssMiB: peakRssKiB / 1_024,
      rssAvailable,
      signal,
      status,
      stderr,
      stdout,
      timedOut,
    };
  } finally {
    clearTimeout(timeout);
    clearInterval(memorySampler);
    if (killTimer !== undefined) {
      clearTimeout(killTimer);
      signalChildTree(child, 'SIGKILL');
    }
  }
}

function writeFullCatalogEvidence(file, observation) {
  const phases = ['typecheck', 'check', 'build'].map((name) => ({
    durationMs: observation[`${name}DurationMs`],
    exit: observation[`${name}Exit`],
    memoryExceeded: observation[`${name}MemoryExceeded`],
    name,
    peakRssMiB: observation[`${name}PeakRssMiB`],
  }));
  if (
    observation.componentCount !== 44 ||
    observation.unimported !== true ||
    phases.some(
      (phase) =>
        !Number.isFinite(phase.durationMs) ||
        phase.durationMs < 0 ||
        !Number.isFinite(phase.peakRssMiB) ||
        phase.peakRssMiB < 0 ||
        !Number.isInteger(phase.exit) ||
        typeof phase.memoryExceeded !== 'boolean',
    )
  ) {
    throw new TypeError('full-catalog bounded evidence is incomplete');
  }
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        schema: 'kovo-full-catalog-bounded-evidence/v1',
        componentCount: observation.componentCount,
        memoryCeilingMiB: 2_048,
        phases,
        unimported: observation.unimported,
      },
      null,
      2,
    )}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
}

function requireBoundedPhase(result, label) {
  if (result.timedOut) throw new Error(`${label} exceeded its hard time ceiling`);
  if (result.outputExceeded) throw new Error(`${label} exceeded its 16 MiB output ceiling`);
  if (!result.rssAvailable) throw new Error(`${label} could not measure process-tree peak RSS`);
  if (result.error) throw new Error(`${label} failed to execute: ${result.error.message}`);
  if (
    result.status === null &&
    !result.memoryExceeded &&
    !['SIGABRT', 'SIGKILL'].includes(result.signal)
  ) {
    throw new Error(`${label} ended with unclassified signal ${String(result.signal)}`);
  }
}

function requireOrdinaryExit(result, label) {
  if (result.error || result.signal || result.status === null) {
    throw new Error(
      `${label} did not return an ordinary exit: ${
        result.error?.message ?? result.signal ?? 'missing status'
      }`,
    );
  }
}

function normalizedExit(result) {
  if (Number.isInteger(result.status)) return result.status;
  if (result.signal === 'SIGABRT') return 134;
  if (result.signal === 'SIGTERM') return 143;
  if (result.signal === 'SIGKILL') return 137;
  return null;
}

function combinedOutput(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function retentionConfigSource(source) {
  const replacement = `preset: node({
    retention: {
      hours: 24,
      immutableClientModules: 'retained',
      priorTokenQueryReads: 'retained',
    },
  }),`;
  const updated = source.replace('preset: node(),', replacement);
  if (updated === source) throw new Error('packed scaffold config no longer has the node preset');
  return updated;
}

/**
 * Command-only rows execute the authenticated synthetic release tree and need only the lockfile
 * identity required by SPEC §5.2.3. Served rows never use this seam: their isolated pnpm install
 * owns the real lockfile and app-local module topology.
 */
function prepareInstalledCommandScaffoldFixture(appRoot) {
  const manifestPath = path.join(appRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(
    path.join(appRoot, 'pnpm-lock.yaml'),
    "lockfileVersion: '9.0'\n# authenticated packed known-failure command fixture\n",
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
}

function declareCatalogDependencies(packedRelease, appRoot) {
  const manifestPath = path.join(appRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const name of ['@kovojs/headless-ui', '@kovojs/icons']) {
    const packed = JSON.parse(
      readFileSync(path.join(packedRelease.packageRoot(name), 'package.json'), 'utf8'),
    );
    manifest.dependencies[name] = packed.version;
  }
  manifest.dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies).sort(([left], [right]) => left.localeCompare(right)),
  );
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function packedUiComponentNames(packedRelease) {
  const manifest = JSON.parse(
    readFileSync(path.join(packedRelease.packageRoot('@kovojs/ui'), 'package.json'), 'utf8'),
  );
  const names = Object.keys(manifest.kovo?.vendoredSourceHashes ?? {}).sort();
  if (names.length !== 44 || names.some((name) => !/^[a-z][a-z0-9-]*$/u.test(name))) {
    throw new Error(`authenticated @kovojs/ui catalog must contain the baseline 44 components`);
  }
  return names;
}

function recursiveSource(root, relative) {
  const absolute = path.join(root, relative);
  const entries = readdirSync(absolute, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`source fixture contains a symlink: ${relative}`);
    const next = path.posix.join(relative.split(path.sep).join('/'), entry.name);
    if (entry.isDirectory()) files.push(...recursiveSource(root, next));
    else if (entry.isFile()) files.push(next);
  }
  return files;
}

function digestDirectory(root) {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`cannot digest missing directory ${root}`);
  }
  const hash = createHash('sha256');
  for (const relative of recursiveSource(root, '.')) {
    const absolute = path.join(root, relative);
    const stats = lstatSync(absolute);
    hash.update(relative);
    hash.update('\0');
    hash.update(String(stats.mode & 0o777));
    hash.update('\0');
    hash.update(readFileSync(absolute));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function digestFile(file) {
  return `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
}

function minimalAppSource(reason) {
  return `import { defineKovo } from '@kovojs/server';

const app = defineKovo({
  appId: '5f31d8d7-45e7-4e91-a34b-2b1263de9b5e',
});
const home = app.route('/', {
  access: app.publicAccess(${JSON.stringify(reason)}),
  page: () => 'ready',
});

export default app.assemble({ routes: [home] });
`;
}

function boundedDiagnostic(value) {
  const maximum = 32 * 1024;
  if (value.length <= maximum) return value;
  const half = maximum / 2;
  return `${value.slice(0, half)}\n... packed probe output truncated ...\n${value.slice(-half)}`;
}

function boundedHttpResponseBody(value) {
  const maximum = 512;
  const bounded = value.length <= maximum ? value : `${value.slice(0, maximum)}...`;
  return JSON.stringify(bounded);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emitResult(rowId, outcome) {
  process.stdout.write(
    `${JSON.stringify({
      schema: 'kovo-known-failure-probe-result/v1',
      id: rowId,
      outcome,
    })}\n`,
  );
  process.exitCode = outcome === 'desired-behavior' ? 0 : 1;
}
