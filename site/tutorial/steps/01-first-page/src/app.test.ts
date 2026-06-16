import { describe, expect, it } from 'vitest';

import { catalog, renderHomeRoute, renderProductRoute } from './app.js';

// Tutorial step 01: every page is a complete document answered by a declared
// route (SPEC.md sections 6.4 and 8) — assertable as plain request/response
// values, no browser involved.

describe('tutorial step 01 — first page', () => {
  // snippet:home-test
  it('serves the home page as a complete HTML document', async () => {
    const response = await renderHomeRoute();

    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.body).toContain('<h1>Kovo Shop</h1>');
    for (const product of catalog) {
      expect(response.body).toContain(`href="/products/${product.id}"`);
      expect(response.body).toContain(product.name);
    }
  });
  // /snippet

  // snippet:params-test
  it('parses typed route params and renders the product page', async () => {
    const response = await renderProductRoute('p2');

    expect(response.status).toBe(200);
    expect(response.body).toContain('<h1>Ceramic dripper</h1>');
    expect(response.body).toContain('$25.99');
  });

  it('answers unknown products with notFound() and a real 404 status', async () => {
    const response = await renderProductRoute('does-not-exist');

    expect(response.status).toBe(404);
  });
  // /snippet
});
