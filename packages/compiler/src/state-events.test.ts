import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

const kv301 = diagnosticDefinitions.KV301;
const kv320 = diagnosticDefinitions.KV320;

describe('compiler state and event diagnostics', () => {
  it('stamps static island-local state onto rendered component markup', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  state: () => ({ bouncing: false, count: 2 }),
  render: (_data, state) => (
    <cart-badge class={state.bouncing ? 'bounce' : ''}>
      {state.count}
    </cart-badge>
  ),
});
`,
    });

    expect(result.files[0]?.source).toContain(
      'kovo-state="{&quot;bouncing&quot;:false,&quot;count&quot;:2}"',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('preserves apostrophes while stamping static island-local state', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  state: () => ({ label: "it's ready", open: false }),
  render: () => <cart-badge>Ready</cart-badge>,
});
`,
    });

    expect(result.files[0]?.source).toContain(
      'kovo-state="{&quot;label&quot;:&quot;it\'s ready&quot;,&quot;open&quot;:false}"',
    );
  });

  it('reports KV301 when island-local state stores a query fact', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: cartQuery },
  state: () => ({ saved: cart.count }),
  render: ({ cart }, state) => <button disabled={cart.count === 0}>{state.saved}</button>,
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV301',
        fileName: 'cart-badge.tsx',
        message: kv301.message,
        severity: kv301.severity,
        start: { column: 26, line: 4 },
        length: 10,
      },
    ]);
  });

  it('does not report KV301 for state keys merely prefixed by a declared query name', () => {
    const result = compileComponentModule({
      fileName: 'account-menu.tsx',
      source: `
export const AccountMenu = component({
  queries: { account: accountQuery },
  state: () => ({ accountNameDraft: '' }),
  render: ({ account }, state) => <span>{state.accountNameDraft}</span>,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('does not report KV301 for local UI-only state with declared queries', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  queries: { cart: cartQuery },
  state: () => ({ bouncing: false }),
  render: ({ cart }, state) => <span class={state.bouncing ? 'bounce' : ''}>{renderOnce(cart.count)}</span>,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports KV320 when event payload fields overlap query data', () => {
    const result = compileComponentModule({
      fileName: 'cart.events.tsx',
      queryShapes: {
        product: {
          id: 'string',
          unitPrice: 'number',
        },
      },
      source: `
export function notifyPrice(product, emit) {
  emit('cart:added', { product: { unitPrice: product.unitPrice } });
}
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV320',
        fileName: 'cart.events.tsx',
        message: `${kv320.message} product.unitPrice`,
        severity: kv320.severity,
        start: { column: 22, line: 3 },
        length: 45,
      },
    ]);
  });

  it('reports KV320 when renamed event payload fields carry query values', () => {
    const result = compileComponentModule({
      fileName: 'order.events.tsx',
      queryShapes: {
        order: {
          quantity: 'number',
          total: 'number',
        },
      },
      source: `
export function notifyOrder(order, emit) {
  emit('order:priced', { snapshotTotal: order.total });
}
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV320',
        fileName: 'order.events.tsx',
        message: `${kv320.message} order.total`,
        severity: kv320.severity,
        start: { column: 24, line: 3 },
        length: 30,
      },
    ]);
  });

  it('does not report KV320 for same-named client intent payload fields', () => {
    const result = compileComponentModule({
      fileName: 'order.events.tsx',
      queryShapes: {
        order: {
          quantity: 'number',
          total: 'number',
        },
      },
      source: `
export function notifyIntent(quantity, emit) {
  emit('order:quantity-changed', { quantity });
}
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('does not report KV320 for event payloads that carry client intent only', () => {
    const result = compileComponentModule({
      fileName: 'cart.events.tsx',
      queryShapes: {
        productCard: {
          product: {
            id: 'string',
            unitPrice: 'number',
          },
        },
      },
      source: `
export function notifyIntent(productId, quantity, emit) {
  emit('cart:add-requested', { productId, quantity });
}
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores event payload text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart.events.tsx',
      queryShapes: {
        productCard: {
          product: {
            id: 'string',
            unitPrice: 'number',
          },
        },
      },
      source: `
const sample = "emit('cart:added', { product: { unitPrice: product.unitPrice } })";
// emit('cart:added', { product: { unitPrice: product.unitPrice } });
export function notifyIntent(productId, quantity, emit) {
  emit('cart:add-requested', { productId, quantity });
}
`,
    });

    expect(result.diagnostics).toEqual([]);
  });
});
