import { describe, expect, it } from 'vitest';

import {
  MAX_MUTATION_WIRE_TARGETS,
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
          'cart-badge#components/cart/cart-badge/cart-badge:{}; recommendations#components/recommendations/recommendations:{"productId":"p1;still-json"}; cart-badge#ignored:{}',
        'Kovo-Targets': 'cart-badge=cart; recommendations=product:p1, cart-badge=cart',
      }),
    ).toEqual({
      fragment: true,
      idem: 'idem_01HX',
      liveTargetDescriptors: [
        {
          component: 'components/cart/cart-badge/cart-badge',
          props: {},
          target: 'cart-badge',
        },
        {
          component: 'components/recommendations/recommendations',
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

  it('builds mutation wire requests from iterable HTTP headers', () => {
    const replayStore = createMemoryMutationReplayStore();

    expect(
      mutationWireRequestFromHeaders({
        headers: new Map([
          ['Kovo-Fragment', 'true'],
          ['Kovo-Form-Target', 'product-form:p1'],
          ['Kovo-Idem', 'idem_01HY'],
          ['Kovo-Stream', 'true'],
          [
            'Kovo-Live-Targets',
            'product-form:p1#components/product-form/product-form:{"productId":"p1"}',
          ],
          ['Kovo-Targets', 'product-form:p1=product:p1'],
        ]),
        rawInput: { productId: 'p1', quantity: 99 },
        replayStore,
        request: { sessionId: 's1' },
      }),
    ).toEqual({
      fragment: true,
      idem: 'idem_01HY',
      liveTargetDescriptors: [
        {
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

  // K2 (SPEC §9.5): client-supplied Kovo-Live-Targets / Kovo-Targets headers must be
  // count-capped at parse time so one mutation cannot amplify into thousands of
  // component renders + O(N·M) selection (a >1000× DoS).
  it('K2: caps parsed live-target and descriptor counts at MAX_MUTATION_WIRE_TARGETS', () => {
    const count = 10_000;
    const liveTargetsHeader = Array.from({ length: count }, (_, i) => `t${i}=dep${i}`).join(',');
    const descriptorsHeader = Array.from(
      { length: count },
      (_, i) => `t${i}#components/x/x:{"i":${i}}`,
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
