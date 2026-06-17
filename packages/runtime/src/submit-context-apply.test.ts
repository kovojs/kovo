import { describe, expect, it, vi } from 'vitest';
import { form, formFields, href, Link, redirect, type Route } from '@kovojs/core';

import {
  createQueryStore,
  createSubmitContext,
  type EnhancedMutationFetchOptions,
} from './index.js';
import { createSubmitContext as createSubmitContextFromSubmitContextModule } from './submit-context.js';
import {
  FakeMorphRoot,
  FakeMorphTarget,
  FakeQueryBindingElement,
  FakeQueryPlanElement,
} from './runtime-test-fakes.js';

declare module '@kovojs/core' {
  interface RouteRegistry {
    '/cart': Route<'/cart'>;
    '/catalog': Route<'/catalog', {}, { max: number; sort: string }>;
    '/catalog/:id': Route<'/catalog/:id', { id: string }, { max: number; sort: string }>;
  }
}

// SPEC.md §4.4/§9.1: ctx.submit sends typed mutation input through the enhanced
// fetch path and threads the decoded query/fragment chunks into the canonical
// runtime apply seam (store writes, update plans, fragment morphing). The 422
// failure-parsing behavior lives in the sibling submit-context-failure.test.ts.
describe('submit context apply', () => {
  it('exports the split submit context implementation through the public runtime barrel', () => {
    expect(createSubmitContext).toBe(createSubmitContextFromSubmitContextModule);
  });

  it('submits typed forms through a ctx.submit-style helper', async () => {
    const addToCart = form<'cart/add', { productId: string; quantity: number }>('cart/add');
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '0' });
    const summary = new FakeQueryPlanElement({ 'data-derive': 'cart.summary' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.planElements.push(summary);
    root.deps = [{ id: 'cart-badge' }];
    root.targets.set('cart-badge', new FakeMorphTarget());
    const fetch = vi.fn(async (_url: string, options: EnhancedMutationFetchOptions) => {
      const body = options.body as FormData;

      expect(body.get('productId')).toBe('p1');
      expect(body.get('quantity')).toBe('2');

      return {
        async text() {
          return [
            '<kovo-query name="cart">{"count":2}</kovo-query>',
            '<kovo-fragment target="cart-badge"><cart-badge>2</cart-badge></kovo-fragment>',
          ].join('\n');
        },
      };
    });
    const ctx = createSubmitContext({
      fetch,
      morph(target, html) {
        observed.push(`morph:${count.textContent}:${summary.textContent}`);
        target.replaceWithHtml(html);
      },
      queryPlans: {
        cart: {
          derives: [
            {
              name: 'summary',
              select: (value) => `${(value as { count: number }).count} items`,
            },
          ],
        },
      },
      root,
      store,
    });

    const result = await ctx.submit(addToCart, {
      idem: 'idem_ctx',
      input: { productId: 'p1', quantity: 2 },
    });

    expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
      body: expect.any(FormData),
      headers: {
        Accept: 'text/vnd.kovo.fragment+html',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': 'idem_ctx',
        'Kovo-Live-Targets': 'cart-badge#cart-badge:{}',
        'Kovo-Targets': 'cart-badge',
      },
      keepalive: true,
      method: 'POST',
    });
    expect(result.appliedFragments).toEqual(['cart-badge']);
    expect(observed).toEqual(['morph:2:2 items']);
    expect(store.get('cart')).toEqual({ count: 2 });
  });

  it('proves form field and navigation path renames fail under type checking', () => {
    const addToCartAfterFieldRename = form<'cart/add', { sku: string; quantity: number }>(
      'cart/add',
    );
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const ctx = createSubmitContext({
      async fetch() {
        return {
          async text() {
            return '';
          },
        };
      },
      root,
      store,
    });
    const catalogFilter = form.get('/catalog');

    expect(formFields(addToCartAfterFieldRename, ['sku', 'quantity'] as const)).toEqual([
      'sku',
      'quantity',
    ]);
    expect(href('/catalog/:id', { params: { id: 'p 1' }, search: { max: 500 } })).toBe(
      '/catalog/p%201?max=500',
    );
    expect(Link('/catalog/:id', { params: { id: 'p1' }, search: { sort: 'price' } })).toEqual({
      href: '/catalog/p1?sort=price',
    });
    expect(redirect('/cart', {})).toEqual({ location: '/cart', status: 303 });
    expect(catalogFilter.input('max')).toEqual({ name: 'max' });

    const submitRenamedShape = () =>
      ctx.submit(addToCartAfterFieldRename, { input: { quantity: 1, sku: 'sku-1' } });
    const assertLegacyFormFieldsRejected = () => {
      // @ts-expect-error SPEC.md §6.2/§6.3: mutation input field renames make old form fields red under vp check.
      formFields(addToCartAfterFieldRename, ['productId', 'quantity'] as const);
    };
    const assertLegacySubmitInputRejected = () => {
      void ctx.submit(addToCartAfterFieldRename, {
        // @ts-expect-error SPEC.md §6.2/§6.3: productId was renamed to sku in the form input schema.
        input: { productId: 'p1', quantity: 1 },
      });
    };
    const assertLegacyHrefRejected = () => {
      // @ts-expect-error SPEC.md §6.4 and rules/v1-acceptance.md: route path renames make old href consumers red.
      href('/legacy-catalog/:id', { params: { id: 'p1' } });
    };
    const assertLegacyLinkRejected = () => {
      // @ts-expect-error SPEC.md §6.4 and rules/v1-acceptance.md: route path renames make old Link consumers red.
      Link('/legacy-catalog/:id', { params: { id: 'p1' } });
    };
    const assertLegacyRedirectRejected = () => {
      // @ts-expect-error SPEC.md §6.4 and rules/v1-acceptance.md: route path renames make old redirect consumers red.
      redirect('/legacy-catalog/:id', { params: { id: 'p1' } });
    };
    const assertLegacyGetFormRejected = () => {
      // @ts-expect-error SPEC.md §6.4 and rules/v1-acceptance.md: route path renames make old GET forms red.
      form.get('/legacy-catalog');
    };
    const assertLegacySearchFieldRejected = () => {
      // @ts-expect-error SPEC.md §6.4: GET form fields must stay inside the route search schema.
      catalogFilter.input('sku');
    };

    expect(submitRenamedShape).toBeTypeOf('function');
    expect(assertLegacyFormFieldsRejected).toBeTypeOf('function');
    expect(assertLegacySubmitInputRejected).toBeTypeOf('function');
    expect(assertLegacyHrefRejected).toBeTypeOf('function');
    expect(assertLegacyLinkRejected).toBeTypeOf('function');
    expect(assertLegacyRedirectRejected).toBeTypeOf('function');
    expect(assertLegacyGetFormRejected).toBeTypeOf('function');
    expect(assertLegacySearchFieldRejected).toBeTypeOf('function');
  });
});
