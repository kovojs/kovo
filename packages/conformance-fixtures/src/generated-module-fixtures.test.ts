import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  executeGeneratedClientArtifact,
  executeGeneratedBootstrapModule,
  executeGeneratedClientModule,
  executeGeneratedServerRenderArtifact,
  executeGeneratedServerRenderSource,
  executeInlineEnhancedFormLoaderFixture,
  generatedBootstrapDeferredBehaviorFact,
  assertGeneratedRegistryConsumerTypes,
  generatedClientExportTypeFacts,
  generatedComponentCommittedIrFacts,
  generatedComponentSourceFacts,
  generatedComponentSourceFileFacts,
  generatedCssScopeRulesFromArtifact,
  generatedMinifierNamePreservationBehaviorFact,
  generatedQueryUpdatePlanBehaviorFact,
  generatedRenderEquivalenceBehaviorFact,
  generatedServerDeferredBehaviorFact,
  generatedTypedDataParamCoercionBehaviorFact,
  generatedTypedRouteNavigationBehaviorFact,
  generatedViewTransitionStampBehaviorFact,
  generatedWireDeferredBehaviorFact,
  generatedArtifactFile,
  generatedArtifactSource,
  generatedHandlerReferenceFact,
  generatedHandlerReferenceSummaryFact,
  generatedRegistryInterfaceMemberTypes,
  generatedRenderedElementFactsFromArtifact,
  generatedRenderedElementFactsFromSource,
  GeneratedFixtureElement,
  GeneratedFixtureMorphRoot,
  GeneratedFixtureMorphTarget,
  GeneratedFixtureTemplateStampHost,
} from './generated-module-fixtures.ts';

describe('@kovojs/test generated module fixtures', () => {
  it('selects generated artifacts by kind instead of positional file membership checks', () => {
    const files = [
      { fileName: 'cart.server.js', kind: 'server', source: 'server-source' },
      { fileName: 'cart.client.js', kind: 'client', source: 'client-source' },
      { fileName: 'cart.d.ts', kind: 'registry', source: 'registry-source' },
    ];

    expect(generatedArtifactFile(files, 'client')).toEqual({
      fileName: 'cart.client.js',
      kind: 'client',
      source: 'client-source',
    });
    expect(generatedArtifactSource(files, 'registry')).toBe('registry-source');
    expect(() => generatedArtifactFile(files, 'css')).toThrow(
      'Expected one generated css artifact; found 0',
    );
    expect(() =>
      generatedArtifactFile(
        [...files, { kind: 'client', source: 'duplicate-client-source' }],
        'client',
      ),
    ).toThrow('Expected one generated client artifact; found 2');
  });

  it('projects generated CSS scope rules from the generated artifact', () => {
    expect(
      generatedCssScopeRulesFromArtifact([
        { kind: 'server', source: 'export function renderSource() { return ""; }' },
        {
          kind: 'css',
          source: `
@scope (doc-card) to (:scope [kovo-c]) {
  .title { color: teal; }
}
`,
        },
      ]),
    ).toEqual([
      {
        limit: ':scope [kovo-c]',
        raw: '@scope (doc-card) to (:scope [kovo-c]) {',
        scope: 'doc-card',
      },
    ]);
  });

  it('projects generated view-transition stamp behavior without local artifact parsing', async () => {
    await expect(
      generatedViewTransitionStampBehaviorFact({
        files: [
          {
            kind: 'server',
            source:
              'export function renderSource() { return `<img kovo-c="product-card" src="/p1.png" style="opacity: .8; view-transition-name: product-p1-image" />`; }',
          },
        ],
        registryMemberTypes: Promise.resolve({ 'product-p1-image': 'unknown' }),
        viewTransitions: [{ name: 'product-p1-image' }],
      }),
    ).resolves.toEqual({
      componentAttr: 'product-card',
      jsxPropPreserved: false,
      registryMemberTypes: { 'product-p1-image': 'unknown' },
      src: '/p1.png',
      styledElementCount: 1,
      style: 'opacity: .8; view-transition-name: product-p1-image',
      viewTransitionNames: ['product-p1-image'],
    });
  });

  it('summarizes authored and generated component source facts', () => {
    expect(
      generatedComponentSourceFacts({
        authoredSource: '<cart-badge class="ready"></cart-badge>',
        generatedSource: '// @kovojs-ir\nexport const CartBadge = true;',
      }),
    ).toEqual({
      authoredLoweredStampAttributes: [],
      generatedHasLoweredIrMarker: true,
    });
    expect(
      generatedComponentSourceFacts({
        authoredSource: '<cart-badge kovo-deps="cart" data-p-id="1"></cart-badge>',
        generatedSource: 'export const CartBadge = true;',
      }),
    ).toEqual({
      authoredLoweredStampAttributes: ['kovo-deps', 'data-p-id'],
      generatedHasLoweredIrMarker: false,
    });
  });

  it('loads generated component source pairs by component name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-test-generated-source-pairs-'));
    try {
      await mkdir(join(root, 'components'), { recursive: true });
      await mkdir(join(root, 'generated'), { recursive: true });
      await writeFile(join(root, 'components/cart-badge.tsx'), '<cart-badge />');
      await writeFile(join(root, 'generated/cart-badge.tsx'), '// @kovojs-ir\n<cart-badge />');

      expect(
        generatedComponentSourceFileFacts({
          components: ['cart-badge'],
          sourceRootUrl: pathToFileURL(`${root}/`),
        }),
      ).toEqual([
        {
          authoredLoweredStampAttributes: [],
          authoredPath: 'components/cart-badge.tsx',
          generatedHasLoweredIrMarker: true,
          generatedPath: 'generated/cart-badge.tsx',
          name: 'cart-badge',
        },
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('compares committed generated IR to compiler output through a fixture seam', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-test-committed-ir-'));
    try {
      await mkdir(join(root, 'components'), { recursive: true });
      await mkdir(join(root, 'generated'), { recursive: true });
      await writeFile(
        join(root, 'components/cart-badge.tsx'),
        '<cart-badge>{cart.count}</cart-badge>',
      );
      await writeFile(
        join(root, 'generated/cart-badge.tsx'),
        [
          '// @kovojs-ir — lowered from examples/commerce/src/components/cart-badge.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.',
          '<cart-badge kovo-deps="cart"><span data-bind="cart.count">{cart.count}</span></cart-badge>',
        ].join('\n'),
      );

      const fixtureCalls: string[] = [];
      expect(
        generatedComponentCommittedIrFacts({
          assertFixpoint(result) {
            fixtureCalls.push(`fixpoint:${result.renderEquivalenceChecks?.length ?? 0}`);
          },
          assertRenderEquivalence(result) {
            fixtureCalls.push(`render:${result.renderEquivalenceChecks?.length ?? 0}`);
          },
          compileComponentModule({ fileName, source }) {
            return {
              diagnostics: [],
              renderEquivalenceChecks: [
                {
                  expected:
                    fileName.endsWith('components/cart-badge.tsx') &&
                    source.includes('{cart.count}')
                      ? '<cart-badge kovo-deps="cart"><span data-bind="cart.count">{cart.count}</span></cart-badge>'
                      : '',
                },
              ],
            };
          },
          components: ['cart-badge'],
          projectFilePrefix: 'examples/commerce/src',
          sourceRootUrl: pathToFileURL(`${root}/`),
        }),
      ).toEqual([
        {
          authoredLoweredStampAttributes: [],
          authoredPath: 'components/cart-badge.tsx',
          diagnostics: [],
          fixpointAsserted: true,
          generatedHasLoweredIrMarker: true,
          generatedMatchesCompilerOutput: true,
          generatedPath: 'generated/cart-badge.tsx',
          loweredRenderSourcePresent: true,
          name: 'cart-badge',
          provenance: {
            fileName: 'examples/commerce/src/components/cart-badge.tsx',
            spec: 'SPEC.md section 5.2',
          },
          renderEquivalenceAsserted: true,
        },
      ]);
      expect(fixtureCalls).toEqual(['fixpoint:1', 'render:1']);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('executes generated client modules through explicit runtime bindings', () => {
    const exports = executeGeneratedClientModule(
      `
import { derive, handler } from '@kovojs/browser/generated';
export const Cart$isEmpty = derive(['cart'], (cart) => cart.count === 0);
export const Cart$click = handler((event, ctx) => ctx.value + event.delta);
`,
      {
        runtime: {
          derive(inputs: string[], select: (value: { count: number }) => boolean) {
            return { inputs, selected: select({ count: 0 }) };
          },
          handler(callback: (event: { delta: number }, ctx: { value: number }) => number) {
            return (event: { delta: number }, ctx: { value: number }) => callback(event, ctx);
          },
        },
      },
    );

    expect(exports.Cart$isEmpty).toEqual({ inputs: ['cart'], selected: true });
    expect(
      (exports.Cart$click as (event: { delta: number }, ctx: { value: number }) => number)(
        { delta: 2 },
        { value: 3 },
      ),
    ).toBe(5);
  });

  it('executes generated client artifacts by kind', () => {
    const exports = executeGeneratedClientArtifact(
      [
        { kind: 'server', source: 'export function renderSource() { return ""; }' },
        {
          kind: 'client',
          source: `
import { handler } from '@kovojs/browser/generated';
export const Cart$click = handler((_event, ctx) => ctx.value);
`,
        },
      ],
      {
        runtime: {
          handler(callback: (event: unknown, ctx: { value: number }) => number) {
            return (event: unknown, ctx: { value: number }) => callback(event, ctx);
          },
        },
      },
    );

    expect(
      (exports.Cart$click as (event: unknown, ctx: { value: number }) => number)(undefined, {
        value: 7,
      }),
    ).toBe(7);
  });

  it('projects generated minifier handler names into behavior facts', () => {
    const cartBadge = {
      files: [
        {
          kind: 'client',
          source: `
export const CartBadge$removeItem = (event, ctx) => removeItem(event, ctx);
export const CartBadge$button_click = (_event, ctx) => ctx.state.count += ctx.params.quantity;
export const CartBadge$button_click_2 = (_event, ctx) => ctx.state.count = ctx.state.count - ctx.params.quantity;
`,
        },
      ],
      handlerExports: [
        'CartBadge$removeItem',
        'CartBadge$button_click',
        'CartBadge$button_click_2',
      ],
    };
    const cartDrawer = { handlerExports: ['CartDrawer$removeItem'] };

    expect(
      generatedMinifierNamePreservationBehaviorFact({
        cartBadge,
        cartDrawer,
        collectMinifierReservedNames(results) {
          return Array.from(
            new Set(
              results.flatMap((result) =>
                Array.isArray((result as { handlerExports?: unknown }).handlerExports)
                  ? (result as { handlerExports: string[] }).handlerExports
                  : [],
              ),
            ),
          ).sort();
        },
        executeClientArtifact: executeGeneratedClientArtifact,
        runtime: {},
      }),
    ).toMatchObject({
      callResults: { add: 7, remove: 'removed', subtract: 5 },
      exportTypes: {
        CartBadge$button_click: 'function',
        CartBadge$button_click_2: 'function',
        CartBadge$removeItem: 'function',
      },
      handlerExports: [
        'CartBadge$removeItem',
        'CartBadge$button_click',
        'CartBadge$button_click_2',
      ],
      reservedNames: [
        'CartBadge$button_click',
        'CartBadge$button_click_2',
        'CartBadge$removeItem',
        'CartDrawer$removeItem',
      ],
      stateCountAfterAdd: 7,
      stateCountAfterSubtract: 5,
    });
  });

  it('projects generated typed data param coercion into behavior facts', () => {
    const files = [
      {
        kind: 'server',
        source: `
export function renderSource() {
  return '<button kovo-param-types="quantity:number" data-p-quantity="{item.quantity}">Add</button><button kovo-param-types="selected:boolean" data-p-selected="{item.selected}" data-p-id="{item.id}">Select</button>';
}
`,
      },
      {
        kind: 'client',
        source: `
export const CartActions$button_click = (_event, ctx) => ctx.state.count += ctx.params.quantity;
export const CartActions$button_click_2 = (_event, ctx) => ctx.params.selected ? select(ctx.params.id) : deselect(ctx.params.id);
`,
      },
    ];

    expect(
      generatedTypedDataParamCoercionBehaviorFact({
        executeClientArtifact: executeGeneratedClientArtifact,
        files,
        readElementParams(element) {
          const types = Object.fromEntries(
            (element.getAttribute('kovo-param-types') ?? '')
              .split(/\s+/)
              .filter(Boolean)
              .map((entry) => entry.split(':') as [string, string]),
          );
          return Object.fromEntries(
            element.attributes
              .filter((attribute) => attribute.name.startsWith('data-p-'))
              .map((attribute) => {
                const name = attribute.name
                  .slice('data-p-'.length)
                  .replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
                const type = types[name];
                const value =
                  type === 'number'
                    ? Number(attribute.value)
                    : type === 'boolean'
                      ? attribute.value === 'true'
                      : attribute.value;
                return [name, value];
              }),
          );
        },
        runtime: {},
      }),
    ).toEqual({
      buttonAttributes: [
        { 'data-p-quantity': '{item.quantity}', 'kovo-param-types': 'quantity:number' },
        {
          'data-p-id': '{item.id}',
          'data-p-selected': '{item.selected}',
          'kovo-param-types': 'selected:boolean',
        },
      ],
      handlerResults: { add: 3, deselect: 'deselect:p2', select: 'select:p1' },
      parsedParams: {
        add: { quantity: 2 },
        deselect: { id: 'p2', selected: false },
        select: { id: 'p1', selected: true },
        standalone: { featured: false, productId: 'p1', quantity: 2 },
      },
      stateCountAfterAdd: 3,
    });
  });

  it('projects generated render-equivalence checks into behavior facts', () => {
    const result = {
      files: [
        {
          kind: 'server',
          source: `
export function renderSource() {
  return '<cart-total><span data-bind="cart.total">12</span></cart-total>';
}
`,
        },
      ],
      renderEquivalenceChecks: [
        {
          actual: '<cart-total><span data-bind="cart.total">12</span></cart-total>',
          artifact: 'components/cart/cart-total.server.js',
          expected: '<cart-total><span data-bind="cart.total">12</span></cart-total>',
          ok: true,
        },
      ],
    };

    expect(
      generatedRenderEquivalenceBehaviorFact({
        assertRenderEquivalence(candidate) {
          const [check] = (candidate as typeof result).renderEquivalenceChecks;
          if (!check?.ok || check.actual !== check.expected) {
            throw new Error('render mismatch');
          }
        },
        result,
      }),
    ).toEqual({
      actualMatchesExpected: true,
      artifact: 'components/cart/cart-total.server.js',
      boundSpanAttrs: { 'data-bind': 'cart.total' },
      cartTotalAttrs: {},
      checkCount: 1,
      mismatchRejected: true,
      ok: true,
    });
  });

  it('executes generated server render modules without app-authored lowered source parsing in tests', () => {
    expect(
      executeGeneratedServerRenderSource(`
export function renderSource() {
  return '<cart-badge><span data-bind="cart.count">1</span></cart-badge>';
}
`),
    ).toBe('<cart-badge><span data-bind="cart.count">1</span></cart-badge>');
  });

  it('executes generated server artifacts by kind', () => {
    expect(
      executeGeneratedServerRenderArtifact([
        {
          kind: 'server',
          source: `
export function renderSource() {
  return '<cart-badge>1</cart-badge>';
}
`,
        },
        { kind: 'registry', source: 'export interface Components {}' },
      ]),
    ).toBe('<cart-badge>1</cart-badge>');
  });

  it('summarizes generated handler hrefs as reusable artifact facts', () => {
    expect(
      generatedHandlerReferenceFact(
        '/c/__v/3853abab13e04603-0a1b2c3d/routes/products/product-card.client.js#ProductCard$button_click',
      ),
    ).toEqual({
      handlerName: 'ProductCard$button_click',
      modulePath: '/c/routes/products/product-card.client.js',
      requestPath:
        '/c/__v/3853abab13e04603-0a1b2c3d/routes/products/product-card.client.js?cache=1',
      staleVersionRequestPath:
        '/c/__v/0000000000000000-00000000/routes/products/product-card.client.js',
      version: '3853abab13e04603-0a1b2c3d',
      versionShape: 'render-plan-hex-16-plus-hash-hex-8',
    });
  });

  it('summarizes generated handler hrefs for compact behavior assertions', () => {
    expect(
      generatedHandlerReferenceSummaryFact(
        '/c/__v/3853abab13e04603-0a1b2c3d/routes/products/product-card.client.js#ProductCard$button_click',
      ),
    ).toEqual({
      handlerName: 'ProductCard$button_click',
      modulePath: '/c/routes/products/product-card.client.js',
      versionShape: 'render-plan-hex-16-plus-hash-hex-8',
    });
  });

  it('marks malformed generated handler href versions without hiding the parsed target', () => {
    expect(
      generatedHandlerReferenceFact(
        '/c/__v/zzzzzzzz/routes/products/product-card.client.js#ProductCard$button_click',
      ),
    ).toMatchObject({
      handlerName: 'ProductCard$button_click',
      modulePath: '/c/routes/products/product-card.client.js',
      version: 'zzzzzzzz',
      versionShape: 'invalid',
    });
  });

  it('summarizes rendered generated elements without repeated monolith parsing', () => {
    const source = `
export function renderSource() {
  return '<cart-badge><button on:click="/c/cart.client.js#Cart$click">Add</button></cart-badge>';
}
`;

    expect(generatedRenderedElementFactsFromSource(source, { tag: 'button' })).toEqual([
      {
        attrs: { 'on:click': '/c/cart.client.js#Cart$click' },
        innerHtml: 'Add',
        tag: 'button',
      },
    ]);
    expect(
      generatedRenderedElementFactsFromArtifact(
        [
          { kind: 'server', source },
          { kind: 'client', source: 'export const Cart$click = true;' },
        ],
        { tag: 'cart-badge' },
      ),
    ).toEqual([
      {
        attrs: {},
        innerHtml: '<button on:click="/c/cart.client.js#Cart$click">Add</button>',
        tag: 'cart-badge',
      },
    ]);
  });

  it('summarizes generated client export runtime types', () => {
    expect(
      generatedClientExportTypeFacts({ Cart$click: () => undefined, Cart$value: 1 }, [
        'Cart$click',
        'Cart$value',
        'Cart$missing',
      ]),
    ).toEqual({
      Cart$click: 'function',
      Cart$missing: 'undefined',
      Cart$value: 'number',
    });
  });

  it('projects generated registry interface types without monolith source plumbing', async () => {
    await expect(
      generatedRegistryInterfaceMemberTypes(
        [
          {
            kind: 'registry',
            source: [
              'export interface ViewTransitions {',
              '  "product-image": unknown;',
              '  cart: { count: number };',
              '}',
            ].join('\n'),
          },
        ],
        'ViewTransitions',
      ),
    ).resolves.toEqual({
      cart: '{ count: number; }',
      'product-image': 'unknown',
    });
  });

  it('projects typed-route navigation behavior from generated anchors and registry consumers', async () => {
    const registryConsumerAssertions: string[] = [];

    await expect(
      generatedTypedRouteNavigationBehaviorFact({
        async assertRegistryConsumerTypes(files, consumerSource) {
          registryConsumerAssertions.push(
            `${files.map((file) => file.kind).join(',')}:${consumerSource.includes("href('/checkout', {})")}`,
          );
        },
        compileComponentModule({ source }) {
          if (source.includes('/product/p1')) {
            return {
              diagnostics: [
                {
                  code: 'KV220',
                  fileName: 'components/product-links.tsx',
                  message: 'Literal href or form action matches no declared route. /product/p1',
                  severity: 'error',
                },
                {
                  code: 'KV220',
                  fileName: 'components/product-links.tsx',
                  message: 'Literal href or form action matches no declared route. /checkout',
                  severity: 'error',
                },
              ],
              files: [],
            };
          }

          return {
            diagnostics: [],
            files: [
              {
                kind: 'server',
                source: `
export function renderSource() {
  return '<nav><a href="/products/p%201?max=500">Product</a><a href="/cart">Cart</a></nav>';
}
`,
              },
            ],
          };
        },
        href: () => '/products/p%201?max=10',
        Link: () => ({ href: '/products/p1' }),
        redirect: () => ({ location: '/products/p1', status: 303 }),
        route: (path) => ({ path }),
        serverRoute: (path, routeOptions) => ({ load: () => routeOptions.load(), path }),
      }),
    ).resolves.toEqual({
      core: {
        href: '/products/p%201?max=10',
        link: { href: '/products/p1' },
        redirect: { location: '/products/p1', status: 303 },
        route: { path: '/products/:id' },
        serverRoute: { loadType: 'function', path: '/products/:id' },
      },
      generated: {
        diagnostics: [],
        registryConsumerTypesAsserted: true,
        renderedHrefs: ['/products/p%201?max=500', '/cart'],
      },
      invalidDiagnostics: [
        {
          code: 'KV220',
          fileName: 'components/product-links.tsx',
          message: 'Literal href or form action matches no declared route. /product/p1',
          severity: 'error',
        },
        {
          code: 'KV220',
          fileName: 'components/product-links.tsx',
          message: 'Literal href or form action matches no declared route. /checkout',
          severity: 'error',
        },
      ],
      provenance: {
        spec: 'SPEC.md section 6.4',
      },
    });
    expect(registryConsumerAssertions).toEqual(['server:true']);
  });

  it('projects generated query-plan application behavior into structured facts', () => {
    type FakeElement = {
      getAttribute(name: string): string | null;
      setAttribute(name: string, value: string): void;
      textContent: string | null;
    };
    type FakeRoot = {
      bindings: FakeElement[];
      elements: Array<FakeElement & { reconcileTemplateStamp?: (items: unknown[]) => void }>;
      querySelectorAll(selector: string): FakeElement[];
    };
    type FakeCart = {
      count: number;
      empty: boolean;
      items: Array<{ name: string; productId: string; qty: number }>;
    };
    const applyCompiledQueryUpdatePlan = (
      rawRoot: unknown,
      queryName: string,
      rawValue: unknown,
      rawPlan: unknown,
    ) => {
      const root = rawRoot as FakeRoot;
      const value = rawValue as { count: number; disabled: boolean; items: unknown[] };
      const plan = rawPlan as {
        derives?: Array<{
          select(value: { count: number; disabled: boolean; items: unknown[] }): unknown;
          selector: string;
        }>;
        stamps?: Array<{
          attr: string;
          select(value: { count: number; disabled: boolean; items: unknown[] }): unknown;
          selector: string;
        }>;
      };
      for (const binding of root.querySelectorAll('[data-bind]')) {
        if (binding.getAttribute('data-bind') === `${queryName}.count`) {
          binding.textContent = String(value.count);
        }
      }
      for (const derive of plan.derives ?? []) {
        for (const element of root.querySelectorAll(derive.selector)) {
          element.textContent = String(derive.select(value));
        }
      }
      for (const stamp of plan.stamps ?? []) {
        for (const element of root.querySelectorAll(stamp.selector)) {
          element.setAttribute(stamp.attr, String(stamp.select(value)));
        }
      }
      return { bindings: [`${queryName}.count`] };
    };

    expect(
      generatedQueryUpdatePlanBehaviorFact([{ kind: 'client', source: '' }], {
        applyCompiledQueryUpdatePlan,
        executeClientArtifact: () => ({
          CartBadge$queryUpdatePlans: {
            cart(root: FakeRoot, cart: FakeCart) {
              root.bindings[0]!.textContent = String(cart.count);
              root.elements[0]!.setAttribute('hidden', String(cart.empty));
              root.elements[1]!.textContent = String(cart.count === 0);
              root.elements[2]!.setAttribute('disabled', String(cart.count === 0));
              root.elements[3]!.reconcileTemplateStamp?.(
                cart.items.map((item) => ({
                  html: `<li><span data-bind=".qty">${item.qty}</span> x <span data-bind=".name">${item.name}</span></li>`,
                  key: item.productId,
                })),
              );
              return {
                bindings: ['cart.count', 'cart.empty'],
                derives: ['CartBadge$isEmpty'],
                stamps: ['disabled'],
                templateStamps: ['[data-bind-list="cart.items"]'],
              };
            },
          },
        }),
        runtime: {},
      }),
    ).toEqual({
      appliedPlan: {
        bindings: ['cart.count', 'cart.empty'],
        derives: ['CartBadge$isEmpty'],
        stamps: ['disabled'],
        templateStamps: ['[data-bind-list="cart.items"]'],
      },
      bindingText: '2',
      booleanAttributes: { disabled: 'false', hidden: 'false' },
      deriveText: 'false',
      orderedApply: {
        order: ['derive-after-binding:6', 'stamp-after-derive:items:1'],
        stampValue: 'true',
      },
      templateItems: [
        {
          html: '<li><span data-bind=".qty">1</span> x <span data-bind=".name">Coffee</span></li>',
          key: 'p1',
        },
        {
          html: '<li><span data-bind=".qty">3</span> x <span data-bind=".name">Tea</span></li>',
          key: 'p2',
        },
      ],
    });
  });

  it('projects generated bootstrap deferred application into structured facts', () => {
    const store = {};
    const bootstrapRuntime = {
      applyDeferredStreamResponseToRuntime(options: unknown) {
        const { body, root } = options as {
          body: string;
          root: {
            bindings: Array<{ textContent: string | null }>;
            targets: Map<string, { replaceWithHtml(html: string): void }>;
          };
        };
        root.bindings[0]!.textContent = '9';
        root.targets
          .get('cart-badge')!
          .replaceWithHtml('<cart-badge><span data-bind="cart.count">9</span></cart-badge>');
        return { appliedFragments: body.includes('cart-badge') ? ['cart-badge'] : [] };
      },
      createQueryStore() {
        return store;
      },
      installKovoLoader() {
        return { dispose() {}, events: ['click'] };
      },
    };

    expect(
      generatedBootstrapDeferredBehaviorFact(
        [{ kind: 'client', source: '' }],
        {
          emitQueryPlanBootstrapModule: () => ({
            source: `
import { installKovoLoader, createQueryStore, applyDeferredStreamResponseToRuntime } from '@kovojs/browser/generated';
import { CartBadge$queryUpdatePlans } from '../components/cart-badge.client.js';
const queryStore = createQueryStore();
installKovoLoader({ queryStore, enhancedMutations: { queryPlans: CartBadge$queryUpdatePlans, store: queryStore } });
export function applyKovoDeferredStreamResponse(body, options) {
  return applyDeferredStreamResponseToRuntime({ body, root: options.root });
}
`,
          }),
          executeBootstrapModule: executeGeneratedBootstrapModule,
          executeClientArtifact: () => ({
            CartBadge$queryUpdatePlans: { cart: () => ({ bindings: ['cart.count'] }) },
          }),
          runtime: {},
        },
        bootstrapRuntime as never,
      ),
    ).toEqual({
      appliedFragments: ['cart-badge'],
      bootstrapCallCount: 1,
      deferredApplicationCount: 0,
      enhancedMutationStoreMatches: true,
      fragmentHtmlByTarget: {
        'cart-badge': '<cart-badge><span data-bind="cart.count">9</span></cart-badge>',
      },
      queryPlanStoreMatches: true,
      updatedBindings: { 'cart.count': '9' },
    });
  });

  it('projects server deferred stream application into structured facts', () => {
    const values: Record<string, unknown> = {};
    expect(
      generatedServerDeferredBehaviorFact({
        applyDeferredStreamResponseToRuntime({ root }) {
          root.targets
            .get('reviews')!
            .replaceWithHtml('<article>Initial</article><article>B</article><article>A</article>');
          root.targets.get('summary')!.replaceWithHtml('<section>Replace</section>');
          values.reviews = { items: ['A'] };
          return {
            appliedFragments: ['reviews', 'summary', 'reviews'],
            chunks: [
              {
                fragments: [{ html: '<article>B</article>', mode: 'append', target: 'reviews' }],
                queries: ['reviews'],
              },
              {
                fragments: [
                  { html: '<section>Replace</section>', target: 'summary' },
                  { html: '<article>A</article>', mode: 'append', target: 'reviews' },
                ],
                queries: ['reviews'],
              },
            ],
            queries: ['reviews'],
          };
        },
        createQueryStore: () => ({
          get(name: string) {
            return values[name];
          },
        }),
        renderDeferredStream: () => ({ body: 'deferred-body' }),
      }),
    ).toEqual({
      appliedFragments: ['reviews', 'summary', 'reviews'],
      chunkFragments: [
        [{ html: '<article>B</article>', mode: 'append', target: 'reviews' }],
        [
          { html: '<section>Replace</section>', target: 'summary' },
          { html: '<article>A</article>', mode: 'append', target: 'reviews' },
        ],
      ],
      chunkQueries: [['reviews'], ['reviews']],
      fragmentHtmlByTarget: {
        reviews: '<article>Initial</article><article>B</article><article>A</article>',
        summary: '<section>Replace</section>',
      },
      storeValues: { reviews: { items: ['A'] } },
    });
  });

  it('projects wire deferred stream application into structured facts', () => {
    const body = [
      '<kovo-query name="reviews" key="product:p1">{"items":[{"id":"r1","rating":5}]}</kovo-query>',
      '<kovo-query name="recommendations" key="product:p1">{"items":[{"id":"rec-1"}]}</kovo-query>',
      '<kovo-fragment target="reviews:p1"><link rel="stylesheet" href="/assets/reviews.css"><article kovo-key="r1">5</article></kovo-fragment>',
      '<kovo-fragment target="recommendations:p1"><section>Rec</section></kovo-fragment>',
    ].join('');
    const values = new Map<string, unknown>();

    expect(
      generatedWireDeferredBehaviorFact(body, {
        applyCompiledQueryUpdatePlan: () => ({ bindings: [] }),
        applyDeferredStreamResponseToRuntime({ root, store }) {
          root.targets
            .get('reviews:p1')!
            .replaceWithHtml(
              '<link rel="stylesheet" href="/assets/reviews.css"><article kovo-key="r1">5</article>',
            );
          const writableStore = store as unknown as {
            set(name: string, key: string, value: unknown): void;
          };
          writableStore.set('reviews', 'product:p1', { items: [{ id: 'r1', rating: 5 }] });
          writableStore.set('recommendations', 'product:p1', { items: [{ id: 'rec-1' }] });
          return {
            appliedFragments: ['reviews:p1', 'recommendations:p1'],
            chunks: [
              {
                fragments: [{ html: '<article kovo-key="r1">5</article>', target: 'reviews:p1' }],
                queries: ['reviews', 'recommendations'],
              },
            ],
            queries: ['reviews:product:p1', 'recommendations:product:p1'],
          };
        },
        createQueryStore: () => ({
          get(name: string, key?: string) {
            return values.get(`${name}:${key}`);
          },
          set(name: string, key: string, value: unknown) {
            values.set(`${name}:${key}`, value);
          },
        }),
      }),
    ).toEqual({
      appliedFragments: ['reviews:p1', 'recommendations:p1'],
      chunkFragmentTargets: [['reviews:p1']],
      fragmentHtmlFactsByTarget: {
        'reviews:p1': [{ attrs: { 'kovo-key': 'r1' }, innerHtml: '5', tag: 'article' }],
      },
      fragmentTargets: ['reviews:p1', 'recommendations:p1'],
      queryNames: ['reviews', 'recommendations'],
      storeValues: {
        recommendations: { items: [{ id: 'rec-1' }] },
        reviews: { items: [{ id: 'r1', rating: 5 }] },
      },
      stylesheetHrefsByTarget: {
        'recommendations:p1': [],
        'reviews:p1': ['/assets/reviews.css'],
      },
    });
  });

  it('asserts generated registry consumer programs through package fixtures', async () => {
    await expect(
      assertGeneratedRegistryConsumerTypes(
        [
          {
            kind: 'registry',
            source: [
              'declare global {',
              '  function testRegistryValue(value: string): string;',
              '}',
              'export {};',
            ].join('\n'),
          },
        ],
        [
          "testRegistryValue('cart-row');",
          '// @ts-expect-error generated registry keeps values typed.',
          'testRegistryValue(1);',
        ].join('\n'),
      ),
    ).resolves.toBeUndefined();
  });

  it('exposes DOM fixture roots that satisfy runtime query/update seams', () => {
    const root = new GeneratedFixtureMorphRoot();
    const binding = new GeneratedFixtureElement(
      { 'data-bind': 'cart.count' },
      { textContent: '0' },
    );
    const stamp = new GeneratedFixtureTemplateStampHost({ 'data-bind-list': 'cart.items' });
    root.bindings.push(binding, stamp);
    root.elements.push(new GeneratedFixtureElement({ 'data-derive': 'cart.empty' }));
    root.targets.set('cart-badge', new GeneratedFixtureMorphTarget('<cart-badge>0</cart-badge>'));

    stamp.reconcileTemplateStamp([{ html: '<li>Tea</li>', key: 'tea' }]);

    expect(root.querySelectorAll('[data-bind]')).toEqual([binding]);
    expect(root.querySelectorAll('[data-derive="cart.empty"]')).toHaveLength(1);
    expect(root.findFragmentTarget('cart-badge')?.readHtml()).toBe('<cart-badge>0</cart-badge>');
    expect(stamp.textContent).toBe('<li>Tea</li>');
  });

  it('matches escaped attribute selectors and closest() for generated loader fixtures', () => {
    const element = new GeneratedFixtureElement({
      'kovo-state': 'ready',
      'on:load': '/c/app.js#load',
    });

    expect(element.matches('[on\\:load]')).toBe(true);
    expect(element.matches('[on\\:load="/c/app.js#load"]')).toBe(true);
    expect(element.closest('[kovo-state]')).toBe(element);
    expect(element.closest('[on\\:idle]')).toBeNull();
  });

  it('executes generated bootstrap modules with captured loader and deferred hooks', () => {
    const runtime = {
      applyDeferredStreamResponseToRuntime(options: unknown) {
        return { applied: options };
      },
      createQueryStore() {
        return { kind: 'store' };
      },
      installKovoLoader(options: unknown) {
        return { installed: options };
      },
    };
    const fixture = executeGeneratedBootstrapModule(
      `
import { applyDeferredStreamResponseToRuntime, createQueryStore, installKovoLoader } from '@kovojs/browser/generated';
import { Cart$queryUpdatePlans } from '../components/cart.client.js';
const queryStore = createQueryStore();
installKovoLoader({ enhancedMutations: { queryPlans: Cart$queryUpdatePlans, store: queryStore }, queryStore });
export function applyKovoDeferredStreamResponse(body, options) {
  return applyDeferredStreamResponseToRuntime({ body, root: options.root, store: queryStore });
}
`,
      {
        '../components/cart.client.js': {
          Cart$queryUpdatePlans: { cart: { bindings: true } },
        },
      },
      runtime,
    );

    expect(fixture.calls).toMatchObject([
      {
        enhancedMutations: {
          queryPlans: { cart: { bindings: true } },
          store: fixture.store,
        },
        queryStore: fixture.store,
      },
    ]);
    expect(
      (
        fixture.exports.applyKovoDeferredStreamResponse as (
          body: string,
          options: { root: GeneratedFixtureMorphRoot },
        ) => unknown
      )('body', { root: fixture.documentRoot }),
    ).toMatchObject({
      applied: { body: 'body', root: fixture.documentRoot, store: fixture.store },
    });
    expect(fixture.deferredApplications).toMatchObject([
      { body: 'body', root: fixture.documentRoot, store: fixture.store },
    ]);
  });

  it('summarizes inline enhanced-form loader behavior as structured facts', async () => {
    const fact = await executeInlineEnhancedFormLoaderFixture(`
const listeners = {};
addEventListener('click', () => {}, { capture: true });
addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target.closest('form[enhance],form[data-enhance],form[data-mutation]');
  const response = await fetch(form.action, {
    body: new FormData(form),
    headers: new Headers({
      Accept: 'text/vnd.kovo.fragment+html',
      'Kovo-Fragment': 'true',
      'Kovo-Idem': crypto.randomUUID(),
      'Kovo-Targets': Array.from(document.querySelectorAll('[kovo-deps]')).map((element) => {
        const target = element.getAttribute('kovo-fragment-target') || element.id;
        return target + '=' + element.getAttribute('kovo-deps');
      }).join('; '),
    }),
    keepalive: true,
    method: form.method.toUpperCase(),
  });
  const body = await response.text();
  const parsed = new DOMParser().parseFromString(body, 'text/html');
  for (const query of parsed.querySelectorAll('kovo-query')) {
    dispatchEvent(new CustomEvent('kovo:query', {
      detail: {
        body: query.textContent,
        key: query.getAttribute('key'),
        name: query.getAttribute('name'),
      },
    }));
  }
  for (const fragment of parsed.querySelectorAll('kovo-fragment')) {
    const target = fragment.getAttribute('target');
    if (fragment.getAttribute('mode') === 'append') {
      document.querySelector('[kovo-fragment-target="' + target + '"]').insertAdjacentHTML('beforeend', fragment.innerHTML);
    } else {
      document.getElementById(target).innerHTML = fragment.innerHTML;
    }
  }
});
addEventListener('input', () => {}, {});
addEventListener('change', () => {}, {});
`);

    expect(fact).toMatchObject({
      appendCalls: [['beforeend', '<li>2</li>']],
      dispatchedQueries: [
        { body: '{"count":1}', key: 'cart:c1', name: 'cart', type: 'kovo:query' },
      ],
      fetchCalls: [
        {
          body: { kind: 'form-data' },
          headers: {
            Accept: 'text/vnd.kovo.fragment+html',
            'Kovo-Fragment': 'true',
            'Kovo-Idem': 'idem-inline',
            'Kovo-Targets': 'cart-badge=cart; inventory=inventory stock',
          },
          keepalive: true,
          method: 'POST',
          url: '/_m/cart/add',
        },
      ],
      fragmentHtmlByTarget: { 'cart-badge': '<cart-badge>1</cart-badge>' },
      listenerEvents: ['click', 'submit', 'input', 'change'],
      listenerOptions: { click: { capture: true } },
    });
  });
});
