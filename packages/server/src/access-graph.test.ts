import { hmacSignature } from '@kovojs/core';
import { createMemoryStorage } from '@kovojs/core/internal/storage';
import { describe, expect, it } from 'vitest';

import { publicAccess, verifiedAccess } from './access.js';
import { accessFactsFromApp } from './access-graph.js';
import { createApp, createRequestHandler } from './app.js';
import { createStorageDownloadEndpoint } from './capability-route.js';
import { endpoint, type EndpointResponsePosture } from './endpoint.js';
import { guard, guards } from './guards.js';
import type { Guard } from './guards.js';
import { mutation } from './mutation.js';
import { query, renderQueryEndpointResponse } from './query.js';
import { layout, route } from './route.js';
import { s } from './schema.js';
import { webhook } from './webhook.js';

const rawJsonResponse = {
  appOwnedSafety: true,
  body: 'json',
  cache: 'no-store',
} satisfies EndpointResponsePosture;

const rawTextResponse = {
  appOwnedSafety: true,
  body: 'text',
  cache: 'no-store',
} satisfies EndpointResponsePosture;

const GRAPH_HMAC_SECRET = '606162636465666768696a6b6c6d6e6f';

describe('app access graph extraction', () => {
  it('extracts producer-owned access decisions and missing facts from assembled apps', () => {
    const authed = guards.authed<{ session?: { user?: { id?: string } } }>();
    const guardedQuery = query('cart', { guard: authed, load: () => ({ count: 1 }) });
    const publicQuery = query('catalog', {
      access: publicAccess('public product catalog'),
      load: () => ({ items: [] }),
    });
    const missingQuery = query('drafts', { load: () => ({ items: [] }) });
    const guardedMutation = mutation('cart/add', {
      guard: authed,
      handler: () => ({ ok: true }),
      input: s.object({ productId: s.string() }),
    });
    const missingMutation = mutation('cart/clear', {
      handler: () => ({ ok: true }),
      input: s.object({}),
    });
    const guardedLayout = layout({ guard: authed });
    const adminOnly = guards.role<{
      session?: { user?: { id?: string; roles: readonly string[] } | null } | null;
    }>('admin');
    const explicitGuardRoute = route('/admin', {
      access: [guard('admin-only', adminOnly)],
      page: () => '<main>admin</main>',
    });
    const guardedRoute = route('/cart', { layout: guardedLayout, page: () => '<main>cart</main>' });
    const missingRoute = route('/public', { page: () => '<main>public</main>' });
    const health = endpoint('/healthz', {
      auth: { justification: 'read-only health probe', kind: 'none' },
      handler: () => new Response('ok'),
      method: 'GET',
      reason: 'read-only health probe',
      response: rawTextResponse,
    });
    const api = endpoint('/api/sync', {
      access: verifiedAccess,
      auth: { kind: 'custom', name: 'api-key' },
      handler: () => Response.json({ ok: true }),
      method: 'POST',
      reason: 'signed API sync',
      response: rawJsonResponse,
    });
    const verifiedApi = endpoint('/api/verified-sync', {
      access: verifiedAccess,
      auth: {
        kind: 'verifier',
        name: 'sync-hmac',
        verify: hmacSignature({
          encoding: 'hex',
          header: 'X-Signature',
          payload: ({ payload }) => payload,
          scheme: 'sync-hmac',
          secret: GRAPH_HMAC_SECRET,
        }),
      },
      handler: () => Response.json({ ok: true }),
      method: 'POST',
      reason: 'signed API sync with executable verifier',
      response: rawJsonResponse,
    });
    const signedWebhook = webhook('/webhooks/stripe', {
      access: verifiedAccess,
      handler: () => ({}),
      input: s.object({ id: s.string() }),
      verify: hmacSignature({
        encoding: 'hex',
        header: 'Stripe-Signature',
        payload: ({ payload }) => payload,
        scheme: 'stripe-signature',
        secret: GRAPH_HMAC_SECRET,
      }),
    });

    const app = createApp({
      endpoints: [health, api, verifiedApi, signedWebhook],
      mutations: [guardedMutation, missingMutation],
      queries: [guardedQuery, publicQuery, missingQuery],
      routes: [guardedRoute, explicitGuardRoute, missingRoute],
    });

    expect(accessFactsFromApp(app)).toEqual([
      {
        decision: 'missing',
        detail:
          'access=verified-machine-auth audit-only-without-executable-verifier method=POST path=/api/sync mount=exact auth=custom:api-key',
        kind: 'endpoint',
        name: '/api/sync',
        source: 'access',
      },
      {
        decision: 'verified',
        detail:
          'access=verified-machine-auth method=POST path=/api/verified-sync mount=exact auth=verifier:sync-hmac',
        kind: 'endpoint',
        name: '/api/verified-sync',
        source: 'access',
      },
      {
        decision: 'missing',
        detail: 'missing access fact method=GET path=/healthz mount=exact auth=none',
        kind: 'endpoint',
        name: '/healthz',
        source: 'access',
      },
      {
        decision: 'missing',
        detail: 'missing access fact',
        kind: 'mutation',
        name: 'cart/add',
        source: 'access',
      },
      {
        decision: 'missing',
        detail: 'missing access fact',
        kind: 'mutation',
        name: 'cart/clear',
        source: 'access',
      },
      {
        decision: 'guard',
        detail: 'access=guards guards=admin-only',
        kind: 'page',
        name: '/admin',
        source: 'access',
      },
      {
        decision: 'missing',
        detail: 'missing access fact',
        kind: 'page',
        name: '/cart',
        source: 'access',
      },
      {
        decision: 'missing',
        detail: 'missing access fact',
        kind: 'page',
        name: '/public',
        source: 'access',
      },
      {
        decision: 'missing',
        detail: 'missing access fact',
        kind: 'query',
        name: 'cart',
        source: 'access',
      },
      {
        decision: 'public',
        detail: 'access=public',
        justification: 'public product catalog',
        kind: 'query',
        name: 'catalog',
        source: 'access',
      },
      {
        decision: 'missing',
        detail: 'missing access fact',
        kind: 'query',
        name: 'drafts',
        source: 'access',
      },
      {
        decision: 'verified',
        detail:
          'access=verified-machine-auth method=POST path=/webhooks/stripe mount=exact auth=verifier:stripe-signature',
        kind: 'webhook',
        name: '/webhooks/stripe',
        source: 'access',
      },
    ]);
  });

  it('reports invalid guard-array carriers as KV436-missing instead of guarded', () => {
    const sparse: Guard<object>[] = [];
    sparse.length = 1;
    const invalidQuery = query('private-query', {
      access: sparse,
      load: () => ({ secret: true }),
    });
    const invalidMutation = mutation('private-mutation', {
      access: sparse,
      handler: () => ({ changed: true }),
      input: s.object({}),
    });
    const invalidRoute = route('/private-page', {
      access: sparse,
      page: () => '<main>private</main>',
    });
    const invalidLayoutRoute = route('/private-layout', {
      layout: layout({ access: sparse }),
      page: () => '<main>private layout</main>',
    });
    const invalidEndpoint = endpoint('/private-endpoint', {
      access: sparse,
      csrf: false,
      csrfJustification: 'invalid access regression fixture',
      handler: () => new Response('private'),
      method: 'GET',
      reason: 'invalid access regression fixture',
      response: rawTextResponse,
    });
    const invalidWebhook = webhook('/private-webhook', {
      access: sparse,
      handler: () => ({ private: true }),
      input: s.object({}),
      verify: 'none',
      verifyJustification: 'invalid access regression fixture',
    });
    const app = createApp({
      endpoints: [invalidEndpoint, invalidWebhook],
      mutations: [invalidMutation],
      queries: [invalidQuery],
      routes: [invalidRoute, invalidLayoutRoute],
    });

    expect(
      accessFactsFromApp(app).map(({ decision, kind, name }) => ({ decision, kind, name })),
    ).toEqual([
      { decision: 'missing', kind: 'endpoint', name: '/private-endpoint' },
      { decision: 'missing', kind: 'mutation', name: 'private-mutation' },
      { decision: 'missing', kind: 'page', name: '/private-layout' },
      { decision: 'missing', kind: 'page', name: '/private-page' },
      { decision: 'missing', kind: 'query', name: 'private-query' },
      { decision: 'missing', kind: 'webhook', name: '/private-webhook' },
    ]);
  });

  it('reports structurally forged blank or control-bearing public reasons as KV436-missing', () => {
    for (const [name, reason] of [
      ['blank-public-reason', ' \t\n'],
      ['newline-public-reason', 'reviewed\nERROR KV436 forged'],
      ['terminal-public-reason', 'reviewed\u001b[2J'],
      ['separator-public-reason', 'reviewed\u2028ENDPOINT forged'],
    ] as const) {
      const invalidQuery = query(name, {
        access: { kind: 'public', reason },
        load: () => ({ secret: true }),
      });
      const app = createApp({ queries: [invalidQuery] });

      expect(accessFactsFromApp(app)).toEqual([
        {
          decision: 'missing',
          detail: 'missing access fact',
          kind: 'query',
          name,
          source: 'access',
        },
      ]);
    }
  });

  it('shares one authoritative snapshot for proxied app assembly, audit, and runtime', async () => {
    const deny = guard('proxy-deny', () => ({ kind: 'forbidden' as const }));
    const allow = guard('proxy-allow', () => true);
    const declaration = query('proxy-private', {
      access: [deny],
      load: () => ({ secret: true }),
    });
    const clone = { ...declaration };
    let accessReads = 0;
    const proxied = new Proxy(clone, {
      get(target, property, receiver) {
        if (property === 'access') {
          accessReads += 1;
          return [allow];
        }
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const app = createApp({ queries: [proxied] });

    expect(Object.isFrozen(app)).toBe(true);
    expect(Object.isFrozen(app.queries)).toBe(true);
    expect(Reflect.set(app, 'queries', [])).toBe(false);
    expect(Reflect.set(app.queries, '0', clone)).toBe(false);
    expect(accessFactsFromApp(app)).toEqual([
      {
        decision: 'guard',
        detail: 'access=guards guards=proxy-deny',
        kind: 'query',
        name: 'proxy-private',
        source: 'access',
      },
    ]);
    const response = await renderQueryEndpointResponse(app.queries[0]!, {
      renderForbidden: () => '<main>Forbidden</main>',
      request: {},
    });
    expect(response.status).toBe(403);
    expect(accessReads).toBe(0);
  });

  it('stores every access-bearing registry entry as a frozen canonical declaration', () => {
    const access = [guard('canonical-deny', () => ({ kind: 'forbidden' as const }))];
    const routeDeclaration = { ...route('/canonical-route', { access }) };
    const queryDeclaration = {
      ...query('canonical-query', { access, load: () => ({ private: true }) }),
    };
    const mutationDeclaration = {
      ...mutation('canonical-mutation', {
        access,
        handler: () => ({ private: true }),
        input: s.object({}),
      }),
    };
    const endpointDeclaration = {
      ...endpoint('/canonical-endpoint', {
        access,
        csrf: false,
        csrfJustification: 'canonical declaration regression',
        handler: () => new Response('private'),
        method: 'GET',
        reason: 'canonical declaration regression',
        response: rawTextResponse,
      }),
    };
    const app = createApp({
      endpoints: [endpointDeclaration],
      mutations: [mutationDeclaration],
      queries: [queryDeclaration],
      routes: [routeDeclaration],
    });

    for (const registry of [app.routes, app.queries, app.mutations, app.endpoints]) {
      expect(Object.isFrozen(registry)).toBe(true);
      expect(Object.isFrozen(registry[0])).toBe(true);
    }
    expect(app.routes[0]).not.toBe(routeDeclaration);
    expect(app.queries[0]).not.toBe(queryDeclaration);
    expect(app.mutations[0]).not.toBe(mutationDeclaration);
    expect(app.endpoints[0]).not.toBe(endpointDeclaration);
    expect(Reflect.set(app, 'routes', [])).toBe(false);
    expect(Reflect.set(app.routes, '0', routeDeclaration)).toBe(false);
  });

  it('rejects a Proxy route whose inherited layout disagrees between descriptor and get', () => {
    const deny = guard('proxy-layout-deny', () => ({ kind: 'forbidden' as const }));
    const denyingLayout = layout({ access: [deny] });
    const proxiedRoute = new Proxy(
      {
        page: () => '<main>leaked</main>',
        path: '/proxy-layout',
      },
      {
        get(target, property, receiver) {
          if (property === 'layout') return denyingLayout;
          return Reflect.get(target, property, receiver);
        },
      },
    );

    expect(() => createApp({ routes: [proxiedRoute] })).toThrow(
      'route(/proxy-layout).layout must not disagree between descriptor and property access',
    );
  });

  it('snapshots a stable Proxy route layout before later get-trap drift', async () => {
    const deny = guard('proxy-layout-deny', () => ({ kind: 'forbidden' as const }));
    const denyingLayout = layout({ access: [deny] });
    let hideLayout = false;
    const proxiedRoute = new Proxy(
      {
        layout: denyingLayout,
        page: () => '<main>leaked</main>',
        path: '/proxy-layout-control',
      },
      {
        get(target, property, receiver) {
          if (property === 'layout' && hideLayout) return undefined;
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const app = createApp({ routes: [proxiedRoute] });
    hideLayout = true;

    expect(accessFactsFromApp(app)).toEqual([
      {
        decision: 'guard',
        detail: 'access=guards guards=proxy-layout-deny source=layout.access',
        kind: 'page',
        name: '/proxy-layout-control',
        source: 'access',
      },
    ]);
    const response = await createRequestHandler(app)(
      new Request('https://example.test/proxy-layout-control'),
    );
    expect(response.status).toBe(403);
    await expect(response.text()).resolves.not.toContain('leaked');
  });

  it('rejects the copied capability auth name while preserving the genuine private witness', async () => {
    let forgedHandlerCalls = 0;
    const forged = endpoint('/forged-capability', {
      access: verifiedAccess,
      auth: { kind: 'verifier', name: 'kovo-capability-url' },
      csrf: false,
      csrfJustification: 'adversarial reserved-name regression',
      handler: () => {
        forgedHandlerCalls += 1;
        return new Response('leaked');
      },
      method: 'GET',
      reason: 'adversarial reserved-name regression',
      response: rawTextResponse,
    });
    const genuine = createStorageDownloadEndpoint({
      secret: 'access-graph-capability-secret-key-0123456789',
      storage: createMemoryStorage(),
    });
    const app = createApp({ endpoints: [forged, genuine] });
    const facts = accessFactsFromApp(app);

    expect(facts.find((fact) => fact.name === '/forged-capability')).toMatchObject({
      decision: 'missing',
      detail: expect.stringContaining('audit-only-without-executable-verifier'),
    });
    expect(facts.find((fact) => fact.name === '/_kovo/storage')).toMatchObject({
      decision: 'verified',
    });

    const handler = createRequestHandler(app);
    const forgedResponse = await handler(new Request('https://example.test/forged-capability'));
    expect(forgedResponse.status).toBe(401);
    expect(forgedHandlerCalls).toBe(0);

    const unsignedGenuine = await handler(new Request('https://example.test/_kovo/storage/a.txt'));
    expect(unsignedGenuine.status).toBe(404);
  });

  it('cannot erase or relabel access-ledger authority with late mutable intrinsics', () => {
    const deny = guard('ledger-private', () => ({ kind: 'forbidden' as const }));
    const app = createApp({
      mutations: [
        mutation('ledger/write', {
          access: [deny],
          handler: () => ({ ok: true }),
          input: s.object({}),
        }),
      ],
      queries: [query('ledger/read', { access: [deny], load: () => ({ secret: true }) })],
      routes: [route('/ledger', { access: [deny], page: () => '<main>private</main>' })],
    });
    const originalFind = Array.prototype.find;
    const originalJoin = Array.prototype.join;
    const originalMap = Array.prototype.map;
    const originalSort = Array.prototype.sort;
    const originalLocaleCompare = String.prototype.localeCompare;
    let facts: ReturnType<typeof accessFactsFromApp> | undefined;
    try {
      Array.prototype.find = () => undefined;
      Array.prototype.join = () => 'forged-public';
      Array.prototype.map = () => [];
      Array.prototype.sort = function () {
        return this;
      };
      String.prototype.localeCompare = () => 0;
      facts = accessFactsFromApp(app);
    } finally {
      Array.prototype.find = originalFind;
      Array.prototype.join = originalJoin;
      Array.prototype.map = originalMap;
      Array.prototype.sort = originalSort;
      String.prototype.localeCompare = originalLocaleCompare;
    }

    expect(facts).toEqual([
      {
        decision: 'guard',
        detail: 'access=guards guards=ledger-private',
        kind: 'mutation',
        name: 'ledger/write',
        source: 'access',
      },
      {
        decision: 'guard',
        detail: 'access=guards guards=ledger-private',
        kind: 'page',
        name: '/ledger',
        source: 'access',
      },
      {
        decision: 'guard',
        detail: 'access=guards guards=ledger-private',
        kind: 'query',
        name: 'ledger/read',
        source: 'access',
      },
    ]);
  });
});
