import { describe, expect, it } from 'vitest';

import { mutationWireRequestFromHeaders, readMutationWireHeaders } from './mutation-wire.js';
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
});
