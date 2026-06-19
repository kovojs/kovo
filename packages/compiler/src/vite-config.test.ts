import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { kovoVitePlugin } from './vite-config.js';
import type { KovoViteMiddleware } from './vite.js';

describe('config-safe kovoVitePlugin', () => {
  it('loads the compiler lazily when transforming', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-vite-config-'));
    const middlewares: KovoViteMiddleware[] = [];
    const plugin = kovoVitePlugin({ include: ['src/components'] });

    try {
      plugin.configureServer?.({
        config: { root },
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
        join(root, 'src/components/cart-badge.tsx'),
      );

      expect(transformed).toMatchObject({
        code: expect.stringContaining('export const CartBadge = component({'),
        map: null,
      });
      expect(middlewares).toHaveLength(1);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
