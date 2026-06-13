import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { RequestHandler } from './app-types.js';
import { route } from './route.js';
import { replayStaticExportRequest } from './static-export-request.js';
import { createStaticExportReplayContext } from './static-export-replay-context.js';

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
    const context = { handler, origin: 'https://docs.example.test/base?ignored=1' };

    const { response, url } = await replayStaticExportRequest({
      context,
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
    const context = { handler, origin: 'https://shop.example.test' };

    const { response, url } = await replayStaticExportRequest({
      context,
      href: '/c/cart.client.js?v=cart-1#Cart$add',
    });

    await expect(response.text()).resolves.toBe('export const version = "cart-1";');
    expect(url.pathname).toBe('/c/cart.client.js');
    expect(url.search).toBe('?v=cart-1');
    expect(url.hash).toBe('#Cart$add');
    expect(seen).toEqual(['GET /c/cart.client.js?v=cart-1#Cart$add']);
  });

  it('creates the replay context from the closed app-shell aggregate', async () => {
    const context = createStaticExportReplayContext({
      app: createApp({
        routes: [
          route('/context', {
            page: () => '<main>context shell</main>',
          }),
        ],
      }),
    });

    const { response, url } = await replayStaticExportRequest({
      context,
      pathname: '/context',
    });

    await expect(response.text()).resolves.toContain('<main>context shell</main>');
    expect(context.origin).toBe('https://jiso.local');
    expect(url.href).toBe('https://jiso.local/context');
  });

  it('normalizes replay origins to an absolute http(s) origin boundary', () => {
    const app = createApp({
      routes: [
        route('/', {
          page: () => '<main>Home</main>',
        }),
      ],
    });

    expect(
      createStaticExportReplayContext({ app, origin: 'https://docs.example.test/' }).origin,
    ).toBe('https://docs.example.test');

    for (const origin of [
      'docs.example.test',
      '/relative',
      'file:///tmp/jiso-export',
      'https://docs.example.test/base',
      'https://docs.example.test?preview=1',
      'https://docs.example.test#preview',
    ]) {
      expect(() => createStaticExportReplayContext({ app, origin })).toThrow(
        /SPEC §9\.5 synthetic replay origin/,
      );
    }
  });
});
