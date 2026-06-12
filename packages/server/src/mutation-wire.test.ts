import { describe, expect, it } from 'vitest';

import { createMemoryMutationReplayStore } from './index.js';
import { mutationWireRequestFromHeaders, readMutationWireHeaders } from './mutation-wire.js';

describe('mutation wire headers', () => {
  it('reads enhanced mutation wire headers case-insensitively', () => {
    expect(
      readMutationWireHeaders({
        'fw-fragment': 'true',
        'FW-Idem': ' idem_01HX ',
        'FW-Targets': 'cart-badge=cart; recommendations=product:p1, cart-badge=cart',
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
          ['FW-Fragment', 'true'],
          ['FW-Idem', 'idem_01HY'],
          ['FW-Targets', 'product-form:p1'],
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
