import { describe, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';

import {
  MAX_MUTATION_WIRE_TARGET_HEADER_CHARACTERS,
  MAX_MUTATION_WIRE_TARGETS,
  createLiveTargetAttestation,
  mutationWireRequestFromHeaders,
  readMutationWireHeaders,
} from './mutation-wire.js';
import { createMemoryMutationReplayStore } from './replay.js';
import { registerFrameworkSessionPrincipalSnapshot } from './auth-principal.js';

describe('mutation wire headers', () => {
  it('reads enhanced mutation wire headers case-insensitively', () => {
    expect(
      readMutationWireHeaders({
        'kovo-fragment': 'true',
        'Kovo-Idem': ' idem_01HX ',
        'Kovo-Live-Targets':
          'cart-badge#components/cart/cart-badge/cart-badge@tok_cart:{}; recommendations#components/recommendations/recommendations@tok_rec:{"productId":"p1;still-json"}; cart-badge#ignored@tok_ignored:{}',
        'Kovo-Targets': 'cart-badge=cart; recommendations=product:p1, cart-badge=cart',
      }),
    ).toEqual({
      fragment: true,
      idem: 'idem_01HX',
      liveTargetDescriptors: [
        {
          component: 'components/cart/cart-badge/cart-badge',
          attestation: 'tok_cart',
          props: {},
          target: 'cart-badge',
        },
        {
          component: 'components/recommendations/recommendations',
          attestation: 'tok_rec',
          props: { productId: 'p1;still-json' },
          target: 'recommendations',
        },
      ],
      liveTargets: [
        { deps: ['cart'], target: 'cart-badge' },
        { deps: ['product:p1'], target: 'recommendations' },
      ],
      stream: false,
      targets: ['cart-badge', 'recommendations'],
    });
  });

  it('defers upload replay hashing until the post-CSRF/schema/guard lifecycle', () => {
    let uploadReads = 0;
    const rawInput = {
      upload: {
        async arrayBuffer() {
          uploadReads += 1;
          return new Uint8Array([1]).buffer;
        },
        name: 'one.bin',
        size: 1,
        type: 'application/octet-stream',
      },
    };

    const wireRequest = mutationWireRequestFromHeaders({
      headers: {},
      rawInput,
      request: { sessionId: 's1' },
    });

    expect(wireRequest.requestFingerprint).toBeUndefined();
    expect(wireRequest.rawInput).toBe(rawInput);
    expect(uploadReads).toBe(0);
  });

  it('builds mutation wire requests from iterable HTTP headers', () => {
    const replayStore = createMemoryMutationReplayStore();

    const request = { sessionId: 's1' };
    const csrf = {
      secret: 'live-target-secret-0123456789abcdef',
      sessionId: (value: typeof request) => value.sessionId,
    };
    const descriptor = {
      component: 'components/product-form/product-form',
      props: { productId: 'p1' },
      target: 'product-form:p1',
    };
    const token = createLiveTargetAttestation(descriptor, {
      buildToken: 'mutation-wire-test-build',
      csrf,
      request,
    });

    expect(
      mutationWireRequestFromHeaders({
        buildToken: 'mutation-wire-test-build',
        liveTargetAudience: 'mutation-wire-test-build',
        csrf,
        headers: new Map([
          ['Kovo-Fragment', 'true'],
          ['Kovo-Form-Target', 'product-form:p1'],
          ['Kovo-Idem', 'idem_01HY'],
          ['Kovo-Stream', 'true'],
          [
            'Kovo-Live-Targets',
            `product-form:p1#components/product-form/product-form@${token}:{"productId":"p1"}`,
          ],
          ['Kovo-Targets', 'product-form:p1=product:p1'],
        ]),
        rawInput: { productId: 'p1', quantity: 99 },
        replayStore,
        request,
      }),
    ).toEqual({
      buildToken: 'mutation-wire-test-build',
      liveTargetAudience: 'mutation-wire-test-build',
      csrf,
      fragment: true,
      idem: 'idem_01HY',
      liveTargetDescriptors: [
        {
          attestation: token,
          component: 'components/product-form/product-form',
          props: { productId: 'p1' },
          target: 'product-form:p1',
        },
      ],
      liveTargets: [{ deps: ['product:p1'], target: 'product-form:p1' }],
      rawInput: { productId: 'p1', quantity: 99 },
      replayStore,
      request: { sessionId: 's1' },
      stream: true,
      submittedFormTarget: 'product-form:p1',
      targets: ['product-form:p1'],
    });
  });

  it('drops unattested or wrong-principal live-target descriptors before query execution', () => {
    const request = { sessionId: 's1' };
    const csrf = {
      secret: 'live-target-secret-0123456789abcdef',
      sessionId: (value: typeof request) => value.sessionId,
    };
    const descriptor = {
      component: 'components/product-form/product-form',
      props: { productId: 'p1' },
      target: 'product-form:p1',
    };
    const token = createLiveTargetAttestation(descriptor, { buildToken: 'build-a', csrf, request });

    expect(
      mutationWireRequestFromHeaders({
        buildToken: 'build-a',
        liveTargetAudience: 'build-a',
        csrf,
        headers: {
          'Kovo-Live-Targets': `product-form:p1#components/product-form/product-form@${token}:{"productId":"p1"}`,
        },
        rawInput: {},
        request,
      }).liveTargetDescriptors,
    ).toHaveLength(1);

    // SPEC §5.2.1/§14: the attestation audience includes the exact render-plan build. A stale
    // document descriptor must not authorize a different deployment's generated renderer/query
    // registry before the client can observe Kovo-Build skew and reload.
    expect(
      mutationWireRequestFromHeaders({
        buildToken: 'build-b',
        liveTargetAudience: 'build-b',
        csrf,
        headers: {
          'Kovo-Live-Targets': `product-form:p1#components/product-form/product-form@${token}:{"productId":"p1"}`,
        },
        rawInput: {},
        request,
      }).liveTargetDescriptors,
    ).toEqual([]);

    expect(
      mutationWireRequestFromHeaders({
        buildToken: 'build-a',
        liveTargetAudience: 'build-a',
        csrf: { ...csrf, secret: 'different-live-target-secret-0123456789abcdef' },
        headers: {
          'Kovo-Live-Targets': `product-form:p1#components/product-form/product-form@${token}:{"productId":"p1"}`,
        },
        rawInput: {},
        request,
      }).liveTargetDescriptors,
    ).toEqual([]);

    expect(
      mutationWireRequestFromHeaders({
        buildToken: 'build-a',
        liveTargetAudience: 'build-a',
        csrf,
        headers: {
          'Kovo-Live-Targets': `product-form:p1#components/product-form/product-form@${token.slice(0, -1)}:{"productId":"p1"}`,
        },
        rawInput: {},
        request,
      }).liveTargetDescriptors,
    ).toEqual([]);

    expect(
      mutationWireRequestFromHeaders({
        buildToken: 'build-a',
        liveTargetAudience: 'build-a',
        csrf,
        headers: {
          'Kovo-Live-Targets': `product-form:p1#components/product-form/product-form@${token}a:{"productId":"p1"}`,
        },
        rawInput: {},
        request,
      }).liveTargetDescriptors,
    ).toEqual([]);

    expect(
      mutationWireRequestFromHeaders({
        buildToken: 'build-a',
        liveTargetAudience: 'build-a',
        csrf,
        headers: {
          'Kovo-Live-Targets':
            'product-form:p1#components/product-form/product-form:{"productId":"p1"}',
        },
        rawInput: {},
        request,
      }).liveTargetDescriptors,
    ).toEqual([]);
  });

  it('does not accept a no-CSRF live-target descriptor after the resolved principal changes', () => {
    const descriptor = {
      component: 'components/account/summary',
      props: { accountId: 'account-a' },
      target: 'account-summary',
    };
    const originalRequest = { session: { user: { id: 'user-a' } } };
    const otherPrincipalRequest = { session: { user: { id: 'user-b' } } };
    const token = createLiveTargetAttestation(descriptor, {
      buildToken: 'principal-bound-audience',
      request: originalRequest,
    });
    const headers = {
      'Kovo-Live-Targets': `account-summary#components/account/summary@${token}:{"accountId":"account-a"}`,
    };

    expect(
      mutationWireRequestFromHeaders({
        buildToken: 'principal-build',
        headers,
        liveTargetAudience: 'principal-bound-audience',
        rawInput: {},
        request: originalRequest,
      }).liveTargetDescriptors,
    ).toHaveLength(1);
    expect(
      mutationWireRequestFromHeaders({
        buildToken: 'principal-build',
        headers,
        liveTargetAudience: 'principal-bound-audience',
        rawInput: {},
        request: otherPrincipalRequest,
      }).liveTargetDescriptors,
    ).toEqual([]);
  });

  it('binds distinct configured CSRF session and pinned user identities', () => {
    const descriptor = {
      component: 'components/account/summary',
      props: { accountId: 'account-a' },
      target: 'account-summary',
    };
    const originalRequest = {
      csrfPrincipal: 'session-shared',
      session: { user: { id: 'user-a' } },
    };
    const confusedRequest = {
      csrfPrincipal: 'session-shared',
      session: { user: { id: 'user-b' } },
    };
    const rotatedSessionRequest = {
      csrfPrincipal: 'session-rotated',
      session: { user: { id: 'user-a' } },
    };
    const csrf = {
      secret: 'live-target-secret-0123456789abcdef',
      sessionId: (request: typeof originalRequest) => request.csrfPrincipal,
    };
    const token = createLiveTargetAttestation(descriptor, {
      buildToken: 'principal-bound-audience',
      csrf,
      request: originalRequest,
    });
    const headers = {
      'Kovo-Live-Targets': `account-summary#components/account/summary@${token}:{"accountId":"account-a"}`,
    };

    expect(
      mutationWireRequestFromHeaders({
        buildToken: 'principal-build',
        csrf,
        headers,
        liveTargetAudience: 'principal-bound-audience',
        rawInput: {},
        request: originalRequest,
      }).liveTargetDescriptors,
    ).toHaveLength(1);
    expect(
      mutationWireRequestFromHeaders({
        buildToken: 'principal-build',
        csrf,
        headers,
        liveTargetAudience: 'principal-bound-audience',
        rawInput: {},
        request: confusedRequest,
      }).liveTargetDescriptors,
    ).toEqual([]);
    expect(
      mutationWireRequestFromHeaders({
        buildToken: 'principal-build',
        csrf,
        headers,
        liveTargetAudience: 'principal-bound-audience',
        rawInput: {},
        request: rotatedSessionRequest,
      }).liveTargetDescriptors,
    ).toEqual([]);
  });

  it('rejects a configured CSRF binding when the framework session principal is unresolved', () => {
    const request = {
      csrfPrincipal: 'session-a',
      session: { account: { id: 'user-a' } },
    };
    registerFrameworkSessionPrincipalSnapshot(request, request.session);

    expect(() =>
      createLiveTargetAttestation(
        {
          component: 'components/account/summary',
          props: { accountId: 'account-a' },
          target: 'account-summary',
        },
        {
          buildToken: 'principal-bound-audience',
          csrf: {
            secret: 'live-target-secret-0123456789abcdef',
            sessionId: (value: typeof request) => value.csrfPrincipal,
          },
          request,
        },
      ),
    ).toThrow(/unresolved framework session principal/u);
  });

  it('binds live-target descriptors to the exact document URL context that minted them', () => {
    const descriptor = {
      component: 'components/contextual/contextual',
      props: {},
      target: 'contextual',
    };
    const request = new Request('https://app.test/public?view=summary');
    const token = createLiveTargetAttestation(descriptor, {
      buildToken: 'context-bound-audience',
      request,
    });
    const headers = {
      'Kovo-Live-Targets': `contextual#components/contextual/contextual@${token}:{}`,
    };

    expect(
      mutationWireRequestFromHeaders({
        buildToken: 'context-build',
        headers,
        liveTargetAudience: 'context-bound-audience',
        liveTargetSourceUrl: 'https://app.test/public?view=summary',
        rawInput: {},
        request: new Request('https://app.test/_m/save', { method: 'POST' }),
      }).liveTargetDescriptors,
    ).toHaveLength(1);
    expect(
      mutationWireRequestFromHeaders({
        buildToken: 'context-build',
        headers,
        liveTargetAudience: 'context-bound-audience',
        liveTargetSourceUrl: 'https://app.test/admin?view=summary',
        rawInput: {},
        request: new Request('https://app.test/_m/save', { method: 'POST' }),
      }).liveTargetDescriptors,
    ).toEqual([]);
  });

  it('fails closed when live-target attestation is asked to use an unresolved principal', () => {
    const request = { sessionId: 'unknown' };
    const csrf = {
      secret: 'live-target-secret-0123456789abcdef',
      sessionId: (value: typeof request) => value.sessionId,
    };
    const descriptor = {
      component: 'components/product-form/product-form',
      props: { productId: 'p1' },
      target: 'product-form:p1',
    };

    expect(() =>
      createLiveTargetAttestation(descriptor, { buildToken: 'build-a', csrf, request }),
    ).toThrow(/unresolved session principal/);

    expect(
      mutationWireRequestFromHeaders({
        buildToken: 'build-a',
        liveTargetAudience: 'build-a',
        csrf,
        headers: {
          'Kovo-Live-Targets':
            'product-form:p1#components/product-form/product-form@attested:{"productId":"p1"}',
        },
        rawInput: {},
        request,
      }).liveTargetDescriptors,
    ).toEqual([]);
  });

  it('attests no-CSRF live-target descriptors with a deployment-stable secret (M8)', () => {
    const previousSecret = process.env.KOVO_LIVE_TARGET_SECRET;
    const request = {};
    const descriptor = {
      component: 'components/product-form/product-form',
      props: { productId: 'p1' },
      target: 'product-form:p1',
    };
    try {
      process.env.KOVO_LIVE_TARGET_SECRET = 'live-target-deployment-secret-a-012345';
      const token = createLiveTargetAttestation(descriptor, {
        buildToken: 'mutation-wire-test-build',
        request,
      });

      expect(
        mutationWireRequestFromHeaders({
          buildToken: 'mutation-wire-test-build',
          liveTargetAudience: 'mutation-wire-test-build',
          headers: {
            'Kovo-Live-Targets': `product-form:p1#components/product-form/product-form@${token}:{"productId":"p1"}`,
          },
          rawInput: {},
          request,
        }).liveTargetDescriptors,
      ).toHaveLength(1);

      process.env.KOVO_LIVE_TARGET_SECRET = 'live-target-deployment-secret-b-012345';
      expect(
        mutationWireRequestFromHeaders({
          buildToken: 'mutation-wire-test-build',
          liveTargetAudience: 'mutation-wire-test-build',
          headers: {
            'Kovo-Live-Targets': `product-form:p1#components/product-form/product-form@${token}:{"productId":"p1"}`,
          },
          rawInput: {},
          request,
        }).liveTargetDescriptors,
      ).toEqual([]);
    } finally {
      if (previousSecret === undefined) {
        delete process.env.KOVO_LIVE_TARGET_SECRET;
      } else {
        process.env.KOVO_LIVE_TARGET_SECRET = previousSecret;
      }
    }
  });

  it('uses captured HMAC and hash methods after evaluated app code poisons crypto prototypes', () => {
    const hmac = createHmac('sha256', 'control');
    const hash = createHash('sha256');
    const hmacPrototype = Object.getPrototypeOf(hmac);
    const hashPrototype = Object.getPrototypeOf(hash);
    const originalHmacUpdate = hmacPrototype.update;
    const originalHashUpdate = hashPrototype.update;
    const previousSecret = process.env.KOVO_LIVE_TARGET_SECRET;
    try {
      hmacPrototype.update = () => {
        throw new Error('poisoned HMAC update reached');
      };
      hashPrototype.update = () => {
        throw new Error('poisoned hash update reached');
      };
      process.env.KOVO_LIVE_TARGET_SECRET = 'captured-live-target-secret-0123456789';
      const descriptor = { component: 'components/a', props: { id: '1' }, target: 'a' };
      const token = createLiveTargetAttestation(descriptor, {
        buildToken: 'mutation-wire-test-build',
        request: {},
      });
      expect(
        mutationWireRequestFromHeaders({
          buildToken: 'mutation-wire-test-build',
          liveTargetAudience: 'mutation-wire-test-build',
          headers: { 'Kovo-Live-Targets': `a#components/a@${token}:{"id":"1"}` },
          rawInput: {},
          request: {},
        }).liveTargetDescriptors,
      ).toHaveLength(1);
    } finally {
      hmacPrototype.update = originalHmacUpdate;
      hashPrototype.update = originalHashUpdate;
      if (previousSecret === undefined) delete process.env.KOVO_LIVE_TARGET_SECRET;
      else process.env.KOVO_LIVE_TARGET_SECRET = previousSecret;
    }
  });

  it('fails closed in production when no-CSRF live-target attestation lacks a secret (M8)', () => {
    const previousEnv = process.env.NODE_ENV;
    const previousSecret = process.env.KOVO_LIVE_TARGET_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.KOVO_LIVE_TARGET_SECRET;

      expect(() =>
        createLiveTargetAttestation(
          {
            component: 'components/product-form/product-form',
            props: { productId: 'p1' },
            target: 'product-form:p1',
          },
          { buildToken: 'mutation-wire-test-build', request: {} },
        ),
      ).toThrow(/KOVO_LIVE_TARGET_SECRET is required/);
    } finally {
      if (previousEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousEnv;
      }
      if (previousSecret === undefined) {
        delete process.env.KOVO_LIVE_TARGET_SECRET;
      } else {
        process.env.KOVO_LIVE_TARGET_SECRET = previousSecret;
      }
    }
  });

  // K2 (SPEC §9.5): client-supplied Kovo-Live-Targets / Kovo-Targets headers must be
  // count-capped at parse time so one mutation cannot amplify into thousands of
  // component renders + O(N·M) selection (a >1000× DoS).
  it('K2: caps parsed live-target and descriptor counts at MAX_MUTATION_WIRE_TARGETS', () => {
    const count = MAX_MUTATION_WIRE_TARGETS + 32;
    const liveTargetsHeader = Array.from({ length: count }, (_, i) => `t${i}=dep${i}`).join(',');
    const descriptorsHeader = Array.from(
      { length: count },
      (_, i) => `t${i}#components/x/x@tok${i}:{"i":${i}}`,
    ).join(';');

    const headers = readMutationWireHeaders({
      'Kovo-Fragment': 'true',
      'Kovo-Live-Targets': descriptorsHeader,
      'Kovo-Targets': liveTargetsHeader,
    });

    expect(MAX_MUTATION_WIRE_TARGETS).toBeLessThan(count);
    expect(headers.liveTargets).toHaveLength(MAX_MUTATION_WIRE_TARGETS);
    expect(headers.liveTargetDescriptors).toHaveLength(MAX_MUTATION_WIRE_TARGETS);
    expect(headers.targets).toHaveLength(MAX_MUTATION_WIRE_TARGETS);
  });

  it('K2: rejects oversized target headers before scanning or retaining an entry', () => {
    const oversizedEntry = 'x'.repeat(MAX_MUTATION_WIRE_TARGET_HEADER_CHARACTERS + 1);

    const headers = readMutationWireHeaders({
      'Kovo-Fragment': 'true',
      'Kovo-Live-Targets': oversizedEntry,
      'Kovo-Targets': oversizedEntry,
    });

    expect(headers.liveTargets).toEqual([]);
    expect(headers.liveTargetDescriptors).toEqual([]);
    expect(headers.targets).toEqual([]);
  });
});
