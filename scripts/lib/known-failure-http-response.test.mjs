import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';

import { afterEach, describe, expect, it } from 'vitest';

import {
  isKnownFailurePackedHealthResponse,
  requestKnownFailureHttpResponse,
} from './known-failure-http-response.mjs';

const servers = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise((resolve, reject) =>
            server.close((error) => (error === undefined ? resolve() : reject(error))),
          ),
      ),
  );
});

describe('known-failure HTTP response deadline', () => {
  it('performs the generated starter health GET with canonical JSON negotiation', async () => {
    let observedAccept;
    let observedMethod;
    const url = await serve((request, response) => {
      observedAccept = request.headers.accept;
      observedMethod = request.method;
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      });
      response.end('{"ok":true}');
    });

    const health = await requestKnownFailureHttpResponse(url, 1_000, {
      accept: 'application/json',
    });

    expect(health).toMatchObject({
      body: '{"ok":true}',
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      },
      status: 200,
    });
    expect(isKnownFailurePackedHealthResponse(health)).toBe(true);
    expect(observedAccept).toBe('application/json');
    expect(observedMethod).toBe('GET');
    expect(isKnownFailurePackedHealthResponse({ body: '', headers: {}, status: 404 })).toBe(false);
  });

  it('rejects every request option except the canonical JSON accept posture', () => {
    expect(() =>
      requestKnownFailureHttpResponse('http://127.0.0.1/', 1_000, { accept: 'text/html' }),
    ).toThrow('packed HTTP request accept must be application/json when provided');
    expect(() =>
      requestKnownFailureHttpResponse('http://127.0.0.1/', 1_000, { headers: {} }),
    ).toThrow('packed HTTP request options may contain only accept');
  });

  it('cannot be extended past its absolute deadline by trickled response bytes', async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('x');
      const interval = setInterval(() => response.write('x'), 5);
      response.once('close', () => clearInterval(interval));
    });
    const startedAt = performance.now();

    await expect(requestKnownFailureHttpResponse(url, 100)).rejects.toThrow(
      'packed HTTP probe exceeded its 100ms absolute deadline',
    );
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });
});

async function serve(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('test HTTP server did not bind an IP port');
  }
  return `http://127.0.0.1:${String(address.port)}/`;
}
