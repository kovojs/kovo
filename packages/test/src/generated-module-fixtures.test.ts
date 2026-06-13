import { describe, expect, it } from 'vitest';

import {
  executeGeneratedBootstrapModule,
  executeGeneratedClientModule,
  executeGeneratedServerRenderSource,
  generatedHandlerReferenceFact,
  GeneratedFixtureElement,
  GeneratedFixtureMorphRoot,
  GeneratedFixtureMorphTarget,
  GeneratedFixtureTemplateStampHost,
} from '@jiso/test/generated-module-fixtures';

describe('@jiso/test generated module fixtures', () => {
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

  it('executes generated server render modules without app-authored lowered source parsing in tests', () => {
    expect(
      executeGeneratedServerRenderSource(`
export function renderSource() {
  return '<cart-badge><span data-bind="cart.count">1</span></cart-badge>';
}
`),
    ).toBe('<cart-badge><span data-bind="cart.count">1</span></cart-badge>');
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
});
