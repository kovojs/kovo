import { diagnosticDefinitions } from '@jiso/core';
import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

const fw301 = diagnosticDefinitions.FW301;
const fw320 = diagnosticDefinitions.FW320;

describe('compiler state and event diagnostics', () => {
  it('stamps static island-local state onto rendered component markup', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
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
      'fw-state="{&quot;bouncing&quot;:false,&quot;count&quot;:2}"',
    );
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('preserves apostrophes while stamping static island-local state', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  state: () => ({ label: "it's ready", open: false }),
  render: () => <cart-badge>Ready</cart-badge>,
});
`,
    });

    expect(result.files[0]?.source).toContain(
      'fw-state="{&quot;label&quot;:&quot;it\'s ready&quot;,&quot;open&quot;:false}"',
    );
  });

  it('reports FW301 when island-local state stores an obvious query fact', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  state: () => ({ cartCount: 0 }),
  render: ({ cart }, state) => <span>{state.cartCount}</span>,
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW301',
        fileName: 'cart-badge.tsx',
        message: fw301.message,
        severity: fw301.severity,
        start: { column: 17, line: 4 },
        length: 16,
      },
    ]);
  });

  it('reports FW301 for any state key prefixed by a declared query name', () => {
    const result = compileComponentModule({
      fileName: 'account-menu.tsx',
      source: `
export const AccountMenu = component('account-menu', {
  queries: { account: accountQuery },
  state: () => ({ accountNameDraft: '' }),
  render: ({ account }, state) => <span>{state.accountNameDraft}</span>,
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW301',
        fileName: 'account-menu.tsx',
        message: fw301.message,
        severity: fw301.severity,
        start: { column: 17, line: 4 },
        length: 24,
      },
    ]);
  });

  it('does not report FW301 for local UI-only state with declared queries', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  state: () => ({ bouncing: false }),
  render: ({ cart }, state) => <span class={state.bouncing ? 'bounce' : ''}>{renderOnce(cart.count)}</span>,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports FW320 when event payload fields overlap query data', () => {
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
export function notifyPrice(product, emit) {
  emit('cart:added', { product: { unitPrice: product.unitPrice } });
}
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW320',
        fileName: 'cart.events.tsx',
        message: `${fw320.message} product.unitPrice`,
        severity: fw320.severity,
        start: { column: 22, line: 3 },
        length: 45,
      },
    ]);
  });

  it('does not report FW320 for event payloads that carry client intent only', () => {
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
