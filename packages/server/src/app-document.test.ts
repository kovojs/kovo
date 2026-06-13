import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import { renderAppErrorDocumentResponse, renderAppRouteDocumentResponse } from './app-document.js';
import { route } from './route.js';

describe('server app document boundary', () => {
  it('assembles matched route documents through app render options', async () => {
    const productRoute = route('/products/:id', {
      page({ params }) {
        return { id: params.id };
      },
    });
    const request = new Request('https://shop.example.test/products/p1?tag=new&tag=sale');
    const app = createApp({
      document: { lang: 'fr' },
      renderRoute(value, context) {
        expect(value).toEqual({ id: 'p1' });
        expect(context.params).toEqual({ id: 'p1' });
        expect(context.search).toEqual({ tag: ['new', 'sale'] });
        expect(context.request).toBe(request);
        expect(context.route).toBe(productRoute);
        return '<main>Product p1</main>';
      },
      routes: [productRoute],
    });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: { id: 'p1' },
      request,
      route: productRoute,
      url: new URL(request.url),
    });

    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.body).toContain('<html lang="fr">');
    expect(response.body).toContain('<main>Product p1</main>');
  });

  it('reports error-shell failures through the app document diagnostic seam', async () => {
    const shellError = new Error('private shell detail');
    const onError = vi.fn();
    const request = new Request('https://shop.example.test/missing?from=doc');
    const app = createApp({
      errorShells: {
        notFound() {
          throw shellError;
        },
      },
      onError,
    });

    const response = await renderAppErrorDocumentResponse(app, request, 404);

    expect(response.status).toBe(404);
    expect(response.body).toContain('<h1>Not Found</h1>');
    expect(response.body).not.toContain('private shell detail');
    expect(onError).toHaveBeenCalledWith(shellError, {
      operation: 'error-shell',
      request,
      status: 404,
      url: '/missing?from=doc',
    });
  });
});
