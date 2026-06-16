import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

describe('component effective name validation', () => {
  it('reports KV237 for duplicate derived registry names', () => {
    const result = compileComponentModule({
      fileName: 'components/cart.tsx',
      source: `
export const CartBadge = component({
  render: () => <cart-badge></cart-badge>,
});

export const Cart_Badge = component({
  render: () => <mini-cart-badge></mini-cart-badge>,
});
`,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV237',
        fileName: 'components/cart.tsx',
        help: expect.stringContaining('SPEC §6.1.1'),
        message:
          'Duplicate component effective wire name. components/cart/cart-badge is used by CartBadge and Cart_Badge.',
        severity: 'error',
        start: { column: 14, line: 6 },
      }),
    );
  });

  it('reports KV237 when inferred local names collide after kebab casing', () => {
    const result = compileComponentModule({
      fileName: 'components/cart.tsx',
      source: `
export const CartBadge = component({
  render: () => <cart-badge></cart-badge>,
});

export const Cart_Badge = component({
  render: () => <cart-badge></cart-badge>,
});
`,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV237',
        message:
          'Duplicate component effective wire name. components/cart/cart-badge is used by CartBadge and Cart_Badge.',
        severity: 'error',
      }),
    );
  });

  it('accepts distinct effective component names', () => {
    const result = compileComponentModule({
      fileName: 'components/cart.tsx',
      source: `
export const CartBadge = component({
  render: () => <cart-badge></cart-badge>,
});

export const MiniCartBadge = component({
  render: () => <mini-cart-badge></mini-cart-badge>,
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV237')).toEqual([]);
  });

  it('reports KV237 when registry facts already contain the effective name', () => {
    const result = compileComponentModule({
      fileName: 'components/cart.tsx',
      registryFacts: { components: ['components/cart/cart-badge'] },
      source: `
export const CartBadge = component({
  render: () => <cart-badge></cart-badge>,
});
`,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV237',
        message:
          'Duplicate component effective wire name. components/cart/cart-badge is already present in registry facts and is reused by CartBadge.',
      }),
    );
  });
});
