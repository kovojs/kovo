import { describe, expect, it } from 'vitest';

import { kovoVitePlugin } from './vite-config.js';
import type { KovoViteMiddleware } from './vite.js';

describe('config-safe kovoVitePlugin', () => {
  it('loads the compiler lazily when transforming', async () => {
    const middlewares: KovoViteMiddleware[] = [];
    const plugin = kovoVitePlugin({ include: ['src/components'] });

    plugin.configureServer?.({
      config: { root: '/workspace/app' },
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });

    const transformed = await plugin.transform(
      `
import { component } from '@kovojs/core';

export const CartBadge = component({
  render: () => <button>Cart</button>,
});
`,
      '/workspace/app/src/components/cart-badge.tsx',
    );

    expect(transformed).toMatchObject({
      code: expect.stringContaining('export const CartBadge = component({'),
      map: null,
    });
    expect(middlewares).toHaveLength(1);
  });
});
