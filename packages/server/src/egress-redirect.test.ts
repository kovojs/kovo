import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { EgressBlockedError, frameworkEgressFetch } from './egress.js';
import { installEgressFloorSync, type EgressFloorInstall } from './egress-bootstrap.js';

interface ObservedRequest {
  readonly body: string;
  readonly headers: IncomingHttpHeaders;
  readonly method: string;
  readonly path: string;
  readonly server: 'redirect' | 'target';
}

describe('framework egress redirect enforcement (SPEC §6.6, C9)', () => {
  let redirectServer: http.Server;
  let targetServer: http.Server;
  let redirectPort: number;
  let targetPort: number;
  let floor: EgressFloorInstall | undefined;
  const observed: ObservedRequest[] = [];

  beforeAll(async () => {
    targetServer = http.createServer((request, response) => {
      void observeRequest('target', request, observed).then(() => response.end('target-ok'));
    });
    redirectServer = http.createServer((request, response) => {
      void observeRequest('redirect', request, observed).then(() => {
        const path = request.url ?? '/';
        if (path === '/to-target-307' || path === '/manual' || path === '/private-hop') {
          redirect(response, 307, targetUrl('/received'));
          return;
        }
        if (path === '/to-target-308') {
          redirect(response, 308, targetUrl('/received'));
          return;
        }
        if (path === '/to-target-303') {
          redirect(response, 303, targetUrl('/received'));
          return;
        }
        if (path === '/scheme') {
          redirect(response, 302, 'file:///etc/passwd');
          return;
        }
        if (path === '/loop-a') {
          redirect(response, 302, '/loop-b');
          return;
        }
        if (path === '/loop-b') {
          redirect(response, 302, '/loop-a');
          return;
        }
        const chain = /^\/chain\/(\d+)$/.exec(path);
        if (chain) {
          const hop = Number(chain[1]);
          if (hop < 25) redirect(response, 302, `/chain/${hop + 1}`);
          else response.end('unbounded');
          return;
        }
        response.end('redirect-ok');
      });
    });

    await listen(targetServer);
    targetPort = (targetServer.address() as AddressInfo).port;
    await listen(redirectServer);
    redirectPort = (redirectServer.address() as AddressInfo).port;
  });

  afterEach(() => {
    floor?.uninstall();
    floor = undefined;
    observed.length = 0;
    redirectServer.closeIdleConnections();
    targetServer.closeIdleConnections();
  });

  afterAll(async () => {
    await Promise.all([close(redirectServer), close(targetServer)]);
  });

  it('blocks direct and allowed-to-denied targets while preserving redirect:manual', async () => {
    installPolicy({ allowTargetDestination: false, allowTargetInternal: true });

    await expect(frameworkEgressFetch(targetUrl('/direct'))).rejects.toMatchObject({
      reason: 'destination-allowlist',
    });
    expect(targetRequests()).toHaveLength(0);

    const blocked = await frameworkEgressFetch(redirectUrl('/to-target-307'), {
      method: 'POST',
      body: 'credential-payload',
      headers: { 'x-api-key': 'secret-key' },
    }).catch((error: unknown) => error);
    expect(findEgressBlockedError(blocked)).toMatchObject({ reason: 'destination-allowlist' });
    expect(targetRequests()).toHaveLength(0);
    expect(redirectRequests().at(-1)).toMatchObject({
      body: 'credential-payload',
      method: 'POST',
    });

    const manual = await frameworkEgressFetch(redirectUrl('/manual'), { redirect: 'manual' });
    expect(manual.status).toBe(307);
    expect(manual.headers.get('location')).toBe(targetUrl('/received'));
    expect(targetRequests()).toHaveLength(0);
  });

  it('pins mutable URL and header inputs synchronously before validation yields', async () => {
    installPolicy({ allowTargetDestination: false, allowTargetInternal: true });
    const url = new URL(redirectUrl('/pinned'));
    const headers = new Headers({ 'x-api-key': 'original' });

    const pending = frameworkEgressFetch(url, { headers });
    url.href = targetUrl('/mutated');
    headers.set('x-api-key', 'mutated');

    expect(await (await pending).text()).toBe('redirect-ok');
    expect(redirectRequests().at(-1)).toMatchObject({ path: '/pinned' });
    expect(redirectRequests().at(-1)?.headers['x-api-key']).toBe('original');
    expect(targetRequests()).toHaveLength(0);
  });

  it('preserves native Request, 307, and 308 body semantics while stripping cross-origin credentials', async () => {
    installPolicy({ allowTargetDestination: true, allowTargetInternal: true });

    const input = new Request(redirectUrl('/to-target-307'), {
      method: 'POST',
      body: 'post-body',
      headers: {
        authorization: 'Bearer victim',
        cookie: 'sid=victim',
        'x-api-key': 'reviewed-key',
      },
    });
    const followed307 = await frameworkEgressFetch(input);
    expect(await followed307.text()).toBe('target-ok');
    expect(followed307.redirected).toBe(true);
    expect(targetRequests().at(-1)).toMatchObject({ body: 'post-body', method: 'POST' });
    expect(targetRequests().at(-1)?.headers['x-api-key']).toBe('reviewed-key');
    expect(targetRequests().at(-1)?.headers.authorization).toBeUndefined();
    expect(targetRequests().at(-1)?.headers.cookie).toBeUndefined();

    const followed308 = await frameworkEgressFetch(redirectUrl('/to-target-308'), {
      method: 'PUT',
      body: 'put-body',
      headers: {
        authorization: 'Bearer victim',
        cookie: 'sid=victim',
        'x-api-key': 'reviewed-key-2',
      },
    });
    expect(await followed308.text()).toBe('target-ok');
    expect(targetRequests().at(-1)).toMatchObject({ body: 'put-body', method: 'PUT' });
    expect(targetRequests().at(-1)?.headers['x-api-key']).toBe('reviewed-key-2');
    expect(targetRequests().at(-1)?.headers.authorization).toBeUndefined();
    expect(targetRequests().at(-1)?.headers.cookie).toBeUndefined();
  });

  it('leaves native 303 method/body/header rewriting authoritative', async () => {
    installPolicy({ allowTargetDestination: true, allowTargetInternal: true });

    const response = await frameworkEgressFetch(redirectUrl('/to-target-303'), {
      method: 'POST',
      body: 'discard-me',
      headers: {
        authorization: 'Bearer victim',
        'content-type': 'text/plain',
        'x-api-key': 'keep-me',
      },
    });

    expect(await response.text()).toBe('target-ok');
    expect(targetRequests().at(-1)).toMatchObject({ body: '', method: 'GET' });
    expect(targetRequests().at(-1)?.headers['content-type']).toBeUndefined();
    expect(targetRequests().at(-1)?.headers.authorization).toBeUndefined();
    expect(targetRequests().at(-1)?.headers['x-api-key']).toBe('keep-me');
  });

  it('rechecks resolved-IP posture on an allowlisted redirect hop', async () => {
    installPolicy({ allowTargetDestination: true, allowTargetInternal: false });

    const blocked = await frameworkEgressFetch(redirectUrl('/private-hop')).catch(
      (error: unknown) => error,
    );

    expect(findEgressBlockedError(blocked)).toMatchObject({
      classification: 'loopback',
      reason: 'private-network',
    });
    expect(targetRequests()).toHaveLength(0);
  });

  it("rejects non-HTTP schemes, redirect loops, and chains beyond native fetch's 20-hop bound", async () => {
    installPolicy({ allowTargetDestination: false, allowTargetInternal: false });

    await expect(frameworkEgressFetch(redirectUrl('/scheme'))).rejects.toBeInstanceOf(TypeError);

    observed.length = 0;
    await expect(frameworkEgressFetch(redirectUrl('/loop-a'))).rejects.toBeInstanceOf(TypeError);
    expect(redirectRequests()).not.toHaveLength(0);
    expect(redirectRequests().length).toBeLessThanOrEqual(21);

    observed.length = 0;
    await expect(frameworkEgressFetch(redirectUrl('/chain/0'))).rejects.toBeInstanceOf(TypeError);
    const visitedHops = redirectRequests().map(({ path }) => Number(path.split('/').at(-1)));
    expect(Math.max(...visitedHops)).toBeLessThanOrEqual(20);
    expect(redirectRequests().length).toBeLessThanOrEqual(21);
  });

  function installPolicy(options: {
    allowTargetDestination: boolean;
    allowTargetInternal: boolean;
  }): void {
    floor = installEgressFloorSync(
      {
        allowDestinations: [
          redirectUrl(),
          ...(options.allowTargetDestination ? [targetUrl()] : []),
        ],
        allowInternal: [
          `127.0.0.1:${redirectPort}`,
          ...(options.allowTargetInternal ? [`127.0.0.1:${targetPort}`] : []),
        ],
      },
      () => {},
    );
  }

  function redirectUrl(path = ''): string {
    return `http://127.0.0.1:${redirectPort}${path}`;
  }

  function targetUrl(path = ''): string {
    return `http://127.0.0.1:${targetPort}${path}`;
  }

  function redirectRequests(): readonly ObservedRequest[] {
    return observed.filter(({ server }) => server === 'redirect');
  }

  function targetRequests(): readonly ObservedRequest[] {
    return observed.filter(({ server }) => server === 'target');
  }
});

function redirect(response: http.ServerResponse, status: number, location: string): void {
  response.writeHead(status, { location });
  response.end();
}

async function observeRequest(
  server: ObservedRequest['server'],
  request: IncomingMessage,
  observed: ObservedRequest[],
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  observed.push({
    body: Buffer.concat(chunks).toString('utf8'),
    headers: { ...request.headers },
    method: request.method ?? '',
    path: request.url ?? '',
    server,
  });
}

function findEgressBlockedError(error: unknown): EgressBlockedError | undefined {
  let cursor = error;
  for (let depth = 0; depth < 4 && cursor instanceof Error; depth += 1) {
    if (cursor instanceof EgressBlockedError) return cursor;
    cursor = cursor.cause;
  }
  return undefined;
}

function listen(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
