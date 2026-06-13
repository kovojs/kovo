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
  generatedComponentSourceFacts,
  generatedComponentSourceFileFacts,
  generatedCssScopeRulesFromArtifact,
  generatedMinifierNamePreservationBehaviorFact,
  generatedQueryUpdatePlanBehaviorFact,
  generatedRenderEquivalenceBehaviorFact,
  generatedServerDeferredBehaviorFact,
  generatedTypedDataParamCoercionBehaviorFact,
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
} from '@jiso/test/generated-module-fixtures';

describe('@jiso/test generated module fixtures', () => {
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
@scope (doc-card) to (:scope [fw-c]) {
  .title { color: teal; }
}
`,
        },
      ]),
    ).toEqual([
      { limit: ':scope [fw-c]', raw: '@scope (doc-card) to (:scope [fw-c]) {', scope: 'doc-card' },
    ]);
  });

  it('summarizes authored and generated component source facts', () => {
    expect(
      generatedComponentSourceFacts({
        authoredSource: '<cart-badge class="ready"></cart-badge>',
        generatedSource: '// @jiso-ir\nexport const CartBadge = true;',
      }),
    ).toEqual({
      authoredLoweredStampAttributes: [],
      generatedHasLoweredIrMarker: true,
    });
    expect(
      generatedComponentSourceFacts({
        authoredSource: '<cart-badge fw-deps="cart" data-p-id="1"></cart-badge>',
        generatedSource: 'export const CartBadge = true;',
      }),
    ).toEqual({
      authoredLoweredStampAttributes: ['fw-deps', 'data-p-id'],
      generatedHasLoweredIrMarker: false,
    });
  });

  it('loads generated component source pairs by component name', () => {
    expect(
      generatedComponentSourceFileFacts({
        components: ['cart-badge'],
        sourceRootUrl: new URL('../../../examples/commerce/src/', import.meta.url),
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
  });

  it('executes generated client modules through explicit runtime bindings', () => {
    const exports = executeGeneratedClientModule(
      `
import { derive, handler } from '@jiso/runtime';
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
import { handler } from '@jiso/runtime';
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
  return '<button fw-param-types="quantity:number" data-p-quantity="{item.quantity}">Add</button><button fw-param-types="selected:boolean" data-p-selected="{item.selected}" data-p-id="{item.id}">Select</button>';
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
            (element.getAttribute('fw-param-types') ?? '')
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
        { 'data-p-quantity': '{item.quantity}', 'fw-param-types': 'quantity:number' },
        {
          'data-p-id': '{item.id}',
          'data-p-selected': '{item.selected}',
          'fw-param-types': 'selected:boolean',
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
        '/c/routes/products/product-card.client.js?v=0a1b2c3d#ProductCard$button_click',
      ),
    ).toEqual({
      handlerName: 'ProductCard$button_click',
      modulePath: '/c/routes/products/product-card.client.js',
      requestPath: '/c/routes/products/product-card.client.js?cache=1&v=0a1b2c3d',
      staleVersionRequestPath: '/c/routes/products/product-card.client.js?v=00000000',
      version: '0a1b2c3d',
      versionShape: 'lower-hex-8',
    });
  });

  it('summarizes generated handler hrefs for compact behavior assertions', () => {
    expect(
      generatedHandlerReferenceSummaryFact(
        '/c/routes/products/product-card.client.js?v=0a1b2c3d#ProductCard$button_click',
      ),
    ).toEqual({
      handlerName: 'ProductCard$button_click',
      modulePath: '/c/routes/products/product-card.client.js',
      versionShape: 'lower-hex-8',
    });
  });

  it('marks malformed generated handler href versions without hiding the parsed target', () => {
    expect(
      generatedHandlerReferenceFact(
        '/c/routes/products/product-card.client.js?v=zzzzzzzz#ProductCard$button_click',
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
      applyDeferredStreamResponseToDom(options: unknown) {
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
      installJisoLoader() {
        return { dispose() {}, events: ['click'] };
      },
    };

    expect(
      generatedBootstrapDeferredBehaviorFact(
        [{ kind: 'client', source: '' }],
        {
          emitQueryPlanBootstrapModule: () => ({
            source: `
import { installJisoLoader, createQueryStore, applyDeferredStreamResponseToDom } from '@jiso/runtime';
import { CartBadge$queryUpdatePlans } from '../components/cart-badge.client.js';
const queryStore = createQueryStore();
installJisoLoader({ queryStore, enhancedMutations: { queryPlans: CartBadge$queryUpdatePlans, store: queryStore } });
export function applyJisoDeferredStreamResponse(body, options) {
  return applyDeferredStreamResponseToDom({ body, root: options.root });
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
      '<fw-query name="reviews" key="product:p1">{"items":[{"id":"r1","rating":5}]}</fw-query>',
      '<fw-query name="recommendations" key="product:p1">{"items":[{"id":"rec-1"}]}</fw-query>',
      '<fw-fragment target="reviews:p1"><link rel="stylesheet" href="/assets/reviews.css"><article fw-key="r1">5</article></fw-fragment>',
      '<fw-fragment target="recommendations:p1"><section>Rec</section></fw-fragment>',
    ].join('');
    const values = new Map<string, unknown>();

    expect(
      generatedWireDeferredBehaviorFact(body, {
        applyCompiledQueryUpdatePlan: () => ({ bindings: [] }),
        applyDeferredStreamResponseToRuntime({ root, store }) {
          root.targets
            .get('reviews:p1')!
            .replaceWithHtml(
              '<link rel="stylesheet" href="/assets/reviews.css"><article fw-key="r1">5</article>',
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
                fragments: [{ html: '<article fw-key="r1">5</article>', target: 'reviews:p1' }],
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
        'reviews:p1': [{ attrs: { 'fw-key': 'r1' }, innerHtml: '5', tag: 'article' }],
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
      'fw-state': 'ready',
      'on:load': '/c/app.js#load',
    });

    expect(element.matches('[on\\:load]')).toBe(true);
    expect(element.matches('[on\\:load="/c/app.js#load"]')).toBe(true);
    expect(element.closest('[fw-state]')).toBe(element);
    expect(element.closest('[on\\:idle]')).toBeNull();
  });

  it('executes generated bootstrap modules with captured loader and deferred hooks', () => {
    const runtime = {
      applyDeferredStreamResponseToDom(options: unknown) {
        return { applied: options };
      },
      createQueryStore() {
        return { kind: 'store' };
      },
      installJisoLoader(options: unknown) {
        return { installed: options };
      },
    };
    const fixture = executeGeneratedBootstrapModule(
      `
import { applyDeferredStreamResponseToDom, createQueryStore, installJisoLoader } from '@jiso/runtime';
import { Cart$queryUpdatePlans } from '../components/cart.client.js';
const queryStore = createQueryStore();
installJisoLoader({ enhancedMutations: { queryPlans: Cart$queryUpdatePlans, store: queryStore }, queryStore });
export function applyJisoDeferredStreamResponse(body, options) {
  return applyDeferredStreamResponseToDom({ body, root: options.root, store: queryStore });
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
        fixture.exports.applyJisoDeferredStreamResponse as (
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
      Accept: 'text/vnd.jiso.fragment+html',
      'FW-Fragment': 'true',
      'FW-Idem': crypto.randomUUID(),
      'FW-Targets': Array.from(document.querySelectorAll('[fw-deps]')).map((element) => {
        const target = element.getAttribute('fw-fragment-target') || element.id;
        return target + '=' + element.getAttribute('fw-deps');
      }).join('; '),
    }),
    keepalive: true,
    method: form.method.toUpperCase(),
  });
  const body = await response.text();
  const parsed = new DOMParser().parseFromString(body, 'text/html');
  for (const query of parsed.querySelectorAll('fw-query')) {
    dispatchEvent(new CustomEvent('jiso:query', {
      detail: {
        body: query.textContent,
        key: query.getAttribute('key'),
        name: query.getAttribute('name'),
      },
    }));
  }
  for (const fragment of parsed.querySelectorAll('fw-fragment')) {
    const target = fragment.getAttribute('target');
    if (fragment.getAttribute('mode') === 'append') {
      document.querySelector('[fw-fragment-target="' + target + '"]').insertAdjacentHTML('beforeend', fragment.innerHTML);
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
        { body: '{"count":1}', key: 'cart:c1', name: 'cart', type: 'jiso:query' },
      ],
      fetchCalls: [
        {
          body: { kind: 'form-data' },
          headers: {
            Accept: 'text/vnd.jiso.fragment+html',
            'FW-Fragment': 'true',
            'FW-Idem': 'idem-inline',
            'FW-Targets': 'cart-badge=cart; inventory=inventory stock',
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
