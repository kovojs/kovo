#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { request as nodeHttpRequest } from 'node:http';
import { createConnection, createServer as createNetServer } from 'node:net';
import path from 'node:path';

import { packedFirstLoopContractOutcome } from '../lib/known-failure-probe-classifier.mjs';
import {
  createKnownFailurePackedScaffold,
  knownFailurePackedEnvironment,
  materializeKnownFailurePackedRelease,
} from '../lib/known-failure-packed-release.mjs';
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
const id = process.argv[idArgument + 1];
const packedManifest = process.argv[manifestArgument + 1];
if (
  !MODES.has(mode) ||
  idArgument === -1 ||
  manifestArgument === -1 ||
  !/^KF-DEVEX-\d{3}$/u.test(id ?? '') ||
  !packedManifest
) {
  process.stderr.write(
    'Usage: node packed-first-loop-contract.mjs <dev-ready|fresh-check|full-catalog|opaque-boundary|sqlite-login|transactional-build> --id <KF-DEVEX-NNN> --packed-manifest <path>\n',
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
          ? transactionalBuildObservation(release)
          : mode === 'fresh-check'
            ? freshCheckObservation(release)
            : mode === 'full-catalog'
              ? await fullCatalogObservation(release)
              : await opaqueBoundaryObservation(release);
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
  const appRoot = createKnownFailurePackedScaffold(packedRelease, {
    dialect: 'sqlite',
    directory: 'sqlite-login-app',
    name: 'known-failure-sqlite-login',
  });
  isolateAuthOriginFixture(appRoot);
  const dev = startDevServer(packedRelease, appRoot, 5173, './src/app.tsx');
  try {
    const health = await waitForHttpResponse('http://127.0.0.1:5173/api/health', dev, 45_000, 200);
    const login = await waitForHttpResponse('http://127.0.0.1:5173/login', dev, 30_000);
    await delay(100);
    return {
      body: login.body,
      healthStatus: health.status,
      listened: true,
      serverOutput: dev.output(),
      status: login.status,
    };
  } finally {
    await stopChildProcess(dev.child);
  }
}

async function devReadyObservation(packedRelease) {
  const port = await reservePort();
  const appRoot = createKnownFailurePackedScaffold(packedRelease, {
    dialect: 'sqlite',
    directory: 'dev-ready-app',
    name: 'known-failure-dev-ready',
  });
  const entry = path.join(appRoot, 'src', 'ready.tsx');
  writeFileSync(entry, minimalAppSource('packed ready probe'), 'utf8');
  const dev = startDevServer(packedRelease, appRoot, port, './src/ready.tsx');
  try {
    await waitForTcpListener(port, dev, 30_000);
    const listenedAt = Date.now();
    const readyPattern = /Kovo dev ready in \d+ms/u;
    while (Date.now() - listenedAt <= 5_000) {
      if (readyPattern.test(dev.stdout())) {
        return {
          graceExpired: false,
          listened: true,
          readyDelayMs: Date.now() - listenedAt,
          stdout: dev.stdout(),
        };
      }
      assertChildRunning(dev, 'dev readiness report');
      await delay(25);
    }
    return {
      graceExpired: true,
      listened: true,
      readyDelayMs: null,
      stdout: dev.stdout(),
    };
  } finally {
    await stopChildProcess(dev.child);
  }
}

function transactionalBuildObservation(packedRelease) {
  const appRoot = createKnownFailurePackedScaffold(packedRelease, {
    dialect: 'sqlite',
    directory: 'transactional-build-app',
    name: 'known-failure-transactional-build',
  });
  prepareInstalledScaffoldFixture(appRoot);
  const configPath = path.join(appRoot, 'kovo.config.ts');
  const originalConfig = readFileSync(configPath, 'utf8');
  writeFileSync(configPath, retentionConfigSource(originalConfig), 'utf8');
  const initial = runPackedCli(
    packedRelease,
    appRoot,
    ['build', './src/app.tsx', '--no-cache'],
    180_000,
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
  const failed = runPackedCli(
    packedRelease,
    appRoot,
    ['build', './src/app.tsx', '--no-cache'],
    180_000,
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

function freshCheckObservation(packedRelease) {
  const variants = [];
  for (const dialect of ['postgres', 'sqlite']) {
    const appRoot = createKnownFailurePackedScaffold(packedRelease, {
      dialect,
      directory: `fresh-check-${dialect}-app`,
      name: `known-failure-fresh-check-${dialect}`,
    });
    prepareInstalledScaffoldFixture(appRoot);
    const result = runPackedCli(packedRelease, appRoot, ['check', '--no-cache'], 240_000);
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
  prepareInstalledScaffoldFixture(appRoot);
  declareCatalogDependencies(packedRelease, appRoot);
  const componentNames = packedUiComponentNames(packedRelease);
  const add = runPackedCli(
    packedRelease,
    appRoot,
    ['add', ...componentNames, '--out', 'src/components/ui'],
    90_000,
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

  const boundedEnvironment = knownFailurePackedEnvironment(packedRelease, {
    NODE_OPTIONS: null,
  });
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
    buildMemoryExceeded: build.memoryExceeded,
    buildOutput: combinedOutput(build),
    buildPeakRssMiB: build.peakRssMiB,
    checkExit: normalizedExit(check),
    checkMemoryExceeded: check.memoryExceeded,
    checkOutput: combinedOutput(check),
    checkPeakRssMiB: check.peakRssMiB,
    componentCount: copied.length,
    typecheckExit: normalizedExit(typecheck),
    typecheckMemoryExceeded: typecheck.memoryExceeded,
    typecheckOutput: combinedOutput(typecheck),
    typecheckPeakRssMiB: typecheck.peakRssMiB,
    unimported,
  };
}

async function opaqueBoundaryObservation(packedRelease) {
  const port = await reservePort();
  const appRoot = createKnownFailurePackedScaffold(packedRelease, {
    dialect: 'sqlite',
    directory: 'opaque-boundary-app',
    name: 'known-failure-opaque-boundary',
  });
  isolateAuthOriginFixture(appRoot);
  const dev = startDevServer(packedRelease, appRoot, port, './src/app.tsx');
  try {
    const health = await waitForHttpResponse(
      `http://127.0.0.1:${port}/api/health`,
      dev,
      45_000,
      200,
    );
    const login = await waitForHttpResponse(`http://127.0.0.1:${port}/login`, dev, 30_000);
    await delay(100);
    return {
      body: login.body,
      healthStatus: health.status,
      listened: true,
      serverOutput: dev.output(),
      status: login.status,
    };
  } finally {
    await stopChildProcess(dev.child);
  }
}

function startDevServer(packedRelease, appRoot, port, entry) {
  const cli = path.join(packedRelease.packageRoot('@kovojs/cli'), 'dist', 'bin.mjs');
  const child = spawn(
    process.execPath,
    [cli, 'dev', entry, '--host', '127.0.0.1', '--port', String(port), '--strict-port'],
    {
      cwd: appRoot,
      detached: process.platform !== 'win32',
      env: knownFailurePackedEnvironment(packedRelease, {
        BETTER_AUTH_URL: null,
        HOST: null,
        KOVO_NODE_ORIGIN: null,
        KOVO_NODE_TRUSTED_PROXY: null,
        NODE_ENV: 'development',
        PORT: null,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  let outputExceeded = false;
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
    output: () => bounded(`${stdout}\n${stderr}`),
    stderr: () => bounded(stderr),
    stdout: () => bounded(stdout),
  };
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

async function waitForTcpListener(port, dev, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertChildRunning(dev, 'TCP listen');
    if (await tcpConnects(port)) return;
    await delay(25);
  }
  throw new Error(`packed dev server did not listen within ${timeoutMs}ms`);
}

function tcpConnects(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const settle = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(250, () => settle(false));
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
  });
}

async function waitForHttpResponse(url, dev, timeoutMs, requiredStatus) {
  const deadline = Date.now() + timeoutMs;
  let lastResponse;
  while (Date.now() < deadline) {
    assertChildRunning(dev, `HTTP response for ${url}`);
    try {
      const response = await httpRequest(url);
      lastResponse = response;
      if (requiredStatus === undefined || response.status === requiredStatus) return response;
    } catch {
      // Connection refusal/early close is expected while Vite is opening the listener.
    }
    await delay(50);
  }
  throw new Error(
    `packed dev server did not return ${
      requiredStatus === undefined ? 'an HTTP response' : `HTTP ${requiredStatus}`
    } within ${timeoutMs}ms${lastResponse ? ` (last status ${lastResponse.status})` : ''}\n${boundedDiagnostic(
      dev.output(),
    )}`,
  );
}

function httpRequest(url) {
  return new Promise((resolve, reject) => {
    const request = nodeHttpRequest(url, { method: 'GET' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2 * 1024 * 1024) {
          request.destroy(new Error('packed HTTP probe response exceeded 2 MiB'));
        }
      });
      response.once('end', () => resolve({ body, status: response.statusCode ?? 0 }));
    });
    request.setTimeout(2_000, () => request.destroy(new Error('packed HTTP probe timed out')));
    request.once('error', reject);
    request.end();
  });
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

async function stopChildProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalChildTree(child, 'SIGTERM');
  if (await waitForExit(child, 3_000)) return;
  signalChildTree(child, 'SIGKILL');
  await waitForExit(child, 3_000);
}

function signalChildTree(child, signal) {
  try {
    if (process.platform !== 'win32' && child.pid !== undefined) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The process may have exited between the status check and signal delivery.
  }
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
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

function runPackedCli(packedRelease, cwd, args, timeoutMs) {
  return runCommand(
    process.execPath,
    [path.join(packedRelease.packageRoot('@kovojs/cli'), 'dist', 'bin.mjs'), ...args],
    cwd,
    knownFailurePackedEnvironment(packedRelease, {
      BETTER_AUTH_URL: null,
      NODE_ENV: 'development',
    }),
    timeoutMs,
  );
}

function runCommand(executable, args, cwd, env, timeoutMs) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    env,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });
  if (result.error) {
    throw new Error(`packed command failed to execute: ${result.error.message}`);
  }
  if (result.signal || result.status === null) {
    throw new Error(
      `packed command did not return an exit status: ${result.signal ?? 'unknown signal'}`,
    );
  }
  return result;
}

async function runBoundedCommand(executable, args, cwd, env, timeoutMs, memoryCeilingMiB) {
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
 * Keep the auth-origin reproducer focused when an unrelated stylesheet diagnostic is present.
 * This changes no auth, origin, server, route, or environment configuration; retirement still
 * requires the exact packed golden journey named in the register.
 */
function isolateAuthOriginFixture(appRoot) {
  const appPath = path.join(appRoot, 'src', 'app.tsx');
  const source = readFileSync(appPath, 'utf8');
  const declaration =
    "const stylesheets = [stylesheet('./styles.css', { theme: appTheme })] as const;";
  if (!source.includes(declaration)) {
    throw new Error('packed starter no longer exposes the auth-origin minimization sentinel');
  }
  writeFileSync(appPath, source.replace(declaration, 'const stylesheets = [] as const;'), 'utf8');
}

/**
 * Model the two non-package artifacts present after the documented install step without invoking
 * an installer: the lockfile identity required by SPEC §5.2.3 and formatter-normalized package
 * metadata. Packed dependencies remain the only executable framework input.
 */
function prepareInstalledScaffoldFixture(appRoot) {
  const manifestPath = path.join(appRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(
    path.join(appRoot, 'pnpm-lock.yaml'),
    'lockfileVersion: 9.0\n# authenticated packed known-failure fixture\n',
    'utf8',
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
