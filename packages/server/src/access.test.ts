import { createHmac } from 'node:crypto';
import { hmacSignature } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import {
  accessDecisionFor,
  isExecutableGuardAccessDecision,
  publicAccess,
  verifiedAccess,
  type AccessDecision,
} from './access.js';
import { domain } from './domain.js';
import { endpoint, runEndpoint, runEndpointAuth } from './endpoint.js';
import {
  explainGuard,
  guard,
  guardAuditName,
  guards,
  runAccessDecisionGuards,
  type Guard,
} from './guards.js';
import { renderedHtml } from './html.js';
import { mutation, runMutation } from './mutation.js';
import { query, renderQueryEndpointResponse } from './query.js';
import { layout, renderRoutePageResponse, route } from './route.js';
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
  it('defines public, verified machine, and executable guard access decisions', () => {
    const publicDecision = publicAccess('marketing page');
    const machineDecision = verifiedAccess;
    const requireAdmin = guard(
      'admin-only',
      guards.role<{ session?: { user?: { roles: readonly string[] } } }>('admin'),
    );
    const guardChain = [requireAdmin] satisfies AccessDecision;

    expect(publicDecision).toEqual({ kind: 'public', reason: 'marketing page' });
    expect(machineDecision).toEqual({ kind: 'verified-machine-auth' });
    expect(guardChain.map((item) => guardAuditName(item))).toEqual(['admin-only']);
    expect(explainGuard(requireAdmin)[0]).toEqual({ kind: 'named', name: 'admin-only' });
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

  it('runs access guards for route, query, mutation, and endpoint enforcement', async () => {
    type AppRequest = { session?: { user?: { roles: readonly string[] } | null } | null };
    const access = [guard('admin-only', guards.role<AppRequest>('admin'))];
    const guardedRoute = route('/admin', {
      access,
      page: () => renderedHtml('admin'),
    });
    const guardedLayoutRoute = route('/layout-admin', {
      layout: layout({
        access: [guard('layout-admin-only', () => ({ kind: 'forbidden' as const }))],
      }),
      page: () => renderedHtml('layout admin'),
    });
    const guardedQuery = query('adminStats', {
      access,
      reads: [domain('admin')],
    });
    const guardedMutation = mutation('admin/touch', {
      access,
      csrf: false,
      input: s.object({ id: s.string() }),
      handler: () => 'ok',
    });
    const guardedEndpoint = endpoint('/admin/raw', {
      access: [guard('endpoint-admin-only', () => ({ kind: 'forbidden' as const, payload: {} }))],
      csrf: false,
      csrfJustification: 'raw access guard test',
      handler: () => new Response('ok'),
      method: 'GET',
      reason: 'raw access guard test',
      response: textResponse,
    });
    const guardedWebhook = webhook('/admin/hook', {
      access: [guard('webhook-admin-only', () => ({ kind: 'forbidden' as const }))],
      handler: () => ({ ok: true }),
      input: s.object({}),
      verify: 'none',
      verifyJustification: 'raw access guard test',
    });
    const request = { session: { user: { id: 'u1', roles: ['staff'] } } };

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
    const layoutForbidden = await renderRoutePageResponse(guardedLayoutRoute, {}, request, String, {
      renderForbidden: () => '<main>Layout forbidden</main>',
    });
    expect(layoutForbidden.status).toBe(403);
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
      auth: 'unauthorized',
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 403,
    });
    const endpointForbidden = await runEndpoint(
      guardedEndpoint,
      new Request('https://example.test/admin/raw'),
    );
    expect(endpointForbidden.status).toBe(403);
    const webhookForbidden = await runEndpoint(
      guardedWebhook,
      new Request('https://example.test/admin/hook', {
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );
    expect(webhookForbidden.status).toBe(403);
  });

  it('snapshots valid guard chains at every declaration boundary', async () => {
    const original = [guard('deny-snapshot', () => ({ kind: 'forbidden' as const }))];
    const statusLayout = layout({ access: original });
    const statusRoute = route('/snapshot', { access: original, page: () => renderedHtml('no') });
    const statusQuery = query('snapshot', {
      access: original,
      load: () => ({ secret: true }),
      reads: [domain('snapshot')],
    });
    const statusMutation = mutation('snapshot/touch', {
      access: original,
      handler: () => ({ changed: true }),
      input: s.object({}),
    });
    const statusEndpoint = endpoint('/snapshot.txt', {
      access: original,
      csrf: false,
      csrfJustification: 'snapshot guard test',
      handler: () => new Response('no'),
      method: 'GET',
      reason: 'snapshot guard test',
      response: textResponse,
    });
    const statusWebhook = webhook('/snapshot-hook', {
      access: original,
      handler: () => ({ changed: true }),
      input: s.object({}),
      verify: 'none',
      verifyJustification: 'snapshot guard test',
    });

    original[0] = () => true;
    original.length = 0;

    for (const access of [
      statusLayout.access,
      statusRoute.access,
      statusQuery.access,
      statusMutation.access,
      statusEndpoint.access,
      statusWebhook.access,
    ]) {
      expect(access).not.toBe(original);
      expect(Object.isFrozen(access)).toBe(true);
      expect(isExecutableGuardAccessDecision(access)).toBe(true);
      await expect(runAccessDecisionGuards(access, undefined, {})).resolves.toMatchObject({
        auth: 'unauthorized',
        code: 'UNAUTHORIZED',
      });
    }
  });

  it('pins declaration access against assignment, deletion, and defineProperty drift', async () => {
    const deny = guard('deny-pinned', () => ({ kind: 'forbidden' as const }));
    const authored = [deny];
    const declarations: (object & { access?: AccessDecision })[] = [
      layout({ access: authored }),
      route('/pinned-route', { access: authored, page: () => renderedHtml('private') }),
      query('pinned-query', { access: authored, load: () => ({ private: true }) }),
      mutation('pinned-mutation', {
        access: authored,
        handler: () => ({ private: true }),
        input: s.object({}),
      }),
      mutation({
        access: authored,
        handler: () => ({ private: true }),
        input: s.object({}),
      }),
      endpoint('/pinned-endpoint', {
        access: authored,
        csrf: false,
        csrfJustification: 'pinned access test',
        handler: () => new Response('private'),
        method: 'GET',
        reason: 'pinned access test',
        response: textResponse,
      }),
      webhook('/pinned-webhook', {
        access: authored,
        handler: () => ({ private: true }),
        input: s.object({}),
        verify: 'none',
        verifyJustification: 'pinned access test',
      }),
    ];

    authored[0] = () => true;
    authored.length = 0;

    for (const declaration of declarations) {
      const pinned = accessDecisionFor(declaration);
      expect(Object.getOwnPropertyDescriptor(declaration, 'access')).toMatchObject({
        configurable: false,
        enumerable: true,
        value: pinned,
        writable: false,
      });
      expect(() => {
        declaration.access = undefined;
      }).toThrow(TypeError);
      expect(() => {
        delete declaration.access;
      }).toThrow(TypeError);
      expect(() =>
        Object.defineProperty(declaration, 'access', {
          configurable: true,
          value: publicAccess('attempted replacement'),
          writable: true,
        }),
      ).toThrow(TypeError);
      expect(accessDecisionFor(declaration)).toBe(pinned);
      await expect(runAccessDecisionGuards(pinned, undefined, {})).resolves.toMatchObject({
        auth: 'unauthorized',
        code: 'UNAUTHORIZED',
      });
    }
  });

  it('pins public, verified, and absent legacy decisions without changing guard fallback', async () => {
    const deny = guard('deny-legacy', () => ({ kind: 'forbidden' as const }));
    const publicRoute = route('/pinned-public', {
      access: publicAccess('pinned public route'),
      page: () => renderedHtml('public'),
    });
    const machineEndpoint = endpoint('/pinned-machine', {
      access: verifiedAccess,
      auth: { kind: 'custom', name: 'machine' },
      csrf: false,
      csrfJustification: 'pinned machine test',
      handler: () => new Response('machine'),
      method: 'GET',
      reason: 'pinned machine test',
      response: textResponse,
    });
    const legacyRoute = route('/pinned-legacy', {
      guard: deny,
      page: () => renderedHtml('private'),
    });

    for (const declaration of [publicRoute, machineEndpoint, legacyRoute]) {
      const access = accessDecisionFor(declaration);
      expect(Reflect.set(declaration, 'access', undefined)).toBe(false);
      expect(Reflect.deleteProperty(declaration, 'access')).toBe(false);
      expect(accessDecisionFor(declaration)).toBe(access);
    }
    expect(Object.getOwnPropertyDescriptor(legacyRoute, 'access')).toMatchObject({
      configurable: false,
      enumerable: false,
      value: undefined,
      writable: false,
    });
    await expect(
      runAccessDecisionGuards(accessDecisionFor(legacyRoute), legacyRoute.guard, {}),
    ).resolves.toMatchObject({ auth: 'unauthorized', code: 'UNAUTHORIZED' });
  });

  it('executes descriptor-snapshotted guards instead of Proxy indexed reads', async () => {
    const deny = guard('deny-proxy', () => ({ kind: 'forbidden' as const }));
    let indexedReads = 0;
    const proxied = new Proxy([deny], {
      get(target, property, receiver) {
        if (property === '0') {
          indexedReads += 1;
          return () => true;
        }
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const definition = query('proxy-snapshot', {
      access: proxied,
      load: () => ({ private: true }),
    });

    expect(indexedReads).toBe(0);
    await expect(runAccessDecisionGuards(definition.access, undefined, {})).resolves.toMatchObject({
      auth: 'unauthorized',
      code: 'UNAUTHORIZED',
    });
    await expect(runAccessDecisionGuards(proxied, undefined, {})).resolves.toMatchObject({
      auth: 'unauthorized',
      code: 'UNAUTHORIZED',
    });
    expect(indexedReads).toBe(0);
  });

  it('uses the private snapshot for frozen structural declarations', async () => {
    const deny = guard('deny-frozen', () => ({ kind: 'forbidden' as const }));
    const sparse: Guard<object>[] = [];
    sparse.length = 1;
    const frozenValid = Object.freeze({ access: Object.freeze([deny]) });
    const frozenInvalid = Object.freeze({ access: Object.freeze(sparse) });

    await expect(
      runAccessDecisionGuards(accessDecisionFor(frozenValid), undefined, {}),
    ).resolves.toMatchObject({ auth: 'unauthorized', code: 'UNAUTHORIZED' });
    await expect(
      runAccessDecisionGuards(accessDecisionFor(frozenInvalid), undefined, {}),
    ).resolves.toEqual({
      auth: 'unauthorized',
      code: 'UNAUTHORIZED',
      payload: {},
      status: 422,
    });
  });

  it('fails closed on empty, sparse, non-guard, and accessor-backed access arrays', async () => {
    const sparse: Guard<object>[] = [];
    sparse.length = 1;
    const empty: Guard<object>[] = [];
    const nonGuard = [undefined] as unknown as Guard<object>[];
    const oversized: Guard<object>[] = [];
    oversized.length = 257;
    const oversizedProxy = new Proxy(oversized, {
      getOwnPropertyDescriptor(target, property) {
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    let getterReads = 0;
    const accessor: Guard<object>[] = [];
    Object.defineProperty(accessor, 0, {
      configurable: true,
      get() {
        getterReads += 1;
        return () => true;
      },
    });

    for (const [name, authored] of [
      ['empty', empty],
      ['sparse', sparse],
      ['non-guard', nonGuard],
      ['accessor', accessor],
      ['oversized', oversized],
      ['oversized-proxy', oversizedProxy],
    ] as const) {
      const definition = query(`invalid-${name}`, {
        access: authored,
        load: () => ({ secret: true }),
        reads: [domain(`invalid-${name}`)],
      });

      expect(definition.access).not.toBe(authored);
      expect(Object.isFrozen(definition.access)).toBe(true);
      expect(isExecutableGuardAccessDecision(definition.access)).toBe(false);
      await expect(runAccessDecisionGuards(definition.access, undefined, {})).resolves.toEqual({
        auth: 'unauthorized',
        code: 'UNAUTHORIZED',
        payload: {},
        status: 422,
      });
    }
    expect(getterReads).toBe(0);

    const sparseDeclarations: (object & { access?: AccessDecision })[] = [
      layout({ access: sparse }),
      route('/invalid-sparse-route', { access: sparse, page: () => renderedHtml('private') }),
      query('invalid-sparse-query-surface', { access: sparse, load: () => ({ private: true }) }),
      mutation('invalid-sparse-mutation', {
        access: sparse,
        handler: () => ({ private: true }),
        input: s.object({}),
      }),
      mutation({
        access: sparse,
        handler: () => ({ private: true }),
        input: s.object({}),
      }),
      endpoint('/invalid-sparse-endpoint', {
        access: sparse,
        csrf: false,
        csrfJustification: 'invalid sparse surface test',
        handler: () => new Response('private'),
        method: 'GET',
        reason: 'invalid sparse surface test',
        response: textResponse,
      }),
      webhook('/invalid-sparse-webhook', {
        access: sparse,
        handler: () => ({ private: true }),
        input: s.object({}),
        verify: 'none',
        verifyJustification: 'invalid sparse surface test',
      }),
    ];
    for (const declaration of sparseDeclarations) {
      await expect(
        runAccessDecisionGuards(accessDecisionFor(declaration), undefined, {}),
      ).resolves.toEqual({
        auth: 'unauthorized',
        code: 'UNAUTHORIZED',
        payload: {},
        status: 422,
      });
    }
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
    expect(Object.getOwnPropertyDescriptor(guardedEndpoint, 'auth')).toMatchObject({
      configurable: false,
      enumerable: true,
      writable: false,
    });
    expect(Reflect.set(guardedEndpoint, 'auth', undefined)).toBe(false);
    verifier.verify = async () => true;

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
