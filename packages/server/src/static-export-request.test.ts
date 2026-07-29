import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

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

  it('preserves an exact href search and hash for synthetic replay', async () => {
    const seen: string[] = [];
    const handler: RequestHandler = async (request) => {
      const url = new URL(request.url);
      seen.push(`${request.method} ${url.pathname}${url.search}${url.hash}`);
      return new Response(
        `export const revision = ${JSON.stringify(url.searchParams.get('rev'))};`,
        {
          headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
        },
      );
    };
    const context = { handler, origin: 'https://shop.example.test' };

    const { response, url } = await replayStaticExportRequest({
      context,
      href: '/assets/cart.js?rev=cart-1#Cart$add',
    });

    await expect(response.text()).resolves.toBe('export const revision = "cart-1";');
    expect(url.pathname).toBe('/assets/cart.js');
    expect(url.search).toBe('?rev=cart-1');
    expect(url.hash).toBe('#Cart$add');
    expect(seen).toEqual(['GET /assets/cart.js?rev=cart-1#Cart$add']);
  });

  it('creates the replay context from the closed app-shell aggregate', async () => {
    const context = createStaticExportReplayContext({
      app: createApp({
        routes: [
          route('/context', {
            page: () =>
              trustedHtml('<main>context shell</main>', {
                reason: 'framework server rendering test fixture',
              }),
          }),
        ],
      }),
    });

    const { response, url } = await replayStaticExportRequest({
      context,
      pathname: '/context',
    });

    await expect(response.text()).resolves.toContain('<main>context shell</main>');
    expect(context.origin).toBe('https://kovo.local');
    expect(url.href).toBe('https://kovo.local/context');
  });

  it('normalizes replay origins to an absolute http(s) origin boundary', () => {
    const app = createApp({
      routes: [
        route('/', {
          page: () =>
            trustedHtml('<main>Home</main>', { reason: 'framework server rendering test fixture' }),
        }),
      ],
    });

    expect(
      createStaticExportReplayContext({ app, origin: 'https://docs.example.test/' }).origin,
    ).toBe('https://docs.example.test');

    for (const origin of [
      'docs.example.test',
      '/relative',
      'file:///tmp/kovo-export',
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
