import { describe, expect, it } from 'vitest';

import type { RequestHandler } from './app-types.js';
import { replayStaticExportRequest } from './static-export-request.js';

describe('server static export synthetic request boundary', () => {
  it('replays route document paths as SPEC §9.5 synthetic GET requests', async () => {
    const seen: string[] = [];
    const handler: RequestHandler = async (request) => {
      const url = new URL(request.url);
      seen.push(`${request.method} ${url.href}`);
      return new Response(`<main>${url.pathname}</main>`, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    };

    const { response, url } = await replayStaticExportRequest({
      handler,
      origin: 'https://docs.example.test/base?ignored=1',
      pathname: '/guide/intro',
    });

    await expect(response.text()).resolves.toBe('<main>/guide/intro</main>');
    expect(url.href).toBe('https://docs.example.test/guide/intro');
    expect(seen).toEqual(['GET https://docs.example.test/guide/intro']);
  });

  it('preserves versioned /c/ href search and hash for client-module replay', async () => {
    const seen: string[] = [];
    const handler: RequestHandler = async (request) => {
      const url = new URL(request.url);
      seen.push(`${request.method} ${url.pathname}${url.search}${url.hash}`);
      return new Response(`export const version = ${JSON.stringify(url.searchParams.get('v'))};`, {
        headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
      });
    };

    const { response, url } = await replayStaticExportRequest({
      handler,
      href: '/c/cart.client.js?v=cart-1#Cart$add',
      origin: 'https://shop.example.test',
    });

    await expect(response.text()).resolves.toBe('export const version = "cart-1";');
    expect(url.pathname).toBe('/c/cart.client.js');
    expect(url.search).toBe('?v=cart-1');
    expect(url.hash).toBe('#Cart$add');
    expect(seen).toEqual(['GET /c/cart.client.js?v=cart-1#Cart$add']);
  });
});
