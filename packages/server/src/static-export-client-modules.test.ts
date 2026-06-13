import { describe, expect, it } from 'vitest';

import type { RequestHandler } from './app.js';
import { replayStaticExportClientModuleArtifacts } from './static-export-document.js';

describe('server static export document client module replay boundary', () => {
  it('replays discovered client modules once per output path and rejects query-version drift', async () => {
    const seen: string[] = [];
    const handler: RequestHandler = async (request) => {
      const url = new URL(request.url);
      seen.push(`${url.pathname}${url.search}${url.hash}`);
      return new Response(`export const version = ${JSON.stringify(url.searchParams.get('v'))};`, {
        headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
        status: 200,
      });
    };

    await expect(
      replayStaticExportClientModuleArtifacts({
        handler,
        origin: 'https://jiso.local',
        routeArtifacts: [
          {
            body: '<button on:click="/c/cart.js?v=one#Cart$add /c/cart.js?v=two#Cart$add">',
            headers: {},
            path: '/cart/index.html',
            status: 200,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'FW229',
      diagnostics: [
        {
          code: 'FW229',
          message: expect.stringContaining('multiple client module versions'),
          routePath: '/c/cart.js',
        },
      ],
    });
    expect(seen).toEqual(['/c/cart.js?v=one#Cart$add', '/c/cart.js?v=two#Cart$add']);
  });

  it('replays same-origin absolute client module refs from HTML attributes and Link headers', async () => {
    const seen: string[] = [];
    const handler: RequestHandler = async (request) => {
      const url = new URL(request.url);
      seen.push(`${url.pathname}${url.search}${url.hash}`);
      return new Response(`export const modulePath = ${JSON.stringify(url.pathname)};`, {
        headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
        status: 200,
      });
    };

    await expect(
      replayStaticExportClientModuleArtifacts({
        handler,
        origin: 'https://shop.example.test',
        routeArtifacts: [
          {
            body: [
              '<button',
              ' on:click="https://shop.example.test/c/cart.client.js?v=cart-1#Cart$add"',
              ' data-docs="https://cdn.example.test/c/external.client.js?v=1#External$show"',
              '>Add</button>',
            ].join(''),
            headers: {
              link: [
                '<https://shop.example.test/c/menu.client.js?v=menu-1>; rel=modulepreload',
                '<https://cdn.example.test/c/remote.client.js?v=remote-1>; rel=modulepreload',
              ].join(', '),
            },
            path: '/cart/index.html',
            status: 200,
          },
        ],
      }),
    ).resolves.toEqual([
      {
        body: 'export const modulePath = "/c/cart.client.js";',
        headers: { 'content-type': 'text/javascript; charset=utf-8' },
        href: '/c/cart.client.js?v=cart-1#Cart$add',
        path: '/c/cart.client.js',
        status: 200,
      },
      {
        body: 'export const modulePath = "/c/menu.client.js";',
        headers: { 'content-type': 'text/javascript; charset=utf-8' },
        href: '/c/menu.client.js?v=menu-1',
        path: '/c/menu.client.js',
        status: 200,
      },
    ]);
    expect(seen).toEqual(['/c/cart.client.js?v=cart-1#Cart$add', '/c/menu.client.js?v=menu-1']);
  });

  it('raises FW229 when a referenced client module replays to non-JavaScript', async () => {
    const handler: RequestHandler = async () =>
      new Response('<!doctype html><h1>Not found</h1>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200,
      });

    await expect(
      replayStaticExportClientModuleArtifacts({
        handler,
        origin: 'https://jiso.local',
        routeArtifacts: [
          {
            body: '<script type="module" src="/c/missing.client.js?v=build-1"></script>',
            headers: {},
            path: '/index.html',
            status: 200,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'FW229',
      diagnostics: [
        {
          code: 'FW229',
          message: expect.stringContaining(
            "returned status 200 with Content-Type 'text/html; charset=utf-8'",
          ),
          routePath: '/c/missing.client.js',
        },
      ],
    });
  });
});
