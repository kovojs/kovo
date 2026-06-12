import { describe, expect, it, vi } from 'vitest';

import {
  assertFixpoint,
  assertRenderEquivalence,
  collectCssAssetManifest,
  collectMinifierReservedNames,
  compileComponentModule,
  deriveAppGraph,
  deriveRegistryFactsFromGraph,
  dedupeCss,
  emitQueryPlanBootstrapModule,
  jisoVitePlugin,
  type JisoViteMiddleware,
  queryShapesFromFacts,
  scopeComponentCss,
  selectCssAssets,
} from './index.js';
import { renderEquivalenceCheck } from './emit/server.js';
import { createJisoVitePlugin } from './vite.js';

const cartBadgeSource = `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  fragmentTarget: true,
  queries: { cart: {} },
  render: () => (
    <button onClick={() => removeItem(state, item.id)}>
      <span data-bind="cart.count">2</span>
    </button>
  ),
});
`;

const prefixFixtureSource = `
import { component } from '@jiso/core';

export const Shell = component('shell', {
  render: () => <section></section>,
});
`;

function createMiddlewareResponse(): {
  body: string;
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
  end(body: string): void;
} {
  return {
    body: '',
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}

function expectHandlerRef(source: string, path: string, exportName: string): void {
  expect(source).toMatch(
    new RegExp(`${escapeRegExp(path)}\\?v=[0-9a-f]{8}#${escapeRegExp(exportName)}`),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
    expect(result.files[1]?.source).toContain('return removeItem(ctx.state, ctx.params.id);');
    expect(result.files[1]?.source).toContain('import { applyCompiledQueryUpdatePlan, handler }');
    expect(result.files[1]?.source).toContain('export const CartBadge$queryUpdatePlans');
    expectHandlerRef(
      result.files[0]?.source ?? '',
      '/c/components/cart/cart-badge.client.js',
      'CartBadge$button_click',
    );
    expect(result.files[0]?.source).toContain('data-p-id="{item.id}"');
    expect(result.files[2]?.source).toContain(
      "'#cart-badge': typeof import('../components/cart/cart-badge.client.js');",
    );
    expect(result.files[2]?.source).toContain("'cart-badge': {};");
    expect(result.files[2]?.source).toContain("'CartBadge:cart': readonly ['cart.count'];");
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('versions handler URLs from the emitted client module source', () => {
    const source = `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  render: () => <button onClick={() => add(item.id)}>Add</button>,
});
`;
    const first = compileComponentModule({ fileName: 'cart-badge.tsx', source });
    const second = compileComponentModule({ fileName: 'cart-badge.tsx', source });
    const changed = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: source.replace('add(item.id)', 'remove(item.id)'),
    });

    const firstVersion = first.files[0]?.source.match(/\.client\.js\?v=([0-9a-f]{8})#/)?.[1];
    const secondVersion = second.files[0]?.source.match(/\.client\.js\?v=([0-9a-f]{8})#/)?.[1];
    const changedVersion = changed.files[0]?.source.match(/\.client\.js\?v=([0-9a-f]{8})#/)?.[1];

    expect(firstVersion).toBeDefined();
    expect(secondVersion).toBe(firstVersion);
    expect(changedVersion).not.toBe(firstVersion);
  });

  it('emits executable handler bodies with stable unique anonymous names', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  state: () => ({ count: 0 }),
  render: () => (
    <div>
      <button onClick={() => state.count += item.quantity}>Add one</button>
      <button onClick={() => state.count = state.count - item.quantity}>Remove one</button>
    </div>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expectHandlerRef(
      serverSource,
      '/c/components/cart/cart-actions.client.js',
      'CartActions$button_click',
    );
    expectHandlerRef(
      serverSource,
      '/c/components/cart/cart-actions.client.js',
      'CartActions$button_click_2',
    );
    expect(serverSource).toContain('data-p-quantity="{item.quantity}"');
    expect(serverSource).toContain('fw-param-types="quantity:number"');
    expect(clientSource).toContain(
      'export const CartActions$button_click = handler((event, ctx) => {',
    );
    expect(clientSource).toContain('return ctx.state.count += ctx.params.quantity;');
    expect(clientSource).toContain(
      'export const CartActions$button_click_2 = handler((event, ctx) => {',
    );
    expect(clientSource).toContain(
      'return ctx.state.count = ctx.state.count - ctx.params.quantity;',
    );
  });

  it('declares boolean coercion for boolean-ish captured handler params', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => item.selected ? select(item.id) : deselect(item.id)}>Toggle</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('fw-param-types="selected:boolean"');
    expect(serverSource).toContain('data-p-selected="{item.selected}"');
    expect(serverSource).toContain('data-p-id="{item.id}"');
    expect(clientSource).toContain(
      'return ctx.params.selected ? select(ctx.params.id) : deselect(ctx.params.id);',
    );
  });

  it('extracts and rewrites handlers with nested object and block expressions', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <div>
      <button onClick={() => emit('cart:add', { id: item.id })}>Add</button>
      <button onClick={() => { log(item.id); emit('cart:remove', { id: item.id }); }}>Remove</button>
    </div>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expectHandlerRef(
      serverSource,
      '/c/components/cart/cart-actions.client.js',
      'CartActions$button_click',
    );
    expectHandlerRef(
      serverSource,
      '/c/components/cart/cart-actions.client.js',
      'CartActions$button_click_2',
    );
    expect(serverSource).toContain('data-p-id="{item.id}"');
    expect(serverSource).not.toContain('onClick={');
    expect(clientSource).toContain("return emit('cart:add', { id: ctx.params.id });");
    expect(clientSource).toContain(
      "log(ctx.params.id); emit('cart:remove', { id: ctx.params.id });",
    );
  });

  it('does not rewrite one element param inside a longer member expression', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => emit('cart:add', { id: item.id, idx: item.idx })}>Add</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('data-p-id="{item.id}"');
    expect(serverSource).toContain('data-p-idx="{item.idx}"');
    expect(clientSource).toContain(
      "return emit('cart:add', { id: ctx.params.id, idx: ctx.params.idx });",
    );
    expect(clientSource).not.toContain('id: ctx.params.idx');
  });

  it('rewrites handler captures without touching strings or template literal text', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  state: () => ({ count: 0 }),
  render: () => (
    <button onClick={() => {
      log('state changed for item.id');
      log(\`literal item.quantity stays text\`);
      state.count += item.quantity;
    }}>Add</button>
  ),
});
`,
    });

    const clientSource = result.files[1]?.source ?? '';

    expect(clientSource).toContain("log('state changed for item.id');");
    expect(clientSource).toContain('log(`literal item.quantity stays text`);');
    expect(clientSource).toContain('ctx.state.count += ctx.params.quantity;');
    expect(clientSource).not.toContain('ctx.state changed');
    expect(clientSource).not.toContain('literal ctx.params.quantity stays text');
  });

  it('extracts element params from wrapper calls with quoted commas', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => track('cart,add', item.id, { qty: item.quantity })}>Add</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('data-p-id="{item.id}"');
    expect(serverSource).toContain('data-p-quantity="{item.quantity}"');
    expect(clientSource).toContain(
      "return track('cart,add', ctx.params.id, { qty: ctx.params.quantity });",
    );
  });

  it('emits typed zero-argument arrow handlers from the TypeScript AST', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={(): void => track(item.id)}>Add</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('data-p-id="{item.id}"');
    expect(clientSource).toContain('return track(ctx.params.id);');
    expect(clientSource).not.toContain('unsupported handler expression');
  });

  it('does not extract element params from string literal text', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => log('item.id stays text')}>Add</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).not.toContain('data-p-id=');
    expect(clientSource).toContain("return log('item.id stays text');");
    expect(clientSource).not.toContain('ctx.params.id');
  });

  it('does not infer element param types from string literal comparisons', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => track(item.quantity, 'item.quantity > 0')}>Add</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('data-p-quantity="{item.quantity}"');
    expect(serverSource).not.toContain('fw-param-types="quantity:number"');
    expect(clientSource).toContain("return track(ctx.params.quantity, 'item.quantity > 0');");
  });

  it('infers element param types from AST usage contexts', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => track(item.quantity > 0, !item.selected)}>Add</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain('data-p-quantity="{item.quantity}"');
    expect(serverSource).toContain('data-p-selected="{item.selected}"');
    expect(serverSource).toContain('fw-param-types="quantity:number,selected:boolean"');
  });

  it('ignores event handler text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => {
    const sample = '<button onClick={() => window.alert("x")}>Add</button>';
    // <button onClick={() => document.body.remove()}>Remove</button>
    return <button>Static</button>;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.handlerExports).toEqual([]);
    expect(result.files[1]?.source).toContain('// no client handlers emitted');
  });

  it('emits provided query, mutation, and domain key registry facts', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      registryFacts: {
        domainKeys: ['product', 'cart', 'cart'],
        invalidations: {
          'cart/add': ['cart', 'productGrid', 'orderHistory', 'cart'],
        },
        mutations: {
          'cart/add': 'typeof addToCart',
          'cart/remove': 'typeof removeFromCart',
        },
        queries: {
          cart: 'typeof cartQuery',
          productGrid: 'typeof productGridQuery',
        },
        routes: ['/cart', '/products/:id'],
      },
      source: cartBadgeSource,
    });

    const registry = result.files[2]?.source ?? '';
    expect(registry).toContain(
      "'#cart-badge': typeof import('../components/cart/cart-badge.client.js');",
    );
    expect(registry).toContain("'cart-badge': {};");
    expect(registry).toContain(`interface FragmentTargets {
  'cart-badge': {};
  }`);
    expect(registry).toContain(`export interface QueryRegistry {
  'cart': typeof cartQuery;
  'productGrid': typeof productGridQuery;
}`);
    expect(registry).toContain(`export interface MutationRegistry {
  'cart/add': typeof addToCart;
  'cart/remove': typeof removeFromCart;
}`);
    expect(registry).toContain(`export interface InvalidationSets {
  'cart/add': 'cart' | 'orderHistory' | 'productGrid';
}`);
    expect(registry).toContain(`declare module '@jiso/core' {
  interface FragmentTargets {
  'cart-badge': {};
  }

  interface QueryRegistry {
  'cart': typeof cartQuery;
  'productGrid': typeof productGridQuery;
  }

  interface MutationRegistry {
  'cart/add': typeof addToCart;
  'cart/remove': typeof removeFromCart;
  }

  interface RouteRegistry {
  '/cart': import('@jiso/core').Route<'/cart'>;
  '/products/:id': import('@jiso/core').Route<'/products/:id'>;
  }

  interface InvalidationSets {
  'cart/add': 'cart' | 'orderHistory' | 'productGrid';
  }
}`);
    expect(registry).toContain('export type DomainKey = "cart" | "product";');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('derives registry facts from graph query, mutation, and page facts', () => {
    const registryFacts = deriveRegistryFactsFromGraph(
      {
        mutations: [
          { invalidates: ['cart'], key: 'cart/add', writes: ['cart', 'order'] },
          { key: 'product/reserve', writes: ['product'] },
        ],
        pages: [{ route: '/cart' }, { route: '/products/:id' }, { route: '/cart' }],
        queries: [
          { domains: ['cart'], query: 'cart' },
          { domains: ['product'], query: 'productGrid' },
          { domains: ['order'], query: 'orderHistory' },
        ],
      },
      {
        mutations: {
          'cart/add': 'typeof addToCart',
        },
        queries: {
          cart: 'typeof cartQuery',
        },
      },
    );

    expect(registryFacts).toEqual({
      domainKeys: ['cart', 'order', 'product'],
      invalidations: {
        'cart/add': ['cart'],
        'product/reserve': ['productGrid'],
      },
      mutations: {
        'cart/add': 'typeof addToCart',
      },
      queries: {
        cart: 'typeof cartQuery',
      },
      routes: ['/cart', '/products/:id'],
    });

    const result = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      registryFacts,
      source: cartBadgeSource,
    });
    const registry = result.files[2]?.source ?? '';

    expect(registry).toContain(`export interface RouteRegistry {
  '/cart': import('@jiso/core').Route<'/cart'>;
  '/products/:id': import('@jiso/core').Route<'/products/:id'>;
}`);
    expect(registry).toContain(`export interface InvalidationSets {
  'cart/add': 'cart';
  'product/reserve': 'productGrid';
}`);
    expect(registry).toContain('export type DomainKey = "cart" | "order" | "product";');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('derives app graph component facts from compiled component results', () => {
    const cartBadge = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: cartBadgeSource,
    });
    const productGrid = compileComponentModule({
      fileName: 'components/products/product-grid.tsx',
      source: `
import { component } from '@jiso/core';

export const ProductGrid = component('product-grid', {
  queries: { productGrid: {} },
  render: () => <section><ul data-bind="productGrid.items"></ul></section>,
});
`,
    });

    expect(cartBadge.componentGraphFacts).toEqual([
      {
        fragments: ['cart-badge'],
        name: 'CartBadge',
        queries: ['cart'],
      },
    ]);

    const derived = deriveAppGraph({
      components: [cartBadge, productGrid],
      graph: {
        mutations: [{ invalidates: ['cart'], key: 'cart/add', writes: ['cart'] }],
        pages: [{ route: '/cart' }],
        queries: [
          { domains: ['cart'], query: 'cart' },
          { domains: ['product'], query: 'productGrid' },
        ],
      },
    });

    expect(derived.graph.components).toEqual([
      {
        fragments: ['cart-badge'],
        name: 'CartBadge',
        queries: ['cart'],
      },
      {
        name: 'ProductGrid',
        queries: ['productGrid'],
      },
    ]);
    expect(derived.registryFacts).toEqual({
      components: ['cart-badge', 'product-grid'],
      domainKeys: ['cart', 'product'],
      invalidations: {
        'cart/add': ['cart'],
      },
      routes: ['/cart'],
    });
  });

  it('reports FW234 when component packages claim the same effective prefix', () => {
    const result = compileComponentModule({
      fileName: 'components/shell.tsx',
      packageComponentPrefixes: [
        { packageName: '@acme/primitives', prefix: 'acme-' },
        { packageName: '@other/acme-widgets', prefix: 'acme-' },
      ],
      source: prefixFixtureSource,
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'FW234',
        fileName: 'components/shell.tsx',
        help: expect.stringContaining(
          'SPEC §6.1.1 keeps package prefixes app-wide unique because the effective prefix is emitted into rendered hosts, residual fw-c values, scoped CSS, and package behavior attributes.',
        ),
        message: expect.stringContaining(
          'Effective package prefix "acme-" is claimed by @acme/primitives and @other/acme-widgets.',
        ),
        severity: 'error',
      }),
    ]);
    expect(result.diagnostics[0]?.help).toContain('effectivePrefix: "other-acme-"');
  });

  it('accepts an explicit package prefix alias as the collision escape hatch', () => {
    const result = compileComponentModule({
      fileName: 'components/shell.tsx',
      packageComponentPrefixes: [
        { packageName: '@acme/primitives', prefix: 'acme-' },
        {
          effectivePrefix: 'other-acme-',
          packageName: '@other/acme-widgets',
          prefix: 'acme-',
        },
      ],
      source: prefixFixtureSource,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('carries explicit package prefix facts into the app explain graph', () => {
    const derived = deriveAppGraph({
      graph: {
        components: [{ name: 'JisoDialog' }],
      },
      packageComponentPrefixes: [
        {
          packageName: '@jiso/headless-ui',
          prefix: 'jiso-',
        },
      ],
    });

    expect(derived.graph).toEqual({
      components: [{ name: 'JisoDialog' }],
      packageComponentPrefixes: [
        {
          packageName: '@jiso/headless-ui',
          prefix: 'jiso-',
        },
      ],
    });
  });

  it('reports FW234 when non-jiso packages use the reserved jiso prefix family', () => {
    const result = compileComponentModule({
      fileName: 'components/shell.tsx',
      packageComponentPrefixes: [
        { packageName: '@jiso/headless-ui', prefix: 'jiso-' },
        { packageName: '@acme/widgets', prefix: 'acme-', effectivePrefix: 'jiso-widgets-' },
      ],
      source: prefixFixtureSource,
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'FW234',
        fileName: 'components/shell.tsx',
        help: expect.stringContaining(
          'SPEC §6.1.1 reserves the jiso-* prefix family for packages whose manifest name is in the @jiso/* scope.',
        ),
        message: expect.stringContaining(
          '@acme/widgets cannot use reserved jiso-* package prefix "jiso-widgets-".',
        ),
        severity: 'error',
      }),
    ]);
  });

  it('reports FW234 when packages try to claim the framework fw attribute namespace', () => {
    const result = compileComponentModule({
      fileName: 'components/shell.tsx',
      packageComponentPrefixes: [{ packageName: '@acme/widgets', prefix: 'fw-' }],
      source: prefixFixtureSource,
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'FW234',
        fileName: 'components/shell.tsx',
        help: expect.stringContaining(
          'SPEC §6.1.1 reserves the fw-* attribute namespace for framework-owned attributes and future loader/compiler growth.',
        ),
        message: expect.stringContaining(
          '@acme/widgets cannot use reserved fw-* package prefix "fw-".',
        ),
        severity: 'error',
      }),
    ]);
  });

  it('reports FW234 for missing or invalid package prefix facts', () => {
    const result = compileComponentModule({
      fileName: 'components/shell.tsx',
      packageComponentPrefixes: [
        { packageName: '@missing/prefix' },
        { packageName: '@bad/prefix', prefix: 'BadPrefix' },
      ],
      source: prefixFixtureSource,
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'FW234',
        message: expect.stringContaining(
          '@missing/prefix is imported as a component package but does not declare package.json jiso.prefix.',
        ),
      }),
      expect.objectContaining({
        code: 'FW234',
        message: expect.stringContaining(
          '@bad/prefix declares invalid package.json jiso.prefix "BadPrefix".',
        ),
      }),
    ]);
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
        '/* @jiso-scope-fallback */',
        'cart-badge button:not([fw-c]):not([fw-c] *) { color: teal; }',
        'cart-badge .count:not([fw-c]):not([fw-c] *) { font-weight: 700; }',
        '',
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
        criticalCss: expect.stringContaining('@scope (cart-badge) to (:scope [fw-c])'),
        fragmentTargets: ['cart-badge'],
        href: '/assets/components/cart/cart-badge.css',
        sourceFileName: 'components/cart/cart-badge.css',
      },
    ]);
    expect(result.files[0]?.source).toContain('export function renderSource()');
    expect(result.files[1]?.source).toContain('// no client handlers emitted');
    expect(result.files[3]?.source).toContain("'cart-badge': {};");
    expect(result.files[3]?.source).toContain(
      "'CartBadge': { href: '/assets/components/cart/cart-badge.css'; sourceFileName: 'components/cart/cart-badge.css'; fragmentTargets: readonly ['cart-badge']; };",
    );
    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('reports render-equivalence failures with the emitted server artifact', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: cartBadgeSource,
    });
    const failed = {
      ...result,
      renderEquivalenceChecks: [
        {
          actual: '<cart-badge>3</cart-badge>',
          artifact: 'components/cart/cart-badge.server.js',
          expected: '<cart-badge>2</cart-badge>',
          ok: false,
        },
      ],
    };

    expect(() => assertRenderEquivalence(failed)).toThrow(
      'Render equivalence failed for components/cart/cart-badge.server.js',
    );
  });

  it('executes emitted renderSource for render-equivalence checks', () => {
    const expected = '<cart-badge>u0032</cart-badge>';
    const serverSource = [
      '// @jiso-ir',
      'export function renderSource() {',
      '  return `<cart-badge>\\u0032</cart-badge>`;',
      '}',
      '',
    ].join('\n');

    const check = renderEquivalenceCheck(
      'components/cart/cart-badge.server.js',
      expected,
      serverSource,
    );

    expect(check).toEqual({
      actual: '<cart-badge>2</cart-badge>',
      artifact: 'components/cart/cart-badge.server.js',
      expected,
      ok: false,
    });
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
    expect(result.files.find((file) => file.fileName.endsWith('.css'))?.source).toContain(
      '[fw-c="cart-row"] td:not([fw-c]):not([fw-c] *) { padding: 0.5rem; }',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('scopes CSS to the returned host instead of tag text inside render bodies', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  css: \`
    button { color: teal; }
  \`,
  render: () => {
    const sample = '<cart-badge></cart-badge>';
    // <also-not-the-host></also-not-the-host>
    return <section fw-c="cart-badge"><button>1</button></section>;
  },
});
`,
    });

    const cssSource = result.files.find((file) => file.fileName.endsWith('.css'))?.source ?? '';
    expect(cssSource).toContain('@scope ([fw-c="cart-badge"]) to (:scope [fw-c])');
    expect(cssSource).toContain(
      '[fw-c="cart-badge"] button:not([fw-c]):not([fw-c] *) { color: teal; }',
    );
    expect(cssSource).not.toContain('@scope (cart-badge)');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('does not discover component CSS from css-looking render text', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  render: () => {
    const sample = 'css: \`button { color: red; }\`';
    // styles: \`a { color: blue; }\`
    return <cart-badge>{sample}</cart-badge>;
  },
});
`,
    });

    expect(result.files.some((file) => file.fileName.endsWith('.css'))).toBe(false);
    expect(result.cssAssets).toEqual([]);
  });

  it('emits empty registry fact surfaces when no facts are provided', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: cartBadgeSource,
    });

    const registry = result.files[2]?.source ?? '';
    expect(registry).toMatch(/export interface QueryRegistry \{\n\n\}/);
    expect(registry).toMatch(/export interface MutationRegistry \{\n\n\}/);
    expect(registry).toMatch(/export interface RouteRegistry \{\n\n\}/);
    expect(registry).toMatch(/export interface InvalidationSets \{\n\n\}/);
    expect(registry).toContain(`declare module '@jiso/core' {
  interface FragmentTargets {
  'cart-badge': {};
  }

  interface QueryRegistry {

  }

  interface MutationRegistry {

  }

  interface RouteRegistry {

  }

  interface InvalidationSets {

  }
}`);
    expect(registry).toContain('export type DomainKey = never;');
  });

  it('collects emitted handler export names for minifier preservation', () => {
    const cartBadge = compileComponentModule({
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
    const cartDrawer = compileComponentModule({
      fileName: 'components/cart/cart-drawer.tsx',
      source: `
import { component } from '@jiso/core';

export const CartDrawer = component('cart-drawer', {
  render: () => (
    <button onClick={removeItem}>Remove</button>
  ),
});
`,
    });

    expect(collectMinifierReservedNames([cartDrawer, cartBadge, cartBadge])).toEqual([
      'CartBadge$button_click',
      'CartBadge$removeItem',
      'CartDrawer$removeItem',
    ]);
  });

  it('reports FW210 for anonymous handlers', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: cartBadgeSource,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW210',
        fileName: 'cart-badge.tsx',
        length: 5,
        message: 'Anonymous handler; name it for stable identity.',
        severity: 'lint',
        start: { column: 13, line: 8 },
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
        code: 'FW210',
        severity: 'lint',
      },
      {
        code: 'FW201',
        severity: 'error',
      },
    ]);
    const fw201 = result.diagnostics.find((diagnostic) => diagnostic.code === 'FW201');
    expect(fw201?.help).toMatch(
      /Would lower to: on:click="\/c\/cart-badge\.client\.js\?v=[0-9a-f]{8}#CartBadge\$button_click"/,
    );
    expect(fw201?.help).toContain('Blocked expression: () => window.alert("x")');
    expect(fw201?.help).toContain(
      'Fixes: move the value into component/query state via ctx; pass serializable element params with data-p-*; or keep shared constants in module scope.',
    );
    expect(fw201?.help).toContain(
      'The compiler conservatively blocks free identifier references named window, document, db, request, response, Date, Map, or Set.',
    );
    expect(fw201?.start).toEqual({ column: 9, line: 1 });
  });

  it('reports stable-name and serializability diagnostics for anonymous browser handlers', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: '<button onClick={() => window.alert("x")}>x</button>',
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['FW210', 'FW201']);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'FW210',
      severity: 'lint',
      start: { column: 9, line: 1 },
    });
    expect(result.diagnostics[1]).toMatchObject({
      code: 'FW201',
      severity: 'error',
      start: { column: 9, line: 1 },
    });
  });

  it('does not report FW201 for local variables named like non-serializable captures', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  render: () => (
    <button onClick={() => { const response = { ok: true }; return response.ok; }}>
      Check
    </button>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW210',
        fileName: 'cart-badge.tsx',
        length: 5,
        message: 'Anonymous handler; name it for stable identity.',
        severity: 'lint',
        start: { column: 13, line: 4 },
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

  it('reports FW235 for app-authored string-rendered component modules', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => \`<cart-badge fw-deps="cart"><span data-bind="cart.count">\${cart.count}</span></cart-badge>\`,
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW235',
        fileName: 'cart-badge.tsx',
        help: [
          'SPEC §5.2: TSX is the sole app-authoring surface. Write JSX with typed expressions and let the compiler emit renderSource(), fw-c, fw-deps, and data-bind.',
          'TSX equivalent direction: render with JSX, for example `render: (...) => (<cart-badge>...</cart-badge>)`, and use typed expressions such as `{cart.count}` instead of data-bind strings.',
        ].join('\n'),
        length: 91,
        message:
          'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.',
        severity: 'error',
        start: { column: 25, line: 4 },
      },
    ]);
  });

  it('keeps compiler-emitted IR accepted through explicit fixpoint provenance', () => {
    const emitted = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: cartBadgeSource,
    }).files.find((file) => file.kind === 'server');

    expect(emitted).toBeDefined();
    const recompiled = compileComponentModule({
      fileName: emitted?.fileName ?? 'cart-badge.server.js',
      source: emitted?.source ?? '',
      sourceProvenance: 'compiler-emitted',
    });

    expect(recompiled.diagnostics).toEqual([]);
    expect(recompiled.files).toEqual([emitted]);
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

  it('ignores platform behavior text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-button.tsx',
      source: `
export const CartButton = component('cart-button', {
  render: () => {
    const sample = "<button onClick={() => document.getElementById('missing')!.showModal()} />";
    // <button onClick={() => document.getElementById('also-missing')!.showModal()} />
    return <button onClick={() => document.getElementById('cart-drawer')!.showModal()}>Open</button>;
  },
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(result.platformSubstitutions).toEqual([
      {
        action: 'show-modal',
        event: 'click',
        kind: 'dialog',
        tag: 'button',
        target: 'cart-drawer',
      },
    ]);
    expect(serverSource).toContain("document.getElementById('missing')!.showModal()");
    expect(serverSource).toContain('commandfor="cart-drawer" command="show-modal"');
    expect(serverSource).not.toContain("document.getElementById('cart-drawer')!.showModal()");
    expect(() => assertFixpoint(result)).not.toThrow();
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

  it('accepts literal IDREFs that reference ids in component scope', () => {
    const result = compileComponentModule({
      fileName: 'cart-shell.tsx',
      source: `
export const CartShell = component('cart-shell', {
  render: () => (
    <section>
      <label for="cart-search">Search</label>
      <input id="cart-search" aria-describedby="cart-help cart-extra" />
      <p id="cart-help">Filter cart items.</p>
      <p id="cart-extra">Updates as you type.</p>
      <button commandfor="cart-drawer" command="show-modal">Open</button>
      <dialog id="cart-drawer">Cart</dialog>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('accepts package-prefixed behavior IDREFs that reference ids in component scope', () => {
    const result = compileComponentModule({
      fileName: 'pricing-link.tsx',
      packageComponentPrefixes: [
        {
          idrefBehaviorAttributes: ['tooltip'],
          packageName: '@jiso/headless-ui',
          prefix: 'jiso-',
        },
      ],
      source: `
export const PricingLink = component('pricing-link', {
  render: () => (
    <section>
      <a href="/pricing" jiso-tooltip="pricing-tip">Pricing</a>
      <p id="pricing-tip">Starts at $20.</p>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports FW221 for package-prefixed behavior IDREFs that miss component scope ids', () => {
    const result = compileComponentModule({
      fileName: 'pricing-link.tsx',
      packageComponentPrefixes: [
        {
          effectivePrefix: 'acme-ui-',
          idrefBehaviorAttributes: ['tooltip'],
          packageName: '@acme/headless-ui',
          prefix: 'acme-',
        },
      ],
      source: `
export const PricingLink = component('pricing-link', {
  render: () => (
    <section>
      <a href="/pricing" acme-ui-tooltip="missing-tip" fw-tooltip="framework-owned">Pricing</a>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW221',
        fileName: 'pricing-link.tsx',
        length: 29,
        message: 'IDREF references an id not present in component scope. missing-tip',
        severity: 'error',
        start: { column: 26, line: 5 },
      },
    ]);
  });

  it('reports FW221 for literal IDREFs that miss component scope ids', () => {
    const result = compileComponentModule({
      fileName: 'cart-shell.tsx',
      source: `
export const CartShell = component('cart-shell', {
  render: () => (
    <section>
      <label for="cart-search">Search</label>
      <input id="cart-query" aria-describedby="cart-help missing-help" />
      <p id="cart-help">Filter cart items.</p>
      <button popovertarget="filters">Filters</button>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW221',
        fileName: 'cart-shell.tsx',
        length: 17,
        message: 'IDREF references an id not present in component scope. cart-search',
        severity: 'error',
        start: { column: 14, line: 5 },
      },
      {
        code: 'FW221',
        fileName: 'cart-shell.tsx',
        length: 41,
        message: 'IDREF references an id not present in component scope. missing-help',
        severity: 'error',
        start: { column: 30, line: 6 },
      },
      {
        code: 'FW221',
        fileName: 'cart-shell.tsx',
        length: 23,
        message: 'IDREF references an id not present in component scope. filters',
        severity: 'error',
        start: { column: 15, line: 8 },
      },
    ]);
  });

  it('ignores ID and IDREF text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-shell.tsx',
      source: `
export const CartShell = component('cart-shell', {
  render: () => {
    const sample = '<label for="missing">Search</label><input id="duplicate" id="duplicate" />';
    // <button popovertarget="missing-popover"></button>
    return <section><span id="cart-title">Cart</span></section>;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports FW224 for duplicate literal ids in component scope', () => {
    const result = compileComponentModule({
      fileName: 'cart-shell.tsx',
      source: `
export const CartShell = component('cart-shell', {
  render: () => (
    <section>
      <h2 id="cart-title">Cart</h2>
      <output id="cart-title">2 items</output>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW224',
        fileName: 'cart-shell.tsx',
        message:
          'Static id appears in a repeatable component or duplicate page composition. duplicate id="cart-title"',
        severity: 'error',
        start: { column: 15, line: 6 },
        length: 15,
      },
    ]);
  });

  it('reports FW224 without FW221 when an IDREF targets a duplicated id', () => {
    const result = compileComponentModule({
      fileName: 'cart-shell.tsx',
      source: `
export const CartShell = component('cart-shell', {
  render: () => (
    <section>
      <button commandfor="cart-drawer" command="show-modal">Open</button>
      <dialog id="cart-drawer">Cart</dialog>
      <dialog id="cart-drawer">Duplicate</dialog>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW224',
        fileName: 'cart-shell.tsx',
        message:
          'Static id appears in a repeatable component or duplicate page composition. duplicate id="cart-drawer"',
        severity: 'error',
        start: { column: 15, line: 7 },
        length: 16,
      },
    ]);
  });

  it('reports FW224 for static ids inside repeatable list stamps', () => {
    const result = compileComponentModule({
      fileName: 'cart-list.tsx',
      source: `
export const CartList = component('cart-list', {
  render: () => (
    <ul data-bind-list="cart.items" fw-key="productId">
      <template fw-stamp>
        <li id="cart-row"><span data-bind=".name">Mug</span></li>
      </template>
    </ul>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW224',
        fileName: 'cart-list.tsx',
        message:
          'Static id appears in a repeatable component or duplicate page composition. repeatable id="cart-row"',
        severity: 'error',
        start: { column: 13, line: 6 },
        length: 13,
      },
    ]);
  });

  it('allows static ids on non-repeated data-bind-list containers', () => {
    const result = compileComponentModule({
      fileName: 'cart-list.tsx',
      source: `
export const CartList = component('cart-list', {
  render: () => (
    <ul id="cart-items" data-bind-list="cart.items" fw-key="productId">
      <template fw-stamp>
        <li><span data-bind=".name">Mug</span></li>
      </template>
    </ul>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('accepts native table rows when the parser keeps the authored tree shape', () => {
    const result = compileComponentModule({
      fileName: 'cart-table.tsx',
      registryFacts: {
        components: ['cart-row'],
      },
      source: `
export const CartTable = component('cart-table', {
  render: () => (
    <table>
      <tbody>
        <tr fw-c="cart-row">
          <td>Cart row</td>
        </tr>
      </tbody>
    </table>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports FW225 for parser-reparented HTML content-model violations', () => {
    const result = compileComponentModule({
      fileName: 'cart-shell.tsx',
      source: `
export const CartShell = component('cart-shell', {
  render: () => (
    <section>
      <p>
        Cart intro
        <div>Parser closes the paragraph before this div.</div>
      </p>
      <tr>
        <td>Detached row</td>
      </tr>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW225',
        fileName: 'cart-shell.tsx',
        length: 5,
        message: 'JSX nesting violates the HTML content model. <div> cannot appear inside <p>',
        severity: 'error',
        start: { column: 9, line: 7 },
      },
      {
        code: 'FW225',
        fileName: 'cart-shell.tsx',
        length: 4,
        message:
          'JSX nesting violates the HTML content model. <tr> must be inside a table section or table',
        severity: 'error',
        start: { column: 7, line: 9 },
      },
    ]);
  });

  it('ignores HTML content-model text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-shell.tsx',
      source: `
export const CartShell = component('cart-shell', {
  render: () => {
    const sample = '<p><div>Not JSX</div></p><tr><td>Detached</td></tr>';
    // <p><section>Not JSX</section></p>
    return (
      <section>
        <p>Cart intro</p>
        <table><tbody><tr><td>Attached row</td></tr></tbody></table>
      </section>
    );
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('accepts known delegated events and declared execution triggers', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component('execution-triggers', {
  render: () => (
    <section>
      <button on:click="/c/cart.client.js#Cart$add">Add</button>
      <search-index on:idle="/c/search.client.js#Search$warm"></search-index>
      <sales-chart on:visible="/c/chart.client.js#SalesChart$mount"></sales-chart>
      {/* FW211: stock ticker intentionally starts at parse for market-open pages. */}
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports FW211 and FW212 for unjustified eager execution and unknown triggers', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component('execution-triggers', {
  render: () => (
    <section>
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
      <video-player on:media="/c/video.client.js#Video$mount"></video-player>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW211',
        fileName: 'execution-triggers.tsx',
        length: 7,
        message: 'on:load eager trigger requires a justification comment. on:load',
        severity: 'lint',
        start: { column: 21, line: 5 },
      },
      {
        code: 'FW212',
        fileName: 'execution-triggers.tsx',
        length: 8,
        message: 'Unknown on:* event or execution trigger name. on:media',
        severity: 'lint',
        start: { column: 21, line: 6 },
      },
    ]);
  });

  it('ignores execution trigger text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component('execution-triggers', {
  render: () => {
    const sample = '<stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>';
    // <video-player on:media="/c/video.client.js#Video$mount"></video-player>
    return <button on:click="/c/cart.client.js#Cart$add">Add</button>;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('requires FW211 justification to be attached to the eager trigger', () => {
    const result = compileComponentModule({
      fileName: 'execution-triggers.tsx',
      source: `
export const ExecutionTriggers = component('execution-triggers', {
  render: () => (
    <section>
      {/* FW211: this explains another trigger. */}
      <button on:click="/c/cart.client.js#Cart$add">Add</button>
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW211',
        fileName: 'execution-triggers.tsx',
        length: 7,
        message: 'on:load eager trigger requires a justification comment. on:load',
        severity: 'lint',
        start: { column: 21, line: 7 },
      },
    ]);
  });

  it('accepts literal navigation targets that match declared routes', () => {
    const result = compileComponentModule({
      fileName: 'product-links.tsx',
      registryFacts: {
        routes: ['/cart', '/products/:id'],
      },
      source: `
export const ProductLinks = component('product-links', {
  render: () => (
    <nav>
      <a href="/products/p1?max=500">Product</a>
      <form method="get" action="/cart"></form>
      <a href="https://example.com/products/p1">External</a>
      <a href="#details">Skip link</a>
    </nav>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('lowers static Link navigation sugar to plain anchors', () => {
    const result = compileComponentModule({
      fileName: 'product-links.tsx',
      registryFacts: {
        routes: ['/cart', '/products/:id'],
      },
      source: `
export const ProductLinks = component('product-links', {
  render: () => (
    <nav>
      <Link className="product-link" to="/products/:id" params={{ id: 'p 1' }} search={{ max: 500, sort: 'price' }}>
        Product
      </Link>
    </nav>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.files[0]?.source).toContain(
      '<a className="product-link" href="/products/p%201?max=500&amp;sort=price">',
    );
    expect(result.files[0]?.source).not.toContain('<Link');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('ignores Link navigation sugar text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'product-links.tsx',
      registryFacts: {
        routes: ['/products/:id'],
      },
      source: `
export const ProductLinks = component('product-links', {
  render: () => {
    const sample = '<Link to="/missing">Missing</Link>';
    // <Link to="/also-missing">Missing</Link>
    return <Link to="/products/:id" params={{ id: 'p 1' }}>Product</Link>;
  },
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(result.diagnostics).toEqual([]);
    expect(serverSource).toContain('const sample = \'<Link to="/missing">Missing</Link>\'');
    // SPEC.md section 4.2: the lowered native <a> host also receives the derived fw-c stamp.
    expect(serverSource).toContain('<a href="/products/p%201" fw-c="product-links">Product</a>');
    expect(serverSource).not.toContain('<Link to="/products/:id"');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('lowers static href calls to literal anchor hrefs before FW220 validation', () => {
    const result = compileComponentModule({
      fileName: 'product-links.tsx',
      registryFacts: {
        routes: ['/cart', '/products/:id'],
      },
      source: `
export const ProductLinks = component('product-links', {
  render: () => (
    <nav>
      <a href={href('/products/:id', { params: { id: 'p1' }, search: { max: 500, sort: 'price' } })}>
        Product
      </a>
    </nav>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.files[0]?.source).toContain('href="/products/p1?max=500&amp;sort=price"');
    expect(result.files[0]?.source).not.toContain("href('/products/:id'");
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('ignores static href call text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'product-links.tsx',
      registryFacts: {
        routes: ['/products/:id'],
      },
      source: `
export const ProductLinks = component('product-links', {
  render: () => {
    const sample = "href('/products/:id', { params: { id: 'p1' } })";
    // href('/products/:id', { params: { id: 'p2' } })
    return <a href={href('/products/:id', { params: { id: 'p3' } })}>Product</a>;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.files[0]?.source).toContain(
      "const sample = \"href('/products/:id', { params: { id: 'p1' } })\"",
    );
    expect(result.files[0]?.source).toContain('href="/products/p3"');
    expect(result.files[0]?.source).not.toContain(
      "href('/products/:id', { params: { id: 'p3' } })",
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('reports FW220 for literal navigation targets outside the route table', () => {
    const result = compileComponentModule({
      fileName: 'product-links.tsx',
      registryFacts: {
        routes: ['/cart', '/products/:id'],
      },
      source: `
export const ProductLinks = component('product-links', {
  render: () => (
    <nav>
      <a href="/product/p1">Product</a>
      <form method="get" action="/checkout"></form>
    </nav>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW220',
        fileName: 'product-links.tsx',
        message: 'Literal href or form action matches no declared route. /product/p1',
        severity: 'error',
        start: { column: 10, line: 5 },
        length: 18,
      },
      {
        code: 'FW220',
        fileName: 'product-links.tsx',
        message: 'Literal href or form action matches no declared route. /checkout',
        severity: 'error',
        start: { column: 26, line: 6 },
        length: 18,
      },
    ]);
  });

  it('ignores literal navigation target text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'product-links.tsx',
      registryFacts: {
        routes: ['/cart', '/products/:id'],
      },
      source: `
export const ProductLinks = component('product-links', {
  render: () => {
    const sample = '<a href="/missing">Missing</a><form action="/checkout"></form>';
    // <a href="/also-missing">Missing</a>
    return <a href="/products/p1">Product</a>;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores expression href attribute text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'product-links.tsx',
      registryFacts: {
        routes: ['/products/:id'],
      },
      source: `
export const ProductLinks = component('product-links', {
  render: () => {
    const sample = 'href={"/missing"}';
    // href={"/also-missing"}
    return <a href={"/products/p1"}>Product</a>;
  },
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(result.diagnostics).toEqual([]);
    expect(serverSource).toContain('const sample = \'href={"/missing"}\'');
    expect(serverSource).toContain('href="/products/p1"');
    expect(serverSource).not.toContain('href={"/products/p1"}');
    expect(() => assertFixpoint(result)).not.toThrow();
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
    expectHandlerRef(
      result.files[0]?.source ?? '',
      '/c/accordion-toggle.client.js',
      'AccordionToggle$button_click',
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
    // SPEC.md section 4.2: the native <img> host also receives the derived fw-c stamp.
    expect(result.files[0]?.source).toContain(
      '<img src="/p1.png" style="view-transition-name: product-p1-image" fw-c="product-card" />',
    );
    expect(result.files[2]?.source).toContain("'product-p1-image': unknown;");
  });

  it('merges cross-document view transition stamps into existing static styles', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      source: `
export const ProductCard = component('product-card', {
  render: () => <img style="opacity: .8" viewTransitionName="product-p1-image" src="/p1.png" />,
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(result.viewTransitions).toEqual([{ name: 'product-p1-image' }]);
    // SPEC.md section 4.2: the native <img> host also receives the derived fw-c stamp.
    expect(serverSource).toContain(
      '<img style="opacity: .8; view-transition-name: product-p1-image" src="/p1.png" fw-c="product-card" />',
    );
    expect(serverSource.match(/\sstyle=/g)).toHaveLength(1);
    expect(serverSource).not.toContain('viewTransitionName=');
  });

  it('ignores view transition attribute text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      source: `
export const ProductCard = component('product-card', {
  render: () => {
    const sample = '<img viewTransitionName="not-real" />';
    // <img viewTransitionName="also-not-real" />
    return <img viewTransitionName="product-p1-image" src="/p1.png" />;
  },
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(result.viewTransitions).toEqual([{ name: 'product-p1-image' }]);
    expect(serverSource).toContain('const sample = \'<img viewTransitionName="not-real" />\'');
    // SPEC.md section 4.2: the native <img> host also receives the derived fw-c stamp.
    expect(serverSource).toContain(
      '<img src="/p1.png" style="view-transition-name: product-p1-image" fw-c="product-card" />',
    );
    expect(serverSource).not.toContain('viewTransitionName="product-p1-image"');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('accepts data-bind paths present in declared query shapes', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: {
        cart: {
          count: 'number',
          empty: 'boolean',
          items: [{ productId: 'string', qty: 'number' }],
        },
      },
      source: `
export const CartBadge = component('cart-badge', {
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">2</span>
      <button data-bind:hidden="cart.empty">Checkout</button>
      <span data-bind="cart.items.productId">p1</span>
    </cart-badge>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('validates data-bind paths against generated query shape facts', () => {
    const queryShapeFacts = [
      {
        query: 'cart',
        shape: {
          count: 'number',
          empty: 'boolean',
          items: [{ productId: 'string', qty: 'number' }],
        },
        source: 'generated/queries/cart.shape.ts',
      },
    ] as const;
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapeFacts,
      source: `
export const CartBadge = component('cart-badge', {
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">2</span>
      <button data-bind:aria-label="cart.empty">Checkout</button>
      <span data-bind="cart.items.productId">p1</span>
    </cart-badge>
  ),
});
`,
    });

    expect(queryShapesFromFacts(queryShapeFacts)).toEqual({
      cart: {
        count: 'number',
        empty: 'boolean',
        items: [{ productId: 'string', qty: 'number' }],
      },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('accepts optional binding path segments through nullable query shape metadata', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      queryShapeFacts: [
        {
          query: 'product',
          shape: {
            details: {
              kind: 'nullable',
              shape: {
                name: 'string',
              },
            },
            inventory: {
              kind: 'optional',
              shape: {
                stock: 'number',
              },
            },
          },
          source: 'generated/queries/product.shape.ts',
        },
      ],
      source: `
export const ProductCard = component('product-card', {
  render: () => (
    <article>
      <span data-bind="product.details?.name">Coffee</span>
      <span data-bind="product.inventory?.stock">12</span>
    </article>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports FW227 when binding paths traverse nullable query shape metadata without optional segments', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      queryShapeFacts: [
        {
          query: 'product',
          shape: {
            details: {
              kind: 'nullable',
              shape: {
                name: 'string',
              },
            },
          },
          source: 'generated/queries/product.shape.ts',
        },
      ],
      source: `
export const ProductCard = component('product-card', {
  render: () => <span data-bind="product.details.name">Coffee</span>,
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW227',
        fileName: 'product-card.tsx',
        help: [
          'Fixes: write the nullable traversal with ?., extract a named derive that handles null explicitly, or make the projection non-null in the query.',
          'SPEC §4.8 requires empty-on-null semantics to be explicit so the server renderer and loader cannot drift.',
        ].join('\n'),
        length: 32,
        message:
          'Binding path traverses a nullable segment without ?. product.details.name (segment: details)',
        severity: 'error',
        start: { column: 23, line: 3 },
      },
    ]);
  });

  it('lowers optional query traversal sugar to optional data-bind path segments', () => {
    const result = compileComponentModule({
      fileName: 'deal-card.tsx',
      queryShapes: {
        deal: {
          contact: {
            kind: 'nullable',
            shape: {
              name: 'string',
            },
          },
        },
      },
      source: `
export const DealCard = component('deal-card', {
  queries: { deal: {} },
  render: () => (
    <deal-card>
      <span>{deal.contact?.name}</span>
    </deal-card>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain(
      '<span data-bind="deal.contact?.name">{deal.contact?.name}</span>',
    );
    expect(result.queryUpdatePlans).toEqual([
      {
        componentName: 'DealCard',
        paths: ['deal.contact?.name'],
        query: 'deal',
      },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('reports FW302 for absent paths under nullable query shape metadata', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      queryShapeFacts: [
        {
          query: 'product',
          shape: {
            details: {
              kind: 'nullable',
              shape: {
                name: 'string',
              },
            },
          },
          source: 'generated/queries/product.shape.ts',
        },
      ],
      source: `
export const ProductCard = component('product-card', {
  render: () => <span data-bind="product.details.price">0</span>,
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW302',
        fileName: 'product-card.tsx',
        length: 33,
        message: 'data-bind path is not present in the declared query shape. product.details.price',
        severity: 'error',
        start: { column: 23, line: 3 },
      },
    ]);
  });

  it('reports FW302 when generated query shape facts no longer contain a binding path', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapeFacts: [
        {
          query: 'cart',
          shape: {
            itemCount: 'number',
          },
          source: 'generated/queries/cart.shape.ts',
        },
      ],
      source: `
export const CartBadge = component('cart-badge', {
  render: () => <span data-bind="cart.count">2</span>,
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW302',
        fileName: 'cart-badge.tsx',
        length: 22,
        message: 'data-bind path is not present in the declared query shape. cart.count',
        severity: 'error',
        start: { column: 23, line: 3 },
      },
    ]);
  });

  it('ignores data-bind text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: {
        cart: {
          count: 'number',
        },
      },
      source: `
export const CartBadge = component('cart-badge', {
  render: () => {
    const sample = '<span data-bind="cart.missing">0</span>';
    // <span data-bind="cart.otherMissing">0</span>
    return <span data-bind="cart.count">2</span>;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('validates ejected list stamps against array element query shapes', () => {
    const valid = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: {
        cart: {
          items: [{ name: 'string', productId: 'string', qty: 'number' }],
        },
      },
      source: `
export const CartBadge = component('cart-badge', {
  render: () => (
    <ul data-bind-list="cart.items" fw-key="productId">
      <template fw-stamp>
        <li><span data-bind=".qty">0</span> × <span data-bind=".name">Item</span></li>
      </template>
    </ul>
  ),
});
`,
    });
    const invalid = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: {
        cart: {
          items: [{ name: 'string', productId: 'string' }],
        },
      },
      source: `
export const CartBadge = component('cart-badge', {
  render: () => (
    <ul data-bind-list="cart.items" fw-key="sku">
      <template fw-stamp>
        <li><span data-bind=".missing">0</span></li>
      </template>
    </ul>
  ),
});
`,
    });

    expect(valid.diagnostics).toEqual([]);
    expect(invalid.diagnostics).toEqual([
      {
        code: 'FW302',
        fileName: 'cart-badge.tsx',
        message: 'data-bind path is not present in the declared query shape. cart.items',
        severity: 'error',
        start: { column: 9, line: 4 },
        length: 27,
      },
    ]);
  });

  it('ignores data-bind-list text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: {
        cart: {
          items: [{ name: 'string', productId: 'string' }],
        },
      },
      source: `
export const CartBadge = component('cart-badge', {
  render: () => {
    const sample = '<ul data-bind-list="cart.missing" fw-key="id"><template fw-stamp><li><span data-bind=".name">Item</span></li></template></ul>';
    // <ul data-bind-list="cart.otherMissing" fw-key="id"><template fw-stamp><li><span data-bind=".name">Item</span></li></template></ul>
    return (
      <ul data-bind-list="cart.items" fw-key="productId">
        <template fw-stamp>
          <li><span data-bind=".name">Item</span></li>
        </template>
      </ul>
    );
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

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
              { path: '.name', value: 'Item' },
              { path: '.qty', value: '0' },
            ],
            itemBindings: ['.name', '.qty'],
            key: 'productId',
            list: 'cart.items',
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
    expect(clientSource).toContain('html = html.replace("0", String(read("qty") ?? ""));');
    expect(clientSource).toContain('html = html.replace("Item", String(read("name") ?? ""));');
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

  it('lowers inline attribute expressions into compiled query update stamps', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: {} },
  render: () => (
    <cart-badge>
      <button disabled={cart.count === 0}>Checkout</button>
    </cart-badge>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain(
      'export const CartBadge$button_disabled_derive = derive(["cart"], (cart) => cart.count === 0);',
    );
    expect(serverSource).toContain(
      '<button data-derive="cart.CartBadge$button_disabled_derive" data-derive-attr="disabled">Checkout</button>',
    );
    expect(serverSource).not.toContain('disabled={cart.count === 0}');
    expect(result.queryUpdatePlans).toEqual([
      {
        componentName: 'CartBadge',
        paths: [],
        query: 'cart',
        stamps: [
          {
            attr: 'disabled',
            derive: {
              exportName: 'CartBadge$button_disabled_derive',
              expression: 'cart.count === 0',
              input: 'cart',
              name: 'CartBadge$button_disabled_derive',
              param: 'cart',
              selector: '[data-derive="cart.CartBadge$button_disabled_derive"]',
            },
            selector: '[data-derive="cart.CartBadge$button_disabled_derive"]',
          },
        ],
      },
    ]);
    expect(clientSource).toContain(
      "import { applyCompiledQueryUpdatePlan, derive } from '@jiso/runtime';",
    );
    expect(clientSource).toContain(
      'export const CartBadge$button_disabled_derive = derive(["cart"], (cart) => cart.count === 0);',
    );
    expect(clientSource).toContain(
      'stamps: [{ attr: "disabled", selector: "[data-derive=\\"cart.CartBadge$button_disabled_derive\\"]", select(value) { return CartBadge$button_disabled_derive.run(value); } }]',
    );
    expect(result.updateCoverage).not.toContainEqual(
      expect.objectContaining({ query: 'cart.count', status: 'UNHANDLED' }),
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('derives data-bind stamps for sole text-child query expressions', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: { cart: { count: 'number' } },
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: {} },
  render: () => (
    <cart-badge>
      <span>{cart.count}</span>
    </cart-badge>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('<span data-bind="cart.count">{cart.count}</span>');
    expect(result.queryUpdatePlans).toEqual([
      {
        componentName: 'CartBadge',
        paths: ['cart.count'],
        query: 'cart',
      },
    ]);
    expect(result.updateCoverage).toEqual([
      {
        componentName: 'CartBadge',
        detail: 'data-bind',
        position: 'binding',
        query: 'cart.count',
        status: 'plan',
      },
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(clientSource).toContain(
      'return applyCompiledQueryUpdatePlan(root, "cart", value, { bindings: true, derives: [], stamps: [], templateStamps: [] });',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('wraps mixed text query expressions in synthesized data-bind spans', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: { cart: { count: 'number' } },
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: {} },
  render: () => (
    <cart-badge>
      Total: {cart.count} items
    </cart-badge>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain('Total: <span data-bind="cart.count">{cart.count}</span> items');
    expect(result.queryUpdatePlans).toEqual([
      {
        componentName: 'CartBadge',
        paths: ['cart.count'],
        query: 'cart',
      },
    ]);
    expect(result.updateCoverage).toEqual([
      {
        componentName: 'CartBadge',
        detail: 'data-bind',
        position: 'binding',
        query: 'cart.count',
        status: 'plan',
      },
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('classifies query-dependent render positions for FW311 coverage', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: {}, product: {} },
  render: () => (
    <cart-badge>
      <span data-bind="cart.count">{cart.count}</span>
      <button data-bind:hidden="cart.empty">Checkout</button>
      <span>{renderOnce(cart.currency)}</span>
      <strong className={cart.discount}>Discount</strong>
      <em className={product.name}>Product</em>
    </cart-badge>
  ),
});
`,
    });

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
        detail: 'declared renderOnce',
        position: 'expression',
        query: 'cart.currency',
        status: 'renderOnce',
      },
      {
        componentName: 'CartBadge',
        detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
        position: 'expression',
        query: 'cart.discount',
        sourceSpan: { length: 13, start: 314 },
        status: 'UNHANDLED',
      },
      {
        componentName: 'CartBadge',
        detail: 'query expression has no data-bind, renderOnce, fragment, or isomorphic status',
        position: 'expression',
        query: 'product.name',
        sourceSpan: { length: 12, start: 368 },
        status: 'UNHANDLED',
      },
    ]);
    expect(result.diagnostics).toEqual([
      {
        code: 'FW223',
        fileName: 'cart-badge.tsx',
        length: 22,
        message:
          'Redundant hand-written binding stamp in sugar; the compiler derives it. data-bind="cart.count" wraps {cart.count}',
        severity: 'lint',
        start: { column: 13, line: 6 },
      },
      {
        code: 'FW311',
        fileName: 'cart-badge.tsx',
        length: 13,
        message:
          'Query-dependent DOM position has no update status. CartBadge cart.discount expression',
        severity: 'warn',
        start: { column: 26, line: 9 },
      },
      {
        code: 'FW311',
        fileName: 'cart-badge.tsx',
        length: 12,
        message:
          'Query-dependent DOM position has no update status. CartBadge product.name expression',
        severity: 'warn',
        start: { column: 22, line: 10 },
      },
    ]);
  });

  it('uses JSX element spans for template stamp placeholders instead of HTML regexes', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  render: () => (
    <ul data-bind-list="cart.items" fw-key="productId">
      <template fw-stamp>
        <li>
          <span data-bind=".qty">{'<span data-bind=".qty">wrong</span>'}</span>
          <span data-bind=".name">Item</span>
        </li>
      </template>
    </ul>
  ),
});
`,
    });
    const clientSource = result.files[1]?.source ?? '';

    expect(result.queryUpdatePlans[0]?.templateStamps?.[0]?.itemBindingPlaceholders).toEqual([
      { path: '.name', value: 'Item' },
      { path: '.qty', value: `{'<span data-bind=".qty">wrong</span>'}` },
    ]);
    expect(clientSource).toContain(
      `html = html.replace("{'<span data-bind=\\".qty\\">wrong</span>'}", String(read("qty") ?? ""));`,
    );
  });

  it('classifies query-dependent render positions as isomorphic when declared', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  isomorphic: true,
  queries: { cart: {} },
  render: () => (
    <cart-badge>
      <strong className={cart.discount}>Discount</strong>
    </cart-badge>
  ),
});
`,
    });

    expect(result.updateCoverage).toEqual([
      {
        componentName: 'CartBadge',
        detail: 'declared isomorphic island',
        position: 'expression',
        query: 'cart.discount',
        status: 'isomorphic',
      },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('ignores query declarations inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
const sample = 'queries: { fake: fakeQuery } <span>{fake.count}</span>';
// queries: { otherFake: otherFakeQuery } <span>{otherFake.count}</span>
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => <span>{renderOnce(cart.count)}</span>,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores query expressions inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
const sample = '<strong>{cart.discount}</strong><span>{renderOnce(cart.currency)}</span>';
// <em>{cart.total}</em>
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => <span>{renderOnce(cart.count)}</span>,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores query-looking text inside renderOnce string literals', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => <span>{renderOnce(cart.label ?? "cart.discount")}</span>,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.updateCoverage).toEqual([
      {
        componentName: 'CartBadge',
        detail: 'declared renderOnce',
        position: 'expression',
        query: 'cart.label',
        status: 'renderOnce',
      },
    ]);
  });

  it('emits an app bootstrap that wires compiled query plans into the loader', () => {
    const bootstrap = emitQueryPlanBootstrapModule([
      {
        exportName: 'CartBadge$queryUpdatePlans',
        importPath: '../components/cart/cart-badge.client.js',
      },
      {
        exportName: 'CartPanel$queryUpdatePlans',
        importPath: '../components/cart/cart-panel.client.js',
      },
    ]);

    expect(bootstrap.fileName).toBe('generated/app.client.js');
    expect(bootstrap.source).toContain(
      "import { applyDeferredStreamResponseToDom, createQueryStore, installJisoLoader } from '@jiso/runtime';",
    );
    expect(bootstrap.source).toContain(
      'import { CartBadge$queryUpdatePlans } from "../components/cart/cart-badge.client.js";',
    );
    expect(bootstrap.source).toContain(
      'import { CartPanel$queryUpdatePlans } from "../components/cart/cart-panel.client.js";',
    );
    expect(bootstrap.source).toContain('const queryPlans = {');
    expect(bootstrap.source).toContain('...CartBadge$queryUpdatePlans,');
    expect(bootstrap.source).toContain('...CartPanel$queryUpdatePlans,');
    expect(bootstrap.source).toContain('installJisoLoader({');
    expect(bootstrap.source).toContain('queryStore: store');
    expect(bootstrap.source).toContain('enhancedMutations: {');
    expect(bootstrap.source).toContain('queryPlans,');
    expect(bootstrap.source).toContain('export function applyJisoDeferredStreamResponse');
    expect(bootstrap.source).toContain('return applyDeferredStreamResponseToDom({');
    expect(bootstrap.source).toContain('queryPlans,');
    expect(bootstrap.source).toContain('store,');
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

  it('stamps fw-c component identity on native render hosts', () => {
    // SPEC.md section 4.2: identity is the fw-c stamp; the compiler omits it when
    // the host tag spells the component name and emits it explicitly on native hosts.
    const result = compileComponentModule({
      fileName: 'order-history.tsx',
      source: `
export const OrderHistory = component('order-history', {
  queries: { orderHistory: orderHistoryQuery },
  render: ({ orderHistory }) => (
    <ol>
      <li fw-key="order-1">Order</li>
    </ol>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain('<ol fw-c="order-history" fw-deps="orderHistory">');
    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('keeps hand-written fw-c stamps on native hosts unchanged in ejected IR', () => {
    // SPEC.md section 4.2 / Constitution #3: hand-written stamps remain valid input.
    const result = compileComponentModule({
      fileName: 'order-history.tsx',
      source: `
export const OrderHistory = component('order-history', {
  render: () => (
    <ol fw-c="order-history">
      <li fw-key="order-1">Order</li>
    </ol>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    expect(serverSource).toContain('<ol fw-c="order-history">');
    expect(serverSource.match(/fw-c=/g)).toHaveLength(1);
  });

  it('does not stamp query or state declarations from strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  render: () => {
    const sample = 'queries: { cart: cartQuery }, state: () => ({ open: true })';
    // queries: { product: productQuery }, state: () => ({ count: 1 })
    return <cart-badge>Static</cart-badge>;
  },
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    expect(serverSource).not.toContain('fw-deps=');
    expect(serverSource).not.toContain('fw-state=');
    expect(result.diagnostics).toEqual([]);
  });

  it('stamps the returned host instead of tag text inside render bodies', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  state: () => ({ open: true }),
  render: ({ cart }) => {
    const sample = '<not-the-host></not-the-host>';
    // <also-not-the-host></also-not-the-host>
    return <cart-badge>{renderOnce(cart.count)}</cart-badge>;
  },
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    expect(serverSource).toContain(
      '<cart-badge fw-deps="cart" fw-state="{&quot;open&quot;:true}">',
    );
    expect(serverSource).toContain("'<not-the-host></not-the-host>'");
    expect(serverSource).not.toContain('<not-the-host fw-deps=');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('merges declared query dependencies into existing fw-deps stamps', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      registryFacts: {
        queries: {
          product: 'typeof productQuery',
        },
      },
      source: `
export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section fw-c="recommendations" fw-deps="product:p1 cart">
      {renderOnce(cart.count)}
    </section>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain(
      '<section fw-c="recommendations" fw-deps="product:p1 cart">',
    );
    expect(result.diagnostics).toEqual([]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('validates residual fw-c and fw-deps stamps against known component and query facts', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      registryFacts: {
        queries: {
          product: 'typeof productQuery',
        },
      },
      source: `
export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section fw-c="recommendations" fw-deps="product:p1 cart">
      <span data-bind="cart.count">{cart.count}</span>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW223',
        fileName: 'recommendations.tsx',
        length: 22,
        message:
          'Redundant hand-written binding stamp in sugar; the compiler derives it. data-bind="cart.count" wraps {cart.count}',
        severity: 'lint',
        start: { column: 13, line: 6 },
      },
    ]);
  });

  it('reports FW222 and FW223 for hand-written stamps around typed expressions in sugar', () => {
    const redundant = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.count}</span>,
});
`,
    });
    const drift = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => <span data-bind="cart.count">{cart.total}</span>,
});
`,
    });

    expect(redundant.diagnostics).toEqual([
      {
        code: 'FW223',
        fileName: 'cart-badge.tsx',
        length: 22,
        message:
          'Redundant hand-written binding stamp in sugar; the compiler derives it. data-bind="cart.count" wraps {cart.count}',
        severity: 'lint',
        start: { column: 31, line: 4 },
      },
    ]);
    expect(drift.diagnostics).toEqual([
      {
        code: 'FW222',
        fileName: 'cart-badge.tsx',
        length: 22,
        message:
          'Hand-written binding stamp disagrees with the typed expression it wraps. data-bind="cart.count" wraps {cart.total}',
        severity: 'error',
        start: { column: 31, line: 4 },
      },
      {
        code: 'FW311',
        fileName: 'cart-badge.tsx',
        length: 10,
        message:
          'Query-dependent DOM position has no update status. CartBadge cart.total expression',
        severity: 'warn',
        start: { column: 55, line: 4 },
      },
    ]);
  });

  it('ignores binding stamp text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => {
    const sample = '<span data-bind="cart.count">{cart.count}</span>';
    // <span data-bind="cart.total">{cart.count}</span>
    return <span>{renderOnce(cart.count)}</span>;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('does not let self-closing same-name children hide list stamp diagnostics', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: {
        cart: {
          items: [{ productId: 'string' }],
        },
      },
      source: `
export const CartBadge = component('cart-badge', {
  render: () => (
    <ul data-bind-list="cart.items" fw-key="sku">
      <ul />
      <template fw-stamp>
        <li><span data-bind=".missing">Item</span></li>
      </template>
    </ul>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        {
          code: 'FW302',
          fileName: 'cart-badge.tsx',
          message: 'data-bind path is not present in the declared query shape. cart.items',
          severity: 'error',
          start: { column: 9, line: 4 },
          length: 27,
        },
      ]),
    );
  });

  it('reports FW231, FW232, and FW233 for residual attribute merge conflicts', () => {
    const result = compileComponentModule({
      fileName: 'primitive-merge.tsx',
      source: `
export const PrimitiveMerge = component('primitive-merge', {
  render: () => (
    <primitive-merge>
      <dialog id="drawer"></dialog>
      <dialog id="confirm"></dialog>
      <button commandfor="drawer" commandfor="confirm" data-p-id="one" data-p-id="two" fw-c="primitive-merge" fw-c="primitive-merge">Open</button>
      <button aria-expanded="false" aria-expanded="true" role="button" role="link" data-state="closed" data-state="open">Toggle</button>
      <span data-bind="cart.count" data-bind="cart.total" data-bind:hidden="cart.empty" data-bind:hidden="cart.loading">2</span>
    </primitive-merge>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW231',
        fileName: 'primitive-merge.tsx',
        length: 19,
        message: 'Unmergeable attribute conflict in primitive composition. commandfor',
        severity: 'error',
        start: { column: 15, line: 7 },
      },
      {
        code: 'FW231',
        fileName: 'primitive-merge.tsx',
        length: 15,
        message: 'Unmergeable attribute conflict in primitive composition. data-p-id',
        severity: 'error',
        start: { column: 56, line: 7 },
      },
      {
        code: 'FW231',
        fileName: 'primitive-merge.tsx',
        length: 22,
        message: 'Unmergeable attribute conflict in primitive composition. fw-c',
        severity: 'error',
        start: { column: 88, line: 7 },
      },
      {
        code: 'FW232',
        fileName: 'primitive-merge.tsx',
        length: 21,
        message: 'Author overrides a primitive-owned ARIA or state attribute. aria-expanded',
        severity: 'lint',
        start: { column: 15, line: 8 },
      },
      {
        code: 'FW232',
        fileName: 'primitive-merge.tsx',
        length: 13,
        message: 'Author overrides a primitive-owned ARIA or state attribute. role',
        severity: 'lint',
        start: { column: 58, line: 8 },
      },
      {
        code: 'FW232',
        fileName: 'primitive-merge.tsx',
        length: 19,
        message: 'Author overrides a primitive-owned ARIA or state attribute. data-state',
        severity: 'lint',
        start: { column: 84, line: 8 },
      },
      {
        code: 'FW233',
        fileName: 'primitive-merge.tsx',
        length: 22,
        message: 'Two writers target the same binding slot. data-bind',
        severity: 'error',
        start: { column: 13, line: 9 },
      },
      {
        code: 'FW233',
        fileName: 'primitive-merge.tsx',
        length: 29,
        message: 'Two writers target the same binding slot. data-bind:hidden',
        severity: 'error',
        start: { column: 59, line: 9 },
      },
    ]);
  });

  it('ignores attribute merge text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'primitive-merge.tsx',
      source: `
export const PrimitiveMerge = component('primitive-merge', {
  render: () => {
    const sample = '<button role="button" role="link"></button>';
    // <button data-state="closed" data-state="open"></button>
    return <button role="button">Open</button>;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports FW226 for residual stamps naming unknown components or query instances', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      source: `
export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  render: ({ cart }) => (
    <section fw-c="unknown-component" fw-deps="cart missingQuery:p1">
      <span data-bind="cart.count">{cart.count}</span>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW223',
        fileName: 'recommendations.tsx',
        length: 22,
        message:
          'Redundant hand-written binding stamp in sugar; the compiler derives it. data-bind="cart.count" wraps {cart.count}',
        severity: 'lint',
        start: { column: 13, line: 6 },
      },
      {
        code: 'FW226',
        fileName: 'recommendations.tsx',
        message:
          'fw-deps or fw-c names an unknown query instance or component. fw-c="unknown-component"',
        severity: 'error',
        start: { column: 14, line: 5 },
        length: 24,
      },
      {
        code: 'FW226',
        fileName: 'recommendations.tsx',
        message:
          'fw-deps or fw-c names an unknown query instance or component. fw-deps="missingQuery:p1"',
        severity: 'error',
        start: { column: 39, line: 5 },
        length: 30,
      },
    ]);
  });

  it('ignores residual stamp text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'recommendations.tsx',
      source: `
export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  render: ({ cart }) => {
    const sample = '<section fw-c="unknown-component" fw-deps="missingQuery:p1"></section>';
    // <section fw-c="other-unknown" fw-deps="otherMissing:p1"></section>
    return (
      <section fw-c="recommendations" fw-deps="cart">
        <span>{renderOnce(cart.count)}</span>
      </section>
    );
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
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

  it('preserves apostrophes while stamping static island-local state', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  state: () => ({ label: "it's ready", open: false }),
  render: () => <cart-badge>Ready</cart-badge>,
});
`,
    });

    expect(result.files[0]?.source).toContain(
      'fw-state="{&quot;label&quot;:&quot;it\'s ready&quot;,&quot;open&quot;:false}"',
    );
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
        start: { column: 17, line: 4 },
        length: 16,
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

    expect(result.diagnostics).toEqual([
      {
        code: 'FW301',
        fileName: 'account-menu.tsx',
        message: 'Server fact stored in island-local state.',
        severity: 'lint',
        start: { column: 17, line: 4 },
        length: 24,
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
  render: ({ cart }, state) => <span class={state.bouncing ? 'bounce' : ''}>{renderOnce(cart.count)}</span>,
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
        length: 22,
        message: 'data-bind path is not present in the declared query shape. cart.total',
        severity: 'error',
        start: { column: 23, line: 3 },
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
        start: { column: 22, line: 3 },
        length: 45,
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

  it('ignores event payload text inside strings and comments', () => {
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
const sample = "emit('cart:added', { product: { unitPrice: product.unitPrice } })";
// emit('cart:added', { product: { unitPrice: product.unitPrice } });
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
  render: ({ cart, rowId }) => <tr fw-c="cart-row" data-row={rowId}>{renderOnce(cart.count)}</tr>,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.files[2]?.source).toContain("'cart-row': { rowId: string };");
    expect(result.files[2]?.source).toContain(`interface FragmentTargets {
  'cart-row': { rowId: string };
  }`);
  });

  it('reports FW303 when fragment target render inputs cannot be rerendered from queries or stamped props', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component('cart-row', {
  fragmentTarget: true,
  queries: { cart: cartQuery },
  render: ({ cart, priceList }) => <tr fw-c="cart-row">{renderOnce(cart.count)}{priceList.version}</tr>,
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
        start: { column: 20, line: 5 },
        length: 9,
      },
    ]);
  });

  it('accepts fragment target children that can hoist through serializable props', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String },
  render: ({ rowId }) => <tr fw-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component('cart-table', {
  render: ({ cart }) => (
    <table>
      <CartRow rowId={cart.rowId}>
        <span>{cart.count}</span>
      </CartRow>
    </table>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports FW230 when fragment target children capture unserializable values', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String },
  render: ({ rowId }) => <tr fw-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component('cart-table', {
  render: ({ cart }) => (
    <table>
      <CartRow rowId={cart.rowId}>
        <span>{window.location.href}</span>
      </CartRow>
    </table>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW230',
        fileName: 'cart-row.tsx',
        help: [
          'Would hoist children to: CartRow$slot_children',
          'Blocked children: <span>{window.location.href}</span>',
          'Fixes: pass serializable props, move browser/request/db values behind a server fragment, or render children inside the fragment target itself.',
        ].join('\n'),
        message: 'Fragment-target children cannot lower to a component reference. CartRow',
        severity: 'error',
        start: { column: 9, line: 12 },
        length: 35,
      },
    ]);
  });

  it('does not report FW230 for local child variables named like non-serializable captures', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String },
  render: ({ rowId }) => <tr fw-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component('cart-table', {
  render: ({ cart }) => {
    return (
      <table>
        <CartRow rowId={cart.rowId}>
          <span>{(() => { const response = { label: 'ok' }; return response.label; })()}</span>
        </CartRow>
      </table>
    );
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores fragment target child text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String },
  render: ({ rowId }) => <tr fw-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component('cart-table', {
  render: ({ cart }) => {
    const sample = '<CartRow><span>{window.location.href}</span></CartRow>';
    // <CartRow><span>{request.url}</span></CartRow>
    return (
      <table>
        <CartRow rowId={cart.rowId}>
          <span>{cart.count}</span>
        </CartRow>
      </table>
    );
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores fragment target declarations inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
const sample = "export const CartRow = component('cart-row', { fragmentTarget: true, render: () => null });";
// export const OtherRow = component('other-row', { fragmentTarget: true, render: () => null });
export const CartTable = component('cart-table', {
  render: () => (
    <table>
      <CartRow>
        <span>{window.location.href}</span>
      </CartRow>
    </table>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores fragment target declarations inside strings and comments for graph facts', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
const sample = "export const CartRow = component('cart-row', { fragmentTarget: true, render: () => null });";
// export const OtherRow = component('other-row', { fragmentTarget: true, render: () => null });
export const CartTable = component('cart-table', {
  queries: { cart: {} },
  render: () => (
    <table>
      <CartRow>
        <span>{cart.count}</span>
      </CartRow>
    </table>
  ),
});
`,
    });

    expect(result.componentGraphFacts).toEqual([
      {
        name: 'CartTable',
        queries: ['cart'],
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
        start: { column: 5, line: 5 },
        length: 10,
      },
    ]);
  });

  it('reports FW330 for arrow mutation handlers that receive db directly', () => {
    const result = compileComponentModule({
      fileName: 'cart.mutation.ts',
      source: `
export const addToCart = mutation('cart/add', {
  input: addToCartInput,
  handler: async (input, db) => {
    await db.insert(cartItems).values(input);
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
        start: { column: 26, line: 4 },
        length: 2,
      },
    ]);
  });

  it('reports FW330 for every mutation handler with direct db access', () => {
    const result = compileComponentModule({
      fileName: 'cart.mutation.ts',
      source: `
export const addToCart = mutation('cart/add', {
  input: addToCartInput,
  handler(input, request) {
    request.db.insert(cartItems).values(input);
  },
});

export const clearCart = mutation('cart/clear', {
  input: clearCartInput,
  handler(input, db) {
    db.delete(cartItems);
  },
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW330',
        fileName: 'cart.mutation.ts',
        length: 10,
        message: 'Direct db access in a mutation handler; route through domain.',
        severity: 'lint',
        start: { column: 5, line: 5 },
      },
      {
        code: 'FW330',
        fileName: 'cart.mutation.ts',
        length: 2,
        message: 'Direct db access in a mutation handler; route through domain.',
        severity: 'lint',
        start: { column: 18, line: 11 },
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

  it('ignores mutation handler text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart.mutation.ts',
      source: `
const sample = "export const bad = mutation('cart/add', { handler(input, request) { request.db.insert(cartItems).values(input); } });";
// export const bad = mutation('cart/add', { handler(input, db) { db.insert(cartItems).values(input); } });
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

  it('throws registry-error diagnostics from the Vite transform with teaching text', () => {
    const onModuleDiagnostics = vi.fn();
    const plugin = createJisoVitePlugin(
      () => ({
        diagnostics: [
          {
            code: 'FW201',
            fileName: 'src/bad.tsx',
            help: [
              'Would lower to: on:click="/c/src/bad.client.js#Bad$button_click"',
              'Fixes: move the value into component/query state via ctx.',
            ].join('\n'),
            message: 'Closure captures unserializable value.',
            severity: 'lint',
            start: { line: 3, column: 12 },
          },
        ],
        files: [
          { kind: 'server', source: 'export function renderSource() {}' },
          { kind: 'client', source: 'export const Bad$button_click = () => null;' },
        ],
      }),
      { onModuleDiagnostics },
    );

    let thrown: unknown;
    try {
      plugin.transform('component(', 'src/bad.tsx');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      [
        'Jiso Vite transform failed with 1 error diagnostic.',
        [
          'FW201 src/bad.tsx:3:12 Closure captures unserializable value.',
          '  help: Would lower to: on:click="/c/src/bad.client.js#Bad$button_click"',
          '  help: Fixes: move the value into component/query state via ctx.',
        ].join('\n'),
      ].join('\n\n'),
    );
    expect(onModuleDiagnostics).toHaveBeenCalledWith({
      diagnostics: [
        expect.objectContaining({
          code: 'FW201',
          fileName: 'src/bad.tsx',
          message: 'Closure captures unserializable value.',
        }),
      ],
      fileName: 'src/bad.tsx',
      source: 'component(',
    });
  });

  it('reports warn, lint, and notice diagnostics without blocking the Vite transform', () => {
    const onDiagnostic = vi.fn();
    const plugin = createJisoVitePlugin(
      () => ({
        diagnostics: [
          {
            code: 'FW311',
            fileName: 'src/diagnostics.tsx',
            message: 'Query-dependent DOM position has no update status.',
            severity: 'error',
            start: { line: 4, column: 9 },
          },
          {
            code: 'FW210',
            fileName: 'src/diagnostics.tsx',
            message: 'Anonymous handler; name it for stable identity.',
            severity: 'error',
            start: { line: 5, column: 11 },
          },
          {
            code: 'FW409',
            fileName: 'src/diagnostics.tsx',
            message: 'Non-eq predicate degraded to table-level invalidation.',
            severity: 'error',
            start: { line: 6, column: 13 },
          },
        ],
        files: [
          { kind: 'server', source: 'export function renderSource() {}' },
          { kind: 'client', source: 'export const Diagnostics$button_click = () => null;' },
        ],
      }),
      { onDiagnostic },
    );

    expect(plugin.transform('component(', 'src/diagnostics.tsx')).toEqual({
      code: 'export function renderSource() {}',
      map: null,
    });
    expect(onDiagnostic).toHaveBeenCalledTimes(3);
    expect(onDiagnostic.mock.calls.map(([diagnostic]) => diagnostic.code)).toEqual([
      'FW311',
      'FW210',
      'FW409',
    ]);
  });

  it('serves emitted client modules from Vite dev middleware', () => {
    const plugin = jisoVitePlugin();
    const middlewares: JisoViteMiddleware[] = [];
    plugin.configureServer?.({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });

    const transformed = plugin.transform?.(cartBadgeSource, 'components/cart/cart-badge.tsx');
    const clientRef = transformed?.code.match(
      /\/c\/components\/cart\/cart-badge\.client\.js\?v=[0-9a-f]{8}/,
    )?.[0];
    expect(clientRef).toBeDefined();
    const res = {
      body: '',
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      end(body: string) {
        this.body = body;
      },
    };
    const next = vi.fn();

    middlewares[0]?.({ url: clientRef ?? '' }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.headers['Content-Type']).toBe('text/javascript');
    expect(res.body).toContain('export const CartBadge$button_click');
    expect(res.body).toContain('return removeItem(ctx.state, ctx.params.id);');
  });

  it('serves project-relative client modules when Vite passes absolute ids', () => {
    const plugin = jisoVitePlugin();
    const middlewares: JisoViteMiddleware[] = [];
    plugin.configureServer?.({
      config: { root: '/workspace/app' },
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });

    const transformed = plugin.transform?.(
      cartBadgeSource,
      '/workspace/app/src/components/cart/cart-badge.tsx',
    );
    const clientRef = transformed?.code.match(
      /\/c\/src\/components\/cart\/cart-badge\.client\.js\?v=[0-9a-f]{8}/,
    )?.[0];
    expect(clientRef).toBeDefined();
    expect(transformed?.code).not.toContain('/c/workspace/app/');

    const res = {
      body: '',
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      end(body: string) {
        this.body = body;
      },
    };

    middlewares[0]?.({ url: clientRef ?? '' }, res, vi.fn());

    expect(res.body).toContain('export const CartBadge$button_click');
  });

  it('retains old versioned client modules after a newer transform', () => {
    const plugin = jisoVitePlugin();
    const middlewares: JisoViteMiddleware[] = [];
    const source = (handler: string) => `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  render: () => <button onClick={${handler}}>Add</button>,
});
`;
    plugin.configureServer?.({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });

    const first = plugin.transform?.(source('removeItem'), 'components/cart/cart-badge.tsx');
    const oldClientRef = first?.code.match(
      /\/c\/components\/cart\/cart-badge\.client\.js\?v=[0-9a-f]{8}/,
    )?.[0];
    const second = plugin.transform?.(source('clearCart'), 'components/cart/cart-badge.tsx');
    const newClientRef = second?.code.match(
      /\/c\/components\/cart\/cart-badge\.client\.js\?v=[0-9a-f]{8}/,
    )?.[0];
    const oldResponse = createMiddlewareResponse();
    const newResponse = createMiddlewareResponse();

    expect(oldClientRef).toBeDefined();
    expect(newClientRef).toBeDefined();
    expect(newClientRef).not.toBe(oldClientRef);

    middlewares[0]?.({ url: oldClientRef ?? '' }, oldResponse, vi.fn());
    middlewares[0]?.({ url: newClientRef ?? '' }, newResponse, vi.fn());

    expect(oldResponse.body).toContain('return removeItem(event, ctx);');
    expect(newResponse.body).toContain('return clearCart(event, ctx);');
  });

  it('passes through unknown Vite dev middleware requests', () => {
    const plugin = jisoVitePlugin();
    const middlewares: JisoViteMiddleware[] = [];
    plugin.configureServer?.({
      middlewares: {
        use(handler) {
          middlewares.push(handler);
        },
      },
    });
    const res = {
      end: vi.fn(),
      setHeader: vi.fn(),
    };
    const next = vi.fn();

    middlewares[0]?.({ url: '/src/app.tsx' }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.end).not.toHaveBeenCalled();
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
      '[fw-c="cart-badge"] .count:not([fw-c]):not([fw-c] *) { color: red; }\n[fw-c="cart-badge"] button:not([fw-c]):not([fw-c] *), [fw-c="cart-badge"] a:not([fw-c]):not([fw-c] *) { color: blue; }',
    );
  });

  it('prefixes component CSS fallback selectors inside conditional at-rules', () => {
    const result = scopeComponentCss(
      '[fw-c="cart-badge"]',
      '@media (min-width: 40rem) { .count { color: red; } button, a { color: blue; } }',
    );

    expect(result.fallback).toBe(
      '@media (min-width: 40rem) { [fw-c="cart-badge"] .count:not([fw-c]):not([fw-c] *) { color: red; } [fw-c="cart-badge"] button:not([fw-c]):not([fw-c] *), [fw-c="cart-badge"] a:not([fw-c]):not([fw-c] *) { color: blue; } }',
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
        criticalCss: expect.stringContaining('@scope (cart-badge) to (:scope [fw-c])'),
        fragmentTargets: [],
        href: '/_jiso/components/cart/cart-badge.css',
        sourceFileName: 'components/cart/cart-badge.css',
      },
      {
        componentName: 'CartDrawer',
        criticalCss: expect.stringContaining('@scope ([fw-c="cart-drawer"]) to (:scope [fw-c])'),
        fragmentTargets: [],
        href: '/_jiso/components/cart/cart-drawer.css',
        sourceFileName: 'components/cart/cart-drawer.css',
      },
    ]);
    expect(selectCssAssets(manifest, ['components/cart/cart-drawer.css'])).toEqual([
      {
        componentName: 'CartDrawer',
        criticalCss: expect.stringContaining('@scope ([fw-c="cart-drawer"]) to (:scope [fw-c])'),
        fragmentTargets: [],
        href: '/_jiso/components/cart/cart-drawer.css',
        sourceFileName: 'components/cart/cart-drawer.css',
      },
    ]);
  });

  it('preserves fragment target metadata in collected CSS manifests', () => {
    const cartBadge = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  fragmentTarget: true,
  styles: \`
    .count { color: teal; }
  \`,
  render: () => <cart-badge><span class="count">1</span></cart-badge>,
});
`,
    });

    expect(collectCssAssetManifest(cartBadge).stylesheets).toEqual([
      {
        componentName: 'CartBadge',
        criticalCss: expect.stringContaining('@scope (cart-badge) to (:scope [fw-c])'),
        fragmentTargets: ['cart-badge'],
        href: '/assets/components/cart/cart-badge.css',
        sourceFileName: 'components/cart/cart-badge.css',
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
        criticalCss: expect.stringContaining('@scope ([fw-c="reviews"]) to (:scope [fw-c])'),
        fragmentTargets: [],
        href: '/assets/components/reviews.css',
        preload: false,
        sourceFileName: './components/reviews.css',
      },
    ]);
  });
});
