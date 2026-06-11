import { component } from '@jiso/core';
import type { OptimisticPlan } from '@jiso/runtime';
import {
  domain,
  errorBoundary,
  type FileLike,
  guards,
  i18n,
  meta,
  metaFromQuery,
  mutation,
  query,
  renderMutationEndpointResponse,
  renderPageHints,
  s,
  session,
  t,
  type MutationFail,
  type MutationWireHeaderSource,
} from '@jiso/server';
import type { FwExplainInput } from '../../../packages/cli/src/index.js';
import { commerceTouchGraph } from './generated/touch-graph.js';

export { commerceTouchGraph } from './generated/touch-graph.js';

export interface CommerceDb {
  cartItems: { productId: string; qty: number; unitPrice: number }[];
  orders: { id: string; productId: string; qty: number; total: number; userId: string }[];
  products: Map<string, { id: string; stock: number; unitPrice: number }>;
  read(table: string): unknown[];
  transaction<Result>(run: (db: CommerceDb) => Promise<Result>): Promise<Result>;
  write(table: string, value: unknown): void;
}

export interface CommerceRequest {
  db: CommerceDb;
  session?: { id?: string; user?: { id: string } | null } | null;
}

export const commerceSession = session(
  s.object({
    id: s.string(),
    user: s.object({
      id: s.string(),
    }),
  }),
);

export function createCommerceDb(): CommerceDb {
  const db: CommerceDb = {
    cartItems: [],
    orders: [],
    products: new Map([
      ['p1', { id: 'p1', stock: 5, unitPrice: 1499 }],
      ['p2', { id: 'p2', stock: 2, unitPrice: 2599 }],
      ['p3', { id: 'p3', stock: 8, unitPrice: 399 }],
    ]),
    read(table) {
      if (table === 'cart_items') return db.cartItems;
      if (table === 'orders') return db.orders;
      if (table === 'products') return [...db.products.values()];
      return [];
    },
    async transaction(run) {
      const draft = cloneCommerceDb(db);
      const result = await run(draft);

      db.cartItems = draft.cartItems;
      db.orders = draft.orders;
      db.products = draft.products;

      return result;
    },
    write(table, value) {
      if (table === 'cart_items') {
        db.cartItems.push(value as { productId: string; qty: number; unitPrice: number });
      }
      if (table === 'orders') {
        db.orders.push(
          value as { id: string; productId: string; qty: number; total: number; userId: string },
        );
      }
      if (table === 'products') {
        const product = value as { id: string; stock: number; unitPrice: number };
        db.products.set(product.id, product);
      }
    },
  };
  return db;
}

function cloneCommerceDb(source: CommerceDb): CommerceDb {
  const clone = createCommerceDb();

  clone.cartItems = source.cartItems.map((item) => ({ ...item }));
  clone.orders = source.orders.map((item) => ({ ...item }));
  clone.products = new Map(
    [...source.products.entries()].map(([key, value]) => [key, { ...value }]),
  );
  if (Object.hasOwn(source.products, 'values')) {
    const values = Reflect.get(source.products, 'values') as typeof source.products.values;
    clone.products.values = values.bind(source.products) as typeof clone.products.values;
  }

  return clone;
}

export const cart = domain('cart');
export const order = domain('order');
export const product = domain('product');

export const cartQuery = query('cart', {
  load: (_input: unknown) => ({ count: 1 }),
  reads: [cart],
});

export interface ProductGridInput {
  after?: string;
  limit?: number;
}

export interface ProductGridResult {
  items: { id: string; stock: number; unitPrice: number }[];
  nextCursor: string | null;
}

export interface AddToCartInput {
  productId: string;
  quantity: number;
}

export interface UploadReceiptInput {
  orderId: string;
  receipt: FileLike;
}

export interface CartQueryResult {
  count: number;
}

export type AddToCartFailure = MutationFail<string, unknown>;
export interface AddToCartFailureState {
  failure: AddToCartFailure;
  productId?: string;
}

export const productGridQuery = query('productGrid', {
  load: (input: unknown) => loadProductGrid(createCommerceDb(), input as ProductGridInput),
  reads: [product],
});

export const orderHistoryQuery = query('orderHistory', {
  load: (_input: unknown) => ({ items: [] as CommerceDb['orders'] }),
  reads: [order],
});

export const addToCartOptimistic = {
  queue: 'cart',
  transforms: {
    cart(current: unknown, input: AddToCartInput) {
      const cart = current as CartQueryResult | undefined;
      return {
        count: (cart?.count ?? 0) + input.quantity,
      };
    },
  },
} satisfies OptimisticPlan<AddToCartInput>;

export const addToCart = mutation('cart/add', {
  errors: {
    OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
  },
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1),
  }),
  guard: guards.all(
    guards.authed<CommerceRequest>(),
    guards.rateLimit<CommerceRequest>({ max: 10, per: 'session' }),
  ),
  registry: {
    inferredTouches: commerceTouchGraph['cart.addItem'].touches,
    queries: [cartQuery, productGridQuery, orderHistoryQuery],
  },
  transaction(request: CommerceRequest, run) {
    return request.db.transaction((db) => run({ ...request, db }));
  },
  handler(input, request: CommerceRequest, context) {
    const currentSession = commerceSession.parse(request);
    const found = request.db.products.get(input.productId);
    if (!found || found.stock < input.quantity) {
      return context.fail('OUT_OF_STOCK', { availableQuantity: found?.stock ?? 0 });
    }

    request.db.write('cart_items', {
      productId: input.productId,
      qty: input.quantity,
      unitPrice: found.unitPrice,
    });
    request.db.write('orders', {
      id: `order-${request.db.orders.length + 1}`,
      productId: input.productId,
      qty: input.quantity,
      total: found.unitPrice * input.quantity,
      userId: currentSession.user.id,
    });
    request.db.write('products', {
      ...found,
      stock: found.stock - input.quantity,
    });
    return { productId: input.productId, quantity: input.quantity };
  },
});

export const uploadReceipt = mutation('order/receipt', {
  input: s.object({
    orderId: s.string(),
    receipt: s.file({ maxBytes: 64 * 1024, mime: ['application/pdf', 'image/png'] }),
  }),
  guard: guards.all(
    guards.authed<CommerceRequest>(),
    guards.rateLimit<CommerceRequest>({ max: 5, per: 'session' }),
  ),
  handler(input: UploadReceiptInput, request: CommerceRequest) {
    const currentSession = commerceSession.parse(request);

    return {
      fileName: input.receipt.name,
      orderId: input.orderId,
      size: input.receipt.size,
      uploadedBy: currentSession.user.id,
    };
  },
});

export const commerceMessages = i18n('en-US', {
  cartLabel: 'Cart',
  productStock: '{count} in stock',
});

export const commerceStylesheets = ['/assets/tailwind.css'] as const;

export const commerceMeta = metaFromQuery(cartQuery, (cart) =>
  meta({
    description: `Browse products and checkout with ${cart.count} verifiable cart item.`,
    title: `Jiso Commerce (${cart.count})`,
  }),
);

export function loadProductGrid(db: CommerceDb, input: ProductGridInput = {}): ProductGridResult {
  const limit = input.limit ?? 2;
  const products = [...db.products.values()].sort((left, right) => left.id.localeCompare(right.id));
  const start = input.after
    ? Math.max(products.findIndex((item) => item.id === input.after) + 1, 0)
    : 0;
  const items = products.slice(start, start + limit);
  const next = products[start + limit];

  return {
    items,
    nextCursor: next ? (items.at(-1)?.id ?? null) : null,
  };
}

export function loadCartQuery(db: CommerceDb): CartQueryResult {
  return {
    count: db.cartItems.reduce((total, item) => total + item.qty, 0),
  };
}

export function renderProductGrid(result: ProductGridResult): string {
  const items = result.items.map((item) => renderProductCard(item)).join('');
  const more = result.nextCursor
    ? `<a href="/products?after=${result.nextCursor}" data-cursor="${result.nextCursor}">More</a>`
    : '';

  return `<section fw-c="product-grid" fw-deps="product" data-page-cursor="${result.nextCursor ?? ''}">${items}${more}</section>`;
}

export function renderProductGridAppend(result: ProductGridResult): string {
  const items = result.items.map((item) => renderProductCard(item)).join('');
  const more = result.nextCursor
    ? `<a href="/products?after=${result.nextCursor}" data-cursor="${result.nextCursor}">More</a>`
    : '';

  return `${items}${more}`;
}

export function renderProductGridPageFragment(
  db: CommerceDb,
  input: ProductGridInput = {},
): string {
  return `<fw-fragment target="product-grid" mode="append">${renderProductGridAppend(loadProductGrid(db, input))}</fw-fragment>`;
}

function renderProductCard(
  item: { id: string; stock: number },
  failure?: AddToCartFailure,
): string {
  return [
    `<article data-key="${item.id}" class="rounded border border-slate-200 bg-white p-4">`,
    `<h2 class="font-semibold">${item.id}</h2>`,
    `<p data-bind="productGrid.items.stock">${item.stock} in stock</p>`,
    renderAddToCartForm(item, failure),
    '</article>',
  ].join('');
}

export function renderAddToCartForm(
  item: { id: string; stock: number },
  failure?: AddToCartFailure,
): string {
  const error = failure ? renderAddToCartError(failure) : '';

  return [
    [
      '<form method="post" action="/_m/cart/add" enhance data-mutation="cart/add"',
      `fw-fragment-target="${escapeAttribute(productFormTarget(item.id))}"`,
      'class="mt-3 flex flex-wrap items-end gap-2">',
    ].join(' '),
    `<input type="hidden" name="productId" value="${escapeAttribute(item.id)}">`,
    '<label class="grid gap-1 text-xs font-medium text-slate-700"><span>Qty</span>',
    `<input class="w-16 rounded border border-slate-300 px-2 py-1" name="quantity" type="number" min="1" max="${item.stock}" value="1">`,
    '</label>',
    '<button class="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white" type="submit">Add</button>',
    error,
    '</form>',
  ].join('');
}

function renderAddToCartError(failure: AddToCartFailure): string {
  if (failure.error.code === 'OUT_OF_STOCK') {
    const payload = failure.error.payload as { availableQuantity?: number };
    return `<output role="alert" data-error-code="OUT_OF_STOCK" class="basis-full text-sm text-red-700">Only ${payload.availableQuantity ?? 0} available.</output>`;
  }

  return `<output role="alert" data-error-code="${escapeAttribute(failure.error.code)}" class="basis-full text-sm text-red-700">Unable to add this item.</output>`;
}

export function renderOrderHistory(db: CommerceDb): string {
  const items = db.orders
    .map((item) => `<li data-key="${item.id}">${item.productId} x ${item.qty} - ${item.total}</li>`)
    .join('');

  return `<ol fw-c="order-history" fw-deps="order">${items}</ol>`;
}

export function renderReceiptUploadForm(orderId = 'order-1'): string {
  return [
    '<form method="post" action="/_m/order/receipt" enhance data-mutation="order/receipt" enctype="multipart/form-data" fw-deps="order" class="mt-4 grid gap-2 rounded border border-slate-200 bg-white p-4" aria-busy="false">',
    `<input type="hidden" name="orderId" value="${escapeAttribute(orderId)}">`,
    '<label class="grid gap-1 text-sm font-medium text-slate-700"><span>Receipt</span>',
    '<input name="receipt" type="file" accept="application/pdf,image/png" class="rounded border border-slate-300 px-2 py-1">',
    '</label>',
    '<progress fw-upload-progress value="0" max="100" class="h-2 w-full" aria-label="Receipt upload progress"></progress>',
    '<button class="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white" type="submit">Upload receipt</button>',
    '</form>',
  ].join('');
}

export const CartBadge = component('cart-badge', {
  fragmentTarget: true,
  queries: { cart: cartQuery },
  state: () => ({}),
  render: () =>
    `<cart-badge class="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm" fw-deps="cart"><span>${t(commerceMessages, 'cartLabel')}</span><span class="rounded bg-teal-600 px-2 py-0.5 text-white" data-bind="cart.count">1</span></cart-badge>`,
});

export function renderCommercePageHints(cart: CartQueryResult = cartQuery.load({})) {
  return renderPageHints(
    {
      i18n: commerceMessages,
      meta: commerceMeta,
      stylesheets: commerceStylesheets,
    },
    { queries: { cart } },
  );
}

export const commercePageHints = renderCommercePageHints();

export function renderCartPage(
  db = createCommerceDb(),
  addToCartFailure?: AddToCartFailureState,
): string {
  const pageHints = renderCommercePageHints(loadCartQuery(db));
  const productGrid = renderProductGridWithFailure(loadProductGrid(db), addToCartFailure);
  return `<html><head>${pageHints.html}</head><body class="min-h-dvh bg-slate-50 p-6"><main class="mx-auto max-w-4xl"><fw-fragment target="cart-badge">${CartBadge.definition.render()}</fw-fragment><fw-fragment target="product-grid">${productGrid}</fw-fragment><fw-fragment target="order-history">${renderOrderHistory(db)}${renderReceiptUploadForm()}</fw-fragment></main></body></html>`;
}

function renderProductGridWithFailure(
  result: ProductGridResult,
  addToCartFailure?: AddToCartFailureState,
): string {
  if (!addToCartFailure) return renderProductGrid(result);

  const items = result.items
    .map((item) =>
      renderProductCard(
        item,
        addToCartFailure.productId === item.id ? addToCartFailure.failure : undefined,
      ),
    )
    .join('');
  const more = result.nextCursor
    ? `<a href="/products?after=${result.nextCursor}" data-cursor="${result.nextCursor}">More</a>`
    : '';

  return `<section fw-c="product-grid" fw-deps="product" data-page-cursor="${result.nextCursor ?? ''}">${items}${more}</section>`;
}

export function submitAddToCartNoJs(rawInput: unknown, request: CommerceRequest) {
  return submitAddToCart(rawInput, request, {});
}

export function submitAddToCart(
  rawInput: unknown,
  request: CommerceRequest,
  headers: MutationWireHeaderSource,
) {
  const productId = productIdFromRawInput(rawInput);
  return renderMutationEndpointResponse(addToCart, {
    failureTarget: productId ? productFormTarget(productId) : 'product-form',
    fragmentRenderers: [
      {
        render: () => CartBadge.definition.render(),
        stylesheets: commerceStylesheets,
        target: 'cart-badge',
      },
      errorBoundary(
        {
          render: () => renderProductGrid(loadProductGrid(request.db)),
          stylesheets: commerceStylesheets,
          target: 'product-grid',
        },
        {
          render(error) {
            return `<section role="alert" class="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">Product grid failed: ${escapeHtml((error as Error).message)}</section>`;
          },
        },
      ),
      {
        render: () => renderOrderHistory(request.db),
        stylesheets: commerceStylesheets,
        target: 'order-history',
      },
    ],
    headers,
    rawInput,
    redirectTo: '/cart',
    renderFailureFragment: (failure) =>
      renderAddToCartFailureFragment(request.db, rawInput, failure),
    renderFailurePage: (failure) =>
      renderCartPage(request.db, {
        failure,
        productId,
      }),
    request,
  });
}

function renderAddToCartFailureFragment(
  db: CommerceDb,
  rawInput: unknown,
  failure: AddToCartFailure,
): string {
  const productId = productIdFromRawInput(rawInput);
  const product = productId ? db.products.get(productId) : undefined;

  if (!product) return renderAddToCartError(failure);

  return renderAddToCartForm(product, failure);
}

function productFormTarget(productId: string): string {
  return `product-form:${productId}`;
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function productIdFromRawInput(rawInput: unknown): string | undefined {
  if (typeof rawInput !== 'object' || rawInput === null || !('productId' in rawInput)) {
    return undefined;
  }
  const productId = rawInput.productId;
  return typeof productId === 'string' ? productId : undefined;
}

export const commerceGraph = {
  components: [
    {
      fragments: ['cart-badge'],
      name: 'CartBadge',
      queries: ['cart'],
    },
    {
      fragments: ['product-grid'],
      name: 'ProductGrid',
      queries: ['productGrid'],
    },
    {
      fragments: ['order-history'],
      name: 'OrderHistory',
      queries: ['orderHistory'],
    },
  ],
  mutations: [
    {
      guards: ['authed', 'rateLimit:session'],
      invalidates: ['cart', 'product', 'order'],
      inputFields: ['productId', 'quantity'],
      key: 'cart/add',
      session: 'commerceSession',
      writes: ['cart', 'product', 'order'],
    },
    {
      enctype: 'multipart/form-data',
      fileFields: ['receipt'],
      guards: ['authed', 'rateLimit:session'],
      inputFields: ['orderId', 'receipt'],
      key: 'order/receipt',
      session: 'commerceSession',
    },
  ],
  optimistic: [
    { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
    { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
    { mutation: 'cart/add', query: 'orderHistory', status: 'await-fragment' },
  ],
  pages: [
    {
      i18n: ['en-US:cartLabel,productStock'],
      meta: {
        description: 'Browse products and checkout with 1 verifiable cart item.',
        title: 'Jiso Commerce (1)',
      },
      modulepreloads: [],
      prefetch: false,
      queries: ['cart', 'productGrid', 'orderHistory'],
      route: '/cart',
      stylesheets: [...commerceStylesheets],
    },
  ],
  queries: [
    { domains: ['cart'], query: 'cart' },
    { domains: ['product'], query: 'productGrid' },
    { domains: ['order'], query: 'orderHistory' },
  ],
  touchGraph: commerceTouchGraph,
} satisfies FwExplainInput;
