import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

interface EndpointPostureFact {
  endpoint: string;
  failures: string[];
  observed: boolean;
  site: string;
}

describe('endpoint posture gate', () => {
  it('records declared endpoint fixture posture for kovo check', async () => {
    const previous = process.env.KOVO_VERIFY_ENDPOINT_POSTURE;
    process.env.KOVO_VERIFY_ENDPOINT_POSTURE = '1';

    try {
      const fact = await healthEndpointPosture();
      await mkdir('.kovo', { recursive: true });
      const graph = await readEndpointGraph();
      await writeFile(
        '.kovo/endpoint-posture.json',
        `${JSON.stringify({ endpoints: graph.endpoints, endpointPosture: [fact] }, null, 2)}\n`,
        'utf8',
      );

      expect(fact.observed).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.KOVO_VERIFY_ENDPOINT_POSTURE;
      else process.env.KOVO_VERIFY_ENDPOINT_POSTURE = previous;
    }
  });
});

async function healthEndpointPosture(): Promise<EndpointPostureFact> {
  const failures: string[] = [];
  let observed = false;
  let server: ChildProcessWithoutNullStreams | undefined;

  try {
    const port = await reservePort();
    server = spawn(process.execPath, ['dist/server/server.mjs'], {
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        KOVO_VERIFY_ENDPOINT_POSTURE: '1',
        NODE_ENV: 'test',
        PORT: String(port),
      },
    });
    let output = '';
    server.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    server.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });

    const response = await fetchWhenReady(`http://127.0.0.1:${port}/api/health`, server, () =>
      output.trim(),
    );
    observed = true;

    if (response.status !== 200) failures.push(`expected status 200, got ${response.status}`);
    if (!/\bno-store\b/iu.test(response.headers.get('cache-control') ?? '')) {
      failures.push('declared cache=no-store but response lacks Cache-Control: no-store');
    }
    if (!/\bjson\b/iu.test(response.headers.get('content-type') ?? '')) {
      failures.push('declared body=json but response content type is not JSON');
    }
    if (response.headers.has('kovo-reauth')) {
      failures.push('reserved response header Kovo-* was written without declaration');
    }
    await response.arrayBuffer();
  } catch (error) {
    observed = true;
    failures.push(error instanceof Error ? error.message : 'endpoint fixture threw');
  } finally {
    await stopProcess(server);
  }

  return {
    endpoint: 'GET /api/health',
    failures,
    observed,
    site: 'src/endpoint-posture.test.ts',
  };
}

async function reservePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  if (address === null || typeof address === 'string') {
    probe.close();
    throw new Error('endpoint posture could not reserve a local TCP port');
  }
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function fetchWhenReady(
  url: string,
  server: ChildProcessWithoutNullStreams,
  output: () => string,
): Promise<Response> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`endpoint posture server exited before ready: ${output()}`);
    }
    try {
      return await fetch(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`endpoint posture server did not become ready: ${output()}`);
}

async function stopProcess(server: ChildProcessWithoutNullStreams | undefined): Promise<void> {
  if (server === undefined || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => server.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

async function readEndpointGraph(): Promise<{ endpoints: unknown[] }> {
  let source: string;
  try {
    source = await readFile('dist/.kovo/graph.json', 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { endpoints: [] };
    }
    throw error;
  }

  const graph: unknown = JSON.parse(source);
  if (
    typeof graph !== 'object' ||
    graph === null ||
    !('endpoints' in graph) ||
    !Array.isArray(graph.endpoints)
  ) {
    throw new Error('dist/.kovo/graph.json does not contain endpoint audit facts');
  }
  return { endpoints: graph.endpoints };
}
