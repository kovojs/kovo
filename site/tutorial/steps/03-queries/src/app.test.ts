import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { renderRoutePageResponse } from '../../../../../packages/server/src/internal/route.js';
import { createLiveTargetTestAuthority } from '../../../../../packages/server/src/test-fixtures.js';
import { renderRouteHtml } from '@kovojs/server/rendering';

import { homeRoute } from './app.js';
import { createShopDb, type ShopDb } from './db.js';
import { cartQuery, productsQuery } from './queries.js';

const tutorialLiveTargetAuthority = createLiveTargetTestAuthority('tutorial-step-03-test-build');

// Tutorial step 03: queries are declared once and every derived surface —
// kovo-deps stamps and data-bind paths are checkable from the rendered page
// (SPEC.md sections 4.2, 4.8, 10.2).

describe('tutorial step 03 — queries & data binding', () => {
  // snippet:stamps-test
  it('serves compiler-derived dependency and binding stamps', async () => {
    const html = await renderShopRoute();

    // The queries declaration became kovo-deps plus inferred refresh target metadata.
    expect(html).toContain(
      `<cart-badge kovo-deps="${encodeURIComponent(cartQuery.key)}" kovo-fragment-target="cart-badge" kovo-live-component="components/cart-badge/cart-badge"`,
    );
    expect(html).toContain('kovo-c="product-list"');
    expect(html).toContain(`kovo-deps="${encodeURIComponent(productsQuery.key)}"`);

    // {cart.count} became a typed data-bind path the loader can re-run.
    expect(html).toContain('<span data-bind="cart.count">0</span>');
  });
  // /snippet

  // snippet:query-data-test
  it('renders loaded query values through the declared components', async () => {
    const db = createShopDb();
    db.cartItems.push({ productId: 'p1', qty: 2, unitPrice: 1499 });
    const html = await renderShopRoute(db);

    expect(html).toContain('<span data-bind="cart.count">2</span>');
    expect(html).toContain('Pour-over kettle — $14.99 (5 in stock)');
  });
  // /snippet

  // snippet:keyed-list-test
  it('renders the product list as a keyed list', async () => {
    const html = await renderShopRoute();

    expect(html).toContain('kovo-key="p1"');
    expect(html).toContain('kovo-key="p2"');
    expect(html).toContain('kovo-key="p3"');
    expect(html).toContain('Pour-over kettle — $14.99 (5 in stock)');
  });
  // /snippet

  it('compiles a named update plan for the cart query into the client module', async () => {
    // @ts-expect-error virtual client module emitted by the Kovo compiler plugin.
    const clientModule: Record<string, unknown> = await import('./components/cart-badge.client.js');
    const plans = clientModule['CartBadge$queryUpdatePlans'];

    expect(plans).toBeDefined();
    expect(Object.keys(plans as Record<string, unknown>)).toEqual(['cart']);
  });

  it('keeps authored component sugar free of hand-written stamps', () => {
    for (const name of ['cart-badge', 'product-list']) {
      const source = readFileSync(new URL(`./components/${name}.tsx`, import.meta.url), 'utf8');
      // SPEC.md section 4.8 / KV223: stamps are derived, never required in sugar.
      expect(source).not.toMatch(
        /(?:data-bind|kovo-deps|kovo-c|kovo-key|kovo-state|data-p-[\w-]+)=/,
      );
    }
  });
});

async function renderShopRoute(db: ShopDb = createShopDb()): Promise<string> {
  const response = await renderRoutePageResponse(homeRoute, {}, { db }, renderRouteHtml, {
    attestationAuthority: tutorialLiveTargetAuthority.authority,
  });
  if (typeof response.body !== 'string') throw new Error('expected a string page body');
  return response.body;
}
