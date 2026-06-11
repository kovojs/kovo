import { notFound, renderRoutePageResponse, route, s } from '@jiso/server';

import { ProductActions } from './generated/product-actions.js';

// Tutorial step 02 (chapter 2): the product page gains an interactive island.
// The app imports the committed lowered IR (src/generated/), so served HTML
// carries the compiler-derived stamps and handler references (SPEC.md
// sections 4.2 and 4.8) — the authored sugar in src/components/ never runs in
// production.

export interface Product {
  id: string;
  name: string;
  unitPrice: number;
}

export const catalog: Product[] = [
  { id: 'p1', name: 'Pour-over kettle', unitPrice: 1499 },
  { id: 'p2', name: 'Ceramic dripper', unitPrice: 2599 },
  { id: 'p3', name: 'Paper filters', unitPrice: 399 },
];

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export const homeRoute = route('/', {
  page() {
    return renderHomePage();
  },
});

export const productRoute = route('/products/:id', {
  params: s.object({ id: s.string() }),
  page({ params }) {
    const product = catalog.find((item) => item.id === params.id);
    if (!product) return notFound();
    return renderProductPage(product);
  },
});

export function renderHomePage(): string {
  const items = catalog
    .map(
      (product) =>
        `<li><a href="/products/${product.id}">${product.name}</a> — ${formatPrice(product.unitPrice)}</li>`,
    )
    .join('');
  return `<!doctype html><html><head><title>Jiso Shop</title></head><body><main><h1>Jiso Shop</h1><ul>${items}</ul></main></body></html>`;
}

// snippet:render-island
export function renderProductPage(product: Product): string {
  const actions = ProductActions.definition.render({}, ProductActions.definition.state());
  return `<!doctype html><html><head><title>${product.name} · Jiso Shop</title></head><body><main><h1>${product.name}</h1><p>${formatPrice(product.unitPrice)}</p>${actions}<a href="/">Back to the shop</a></main></body></html>`;
}
// /snippet

export function renderHomeRoute() {
  return renderRoutePageResponse(homeRoute, {}, {});
}

export function renderProductRoute(id: string) {
  return renderRoutePageResponse(productRoute, { params: { id } }, {});
}
