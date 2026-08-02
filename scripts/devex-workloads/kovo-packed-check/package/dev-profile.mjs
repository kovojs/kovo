import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { SOURCE_DIAGNOSTIC_VARIANT, SOURCE_PATH, SOURCE_VARIANTS } from './workload.mjs';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 1024 * 1024;
const READY_TIMEOUT_MS = 60_000;
const EDIT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 5;

function hasCompleteKovoDevReadyReport(stdout, origin) {
  const lines = stdout.replaceAll('\r\n', '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^Kovo dev ready in \d+ms$/u.test(lines[index] ?? '')) continue;
    const database = lines[index + 5] ?? '';
    if (
      (lines[index + 1] ?? '') === `  Local URL    ${origin}/` &&
      (lines[index + 2] ?? '') === `  Network URL  ${origin}/ (loopback only)` &&
      (lines[index + 3] ?? '') === '  Mode         development' &&
      (lines[index + 4] ?? '') === '  App          src/app.tsx' &&
      database.startsWith('  Database     ') &&
      database.length > '  Database     '.length &&
      (lines[index + 6] ?? '') === `  Devtool      ${origin}/__kovo`
    ) {
      return true;
    }
  }
  return false;
}

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function monotonicMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function delay(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function appendBounded(current, chunk) {
  const next = current + chunk.toString('utf8');
  return Buffer.byteLength(next) <= MAX_TRANSCRIPT_BYTES
    ? next
    : next.slice(next.length - MAX_TRANSCRIPT_BYTES);
}

async function freeLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Kovo dev benchmark could not allocate a loopback port');
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function startKovoDevServer(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const port = await (options.freePort ?? freeLoopbackPort)();
  const cli = path.resolve(cwd, 'node_modules/@kovojs/cli/dist/bin.mjs');
  const child = spawn(
    process.execPath,
    [cli, 'dev', './src/app.tsx', '--host', '127.0.0.1', '--port', String(port), '--strict-port'],
    {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  let exit = null;
  const origin = `http://127.0.0.1:${port}`;
  child.stdout.on('data', (chunk) => {
    stdout = appendBounded(stdout, chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr = appendBounded(stderr, chunk);
  });
  const exited = new Promise((resolve) => {
    child.once('error', (error) => {
      exit = { error, signal: null, status: null };
      resolve(exit);
    });
    child.once('exit', (status, signal) => {
      if (exit === null) exit = { error: null, signal, status };
      resolve(exit);
    });
  });

  return {
    assertRunning() {
      if (exit === null) return;
      throw new Error(
        `kovo dev exited before benchmark evidence: status=${String(
          exit.status,
        )} signal=${String(exit.signal)} ${exit.error?.message ?? stderr ?? stdout}`.trim(),
      );
    },
    isReady() {
      return hasCompleteKovoDevReadyReport(stdout, origin);
    },
    origin,
    transcript() {
      return { stderr, stdout };
    },
    async stop() {
      if (exit !== null) return;
      child.kill('SIGTERM');
      const stopped = await Promise.race([exited.then(() => true), delay(5_000).then(() => false)]);
      if (!stopped && exit === null) {
        child.kill('SIGKILL');
        await exited;
      }
    },
  };
}

async function requestDocument(origin) {
  const response = await fetch(`${origin}/`, {
    headers: { Accept: 'text/html' },
    redirect: 'manual',
    signal: AbortSignal.timeout(2_000),
  });
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
    throw new Error('Kovo dev benchmark response exceeded its 2 MiB evidence bound');
  }
  return { body, status: response.status };
}

export async function waitForDevEvidence(options) {
  const clock = options.clock ?? monotonicMs;
  const pause = options.delay ?? delay;
  const started = clock();
  const deadline = started + options.timeoutMs;
  let last = 'no response';
  for (;;) {
    options.server.assertRunning();
    try {
      const response = await options.request(options.server.origin);
      const evidence = options.accept(response);
      const ready = options.server.isReady?.() ?? true;
      if (evidence !== null && ready) {
        return { durationMs: Math.max(0, clock() - started), evidence };
      }
      last = ready
        ? `status=${response.status} digest=${digest(response.body)}`
        : 'complete kovo dev ready report pending';
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (clock() >= deadline) {
      const transcript = options.server.transcript();
      throw new Error(
        `${options.label} timed out after ${options.timeoutMs}ms; last=${last}; stdout=${transcript.stdout}; stderr=${transcript.stderr}`,
      );
    }
    await pause(POLL_INTERVAL_MS);
  }
}

function readyEvidence(response, revision) {
  const marker = `data-revision="${revision}"`;
  if (
    response.status !== 200 ||
    !response.body.includes('Kovo packed reference app') ||
    !response.body.includes(marker)
  ) {
    return null;
  }
  return { bodyDigest: digest(response.body) };
}

function diagnosticEvidence(response) {
  if (
    response.status !== 500 ||
    !response.body.includes('KV235') ||
    !response.body.includes('counter-island.tsx')
  ) {
    return null;
  }
  return { bodyDigest: digest(response.body), code: 'KV235' };
}

export function formatDevProfileMarker(evidence) {
  return `kovo-dev-profile/v1 ${JSON.stringify(evidence)}\n`;
}

export async function runDevProfile(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const sourcePath = path.resolve(cwd, SOURCE_PATH);
  const readSource = options.readSource ?? (() => readFileSync(sourcePath, 'utf8'));
  const writeSource =
    options.writeSource ?? ((source) => writeFileSync(sourcePath, source, 'utf8'));
  const startServer =
    options.startServer ?? (() => startKovoDevServer({ cwd, freePort: options.freePort }));
  const request = options.request ?? requestDocument;
  const clock = options.clock ?? monotonicMs;
  const pause = options.delay ?? delay;

  if (!SOURCE_VARIANTS.includes(readSource())) {
    throw new Error('Kovo dev benchmark source does not match a reviewed starting revision');
  }
  writeSource(SOURCE_VARIANTS[0]);

  let coldServer;
  let warmServer;
  try {
    const coldStarted = clock();
    coldServer = await startServer();
    const cold = await waitForDevEvidence({
      accept: (response) => readyEvidence(response, 'zero'),
      clock,
      delay: pause,
      label: 'cold dev readiness',
      request,
      server: coldServer,
      timeoutMs: READY_TIMEOUT_MS,
    });
    cold.durationMs = Math.max(0, clock() - coldStarted);
    await coldServer.stop();
    coldServer = undefined;

    const warmStarted = clock();
    warmServer = await startServer();
    const warm = await waitForDevEvidence({
      accept: (response) => readyEvidence(response, 'zero'),
      clock,
      delay: pause,
      label: 'warm dev readiness',
      request,
      server: warmServer,
      timeoutMs: READY_TIMEOUT_MS,
    });
    warm.durationMs = Math.max(0, clock() - warmStarted);

    writeSource(SOURCE_DIAGNOSTIC_VARIANT);
    const diagnostic = await waitForDevEvidence({
      accept: diagnosticEvidence,
      clock,
      delay: pause,
      label: 'edit-to-diagnostic',
      request,
      server: warmServer,
      timeoutMs: EDIT_TIMEOUT_MS,
    });

    writeSource(SOURCE_VARIANTS[1]);
    const served = await waitForDevEvidence({
      accept: (response) => readyEvidence(response, 'one'),
      clock,
      delay: pause,
      label: 'edit-to-served-result',
      request,
      server: warmServer,
      timeoutMs: EDIT_TIMEOUT_MS,
    });

    return {
      cold: {
        bodyDigest: cold.evidence.bodyDigest,
        durationMs: cold.durationMs,
      },
      diagnostic: {
        bodyDigest: diagnostic.evidence.bodyDigest,
        code: diagnostic.evidence.code,
        durationMs: diagnostic.durationMs,
        sourceDigest: digest(Buffer.from(SOURCE_DIAGNOSTIC_VARIANT, 'utf16le')),
      },
      served: {
        bodyDigest: served.evidence.bodyDigest,
        durationMs: served.durationMs,
        revision: 1,
        sourceDigest: digest(Buffer.from(SOURCE_VARIANTS[1], 'utf16le')),
      },
      warm: {
        bodyDigest: warm.evidence.bodyDigest,
        durationMs: warm.durationMs,
      },
    };
  } finally {
    await coldServer?.stop();
    await warmServer?.stop();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(formatDevProfileMarker(await runDevProfile()));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
