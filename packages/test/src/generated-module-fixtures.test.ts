import { describe, expect, it } from 'vitest';

import {
  executeGeneratedClientArtifact,
  executeGeneratedBootstrapModule,
  executeGeneratedClientModule,
  executeGeneratedServerRenderArtifact,
  executeGeneratedServerRenderSource,
  executeInlineEnhancedFormLoaderFixture,
  generatedClientExportTypeFacts,
  generatedComponentSourceFacts,
  generatedArtifactFile,
  generatedArtifactSource,
  generatedHandlerReferenceFact,
  generatedHandlerReferenceSummaryFact,
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
