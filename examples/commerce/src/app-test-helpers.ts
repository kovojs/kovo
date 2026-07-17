import { enhancedMutationHeaders, headerValues, setCookieValues } from '@kovojs/test/headers';
import { csrfToken, readonlyDb, toNodeHandler } from '@kovojs/server';
import { createExampleTestRequestHandler } from '../../../tests/example-raw-request-handler.js';
import { runWithCommerceGeneratedGraphs } from '../../../tests/example-generated-graphs.setup.js';
import { htmlFormFacts, htmlFormFieldsByName } from '@kovojs/test/html-fragment';
import { eq } from 'drizzle-orm';

import {
  commerceAuthCsrf,
  commerceSignOut,
  createCommerceDb,
  type AddToCartInput,
  type CommerceDb,
  type ProductGridInput,
} from './domain.js';
import {
  createCommerceApplication,
  type CommerceAppOptions,
  type CommerceApplication,
} from './app.js';
import { cartQuery, orderHistoryQuery, productGridQuery } from './queries.js';
import { cartItems, orders, products } from './schema.js';
import type { CartQueryResult, OrderHistoryResult, ProductGridResult } from './queries.js';

export type ProductRow = { id: string; stock: number; unitPrice: number };
export type CartItemRow = { productId: string; qty: number; unitPrice: number };
export type OrderRow = {
  id: string;
  productId: string;
  qty: number;
  total: number;
  userId: string;
};
export interface CommerceStructuralNode {
  browserState?: { readonly focused?: boolean; readonly open?: boolean; readonly value?: string };
  children?: readonly CommerceStructuralNode[];
  key?: string;
  props?: Readonly<Record<string, string>>;
  text?: string;
  type: string;
}

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

export function queryContext(db = createCommerceDb()) {
  // SPEC §9.4 (MARQUEE): the loader reads the framework-threaded `context.db`. The request no longer
  // carries the db (the framework owns the handle); it carries only the session for per-user scope.
  return {
    db: readonlyDb(db),
    request: { session: { id: 's-query', user: { id: 'u-query' } } },
  };
}

// Test entrypoints pass a raw `CommerceDb`. Production loaders receive the framework-owned
// read-only handle through `context.db`; these helpers mirror that by wrapping with `readonlyDb`.
export async function loadCartQuery(db: CommerceDb): Promise<CartQueryResult> {
  return cartQuery.load(undefined, { db: readonlyDb(db), request: {} });
}

export async function loadProductGrid(
  db: CommerceDb,
  input: ProductGridInput = {},
): Promise<ProductGridResult> {
  return productGridQuery.load(input, { db: readonlyDb(db), request: {} });
}

export async function loadOrderHistory(
  db: CommerceDb,
  userId: string,
): Promise<OrderHistoryResult> {
  const session = { id: userId, user: { id: userId } };
  return orderHistoryQuery.load(undefined, { db: readonlyDb(db), request: { session }, session });
}

export function commerceAuthRequest(cookie?: string, db = createCommerceDb()) {
  const headers = new Headers({ 'user-agent': 'commerce-auth-test' });
  if (cookie) headers.set('cookie', cookie);

  return {
    authCsrfId: 'login-csrf',
    clientIp: '203.0.113.10',
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
  stateByKey: Record<string, CommerceStructuralNode['browserState']> = {},
): CommerceStructuralNode {
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
  readonly shell: CommerceTestApp;
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
  addToCartNoJs(input: AddToCartInput, options?: CommerceScenarioRequestOptions): Promise<Response>;
}

export interface CommerceScenarioRequestOptions {
  headers?: HeadersInit;
}

export interface CommerceScenarioEnhancedOptions extends CommerceScenarioRequestOptions {
  target?: 'cart-page' | 'form';
}

const commerceOrigin = 'https://commerce.test';
export interface CommerceTestApp extends CommerceApplication {
  nodeHandler: ReturnType<typeof toNodeHandler>;
  requestHandler: ReturnType<typeof createExampleTestRequestHandler>;
}

/** Vitest-only raw dispatch seam; production entries retain the guarded public wrapper. */
export function createCommerceTestApp(options: CommerceAppOptions = {}): CommerceTestApp {
  return runWithCommerceGeneratedGraphs(() => {
    const application = createCommerceApplication(options);
    const requestHandler = createExampleTestRequestHandler(application.app);
    return { ...application, nodeHandler: toNodeHandler(requestHandler), requestHandler };
  });
}

export function createCommerceScenarioClient(
  shell = createCommerceTestApp(),
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
    // SPEC §6.6/§9.1: the CSRF Origin floor rejects unsafe-verb requests without a usable, same-origin
    // `Origin` header. A real browser always sends it; `fetch`/`new Request` in Node do not, so the
    // scenario client supplies the same-origin value the floor expects (mirrors a browser submit).
    if (!headers.has('origin')) headers.set('origin', commerceOrigin);

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
      // SPEC §6.5/§9.1 (audit trap #3): bind the hand-minted logout token to the sign-out mutation
      // so its audience matches the `{ audience: 'auth/sign-out' }` dispatch validates against.
      csrf: csrfToken(
        {
          authCsrfId: 'commerce-shell-login',
          db: shell.db,
          headers: new Headers({ cookie: cookieHeader(cookies) }),
          session: { id: 'session-u1', user: { id: 'u1' } },
        },
        commerceAuthCsrf,
        { mutation: commerceSignOut },
      ),
    });
  }

  async function addToCartNoJs(
    input: AddToCartInput,
    options?: CommerceScenarioRequestOptions,
  ): Promise<Response> {
    return postForm('/_m/domain/add-to-cart', await addToCartFields(input), {
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
    const cartPage = await get('/cart');
    const snapshot = cartPageLiveTargetSnapshot(await cartPage.text());
    const targetHeaders =
      options.target === 'form'
        ? enhancedMutationHeaders({
            formTarget: 'product-grid',
            liveTargets: snapshot.liveTargets,
            targets: snapshot.targets.filter((target) => target.target === 'product-grid'),
          })
        : enhancedMutationHeaders({
            liveTargets: snapshot.liveTargets,
            targets: snapshot.targets,
          });
    return postForm('/_m/domain/add-to-cart', await addToCartFields(input), {
      ...options,
      headers: {
        ...headersRecord(options.headers),
        referer: `${commerceOrigin}/cart`,
        ...targetHeaders,
      },
    });
  }

  async function addToCartFields(input: AddToCartInput): Promise<Record<string, string | number>> {
    const productId = typeof input.productId === 'string' ? input.productId : undefined;
    const quantity = typeof input.quantity === 'number' ? input.quantity : undefined;
    if (productId === undefined) throw new Error('Expected add-to-cart productId input');
    if (quantity === undefined) throw new Error('Expected add-to-cart quantity input');
    const cartPage = await get('/cart');
    const html = await cartPage.text();
    const fields = formFieldsByName(html, '/_m/domain/add-to-cart', productId);
    const csrf = fields.csrf?.value;
    const formKey = fields['kovo-form-key']?.value;
    if (csrf === undefined) throw new Error('Expected add-to-cart CSRF field');
    if (formKey === undefined) throw new Error('Expected add-to-cart form key field');
    return {
      csrf,
      'kovo-form-key': formKey,
      productId,
      quantity,
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

interface HtmlLiveTargetSnapshot {
  liveTargets: string[];
  targets: { queries: string; target: string }[];
}

function cartPageLiveTargetSnapshot(html: string): HtmlLiveTargetSnapshot {
  const liveTargets: string[] = [];
  const targets: { queries: string; target: string }[] = [];
  for (const match of html.matchAll(/<[^>]*\bkovo-deps=(?:"[^"]*"|'[^']*')[^>]*>/g)) {
    const attrs = readTagAttributes(match[0]);
    const target = attrs['kovo-fragment-target'] ?? attrs.id ?? attrs['kovo-c'];
    const queries = readDeps(attrs['kovo-deps']);
    if (!target || queries.length === 0) continue;

    targets.push({ queries: queries.join(' '), target });

    const component = attrs['kovo-live-component'];
    const token = attrs['kovo-live-token'];
    if (!target || !component || !token) continue;
    liveTargets.push(`${target}#${component}@${token}:${attrs['kovo-props'] ?? '{}'}`);
  }
  return { liveTargets, targets: dedupeTargets(targets) };
}

function dedupeTargets(
  targets: { queries: string; target: string }[],
): { queries: string; target: string }[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.target}=${target.queries}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readDeps(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((dep) => dep.trim())
    .filter(Boolean);
}

function readTagAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/\s([A-Za-z_:][\w:.-]*)=(?:"([^"]*)"|'([^']*)')/g)) {
    const name = match[1];
    if (!name) continue;
    attrs[name] = decodeHtmlAttribute(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
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
