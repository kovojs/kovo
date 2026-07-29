import { describe, expect, it } from 'vitest';

import { renderRouteHtml } from '@kovojs/server/rendering';

import { renderOrderHistory } from './components/order-history-view.js';

describe('commerce authored TSX output', () => {
  it('lowers authored order identity to the runtime kovo-key stamp', () => {
    const html = renderRouteHtml(
      renderOrderHistory({
        items: [{ id: 'order-proof', productId: 'p1', qty: 2, total: 2998, userId: 'u1' }],
      }),
    );

    // SPEC §5.2/§13.2: the example authors `key`; only rendered output carries lowered IR.
    expect(html).toContain('<li kovo-key="order-proof"');
  });
});
