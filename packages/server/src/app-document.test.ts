import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import { renderAppErrorDocumentResponse, renderAppRouteDocumentResponse } from './app-document.js';
import { guards } from './guards.js';
import { notFound, route } from './route.js';

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

  it('renders route notFound outcomes through the configured 404 shell', async () => {
    const productRoute = route('/products/:id', {
      page() {
        return notFound();
      },
    });
    const request = new Request('https://shop.example.test/products/missing');
    const app = createApp({
      errorShells: {
        notFound({ status }) {
          return {
            body: `<main data-shell="404">configured:${status}</main>`,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            status,
          };
        },
      },
      routes: [productRoute],
    });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: { id: 'missing' },
      request,
      route: productRoute,
      url: new URL(request.url),
    });

    expect(response.status).toBe(404);
    expect(response.body).toBe('<main data-shell="404">configured:404</main>');
  });

  it('renders route failures through the configured 500 shell without leaking internals', async () => {
    const routeError = new Error('private route detail');
    const onError = vi.fn();
    const brokenRoute = route('/broken', {
      page() {
        throw routeError;
      },
    });
    const request = new Request('https://shop.example.test/broken');
    const app = createApp({
      errorShells: {
        serverError({ status }) {
          return {
            body: `<main data-shell="500">configured:${status}</main>`,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            status,
          };
        },
      },
      onError,
      routes: [brokenRoute],
    });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: {},
      request,
      route: brokenRoute,
      url: new URL(request.url),
    });

    expect(response.status).toBe(500);
    expect(response.body).toBe('<main data-shell="500">configured:500</main>');
    expect(response.body).not.toContain('private route detail');
    expect(onError).toHaveBeenCalledWith(routeError, {
      operation: 'route-page',
      request,
      routePath: '/broken',
    });
  });

  it('renders route guard forbidden failures through the configured 403 shell', async () => {
    const adminRoute = route('/admin', {
      guard: guards.role<Request & { session?: { user: { roles: readonly string[] } } }>('admin'),
      page: () => '<main data-secret>Admin</main>',
    });
    const request = new Request('https://shop.example.test/admin');
    const app = createApp({
      errorShells: {
        forbidden({ status }) {
          return {
            body: `<main data-shell="403">configured:${status}</main>`,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            status,
          };
        },
      },
      routes: [adminRoute],
      sessionProvider: () => ({ user: { roles: ['staff'] } }),
    });

    const response = await renderAppRouteDocumentResponse({
      app,
      params: {},
      request,
      route: adminRoute,
      url: new URL(request.url),
    });

    expect(response.status).toBe(403);
    expect(response.body).toContain('configured:403');
    expect(response.body).not.toContain('data-secret');
  });
});
