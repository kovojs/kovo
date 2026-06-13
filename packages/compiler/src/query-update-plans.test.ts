import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

describe('compiler query update plans', () => {
  it('emits per-query data-bind update plans for compiled components', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">2</span>
      <button data-bind:hidden="cart.empty">Checkout</button>
      <span data-bind="cart.total">2998</span>
      <span data-bind="product.name">Coffee</span>
      <span data-bind="cart.count">2</span>
      <ul data-bind-list="cart.items" fw-key="productId">
        <template fw-stamp>
          <li fw-key="">
            <span data-bind=".qty">0</span> × <span data-bind=".name">Item</span>
          </li>
        </template>
      </ul>
    </cart-badge>
  ),
});
`,
    });
    const clientSource = result.files[1]?.source ?? '';
    const registrySource = result.files[2]?.source ?? '';

    expect(result.queryUpdatePlans).toEqual([
      {
        componentName: 'CartBadge',
        paths: ['cart.count', 'cart.empty', 'cart.items', 'cart.total'],
        query: 'cart',
        templateStamps: [
          {
            itemBindingPlaceholders: [
              {
                path: '.name',
                readPath: 'name',
                readSegments: [{ name: 'name', optional: false }],
                templateEnd: 89,
                templateStart: 85,
                value: 'Item',
              },
              {
                path: '.qty',
                readPath: 'qty',
                readSegments: [{ name: 'qty', optional: false }],
                templateEnd: 51,
                templateStart: 50,
                value: '0',
              },
            ],
            itemBindings: ['.name', '.qty'],
            key: 'productId',
            list: 'cart.items',
            listReadPath: 'items',
            listReadSegments: [{ name: 'items', optional: false }],
            selector: '[data-bind-list="cart.items"]',
            template:
              '<li fw-key="">\n            <span data-bind=".qty">0</span> × <span data-bind=".name">Item</span>\n          </li>',
          },
        ],
      },
      {
        componentName: 'CartBadge',
        paths: ['product.name'],
        query: 'product',
      },
    ]);
    expect(clientSource).toContain("import { applyCompiledQueryUpdatePlan } from '@jiso/runtime';");
    expect(clientSource).toContain('export const CartBadge$queryUpdatePlans = {');
    expect(clientSource).toContain(
      'return applyCompiledQueryUpdatePlan(root, "cart", value, { bindings: true, derives: [], stamps: [], templateStamps: [{ key: "productId", list: "items", selector: "[data-bind-list=\\"cart.items\\"]", render(item) {',
    );
    expect(clientSource).toContain('return ["<li fw-key=\\"\\">');
    expect(clientSource).toContain('String(read(["qty"]) ?? "")');
    expect(clientSource).toContain('String(read(["name"]) ?? "")');
    expect(clientSource).not.toContain('html.replace');
    expect(clientSource).toContain(
      'return applyCompiledQueryUpdatePlan(root, "product", value, { bindings: true, derives: [], stamps: [], templateStamps: [] });',
    );
    expect(registrySource).toContain(`export interface QueryUpdatePlans {
  'CartBadge:cart': readonly ['cart.count', 'cart.empty', 'cart.items', 'cart.total'];
  'CartBadge:product': readonly ['product.name'];
}`);
    expect(result.updateCoverage).toEqual([
      {
        componentName: 'CartBadge',
        detail: 'data-bind',
        position: 'binding',
        query: 'cart.count',
        status: 'plan',
      },
      {
        componentName: 'CartBadge',
        detail: 'data-bind:hidden',
        position: 'attribute',
        query: 'cart.empty',
        status: 'plan',
      },
      {
        componentName: 'CartBadge',
        detail: 'data-bind',
        position: 'binding',
        query: 'cart.total',
        status: 'plan',
      },
      {
        componentName: 'CartBadge',
        detail: 'data-bind',
        position: 'binding',
        query: 'product.name',
        status: 'plan',
      },
      {
        componentName: 'CartBadge',
        detail: 'data-bind-list',
        position: 'template',
        query: 'cart.items',
        status: 'plan',
      },
    ]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('emits named derives into compiled query update plans', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge$isEmpty = derive(['cart'], (cart) => cart.count === 0);

export const CartBadge = component('cart-badge', {
  render: () => (
    <cart-badge>
      <button data-derive="cart.CartBadge$isEmpty">Checkout</button>
    </cart-badge>
  ),
});
`,
    });
    const clientSource = result.files[1]?.source ?? '';

    expect(result.queryUpdatePlans).toEqual([
      {
        componentName: 'CartBadge',
        derives: [
          {
            exportName: 'CartBadge$isEmpty',
            expression: 'cart.count === 0',
            input: 'cart',
            name: 'CartBadge$isEmpty',
            param: 'cart',
            selector: '[data-derive="cart.CartBadge$isEmpty"]',
          },
        ],
        paths: [],
        query: 'cart',
      },
    ]);
    expect(clientSource).toContain(
      "import { applyCompiledQueryUpdatePlan, derive } from '@jiso/runtime';",
    );
    expect(clientSource).toContain(
      'export const CartBadge$isEmpty = derive(["cart"], (cart) => cart.count === 0);',
    );
    expect(clientSource).toContain(
      'derives: [{ name: "CartBadge$isEmpty", selector: "[data-derive=\\"cart.CartBadge$isEmpty\\"]", select(value) { return CartBadge$isEmpty.run(value); } }]',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('keeps named derives whose expressions contain semicolons in strings', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge$label = derive(
  ['cart'],
  (cart) => cart.count === 0 ? 'empty; cart' : \`items: \${cart.count}\`,
);

export const CartBadge = component('cart-badge', {
  render: () => (
    <cart-badge>
      <output data-derive="cart.CartBadge$label">empty</output>
    </cart-badge>
  ),
});
`,
    });

    expect(result.queryUpdatePlans).toEqual([
      {
        componentName: 'CartBadge',
        derives: [
          {
            exportName: 'CartBadge$label',
            expression: "cart.count === 0 ? 'empty; cart' : `items: ${cart.count}`",
            input: 'cart',
            name: 'CartBadge$label',
            param: 'cart',
            selector: '[data-derive="cart.CartBadge$label"]',
          },
        ],
        paths: [],
        query: 'cart',
      },
    ]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });
});
