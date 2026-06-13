import { describe, expect, it, vi } from 'vitest';
import { form, formFields, href, Link, redirect, type FormFailure, type Route } from '@jiso/core';

import {
  createQueryStore,
  createSubmitContext,
  type EnhancedMutationFetchOptions,
} from './index.js';
import { createSubmitContext as createSubmitContextFromSubmitContextModule } from './submit-context.js';

declare module '@jiso/core' {
  interface RouteRegistry {
    '/cart': Route<'/cart'>;
    '/catalog': Route<'/catalog', {}, { max: number; sort: string }>;
    '/catalog/:id': Route<'/catalog/:id', { id: string }, { max: number; sort: string }>;
  }
}

class FakeMorphTarget {
  html: string;

  constructor(html = '') {
    this.html = html;
  }

  replaceWithHtml(html: string): void {
    this.html = html;
  }

  appendHtml(html: string): void {
    this.html += html;
  }

  readHtml(): string {
    return this.html;
  }
}

class FakeMorphRoot {
  bindings: FakeQueryBindingElement[] = [];
  deps: { deps?: string; id?: string; target?: string }[] = [];
  planElements: FakeQueryPlanElement[] = [];
  targets = new Map<string, FakeMorphTarget>();

  findFragmentTarget(target: string): FakeMorphTarget | null {
    return this.targets.get(target) ?? null;
  }

  querySelectorAll(
    selector: string,
  ): Iterable<FakeQueryBindingElement | FakeQueryPlanElement | DependencyElement> {
    if (selector === '[data-bind]') return this.bindings;
    if (selector === '*') return [...this.bindings, ...this.planElements];

    const planElements = this.planElements.filter((element) => element.matches(selector));
    if (planElements.length > 0) return planElements;

    if (selector === '[fw-deps]') {
      return this.deps.map((dep) => new DependencyElement(dep));
    }

    return [];
  }
}

class DependencyElement {
  readonly id?: string;

  constructor(private readonly dep: { deps?: string; id?: string; target?: string }) {
    if (dep.id !== undefined) {
      this.id = dep.id;
    }
  }

  getAttribute(name: string): string | null {
    if (name === 'fw-fragment-target') return this.dep.target ?? null;
    if (name === 'fw-deps') return this.dep.deps ?? '';
    return null;
  }
}

class FakeQueryPlanElement {
  attributes: { name: string; value: string }[];
  textContent: string | null;

  constructor(attributes: Record<string, string>, options: { textContent?: string | null } = {}) {
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
    this.textContent = options.textContent ?? null;
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  matches(selector: string): boolean {
    const exactAttribute = /^\[([^=\]]+)="([^"]*)"\]$/.exec(selector);
    if (exactAttribute) {
      return this.getAttribute(exactAttribute[1] ?? '') === exactAttribute[2];
    }

    const presentAttribute = /^\[([^=\]]+)\]$/.exec(selector);
    return presentAttribute ? this.getAttribute(presentAttribute[1] ?? '') !== null : false;
  }

  removeAttribute(name: string): void {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }

  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      existing.value = value;
      return;
    }

    this.attributes.push({ name, value });
  }
}

class FakeQueryBindingElement {
  textContent: string | null;

  constructor(
    private readonly path: string,
    options: { textContent?: string | null } = {},
  ) {
    this.textContent = options.textContent ?? null;
  }

  getAttribute(name: string): string | null {
    return name === 'data-bind' ? this.path : null;
  }
}

describe('submit context', () => {
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
            '<fw-query name="cart">{"count":2}</fw-query>',
            '<fw-fragment target="cart-badge"><cart-badge>2</cart-badge></fw-fragment>',
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
        Accept: 'text/vnd.jiso.fragment+html',
        'FW-Fragment': 'true',
        'FW-Idem': 'idem_ctx',
        'FW-Targets': 'cart-badge',
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
      // @ts-expect-error SPEC.md §6.4/§16.6: route path renames make old href consumers red.
      href('/legacy-catalog/:id', { params: { id: 'p1' } });
    };
    const assertLegacyLinkRejected = () => {
      // @ts-expect-error SPEC.md §6.4/§16.6: route path renames make old Link consumers red.
      Link('/legacy-catalog/:id', { params: { id: 'p1' } });
    };
    const assertLegacyRedirectRejected = () => {
      // @ts-expect-error SPEC.md §6.4/§16.6: route path renames make old redirect consumers red.
      redirect('/legacy-catalog/:id', { params: { id: 'p1' } });
    };
    const assertLegacyGetFormRejected = () => {
      // @ts-expect-error SPEC.md §6.4/§16.6: route path renames make old GET forms red.
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

  it('passes typed validation failures from ctx.submit on 422 responses', async () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK'; data: { availableQuantity: number } }
    >('cart/add');
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn((failure: FormFailure<typeof addToCart>) => {
      if (failure.code === 'VALIDATION') {
        expect(failure.fields.quantity).toBeTypeOf('string');
        return;
      }

      expect(failure.data.availableQuantity).toBeTypeOf('number');
    });
    const fetch = vi.fn(async () => ({
      status: 422,
      async text() {
        return '<fw-fragment target="error"><output role="alert" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output></fw-fragment>';
      },
    }));
    const ctx = createSubmitContext({ fetch, root, store });

    const result = await ctx.submit(addToCart, {
      input: { productId: 'p1', quantity: 1 },
      onError,
    });

    expect(onError).toHaveBeenCalledWith({
      code: 'OUT_OF_STOCK',
      data: { availableQuantity: 0 },
    });
    expect(result.fragments).toEqual([
      {
        html: '<output role="alert" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output>',
        target: 'error',
      },
    ]);
  });

  it('parses fw-error mutation failures with shared tag-close attribute scanning', async () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK'; data: { availableQuantity: number } }
    >('cart/add');
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    const fetch = vi.fn(async () => ({
      status: 422,
      async text() {
        return '<fw-error data-debug="quantity > stock">{"code":"OUT_OF_STOCK","data":{"availableQuantity":0}}</fw-error>';
      },
    }));
    const ctx = createSubmitContext({ fetch, root, store });

    await ctx.submit(addToCart, {
      input: { productId: 'p1', quantity: 1 },
      onError,
    });

    expect(onError).toHaveBeenCalledWith({
      code: 'OUT_OF_STOCK',
      data: { availableQuantity: 0 },
    });
  });

  it('parses output mutation failures when attributes contain quoted tag closers', async () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK'; data: { availableQuantity: number } }
    >('cart/add');
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    const fetch = vi.fn(async () => ({
      status: 422,
      async text() {
        return '<fw-fragment target="error"><output role="alert" data-debug="quantity > stock" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output></fw-fragment>';
      },
    }));
    const ctx = createSubmitContext({ fetch, root, store });

    await ctx.submit(addToCart, {
      input: { productId: 'p1', quantity: 1 },
      onError,
    });

    expect(onError).toHaveBeenCalledWith({
      code: 'OUT_OF_STOCK',
      data: { availableQuantity: 0 },
    });
  });

  it('passes schema validation field failures from ctx.submit on server-shaped 422 fragments', async () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'VALIDATION'; fields: { quantity: string } }
    >('cart/add');
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    const fetch = vi.fn(async () => ({
      status: 422,
      async text() {
        return '<fw-fragment target="product-form:p1"><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></fw-fragment>';
      },
    }));
    const ctx = createSubmitContext({ fetch, root, store });

    await ctx.submit(addToCart, {
      input: { productId: 'p1', quantity: 0 },
      onError,
    });

    expect(onError).toHaveBeenCalledWith({
      code: 'VALIDATION',
      fields: { quantity: 'Expected number >= 1' },
    });
  });

  it('parses validation output paths when attributes contain quoted tag closers', async () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'VALIDATION'; fields: { quantity: string } }
    >('cart/add');
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onError = vi.fn();
    const fetch = vi.fn(async () => ({
      status: 422,
      async text() {
        return '<fw-fragment target="product-form:p1"><output role="alert" data-debug="quantity > min" data-error-path="quantity">Expected number &gt;= 1</output></fw-fragment>';
      },
    }));
    const ctx = createSubmitContext({ fetch, root, store });

    await ctx.submit(addToCart, {
      input: { productId: 'p1', quantity: 0 },
      onError,
    });

    expect(onError).toHaveBeenCalledWith({
      code: 'VALIDATION',
      fields: { quantity: 'Expected number >= 1' },
    });
  });
});
