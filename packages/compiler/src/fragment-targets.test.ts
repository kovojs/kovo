import { diagnosticDefinitions } from '@jiso/core';
import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

const fw230 = diagnosticDefinitions.FW230;
const fw303 = diagnosticDefinitions.FW303;

describe('fragment target validation', () => {
  it('accepts fragment target render inputs declared as queries or stamped props', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String, quantity: Number, selected: Boolean },
  queries: { cart: cartQuery },
  render: ({ cart, rowId }) => <tr fw-c="cart-row" data-row={rowId}>{renderOnce(cart.count)}</tr>,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.files[2]?.source).toContain(
      "'cart-row': { rowId: string; quantity: number; selected: boolean };",
    );
    expect(result.files[2]?.source).toContain(`interface FragmentTargets {
  'cart-row': { rowId: string; quantity: number; selected: boolean };
  }`);
  });

  it('preserves unknown declared prop types in fragment target registry facts', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
const jsonProp = createJsonProp();

export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String, payload: jsonProp },
  render: ({ rowId, payload }) => <tr fw-c="cart-row" data-row={rowId}>{renderOnce(payload.label)}</tr>,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.files[2]?.source).toContain("'cart-row': { rowId: string; payload: unknown };");
    expect(result.files[2]?.source).not.toContain("'cart-row': {};");
  });

  it('reports FW303 when fragment target render inputs cannot be rerendered from queries or stamped props', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component('cart-row', {
  fragmentTarget: true,
  queries: { cart: cartQuery },
  render: ({ cart, priceList }) => <tr fw-c="cart-row">{renderOnce(cart.count)}{priceList.version}</tr>,
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW303',
        fileName: 'cart-row.tsx',
        message: `${fw303.message} priceList`,
        severity: fw303.severity,
        start: { column: 20, line: 5 },
        length: 9,
      },
    ]);
  });

  it('accepts fragment target children that can hoist through serializable props', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String },
  render: ({ rowId }) => <tr fw-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component('cart-table', {
  render: ({ cart }) => (
    <table>
      <CartRow rowId={cart.rowId}>
        <span>{cart.count}</span>
      </CartRow>
    </table>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports FW230 when fragment target children capture unserializable values', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String },
  render: ({ rowId }) => <tr fw-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component('cart-table', {
  render: ({ cart }) => (
    <table>
      <CartRow rowId={cart.rowId}>
        <span>{window.location.href}</span>
      </CartRow>
    </table>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW230',
        fileName: 'cart-row.tsx',
        help: [
          `${fw230.detailLabels.slotHoist} CartRow$slot_children`,
          `${fw230.detailLabels.blockedChildren} <span>{window.location.href}</span>`,
          fw230.help,
        ].join('\n'),
        message: `${fw230.message} CartRow`,
        severity: fw230.severity,
        start: { column: 9, line: 12 },
        length: 35,
      },
    ]);
  });

  it('does not report FW230 for local child variables named like non-serializable captures', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String },
  render: ({ rowId }) => <tr fw-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component('cart-table', {
  render: ({ cart }) => {
    return (
      <table>
        <CartRow rowId={cart.rowId}>
          <span>{(() => { const response = { label: 'ok' }; return response.label; })()}</span>
        </CartRow>
      </table>
    );
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores fragment target child text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String },
  render: ({ rowId }) => <tr fw-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component('cart-table', {
  render: ({ cart }) => {
    const sample = '<CartRow><span>{window.location.href}</span></CartRow>';
    // <CartRow><span>{request.url}</span></CartRow>
    return (
      <table>
        <CartRow rowId={cart.rowId}>
          <span>{cart.count}</span>
        </CartRow>
      </table>
    );
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores fragment target declarations inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
const sample = "export const CartRow = component('cart-row', { fragmentTarget: true, render: () => null });";
// export const OtherRow = component('other-row', { fragmentTarget: true, render: () => null });
export const CartTable = component('cart-table', {
  render: () => (
    <table>
      <CartRow>
        <span>{window.location.href}</span>
      </CartRow>
    </table>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores fragment target declarations inside strings and comments for graph facts', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
const sample = "export const CartRow = component('cart-row', { fragmentTarget: true, render: () => null });";
// export const OtherRow = component('other-row', { fragmentTarget: true, render: () => null });
export const CartTable = component('cart-table', {
  queries: { cart: {} },
  render: () => (
    <table>
      <CartRow>
        <span>{cart.count}</span>
      </CartRow>
    </table>
  ),
});
`,
    });

    expect(result.componentGraphFacts).toEqual([
      {
        name: 'CartTable',
        queries: ['cart'],
      },
    ]);
  });
});
