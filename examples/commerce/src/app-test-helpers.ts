import { headerValues, setCookieValues } from '@kovojs/test/headers';
import { type StructuralMorphNode } from '@kovojs/runtime';
import { csrfToken } from '@kovojs/server';
import { htmlFormFacts, htmlFormFieldsByName } from '@kovojs/test/html-fragment';
import { eq } from 'drizzle-orm';

import {
  commerceAuthCsrf,
  createCommerceDb,
  type AddToCartInput,
  type CommerceDb,
  type ProductGridInput,
} from './app.js';
import {
  createCommerceAppShell,
  type CommerceAppShell,
} from './app-shell.js';
import { cartItems, orders, products } from './schema.js';

// SPEC.md §14: the test DB is real Drizzle/PGlite, so tests seed and read rows
// with Drizzle statements (the old in-memory array/Map accessors are gone).
// These helpers keep the per-test seeding/assertion churn small.

export type ProductRow = { id: string; stock: number; unitPrice: number };
export type CartItemRow = { productId: string; qty: number; unitPrice: number };
export type OrderRow = {
  id: string;
  productId: string;
  qty: number;
  total: number;
  userId: string;
};

/** Replace the entire product catalog with `rows` (clears the p1/p2/p3 seed). */
export async function resetProducts(db: CommerceDb, rows: readonly ProductRow[]): Promise<void> {
  await db.delete(products);
  for (const row of rows) await db.insert(products).values(row);
}

export async function seedCartItems(db: CommerceDb, rows: readonly CartItemRow[]): Promise<void> {
  for (const row of rows) await db.insert(cartItems).values(row);
}

export async function seedOrders(db: CommerceDb, rows: readonly OrderRow[]): Promise<void> {
  for (const row of rows) await db.insert(orders).values(row);
}

export async function readProducts(db: CommerceDb): Promise<ProductRow[]> {
  return db
    .select({ id: products.id, stock: products.stock, unitPrice: products.unitPrice })
    .from(products)
    .orderBy(products.id);
}

export async function readCartItems(db: CommerceDb): Promise<CartItemRow[]> {
  return db
    .select({ productId: cartItems.productId, qty: cartItems.qty, unitPrice: cartItems.unitPrice })
    .from(cartItems)
    .orderBy(cartItems.id);
}

export async function readOrders(db: CommerceDb): Promise<OrderRow[]> {
  return db
    .select({
      id: orders.id,
      productId: orders.productId,
      qty: orders.qty,
      total: orders.total,
      userId: orders.userId,
    })
    .from(orders)
    .orderBy(orders.id);
}

export async function readProduct(db: CommerceDb, id: string): Promise<ProductRow | undefined> {
  return (await db.select().from(products).where(eq(products.id, id)).limit(1))[0];
}

/**
 * Replace ALL commerce rows with the given state in a single pass. Lets a test
 * reuse one PGlite instance across many property cases (creating a fresh db per
 * case is far slower than truncate + reseed).
 */
export async function seedCommerceState(
  db: CommerceDb,
  state: {
    cartItems?: readonly CartItemRow[];
    orders?: readonly OrderRow[];
    products?: readonly ProductRow[];
  },
): Promise<void> {
  await db.delete(cartItems);
  await db.delete(orders);
  await db.delete(products);
  for (const row of state.products ?? []) await db.insert(products).values(row);
  for (const row of state.cartItems ?? []) await db.insert(cartItems).values(row);
  for (const row of state.orders ?? []) await db.insert(orders).values(row);
}

export interface CommerceAddToCartPropertyState {
  cartItems: { productId: string; qty: number }[];
  products: Record<string, { stock: number }>;
}

export function applyCommerceAddToCartEffect(
  state: CommerceAddToCartPropertyState,
  input: AddToCartInput,
): CommerceAddToCartPropertyState {
  const product = state.products[input.productId];
  if (!product || product.stock < input.quantity) {
    throw new Error(`Invalid property case for ${input.productId}`);
  }

  return {
    cartItems: [...state.cartItems, { productId: input.productId, qty: input.quantity }],
    products: {
      ...state.products,
      [input.productId]: {
        stock: product.stock - input.quantity,
      },
    },
  };
}

export function shapeCommerceCartQuery(state: CommerceAddToCartPropertyState): { count: number } {
  return {
    count: state.cartItems.reduce((total, item) => total + item.qty, 0),
  };
}

export function commerceAddToCartPropertyCases(): {
  input: AddToCartInput;
  state: CommerceAddToCartPropertyState;
}[] {
  const cases: { input: AddToCartInput; state: CommerceAddToCartPropertyState }[] = [];

  for (const productId of ['p1', 'p2']) {
    for (const quantity of [1, 2, 3]) {
      for (const initialCount of [0, 1, 5]) {
        cases.push({
          input: { productId, quantity },
          state: {
            cartItems: initialCount === 0 ? [] : [{ productId: 'existing', qty: initialCount }],
            products: {
              p1: { stock: 6 },
              p2: { stock: 4 },
            },
          },
        });
      }
    }
  }

  return cases;
}

export function queryContext(db = createCommerceDb()) {
  return {
    db,
    request: { db, session: { id: 's-query', user: { id: 'u-query' } } },
  };
}

export function commerceAuthRequest(cookie?: string, db = createCommerceDb()) {
  const headers = new Headers({ 'user-agent': 'commerce-auth-test' });
  if (cookie) headers.set('cookie', cookie);

  return {
    authCsrfId: 'login-csrf',
    db,
    headers,
  };
}

export function setCookieHeaders(response: {
  headers: Record<string, string | string[]>;
}): string[] {
  return setCookieValues(response.headers);
}

export function mutationSetCookieHeaders(result: {
  responseHeaders?: Record<string, string | string[]>;
}): string[] {
  return headerValues(result.responseHeaders, 'Set-Cookie');
}

export function keyedListNode(
  type: string,
  keys: readonly string[],
  stateByKey: Record<string, StructuralMorphNode['browserState']> = {},
): StructuralMorphNode {
  return {
    children: keys.map((key) => ({
      ...(stateByKey[key] ? { browserState: stateByKey[key] } : {}),
      key,
      props: { 'kovo-key': key },
      text: key,
      type: 'li',
    })),
    type,
  };
}

export function productGridInput(after: string | null, limit?: number): ProductGridInput {
  return {
    ...(after ? { after } : {}),
    ...(limit === undefined ? {} : { limit }),
  };
}

export interface CommerceScenarioClient {
  readonly shell: CommerceAppShell;
  get(path: string, options?: CommerceScenarioRequestOptions): Promise<Response>;
  postForm(
    path: string,
    fields: Record<string, string | number>,
    options?: CommerceScenarioRequestOptions,
  ): Promise<Response>;
  signIn(options?: { next?: string; password?: string; remoteAddress?: string }): Promise<Response>;
  signOut(): Promise<Response>;
  addToCartEnhanced(
    input: AddToCartInput,
    options?: CommerceScenarioEnhancedOptions,
  ): Promise<Response>;
  addToCartNoJs(
    input: AddToCartInput,
    options?: CommerceScenarioRequestOptions,
  ): Promise<Response>;
}

export interface CommerceScenarioRequestOptions {
  headers?: HeadersInit;
}

export interface CommerceScenarioEnhancedOptions extends CommerceScenarioRequestOptions {
  target?: 'cart-page' | 'form';
}

const commerceOrigin = 'https://commerce.test';
const cartPageTargets = 'cart-badge=cart; product-grid=productGrid; order-history=orderHistory';
const cartPageLiveTargets = [
  'cart-badge#components/cart-badge/cart-badge:{}',
  'product-grid#components/product-grid/product-grid:{}',
  'order-history#components/order-history/order-history:{}',
].join('; ');

export function createCommerceScenarioClient(
  shell = createCommerceAppShell(),
): CommerceScenarioClient {
  const cookies = new Map<string, string>();

  async function dispatch(
    path: string,
    init: RequestInit = {},
    options: CommerceScenarioRequestOptions = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    mergeHeaders(headers, options.headers);
    const cookie = cookieHeader(cookies);
    if (cookie && !headers.has('cookie')) headers.set('cookie', cookie);

    const request = new Request(new URL(path, commerceOrigin), {
      ...init,
      headers,
      redirect: 'manual',
    });
    const response = await shell.requestHandler(request);
    rememberSetCookies(cookies, response);
    return response;
  }

  async function get(path: string, options?: CommerceScenarioRequestOptions): Promise<Response> {
    return dispatch(path, { method: 'GET' }, options);
  }

  async function postForm(
    path: string,
    fields: Record<string, string | number>,
    options?: CommerceScenarioRequestOptions,
  ): Promise<Response> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
    return dispatch(
      path,
      {
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      },
      options,
    );
  }

  async function signIn(
    options: { next?: string; password?: string; remoteAddress?: string } = {},
  ): Promise<Response> {
    const next = options.next ?? '/cart';
    const loginPage = await get(`/login?next=${encodeURIComponent(next)}`);
    const csrf = await formFieldValue(loginPage, '/_m/auth/sign-in', 'csrf');
    return postForm(
      '/_m/auth/sign-in',
      {
        csrf,
        email: 'ada@example.com',
        next,
        password: options.password ?? 'correct',
      },
      {
        headers: {
          referer: `${commerceOrigin}/login?next=${encodeURIComponent(next)}`,
          'x-forwarded-for': options.remoteAddress ?? '203.0.113.60',
        },
      },
    );
  }

  async function signOut(): Promise<Response> {
    return postForm('/_m/auth/sign-out', {
      csrf: csrfToken(
        {
          authCsrfId: 'commerce-shell-login',
          db: shell.db,
          headers: new Headers({ cookie: cookieHeader(cookies) }),
          session: { id: 'session-u1', user: { id: 'u1' } },
        },
        commerceAuthCsrf,
      ),
    });
  }

  async function addToCartNoJs(
    input: AddToCartInput,
    options?: CommerceScenarioRequestOptions,
  ): Promise<Response> {
    return postForm('/_m/cart/add', await addToCartFields(input), {
      ...options,
      headers: {
        ...headersRecord(options?.headers),
        referer: `${commerceOrigin}/cart`,
      },
    });
  }

  async function addToCartEnhanced(
    input: AddToCartInput,
    options: CommerceScenarioEnhancedOptions = {},
  ): Promise<Response> {
    const targetHeaders =
      options.target === 'form'
        ? {
            'Kovo-Form-Target': 'product-grid',
            'Kovo-Live-Targets': cartPageLiveTargets,
            'Kovo-Targets': 'product-grid=productGrid',
          }
        : {
            'Kovo-Live-Targets': cartPageLiveTargets,
            'Kovo-Targets': cartPageTargets,
          };
    return postForm('/_m/cart/add', await addToCartFields(input), {
      ...options,
      headers: {
        ...headersRecord(options.headers),
        'Kovo-Fragment': 'true',
        referer: `${commerceOrigin}/cart`,
        ...targetHeaders,
      },
    });
  }

  async function addToCartFields(input: AddToCartInput): Promise<Record<string, string | number>> {
    const cartPage = await get('/cart');
    const html = await cartPage.text();
    const fields = formFieldsByName(html, '/_m/cart/add', input.productId);
    const csrf = fields.csrf?.value;
    const formKey = fields['kovo-form-key']?.value;
    if (csrf === undefined) throw new Error('Expected add-to-cart CSRF field');
    if (formKey === undefined) throw new Error('Expected add-to-cart form key field');
    return {
      csrf,
      'kovo-form-key': formKey,
      productId: input.productId,
      quantity: input.quantity,
    };
  }

  return {
    get,
    postForm,
    shell,
    signIn,
    signOut,
    addToCartEnhanced,
    addToCartNoJs,
  };
}

async function formFieldValue(
  response: Response,
  action: string,
  name: string,
  productId?: string,
): Promise<string> {
  const html = await response.text();
  const value = formFieldsByName(html, action, productId)[name]?.value;
  if (value === undefined) {
    throw new Error(`Expected ${action} form field ${name} in response status ${response.status}`);
  }
  return value;
}

function formFieldsByName(
  html: string,
  action: string,
  productId?: string,
): ReturnType<typeof htmlFormFieldsByName> {
  const form = htmlFormFacts(html).find((candidate) => {
    if (candidate.action !== action) return false;
    if (!productId) return true;
    return htmlFormFieldsByName(candidate).productId?.value === productId;
  });
  return htmlFormFieldsByName(form);
}

function rememberSetCookies(cookies: Map<string, string>, response: Response): void {
  for (const setCookie of setCookieValues(response.headers)) {
    const pair = setCookie.split(';', 1)[0] ?? '';
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (value === '') {
      cookies.delete(name);
    } else {
      cookies.set(name, value);
    }
  }
}

function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

function mergeHeaders(target: Headers, source: HeadersInit | undefined): void {
  if (!source) return;
  new Headers(source).forEach((value, key) => target.set(key, value));
}

function headersRecord(source: HeadersInit | undefined): Record<string, string> {
  if (!source) return {};
  return Object.fromEntries(new Headers(source));
}
