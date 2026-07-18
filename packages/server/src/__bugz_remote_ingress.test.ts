import { connect as connectHttp2, createServer as createHttp2Server } from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
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

    const request = (method: string) =>
      new Promise<{ body: string; status: number }>((resolve, reject) => {
        const stream = client.request({
          ':authority': 'app.example',
          ':method': method,
          ':path': '/_m/audit/lowercase-h2-write',
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
    expect(rawMethods).toEqual(['post', 'PoSt', 'POST']);
    expect(observedMethods).toEqual(['POST']);
    expect(writes).toBe(1);
  });
});
