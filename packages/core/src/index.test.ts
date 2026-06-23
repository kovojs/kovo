import { describe, expect, it } from 'vitest';

import {
  component,
  FieldError,
  form,
  FormError,
  href,
  Link,
  query,
  redirect,
  route,
  type Component as KovoComponent,
  type ComponentDefinitionInput,
  type FormFailure,
  type FormInput,
  type FormValidationFailure,
  type JsonValue,
} from './index.js';
import * as coreRoot from './index.js';
import { event, type EventPayload } from './internal/event.js';
import { fragmentTarget } from './internal/fragment-target.js';
import * as internalQueryDelta from './internal/query-delta.js';

interface TestSchema<Value> {
  parse(input: unknown): Value;
}

interface ServerSchema<Value = unknown> {
  parse(input: unknown): Value;
}

interface CartAddRegistryMutation {
  errors: {
    OUT_OF_STOCK: TestSchema<{ availableQuantity: number }>;
  };
  input: TestSchema<{ productId: string; quantity: number }>;
  key: 'cart/add';
}

interface PriceUpdateRegistryMutation {
  errors: {
    PRICE_CHANGED: ServerSchema<{ currentPrice: number }>;
  };
  input: ServerSchema<{ productId: string; price: number }>;
  key: 'cart/price';
}

declare module './index.js' {
  interface QueryRegistry {
    cart: { count: number };
  }

  interface MutationRegistry {
    'cart/add': CartAddRegistryMutation;
    'cart/price': PriceUpdateRegistryMutation;
  }

  interface RouteRegistry {
    '/cart': ReturnType<typeof route<'/cart'>>;
    '/products': ReturnType<typeof route<'/products', {}, { max: number; sort: string }>>;
    '/products/:id': ReturnType<
      typeof route<'/products/:id', { id: string }, { max: number; sort: string }>
    >;
    // H1 (bugs-part4 L6-1): param names use the same whole-segment grammar as the
    // matcher (server match.ts) and the `PathParamNames` type extractor, so hyphen
    // and dot characters belong to the param name.
    '/users/:user-id': ReturnType<typeof route<'/users/:user-id'>>;
    '/files/:name.json': ReturnType<typeof route<'/files/:name.json'>>;
  }
}

declare module './generated.js' {
  interface FragmentTargets {
    'cart-row': { rowId: string };
  }

  interface ComponentRegistry {
    'components/cart/cart-badge/cart-badge': KovoComponent<ComponentDefinitionInput>;
  }
}

describe('core authoring APIs', () => {
  it('keeps internal graph and derivation helpers off the root surface', () => {
    expect('applyPatchProgram' in coreRoot).toBe(false);
    expect('derived' in coreRoot).toBe(false);
    expect('packageComponentPrefixFactFromPackageManifest' in coreRoot).toBe(false);
    expect('validateKovoExplainInput' in coreRoot).toBe(false);
    expect('fragmentTarget' in coreRoot).toBe(false);
  });

  it('keeps the typed-event declaration family and storage adapters off the root surface', () => {
    expect('event' in coreRoot).toBe(false);
    expect('createMemoryStorage' in coreRoot).toBe(false);
    expect('createFileSystemStorage' in coreRoot).toBe(false);
    expect('createS3CompatibleStorage' in coreRoot).toBe(false);
    expect('normalizeStorageKey' in coreRoot).toBe(false);
    expect('storageBodyToBytes' in coreRoot).toBe(false);
  });

  it('keeps query-delta wire helpers off the root surface', () => {
    expect('applyQueryDelta' in coreRoot).toBe(false);
    expect('buildQueryDelta' in coreRoot).toBe(false);
    expect('QueryDeltaApplyError' in coreRoot).toBe(false);
    expect('queryDeltaIsSmaller' in coreRoot).toBe(false);
    expect(Object.keys(internalQueryDelta).sort()).toEqual([
      'QueryDeltaApplyError',
      'applyQueryDelta',
      'buildQueryDelta',
      'queryDeltaIsSmaller',
    ]);
  });

  it('preserves component definitions for compiler analysis', () => {
    const cart = query<'cart', { count: number }>('cart');
    const CartBadge = component({
      queries: { cart },
      state: () => ({ bouncing: false }) satisfies JsonValue,
      render: ({ cart: cartQuery }, state) => ({ cartQuery, state }),
    });

    expect(CartBadge.name).toBeUndefined();
    expect(CartBadge.definition.queries?.cart.key).toBe('cart');

    const assertRegisteredComponent = (
      value: import('./generated.js').ComponentRegistry['components/cart/cart-badge/cart-badge'],
    ) => value;
    expect(assertRegisteredComponent(CartBadge)).toBe(CartBadge);
  });

  it('rejects raw string component render results', () => {
    const assertRawStringRenderRejected = () => {
      component({
        // @ts-expect-error SPEC §4.1: component markup must be TSX/JSX or an explicit trust boundary, not a raw string.
        render: () => '<cart-badge>3</cart-badge>',
      });
    };

    expect(assertRawStringRenderRejected).toBeTypeOf('function');
  });

  it('preserves disableServerRefresh and rejects removed fragmentTarget authoring', () => {
    const cart = query<'cart', { count: number }>('cart');
    const LocalOnlyCartBadge = component({
      disableServerRefresh: true,
      queries: { cart },
      render: () => null,
    });

    expect(LocalOnlyCartBadge.definition.disableServerRefresh).toBe(true);

    const assertRemovedFragmentTargetOption = () => {
      component({
        // @ts-expect-error fragmentTarget was removed; query-backed targets are inferred.
        fragmentTarget: true,
        queries: { cart },
        render: () => null,
      });
    };
    expect(assertRemovedFragmentTargetOption).toBeTypeOf('function');
  });

  it('rejects non-JsonValue component state at authoring time', () => {
    const assertLegacyNameArgument = () => {
      // @ts-expect-error component names are compiler-derived; positional strings are not accepted.
      component('cart-badge', { render: () => null });
    };
    const assertDateState = () => {
      component({
        render: () => null,
        // @ts-expect-error component state must satisfy JsonValue; Date cannot be serialized.
        state: () => ({ now: new Date() }),
      });
    };
    const assertMapState = () => {
      component({
        render: () => null,
        // @ts-expect-error component state must satisfy JsonValue; Map cannot be serialized.
        state: () => ({ selected: new Map<string, string>() }),
      });
    };

    expect(assertLegacyNameArgument).toBeTypeOf('function');
    expect(assertDateState).toBeTypeOf('function');
    expect(assertMapState).toBeTypeOf('function');
  });

  it('preserves query and form keys as typed authoring facts', () => {
    const cart = query<'cart', { count: number }>('cart');
    const cartForProduct = cart.args((props: { productId: string }) => ({
      id: props.productId,
    }));
    const staleCart = cart.refresh({ every: '30s' });
    const cartUntil = cart.refresh({ until: (value) => value.count > 10 });
    const cartProductUntil = cartForProduct.refresh({ at: (value) => value.count });

    expect(cart.key).toBe('cart');
    expect(cart.refreshSpec).toBeUndefined();
    expect(cartForProduct.key).toBe('cart');
    expect(cartForProduct.args({ productId: 'p1' })).toEqual({ id: 'p1' });
    expect(staleCart).not.toBe(cart);
    expect(staleCart.key).toBe('cart');
    expect(staleCart.refreshSpec.every).toBe('30s');
    expect(
      staleCart.args((props: { productId: string }) => ({ id: props.productId })).refreshSpec,
    ).toBe(staleCart.refreshSpec);
    expect(cartUntil.refreshSpec.until({ count: 11 })).toBe(true);
    expect(cartProductUntil.refreshSpec.at({ count: 3 })).toBe(3);
    expect(cartProductUntil.args({ productId: 'p1' })).toEqual({ id: 'p1' });
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
      fieldErrors: { quantity: 'Expected number >= 1' },
    } satisfies FormFailure<typeof addToCart>;

    expect(addToCart.key).toBe('cart/add');
    expect(input.quantity).toBe(2);
    expect(failure.code).toBe('OUT_OF_STOCK');
    expect(validationFailure.fieldErrors.quantity).toBe('Expected number >= 1');
  });

  it('renders compiler-bound field and form errors from typed mutation failure state', () => {
    const validation = {
      code: 'VALIDATION',
      fieldErrors: { quantity: 'Expected number >= 1' },
    } satisfies FormValidationFailure;
    const coded = {
      code: 'OUT_OF_STOCK',
      payload: { availableQuantity: 2 },
    } satisfies { code: 'OUT_OF_STOCK'; payload: { availableQuantity: number } };

    expect(
      FieldError({
        class: 'error',
        failure: validation,
        id: 'quantity-error',
        name: 'quantity',
      }),
    ).toBe(
      '<output role="alert" id="quantity-error" class="error" data-error-code="VALIDATION">Expected number &gt;= 1</output>',
    );
    expect(FieldError({ failure: validation, name: 'productId' })).toBe('');
    expect(FormError({ failure: validation })).toBe('');
    expect(
      FormError({
        code: 'OUT_OF_STOCK',
        failure: coded,
        message: (failure: typeof coded) => `Only ${failure.payload.availableQuantity} left.`,
      }),
    ).toBe('<output role="alert" data-error-code="OUT_OF_STOCK">Only 2 left.</output>');
  });

  it('escapes field and form error message bodies', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const validation = {
      code: 'VALIDATION',
      fieldErrors: { title: payload },
    } satisfies FormValidationFailure;
    const duplicate = {
      code: 'DUPLICATE_TITLE',
      payload: { title: payload },
    };

    expect(FieldError({ failure: validation, name: 'title' })).toBe(
      '<output role="alert" data-error-code="VALIDATION">&lt;img src=x onerror=alert(1)&gt;</output>',
    );
    expect(
      FormError({
        code: 'DUPLICATE_TITLE',
        failure: duplicate,
        message: (failure: typeof duplicate) =>
          `A question titled "${failure.payload.title}" exists.`,
      }),
    ).toBe(
      '<output role="alert" data-error-code="DUPLICATE_TITLE">A question titled "&lt;img src=x onerror=alert(1)&gt;" exists.</output>',
    );
  });

  it('threads typed mutation failure state into component render context', () => {
    const addToCart = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK'; payload: { availableQuantity: number } }
    >('cart/add');
    const AddToCartForm = component({
      mutations: { addToCart },
      render: (_queries, _state, { forms }) => {
        const failure = forms.addToCart.failure;
        if (failure?.code === 'OUT_OF_STOCK') {
          return failure.payload.availableQuantity;
        }
        if (failure?.code === 'VALIDATION') {
          return failure.fieldErrors.quantity;
        }
        return null;
      },
    });
    const assertUnknownForm = () => {
      type Slots = Parameters<typeof AddToCartForm.definition.render>[2];
      const slots = {
        forms: {
          addToCart: { failure: null },
        },
      } satisfies Slots;
      // @ts-expect-error missingForm is not declared in component mutations.
      return slots.forms.missingForm;
    };

    expect(AddToCartForm.definition.mutations?.addToCart.key).toBe('cart/add');
    expect(assertUnknownForm).toBeTypeOf('function');
  });

  it('derives form input and failure facts from generated mutation registry values', () => {
    const addToCart = form('cart/add');
    const input = {
      productId: 'p1',
      quantity: 2,
    } satisfies FormInput<typeof addToCart>;
    const failure = {
      code: 'OUT_OF_STOCK',
      payload: { availableQuantity: 0 },
    } satisfies FormFailure<typeof addToCart>;
    const validationFailure = {
      code: 'VALIDATION',
      fieldErrors: { quantity: 'Expected number >= 1' },
    } satisfies FormFailure<typeof addToCart>;

    expect(addToCart.key).toBe('cart/add');
    expect(input.quantity).toBe(2);
    expect(failure.payload.availableQuantity).toBe(0);
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
      const unknown = { code: 'PRICE_CHANGED', payload: { currentPrice: 2 } } satisfies FormFailure<
        typeof addToCart
      >;
      return unknown;
    };
    expect(assertMissingInput).toBeTypeOf('function');
    expect(assertUnknownInput).toBeTypeOf('function');
    expect(assertUnknownFailure).toBeTypeOf('function');
  });

  it('derives form facts from server-style MutationRegistry value types', () => {
    const priceUpdate = form('cart/price');
    const input = {
      price: 1499,
      productId: 'p1',
    } satisfies FormInput<typeof priceUpdate>;
    const failure = {
      code: 'PRICE_CHANGED',
      payload: { currentPrice: 1299 },
    } satisfies FormFailure<typeof priceUpdate>;

    expect(priceUpdate.key).toBe('cart/price');
    expect(input.price).toBe(1499);
    expect(failure.payload.currentPrice).toBe(1299);

    const assertMissingInput = () => {
      // @ts-expect-error price is required by the server mutation input schema.
      const missing = { productId: 'p1' } satisfies FormInput<typeof priceUpdate>;
      return missing;
    };
    const assertUnknownFailure = () => {
      const unknown = {
        // @ts-expect-error OUT_OF_STOCK is not declared by this server mutation error schema.
        code: 'OUT_OF_STOCK',
        payload: { currentPrice: 1299 },
      } satisfies FormFailure<typeof priceUpdate>;
      return unknown;
    };
    expect(assertMissingInput).toBeTypeOf('function');
    expect(assertUnknownFailure).toBeTypeOf('function');
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

    // H1 (bugs-part4 L6-1): `PathParamNames` and the runtime matcher take the whole
    // segment after `:`, so a hyphen/dot param name must substitute the whole value
    // rather than stopping at the first non-word char (which dropped the value).
    expect(href('/users/:user-id', { params: { 'user-id': '42' } })).toBe('/users/42');
    expect(Link('/users/:user-id', { params: { 'user-id': '42' } })).toEqual({
      href: '/users/42',
    });
    expect(redirect('/users/:user-id', { params: { 'user-id': '42' } })).toEqual({
      location: '/users/42',
      status: 303,
    });
    expect(href('/files/:name.json', { params: { 'name.json': 'report' } })).toBe('/files/report');

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
