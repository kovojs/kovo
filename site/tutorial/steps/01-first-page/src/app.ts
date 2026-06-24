import { notFound, publicAccess, route, s, type RoutePageResult } from '@kovojs/server';

// Tutorial step 01 (chapter 1): routes and the first page. Pages are complete
// documents rendered on the server — there is no client router and no
// hydration step (SPEC.md sections 6.4 and 8).

// snippet:catalog
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
// /snippet

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// snippet:home-route
export const homeRoute = route('/', {
  access: publicAccess('public tutorial shop home page'),
  page() {
    return renderHomePage() as unknown as RoutePageResult;
  },
});
// /snippet

// snippet:product-route
export const productRoute = route('/products/:id', {
  access: publicAccess('public tutorial product detail page'),
  params: s.object({ id: s.string() }),
  page({ params }) {
    const product = catalog.find((item) => item.id === params.id);
    if (!product) return notFound();
    return renderProductPage(product) as unknown as RoutePageResult;
  },
});
// /snippet

// snippet:render-home
export function renderHomePage(): string {
  const items = catalog
    .map(
      (product) =>
        `<li><a href="/products/${product.id}">${product.name}</a> — ${formatPrice(product.unitPrice)}</li>`,
    )
    .join('');
  return `<!doctype html><html><head><title>Kovo Shop</title></head><body><main><h1>Kovo Shop</h1><ul>${items}</ul></main></body></html>`;
}
// /snippet

export function renderProductPage(product: Product): string {
  return `<!doctype html><html><head><title>${product.name} · Kovo Shop</title></head><body><main><h1>${product.name}</h1><p>${formatPrice(product.unitPrice)}</p><a href="/">Back to the shop</a></main></body></html>`;
}
