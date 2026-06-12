import { describe, expect, it } from 'vitest';

import { assertFixpoint, assertRenderEquivalence, compileComponentModule } from './index.js';
import { renderEquivalenceCheck } from './emit/server.js';
import { compileFixture } from './test-support.js';

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
    const result = compileFixture({
      fileName: 'components/cart/cart-badge.tsx',
      source: cartBadgeSource,
    });
    const { client, registry, server } = result.filesByKind;

    expect(result.files.map((file) => file.fileName)).toEqual([
      'components/cart/cart-badge.server.js',
      'components/cart/cart-badge.client.js',
      'generated/registries.d.ts',
    ]);
    expect(client?.source).toContain('export const CartBadge$button_click');
    expect(client?.source).toContain('return removeItem(ctx.state, ctx.params.id);');
    expect(client?.source).toContain('import { applyCompiledQueryUpdatePlan, handler }');
    expect(client?.source).toContain('export const CartBadge$queryUpdatePlans');
    expectHandlerRef(
      server?.source ?? '',
      '/c/components/cart/cart-badge.client.js',
      'CartBadge$button_click',
    );
    expect(server?.source).toContain('data-p-id="{item.id}"');
    expect(registry?.source).toContain(
      "'#cart-badge': typeof import('../components/cart/cart-badge.client.js');",
    );
    expect(registry?.source).toContain("'cart-badge': {};");
    expect(registry?.source).toContain("'CartBadge:cart': readonly ['cart.count'];");
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('emits scoped CSS artifacts for static co-located component CSS', () => {
    const result = compileFixture({
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
    const { client, css, registry, server } = result.filesByKind;

    expect(result.files.map((file) => file.fileName)).toEqual([
      'components/cart/cart-badge.server.js',
      'components/cart/cart-badge.client.js',
      'components/cart/cart-badge.css',
      'generated/registries.d.ts',
    ]);
    expect(css?.source).toBe(
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
    expect(server?.source).toContain('export function renderSource()');
    expect(client?.source).toContain('// no client handlers emitted');
    expect(registry?.source).toContain("'cart-badge': {};");
    expect(registry?.source).toContain(
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
    const result = compileFixture({
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

    expect(result.filesByKind.css?.source).toContain(
      '@scope ([fw-c="cart-row"]) to (:scope [fw-c])',
    );
    expect(result.filesByKind.css?.source).toContain(
      '[fw-c="cart-row"] td:not([fw-c]):not([fw-c] *) { padding: 0.5rem; }',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('scopes CSS to the returned host instead of tag text inside render bodies', () => {
    const result = compileFixture({
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

    const cssSource = result.filesByKind.css?.source ?? '';
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
    const result = compileFixture({
      fileName: 'components/cart/cart-badge.tsx',
      source: cartBadgeSource,
    });

    const registry = result.filesByKind.registry?.source ?? '';
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

  it('reports FW235 for app-authored renderSource modules from the parser model', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.server.ts',
      source: `
export function renderSource() {
  return '<cart-badge><span>2</span></cart-badge>';
}
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW235',
        fileName: 'cart-badge.server.ts',
        help: [
          'SPEC §5.2: TSX is the sole app-authoring surface. Write JSX with typed expressions and let the compiler emit renderSource(), fw-c, fw-deps, and data-bind.',
          'TSX equivalent direction: render with JSX, for example `render: (...) => (<cart-badge>...</cart-badge>)`, and use typed expressions such as `{cart.count}` instead of data-bind strings.',
        ].join('\n'),
        length: 41,
        message:
          'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.',
        severity: 'error',
        start: { column: 10, line: 3 },
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
});
