import { hmacSignature } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

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
    const publicQuery = query('catalog', { load: () => ({ items: [] }) });
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
      auth: { kind: 'custom', name: 'api-key' },
      handler: () => Response.json({ ok: true }),
      method: 'POST',
      reason: 'signed API sync',
      response: rawJsonResponse,
    });
    const signedWebhook = webhook('stripe', {
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
      queries: [guardedQuery, publicQuery],
      routes: [guardedRoute, missingRoute],
    });

    expect(accessFactsFromApp(app)).toEqual([
      {
        decision: 'verified',
        detail: 'method=POST path=/api/sync mount=exact auth=custom:api-key',
        kind: 'endpoint',
        name: '/api/sync',
        source: 'auth',
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
        decision: 'missing',
        detail: 'guard=-',
        kind: 'query',
        name: 'catalog',
        source: 'legacy-guard',
      },
      {
        decision: 'verified',
        detail: 'method=POST path=/webhooks/stripe mount=exact auth=verifier:stripe-signature',
        kind: 'webhook',
        name: 'stripe',
        source: 'webhook',
      },
    ]);
  });
});
