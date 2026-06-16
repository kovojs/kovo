import { describe, expect, it } from 'vitest';

import { mutationWireRequestFromHeaders, readMutationWireHeaders } from './mutation-wire.js';
import { createMemoryMutationReplayStore } from './replay.js';

describe('mutation wire headers', () => {
  it('reads enhanced mutation wire headers case-insensitively', () => {
    expect(
      readMutationWireHeaders({
        'kovo-fragment': 'true',
        'Kovo-Idem': ' idem_01HX ',
        'Kovo-Targets': 'cart-badge=cart; recommendations=product:p1, cart-badge=cart',
      }),
    ).toEqual({
      fragment: true,
      idem: 'idem_01HX',
      targets: ['cart-badge', 'recommendations'],
    });
  });

  it('builds mutation wire requests from iterable HTTP headers', () => {
    const replayStore = createMemoryMutationReplayStore();

    expect(
      mutationWireRequestFromHeaders({
        headers: new Map([
          ['Kovo-Fragment', 'true'],
          ['Kovo-Idem', 'idem_01HY'],
          ['Kovo-Targets', 'product-form:p1'],
        ]),
        rawInput: { productId: 'p1', quantity: 99 },
        replayStore,
        request: { sessionId: 's1' },
      }),
    ).toEqual({
      fragment: true,
      idem: 'idem_01HY',
      rawInput: { productId: 'p1', quantity: 99 },
      replayStore,
      request: { sessionId: 's1' },
      targets: ['product-form:p1'],
    });
  });
});
