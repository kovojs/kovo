import { describe, expect, it } from 'vitest';

import {
  deriveAuthPostureFacts,
  deriveOwnershipPostureFacts,
  deriveSessionAuthorityFacts,
  validateKovoExplainInput,
} from './graph.js';

describe('kovo graph input validation', () => {
  it('reports unknown diagnostic codes at the element path', () => {
    expect(
      validateKovoExplainInput({
        lints: [{ code: 'KV999', site: 'cart.tsx:1' }],
      }),
    ).toEqual([
      {
        message: 'unknown diagnostic code "KV999"',
        path: 'lints[0].code',
      },
    ]);
  });

  it('validates unresolved touch graph diagnostic codes before rendering', () => {
    expect(
      validateKovoExplainInput({
        touchGraph: {
          'cart.add': {
            touches: [],
            unresolved: [{ code: 'KV999', message: 'unknown', site: 'cart.ts:1' }],
          },
        },
      }),
    ).toEqual([
      {
        message: 'unknown diagnostic code "KV999"',
        path: 'touchGraph."cart.add".unresolved[0].code',
      },
    ]);
  });

  it('requires package component prefix facts to be an array', () => {
    expect(
      validateKovoExplainInput({
        packageComponentPrefixes: { packageName: '@kovojs/headless-ui', prefix: 'kovo-' },
      }),
    ).toEqual([
      {
        message: 'packageComponentPrefixes must be an array',
        path: 'packageComponentPrefixes',
      },
    ]);
  });

  it('requires access facts to be an array', () => {
    expect(
      validateKovoExplainInput({
        access: { decision: 'missing', kind: 'query', name: 'cart' },
      }),
    ).toEqual([
      {
        message: 'access must be an array',
        path: 'access',
      },
    ]);
  });

  it('accepts access facts as graph arrays', () => {
    expect(
      validateKovoExplainInput({
        access: [
          {
            decision: 'missing',
            detail: 'guards=-',
            kind: 'query',
            name: 'cart',
            site: 'cart.query.ts:7',
            source: 'access',
          },
        ],
      }),
    ).toEqual([]);
  });

  it('accepts producer-owned auth/session/ownership posture facts as graph arrays', () => {
    expect(
      validateKovoExplainInput({
        authPosture: [{ guarded: false, kind: 'query', name: 'cart' }],
        ownershipPosture: [
          { domain: 'cart', key: 'arg:id', kind: 'query', name: 'cart', ownerGuarded: true },
        ],
        sessionAuthority: [{ kind: 'mutation', name: 'cart/add', referencesSession: true }],
      }),
    ).toEqual([]);
  });

  it('derives producer-owned auth/session/ownership posture facts', () => {
    expect(
      deriveAuthPostureFacts({
        mutations: [
          { guards: ['rateLimit:session'], key: 'cart/add' },
          { guards: ['authed'], key: 'cart/remove' },
        ],
        queries: [{ domains: ['order'], guards: ['owns:order:arg:id'], query: 'orderById' }],
      }),
    ).toEqual([
      {
        detail: 'guards=rateLimit:session writes=- invalidates=- manual-invalidates=-',
        guarded: false,
        kind: 'mutation',
        name: 'cart/add',
        source: 'access-posture',
      },
      {
        detail: 'guards=authed writes=- invalidates=- manual-invalidates=-',
        guarded: true,
        kind: 'mutation',
        name: 'cart/remove',
        source: 'access-posture',
      },
      {
        detail: 'guards=owns:order:arg:id reads=order',
        guarded: false,
        kind: 'query',
        name: 'orderById',
        source: 'access-posture',
      },
    ]);

    expect(
      deriveSessionAuthorityFacts({
        endpoints: [{ csrf: 'exempt', guards: ['owns:order:arg:id'], path: '/api/order' }],
        mutations: [{ csrf: 'exempt', key: 'cart/add', session: 'appSession' }],
      }),
    ).toEqual([
      {
        detail: 'auth=- guards=owns:order:arg:id',
        kind: 'endpoint',
        name: '/api/order',
        referencesSession: true,
        source: 'session-authority',
      },
      {
        detail: 'session=appSession auth=- guards=-',
        kind: 'mutation',
        name: 'cart/add',
        referencesSession: true,
        source: 'session-authority',
      },
    ]);

    expect(
      deriveOwnershipPostureFacts({
        queries: [{ domains: ['order'], guards: ['owns:order:arg:id'], query: 'orderById' }],
      }),
    ).toEqual([
      {
        domain: 'order',
        key: 'arg:id',
        kind: 'query',
        name: 'orderById',
        ownerGuarded: true,
        source: 'ownership-posture',
      },
    ]);
  });

  it('accepts durable task facts as graph arrays', () => {
    expect(
      validateKovoExplainInput({
        tasks: [
          {
            cron: '0 2 * * *',
            key: 'email/send-receipt',
            runMutations: ['order/mark-sent'],
            runQueries: ['order/by-id'],
            schedules: ['email/send-receipt'],
          },
        ],
      }),
    ).toEqual([]);
  });
});
