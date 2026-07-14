import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname } from 'node:path';

import { installEgressFloorSync } from '../../server/src/egress-bootstrap.js';

export interface BuiltServerProcess {
  child?: ChildProcessWithoutNullStreams;
  readonly entryPath: string;
  origin?: string;
  output: string;
}

export function builtServerProcess(entryPath: string): BuiltServerProcess {
  return { entryPath, output: '' };
}

export async function listenBuiltServerProcess(server: BuiltServerProcess): Promise<string> {
  if (server.origin !== undefined) return server.origin;

  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const address = reservation.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected built Kovo server port reservation to produce a TCP address.');
  }
  await new Promise<void>((resolve, reject) => {
    reservation.close((error) => (error ? reject(error) : resolve()));
  });

  const origin = `http://127.0.0.1:${address.port}`;
  // SPEC §6.6: the emitted entry intentionally locks its classifier realm. Boot it in the same
  // child-process boundary used by production instead of irreversibly locking Vitest's host realm.
  installEgressFloorSync(undefined, () => {}, { allowPrivateNetwork: true });
  const child = spawn(process.execPath, [server.entryPath], {
    cwd: dirname(server.entryPath),
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      NODE_ENV: process.env.NODE_ENV ?? 'test',
      PORT: String(address.port),
    },
    stdio: 'pipe',
  });
  server.child = child;
  child.stdout.on('data', (chunk) => {
    server.output += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    server.output += String(chunk);
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(
        `Built Kovo server exited before readiness (code ${String(child.exitCode)}):\n${server.output}`,
      );
    }
    try {
      const response = await fetch(origin, { cache: 'no-store' });
      await response.arrayBuffer();
      server.origin = origin;
      return origin;
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw new Error(`Built Kovo server did not become ready: ${String(lastError)}\n${server.output}`);
}

export async function closeBuiltServerProcess(server: BuiltServerProcess): Promise<void> {
  const child = server.child;
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;

  const gracefulExit = waitForBuiltServerExit(child, 2_000);
  signalBuiltServerProcess(child, 'SIGTERM');
  await gracefulExit;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const forcedExit = waitForBuiltServerExit(child, 2_000);
  signalBuiltServerProcess(child, 'SIGKILL');
  await forcedExit;
}

async function waitForBuiltServerExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    delay(timeoutMs),
  ]);
}

function signalBuiltServerProcess(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {}
  }
  child.kill(signal);
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
