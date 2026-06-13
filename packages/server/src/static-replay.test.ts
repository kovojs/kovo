import { describe, expect, it } from 'vitest';

import type { RequestHandler } from './app.js';
import {
  collectStaticExportClientModuleHrefs,
  collectStaticExportServerEndpointRefs,
} from './static-export-document.js';
import {
  replayStaticExportClientModuleArtifacts,
  replayStaticExportRouteArtifact,
} from './static-replay.js';

describe('server static export replay', () => {
  it('replays route documents as synthetic GET requests at normalized pathnames', async () => {
    const seen: string[] = [];
    const handler: RequestHandler = async (request) => {
      const url = new URL(request.url);
      seen.push(`${request.method} ${url.pathname}${url.search}`);
      return new Response('<main>Docs</main>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Route': url.pathname },
        status: 200,
      });
    };

    await expect(
      replayStaticExportRouteArtifact({
        handler,
        htmlPathStyle: 'directory',
        origin: 'https://jiso.local/root?ignored=1',
        routePath: '/docs/intro/?from=route#hash',
      }),
    ).resolves.toEqual({
      body: '<main>Docs</main>',
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-route': '/docs/intro',
      },
      path: '/docs/intro/index.html',
      status: 200,
    });
    expect(seen).toEqual(['GET /docs/intro']);
  });

  it('raises FW229 when synthetic route replay reaches a non-document boundary', async () => {
    const handler: RequestHandler = async () =>
      new Response('Method Not Allowed', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        status: 405,
      });

    await expect(
      replayStaticExportRouteArtifact({
        handler,
        htmlPathStyle: 'directory',
        origin: 'https://jiso.local',
        routePath: '/private',
      }),
    ).rejects.toMatchObject({
      code: 'FW229',
      diagnostics: [
        {
          code: 'FW229',
          message: expect.stringContaining(
            "successful HTML route documents; '/private' returned status 405",
          ),
          routePath: '/private',
        },
      ],
    });
  });

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

  it('keeps static document reference discovery separate from replay execution', () => {
    const exportOrigin = 'https://shop.example.test';
    const routeArtifacts = [
      {
        body: [
          '<main>',
          '<form action="/_m/cart/add"><button>Add</button></form>',
          '<a href="/_q/cart?args=%7B%7D">Refresh</a>',
          '<button on:click="/c/cart.client.js?v=1#Cart$add https://cdn.example.test/c/remote.js?v=1#Remote$open">',
          'Add locally',
          '</button>',
          '<script type="module" src="https://shop.example.test/c/menu.client.js?v=2"></script>',
          '</main>',
        ].join(''),
        headers: {
          link: [
            '</c/header.client.js?v=3>; rel=modulepreload',
            '<https://cdn.example.test/c/external.client.js?v=4>; rel=modulepreload',
          ].join(', '),
        },
        path: '/cart/index.html',
        status: 200,
      },
    ];

    expect(
      collectStaticExportServerEndpointRefs(routeArtifacts[0]?.body ?? '', exportOrigin),
    ).toEqual([
      { name: 'action', path: '/_m/cart/add', phase: 'mutation', value: '/_m/cart/add' },
      { name: 'href', path: '/_q/cart', phase: 'query', value: '/_q/cart?args=%7B%7D' },
    ]);
    expect(collectStaticExportClientModuleHrefs(routeArtifacts, exportOrigin)).toEqual([
      '/c/cart.client.js?v=1#Cart$add',
      '/c/header.client.js?v=3',
      '/c/menu.client.js?v=2',
    ]);
  });
});
