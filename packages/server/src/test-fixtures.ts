import { domain } from './domain.js';
import {
  mutation as defineMutation,
  type MutationDefinition,
  type MutationRegistry,
} from './mutation.js';
import type { FragmentRenderer } from './mutation-wire.js';
import { query } from './query.js';
import { s, type Schema } from './schema.js';

export const testMutation = ((key: string, definition: Parameters<typeof defineMutation>[1]) =>
  defineMutation(key, { csrf: false, ...definition })) as typeof defineMutation;

export const cartFixtureValue = {
  count: 1,
  items: [{ productId: 'p1', qty: 1, unitPrice: 1499 }],
} as const;

export const cartBadgeFragmentHtml =
  '<cart-badge fw-deps="cart"><button commandfor="cart-drawer" command="show-modal"><span data-bind="cart.count">1</span></button></cart-badge>';

export const recommendationsFragmentHtml =
  '<section fw-c="recommendations" fw-deps="product:p1"></section>';

export const cartMutationTargets = ['cart-badge', 'recommendations'] as const;

export function cartMutationFragmentRenderers(): FragmentRenderer[] {
  return [
    {
      render: () => cartBadgeFragmentHtml,
      target: 'cart-badge',
    },
    {
      render: () => recommendationsFragmentHtml,
      target: 'recommendations',
    },
  ];
}

export interface CartQueryFixtureOptions {
  instanceKey?: ((input: unknown) => string | undefined) | string;
  load?: (input: unknown) => Promise<typeof cartFixtureValue> | typeof cartFixtureValue;
  version?:
    | ((input: unknown, value: typeof cartFixtureValue) => number | string | undefined)
    | number
    | string;
}

export function createCartQueryFixture(options: CartQueryFixtureOptions = {}) {
  const cart = domain('cart');
  const cartQuery = query('cart', {
    ...(options.instanceKey === undefined ? {} : { instanceKey: options.instanceKey }),
    ...(options.version === undefined ? {} : { version: options.version }),
    load: options.load ?? (() => cartFixtureValue),
    reads: [cart],
  });

  return { cart, cartQuery };
}

export interface CartMutationFixtureOptions extends CartQueryFixtureOptions {
  handler?: MutationDefinition['handler'];
  input?: Schema<unknown>;
  registry?: Omit<MutationRegistry, 'queries' | 'touches'>;
}

export function createCartMutationFixture(options: CartMutationFixtureOptions = {}) {
  const { cart, cartQuery } = createCartQueryFixture(options);
  const addToCart = testMutation('cart/add', {
    input: options.input ?? s.object({ productId: s.string() }),
    registry: {
      ...options.registry,
      queries: [cartQuery],
      touches: [cart],
    },
    handler: options.handler ?? ((input) => input),
  });

  return { addToCart, cart, cartQuery };
}
