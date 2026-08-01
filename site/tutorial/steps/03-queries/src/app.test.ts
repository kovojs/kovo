import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { decodeFrameworkQueryDependencyToken } from '@kovojs/core/internal/wire-input-grammar';
import { htmlAttributeValue } from '../../../../../packages/server/src/component-root-stamps.js';
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

    // SPEC §9.1/§10.2: query dependencies are semantic { name, key? } facts; HTML attribute order
    // is not part of the wire contract. These unparameterized queries carry exact unkeyed names.
    const cartAttrs = requiredOpeningTagAttributes(html, 'cart-badge');
    expect(
      decodeFrameworkQueryDependencyToken(requiredHtmlAttribute(cartAttrs, 'kovo-deps')),
    ).toEqual({ name: cartQuery.key });
    expect(requiredHtmlAttribute(cartAttrs, 'kovo-fragment-target')).toBe('cart-badge');
    expect(requiredHtmlAttribute(cartAttrs, 'kovo-live-component')).toBe(
      'components/cart-badge/cart-badge',
    );

    const productListAttrs = requiredOpeningTagAttributes(html, 'ul');
    expect(requiredHtmlAttribute(productListAttrs, 'kovo-c')).toBe('product-list');
    expect(
      decodeFrameworkQueryDependencyToken(requiredHtmlAttribute(productListAttrs, 'kovo-deps')),
    ).toEqual({ name: productsQuery.key });

    // {cart.count} became a typed data-bind path the loader can re-run.
    const countAttrs = requiredOpeningTagAttributes(html, 'span');
    expect(requiredHtmlAttribute(countAttrs, 'data-bind')).toBe('cart.count');
    expect(html).toMatch(/<span\b[^>]*>0<\/span>/u);
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

function requiredOpeningTagAttributes(html: string, tagName: string): string {
  const match = new RegExp(`<${tagName}\\b([^>]*)>`, 'u').exec(html);
  if (!match) throw new Error(`expected a <${tagName}> opening tag`);
  return match[1] ?? '';
}

function requiredHtmlAttribute(attrs: string, name: string): string {
  const value = htmlAttributeValue(attrs, name);
  if (value === undefined) throw new Error(`expected ${name} on rendered tutorial element`);
  return value;
}
