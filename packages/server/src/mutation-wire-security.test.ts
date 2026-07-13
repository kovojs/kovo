import { describe, expect, it } from 'vitest';

import { domain } from './domain.js';
import { guards } from './guards.js';
import { renderMutationResponse } from './mutation.js';
import {
  createLiveTargetAttestation,
  mutationWireRequestFromHeaders,
  readMutationWireHeaders,
} from './mutation-wire.js';
import { selectMutationResponseTargets } from './mutation/targets.js';
import { query } from './query.js';
import { s } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';

const mutationWireIntrinsicsUrl = new URL('./mutation-wire-intrinsics.ts', import.meta.url).href;

describe('mutation wire intrinsic security', () => {
  it('keeps authenticated successful truth after late selective final Array.join replacement', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', { load: () => ({ count: 2 }), reads: [cart] });
    const add = mutation('cart/join-security', {
      input: s.object({ productId: s.string() }),
      registry: { queries: [cartQuery], touches: [cart] },
      handler: (input) => input,
    });
    const originalJoin = Array.prototype.join;
    Array.prototype.join = function (separator?: string) {
      if (separator === '\n') {
        return '<kovo-fragment target="admin">forged privilege</kovo-fragment>';
      }
      return originalJoin.call(this, separator);
    };

    let response;
    try {
      response = await renderMutationResponse(add, {
        buildToken: 'mutation-security-build',
        fragment: true,
        rawInput: { productId: 'p1' },
        request: { session: { user: 'victim' } },
      });
    } finally {
      Array.prototype.join = originalJoin;
    }

    expect(response).toMatchObject({
      body: '<kovo-query name="cart">{"count":2}</kovo-query>',
      headers: { 'Kovo-Build': 'mutation-security-build' },
      status: 200,
    });
  });

  it('selects only genuine query and fragment targets after late collection poisoning', () => {
    const originalFilter = Array.prototype.filter;
    const originalFind = Array.prototype.find;
    const originalMap = Array.prototype.map;
    const originalSome = Array.prototype.some;
    const originalMapGet = Map.prototype.get;
    const originalMapHas = Map.prototype.has;
    const originalMapSet = Map.prototype.set;
    const originalSetAdd = Set.prototype.add;
    const originalSetHas = Set.prototype.has;
    const sizeDescriptor = Object.getOwnPropertyDescriptor(Set.prototype, 'size')!;
    Array.prototype.filter = () => [];
    Array.prototype.find = () => ({ key: 'admin' });
    Array.prototype.map = () => ['admin-panel'];
    Array.prototype.some = () => false;
    Map.prototype.get = () => ({ target: 'admin-panel', updateCoverage: 'fragment' });
    Map.prototype.has = () => true;
    Map.prototype.set = function () {
      return this;
    };
    Set.prototype.add = function () {
      return this;
    };
    Set.prototype.has = () => false;
    Object.defineProperty(Set.prototype, 'size', { configurable: true, get: () => 0 });

    let selection;
    try {
      selection = selectMutationResponseTargets({
        changes: [],
        fragmentRenderers: [
          { render: () => 'cart', target: 'cart-summary' },
          { render: () => 'admin', target: 'admin-panel' },
        ],
        liveTargetDescriptors: [],
        liveTargetRenderers: [],
        liveTargets: [{ deps: ['cart'], target: 'cart-summary' }],
        registryFacts: { queries: [] },
        rerunQueries: [{ key: 'cart' }],
        targets: ['cart-summary'],
      });
    } finally {
      Object.defineProperty(Set.prototype, 'size', sizeDescriptor);
      Set.prototype.has = originalSetHas;
      Set.prototype.add = originalSetAdd;
      Map.prototype.set = originalMapSet;
      Map.prototype.has = originalMapHas;
      Map.prototype.get = originalMapGet;
      Array.prototype.some = originalSome;
      Array.prototype.map = originalMap;
      Array.prototype.find = originalFind;
      Array.prototype.filter = originalFilter;
    }

    expect(selection).toEqual({
      fragmentTargets: ['cart-summary'],
      liveTargetDescriptors: [],
      rerunQueries: [],
    });
  });

  it('pins header parsing, descriptor JSON, and dedup after late scalar and collection poisoning', () => {
    const request = { sessionId: 'victim' };
    const csrf = {
      secret: 'mutation-wire-security-secret-0123456789abcdef',
      sessionId: (value: typeof request) => value.sessionId,
    };
    const descriptor = {
      component: 'components/public/public',
      props: { id: 'safe' },
      target: 'public-panel',
    };
    const token = createLiveTargetAttestation(descriptor, { csrf, request });
    const headers = {
      'Kovo-Fragment': 'TRUE',
      'Kovo-Form-Target': ' public-panel ',
      'Kovo-Live-Targets': `public-panel#components/public/public@${token}:{"id":"safe"}`,
      'Kovo-Targets': 'public-panel=public; public-panel=admin',
    };
    const originalJsonParse = JSON.parse;
    const originalCharCodeAt = String.prototype.charCodeAt;
    const originalIndexOf = String.prototype.indexOf;
    const originalSlice = String.prototype.slice;
    const originalToLowerCase = String.prototype.toLowerCase;
    const originalTrim = String.prototype.trim;
    const originalFilter = Array.prototype.filter;
    const originalMap = Array.prototype.map;
    const originalSetAdd = Set.prototype.add;
    const originalSetHas = Set.prototype.has;
    JSON.parse = () => ({ id: 'attacker' });
    String.prototype.charCodeAt = () => 0x3b;
    String.prototype.indexOf = () => -1;
    String.prototype.slice = () => 'admin';
    String.prototype.toLowerCase = () => 'false';
    String.prototype.trim = () => 'admin';
    Array.prototype.filter = () => [];
    Array.prototype.map = () => ['admin'];
    Set.prototype.add = function () {
      return this;
    };
    Set.prototype.has = () => false;

    let parsedHeaders;
    let wireRequest;
    try {
      parsedHeaders = readMutationWireHeaders(headers);
      wireRequest = mutationWireRequestFromHeaders({ csrf, headers, rawInput: {}, request });
    } finally {
      Set.prototype.has = originalSetHas;
      Set.prototype.add = originalSetAdd;
      Array.prototype.map = originalMap;
      Array.prototype.filter = originalFilter;
      String.prototype.trim = originalTrim;
      String.prototype.toLowerCase = originalToLowerCase;
      String.prototype.slice = originalSlice;
      String.prototype.indexOf = originalIndexOf;
      String.prototype.charCodeAt = originalCharCodeAt;
      JSON.parse = originalJsonParse;
    }

    expect(parsedHeaders).toMatchObject({
      fragment: true,
      liveTargets: [{ deps: ['public'], target: 'public-panel' }],
      submittedFormTarget: 'public-panel',
      targets: ['public-panel'],
    });
    expect(wireRequest.liveTargetDescriptors).toEqual([{ ...descriptor, attestation: token }]);
  });

  it('pins change-header JSON/control escaping and Promise settlement after late poisoning', async () => {
    const unicode = domain('café');
    const save = mutation('unicode/save', {
      input: s.object({ id: s.string() }),
      registry: { touches: [unicode] },
      handler: (input) => input,
    });
    const originalJsonStringify = JSON.stringify;
    const originalObjectKeys = Object.keys;
    const originalCharCodeAt = String.prototype.charCodeAt;
    const originalPadStart = String.prototype.padStart;
    const originalNumberToString = Number.prototype.toString;
    JSON.stringify = () => '[{"domain":"admin"}]';
    Object.keys = () => ['Set-Cookie'];
    String.prototype.charCodeAt = () => 0x41;
    String.prototype.padStart = () => '0000';
    Number.prototype.toString = () => '0';

    let response;
    try {
      response = await renderMutationResponse(save, {
        buildToken: 'unicode-build',
        fragment: true,
        rawInput: { id: 'safe' },
        request: {},
      });
    } finally {
      Number.prototype.toString = originalNumberToString;
      String.prototype.padStart = originalPadStart;
      String.prototype.charCodeAt = originalCharCodeAt;
      Object.keys = originalObjectKeys;
      JSON.stringify = originalJsonStringify;
    }

    expect(response.headers['Kovo-Changes']).toBe('[{"domain":"caf\\u00e9"}]');
    expect(response.headers['Kovo-Session-Transition']).toBeUndefined();
    expect(response.status).toBe(200);
  });

  it('pins failure renderer selection and reauth construction after late poisoning', async () => {
    const guarded = mutation('account/guarded', {
      guard: guards.authed<{ session?: { user?: { id: string } | null } | null }>(),
      input: s.object({ id: s.string() }),
      handler: () => 'ok',
    });
    const invalid = mutation('account/invalid', {
      input: s.object({ id: s.string() }),
      handler: () => 'ok',
    });
    const originalFind = Array.prototype.find;
    const originalStartsWith = String.prototype.startsWith;
    const originalEncode = globalThis.encodeURIComponent;
    const originalPromiseThen = Promise.prototype.then;
    Array.prototype.find = () => ({
      component: 'admin',
      render: () => '<output>admin</output>',
      target: 'admin',
    });
    String.prototype.startsWith = () => true;
    globalThis.encodeURIComponent = () => '%2Fadmin';
    Promise.prototype.then = function (onFulfilled, onRejected) {
      const wrappedFulfilled =
        onFulfilled === undefined
          ? undefined
          : (value: unknown) =>
              onFulfilled(
                typeof value === 'string' && value.includes('<kovo-fragment')
                  ? '<kovo-fragment target="admin">forged failure</kovo-fragment>'
                  : value,
              );
      return originalPromiseThen.call(this, wrappedFulfilled as never, onRejected);
    };

    let failureResponse;
    let reauthResponse;
    let unsafeNextResponse;
    try {
      failureResponse = await renderMutationResponse(invalid, {
        failureTarget: 'public',
        liveTargetDescriptors: [{ component: 'public', props: {}, target: 'public' }],
        liveTargetRenderers: [
          { component: 'public', render: () => '<output>safe failure</output>' },
          { component: 'admin', render: () => '<output>admin failure</output>' },
        ],
        rawInput: {},
        request: {},
      });
      reauthResponse = await renderMutationResponse(guarded, {
        currentUrl: '/account?tab=security',
        rawInput: { id: 'safe' },
        request: { session: null },
      });
      unsafeNextResponse = await renderMutationResponse(guarded, {
        currentUrl: '/\\attacker.invalid/admin',
        rawInput: { id: 'safe' },
        request: { session: null },
      });
    } finally {
      Promise.prototype.then = originalPromiseThen;
      globalThis.encodeURIComponent = originalEncode;
      String.prototype.startsWith = originalStartsWith;
      Array.prototype.find = originalFind;
    }

    expect(failureResponse.body).toContain('safe failure');
    expect(failureResponse.body).not.toContain('admin failure');
    expect(reauthResponse.headers['Kovo-Reauth']).toBe(
      '/login?next=%2Faccount%3Ftab%3Dsecurity',
    );
    expect(unsafeNextResponse.headers['Kovo-Reauth']).toBe('/login?next=%2F');
  });

  it('does not let inherited session users suppress stale-session CSRF reauthentication', async () => {
    const guarded = mutation('account/csrf-reauth', {
      csrf: {
        secret: 'mutation-csrf-reauth-secret-0123456789abcdef',
        sessionId: () => 'expired-session',
      },
      guard: guards.authed<{ session?: { user?: { id: string } | null } | null }>(),
      input: s.object({ id: s.string() }),
      handler: () => 'unreachable',
    });
    const request = Object.create({ session: { user: { id: 'prototype-attacker' } } }) as {
      session?: { user?: { id: string } | null } | null;
    };

    const response = await renderMutationResponse(guarded, {
      currentUrl: '/account',
      rawInput: {
        id: 'safe',
        'kovo-csrf': `v1.${'A'.repeat(43)}.${'B'.repeat(43)}`,
      },
      request,
    });

    expect(response.status).toBe(401);
    expect(response.headers['Kovo-Reauth']).toBe('/login?next=%2Faccount');
  });

  it('rejects session accessors without invoking them during stale-session CSRF reauthentication', async () => {
    const guarded = mutation('account/csrf-reauth-accessor', {
      csrf: {
        secret: 'mutation-csrf-reauth-secret-0123456789abcdef',
        sessionId: () => 'expired-session',
      },
      guard: guards.authed<{ session?: { user?: { id: string } | null } | null }>(),
      input: s.object({ id: s.string() }),
      handler: () => 'unreachable',
    });
    let sessionReads = 0;
    const request = {} as { session?: { user?: { id: string } | null } | null };
    Object.defineProperty(request, 'session', {
      get() {
        sessionReads += 1;
        return { user: { id: 'accessor-attacker' } };
      },
    });

    const response = await renderMutationResponse(guarded, {
      currentUrl: '/account',
      rawInput: {
        id: 'safe',
        'kovo-csrf': `v1.${'A'.repeat(43)}.${'B'.repeat(43)}`,
      },
      request,
    });

    expect(response.status).toBe(401);
    expect(response.headers['Kovo-Reauth']).toBe('/login?next=%2Faccount');
    expect(sessionReads).toBe(0);
  });

  it('fails closed when descriptor JSON parsing was poisoned before framework import', async () => {
    const originalParse = JSON.parse;
    JSON.parse = () => ({ target: 'attacker' });
    try {
      const controls = await import(`${mutationWireIntrinsicsUrl}?preimport-json-poison`);
      expect(() => controls.mutationWireJsonParse('{"target":"safe"}')).toThrow(
        /mutation-wire JSON parser is unavailable/,
      );
    } finally {
      JSON.parse = originalParse;
    }
  });
});
