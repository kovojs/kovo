import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deserialize, serialize } from 'node:v8';

import type { PgliteStatementInput } from '../pglite.js';
import type { DbVerificationDiagnostic } from '../verifier-diagnostics.js';

const requireFromBootFixture = createRequire(import.meta.url);
const viteEntryUrl = pathToFileURL(requireFromBootFixture.resolve('vite')).href;
const compilerBootstrapPath = requireFromBootFixture.resolve(
  '@kovojs/compiler/internal/security-bootstrap',
);
const serverRuntimeBootstrapPath = requireFromBootFixture.resolve('@kovojs/server/runtime-bootstrap');
const childRuntimePath = requireFromBootFixture.resolve(
  '@kovojs/test/internal/integration/boot-fixture-child',
);
const FIXTURE_RPC_MAX_BYTES = 8 * 1024 * 1024;
const FIXTURE_RPC_TIMEOUT_MS = 60_000;

/** A process-isolated database facade owned by a booted fixture worker. */
export interface FixtureDatabase {
  exec(statement: PgliteStatementInput): Promise<unknown[]>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: PgliteStatementInput,
    params?: readonly unknown[],
  ): Promise<Row[]>;
  read<Row extends Record<string, unknown> = Record<string, unknown>>(
    table: string,
  ): Promise<Row[]>;
  write(table: string, value: Record<string, unknown>): Promise<void>;
}

/** A booted fixture server whose security-locked runtime lives in a dedicated child process. */
export interface BootedFixture {
  /** Process-isolated database facade for assertions and test setup. */
  readonly db: FixtureDatabase;
  /** Runtime DB verification diagnostics collected by the fixture worker. */
  verificationDiagnostics(): Promise<readonly DbVerificationDiagnostic[]>;
  /** `http://host:port` the fixture is served at. */
  readonly origin: string;
  /** Stop the HTTP server, Vite, database, and isolated worker. */
  close(): Promise<void>;
  /** Reset the worker-owned database to a fresh schema + seed for the next test. */
  reset(): Promise<void>;
}

/** Options for `bootFixture`. */
export interface BootFixtureOptions {
  /** Fixture entry module id relative to the fixture dir. Default `/app.tsx`. */
  entry?: string;
  /** Bind host. Default `127.0.0.1`. */
  host?: string;
}

type FixtureRpcOperation =
  | 'close'
  | 'dbExec'
  | 'dbQuery'
  | 'dbRead'
  | 'dbWrite'
  | 'reset'
  | 'verificationDiagnostics';

interface FixtureRpcRequest {
  args: readonly unknown[];
  id: number;
  operation: FixtureRpcOperation;
  type: 'request';
}

interface FixtureRpcReady {
  origin: string;
  type: 'ready';
}

interface FixtureRpcResponse {
  error?: { message: string; name: string; stack?: string };
  id: number;
  ok: boolean;
  type: 'response';
  value?: unknown;
}

interface PendingRpc {
  reject(error: unknown): void;
  resolve(value: unknown): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface AuthenticatedFixtureMessage {
  mac: Uint8Array;
  payload: Uint8Array;
  type: 'kovo-fixture-authenticated';
}

/**
 * Boot a fixture in a pristine child process whose whole lifetime owns the irreversible request
 * runtime lock. The parent test runner never shares timer or intrinsic state with authored code
 * (SPEC §6.6 rule 6).
 */
export async function bootFixture(
  fixtureDir: string,
  options: BootFixtureOptions = {},
): Promise<BootedFixture> {
  if (typeof fixtureDir !== 'string' || !isAbsolute(fixtureDir)) {
    throw new TypeError('bootFixture() fixtureDir must be an absolute path.');
  }
  const secret = randomBytes(32);
  const child = spawn(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      '--input-type=commonjs',
      '--eval',
      fixtureWorkerSource(fixtureDir, options),
    ],
    { serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  );
  const stderr: string[] = [];
  let stderrBytes = 0;
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    if (stderrBytes >= FIXTURE_RPC_MAX_BYTES) return;
    const remaining = FIXTURE_RPC_MAX_BYTES - stderrBytes;
    const bounded = Buffer.from(chunk).subarray(0, remaining).toString();
    stderrBytes += Buffer.byteLength(bounded);
    stderr.push(bounded);
  });

  const pending = new Map<number, PendingRpc>();
  let nextId = 1;
  let closed = false;
  let readyResolve!: (origin: string) => void;
  let readyReject!: (error: unknown) => void;
  const ready = new Promise<string>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const readyTimeout = setTimeout(() => {
    readyReject(new Error('Kovo fixture worker did not become ready within 60 seconds.'));
  }, FIXTURE_RPC_TIMEOUT_MS);
  readyTimeout.unref();

  child.once('spawn', () => {
    child.send({ secret, type: 'kovo-fixture-init' }, (error) => {
      if (error !== null) readyReject(error);
    });
  });
  child.on('message', (envelope: unknown) => {
    const message = authenticatedFixturePayload(secret, envelope);
    if (message === undefined) return;
    if (isFixtureRpcReady(message)) {
      clearTimeout(readyTimeout);
      readyResolve(message.origin);
      return;
    }
    if (!isFixtureRpcResponse(message)) return;
    const waiter = pending.get(message.id);
    if (waiter === undefined) return;
    pending.delete(message.id);
    clearTimeout(waiter.timeout);
    if (message.ok) waiter.resolve(message.value);
    else waiter.reject(remoteFixtureError(message.error));
  });
  child.once('error', (error) => {
    clearTimeout(readyTimeout);
    readyReject(error);
    rejectPending(pending, error);
  });
  child.once('exit', (code, signal) => {
    clearTimeout(readyTimeout);
    closed = true;
    const detail = stderr.join('').trim();
    const error = new Error(
      `Kovo fixture worker exited before shutdown (code ${String(code)}, signal ${String(signal)}).${detail === '' ? '' : `\n${detail}`}`,
    );
    readyReject(error);
    rejectPending(pending, error);
  });

  const origin = await ready.catch(async (error) => {
    await terminateFixtureChild(child);
    throw error;
  });

  const call = <Result>(operation: FixtureRpcOperation, args: readonly unknown[] = []) => {
    if (closed || child.connected !== true) {
      return Promise.reject(new Error('Kovo fixture worker is closed.'));
    }
    const id = nextId;
    nextId += 1;
    return new Promise<Result>((resolve, reject) => {
      const request: FixtureRpcRequest = { args, id, operation, type: 'request' };
      let requestBytes: number;
      try {
        requestBytes = serialize(request).byteLength;
      } catch (error) {
        reject(new TypeError(`Kovo fixture RPC arguments are not serializable: ${String(error)}`));
        return;
      }
      if (requestBytes > FIXTURE_RPC_MAX_BYTES) {
        reject(new RangeError('Kovo fixture RPC request exceeds the 8 MiB message limit.'));
        return;
      }
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Kovo fixture RPC ${operation} timed out after 60 seconds.`));
      }, FIXTURE_RPC_TIMEOUT_MS);
      timeout.unref();
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });
      try {
        child.send(authenticatedFixtureMessage(secret, request), (error) => {
          if (error === null) return;
          pending.delete(id);
          clearTimeout(timeout);
          reject(error);
        });
      } catch (error) {
        pending.delete(id);
        clearTimeout(timeout);
        reject(error);
      }
    });
  };

  const db: FixtureDatabase = {
    exec: (statement) => call('dbExec', [statement]),
    query: (statement, params = []) => call('dbQuery', [statement, params]),
    read: (table) => call('dbRead', [table]),
    write: (table, value) => call('dbWrite', [table, value]),
  };

  return {
    db,
    origin,
    verificationDiagnostics: () => call('verificationDiagnostics'),
    async close() {
      if (closed) return;
      try {
        await call('close');
      } finally {
        await terminateFixtureChild(child);
        closed = true;
      }
    },
    reset: () => call('reset'),
  };
}

function fixtureWorkerSource(fixtureDir: string, options: BootFixtureOptions): string {
  return `
const { existsSync } = require('node:fs');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { registerHooks } = require('node:module');
const { deserialize, serialize } = require('node:v8');

void (async () => {
  const nativeProcessDisconnect = process.disconnect.bind(process);
  const nativeProcessOff = process.off.bind(process);
  const nativeProcessOn = process.on.bind(process);
  const nativeProcessSend = process.send.bind(process);
  const secret = await new Promise((resolve) => {
    const receiveSecret = (message) => {
      if (
        message === null ||
        typeof message !== 'object' ||
        message.type !== 'kovo-fixture-init' ||
        !Buffer.isBuffer(message.secret) ||
        message.secret.byteLength !== 32
      ) {
        return;
      }
      nativeProcessOff('message', receiveSecret);
      resolve(Buffer.from(message.secret));
    };
    nativeProcessOn('message', receiveSecret);
  });
  const usedRequestIds = new Set();
  let fixture;
  let runner;

  // Workspace packages publish TypeScript source in development. This trusted source hook is
  // established before lockdown and only maps relative framework .js edges to existing .ts
  // files; packed .mjs entries need no rewrite.
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
        const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
        if (existsSync(candidate)) return nextResolve(candidate.href, context);
      }
      return nextResolve(specifier, context);
    },
  });

  // SPEC §6.6 rule 6: compiler first installs its audited Vite Map-instance exception and the
  // shared request lock. Only then may the worker import Vite or any authored fixture module.
  const compilerBootstrap = await import(${JSON.stringify(pathToFileURL(compilerBootstrapPath).href)});
  if (typeof compilerBootstrap.lockCompilerSecurityRealm !== 'function') {
    throw new TypeError('Kovo fixture worker could not establish compiler security bootstrap.');
  }
  compilerBootstrap.lockCompilerSecurityRealm();
  await import(${JSON.stringify(pathToFileURL(serverRuntimeBootstrapPath).href)});
  const { createServer } = await import(${JSON.stringify(viteEntryUrl)});

  nativeProcessOn('message', (envelope) => {
    const message = authenticatedPayload(envelope);
    if (message === undefined) return;
    if (
      message === null ||
      typeof message !== 'object' ||
      message.type !== 'request' ||
      !Number.isSafeInteger(message.id) ||
      message.id < 1 ||
      !Array.isArray(message.args) ||
      usedRequestIds.has(message.id)
    ) {
      return;
    }
    usedRequestIds.add(message.id);
    void dispatch(message);
  });

  runner = await createServer({
    appType: 'custom',
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true },
    ssr: { noExternal: [/^@kovojs\\//] },
  });
  const module = await runner.ssrLoadModule(${JSON.stringify(childRuntimePath)});
  fixture = await module.bootFixtureInLockedChild(
    ${JSON.stringify(fixtureDir)},
    ${JSON.stringify(snapshotBootFixtureOptions(options))},
  );
  sendBounded({ type: 'ready', origin: fixture.origin });

  async function dispatch(message) {
    let value;
    try {
      if (fixture === undefined) throw new Error('Kovo fixture worker is not ready.');
      switch (message.operation) {
        case 'dbExec': value = await fixture.db.exec(...message.args); break;
        case 'dbQuery': value = await fixture.db.query(...message.args); break;
        case 'dbRead': value = await fixture.db.read(...message.args); break;
        case 'dbWrite': value = await fixture.db.write(...message.args); break;
        case 'reset': value = await fixture.reset(); break;
        case 'verificationDiagnostics': value = fixture.verificationDiagnostics(); break;
        case 'close':
          await fixture.close();
          await runner.close();
          sendBounded({ type: 'response', id: message.id, ok: true }, () => {
            nativeProcessDisconnect();
          });
          return;
        default: throw new TypeError('Unknown Kovo fixture worker operation.');
      }
      sendBounded({ type: 'response', id: message.id, ok: true, value });
    } catch (error) {
      sendBounded({
        type: 'response',
        id: message.id,
        ok: false,
        error: {
          message: String(error?.message ?? error),
          name: typeof error?.name === 'string' ? error.name : 'Error',
          ...(typeof error?.stack === 'string' ? { stack: error.stack } : {}),
        },
      });
    }
  }

  function sendBounded(message, callback) {
    let response = message;
    try {
      if (serialize(response).byteLength > ${String(FIXTURE_RPC_MAX_BYTES)}) {
        response = {
          type: 'response',
          id: message.id,
          ok: false,
          error: { name: 'RangeError', message: 'Kovo fixture RPC response exceeds the 8 MiB message limit.' },
        };
      }
    } catch {
      response = {
        type: 'response',
        id: message.id,
        ok: false,
        error: { name: 'TypeError', message: 'Kovo fixture RPC response is not serializable.' },
      };
    }
    const payload = serialize(response);
    const mac = createHmac('sha256', secret).update(payload).digest();
    nativeProcessSend(
      { type: 'kovo-fixture-authenticated', payload, mac },
      callback,
    );
  }

  function authenticatedPayload(envelope) {
    if (
      envelope === null ||
      typeof envelope !== 'object' ||
      envelope.type !== 'kovo-fixture-authenticated' ||
      !Buffer.isBuffer(envelope.payload) ||
      !Buffer.isBuffer(envelope.mac) ||
      envelope.payload.byteLength > ${String(FIXTURE_RPC_MAX_BYTES)}
    ) {
      return undefined;
    }
    const expected = createHmac('sha256', secret).update(envelope.payload).digest();
    if (expected.byteLength !== envelope.mac.byteLength || !timingSafeEqual(expected, envelope.mac)) {
      return undefined;
    }
    try {
      return deserialize(envelope.payload);
    } catch {
      return undefined;
    }
  }
})().catch((error) => {
  setImmediate(() => { throw error; });
});
`;
}

function authenticatedFixtureMessage(
  secret: Uint8Array,
  payloadValue: unknown,
): AuthenticatedFixtureMessage {
  const payload = serialize(payloadValue);
  return {
    mac: createHmac('sha256', secret).update(payload).digest(),
    payload,
    type: 'kovo-fixture-authenticated',
  };
}

function authenticatedFixturePayload(secret: Uint8Array, value: unknown): unknown | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { type?: unknown }).type !== 'kovo-fixture-authenticated'
  ) {
    return undefined;
  }
  const payload = (value as { payload?: unknown }).payload;
  const mac = (value as { mac?: unknown }).mac;
  if (
    !Buffer.isBuffer(payload) ||
    !Buffer.isBuffer(mac) ||
    payload.byteLength > FIXTURE_RPC_MAX_BYTES
  ) {
    return undefined;
  }
  const expected = createHmac('sha256', secret).update(payload).digest();
  if (expected.byteLength !== mac.byteLength || !timingSafeEqual(expected, mac)) return undefined;
  try {
    return deserialize(payload);
  } catch {
    return undefined;
  }
}

function isFixtureRpcReady(value: unknown): value is FixtureRpcReady {
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'ready' &&
    typeof (value as { origin?: unknown }).origin === 'string'
  ) {
    const origin = (value as { origin: string }).origin;
    if (origin.length > 2_048) return false;
    try {
      const url = new URL(origin);
      return (
        url.protocol === 'http:' &&
        url.pathname === '/' &&
        url.search === '' &&
        url.hash === '' &&
        (url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === 'localhost') &&
        url.port !== ''
      );
    } catch {
      return false;
    }
  }
  return false;
}

function isFixtureRpcResponse(value: unknown): value is FixtureRpcResponse {
  const id =
    typeof value === 'object' && value !== null ? (value as { id?: unknown }).id : undefined;
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'response' &&
    typeof id === 'number' &&
    Number.isSafeInteger(id) &&
    id > 0 &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  );
}

function remoteFixtureError(error: FixtureRpcResponse['error']): Error {
  const result = new Error(error?.message ?? 'Kovo fixture worker request failed.');
  result.name = error?.name ?? 'Error';
  if (error?.stack !== undefined) result.stack = error.stack;
  return result;
}

function rejectPending(pending: Map<number, PendingRpc>, error: unknown): void {
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timeout);
    waiter.reject(error);
  }
  pending.clear();
}

function snapshotBootFixtureOptions(options: BootFixtureOptions): BootFixtureOptions {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('bootFixture() options must be an object.');
  }
  const keys = Reflect.ownKeys(options);
  for (const key of keys) {
    if (key !== 'entry' && key !== 'host') {
      throw new TypeError(`bootFixture() options has unknown key ${String(key)}.`);
    }
  }
  const result: BootFixtureOptions = {};
  for (const key of ['entry', 'host'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (descriptor === undefined) continue;
    if (!('value' in descriptor) || typeof descriptor.value !== 'string') {
      throw new TypeError(`bootFixture() options.${key} must be an own string value.`);
    }
    result[key] = descriptor.value;
  }
  return Object.freeze(result);
}

async function terminateFixtureChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (child.connected) child.disconnect();
  child.kill('SIGTERM');
  if (await waitForFixtureChildExit(child, 2_000)) return;
  child.kill('SIGKILL');
  if (await waitForFixtureChildExit(child, 5_000)) return;
  throw new Error('Kovo fixture worker did not exit after SIGKILL.');
}

function waitForFixtureChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    timeout.unref();
    child.once('exit', onExit);
  });
}
