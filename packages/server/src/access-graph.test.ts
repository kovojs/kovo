import { hmacSignature } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { guardAccess, publicAccess, verifiedAccess } from './access.js';
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
  it('extracts explicit access decisions and reports missing declarations separately from guard/auth posture', () => {
    const authed = guards.authed<{ session?: { user?: { id?: string } } }>();
    const guardedQuery = query('cart', { guard: authed, load: () => ({ count: 1 }) } as any);
    const publicQuery = query('catalog', {
      access: publicAccess('public product catalog'),
      load: () => ({ items: [] }),
    });
    const missingQuery = query('drafts', { load: () => ({ items: [] }) } as any);
    const guardedMutation = mutation('cart/add', {
      guard: authed,
      handler: () => ({ ok: true }),
      input: s.object({ productId: s.string() }),
    } as any);
    const missingMutation = mutation('cart/clear', {
      handler: () => ({ ok: true }),
      input: s.object({}),
    } as any);
    const guardedLayout = layout({ guard: authed });
    const explicitGuardRoute = route('/admin', {
      access: guardAccess([{ name: 'admin' }]),
      page: () => '<main>admin</main>',
    });
    const guardedRoute = route('/cart', {
      layout: guardedLayout,
      page: () => '<main>cart</main>',
    } as any);
    const missingRoute = route('/public', { page: () => '<main>public</main>' } as any);
    const health = endpoint('/healthz', {
      access: publicAccess('read-only health probe'),
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
    const signedWebhook = webhook('stripe', {
      access: verifiedAccess,
      handler: () => ({}),
      input: s.object({ id: s.string() }),
      path: '/webhooks/stripe',
      verify: hmacSignature({
        header: 'Stripe-Signature',
        scheme: 'stripe-signature',
        secret: 'test_secret',
      }),
    });

    const app = createApp({
      endpoints: [health, api, signedWebhook],
      mutations: [guardedMutation, missingMutation],
      queries: [guardedQuery, publicQuery, missingQuery],
      routes: [guardedRoute, explicitGuardRoute, missingRoute],
    });

    expect(accessFactsFromApp(app)).toEqual([
      {
        decision: 'verified',
        detail:
          'access=verified-machine-auth method=POST path=/api/sync mount=exact auth=custom:api-key',
        kind: 'endpoint',
        name: '/api/sync',
        source: 'access',
      },
      {
        decision: 'public',
        detail: 'access=public method=GET path=/healthz mount=exact auth=none',
        justification: 'read-only health probe',
        kind: 'endpoint',
        name: '/healthz',
        source: 'access',
      },
      {
        decision: 'missing',
        detail: 'access=- legacyGuard=mutation.guard',
        kind: 'mutation',
        name: 'cart/add',
        source: 'access',
      },
      {
        decision: 'missing',
        detail: 'access=- guard=-',
        kind: 'mutation',
        name: 'cart/clear',
        source: 'access',
      },
      {
        decision: 'guard',
        detail: 'access=guard-chain guards=admin',
        kind: 'page',
        name: '/admin',
        source: 'access',
      },
      {
        decision: 'missing',
        detail: 'access=- legacyGuard=layout.guard',
        kind: 'page',
        name: '/cart',
        source: 'access',
      },
      {
        decision: 'missing',
        detail: 'access=- guard=-',
        kind: 'page',
        name: '/public',
        source: 'access',
      },
      {
        decision: 'missing',
        detail: 'access=- legacyGuard=query.guard',
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
        detail: 'access=- guard=-',
        kind: 'query',
        name: 'drafts',
        source: 'access',
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
