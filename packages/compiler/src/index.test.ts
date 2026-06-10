import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule, jisoVitePlugin } from './index.js';

const cartBadgeSource = `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  fragmentTarget: true,
  render: () => (
    <button onClick={() => removeItem(state, item.id)}>
      <span data-bind="cart.count">2</span>
    </button>
  ),
});
`;

describe('compileComponentModule', () => {
  it('emits one server file, one client file, and registry metadata', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: cartBadgeSource,
    });

    expect(result.files.map((file) => file.fileName)).toEqual([
      'components/cart/cart-badge.server.js',
      'components/cart/cart-badge.client.js',
      'generated/registries.d.ts',
    ]);
    expect(result.files[1]?.source).toContain('export const CartBadge$button_click');
    expect(result.files[0]?.source).toContain(
      'on:click="./cart-badge.client.js#CartBadge$button_click"',
    );
    expect(result.files[0]?.source).toContain('data-p-id="{item.id}"');
    expect(result.files[2]?.source).toContain(
      "'#cart-badge': typeof import('../components/cart/cart-badge.client.js');",
    );
    expect(result.files[2]?.source).toContain("'cart-badge': unknown;");
  });

  it('reports FW210 for anonymous handlers', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: cartBadgeSource,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'FW210',
        severity: 'lint',
      },
    ]);
  });

  it('reports FW201 when a handler captures non-serializable browser objects', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: '<button onClick={() => window.alert("x")}>x</button>',
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'FW201',
        severity: 'error',
      },
    ]);
  });

  it('preserves emitted IR on recompilation', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: cartBadgeSource,
    });

    expect(() => assertFixpoint(result)).not.toThrow();
  });
});

describe('jisoVitePlugin', () => {
  it('exposes a Vite transform hook for component modules', () => {
    const plugin = jisoVitePlugin();

    expect(plugin.name).toBe('jiso');
    expect(plugin.transform?.(cartBadgeSource, 'cart-badge.tsx')).toMatchObject({
      code: expect.stringContaining('export function renderSource()'),
      map: null,
    });
  });
});
