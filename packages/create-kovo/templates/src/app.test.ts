import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';

import { createKovoTestHarness, type KovoTestContext } from '@kovojs/test/harness';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import starterApp from './app.js';

// Compile-time contracts come from the imported opaque app. Runtime graph facts come from the
// explicitly selected successful build, whose completion token, app identity, and source/config
// digests the public harness verifies before it returns (SPEC §§5.2.4, 12).
let harness: KovoTestContext<typeof starterApp>;
let appServer: ChildProcessWithoutNullStreams | undefined;
let appServerError: Error | undefined;
let appOrigin = '';
let appServerOutput = '';

beforeAll(async () => {
  const port = await reservePort();
  appOrigin = `http://127.0.0.1:${port}`;
  const environment: Record<string, string | undefined> = {
    ...process.env,
    HOST: '127.0.0.1',
    KOVO_DATA_DIR: '.kovo/pglite-test-server',
    NODE_ENV: 'development',
    PORT: String(port),
  };
  delete environment.BETTER_AUTH_URL;
  appServer = spawn('kovo', ['dev', './src/app.tsx'], {
    env: environment,
  });
  appServer.stdout.on('data', (chunk: Buffer) => {
    appServerOutput += chunk.toString('utf8');
  });
  appServer.stderr.on('data', (chunk: Buffer) => {
    appServerOutput += chunk.toString('utf8');
  });
  appServer.once('error', (error) => {
    appServerError = error;
  });
  const response = await fetchWhenReady(`${appOrigin}/api/health`, appServer);
  await response.body?.cancel();

  harness = await createKovoTestHarness(starterApp, {
    artifact: new URL('../dist/.kovo/graph.json', import.meta.url),
    baseUrl: appOrigin,
    projectRoot: new URL('../', import.meta.url),
  });
}, 90_000);

afterAll(async () => {
  await stopProcess(appServer);
});

describe('starter app public inferred harness', () => {
  it('serves the public health response', async () => {
    const response = await harness.request(new Request(`${appOrigin}/api/health`));

    expect(response).toBeInstanceOf(Response);
    expect(response.status, appServerOutput).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('renders the signed-out route through the app-inferred route union', async () => {
    const page = await harness.page('/login');

    expect(page.html, appServerOutput).toContain('<title>Sign in · Kovo Starter</title>');
    expect(page.html).toContain('<main');
    expect(page.html).toContain('name="email"');
    expect(page.html).toContain('name="password"');
  });
});

async function reservePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  if (address === null || typeof address === 'string') {
    probe.close();
    throw new Error('starter test could not reserve a local TCP port');
  }
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function fetchWhenReady(
  url: string,
  server: ChildProcessWithoutNullStreams,
): Promise<Response> {
  const deadline = Date.now() + 85_000;
  while (Date.now() < deadline) {
    if (appServerError !== undefined) {
      throw new Error(`Kovo dev could not start: ${appServerError.message}`);
    }
    if (hasExited(server)) {
      throw new Error(`Kovo dev exited before ready:\n${appServerOutput.trim()}`);
    }
    try {
      return await fetch(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Kovo dev did not become ready:\n${appServerOutput.trim()}`);
}

async function stopProcess(server: ChildProcessWithoutNullStreams | undefined): Promise<void> {
  if (server === undefined || hasExited(server)) return;
  server.kill('SIGTERM');
  await waitForExit(server);
  if (hasExited(server)) return;
  server.kill('SIGKILL');
  await waitForExit(server);
}

function hasExited(server: ChildProcessWithoutNullStreams): boolean {
  return server.exitCode !== null || server.signalCode !== null;
}

async function waitForExit(server: ChildProcessWithoutNullStreams): Promise<void> {
  if (hasExited(server)) return;
  await Promise.race([
    new Promise<void>((resolve) => server.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
}
