import { diagnosticDefinitions } from '@jiso/core';
import { describe, expect, it } from 'vitest';

import {
  assertFixpoint,
  assertRenderEquivalence,
  collectMinifierReservedNames,
  compileComponentModule,
} from './index.js';
import { renderEquivalenceCheck } from './emit/server.js';

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

const fw210 = diagnosticDefinitions.FW210;

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
        message: fw210.message,
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
        message: fw210.message,
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
});
