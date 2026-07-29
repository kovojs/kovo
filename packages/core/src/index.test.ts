import { describe, expect, it } from 'vitest';

import {
  component,
  FieldError,
  form,
  FormError,
  href,
  Link,
  queryRef,
  redirect,
  routeRef,
  type FormFailure,
  type FormInput,
  type FormValidationFailure,
  type JsonValue,
  type RouteSearchValue,
  type Serializable,
} from './index.js';
import {
  DeclassifyPolicy,
  declareOffWire,
  type Secret,
  trustedReveal,
  type TrustedRevealValue,
} from './security.js';
import {
  createFileSystemStorage,
  createMemoryStorage,
  createS3CompatibleStorage,
  type MemoryStorageOptions,
  type S3CompatibleObjectClient,
  type S3CompatibleStorageOptions,
} from './storage-public.js';
import * as coreRoot from './index.js';
import { event, type EventPayload } from './internal/event.js';
import { fragmentTarget } from './internal/fragment-target.js';
import * as internalQueryDelta from './internal/query-delta.js';

interface TestSchema<Value> {
  parse(input: unknown): Value;
}

// eslint-disable-next-line no-unused-vars -- compile-time public import assertion only.
type PublicMemoryStorageOptions = MemoryStorageOptions;
// eslint-disable-next-line no-unused-vars -- compile-time public import assertion only.
type PublicS3Client = S3CompatibleObjectClient;
// eslint-disable-next-line no-unused-vars -- compile-time public import assertion only.
type PublicS3StorageOptions = S3CompatibleStorageOptions;
// eslint-disable-next-line no-unused-vars -- compile-time public import assertion only.
type PublicRouteSearchValue = RouteSearchValue;

interface CartAddMutation {
  errors: {
    OUT_OF_STOCK: TestSchema<{ availableQuantity: number }>;
  };
  input: TestSchema<{ productId: string; quantity: number }>;
  key: 'cart/add';
}

declare module './generated.js' {
  interface FragmentTargets {
    'cart-row': { rowId: string };
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

  it('keeps task-specific security and storage values off the authoring root', async () => {
    expect('event' in coreRoot).toBe(false);
    expect('createMemoryStorage' in coreRoot).toBe(false);
    expect('createFileSystemStorage' in coreRoot).toBe(false);
    expect('createS3CompatibleStorage' in coreRoot).toBe(false);
    expect('declareOffWire' in coreRoot).toBe(false);
    expect('DeclassifyPolicy' in coreRoot).toBe(false);
    expect((await import('./security.js')).declareOffWire).toBe(declareOffWire);
    expect((await import('./storage-public.js')).createMemoryStorage).toBe(createMemoryStorage);
    expect((await import('./storage-public.js')).createFileSystemStorage).toBe(
      createFileSystemStorage,
    );
    expect((await import('./storage-public.js')).createS3CompatibleStorage).toBe(
      createS3CompatibleStorage,
    );
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
    const cart = queryRef<'cart', { count: number }>('cart');
    const CartBadge = component({
      queries: { cart },
      state: () => ({ bouncing: false }) satisfies JsonValue,
      render: ({ cart: cartQuery }, state) => ({ cartQuery, state }),
    });

    expect(CartBadge.name).toBeUndefined();
    expect(CartBadge.definition.queries?.cart.key).toBe('cart');

    expect(CartBadge).toBeTypeOf('function');
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
    const cart = queryRef<'cart', { count: number }>('cart');
    const LocalOnlyCartBadge = component({
      disableServerRefresh: true,
      queries: { cart },
      render: () => null,
    });

    expect(LocalOnlyCartBadge.definition.disableServerRefresh).toBe(true);

    const assertRemovedFragmentTargetOption = () => {
      component({
        // @ts-expect-error fragmentTarget was removed; queryRef-backed targets are inferred.
        fragmentTarget: true,
        queries: { cart },
        render: () => null,
      });
    };
    expect(assertRemovedFragmentTargetOption).toBeTypeOf('function');
  });

  it('derives component call-site props from the annotated render input', () => {
    const product = queryRef<'product', { name: string }>('product');
    const ProductCard = component({
      props: { productId: String },
      queries: {
        product: product.args((props: { productId: string }) => ({ id: props.productId })),
      },
      render: ({
        product,
        productId,
        selected = false,
      }: {
        product: { name: string };
        productId: string;
        selected?: boolean;
      }) => ({ product, productId, selected }),
    });

    ProductCard({ productId: 'p1' });
    ProductCard({ productId: 'p1', selected: true, 'kovo-key': 'p1', style: {} });

    // @ts-expect-error SPEC §4.1/§6.2: queryRef result keys are server-owned, not call-site props.
    ProductCard({ product: { name: 'Desk' }, productId: 'p1' });
    // @ts-expect-error SPEC §4.1/§6.2: required render-derived props must be supplied.
    ProductCard();
    // @ts-expect-error SPEC §4.1/§6.2: component call-site props are exact.
    ProductCard({ productId: 'p1', productID: 'typo' });
    // @ts-expect-error SPEC §4.1/§6.2: render annotations own prop value types.
    ProductCard({ productId: 1 });

    const Unannotated = component({
      render: () => null,
    });
    Unannotated();
    Unannotated({ style: {}, 'kovo-key': 'stable' });
    // @ts-expect-error SPEC §4.1/§6.2: unannotated render input exports no ordinary props.
    Unannotated({ label: 'hidden' });
  });

  it('checks queryRef args and props metadata against render-derived props', () => {
    const product = queryRef<'product', { name: string }>('product');

    component({
      props: { productId: String, count: Number },
      queries: {
        product: product.args((props: { productId: string }) => ({ id: props.productId })),
      },
      render: ({
        count,
        product,
        productId,
      }: {
        count: number;
        product: { name: string };
        productId: string;
      }) => ({ count, product, productId }),
    });

    component({
      queries: {
        // @ts-expect-error SPEC §4.1/§6.2: queryRef args cannot invent props absent from render input.
        product: product.args((props: { invented: string }) => ({ id: props.invented })),
      },
      render: ({ productId }: { product: { name: string }; productId: string }) => ({
        productId,
      }),
    });

    component({
      // @ts-expect-error SPEC §4.1/§6.2: props metadata keys must exist on call-site props.
      props: { invented: String },
      render: ({ productId }: { productId: string }) => ({ productId }),
    });

    component({
      // @ts-expect-error SPEC §4.1/§6.2: props metadata constructors must match call-site prop types.
      props: { productId: Number },
      render: ({ productId }: { productId: string }) => ({ productId }),
    });
  });

  it('rejects unknown component definition fields and preserves isomorphic', () => {
    const IsomorphicCounter = component({
      isomorphic: true,
      render: () => null,
    });
    const Clocked = component({
      clocks: { ago: { every: '30s' } },
      render: () => null,
    });

    expect(IsomorphicCounter.definition.isomorphic).toBe(true);
    expect(Clocked.definition.clocks).toEqual({ ago: { every: '30s' } });
    expect(() =>
      component({
        disableServerRefres: true,
        render: () => null,
      } as never),
    ).toThrow('Unknown component() definition field "disableServerRefres"');
  });

  it('rejects non-JsonValue component state at authoring time', () => {
    interface CounterState {
      count: number;
      filters: readonly { label: string; selected: boolean }[];
    }
    const assertLegacyNameArgument = () => {
      // @ts-expect-error component names are compiler-derived; positional strings are not accepted.
      component('cart-badge', { render: () => null });
    };
    const assertInterfaceStateAccepted = () => {
      const Counter = component({
        render: (_queries, state: CounterState) => ({ state }),
        state: (): CounterState => ({ count: 0, filters: [] }),
      });
      const _state: Serializable<CounterState> = Counter.definition.state();
      void _state;
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
    const assertSecretState = () => {
      component({
        render: () => null,
        // @ts-expect-error component state must satisfy JsonValue; Secret<T> cannot be serialized.
        state: () => ({ passwordHash: {} as Secret<string> }),
      });
    };

    expect(assertLegacyNameArgument).toBeTypeOf('function');
    expect(assertInterfaceStateAccepted).toBeTypeOf('function');
    expect(assertDateState).toBeTypeOf('function');
    expect(assertMapState).toBeTypeOf('function');
    expect(assertSecretState).toBeTypeOf('function');
  });

  it('keeps Secret values outside JsonValue client boundaries', () => {
    const assertSecretRejected = () => {
      // @ts-expect-error SPEC §6.2/§10.2: Secret<T> is not a JsonValue client payload.
      const _value: JsonValue = {} as Secret<string>;
    };

    expect(assertSecretRejected).toBeTypeOf('function');
  });

  it('requires an explicit audited reveal before a Secret can cross JsonValue boundaries', () => {
    const policy = DeclassifyPolicy.forTrustedReveal({
      ownerScope: 'current-principal',
    });
    const revealed = trustedReveal('hash-1' as unknown as Secret<string>, policy);
    const assertRevealedString = (value: TrustedRevealValue<Secret<string>>) => value;
    const jsonValue: JsonValue = revealed;

    expect(assertRevealedString(revealed)).toBe('hash-1');
    expect(jsonValue).toBe('hash-1');
    expect(() => trustedReveal('hash-1' as unknown as Secret<string>, {} as never)).toThrow(
      /validated DeclassifyPolicy/u,
    );
  });

  it('preserves library-owned queryRef and form keys without ambient registry augmentation', () => {
    const cart = queryRef<'cart', { count: number }>('cart');
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
    expect(queryRef('library/cart').key).toBe('library/cart');
    expect(form('library/cart/update').key).toBe('library/cart/update');
  });

  it('declares per-queryRef refetch-on-focus opt-out on the queryRef handle (SPEC §9.3/§9.4)', () => {
    // SPEC §9.3/§9.4: refetch-on-focus is a per-queryRef loader behavior with a per-queryRef opt-out.
    // The opt-out is declarable at the queryRef site; refetch-on-focus is on by default otherwise.
    const ticker = queryRef<'ticker', { price: number }>('ticker', { refetchOnFocus: false });
    const cart = queryRef<'cart', { count: number }>('cart');

    expect(ticker.refetchOnFocus).toBe(false);
    expect(ticker.key).toBe('ticker');
    expect(cart.refetchOnFocus).toBeUndefined();

    const assertNoOptInField = () => {
      // @ts-expect-error SPEC §9.3/§9.4: refetch-on-focus is on by default, so `true` would be a
      // no-op field; only `refetchOnFocus: false` (the opt-out) is accepted.
      queryRef<'cart', { count: number }>('cart', { refetchOnFocus: true });
    };
    expect(assertNoOptInField).toBeTypeOf('function');
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
      String(
        FieldError({
          class: 'error',
          failure: validation,
          id: 'quantity-error',
          name: 'quantity',
        }),
      ),
    ).toBe(
      '<output role="alert" id="quantity-error" class="error" data-error-code="VALIDATION">Expected number &gt;= 1</output>',
    );
    expect(FieldError({ failure: validation, name: 'productId' })).toBe('');
    expect(FormError({ failure: validation })).toBe('');
    expect(
      String(
        FormError({
          code: 'OUT_OF_STOCK',
          failure: coded,
          message: (failure: typeof coded) => `Only ${failure.payload.availableQuantity} left.`,
        }),
      ),
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

    expect(String(FieldError({ failure: validation, name: 'title' }))).toBe(
      '<output role="alert" data-error-code="VALIDATION">&lt;img src=x onerror=alert(1)&gt;</output>',
    );
    expect(
      String(
        FormError({
          code: 'DUPLICATE_TITLE',
          failure: duplicate,
          message: (failure: typeof duplicate) =>
            `A question titled "${failure.payload.title}" exists.`,
        }),
      ),
    ).toBe(
      '<output role="alert" data-error-code="DUPLICATE_TITLE">A question titled "&lt;img src=x onerror=alert(1)&gt;" exists.</output>',
    );
  });

  it('keeps failure HTML escaped after app code poisons string controls', () => {
    const originalString = globalThis.String;
    const originalReplaceAll = originalString.prototype.replaceAll;
    let fieldOutput: unknown;
    let formOutput: unknown;
    try {
      originalString.prototype.replaceAll = function replaceAllPoison() {
        return this as unknown as string;
      };
      globalThis.String = (() => '<script>wrong coercion</script>') as unknown as StringConstructor;
      fieldOutput = FieldError({
        class: 'failure\" onclick=\"alert(1)',
        failure: {
          code: 'VALIDATION',
          fieldErrors: { title: '<img src=x onerror=alert(1)>' },
        },
        name: 'title',
      });
      formOutput = FormError({
        failure: { code: 'DUPLICATE\" onfocus=\"alert(2)' },
        message: '<svg onload=alert(3)>',
      });
    } finally {
      globalThis.String = originalString;
      originalString.prototype.replaceAll = originalReplaceAll;
    }

    expect(String(fieldOutput)).toBe(
      '<output role="alert" class="failure&quot; onclick=&quot;alert(1)" data-error-code="VALIDATION">&lt;img src=x onerror=alert(1)&gt;</output>',
    );
    expect(String(formOutput)).toBe(
      '<output role="alert" data-error-code="DUPLICATE&quot; onfocus=&quot;alert(2)">&lt;svg onload=alert(3)&gt;</output>',
    );
  });

  it('rejects accessor-backed failure output attributes', () => {
    let reads = 0;
    const props = {
      failure: { code: 'VALIDATION', fieldErrors: { title: 'invalid' } },
      get id() {
        reads += 1;
        return 'title-error';
      },
      name: 'title',
    };

    expect(() => FieldError(props)).toThrow('must be a stable own string data property');
    expect(reads).toBe(0);
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
          addToCart: { failure: null, submitted: { productId: 'p1', quantity: 2 } },
        },
      } satisfies Slots;
      const quantity: number | undefined = slots.forms.addToCart.submitted?.quantity;
      // @ts-expect-error missingForm is not declared in component mutations.
      return slots.forms.missingForm ?? quantity;
    };

    expect(AddToCartForm.definition.mutations?.addToCart.key).toBe('cart/add');
    expect(assertUnknownForm).toBeTypeOf('function');
  });

  it('derives form facts directly from mutation definition values', () => {
    const addToCartMutation = {
      errors: {
        OUT_OF_STOCK: { parse: (input: unknown) => input as { availableQuantity: number } },
      },
      input: { parse: (input: unknown) => input as { productId: string; quantity: number } },
      key: 'cart/add',
    } satisfies CartAddMutation;
    const addToCart = form(addToCartMutation);
    const input = {
      productId: 'p1',
      quantity: 2,
    } satisfies FormInput<typeof addToCart>;
    const failure = {
      code: 'OUT_OF_STOCK',
      payload: { availableQuantity: 0 },
    } satisfies FormFailure<typeof addToCart>;

    expect(addToCart.key).toBe('cart/add');
    expect(input.quantity).toBe(2);
    expect(failure.payload.availableQuantity).toBe(0);

    const assertMissingInput = () => {
      // @ts-expect-error quantity is required by the mutation definition input schema.
      const missing = { productId: 'p1' } satisfies FormInput<typeof addToCart>;
      return missing;
    };
    const assertUnknownFailure = () => {
      // @ts-expect-error PRICE_CHANGED is not declared by the mutation definition error schema.
      const unknown = { code: 'PRICE_CHANGED', payload: { currentPrice: 2 } } satisfies FormFailure<
        typeof addToCart
      >;
      return unknown;
    };
    expect(assertMissingInput).toBeTypeOf('function');
    expect(assertUnknownFailure).toBeTypeOf('function');
  });

  it('fails closed when a mutation form value has no resolved key', () => {
    expect(() => form({ key: undefined as unknown as 'cart/add' })).toThrow(
      /resolved mutation key/,
    );
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

  it('builds typed routeRef hrefs, links, and redirects from path literals', () => {
    const productRoute = routeRef<'/products/:id', { id: string }, { max: number; sort: string }>(
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
    expect(
      Link({
        children: 'View',
        params: { id: 'p1' },
        search: { sort: 'price' },
        to: '/products/:id',
      }),
    ).toBeUndefined();
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
    expect(href('/optional-search', { search: { next: undefined } })).toBe('/optional-search');
    expect(href('/optional-search', { search: { next: 'cart' } })).toBe(
      '/optional-search?next=cart',
    );

    const assertMissingParam = () => {
      // @ts-expect-error id is required by the routeRef path.
      href('/products/:id', { search: { max: 500 } });
    };

    expect(assertMissingParam).toBeTypeOf('function');
  });

  it('types GET form fields from an explicit library route contract', () => {
    const productFilter = form.get<'/products', { max: number; sort: string }>('/products');
    const productDetailFilter = form.get<'/products/:id', { max: number; sort: string }>(
      '/products/:id',
      { params: { id: 'p1' } },
    );

    expect(productFilter).toMatchObject({
      action: '/products',
      method: 'get',
      path: '/products',
    });
    expect(productFilter.Form.action).toBe('/products');
    expect(productFilter.Form.method).toBe('get');
    expect(productFilter.input('max')).toEqual({ name: 'max' });
    expect(productFilter.Form({ children: null })).toBeUndefined();
    expect(productFilter.input({ name: 'max', type: 'number' })).toBeUndefined();
    expect(productDetailFilter.action).toBe('/products/p1');
    expect(
      form.get<'/optional-search', { next: string | undefined }>('/optional-search').input('next'),
    ).toEqual({ name: 'next' });

    const assertUnknownSearchField = () => {
      // @ts-expect-error sku is not part of the routeRef search schema.
      productFilter.input('sku');
    };
    const assertUnknownSearchFieldComponent = () => {
      // @ts-expect-error sku is not part of the routeRef search schema.
      productFilter.input({ name: 'sku' });
    };
    const assertMissingRouteParam = () => {
      // @ts-expect-error id is required for GET forms targeting product detail routes.
      form.get('/products/:id');
    };

    expect(assertUnknownSearchField).toBeTypeOf('function');
    expect(assertUnknownSearchFieldComponent).toBeTypeOf('function');
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
