import { describe, expect, it } from 'vitest';

import {
  assertFixpoint,
  collectCssAssetManifest,
  collectMinifierReservedNames,
  compileComponentModule,
  dedupeCss,
  jisoVitePlugin,
  scopeComponentCss,
  selectCssAssets,
} from './index.js';

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
      'on:click="/c/components/cart/cart-badge.client.js#CartBadge$button_click"',
    );
    expect(result.files[0]?.source).toContain('data-p-id="{item.id}"');
    expect(result.files[2]?.source).toContain(
      "'#cart-badge': typeof import('../components/cart/cart-badge.client.js');",
    );
    expect(result.files[2]?.source).toContain("'cart-badge': unknown;");
  });

  it('emits provided query, mutation, and domain key registry facts', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      registryFacts: {
        domainKeys: ['product', 'cart', 'cart'],
        mutations: {
          'cart/add': 'typeof addToCart',
          'cart/remove': 'typeof removeFromCart',
        },
        queries: {
          cart: 'typeof cartQuery',
          productGrid: 'typeof productGridQuery',
        },
      },
      source: cartBadgeSource,
    });

    const registry = result.files[2]?.source ?? '';
    expect(registry).toContain(
      "'#cart-badge': typeof import('../components/cart/cart-badge.client.js');",
    );
    expect(registry).toContain("'cart-badge': unknown;");
    expect(registry).toContain(`export interface QueryRegistry {
  'cart': typeof cartQuery;
  'productGrid': typeof productGridQuery;
}`);
    expect(registry).toContain(`export interface MutationRegistry {
  'cart/add': typeof addToCart;
  'cart/remove': typeof removeFromCart;
}`);
    expect(registry).toContain(`declare module '@jiso/core' {
  interface QueryRegistry {
  'cart': typeof cartQuery;
  'productGrid': typeof productGridQuery;
  }

  interface MutationRegistry {
  'cart/add': typeof addToCart;
  'cart/remove': typeof removeFromCart;
  }
}`);
    expect(registry).toContain('export type DomainKey = "cart" | "product";');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('emits scoped CSS artifacts for static co-located component CSS', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  fragmentTarget: true,
  css: \`
    button { color: teal; }
    .count { font-weight: 700; }
  \`,
  render: () => <cart-badge><button><span class="count">1</span></button></cart-badge>,
});
`,
    });

    expect(result.files.map((file) => file.fileName)).toEqual([
      'components/cart/cart-badge.server.js',
      'components/cart/cart-badge.client.js',
      'components/cart/cart-badge.css',
      'generated/registries.d.ts',
    ]);
    expect(result.files.find((file) => file.fileName.endsWith('.css'))?.source).toBe(
      [
        '/* @jiso-ir */',
        '@scope (cart-badge) to (:scope [fw-c]) {',
        '  button { color: teal; }',
        '      .count { font-weight: 700; }',
        '}',
        '',
      ].join('\n'),
    );
    expect(result.cssAssets).toEqual([
      {
        componentName: 'CartBadge',
        fragmentTargets: ['cart-badge'],
        href: '/assets/components/cart/cart-badge.css',
        sourceFileName: 'components/cart/cart-badge.css',
      },
    ]);
    expect(result.files[0]?.source).toContain('export function renderSource()');
    expect(result.files[1]?.source).toContain('// no client handlers emitted');
    expect(result.files[3]?.source).toContain("'cart-badge': unknown;");
    expect(result.files[3]?.source).toContain(
      "'CartBadge': { href: '/assets/components/cart/cart-badge.css'; sourceFileName: 'components/cart/cart-badge.css'; fragmentTargets: readonly ['cart-badge']; };",
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('scopes native-host component CSS to the fw-c identity stamp', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-row.tsx',
      source: `
import { component } from '@jiso/core';

export const CartRow = component('cart-row', {
  styles: \`
    td { padding: 0.5rem; }
  \`,
  render: () => <tr fw-c="cart-row"><td>p1</td></tr>,
});
`,
    });

    expect(result.files.find((file) => file.fileName.endsWith('.css'))?.source).toContain(
      '@scope ([fw-c="cart-row"]) to (:scope [fw-c])',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('emits empty registry fact surfaces when no facts are provided', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: cartBadgeSource,
    });

    const registry = result.files[2]?.source ?? '';
    expect(registry).toMatch(/export interface QueryRegistry \{\n\n\}/);
    expect(registry).toMatch(/export interface MutationRegistry \{\n\n\}/);
    expect(registry).toContain(`declare module '@jiso/core' {
  interface QueryRegistry {

  }

  interface MutationRegistry {

  }
}`);
    expect(registry).toContain('export type DomainKey = never;');
  });

  it('collects emitted handler export names for minifier preservation', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  render: () => (
    <div>
      <button onClick={removeItem}>Remove</button>
      <button onClick={() => clearCart(state.cartId)}>Clear</button>
    </div>
  ),
});
`,
    });

    expect(collectMinifierReservedNames(result)).toEqual([
      'CartBadge$button_click',
      'CartBadge$removeItem',
    ]);
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
    expect(result.diagnostics[0]?.help).toContain(
      'Would lower to: on:click="/c/cart-badge.client.js#CartBadge$button_click"',
    );
    expect(result.diagnostics[0]?.help).toContain('Blocked expression: () => window.alert("x")');
    expect(result.diagnostics[0]?.help).toContain(
      'Fixes: move the value into component/query state via ctx; pass serializable element params with data-p-*; or keep shared constants in module scope.',
    );
  });

  it('preserves emitted IR on recompilation', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: cartBadgeSource,
    });

    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('lowers provable dialog behavior to platform attributes instead of client handlers', () => {
    const result = compileComponentModule({
      fileName: 'cart-button.tsx',
      source: `
export const CartButton = component('cart-button', {
  render: () => (
    <button onClick={() => document.getElementById('cart-drawer')!.showModal()}>
      Open cart
    </button>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.platformSubstitutions).toEqual([
      {
        action: 'show-modal',
        event: 'click',
        kind: 'dialog',
        tag: 'button',
        target: 'cart-drawer',
      },
    ]);
    expect(result.files[0]?.source).toContain('commandfor="cart-drawer" command="show-modal"');
    expect(result.files[1]?.source).toContain('// no client handlers emitted');
    expect(result.files[2]?.source).toContain(
      "'CartButton:button:click:cart-drawer': 'dialog:show-modal';",
    );
  });

  it('lowers requestClose dialog behavior to a valid invoker command', () => {
    const result = compileComponentModule({
      fileName: 'cart-close-button.tsx',
      source: `
export const CartCloseButton = component('cart-close-button', {
  render: () => (
    <button onClick={() => document.getElementById('cart-drawer')!.requestClose()}>
      Close cart
    </button>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.platformSubstitutions).toEqual([
      {
        action: 'request-close',
        event: 'click',
        kind: 'dialog',
        tag: 'button',
        target: 'cart-drawer',
      },
    ]);
    expect(result.files[0]?.source).toContain('commandfor="cart-drawer" command="request-close"');
    expect(result.files[1]?.source).toContain('// no client handlers emitted');
    expect(result.files[2]?.source).toContain(
      "'CartCloseButton:button:click:cart-drawer': 'dialog:request-close';",
    );
  });

  it('lowers provable popover behavior to popover target attributes', () => {
    const result = compileComponentModule({
      fileName: 'filter-button.tsx',
      source: `
export const FilterButton = component('filter-button', {
  render: () => <button onClick={() => document.getElementById('filters')!.togglePopover()}>Filters</button>,
});
`,
    });

    expect(result.platformSubstitutions).toEqual([
      {
        action: 'toggle',
        event: 'click',
        kind: 'popover',
        tag: 'button',
        target: 'filters',
      },
    ]);
    expect(result.files[0]?.source).toContain(
      'popovertarget="filters" popovertargetaction="toggle"',
    );
    expect(result.files[1]?.source).toContain('// no client handlers emitted');
  });

  it('lowers provable details summary toggles by dropping redundant JavaScript', () => {
    const result = compileComponentModule({
      fileName: 'shipping-details.tsx',
      source: `
export const ShippingDetails = component('shipping-details', {
  render: () => (
    <details id="shipping">
      <summary onClick={() => document.getElementById('shipping')!.open = !document.getElementById('shipping')!.open}>
        Shipping
      </summary>
      <p>Usually ships tomorrow.</p>
    </details>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.platformSubstitutions).toEqual([
      {
        action: 'toggle',
        event: 'click',
        kind: 'details',
        tag: 'summary',
        target: 'shipping',
      },
    ]);
    expect(result.files[0]?.source).toContain('<summary>');
    expect(result.files[0]?.source).not.toContain('on:click=');
    expect(result.files[1]?.source).toContain('// no client handlers emitted');
    expect(result.files[2]?.source).toContain(
      "'ShippingDetails:summary:click:shipping': 'details:toggle';",
    );
  });

  it('keeps unsupported details JavaScript as a handler instead of inventing platform attributes', () => {
    const result = compileComponentModule({
      fileName: 'accordion-toggle.tsx',
      source: `
export const AccordionToggle = component('accordion-toggle', {
  render: () => (
    <button onClick={() => document.getElementById('shipping')!.open = true}>
      Shipping
    </button>
  ),
});
`,
    });

    // SPEC §5.2.4 names <details> as an L0 target, but this JS assignment has no
    // dialog-style commandfor equivalent in the current compiler model.
    expect(result.platformSubstitutions).toEqual([]);
    expect(result.files[0]?.source).toContain(
      'on:click="/c/accordion-toggle.client.js#AccordionToggle$button_click"',
    );
    expect(result.files[1]?.source).toContain('export const AccordionToggle$button_click');
  });

  it('stamps cross-document view transition names as real CSS', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      source: `
export const ProductCard = component('product-card', {
  render: () => <img viewTransitionName="product-p1-image" src="/p1.png" />,
});
`,
    });

    expect(result.viewTransitions).toEqual([{ name: 'product-p1-image' }]);
    expect(result.files[0]?.source).toContain(
      '<img style="view-transition-name: product-p1-image" src="/p1.png" />',
    );
    expect(result.files[2]?.source).toContain("'product-p1-image': unknown;");
  });

  it('accepts data-bind paths present in declared query shapes', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: {
        cart: {
          count: 'number',
          items: [{ productId: 'string', qty: 'number' }],
        },
      },
      source: `
export const CartBadge = component('cart-badge', {
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">2</span>
      <span data-bind="cart.items.productId">p1</span>
    </cart-badge>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('stamps rendered component markup with declared query dependencies', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery, productPage: productPageQuery },
  render: ({ cart, productPage }) => (
    <cart-badge>
      <span data-bind="cart.count">{cart.count}</span>
      <span>{productPage.title}</span>
    </cart-badge>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain('<cart-badge fw-deps="cart productPage">');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('merges declared query dependencies into existing fw-deps stamps', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      source: `
export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section fw-c="recommendations" fw-deps="product:p1 cart">
      {cart.count}
    </section>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain(
      '<section fw-c="recommendations" fw-deps="product:p1 cart">',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('stamps static island-local state onto rendered component markup', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  state: () => ({ bouncing: false, count: 2 }),
  render: (_data, state) => (
    <cart-badge class={state.bouncing ? 'bounce' : ''}>
      {state.count}
    </cart-badge>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain(
      'fw-state="{&quot;bouncing&quot;:false,&quot;count&quot;:2}"',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('reports FW301 when island-local state stores an obvious query fact', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  state: () => ({ cartCount: 0 }),
  render: ({ cart }, state) => <span>{state.cartCount}</span>,
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW301',
        fileName: 'cart-badge.tsx',
        message: 'Server fact stored in island-local state.',
        severity: 'lint',
      },
    ]);
  });

  it('reports FW301 for any state key prefixed by a declared query name', () => {
    const result = compileComponentModule({
      fileName: 'account-menu.tsx',
      source: `
export const AccountMenu = component('account-menu', {
  queries: { account: accountQuery },
  state: () => ({ accountNameDraft: '' }),
  render: ({ account }, state) => <span>{state.accountNameDraft}</span>,
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'FW301',
        fileName: 'account-menu.tsx',
        message: 'Server fact stored in island-local state.',
        severity: 'lint',
      },
    ]);
  });

  it('does not report FW301 for local UI-only state with declared queries', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  state: () => ({ bouncing: false }),
  render: ({ cart }, state) => <span class={state.bouncing ? 'bounce' : ''}>{cart.count}</span>,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports FW302 when data-bind paths are absent from declared query shapes', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: {
        cart: {
          count: 'number',
        },
      },
      source: `
export const CartBadge = component('cart-badge', {
  render: () => <span data-bind="cart.total">2</span>,
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW302',
        fileName: 'cart-badge.tsx',
        message: 'data-bind path is not present in the declared query shape: cart.total',
        severity: 'error',
      },
    ]);
  });

  it('reports FW320 when event payload fields overlap query data', () => {
    const result = compileComponentModule({
      fileName: 'cart.events.tsx',
      queryShapes: {
        productCard: {
          product: {
            id: 'string',
            unitPrice: 'number',
          },
        },
      },
      source: `
export function notifyPrice(product, emit) {
  emit('cart:added', { product: { unitPrice: product.unitPrice } });
}
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW320',
        fileName: 'cart.events.tsx',
        message: 'Event payload overlaps query data; use a transform. product.unitPrice',
        severity: 'lint',
      },
    ]);
  });

  it('does not report FW320 for event payloads that carry client intent only', () => {
    const result = compileComponentModule({
      fileName: 'cart.events.tsx',
      queryShapes: {
        productCard: {
          product: {
            id: 'string',
            unitPrice: 'number',
          },
        },
      },
      source: `
export function notifyIntent(productId, quantity, emit) {
  emit('cart:add-requested', { productId, quantity });
}
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('accepts fragment target render inputs declared as queries or stamped props', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String },
  queries: { cart: cartQuery },
  render: ({ cart, rowId }) => <tr fw-c="cart-row" data-row={rowId}>{cart.count}</tr>,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.files[2]?.source).toContain("'cart-row': unknown;");
  });

  it('reports FW303 when fragment target render inputs cannot be rerendered from queries or stamped props', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component('cart-row', {
  fragmentTarget: true,
  queries: { cart: cartQuery },
  render: ({ cart, priceList }) => <tr fw-c="cart-row">{cart.count}{priceList.version}</tr>,
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW303',
        fileName: 'cart-row.tsx',
        message:
          'Fragment target render input is not declared as query data or stamped props. priceList',
        severity: 'error',
      },
    ]);
  });

  it('reports FW330 when mutation handlers access request db directly', () => {
    const result = compileComponentModule({
      fileName: 'cart.mutation.ts',
      source: `
export const addToCart = mutation('cart/add', {
  input: addToCartInput,
  handler(input, request) {
    request.db.insert(cartItems).values(input);
    return input.productId;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW330',
        fileName: 'cart.mutation.ts',
        message: 'Direct db access in a mutation handler; route through domain.',
        severity: 'lint',
      },
    ]);
  });

  it('does not report FW330 for domain-routed mutation handlers', () => {
    const result = compileComponentModule({
      fileName: 'cart.mutation.ts',
      source: `
export const addToCart = mutation('cart/add', {
  input: addToCartInput,
  handler(input, request, context) {
    return cartDomain.addItem(input, request.session.user.id, context);
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
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

describe('component CSS helpers', () => {
  it('wraps component CSS in @scope and emits a prefixed fallback', () => {
    const result = scopeComponentCss(
      '[fw-c="cart-badge"]',
      '.count { color: red; }\nbutton, a { color: blue; }',
    );

    expect(result.scoped).toBe(
      '@scope ([fw-c="cart-badge"]) to (:scope [fw-c]) {\n  .count { color: red; }\n  button, a { color: blue; }\n}\n',
    );
    expect(result.fallback).toBe(
      '[fw-c="cart-badge"] .count:not([fw-c]):not([fw-c] *) { color: red; }[fw-c="cart-badge"] button:not([fw-c]):not([fw-c] *), [fw-c="cart-badge"] a:not([fw-c]):not([fw-c] *) { color: blue; }',
    );
  });

  it('excludes stamped and dashed nested island hosts from component CSS scopes', () => {
    const result = scopeComponentCss('[fw-c="cart-badge"]', '.count { color: red; }', {
      nestedHostSelectors: ['[fw-c]', 'cart-row'],
    });

    expect(result.scoped).toBe(
      '@scope ([fw-c="cart-badge"]) to (:scope [fw-c], :scope cart-row) {\n  .count { color: red; }\n}\n',
    );
    expect(result.fallback).toBe(
      '[fw-c="cart-badge"] .count:not([fw-c]):not([fw-c] *):not(cart-row):not(cart-row *) { color: red; }',
    );
  });

  it('dedupes normalized CSS chunks in page order', () => {
    expect(dedupeCss(['.a{}', '.a{}', ' .b{} '])).toBe('.a{}\n\n.b{}');
  });

  it('collects emitted component CSS artifacts as server stylesheet assets', () => {
    const cartBadge = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  css: \`
    .count { color: teal; }
  \`,
  render: () => <cart-badge><span class="count">1</span></cart-badge>,
});
`,
    });
    const cartDrawer = compileComponentModule({
      fileName: 'components/cart/cart-drawer.tsx',
      source: `
import { component } from '@jiso/core';

export const CartDrawer = component('cart-drawer', {
  css: \`
    dialog { border: 0; }
  \`,
  render: () => <dialog id="cart-drawer">Cart</dialog>,
});
`,
    });

    const manifest = collectCssAssetManifest([cartBadge, cartDrawer, cartBadge], {
      baseHref: '/_jiso/',
    });

    expect(manifest.stylesheets).toEqual([
      {
        componentName: 'CartBadge',
        fragmentTargets: [],
        href: '/_jiso/components/cart/cart-badge.css',
        sourceFileName: 'components/cart/cart-badge.css',
      },
      {
        componentName: 'CartDrawer',
        fragmentTargets: [],
        href: '/_jiso/components/cart/cart-drawer.css',
        sourceFileName: 'components/cart/cart-drawer.css',
      },
    ]);
    expect(selectCssAssets(manifest, ['components/cart/cart-drawer.css'])).toEqual([
      {
        componentName: 'CartDrawer',
        fragmentTargets: [],
        href: '/_jiso/components/cart/cart-drawer.css',
        sourceFileName: 'components/cart/cart-drawer.css',
      },
    ]);
  });

  it('carries preload policy for late fragment stylesheet delivery', () => {
    const result = compileComponentModule({
      fileName: './components/reviews.tsx',
      source: `
export const Reviews = component('reviews', {
  styles: \`
    .reviews-card { border-radius: 0.5rem; }
  \`,
  render: () => <section class="reviews-card">Ready</section>,
});
`,
    });

    expect(collectCssAssetManifest(result, { preload: false }).stylesheets).toEqual([
      {
        componentName: 'Reviews',
        fragmentTargets: [],
        href: '/assets/components/reviews.css',
        preload: false,
        sourceFileName: './components/reviews.css',
      },
    ]);
  });
});
