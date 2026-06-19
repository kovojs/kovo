import { describe, expect, it, vi } from 'vitest';

import { kovoVitePlugin } from './vite-config.js';
import type { KovoViteMiddleware } from './vite.js';

describe('config-safe kovoVitePlugin', () => {
  it('loads the compiler through Vite ssrLoadModule when transforming', async () => {
    const compileComponentModule = vi.fn(() => ({
      files: [
        { kind: 'server', source: 'export function renderSource() {}' },
        { kind: 'client', source: 'export const CartBadge$button_click = () => null;' },
      ],
    }));
    const ssrLoadModule = vi.fn(async () => ({ compileComponentModule }));
    const middlewares: KovoViteMiddleware[] = [];
    const plugin = kovoVitePlugin({ include: ['src/components'] });

    plugin.configureServer?.({
      config: { root: '/workspace/app' },
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
      ssrLoadModule,
    });

    const transformed = await plugin.transform(
      'import { component } from "@kovojs/core"; export const CartBadge = component({});',
      '/workspace/app/src/components/cart-badge.tsx',
    );

    expect(transformed).toEqual({
      code: 'export function renderSource() {}',
      map: null,
    });
    expect(ssrLoadModule).toHaveBeenCalledWith(
      expect.stringContaining('/packages/compiler/src/compile.ts'),
    );
    expect(compileComponentModule).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'src/components/cart-badge.tsx' }),
    );
    expect(middlewares).toHaveLength(1);
  });
});
