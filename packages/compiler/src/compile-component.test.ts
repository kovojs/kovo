import { describe, expect, it } from 'vitest';

import { assertFixpoint, assertRenderEquivalence, compileComponentModule } from './index.js';
import { emitServerModule, semanticRenderEquivalenceCheck } from './emit/server.js';
import { parseComponentModule } from './scan/parse.js';
import { compileFixture } from './test-support.js';

const cartBadgeSource = `
import { component } from '@kovojs/core';

export const CartBadge = component({
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
    expect(result.loweredSource).toContain(
      'CartBadge.name = "components/cart/cart-badge/cart-badge";',
    );
    expect(result.loweredSource).toContain(
      "import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';",
    );
    expect(result.loweredSource)
      .toContain(`export const CartBadge$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: CartBadge,
  componentId: "components/cart/cart-badge/cart-badge",
}));`);
    expect(registry?.source).toContain(
      "'#cart-badge': typeof import('../components/cart/cart-badge.client.js');",
    );
    expect(registry?.source).toContain("'components/cart/cart-badge/cart-badge': {};");
    expect(registry?.source).toContain(`export interface ComponentRegistry {
  'components/cart/cart-badge/cart-badge': import('@kovojs/core').Component<import('@kovojs/core').ComponentDefinitionInput>;
}`);
    expect(registry?.source).toContain("'CartBadge:cart': readonly ['cart.count'];");
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('removes adjacent client-only named imports without overlapping server cleanup edits', () => {
    const result = compileComponentModule({
      fileName: 'components/gallery/meter-demo.tsx',
      source: `
/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  meterRootAttributes,
  meterValueState as _meterValueState,
  type MeterDataState,
} from '@kovojs/headless-ui/primitives';

export interface GalleryMeterDemoState {
  dataState: MeterDataState;
  value: number;
}

export const GalleryMeterDemo = component({
  state: () => ({ dataState: 'suboptimum' as MeterDataState, value: 72 }),
  render: (_queries: Record<string, never>, state: GalleryMeterDemoState) => (
    <section>
      <meter
        data-state={state.dataState}
        value={state.value}
      />
      <button
        type="button"
        onClick={() => {
          state.dataState = _meterValueState({ value: state.value }).state;
        }}
      >
        Optimize capacity
      </button>
    </section>
  ),
});
`,
    });

    const server = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.every((diagnostic) => diagnostic.code === 'KV210')).toBe(true);
    expect(server).not.toContain('meterRootAttributes');
    expect(server).not.toContain('meterValueState as _meterValueState');
    expect(server).toContain('type MeterDataState');
  });

  it('emits scoped CSS artifacts for static co-located component CSS', () => {
    const result = compileFixture({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartBadge = component({
  queries: { cart: {} },
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
    expect(result.cssAssets).toMatchInlineSnapshot(`
      [
        {
          "componentName": "cart-badge",
          "criticalCss": "/* @kovojs-ir */
      /* @kovojs-scope-fallback */
      cart-badge button:not([kovo-c]):not([kovo-c] *) { color: teal; }
      cart-badge .count:not([kovo-c]):not([kovo-c] *) { font-weight: 700; }

      @scope (cart-badge) to (:scope [kovo-c]) {
        button { color: teal; }
            .count { font-weight: 700; }
      }
      ",
          "cspHash": "sha256-VMQASrbporv43Ur8CvstaEAqVxE88nOkUzGLaMN8P2s=",
          "fragmentTargets": [
            "components/cart/cart-badge/cart-badge",
          ],
          "href": "/assets/components/cart/cart-badge.css",
          "sourceFileName": "components/cart/cart-badge.css",
        },
      ]
    `);
    expect(server?.source).toContain('export function renderSource()');
    expect(client?.source).toContain('// no client handlers emitted');
    expect(registry?.source).toContain("'components/cart/cart-badge/cart-badge': {};");
    expect(registry?.source).toContain(
      "'cart-badge': { href: '/assets/components/cart/cart-badge.css'; sourceFileName: 'components/cart/cart-badge.css'; fragmentTargets: readonly ['components/cart/cart-badge/cart-badge']; };",
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

  it('executes generated renderSource for semantic render-equivalence checks', () => {
    const expectedSource = `
import { component } from '@kovojs/core';

export const CartBadge = component({
  render: () => <cart-badge>u0032</cart-badge>,
});
`;
    const executableSource = [
      '// @kovojs-ir',
      'function renderSource() {',
      '  return `',
      "import { component } from '@kovojs/core';",
      '',
      'export const CartBadge = component({',
      '  render: () => <cart-badge>\\u0032</cart-badge>,',
      '});',
      '`;',
      '}',
      '',
    ].join('\n');

    const check = semanticRenderEquivalenceCheck(
      'components/cart/cart-badge.server.js',
      parseComponentModule('components/cart/cart-badge.tsx', expectedSource),
      executableSource,
    );

    expect(check).toMatchObject({
      actual: '<cart-badge>2</cart-badge>',
      artifact: 'components/cart/cart-badge.server.js',
      expected: '<cart-badge>u0032</cart-badge>',
      ok: false,
    });
  });

  it('fails the semantic render differential when visible HTML drifts', () => {
    const expectedSource = `
import { component } from '@kovojs/core';

export const CartBadge = component({
  render: () => <cart-badge><span>2</span></cart-badge>,
});
`;
    const actualSource = `
import { component } from '@kovojs/core';

export const CartBadge = component({
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

export const CartBadge = component({
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

export const CartBadge = component({
  queries: { cart: {} },
  render: ({ cart }) => (
    <cart-badge kovo-deps="cart" kovo-state="{&quot;open&quot;:true}">
      <button on:click="/c/cart.client.js#CartBadge$button_click" kovo-param-types="id:string" data-p-id="{cart.id}" commandfor="cart-dialog" command="show-modal" popovertarget="cart-popover" popovertargetaction="toggle">Save</button>
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

  it('compares lowered server output against authored Link semantics', () => {
    const result = compileComponentModule({
      fileName: 'components/product-link.tsx',
      source: `
import { component } from '@kovojs/core';

export const ProductLink = component({
  render: () => (
    <Link to="/products/:id" params={{ id: 'p1' }} search={{ tab: 'details' }}>Product</Link>
  ),
});
`,
    });

    expect(result.renderEquivalenceChecks[0]).toMatchObject({
      actual: '<a href="/products/p1?tab=details">Product</a>',
      expected: '<a href="/products/p1?tab=details">Product</a>',
      ok: true,
    });
  });

  it('fails the semantic render differential when Link href lowering drifts', () => {
    const expectedSource = `
import { component } from '@kovojs/core';

export const ProductLink = component({
  render: () => <Link to="/products/:id" params={{ id: 'p1' }}>Product</Link>,
});
`;
    const actualSource = `
import { component } from '@kovojs/core';

export const ProductLink = component({
  render: () => <a href="/products/p2">Product</a>,
});
`;

    const check = semanticRenderEquivalenceCheck(
      'components/product-link.server.js',
      parseComponentModule('components/product-link.tsx', expectedSource),
      emitServerModule(actualSource).executableSource,
    );

    expect(check).toMatchObject({
      actual: '<a href="/products/p2">Product</a>',
      expected: '<a href="/products/p1">Product</a>',
      ok: false,
    });
  });

  it('fails the semantic render differential when viewTransitionName style lowering drifts', () => {
    const expectedSource = `
import { component } from '@kovojs/core';

export const ProductImage = component({
  render: () => <img style="opacity: .8" viewTransitionName="product-p1" src="/p1.png" />,
});
`;
    const actualSource = `
import { component } from '@kovojs/core';

export const ProductImage = component({
  render: () => <img style="opacity: .8; view-transition-name: product-p2" src="/p1.png" />,
});
`;

    const check = semanticRenderEquivalenceCheck(
      'components/product-image.server.js',
      parseComponentModule('components/product-image.tsx', expectedSource),
      emitServerModule(actualSource).executableSource,
    );

    expect(check).toMatchObject({
      actual: '<img style="opacity: .8; view-transition-name: product-p2" src="/p1.png">',
      expected: '<img style="opacity: .8; view-transition-name: product-p1" src="/p1.png">',
      ok: false,
    });
  });

  it('fails visible mixed text drift while allowing generated data-bind spans', () => {
    const expectedSource = `
import { component } from '@kovojs/core';

export const CartLine = component({
  queries: { cart: {} },
  render: ({ cart }) => <p>Hello {cart.name}<strong>!</strong></p>,
});
`;
    const actualSource = `
import { component } from '@kovojs/core';

export const CartLine = component({
  queries: { cart: {} },
  render: ({ cart }) => <p>Hello <span data-bind="cart.name">{cart.name}</span><strong>?</strong></p>,
});
`;

    const check = semanticRenderEquivalenceCheck(
      'components/cart-line.server.js',
      parseComponentModule('components/cart-line.tsx', expectedSource),
      emitServerModule(actualSource).executableSource,
    );

    expect(check).toMatchObject({
      actual: '<p>Hello <span>{cart.name}</span><strong>?</strong></p>',
      expected: '<p>Hello {cart.name}<strong>!</strong></p>',
      ok: false,
    });
  });

  it('allows only generated handler/server stamps while preserving visible attributes', () => {
    const expectedSource = `
import { component } from '@kovojs/core';

export const SaveButton = component({
  render: () => <button type="button">Save</button>,
});
`;
    const generatedOnlySource = `
import { component } from '@kovojs/core';

export const SaveButton = component({
  render: () => <button type="button" on:click="/c/save.client.js#save" data-p-id="p1" kovo-c="save-button" kovo-deps="cart" kovo-state="{&quot;open&quot;:true}">Save</button>,
});
`;
    const visibleDriftSource = `
import { component } from '@kovojs/core';

export const SaveButton = component({
  render: () => <button type="submit" on:click="/c/save.client.js#save" data-p-id="p1" kovo-c="save-button">Save</button>,
});
`;

    const generatedOnly = semanticRenderEquivalenceCheck(
      'components/save-button.server.js',
      parseComponentModule('components/save-button.tsx', expectedSource),
      emitServerModule(generatedOnlySource).executableSource,
    );
    const visibleDrift = semanticRenderEquivalenceCheck(
      'components/save-button.server.js',
      parseComponentModule('components/save-button.tsx', expectedSource),
      emitServerModule(visibleDriftSource).executableSource,
    );

    expect(generatedOnly.ok).toBe(true);
    expect(visibleDrift).toMatchObject({
      actual: '<button type="submit">Save</button>',
      expected: '<button type="button">Save</button>',
      ok: false,
    });
  });

  it('allows semantically equivalent attributes with different source order', () => {
    const expectedSource = `
import { component } from '@kovojs/core';

export const AccordionButton = component({
  render: () => (
    <button aria-expanded="{String(open)}" class="trigger" data-state="{open ? 'open' : 'closed'}" tabIndex="{open ? 0 : -1}" value="shipping">
      Shipping
    </button>
  ),
});
`;
    const actualSource = `
import { component } from '@kovojs/core';

export const AccordionButton = component({
  render: () => (
    <button class="trigger" value="shipping" aria-expanded="{String(open)}" data-state="{open ? 'open' : 'closed'}" tabIndex="{open ? 0 : -1}">
      Shipping
    </button>
  ),
});
`;

    const check = semanticRenderEquivalenceCheck(
      'components/accordion-button.server.js',
      parseComponentModule('components/accordion-button.tsx', expectedSource),
      emitServerModule(actualSource).executableSource,
    );

    expect(check).toMatchObject({
      actual:
        '<button aria-expanded="{String(open)}" class="trigger" data-state="{open ? \'open\' : \'closed\'}" tabIndex="{open ? 0 : -1}" value="shipping">Shipping</button>',
      expected:
        '<button aria-expanded="{String(open)}" class="trigger" data-state="{open ? \'open\' : \'closed\'}" tabIndex="{open ? 0 : -1}" value="shipping">Shipping</button>',
      ok: true,
    });
  });

  it('compares primitive asChild authored semantics against the merged child element', () => {
    const expectedSource = `
import { component } from '@kovojs/core';

export const Trigger = component({
  render: () => (
    <TooltipTrigger attrs={{ class: 'primitive', role: 'button' }} asChild>
      <a class="author" href="/cart">Cart</a>
    </TooltipTrigger>
  ),
});
`;
    const actualSource = `
import { component } from '@kovojs/core';

export const Trigger = component({
  render: () => <a class="primitive author" role="button" href="/cart">Cart</a>,
});
`;
    const driftSource = `
import { component } from '@kovojs/core';

export const Trigger = component({
  render: () => <button class="primitive author" role="button">Cart</button>,
});
`;

    const merged = semanticRenderEquivalenceCheck(
      'components/trigger.server.js',
      parseComponentModule('components/trigger.tsx', expectedSource),
      emitServerModule(actualSource).executableSource,
    );
    const drift = semanticRenderEquivalenceCheck(
      'components/trigger.server.js',
      parseComponentModule('components/trigger.tsx', expectedSource),
      emitServerModule(driftSource).executableSource,
    );

    expect(merged.ok).toBe(true);
    expect(drift).toMatchObject({
      actual: '<button class="primitive author" role="button">Cart</button>',
      expected: '<a class="primitive author" role="button" href="/cart">Cart</a>',
      ok: false,
    });
  });

  it('scopes native-host component CSS to the kovo-c identity stamp', () => {
    const result = compileFixture({
      fileName: 'components/cart/cart-row.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartRow = component({
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

export const CartBadge = component({
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

export const CartBadge = component({
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
    expect(registry).toContain(`export interface LiveTargetRegistry {
  'components/cart/cart-badge/cart-badge': { component: 'components/cart/cart-badge/cart-badge'; targetBase: 'cart-badge'; identityProps: readonly []; queries: readonly ['cart']; queryBindings: readonly [{ name: 'cart'; queryExpression: "{}" }]; props: {}; coverage: readonly [{ query: 'cart.count'; position: "binding"; status: 'plan' }]; };
}`);
    expect(registry).toContain(`declare module '@kovojs/core' {`);
    expect(registry).toContain(`  interface ComponentRegistry {
  'components/cart/cart-badge/cart-badge': import('@kovojs/core').Component<import('@kovojs/core').ComponentDefinitionInput>;
  }`);
    expect(registry).toContain(`  interface FragmentTargets {
  'components/cart/cart-badge/cart-badge': {};
  }`);
    expect(registry).toContain(`  interface LiveTargetRegistry {
  'components/cart/cart-badge/cart-badge': { component: 'components/cart/cart-badge/cart-badge'; targetBase: 'cart-badge'; identityProps: readonly []; queries: readonly ['cart']; queryBindings: readonly [{ name: 'cart'; queryExpression: "{}" }]; props: {}; coverage: readonly [{ query: 'cart.count'; position: "binding"; status: 'plan' }]; };
  }`);
    expect(registry).toContain(`  interface QueryRegistry {\n\n  }`);
    expect(registry).toContain(`  interface MutationRegistry {\n\n  }`);
    expect(registry).toContain(`  interface RouteRegistry {\n\n  }`);
    expect(registry).toContain(`  interface InvalidationSets {\n\n  }`);
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
export const CartBadge = component({
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

  it('reports KV235 for hand-authored navigation segment stamps in component TSX', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartBadge = component({
  render: () => <cart-badge kovo-nav-segment="layout:AppLayout">2</cart-badge>,
});
`,
    });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'KV235',
        help: expect.stringContaining('Navigation segment stamps are compiler-derived'),
        message:
          'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR. hand-authored navigation segment stamp kovo-nav-segment.',
      }),
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
export const TotalDisplay = component({
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

  it('reports KV235 for app-authored imports from non-public Kovo subpaths', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
import { component } from '@kovojs/core';
import type { KovoExplainInput } from '@kovojs/core/internal/graph';
import { derive } from '@kovojs/runtime/generated';
import { main } from 'kovo/internal';

export { escapeHtml } from '@kovojs/server/internal/html';

export const CartBadge = component({
  render: () => <cart-badge>{derive(() => '2')}</cart-badge>,
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV235',
        fileName: 'cart-badge.tsx',
        help: expect.stringContaining(
          'SPEC.md §5.2: app-authored source may import Kovo packages only through documented public entrypoints.',
        ),
        length: 29,
        message:
          'App source imports a non-public Kovo subpath; use a documented public entrypoint.',
        severity: 'error',
        start: { column: 39, line: 3 },
      },
      {
        code: 'KV235',
        fileName: 'cart-badge.tsx',
        help: expect.stringContaining(
          'Blocked reason: app source imports non-public Kovo subpath `@kovojs/runtime/generated`.',
        ),
        length: 27,
        message:
          'App source imports a non-public Kovo subpath; use a documented public entrypoint.',
        severity: 'error',
        start: { column: 24, line: 4 },
      },
      {
        code: 'KV235',
        fileName: 'cart-badge.tsx',
        help: expect.stringContaining(
          'Blocked reason: app source imports non-public Kovo subpath `kovo/internal`.',
        ),
        length: 15,
        message:
          'App source imports a non-public Kovo subpath; use a documented public entrypoint.',
        severity: 'error',
        start: { column: 22, line: 5 },
      },
      {
        code: 'KV235',
        fileName: 'cart-badge.tsx',
        help: expect.stringContaining(
          'Blocked reason: app source imports non-public Kovo subpath `@kovojs/server/internal/html`.',
        ),
        length: 30,
        message:
          'App source imports a non-public Kovo subpath; use a documented public entrypoint.',
        severity: 'error',
        start: { column: 28, line: 7 },
      },
    ]);
  });

  it('reports KV235 for string-literal dynamic imports from non-public Kovo subpaths', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
import { component } from '@kovojs/core';

const runtime = () => import('@kovojs/runtime/generated');

export const CartBadge = component({
  render: () => <cart-badge>{runtime.name}</cart-badge>,
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV235',
        fileName: 'cart-badge.tsx',
        help: expect.stringContaining(
          'Blocked reason: app source imports non-public Kovo subpath `@kovojs/runtime/generated`.',
        ),
        length: 27,
        message:
          'App source imports a non-public Kovo subpath; use a documented public entrypoint.',
        severity: 'error',
        start: { column: 30, line: 4 },
      },
    ]);
  });

  it('exempts compiler-emitted modules from non-public generated ABI import diagnostics', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.client.js',
      source: [
        "import { handler } from '@kovojs/runtime/generated';",
        'export const CartBadge$button_click = handler(() => null);',
        '',
      ].join('\n'),
      sourceProvenance: 'compiler-emitted',
    });

    expect(result.diagnostics).toEqual([]);
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
