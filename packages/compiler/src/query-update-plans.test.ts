import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';
import { rewriteClientModuleRuntimeImportsForBrowser } from './emit/client.js';

describe('compiler query update plans', () => {
  it('emits per-query data-bind update plans for compiled components', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">2</span>
      <button data-bind:hidden="cart.empty">Checkout</button>
      <span data-bind="cart.total">2998</span>
      <span data-bind="product.name">Coffee</span>
      <span data-bind="cart.count">2</span>
      <ul data-bind-list="cart.items" kovo-key="productId">
        <template kovo-stamp>
          <li kovo-key="">
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

    expect(result.queryUpdatePlans).toMatchInlineSnapshot(`
      [
        {
          "componentName": "CartBadge",
          "outputContexts": [
            {
              "context": "text",
              "expression": "cart.count",
              "sink": "textContent",
              "source": "client-query",
              "writer": "query text binding",
            },
            {
              "context": "boolean-attribute",
              "expression": "cart.empty",
              "sink": "hidden",
              "source": "client-query",
              "writer": "query attribute binding",
            },
            {
              "context": "text",
              "expression": "cart.total",
              "sink": "textContent",
              "source": "client-query",
              "writer": "query text binding",
            },
            {
              "context": "html-fragment",
              "expression": "cart.items",
              "sink": "template.innerHTML",
              "source": "template-stamp",
              "writer": "template stamp assembly",
            },
            {
              "context": "html-fragment",
              "expression": ".name",
              "sink": "template item placeholder",
              "source": "template-stamp",
              "writer": "template stamp interpolation",
            },
            {
              "context": "html-fragment",
              "expression": ".qty",
              "sink": "template item placeholder",
              "source": "template-stamp",
              "writer": "template stamp interpolation",
            },
          ],
          "paths": [
            "cart.count",
            "cart.empty",
            "cart.items",
            "cart.total",
          ],
          "query": "cart",
          "templateStamps": [
            {
              "itemBindingPlaceholders": [
                {
                  "path": ".name",
                  "readPath": "name",
                  "readSegments": [
                    {
                      "name": "name",
                      "optional": false,
                    },
                  ],
                  "templateEnd": 91,
                  "templateStart": 87,
                  "value": "Item",
                },
                {
                  "path": ".qty",
                  "readPath": "qty",
                  "readSegments": [
                    {
                      "name": "qty",
                      "optional": false,
                    },
                  ],
                  "templateEnd": 53,
                  "templateStart": 52,
                  "value": "0",
                },
              ],
              "key": "productId",
              "list": "cart.items",
              "listReadPath": "items",
              "listReadSegments": [
                {
                  "name": "items",
                  "optional": false,
                },
              ],
              "selector": "[data-bind-list="cart.items"]",
              "template": "<li kovo-key="">
                  <span data-bind=".qty">0</span> × <span data-bind=".name">Item</span>
                </li>",
            },
          ],
        },
        {
          "componentName": "CartBadge",
          "outputContexts": [
            {
              "context": "text",
              "expression": "product.name",
              "sink": "textContent",
              "source": "client-query",
              "writer": "query text binding",
            },
          ],
          "paths": [
            "product.name",
          ],
          "query": "product",
        },
      ]
    `);
    expect(clientSource).toContain(
      "import { kovoEscapeHtml, runQueryUpdatePlan } from '@kovojs/browser/generated';",
    );
    expect(clientSource).toContain('export const CartBadge$queryUpdatePlans = {');
    expect(clientSource).toContain(
      'return runQueryUpdatePlan(root, "cart", value, { bindings: true, derives: [], stamps: [], templateStamps: [{ key: "productId", list: "items", selector: "[data-bind-list=\\"cart.items\\"]", render(item) {',
    );
    expect(clientSource).toContain('return ["<li kovo-key=\\"\\">');
    expect(clientSource).toContain('kovoEscapeHtml(read(["qty"]))');
    expect(clientSource).toContain('kovoEscapeHtml(read(["name"]))');
    expect(clientSource).not.toContain('html.replace');
    expect(clientSource).toContain(
      'return runQueryUpdatePlan(root, "product", value, { bindings: true, derives: [], stamps: [], templateStamps: [] }, { queryStore: context.queryStore });',
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

export const CartBadge = component({
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
      "import { derive, runQueryUpdatePlan } from '@kovojs/browser/generated';",
    );
    expect(clientSource).toContain(
      'export const CartBadge$isEmpty = derive(["cart"], (cart) => cart.count === 0);',
    );
    expect(clientSource).toContain(
      'derives: [{ name: "CartBadge$isEmpty", selector: "[data-derive=\\"cart.CartBadge$isEmpty\\"]", select(value, root, context) { return CartBadge$isEmpty.run(value); } }]',
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

export const CartBadge = component({
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

  it('executes emitted query update plans after browser runtime import rewriting', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">0</span>
      <button data-bind:hidden="cart.empty" hidden="">Checkout</button>
    </cart-badge>
  ),
});
`,
    });
    const source = rewriteClientModuleRuntimeImportsForBrowser(result.files[1]?.source ?? '');
    expect(source).toContain('const runQueryUpdatePlan =');
    expect(source).not.toContain('@kovojs/browser/generated');

    const exports = executeBrowserClientModule(source);
    const plans = exports.CartBadge$queryUpdatePlans as {
      cart(root: InlinePlanRoot, value: unknown): unknown;
    };
    const count = new InlinePlanElement({ 'data-bind': 'cart.count' }, '0');
    const button = new InlinePlanElement({
      'data-bind:hidden': 'cart.empty',
      hidden: '',
    });
    const checkbox = new InlinePlanElement(
      {
        'data-bind-prop:checked': 'cart.done',
        'data-bind:checked': 'cart.done',
        type: 'checkbox',
      },
      null,
      { checked: false },
    );
    const viewport = new InlinePlanElement({ 'data-bind-prop:scrolltop': 'cart.scrollTop' }, null, {
      scrollTop: 0,
    });
    const root = new InlinePlanRoot([count, button, checkbox, viewport]);

    const applied = plans.cart(root, { count: 7, done: '', empty: false, scrollTop: 48 });

    expect(applied).toEqual({
      bindings: ['cart.count', 'cart.empty', 'cart.done', 'cart.done', 'cart.scrollTop'],
      derives: [],
      stamps: [],
      templateStamps: [],
    });
    expect(count.textContent).toBe('7');
    expect(button.getAttribute('hidden')).toBeNull();
    expect(checkbox.getAttribute('checked')).toBe('');
    expect(checkbox.checked).toBe(true);
    expect(viewport.scrollTop).toBe(48);
  });
});

function executeBrowserClientModule(source: string): Record<string, unknown> {
  const exports: Record<string, unknown> = {};
  const moduleSource = source.replace(/export const ([A-Za-z_$][\w$]*)/g, 'const $1 = exports.$1');

  runInNewContext(moduleSource, { exports }, { timeout: 1000 });
  return exports;
}

class InlinePlanRoot {
  constructor(readonly elements: InlinePlanElement[]) {}

  querySelectorAll(selector: string): InlinePlanElement[] {
    if (selector === '[data-bind]') {
      return this.elements.filter((element) => element.getAttribute('data-bind') !== null);
    }
    if (selector === '*') return this.elements;
    return [];
  }
}

class InlinePlanElement {
  attributes: Array<{ name: string; value: string }>;
  checked?: boolean;
  scrollTop?: number;
  textContent: string | null;

  constructor(
    attributes: Record<string, string>,
    textContent: string | null = null,
    properties: { checked?: boolean; scrollTop?: number } = {},
  ) {
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
    this.checked = properties.checked;
    this.scrollTop = properties.scrollTop;
    this.textContent = textContent;
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }

  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      existing.value = value;
      return;
    }
    this.attributes.push({ name, value });
  }
}
