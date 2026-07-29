import { describe, expect, it } from 'vitest';
import { component, type FormFailure } from '@kovojs/core';

import { publicAccess } from './access.js';
import { defineKovo } from './app-contract.js';
import { resolveKovoAppToken } from './app-token.js';
import { domain } from './domain.js';
import { renderedHtml } from './html.js';
import type { MutationRequestDb } from './mutation.js';
import { assignDerivedMutationKey } from './mutation/definition.js';
import { assignDerivedQueryKey } from './query.js';
import { s } from './schema.js';

describe('defineKovo provider-typed authoring context', () => {
  it('preserves inline route path params for pages and regions', () => {
    const contract = defineKovo({
      appId: '909ff0c4-09ab-4d87-9093-66505a91054c',
      egress: { enabled: false, justification: 'isolated authoring-context test' },
    });
    const product = contract.route('/products/:id', {
      access: publicAccess('public product fixture'),
      page(context) {
        const id: string = context.params.id;
        // @ts-expect-error sku is not declared by the inline route path.
        void context.params.sku;
        return renderedHtml(id);
      },
      regions: {
        details(context) {
          const id: string = context.params.id;
          return renderedHtml(id);
        },
      },
    });

    const app = resolveKovoAppToken(
      contract.assemble({ routes: [product] }),
      'app-authoring route test',
    );
    expect(app.routes.map((candidate) => candidate.path)).toEqual(['/products/:id']);
  });

  it('infers readonly db, authenticated session, env, access composition, and typed errors', () => {
    const cart = domain('cart');
    const contract = defineKovo({
      appId: '93b8f7c7-6c8e-4dd5-92f9-3b6a1d0f798a',
      auth: () => ({ user: { id: 'u1', roles: ['admin'] as const } }),
      db: () => ({
        cart: [] as string[],
        insert(productId: string) {
          this.cart.push(productId);
        },
        select() {
          return 3;
        },
        transaction<Result>(run: (tx: unknown) => Result) {
          return run({});
        },
      }),
      egress: { enabled: false, justification: 'isolated authoring-context test' },
      env: s.object({ STORE_NAME: s.string() }),
      envSource: { STORE_NAME: 'Kovo Shop' },
    });
    const authenticatedAdmin = contract.all(
      contract.authenticated,
      contract.role('admin'),
    );

    const add = assignDerivedMutationKey(
      contract.mutation({
        access: [authenticatedAdmin],
        csrf: false,
        csrfJustification: 'test fixture uses a non-browser caller',
        errors: {
          OUT_OF_STOCK: s.object({ available: s.number() }),
        },
        input: s.object({ productId: s.string() }),
        registry: { touches: [cart] },
        handler(input, request, context) {
          request.db.insert(input.productId);
          const userId: string = request.session.user.id;
          const storeName: string = request.env.STORE_NAME;

          // @ts-expect-error provider shape exposes `cart`, not a renamed `basket`.
          request.db.basket.push(input.productId);
          // @ts-expect-error authenticated access makes user.id a string, not a number.
          const invalidUserId: number = request.session.user.id;
          // @ts-expect-error only declared mutation errors are accepted.
          context.fail('RENAMED_ERROR', {});
          context.fail('OUT_OF_STOCK', { available: request.db.cart.length });

          return { count: request.db.cart.length, storeName, userId };
        },
      }),
      'cart/add',
    );
    const AddToCartForm = component({
      mutations: { add },
      render(_queries, _state, { forms }) {
        const failure = forms.add.failure;
        if (failure?.code === 'OUT_OF_STOCK') {
          const available: number = failure.payload.available;
          // @ts-expect-error the declared payload field is `available`.
          void failure.payload.remaining;
          void available;
        }
        const submittedProductId: string | undefined =
          forms.add.submitted?.productId;
        // @ts-expect-error submitted fields come from the mutation input schema.
        void forms.add.submitted?.renamedProductId;
        // @ts-expect-error form error codes follow the mutation declaration.
        if (failure?.code === 'RENAMED_ERROR') void failure;
        return { failure, submittedProductId };
      },
    });
    type AddFailure = FormFailure<typeof add>;
    const typedFailure: AddFailure = {
      code: 'OUT_OF_STOCK',
      payload: { available: 0 },
    };
    const assertRenamedFailure = () => {
      const invalid: AddFailure = {
        // @ts-expect-error mutation error codes are declaration-derived.
        code: 'RENAMED_ERROR',
        payload: { available: 0 },
      };
      return invalid;
    };

    const cartQuery = assignDerivedQueryKey(
      contract.query({
        access: [contract.authenticated],
        load(_input, context) {
          const stock: number = context.db.select();
          const userId: string = context.session.user.id;
          const storeName: string = context.env.STORE_NAME;

          // @ts-expect-error query loaders receive Reader<Db>, not the write handle.
          context.db.insert(userId);
          // @ts-expect-error query loaders cannot open a nested transaction.
          context.request.db.transaction((tx) => tx);

          return { stock, storeName };
        },
        reads: [cart],
      }),
      'cart',
    );

    const CartLayout = contract.layout({
      access: [authenticatedAdmin],
      render(_queries, _state, { children, request }) {
        const userId: string = request.session.user.id;
        // @ts-expect-error layouts receive the read-only DB projection.
        request.db.insert('p1');
        const stock: number = request.db.select();
        return renderedHtml(
          `${String(children)}:${userId}:${stock}:${request.env.STORE_NAME}`,
        );
      },
    });
    const cartRoute = contract.route('/cart', {
      access: [authenticatedAdmin],
      layout: CartLayout,
      page(_context, request) {
        const stock: number = request.db.select();
        const userId: string = request.session.user.id;

        // @ts-expect-error app-scoped route pages receive Reader<Db>.
        request.db.insert('p1');
        // @ts-expect-error provider shape exposes `user.id`, not `user.uuid`.
        void request.session.user.uuid;

        return renderedHtml(`${stock}:${userId}`);
      },
    });

    const app = resolveKovoAppToken(
      contract.assemble({
        layouts: [CartLayout],
        mutations: [add],
        queries: [cartQuery],
        routes: [cartRoute],
      }),
      'app-authoring inference test',
    );
    expect(app.queries.map((candidate) => candidate.key)).toEqual(['cart']);
    expect(app.mutations.map((candidate) => candidate.key)).toEqual(['cart/add']);
    expect(app.routes.map((candidate) => candidate.path)).toEqual(['/cart']);
    expect(AddToCartForm.definition.mutations?.add).toBe(add);
    expect(typedFailure.payload).toEqual({ available: 0 });
    expect(assertRenamedFailure).toBeTypeOf('function');
  });

  it('types mutation handler db as transaction-scoped without a transaction opener', () => {
    type AppDb = {
      cart: string[];
      insert(productId: string): void;
      transaction<Result>(run: (tx: unknown) => Result): Result;
    };

    const assertMutationDb = (db: MutationRequestDb<AppDb>) => {
      db.insert('p1');
      const cart: string[] = db.cart;

      // @ts-expect-error mutation handler db is already transaction-scoped.
      db.transaction((tx) => tx);

      return cart;
    };

    const contract = defineKovo({
      appId: '90d1c7dd-a54a-4cd7-a6c2-e05bb4f19f21',
      db: (): AppDb => ({
        cart: [],
        insert(productId) {
          this.cart.push(productId);
        },
        transaction(run) {
          return run({});
        },
      }),
      egress: { enabled: false, justification: 'isolated authoring-context test' },
    });
    const add = assignDerivedMutationKey(
      contract.mutation({
        access: publicAccess('public transaction typing fixture'),
        csrf: false,
        csrfJustification: 'test fixture uses a non-browser caller',
        input: s.object({ productId: s.string() }),
        handler(input, request) {
          request.db.insert(input.productId);
          const cart: string[] = request.db.cart;
          assertMutationDb(request.db);

          // @ts-expect-error SPEC §10.3: handler db hides the raw transaction opener.
          request.db.transaction((tx) => tx);

          return { count: cart.length };
        },
      }),
      'cart/add-tx-typed',
    );

    const app = resolveKovoAppToken(
      contract.assemble({ mutations: [add] }),
      'app-authoring transaction test',
    );
    expect(app.mutations.map((candidate) => candidate.key)).toEqual(['cart/add-tx-typed']);
  });
});
