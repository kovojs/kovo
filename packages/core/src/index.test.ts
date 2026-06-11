import { describe, expect, it } from 'vitest';

import {
  component,
  event,
  form,
  formFields,
  fragmentTarget,
  href,
  Link,
  query,
  redirect,
  route,
  type EventPayload,
  type FormFailure,
  type FormFieldName,
  type FormInput,
  type JsonValue,
} from './index.js';

interface TestSchema<Value> {
  parse(input: unknown): Value;
}

interface CartAddRegistryMutation {
  errors: {
    OUT_OF_STOCK: TestSchema<{ availableQuantity: number }>;
  };
  input: TestSchema<{ productId: string; quantity: number }>;
  key: 'cart/add';
}

declare module './index.js' {
  interface QueryRegistry {
    cart: { count: number };
  }

  interface MutationRegistry {
    'cart/add': CartAddRegistryMutation;
  }

  interface FragmentTargets {
    'cart-row': { rowId: string };
  }

  interface RouteRegistry {
    '/cart': ReturnType<typeof route<'/cart'>>;
    '/products': ReturnType<typeof route<'/products', {}, { max: number; sort: string }>>;
    '/products/:id': ReturnType<
      typeof route<'/products/:id', { id: string }, { max: number; sort: string }>
    >;
  }
}

describe('core authoring APIs', () => {
  it('preserves component names and definitions for compiler analysis', () => {
    const cart = query<'cart', { count: number }>('cart');
    const CartBadge = component('cart-badge', {
      fragmentTarget: true,
      queries: { cart },
      state: () => ({ bouncing: false }) satisfies JsonValue,
      render: ({ cart: cartQuery }, state) => ({ cartQuery, state }),
    });

    expect(CartBadge.name).toBe('cart-badge');
    expect(CartBadge.definition.fragmentTarget).toBe(true);
    expect(CartBadge.definition.queries?.cart.key).toBe('cart');
  });

  it('rejects non-JsonValue component state at authoring time', () => {
    const assertDateState = () => {
      component('clock-face', {
        render: () => null,
        // @ts-expect-error component state must satisfy JsonValue; Date cannot be serialized.
        state: () => ({ now: new Date() }),
      });
    };
    const assertMapState = () => {
      component('filter-panel', {
        render: () => null,
        // @ts-expect-error component state must satisfy JsonValue; Map cannot be serialized.
        state: () => ({ selected: new Map<string, string>() }),
      });
    };

    expect(assertDateState).toBeTypeOf('function');
    expect(assertMapState).toBeTypeOf('function');
  });

  it('preserves query and form keys as typed authoring facts', () => {
    expect(query('cart').key).toBe('cart');
    expect(form('cart/add').key).toBe('cart/add');

    const assertUnknownQuery = () => {
      // @ts-expect-error query keys are checked against generated QueryRegistry facts.
      query('missing-query');
    };
    const assertUnknownMutation = () => {
      // @ts-expect-error form keys are checked against generated MutationRegistry facts.
      form('missing/mutation');
    };
    expect(assertUnknownQuery).toBeTypeOf('function');
    expect(assertUnknownMutation).toBeTypeOf('function');
  });

  it('preserves typed form input and failure facts', () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK' }
    >('cart/add');
    const input = {
      productId: 'p1',
      quantity: 2,
    } satisfies FormInput<typeof addToCart>;
    const failure = {
      code: 'OUT_OF_STOCK',
    } satisfies FormFailure<typeof addToCart>;
    const validationFailure = {
      code: 'VALIDATION',
      fields: { quantity: 'Expected number >= 1' },
    } satisfies FormFailure<typeof addToCart>;

    expect(addToCart.key).toBe('cart/add');
    expect(input.quantity).toBe(2);
    expect(failure.code).toBe('OUT_OF_STOCK');
    expect(validationFailure.fields.quantity).toBe('Expected number >= 1');
  });

  it('derives form input and failure facts from generated mutation registry values', () => {
    const addToCart = form('cart/add');
    const input = {
      productId: 'p1',
      quantity: 2,
    } satisfies FormInput<typeof addToCart>;
    const failure = {
      code: 'OUT_OF_STOCK',
      data: { availableQuantity: 0 },
    } satisfies FormFailure<typeof addToCart>;
    const validationFailure = {
      code: 'VALIDATION',
      fields: { quantity: 'Expected number >= 1' },
    } satisfies FormFailure<typeof addToCart>;

    expect(addToCart.key).toBe('cart/add');
    expect(input.quantity).toBe(2);
    expect(failure.data.availableQuantity).toBe(0);
    expect(validationFailure.code).toBe('VALIDATION');

    const assertMissingInput = () => {
      // @ts-expect-error quantity is required by the generated mutation input schema.
      const missing = { productId: 'p1' } satisfies FormInput<typeof addToCart>;
      return missing;
    };
    const assertUnknownInput = () => {
      const unknown = {
        productId: 'p1',
        quantity: 2,
        // @ts-expect-error sku is not part of the generated mutation input schema.
        sku: 'sku-1',
      } satisfies FormInput<typeof addToCart>;
      return unknown;
    };
    const assertUnknownFailure = () => {
      // @ts-expect-error PRICE_CHANGED is not declared by the generated mutation error schema.
      const unknown = { code: 'PRICE_CHANGED', data: { currentPrice: 2 } } satisfies FormFailure<
        typeof addToCart
      >;
      return unknown;
    };
    expect(assertMissingInput).toBeTypeOf('function');
    expect(assertUnknownInput).toBeTypeOf('function');
    expect(assertUnknownFailure).toBeTypeOf('function');
  });

  it('checks form field completeness from typed mutation inputs', () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK' }
    >('cart/add');
    const fields = formFields(addToCart, ['productId', 'quantity'] as const);
    const fieldName = 'productId' satisfies FormFieldName<typeof addToCart>;

    expect(fields).toEqual(['productId', 'quantity']);
    expect(fieldName).toBe('productId');

    const assertMissingField = () => {
      // @ts-expect-error quantity is required by the mutation input schema.
      formFields(addToCart, ['productId'] as const);
    };
    const assertUnknownField = () => {
      // @ts-expect-error sku is not part of the mutation input schema.
      formFields(addToCart, ['productId', 'quantity', 'sku'] as const);
    };
    expect(assertMissingField).toBeTypeOf('function');
    expect(assertUnknownField).toBeTypeOf('function');
  });

  it('checks form field completeness from generated mutation registry input facts', () => {
    const addToCart = form('cart/add');
    const fields = formFields(addToCart, ['productId', 'quantity'] as const);
    const fieldName = 'quantity' satisfies FormFieldName<typeof addToCart>;

    expect(fields).toEqual(['productId', 'quantity']);
    expect(fieldName).toBe('quantity');

    const assertMissingField = () => {
      // @ts-expect-error quantity is required by the generated mutation input schema.
      formFields(addToCart, ['productId'] as const);
    };
    const assertUnknownField = () => {
      // @ts-expect-error sku is not part of the generated mutation input schema.
      formFields(addToCart, ['productId', 'quantity', 'sku'] as const);
    };
    expect(assertMissingField).toBeTypeOf('function');
    expect(assertUnknownField).toBeTypeOf('function');
  });

  it('checks fragment target names and props from generated registry facts', () => {
    expect(fragmentTarget('cart-row', { rowId: 'row-1' })).toEqual({
      props: { rowId: 'row-1' },
      target: 'cart-row',
    });

    const assertUnknownTarget = () => {
      // @ts-expect-error fragment target names are checked against generated FragmentTargets facts.
      fragmentTarget('missing-target', {});
    };
    const assertMissingProp = () => {
      // @ts-expect-error rowId is required by the generated fragment target props.
      fragmentTarget('cart-row', {});
    };
    const assertUnknownProp = () => {
      // @ts-expect-error sku is not part of the generated fragment target props.
      fragmentTarget('cart-row', { rowId: 'row-1', sku: 'sku-1' });
    };

    expect(assertUnknownTarget).toBeTypeOf('function');
    expect(assertMissingProp).toBeTypeOf('function');
    expect(assertUnknownProp).toBeTypeOf('function');
  });

  it('builds typed route hrefs, links, and redirects from generated registry facts', () => {
    const productRoute = route<'/products/:id', { id: string }, { max: number; sort: string }>(
      '/products/:id',
      {
        prefetch: 'conservative',
      },
    );

    expect(productRoute.path).toBe('/products/:id');
    expect(href('/products/:id', { params: { id: 'p 1' }, search: { max: 500 } })).toBe(
      '/products/p%201?max=500',
    );
    expect(Link('/products/:id', { params: { id: 'p1' }, search: { sort: 'price' } })).toEqual({
      href: '/products/p1?sort=price',
    });
    expect(redirect('/cart', {})).toEqual({ location: '/cart', status: 303 });

    const assertMissingParam = () => {
      // @ts-expect-error id is required by the route path.
      href('/products/:id', { search: { max: 500 } });
    };
    const assertUnknownRoute = () => {
      // @ts-expect-error route hrefs are checked against generated RouteRegistry facts.
      href('/missing', {});
    };
    const assertUnknownSearch = () => {
      href('/products/:id', {
        params: { id: 'p1' },
        // @ts-expect-error sku is not part of the route search schema.
        search: { sku: 'sku-1' },
      });
    };

    expect(assertMissingParam).toBeTypeOf('function');
    expect(assertUnknownRoute).toBeTypeOf('function');
    expect(assertUnknownSearch).toBeTypeOf('function');
  });

  it('types GET form fields against route search schemas', () => {
    const productFilter = form.get('/products');
    const productDetailFilter = form.get('/products/:id', { params: { id: 'p1' } });

    expect(productFilter).toMatchObject({
      action: '/products',
      Form: { action: '/products', method: 'get' },
      method: 'get',
      path: '/products',
    });
    expect(productFilter.input('max')).toEqual({ name: 'max' });
    expect(productDetailFilter.action).toBe('/products/p1');

    const assertUnknownSearchField = () => {
      // @ts-expect-error sku is not part of the route search schema.
      productFilter.input('sku');
    };
    const assertMissingRouteParam = () => {
      // @ts-expect-error id is required for GET forms targeting product detail routes.
      form.get('/products/:id');
    };

    expect(assertUnknownSearchField).toBeTypeOf('function');
    expect(assertMissingRouteParam).toBeTypeOf('function');
  });

  it('preserves typed event names as registry facts', () => {
    const cartAdded = event<'cart:added', { productId: string; quantity: number }>('cart:added', {
      serverFactKeys: ['productId'],
    });
    const payload = {
      productId: 'p1',
      quantity: 2,
    } satisfies EventPayload<typeof cartAdded>;

    expect(cartAdded.name).toBe('cart:added');
    expect(cartAdded.serverFactKeys).toEqual(['productId']);
    expect(payload.quantity).toBe(2);

    const assertUnknownServerFactKey = () => {
      event<'cart:added', { productId: string; quantity: number }>('cart:added', {
        // @ts-expect-error sku is not part of the event payload.
        serverFactKeys: ['sku'],
      });
    };
    expect(assertUnknownServerFactKey).toBeTypeOf('function');
  });
});
