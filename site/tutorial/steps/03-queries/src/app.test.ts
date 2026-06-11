import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { renderShopPage } from './app.js';
import { createShopDb } from './db.js';

// Tutorial step 03: queries are declared once and every derived surface —
// fw-deps stamps, data-bind paths, the shipped query JSON — is checkable from
// the rendered page (SPEC.md sections 4.2, 4.8, 10.2).

describe('tutorial step 03 — queries & data binding', () => {
  // snippet:stamps-test
  it('serves compiler-derived dependency and binding stamps', () => {
    const html = renderShopPage();

    // The queries declaration became the fw-deps stamp on each island.
    expect(html).toContain('<cart-badge fw-deps="cart">');
    expect(html).toContain('fw-c="product-list"');
    expect(html).toContain('fw-deps="products"');

    // {cart.count} became a typed data-bind path the loader can re-run.
    expect(html).toContain('<span data-bind="cart.count">0</span>');
  });
  // /snippet

  // snippet:query-json-test
  it('ships each query value exactly once as shared client data', () => {
    const db = createShopDb();
    db.cartItems.push({ productId: 'p1', qty: 2, unitPrice: 1499 });
    const html = renderShopPage(db);

    expect(html.match(/fw-query="cart"/g)).toHaveLength(1);
    expect(html).toContain('<script type="application/json" fw-query="cart">{"count":2}</script>');
    expect(html).toContain('<span data-bind="cart.count">2</span>');
  });
  // /snippet

  // snippet:keyed-list-test
  it('renders the product list as a keyed list', () => {
    const html = renderShopPage();

    expect(html).toContain('fw-key="p1"');
    expect(html).toContain('fw-key="p2"');
    expect(html).toContain('fw-key="p3"');
    expect(html).toContain('Pour-over kettle — $14.99 (5 in stock)');
  });
  // /snippet

  it('compiles a named update plan for the cart query into the client module', async () => {
    const clientModule: Record<string, unknown> = await import(
      './generated/cart-badge.client.js'
    );
    const plans = clientModule['CartBadge$queryUpdatePlans'];

    expect(plans).toBeDefined();
    expect(Object.keys(plans as Record<string, unknown>)).toEqual(['cart']);
  });

  it('keeps authored component sugar free of hand-written stamps', () => {
    for (const name of ['cart-badge', 'product-list']) {
      const source = readFileSync(new URL(`./components/${name}.tsx`, import.meta.url), 'utf8');
      // SPEC.md section 4.8 / FW223: stamps are derived, never required in sugar.
      expect(source).not.toMatch(/(?:data-bind|fw-deps|fw-c|fw-state|data-p-[\w-]+)=/);
    }
  });
});
