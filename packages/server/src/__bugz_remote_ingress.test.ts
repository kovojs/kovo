import { createServer } from 'node:http';
import { connect as connectHttp2, createServer as createHttp2Server } from 'node:http2';
import type { AddressInfo } from 'node:net';
import { customVerifier } from '@kovojs/core/webhooks';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { endpoint } from './endpoint.js';
import { mutation } from './mutation.js';
import { toNodeHandler } from './node.js';
import { s } from './schema.js';

describe('remote ingress adversarial proofs', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()!();
  });

  // @kovo-security-classifier-corpus node-fetch-method-identity-closed
  it('rejects HTTP/2 method identities that Fetch would canonicalize before dispatch', async () => {
    const rawMethods: string[] = [];
    const observedMethods: string[] = [];
    let writes = 0;
    const appHandler = createRequestHandler(
      createApp({
        endpoints: [
          endpoint('/machine/purge', {
            csrf: false,
            csrfJustification: 'machine-call extension-method identity proof',
            handler: () =>
              new Response('purged', {
                headers: {
                  'Cache-Control': 'no-store',
                  'Content-Type': 'text/plain; charset=utf-8',
                },
              }),
            method: 'PURGE',
            reason: 'extension-method identity proof',
            response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
          }),
        ],
        mutations: [
          mutation('audit/lowercase-h2-write', {
            csrf: false,
            csrfJustification: 'machine-call method differential proof',
            handler: () => {
              writes += 1;
              return { ok: true };
            },
            input: s.object({}),
          }),
        ],
      }),
    );
    const adapted = toNodeHandler(async (request) => {
      observedMethods.push(request.method);
      return appHandler(request);
    });
    const server = createHttp2Server(((request, response) => {
      rawMethods.push(request.method);
      return adapted(request as never, response as never);
    }) as never);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    );

    const address = server.address() as AddressInfo;
    const client = connectHttp2(`http://127.0.0.1:${address.port}`);
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          client.once('close', resolve);
          client.close();
        }),
    );

    const request = (method: string, path = '/_m/audit/lowercase-h2-write') =>
      new Promise<{ body: string; status: number }>((resolve, reject) => {
        const stream = client.request({
          ':authority': 'app.example',
          ':method': method,
          ':path': path,
          'content-type': 'application/x-www-form-urlencoded',
        });
        let body = '';
        let status = 0;
        stream.setEncoding('utf8');
        stream.on('response', (headers) => {
          status = Number(headers[':status']);
        });
        stream.on('data', (chunk) => {
          body += chunk;
        });
        stream.once('error', reject);
        stream.once('end', () => resolve({ body, status }));
        stream.end();
      });

    await expect(request('post')).resolves.toEqual({ body: 'Bad Request', status: 400 });
    await expect(request('PoSt')).resolves.toEqual({ body: 'Bad Request', status: 400 });
    await expect(request('POST')).resolves.toEqual({ body: '', status: 303 });
    await expect(request('purge', '/machine/purge')).resolves.toEqual({
      body: 'Method Not Allowed',
      status: 405,
    });
    await expect(request('PURGE', '/machine/purge')).resolves.toEqual({
      body: 'purged',
      status: 200,
    });
    expect(rawMethods).toEqual(['post', 'PoSt', 'POST', 'purge', 'PURGE']);
    expect(observedMethods).toEqual(['POST', 'purge', 'PURGE']);
    expect(writes).toBe(1);
  });

  // @kovo-security-classifier-corpus node-fetch-authority-identity-closed
  it('rejects HTTP/2 authorities that URL would normalize before app policy', async () => {
    const observed: Array<{ host: string | null; url: string }> = [];
    const adapted = toNodeHandler((request) => {
      observed.push({ host: request.headers.get('host'), url: request.url });
      return Response.json(observed.at(-1));
    });
    const server = createHttp2Server(((request, response) =>
      adapted(request as never, response as never)) as never);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    );

    const address = server.address() as AddressInfo;
    const client = connectHttp2(`http://127.0.0.1:${address.port}`);
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          client.once('close', resolve);
          client.close();
        }),
    );

    const request = (authority: string) =>
      new Promise<{ body: string; status: number }>((resolve, reject) => {
        const stream = client.request({
          ':authority': authority,
          ':method': 'GET',
          ':path': '/authority',
        });
        let body = '';
        let status = 0;
        stream.setEncoding('utf8');
        stream.on('response', (headers) => {
          status = Number(headers[':status']);
        });
        stream.on('data', (chunk) => {
          body += chunk;
        });
        stream.once('error', reject);
        stream.once('end', () => resolve({ body, status }));
        stream.end();
      });

    await expect(request('%65xample.com')).resolves.toEqual({
      body: 'Bad Request',
      status: 400,
    });
    await expect(request('app.example:8443')).resolves.toEqual({
      body: JSON.stringify({
        host: 'app.example:8443',
        url: 'http://app.example:8443/authority',
      }),
      status: 200,
    });
    await expect(request('[2001:db8::1]:8443')).resolves.toEqual({
      body: JSON.stringify({
        host: '[2001:db8::1]:8443',
        url: 'http://[2001:db8::1]:8443/authority',
      }),
      status: 200,
    });
    expect(observed).toHaveLength(2);
  });

  it('rejects endpoint cache and media-type lookalikes before they cross the Node wire', async () => {
    const privateReport = endpoint('/private-report', {
      auth: {
        kind: 'custom',
        name: 'private-report-key',
        verify: customVerifier(
          'private-report-key',
          (request) => request.headers.get('x-api-key') === 'accepted',
        ),
      },
      handler: () =>
        new Response('account=alice', {
          headers: {
            'Cache-Control': 'public, max-age=300, x-private',
            'Content-Type': 'text/plain; charset=utf-8',
          },
        }),
      method: 'GET',
      reason: 'authenticated private report cache-posture proof',
      response: { appOwnedSafety: true, body: 'text', cache: 'private' },
    });
    const jsonApi = endpoint('/json-api', {
      handler: () =>
        new Response('<script>globalThis.endpointPostureEscaped = true</script>', {
          headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/html; profile=json',
          },
        }),
      method: 'GET',
      reason: 'declared JSON media-type posture proof',
      response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
    });
    const server = createServer(
      toNodeHandler(createRequestHandler(createApp({ endpoints: [privateReport, jsonApi] }))),
    );
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    );
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;

    const privateResponse = await fetch(`${origin}/private-report`, {
      headers: { 'X-Api-Key': 'accepted' },
    });
    expect.soft(privateResponse.status).toBe(500);
    expect.soft(privateResponse.headers.get('cache-control')).toBe('private, no-store');
    await expect.soft(privateResponse.text()).resolves.toBe('Server Error');

    const jsonResponse = await fetch(`${origin}/json-api`);
    expect.soft(jsonResponse.status).toBe(500);
    expect.soft(jsonResponse.headers.get('content-type')).toBe('application/json');
    await expect.soft(jsonResponse.json()).resolves.toEqual({ code: 'SERVER_ERROR', payload: {} });
  });
});
