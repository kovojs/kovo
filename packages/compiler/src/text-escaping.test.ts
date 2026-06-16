import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

// SECURITY_FINDINGS.md C1: the @kovojs/server jsx runtime emits text children verbatim, so the
// compiler wraps static data-path text interpolations in escapeText(...) during lowering, making
// generated components safe-by-default without a runtime contract change.
describe('compiler text-child escaping (C1)', () => {
  it('escapes static data-path text children inside a mapped list and imports escapeText', () => {
    const result = compileComponentModule({
      fileName: 'order-history.tsx',
      source: `
export const OrderHistory = component('order-history', {
  render: ({ orders }) => (
    <ol>
      {orders.map((item) => (
        <li kovo-key={item.id}>
          {item.productId} x {item.qty}
        </li>
      ))}
    </ol>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain('{escapeText(item.productId)}');
    expect(serverSource).toContain('{escapeText(item.qty)}');
    expect(serverSource).toContain("import { escapeText } from '@kovojs/server';");
    // The map callback itself is not a property-access path, so it is never wrapped.
    expect(serverSource).not.toContain('escapeText(orders.map');
    expect(result.diagnostics).toEqual([]);
    // Idempotent: recompiling the lowered output must not double-wrap.
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('escapes a sole data-path text child', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      source: `
export const ProductCard = component('product-card', {
  render: ({ product }) => <h2>{product.name}</h2>,
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain('{escapeText(product.name)}</h2>');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('does not escape nested elements, calls, or attribute expressions', () => {
    const result = compileComponentModule({
      fileName: 'card.tsx',
      source: `
export const Card = component('card', {
  render: ({ product }) => (
    <article title={product.name}>
      {formatPrice(product.price)}
      <span>{product.icon}</span>
    </article>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    // attribute expression stays (runtime escapes attributes); call expression is not a data path.
    expect(serverSource).toContain('title={product.name}');
    expect(serverSource).toContain('{formatPrice(product.price)}');
    expect(serverSource).not.toContain('escapeText(formatPrice');
    expect(serverSource).not.toContain('escapeText(product.name))'); // not double-applied to the attr
    // the sole data-path text child inside <span> is escaped
    expect(serverSource).toContain('<span>{escapeText(product.icon)}</span>');
  });
});
