import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { domain } from './domain.js';
import { s } from './schema.js';

describe('createApp provider-typed authoring context', () => {
  it('infers db and session in app-scoped query, mutation, and route callbacks', () => {
    const cart = domain('cart');
    const app = createApp({
      db: () => ({ cart: [] as string[], stock: 3 }),
      mutations: ({ mutation }) => [
        mutation('cart/add', {
          csrf: false,
          input: s.object({ productId: s.string() }),
          registry: { touches: [cart] },
          handler(input, request) {
            request.db.cart.push(input.productId);
            const userId: string | undefined = request.session?.user.id;

            // @ts-expect-error provider shape exposes `cart`, not a renamed `basket`.
            request.db.basket.push(input.productId);

            return { count: request.db.cart.length, userId };
          },
        }),
      ],
      queries: ({ query }) => [
        query('cart', {
          guard(request) {
            const userId: string | undefined = request.session?.user.id;
            return userId || request.db.stock > 0 ? true : { kind: 'unauthenticated' };
          },
          load(_input, context) {
            context?.request.db.cart.push(context.request.session?.user.id ?? 'anonymous');

            // @ts-expect-error provider shape exposes `stock`, not a renamed `inventory`.
            const stock: number = context?.request.db.inventory;

            return { count: context?.request.db.cart.length ?? 0 };
          },
          reads: [cart],
        }),
      ],
      routes: ({ route }) => [
        route('/cart', {
          guard(request) {
            return request.session?.user.id ? true : { kind: 'unauthenticated' };
          },
          page(_context, request) {
            const count: number = request.db.cart.length;

            // @ts-expect-error provider shape exposes `user.id`, not a renamed `user.uuid`.
            const userUuid: string = request.session?.user.uuid;

            return `${count}:${request.session?.user.id}`;
          },
        }),
      ],
      sessionProvider: () => ({ user: { id: 'u1' } }),
    });

    expect(app.queries.map((query) => query.key)).toEqual(['cart']);
    expect(app.mutations.map((mutation) => mutation.key)).toEqual(['cart/add']);
    expect(app.routes.map((route) => route.path)).toEqual(['/cart']);
  });
});
