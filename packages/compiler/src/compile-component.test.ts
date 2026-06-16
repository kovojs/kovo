import { describe, expect, it } from 'vitest';

import { assertFixpoint, assertRenderEquivalence, compileComponentModule } from './index.js';
import {
  emitServerModule,
  renderEquivalenceCheck,
  semanticRenderEquivalenceCheck,
} from './emit/server.js';
import { parseComponentModule } from './scan/parse.js';
import { compileFixture } from './test-support.js';

const cartBadgeSource = `
import { component } from '@kovojs/core';

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
    expect(result.loweredSource).toContain('data-p-id="{item.id}"');
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
import { component } from '@kovojs/core';

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
        '/* @kovojs-ir */',
        '/* @kovojs-scope-fallback */',
        'cart-badge button:not([kovo-c]):not([kovo-c] *) { color: teal; }',
        'cart-badge .count:not([kovo-c]):not([kovo-c] *) { font-weight: 700; }',
        '',
        '@scope (cart-badge) to (:scope [kovo-c]) {',
        '  button { color: teal; }',
        '      .count { font-weight: 700; }',
        '}',
        '',
      ].join('\n'),
    );
    expect(result.cssAssets).toEqual([
      {
        componentName: 'CartBadge',
        criticalCss: expect.stringContaining('@scope (cart-badge) to (:scope [kovo-c])'),
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
    expect(result.loweredSource).toContain('export const CartBadge = component');
    expect(result.renderEquivalenceChecks).toHaveLength(1);
    expect(result.renderEquivalenceChecks[0]).toMatchObject({
      artifact: 'components/cart/cart-badge.server.js',
      ok: true,
    });
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

  it('executes generated renderSource for render-equivalence checks', () => {
    const expected = '<cart-badge>u0032</cart-badge>';
    const executableSource = [
      '// @kovojs-ir',
      'function renderSource() {',
      '  return `<cart-badge>\\u0032</cart-badge>`;',
      '}',
      '',
    ].join('\n');

    const check = renderEquivalenceCheck(
      'components/cart/cart-badge.server.js',
      expected,
      executableSource,
    );

    expect(check).toEqual({
      actual: '<cart-badge>2</cart-badge>',
      artifact: 'components/cart/cart-badge.server.js',
      expected,
      ok: false,
    });
  });

  it('fails the semantic render differential when visible HTML drifts', () => {
    const expectedSource = `
import { component } from '@kovojs/core';

export const CartBadge = component('cart-badge', {
  render: () => <cart-badge><span>2</span></cart-badge>,
});
`;
    const actualSource = `
import { component } from '@kovojs/core';

export const CartBadge = component('cart-badge', {
  render: () => <cart-badge><span>3</span></cart-badge>,
});
`;

    const check = semanticRenderEquivalenceCheck(
      'components/cart/cart-badge.server.js',
      parseComponentModule('components/cart/cart-badge.tsx', expectedSource),
      emitServerModule(actualSource).executableSource,
    );

    expect(check).toEqual({
      actual: '<cart-badge><span>3</span></cart-badge>',
      artifact: 'components/cart/cart-badge.server.js',
      detail:
        'SPEC §5.2 semantic render differential: render(src) differed from render(compile(src)).',
      expected: '<cart-badge><span>2</span></cart-badge>',
      ok: false,
    });
  });

  it('allows generated-only semantic render attributes', () => {
    const expectedSource = `
import { component } from '@kovojs/core';

export const CartBadge = component('cart-badge', {
  queries: { cart: {} },
  render: ({ cart }) => (
    <cart-badge>
      <button onClick={() => save(cart.id)}>Save</button>
      <span>{cart.count}</span>
    </cart-badge>
  ),
});
`;
    const actualSource = `
import { component } from '@kovojs/core';

export const CartBadge = component('cart-badge', {
  queries: { cart: {} },
  render: ({ cart }) => (
    <cart-badge kovo-deps="cart" kovo-state="{&quot;open&quot;:true}">
      <button on:click="/c/cart.client.js#CartBadge$button_click" kovo-param-types="id:string" data-p-id="{cart.id}">Save</button>
      <span data-bind="cart.count">{cart.count}</span>
    </cart-badge>
  ),
});
`;

    const check = semanticRenderEquivalenceCheck(
      'components/cart/cart-badge.server.js',
      parseComponentModule('components/cart/cart-badge.tsx', expectedSource),
      emitServerModule(actualSource).executableSource,
    );

    expect(check.ok).toBe(true);
    expect(check.expected).toBe(check.actual);
  });

  it('scopes native-host component CSS to the kovo-c identity stamp', () => {
    const result = compileFixture({
      fileName: 'components/cart/cart-row.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartRow = component('cart-row', {
  styles: \`
    td { padding: 0.5rem; }
  \`,
  render: () => <tr kovo-c="cart-row"><td>p1</td></tr>,
});
`,
    });

    expect(result.filesByKind.css?.source).toContain(
      '@scope ([kovo-c="cart-row"]) to (:scope [kovo-c])',
    );
    expect(result.filesByKind.css?.source).toContain(
      '[kovo-c="cart-row"] td:not([kovo-c]):not([kovo-c] *) { padding: 0.5rem; }',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('scopes CSS to the returned host instead of tag text inside render bodies', () => {
    const result = compileFixture({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartBadge = component('cart-badge', {
  css: \`
    button { color: teal; }
  \`,
  render: () => {
    const sample = '<cart-badge></cart-badge>';
    // <also-not-the-host></also-not-the-host>
    return <section kovo-c="cart-badge"><button>1</button></section>;
  },
});
`,
    });

    const cssSource = result.filesByKind.css?.source ?? '';
    expect(cssSource).toContain('@scope ([kovo-c="cart-badge"]) to (:scope [kovo-c])');
    expect(cssSource).toContain(
      '[kovo-c="cart-badge"] button:not([kovo-c]):not([kovo-c] *) { color: teal; }',
    );
    expect(cssSource).not.toContain('@scope (cart-badge)');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('does not discover component CSS from css-looking render text', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@kovojs/core';

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
    expect(registry).toContain(`declare module '@kovojs/core' {
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

  it('reports KV235 for app-authored string-rendered component modules', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => \`<cart-badge kovo-deps="cart"><span data-bind="cart.count">\${cart.count}</span></cart-badge>\`,
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV235',
        fileName: 'cart-badge.tsx',
        help: expect.stringContaining(
          'TSX equivalent direction: render with JSX, for example `render: (...) => (<cart-badge>...</cart-badge>)`, and use typed expressions such as `{cart.count}` instead of data-bind strings.',
        ),
        length: 93,
        message:
          'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.',
        severity: 'error',
        start: { column: 25, line: 4 },
      },
    ]);
  });

  it('reports KV235 for app-authored renderSource modules from the parser model', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.server.ts',
      source: `
export function renderSource() {
  return '<cart-badge><span>2</span></cart-badge>';
}
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV235',
        fileName: 'cart-badge.server.ts',
        help: expect.stringContaining(
          'TSX equivalent direction: render with JSX, for example `render: (...) => (<cart-badge>...</cart-badge>)`, and use typed expressions such as `{cart.count}` instead of data-bind strings.',
        ),
        length: 41,
        message:
          'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.',
        severity: 'error',
        start: { column: 10, line: 3 },
      },
    ]);
  });

  it('reports KV235 for tagless app-authored string-rendered component modules', () => {
    const result = compileComponentModule({
      fileName: 'total-display.tsx',
      source: `
export const TotalDisplay = component('total-display', {
  render: () => \`Total items\`,
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV235',
        fileName: 'total-display.tsx',
        help: expect.stringContaining(
          'TSX equivalent direction: render with JSX and use typed expressions such as `{cart.count}` instead of data-bind strings.',
        ),
        length: 13,
        message:
          'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.',
        severity: 'error',
        start: { column: 17, line: 3 },
      },
    ]);
  });

  it('reports KV235 for tagless app-authored renderSource modules', () => {
    const result = compileComponentModule({
      fileName: 'total-display.server.ts',
      source: `
export function renderSource() {
  return 'Total: 2';
}
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV235',
        fileName: 'total-display.server.ts',
        help: expect.stringContaining(
          'TSX equivalent direction: render with JSX and use typed expressions such as `{cart.count}` instead of data-bind strings.',
        ),
        length: 10,
        message:
          'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.',
        severity: 'error',
        start: { column: 10, line: 3 },
      },
    ]);
  });

  it('reports KV235 for app-authored compiler IR through the header fast path', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.server.js',
      source: [
        '// @kovojs-ir',
        'export function renderSource() {',
        '  return `<cart-badge><span>2</span></cart-badge>`;',
        '}',
        '',
      ].join('\n'),
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV235',
        fileName: 'cart-badge.server.js',
        help: expect.stringContaining(
          'TSX equivalent direction: render with JSX and use typed expressions such as `{cart.count}` instead of data-bind strings.',
        ),
        length: 13,
        message:
          'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.',
        severity: 'error',
        start: { column: 1, line: 1 },
      },
    ]);
    expect(result.files).toEqual([
      {
        fileName: 'cart-badge.server.js',
        kind: 'server',
        source: [
          '// @kovojs-ir',
          'export function renderSource() {',
          '  return `<cart-badge><span>2</span></cart-badge>`;',
          '}',
          '',
        ].join('\n'),
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
