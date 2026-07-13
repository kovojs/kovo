import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';

import {
  deriveAccessExplainFacts,
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

  it('derives guarded access only from executable guard names', () => {
    expect(
      deriveAccessExplainFacts({
        mutations: [
          { access: { guards: ['admin-only'], kind: 'guard-chain' }, key: 'billing/charge' },
          { access: { guards: [], kind: 'guard-chain' }, key: 'billing/email' },
        ],
      }),
    ).toEqual([
      {
        detail: 'access=guards guards=admin-only',
        decision: 'guard',
        kind: 'mutation',
        name: 'billing/charge',
        source: 'access',
      },
      {
        detail: 'missing access fact',
        decision: 'missing',
        kind: 'mutation',
        name: 'billing/email',
        source: 'access',
      },
    ]);
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

  it('does not let late collection traversal erase derived authority facts', () => {
    const endpoints = [
      {
        access: { kind: 'verified-machine-auth' as const },
        auth: 'webhook-verifier',
        csrf: 'exempt' as const,
        path: '/webhooks/stripe',
      },
    ];
    const mutations = [
      { access: { guards: ['authed'], kind: 'guard-chain' as const }, key: 'cart/add' },
    ];
    const queries = [{ domains: ['order'], guards: ['owns:order:arg:id'], query: 'orderById' }];
    const originalMap = Array.prototype.map;
    const originalFlatMap = Array.prototype.flatMap;
    const originalFilter = Array.prototype.filter;
    const originalJoin = Array.prototype.join;
    const originalSome = Array.prototype.some;
    const originalSort = Array.prototype.sort;
    const originalStartsWith = String.prototype.startsWith;
    const originalSlice = String.prototype.slice;
    const originalSplit = String.prototype.split;
    const originalTrim = String.prototype.trim;
    const originalLocaleCompare = String.prototype.localeCompare;
    let poisonHits = 0;
    let accessFacts: ReturnType<typeof deriveAccessExplainFacts> = [];
    let authFacts: ReturnType<typeof deriveAuthPostureFacts> = [];
    let sessionFacts: ReturnType<typeof deriveSessionAuthorityFacts> = [];
    let ownershipFacts: ReturnType<typeof deriveOwnershipPostureFacts> = [];

    try {
      Array.prototype.map = function eraseAuthorityFacts(callback, thisArg) {
        if (this === endpoints || this === mutations || this === queries) {
          poisonHits += 1;
          return [];
        }
        return Reflect.apply(originalMap, this, [callback, thisArg]);
      } as typeof Array.prototype.map;
      Array.prototype.flatMap = function eraseOwnershipFacts(callback, thisArg) {
        if (this === queries) {
          poisonHits += 1;
          return [];
        }
        return Reflect.apply(originalFlatMap, this, [callback, thisArg]);
      } as typeof Array.prototype.flatMap;
      Array.prototype.filter = function eraseDetails() {
        poisonHits += 1;
        return [];
      } as typeof Array.prototype.filter;
      Array.prototype.join = function forgeDetails() {
        poisonHits += 1;
        return 'forged';
      } as typeof Array.prototype.join;
      Array.prototype.some = function eraseGuards() {
        poisonHits += 1;
        return false;
      } as typeof Array.prototype.some;
      Array.prototype.sort = function eraseOrdering() {
        poisonHits += 1;
        this.length = 0;
        return this;
      } as typeof Array.prototype.sort;
      String.prototype.startsWith = function eraseStringGuard() {
        poisonHits += 1;
        return false;
      } as typeof String.prototype.startsWith;
      String.prototype.slice = function forgeStringSlice() {
        poisonHits += 1;
        return '';
      } as typeof String.prototype.slice;
      String.prototype.split = function forgeStringParts() {
        poisonHits += 1;
        return [];
      } as typeof String.prototype.split;
      String.prototype.trim = function forgeTrimmedString() {
        poisonHits += 1;
        return '';
      } as typeof String.prototype.trim;
      String.prototype.localeCompare = function eraseOrdering() {
        poisonHits += 1;
        return 0;
      } as typeof String.prototype.localeCompare;

      accessFacts = deriveAccessExplainFacts({ endpoints, mutations, queries });
      authFacts = deriveAuthPostureFacts({ endpoints, mutations, queries });
      sessionFacts = deriveSessionAuthorityFacts({ endpoints, mutations });
      ownershipFacts = deriveOwnershipPostureFacts({ queries });
    } finally {
      Array.prototype.map = originalMap;
      Array.prototype.flatMap = originalFlatMap;
      Array.prototype.filter = originalFilter;
      Array.prototype.join = originalJoin;
      Array.prototype.some = originalSome;
      Array.prototype.sort = originalSort;
      String.prototype.startsWith = originalStartsWith;
      String.prototype.slice = originalSlice;
      String.prototype.split = originalSplit;
      String.prototype.trim = originalTrim;
      String.prototype.localeCompare = originalLocaleCompare;
    }

    expect(accessFacts).toHaveLength(3);
    expect(authFacts).toHaveLength(3);
    expect(sessionFacts).toHaveLength(2);
    expect(ownershipFacts).toEqual([
      expect.objectContaining({ domain: 'order', name: 'orderById', ownerGuarded: true }),
    ]);
    expect(poisonHits).toBe(0);
  });

  it('does not derive producer-owned access authority from inherited graph fields', () => {
    Object.defineProperties(Object.prototype, {
      access: {
        configurable: true,
        value: { kind: 'public', reason: 'prototype-forged access' },
      },
      guards: { configurable: true, value: ['authed'] },
    });
    try {
      const input = { mutations: [{ key: 'billing/refund' }] } as never;
      expect(deriveAccessExplainFacts(input)).toEqual([
        expect.objectContaining({ decision: 'missing', name: 'billing/refund' }),
      ]);
      expect(deriveAuthPostureFacts(input)).toEqual([
        expect.objectContaining({ guarded: false, name: 'billing/refund' }),
      ]);
    } finally {
      delete (Object.prototype as { access?: unknown }).access;
      delete (Object.prototype as { guards?: unknown }).guards;
    }
  });

  it('does not execute accessor-backed access graph authority', () => {
    let reads = 0;
    const mutation = Object.defineProperties(
      { key: 'billing/refund' },
      {
        access: {
          get() {
            reads += 1;
            return { kind: 'public', reason: 'accessor-forged access' };
          },
        },
      },
    );

    expect(() => deriveAccessExplainFacts({ mutations: [mutation] as never })).toThrow(
      /access must be an own data property/u,
    );
    expect(reads).toBe(0);
  });

  it('keeps reverse-ordered access graph derivation within a bounded work floor', () => {
    const count = 20_000;
    const queries = Array.from({ length: count }, (_, index) => ({
      access: { kind: 'verified-machine-auth' as const },
      query: `query-${String(count - index).padStart(6, '0')}`,
    }));
    const started = performance.now();
    const facts = deriveAccessExplainFacts({ queries });
    const elapsed = performance.now() - started;

    expect(facts).toHaveLength(count);
    expect(facts[0]?.name).toBe('query-000001');
    // The prior insertion sort took about 4.2 seconds locally at this size.
    expect(elapsed).toBeLessThan(2_000);
  });

  it('enforces one aggregate budget across nested graph arrays', () => {
    const domains = new Array<string>(50_000);
    domains.fill('account');
    expect(() =>
      deriveAccessExplainFacts({
        queries: [
          { domains, query: 'first' },
          { domains, query: 'second' },
        ],
      }),
    ).toThrow(/100000-entry aggregate bound/u);
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
