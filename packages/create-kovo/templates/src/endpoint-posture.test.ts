import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { requestHandler } from './app.js';

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

  try {
    const response = await requestHandler(new Request('https://app.test/api/health'));
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
  }

  return {
    endpoint: 'GET /api/health',
    failures,
    observed,
    site: 'src/endpoint-posture.test.ts',
  };
}

async function readEndpointGraph(): Promise<{ endpoints: unknown[] }> {
  const graph = JSON.parse(await readFile('dist/.kovo/graph.json', 'utf8')) as unknown;
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
