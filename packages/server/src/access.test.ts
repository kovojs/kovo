import { createHmac } from 'node:crypto';
import { hmacSignature } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { publicAccess, verifiedAccess, type AccessDecision } from './access.js';
import { domain } from './domain.js';
import { endpoint, runEndpointAuth } from './endpoint.js';
import { guards } from './guards.js';
import { renderedHtml } from './html.js';
import { mutation, runMutation } from './mutation.js';
import { query, renderQueryEndpointResponse } from './query.js';
import { renderRoutePageResponse, route } from './route.js';
import { s } from './schema.js';
import { webhook } from './webhook.js';

const textResponse = {
  appOwnedSafety: true,
  body: 'text',
  cache: 'no-store',
} as const;

function sign(body: string): string {
  return createHmac('sha256', 'access_secret').update(body).digest('hex');
}

describe('structured access metadata', () => {
  it('defines public, verified machine, and guard-chain access decisions', () => {
    const publicDecision = publicAccess('marketing page');
    const machineDecision = verifiedAccess;
    const guardChain = {
      guards: [
        { name: 'session' },
        {
          guard: guards.role<{ session?: { user?: { roles?: readonly string[] } } }>('admin'),
          name: 'admin',
        },
      ],
      kind: 'guard-chain',
    } satisfies AccessDecision;

    expect(publicDecision).toEqual({ kind: 'public', reason: 'marketing page' });
    expect(machineDecision).toEqual({ kind: 'verified-machine-auth' });
    expect(guardChain.guards.map((step) => step.name)).toEqual(['session', 'admin']);
  });

  it('carries access metadata through route, query, mutation, endpoint, and webhook declarations', () => {
    const access = publicAccess('status surface');
    const statusRoute = route('/status', {
      access,
      page: () => renderedHtml('ok'),
    });
    const statusQuery = query('status', {
      access,
      load: () => ({ ok: true }),
      reads: [domain('status')],
    });
    const statusMutation = mutation('status/touch', {
      access,
      input: s.object({ id: s.string() }),
      handler: (input) => input,
    });
    const statusEndpoint = endpoint('/status.txt', {
      access,
      csrf: false,
      csrfJustification: 'read-only status endpoint',
      handler: () => new Response('ok'),
      method: 'GET',
      reason: 'read-only status endpoint',
      response: textResponse,
    });
    const statusWebhook = webhook('/webhooks/status', {
      access: verifiedAccess,
      handler: () => undefined,
      input: s.object({ id: s.string() }),
      verify: 'none',
      verifyJustification: 'test fixture',
    });

    expect(statusRoute.access).toBe(access);
    expect(statusQuery.access).toBe(access);
    expect(statusMutation.access).toBe(access);
    expect(statusEndpoint.access).toBe(access);
    expect(statusWebhook.access).toBe(verifiedAccess);
  });

  it('does not change route, query, or mutation guard enforcement', async () => {
    type AppRequest = { session?: { user?: { roles?: readonly string[] } | null } | null };
    const access = publicAccess('audit metadata only');
    const guardedRoute = route('/admin', {
      access,
      guard: guards.role<AppRequest>('admin'),
      page: () => renderedHtml('admin'),
    });
    const guardedQuery = query('adminStats', {
      access,
      guard: guards.role<AppRequest>('admin'),
      reads: [domain('admin')],
    });
    const guardedMutation = mutation('admin/touch', {
      access,
      csrf: false,
      guard: guards.role<AppRequest>('admin'),
      input: s.object({ id: s.string() }),
      handler: () => 'ok',
    });
    const request = { session: { user: { roles: ['staff'] } } };

    const routeForbidden = await renderRoutePageResponse(guardedRoute, {}, request, String, {
      renderForbidden: () => '<main>Forbidden</main>',
    });
    expect(routeForbidden).toMatchObject({
      body: '<main>Forbidden</main>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': expect.stringContaining("default-src 'self'"),
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      },
      status: 403,
    });
    const queryForbidden = await renderQueryEndpointResponse(guardedQuery, {
      renderForbidden: () => '<main>Query forbidden</main>',
      request,
    });
    expect(queryForbidden).toMatchObject({
      body: '<main>Query forbidden</main>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': expect.stringContaining("default-src 'self'"),
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      },
      status: 403,
    });
    await expect(runMutation(guardedMutation, { id: '1' }, request)).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    });
  });

  it('does not change endpoint auth enforcement', async () => {
    const verifier = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      name: 'access',
      payload: (request) => request.payload,
      scheme: 'access:v1:hmac-sha256',
      secret: 'access_secret',
    });
    const guardedEndpoint = endpoint('/machine/access', {
      access: publicAccess('audit metadata only'),
      auth: { kind: 'verifier', name: verifier.resolved.scheme, verify: verifier },
      csrf: false,
      csrfJustification: 'machine auth test',
      handler: () => new Response('ok'),
      method: 'POST',
      reason: 'machine auth test',
      response: textResponse,
    });

    const rejected = await runEndpointAuth(
      guardedEndpoint,
      new Request('https://example.test/machine/access', {
        body: '{"id":"1"}',
        headers: { 'x-signature': sign('{}') },
        method: 'POST',
      }),
    );
    expect(rejected?.status).toBe(401);

    const body = '{"id":"1"}';
    await expect(
      runEndpointAuth(
        guardedEndpoint,
        new Request('https://example.test/machine/access', {
          body,
          headers: { 'x-signature': sign(body) },
          method: 'POST',
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
