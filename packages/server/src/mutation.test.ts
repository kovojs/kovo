import { describe, expect, it } from 'vitest';

import { invalidate } from './change-record.js';
import { domain, tag } from './domain.js';
import { guards } from './guards.js';
import {
  mutationFormAttributes,
  renderMutationFormAttributes,
  renderMutationResponse,
  renderNoJsMutationResponse,
  runMutation,
} from './mutation.js';
import { query } from './query.js';
import { s } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';

describe('server mutation lifecycle', () => {
  it('derives direct-render form attributes from typed mutation values', () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    expect(mutationFormAttributes(addToCart)).toEqual({
      action: '/_m/cart/add',
      'data-mutation': 'cart/add',
      enhance: true,
      method: 'post',
      mutation: addToCart,
    });
    expect(renderMutationFormAttributes(addToCart)).toBe(
      'method="post" action="/_m/cart/add" enhance data-mutation="cart/add"',
    );
  });

  it('returns typed validation failures from ctx.fail', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1).default(1),
      }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1', quantity: 9 }, {})).resolves.toEqual({
      error: {
        code: 'OUT_OF_STOCK',
        payload: { availableQuantity: 0 },
      },
      ok: false,
      status: 422,
    });
  });

  it('composes guards with all()', async () => {
    const guarded = mutation('cart/add', {
      guard: guards.all<{ authed: boolean }>((request) => request.authed),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(runMutation(guarded, { productId: 'p1' }, { authed: false })).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    });
  });

  it('parses mutation input before running guards', async () => {
    let guardCalls = 0;
    const guarded = mutation('cart/add', {
      guard() {
        guardCalls += 1;
        return false;
      },
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(runMutation(guarded, {}, {})).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected string', path: ['productId'] }] },
      },
      ok: false,
      status: 422,
    });
    expect(guardCalls).toBe(0);
  });

  it('runs guarded mutation handlers inside the configured transaction', async () => {
    const events: string[] = [];
    const transactional = mutation('cart/add', {
      guard() {
        events.push('guard');
        return true;
      },
      input: s.object({ productId: s.string() }),
      async transaction(request: { tx?: boolean }, run) {
        events.push('begin');
        const value = await run({ ...request, tx: true });
        events.push('commit');
        return value;
      },
      handler(input, request: { tx?: boolean }) {
        events.push(`handler:${request.tx === true ? 'tx' : 'plain'}`);
        return input.productId;
      },
    });

    await expect(runMutation(transactional, { productId: 'p1' }, {})).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
    expect(events).toEqual(['guard', 'begin', 'handler:tx', 'commit']);
  });

  it('types transaction callbacks with the mutation request shape', async () => {
    interface TxRequest {
      db: {
        txOnly(): void;
        write(table: string): void;
      };
    }

    const events: string[] = [];
    const typeOnly = undefined as unknown as boolean;
    const transactional = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      transaction(request: TxRequest, run) {
        request.db.txOnly();
        if (typeOnly) {
          // @ts-expect-error transaction callbacks must receive the typed request shape.
          void run({ db: { write() {} } });
        }
        return run(request);
      },
      handler(input, request: TxRequest) {
        request.db.txOnly();
        request.db.write('cart_items');
        return input.productId;
      },
    });

    await expect(
      runMutation(
        transactional,
        { productId: 'p1' },
        {
          db: {
            txOnly() {
              events.push('tx');
            },
            write(table) {
              events.push(`write:${table}`);
            },
          },
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
    expect(events).toEqual(['tx', 'tx', 'write:cart_items']);
  });

  it('rolls back configured transactions for typed mutation failures', async () => {
    const events: string[] = [];
    const transactional = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      async transaction(request: {}, run) {
        events.push('begin');
        try {
          return await run(request);
        } catch (error) {
          events.push('rollback');
          throw error;
        }
      },
      handler(_input, _request, context) {
        events.push('handler');
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });

    await expect(runMutation(transactional, { productId: 'p1' }, {})).resolves.toEqual({
      error: {
        code: 'OUT_OF_STOCK',
        payload: { availableQuantity: 0 },
      },
      ok: false,
      status: 422,
    });
    expect(events).toEqual(['begin', 'handler', 'rollback']);
  });

  it('forwards committed mutation Set-Cookie headers in enhanced responses', async () => {
    const signIn = mutation('auth/sign-in', {
      input: s.object({ email: s.string() }),
      handler(input, _request, context) {
        context.setCookie?.('kovo_session=s1; Path=/; HttpOnly; SameSite=Lax');
        context.setCookie?.('kovo_csrf', 'c1', {
          httpOnly: true,
          path: '/',
          sameSite: 'strict',
          secure: true,
        });

        return input.email;
      },
    });

    await expect(
      renderMutationResponse(signIn, {
        rawInput: { email: 'ada@example.test' },
        request: {},
      }),
    ).resolves.toEqual({
      body: '',
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Changes': '[]',
        'Set-Cookie': [
          'kovo_session=s1; Path=/; HttpOnly; SameSite=Lax',
          'kovo_csrf=c1; Path=/; HttpOnly; Secure; SameSite=Strict',
        ],
      },
      status: 200,
    });
  });

  it('forwards committed mutation Set-Cookie headers in no-JS PRG responses', async () => {
    const signOut = mutation('auth/sign-out', {
      input: s.object({}),
      handler(_input, _request, context) {
        context.setCookie?.('kovo_session=; Path=/; Max-Age=0; HttpOnly');
        return 'signed-out';
      },
    });

    await expect(
      renderNoJsMutationResponse(signOut, {
        rawInput: {},
        redirectTo: '/login',
        request: {},
      }),
    ).resolves.toEqual({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/login',
        'Set-Cookie': ['kovo_session=; Path=/; Max-Age=0; HttpOnly'],
      },
      status: 303,
    });
  });

  it('does not leak mutation Set-Cookie headers when the handler returns a typed failure', async () => {
    const signIn = mutation('auth/sign-in', {
      errors: {
        INVALID_CREDENTIALS: s.object({}),
      },
      input: s.object({ email: s.string() }),
      handler(_input, _request, context) {
        context.setCookie?.('kovo_session=s1; Path=/; HttpOnly');
        return context.fail('INVALID_CREDENTIALS', {});
      },
    });

    await expect(
      renderMutationResponse(signIn, {
        rawInput: { email: 'ada@example.test' },
        request: {},
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="error"><output role="alert" data-error-code="INVALID_CREDENTIALS">{}</output></kovo-fragment>',
      headers: { 'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8' },
      status: 422,
    });
  });

  it('derives post-commit rerun queries from declared touches', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        queries: [cartQuery, productQuery],
        touches: [cart],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'cart',
          input: { productId: 'p1' },
        },
      ],
      ok: true,
      rerunQueries: ['cart'],
      value: 'p1',
    });
  });

  it('renders mutation query chunks after the configured transaction commits', async () => {
    const state = { committed: 0, pending: 0 };
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: state.committed }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ quantity: s.number().int().min(1) }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      async transaction(request: {}, run) {
        const result = await run(request);
        state.committed = state.pending;
        return result;
      },
      handler(input) {
        state.pending += input.quantity;
        return input.quantity;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        fragment: true,
        rawInput: { quantity: 2 },
        request: {},
      }),
    ).resolves.toMatchObject({
      body: '<kovo-query name="cart">{"count":2}</kovo-query>',
      status: 200,
    });
  });

  it('reruns post-commit queries with the same request context', async () => {
    interface RequestContext {
      session: {
        cartId: string;
      };
    }

    const cart = domain('cart');
    const cartQuery = query('cart', {
      instanceKey: (_input) => 'cart:c1',
      load(_input, context: { request: RequestContext }) {
        const cartId: string = context.request.session.cartId;
        return { cartId };
      },
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input, request: RequestContext) {
        return `${request.session.cartId}:${input.productId}`;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        fragment: true,
        rawInput: { productId: 'p1' },
        request: { session: { cartId: 'c1' } },
      }),
    ).resolves.toMatchObject({
      body: '<kovo-query name="cart" key="cart:c1">{"cartId":"c1"}</kovo-query>',
      status: 200,
    });
  });

  it('derives post-commit rerun queries from inferred touch sites when touches are absent or empty', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [cartQuery, productQuery],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
        },
      ],
      ok: true,
      rerunQueries: ['product'],
      value: 'p1',
    });

    const addToCartWithEmptyTouches = mutation('cart/add-empty', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [cartQuery, productQuery],
        touches: [],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCartWithEmptyTouches, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
        },
      ],
      ok: true,
      rerunQueries: ['product'],
      value: 'p1',
    });
  });

  it('narrows post-commit rerun query instances by row keys', async () => {
    const product = domain('product');
    const productP1 = query('productDetail', { instanceKey: 'product:p1', reads: [product] });
    const productP2 = query('productDetail', { instanceKey: 'product:p2', reads: [product] });
    const reserveProduct = mutation('product/reserve', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [productP1, productP2],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(reserveProduct, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
        },
      ],
      ok: true,
      rerunQueries: ['productDetail'],
      rerunQueryInstances: [{ instanceKey: 'product:p1', key: 'productDetail' }],
      value: 'p1',
    });
  });

  it('preserves manual invalidations when inferred touch sites are active', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [cartQuery, productQuery],
      },
      handler(input, _request, context) {
        context.invalidate(cart, {
          keys: [input.productId],
          reason: 'cart side effect',
        });
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
        },
        {
          domain: 'cart',
          keys: ['p1'],
          manual: true,
          reason: 'cart side effect',
        },
      ],
      ok: true,
      rerunQueries: ['cart', 'product'],
      value: 'p1',
    });
  });

  it('keeps declared touches authoritative over inferred touch sites', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: null }],
        queries: [cartQuery, productQuery],
        touches: [cart],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'cart',
          input: { productId: 'p1' },
        },
      ],
      ok: true,
      rerunQueries: ['cart'],
      value: 'p1',
    });
  });

  it('uses flat tags as the low-ceremony domain on-ramp', async () => {
    const pricing = tag('pricing');
    const pricingQuery = query('pricing', { reads: [pricing] });
    const recalculate = mutation('pricing/recalculate', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [pricingQuery],
        touches: [pricing],
      },
      handler(input, _request, context) {
        context.invalidate(pricing, {
          keys: [input.productId],
          reason: 'external catalog feed',
        });
        return input.productId;
      },
    });

    await expect(runMutation(recalculate, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'pricing',
          input: { productId: 'p1' },
        },
        {
          domain: 'pricing',
          keys: ['p1'],
          manual: true,
          reason: 'external catalog feed',
        },
      ],
      ok: true,
      rerunQueries: ['pricing'],
      value: 'p1',
    });
    expect(invalidate(pricing, { reason: 'manual price import' })).toEqual({
      domain: 'pricing',
      manual: true,
      reason: 'manual price import',
    });
  });
});
