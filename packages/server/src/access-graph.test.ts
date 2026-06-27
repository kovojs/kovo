import { hmacSignature } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { publicAccess, verifiedAccess } from './access.js';
import { accessFactsFromApp } from './access-graph.js';
import { createApp } from './app.js';
import { endpoint, type EndpointResponsePosture } from './endpoint.js';
import { guards } from './guards.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
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

describe('app access graph extraction', () => {
  it('extracts access decisions from assembled app guard and auth posture', () => {
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
    const explicitGuardRoute = route('/admin', {
      access: { guards: [{ name: 'admin' }], kind: 'guard-chain' },
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
          header: 'X-Signature',
          scheme: 'sync-hmac',
          secret: 'test_secret',
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
        header: 'Stripe-Signature',
        scheme: 'stripe-signature',
        secret: 'test_secret',
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
        decision: 'public',
        detail: 'method=GET path=/healthz mount=exact auth=none',
        justification: 'read-only health probe',
        kind: 'endpoint',
        name: '/healthz',
        source: 'auth',
      },
      {
        decision: 'guard',
        detail: 'guard=mutation.guard',
        kind: 'mutation',
        name: 'cart/add',
        source: 'legacy-guard',
      },
      {
        decision: 'missing',
        detail: 'guard=-',
        kind: 'mutation',
        name: 'cart/clear',
        source: 'legacy-guard',
      },
      {
        decision: 'guard',
        detail: 'access=guard-chain guards=admin',
        kind: 'page',
        name: '/admin',
        source: 'access',
      },
      {
        decision: 'guard',
        detail: 'guard=layout.guard',
        kind: 'page',
        name: '/cart',
        source: 'legacy-guard',
      },
      {
        decision: 'missing',
        detail: 'guard=-',
        kind: 'page',
        name: '/public',
        source: 'legacy-guard',
      },
      {
        decision: 'guard',
        detail: 'guard=query.guard',
        kind: 'query',
        name: 'cart',
        source: 'legacy-guard',
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
        detail: 'guard=-',
        kind: 'query',
        name: 'drafts',
        source: 'legacy-guard',
      },
      {
        decision: 'verified',
        detail:
          'access=verified-machine-auth method=POST path=/webhooks/stripe mount=exact auth=verifier:stripe-signature',
        kind: 'webhook',
        name: 'stripe',
        source: 'access',
      },
    ]);
  });
});
