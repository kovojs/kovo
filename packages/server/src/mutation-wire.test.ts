import { describe, expect, it } from 'vitest';

import {
  MAX_MUTATION_WIRE_TARGETS,
  createLiveTargetAttestation,
  mutationWireRequestFromHeaders,
  readMutationWireHeaders,
} from './mutation-wire.js';
import { createMemoryMutationReplayStore } from './replay.js';

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

  // L3 (SPEC §9.1): the precomputed `requestFingerprint` must be body-sensitive for a
  // FormData/multipart body. Before the fix, canonicalJson(formData) === "{}" for EVERY
  // multipart body here, so the conflict defense downstream never fired (the enhanced JS
  // client always submits FormData).
  it('precomputes a body-sensitive replay fingerprint for FormData wire requests', () => {
    const fingerprintFor = (productId: string): string | undefined => {
      const body = new FormData();
      body.set('productId', productId);
      return mutationWireRequestFromHeaders({
        headers: {},
        rawInput: body,
        request: { sessionId: 's1' },
      }).requestFingerprint;
    };

    const a = fingerprintFor('p1');
    const b = fingerprintFor('p2');
    const aAgain = fingerprintFor('p1');

    expect(a).not.toBe('{}');
    expect(a).not.toBe(b);
    expect(a).toBe(aAgain);
    expect(a).toBe('{"productId":"p1"}');
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
    const token = createLiveTargetAttestation(descriptor, { csrf, request });

    expect(
      mutationWireRequestFromHeaders({
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
      requestFingerprint: '{"productId":"p1","quantity":99}',
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
        csrf,
        headers: {
          'Kovo-Live-Targets': `product-form:p1#components/product-form/product-form@${token}:{"productId":"p1"}`,
        },
        rawInput: {},
        request,
      }).liveTargetDescriptors,
    ).toHaveLength(1);

    expect(
      mutationWireRequestFromHeaders({
        buildToken: 'build-a',
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

  it('attests no-CSRF live-target descriptors with a deployment-stable secret (M8)', () => {
    const previousSecret = process.env.KOVO_LIVE_TARGET_SECRET;
    const request = {};
    const descriptor = {
      component: 'components/product-form/product-form',
      props: { productId: 'p1' },
      target: 'product-form:p1',
    };
    try {
      process.env.KOVO_LIVE_TARGET_SECRET = 'live-target-deployment-secret-a';
      const token = createLiveTargetAttestation(descriptor, { request });

      expect(
        mutationWireRequestFromHeaders({
          headers: {
            'Kovo-Live-Targets': `product-form:p1#components/product-form/product-form@${token}:{"productId":"p1"}`,
          },
          rawInput: {},
          request,
        }).liveTargetDescriptors,
      ).toHaveLength(1);

      process.env.KOVO_LIVE_TARGET_SECRET = 'live-target-deployment-secret-b';
      expect(
        mutationWireRequestFromHeaders({
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
          { request: {} },
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
    const count = 10_000;
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
    expect(headers.liveTargets.length).toBeLessThanOrEqual(MAX_MUTATION_WIRE_TARGETS);
    expect(headers.liveTargetDescriptors.length).toBeLessThanOrEqual(MAX_MUTATION_WIRE_TARGETS);
    expect(headers.targets.length).toBeLessThanOrEqual(MAX_MUTATION_WIRE_TARGETS);
  });
});
