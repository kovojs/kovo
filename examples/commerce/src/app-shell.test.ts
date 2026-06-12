import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { addToCart } from './app.js';
import { commerceClientModuleHref, createCommerceAppShell } from './app-shell.js';

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
});

describe('commerce app shell HTTP entry', () => {
  it('serves the commerce cart document, query endpoint, and client module over node:http', async () => {
    const errors: unknown[] = [];
    const shell = createCommerceAppShell({
      onError(error) {
        errors.push(error);
      },
    });

    const directDocument = await shell.requestHandler(new Request('https://commerce.test/cart'));
    expect(await directDocument.text()).toContain('data-commerce-shell="cart"');
    expect(directDocument.status).toBe(200);

    server = createServer(shell.nodeHandler);
    await listen(server);
    const origin = serverOrigin(server);

    const document = await fetch(`${origin}/cart`);
    const html = await document.text();
    expect(errors).toEqual([]);
    expect(document.status, html).toBe(200);
    expect(document.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(document.headers.get('link')).toContain('</assets/tailwind.css>; rel=preload; as=style');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('data-commerce-shell="cart"');
    expect(html).toContain('<fw-fragment target="cart-badge">');
    expect(html).toContain('action="/_m/cart/add"');

    await addToCart.handler(
      { productId: 'p1', quantity: 2 },
      { db: shell.db, session: { id: 's-http', user: { id: 'u-http' } } },
      {
        fail(code, payload) {
          return { error: { code, payload }, ok: false, status: 422 };
        },
        invalidate(domain, options) {
          return { domain: domain.key, ...options, manual: true };
        },
      },
    );

    const query = await fetch(`${origin}/_q/cart`);
    expect(query.status).toBe(200);
    await expect(query.text()).resolves.toContain('<fw-query name="cart">{"count":2}</fw-query>');

    const clientModule = await fetch(`${origin}${commerceClientModuleHref}`);
    expect(clientModule.status).toBe(200);
    expect(clientModule.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    await expect(clientModule.text()).resolves.toContain('Commerce$markReady');
  });
});

function listen(target: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    target.once('error', reject);
    target.listen(0, '127.0.0.1', () => {
      target.off('error', reject);
      resolve();
    });
  });
}

function serverOrigin(target: Server): string {
  const address = target.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
