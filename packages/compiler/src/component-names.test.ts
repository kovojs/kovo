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

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV237')).toMatchInlineSnapshot(`
      [
        {
          "code": "KV237",
          "fileName": "components/cart.tsx",
          "help": "Would lower to: one derived component registry key per component across the app graph.
      Blocked reason: duplicate derived registry keys make component identity, CSS scoping, fragment routing, and graph facts ambiguous.
      Fixes: rename the exported component binding, or move one component so its derived module path namespace differs.
      SPEC §4.2 and §4.8 make derived component names load-bearing for identity, scoped CSS, fragments, and graph facts; duplicate registry keys are ambiguous.
      Effective name: components/cart/cart-badge
      First definition: CartBadge
      Duplicate definition: Cart_Badge
      SPEC §6.1.1 package prefixes remain the cross-package namespace mechanism; app-authored/vendored components in one module must not share an effective wire name.",
          "length": 10,
          "message": "Duplicate component effective wire name. components/cart/cart-badge is used by CartBadge and Cart_Badge.",
          "severity": "error",
          "start": {
            "column": 14,
            "line": 6,
          },
        },
      ]
    `);
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

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV237')).toMatchInlineSnapshot(`
      [
        {
          "code": "KV237",
          "fileName": "components/cart.tsx",
          "help": "Would lower to: one derived component registry key per component across the app graph.
      Blocked reason: duplicate derived registry keys make component identity, CSS scoping, fragment routing, and graph facts ambiguous.
      Fixes: rename the exported component binding, or move one component so its derived module path namespace differs.
      SPEC §4.2 and §4.8 make derived component names load-bearing for identity, scoped CSS, fragments, and graph facts; duplicate registry keys are ambiguous.
      Effective name: components/cart/cart-badge
      First definition: CartBadge
      Duplicate definition: Cart_Badge
      SPEC §6.1.1 package prefixes remain the cross-package namespace mechanism; app-authored/vendored components in one module must not share an effective wire name.",
          "length": 10,
          "message": "Duplicate component effective wire name. components/cart/cart-badge is used by CartBadge and Cart_Badge.",
          "severity": "error",
          "start": {
            "column": 14,
            "line": 6,
          },
        },
      ]
    `);
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

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV237')).toMatchInlineSnapshot(`
      [
        {
          "code": "KV237",
          "fileName": "components/cart.tsx",
          "help": "Would lower to: one derived component registry key per component across the app graph.
      Blocked reason: duplicate derived registry keys make component identity, CSS scoping, fragment routing, and graph facts ambiguous.
      Fixes: rename the exported component binding, or move one component so its derived module path namespace differs.
      SPEC §4.2 and §4.8 make derived component names load-bearing for identity, scoped CSS, fragments, and graph facts; duplicate registry keys are ambiguous.
      Effective name: components/cart/cart-badge
      Registry definition: components/cart/cart-badge
      Duplicate definition: CartBadge
      SPEC §6.1.1 keeps effective names app-wide unique; registryFacts.components carries names already known to the app graph.",
          "length": 9,
          "message": "Duplicate component effective wire name. components/cart/cart-badge is already present in registry facts and is reused by CartBadge.",
          "severity": "error",
          "start": {
            "column": 14,
            "line": 2,
          },
        },
      ]
    `);
  });

  it('reports KV241 when previous registry facts contain the same DOM leaf under a different key', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/badge.tsx',
      previousRegistryFacts: { components: ['components/old-cart/cart-badge'] },
      source: `
export const CartBadge = component({
  render: () => <cart-badge></cart-badge>,
});
`,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV241',
        help: expect.stringContaining('previousRegistryFacts.components'),
        message:
          'Derived component registry key changed since the previous emitted graph. components/old-cart/cart-badge -> components/cart/badge/cart-badge.',
        severity: 'warn',
      }),
    );
  });

  it('does not report KV241 when the previous registry facts already contain the current key', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/badge.tsx',
      previousRegistryFacts: { components: ['components/cart/badge/cart-badge'] },
      source: `
export const CartBadge = component({
  render: () => <cart-badge></cart-badge>,
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV241')).toEqual([]);
  });
});
