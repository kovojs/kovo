import { createHmac } from 'node:crypto';

import { headerValues, setCookieValues } from '@jiso/test/headers';
import { type StructuralMorphNode } from '@jiso/runtime';

import { createCommerceDb, type AddToCartInput, type ProductGridInput } from './app.js';

export function commerceFile(name: string, type: string, size: number) {
  return {
    async arrayBuffer() {
      return new ArrayBuffer(size);
    },
    name,
    size,
    type,
  };
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

export function stripeHeader(
  body: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

export function requestWithDb(
  body: string,
  db = createCommerceDb(),
  headers: Record<string, string> = {},
) {
  const request = new Request('https://commerce.test/webhooks/stripe', {
    body,
    headers,
    method: 'POST',
  }) as Request & { db: ReturnType<typeof createCommerceDb> };
  request.db = db;
  return request;
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
      props: { 'fw-key': key },
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
