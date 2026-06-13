import { describe, expect, it } from 'vitest';

import type { RequestHandler } from './app-types.js';
import {
  collectStaticExportClientModuleHrefs,
  collectStaticExportServerEndpointRefs,
} from './static-export-document-refs.js';
import { replayStaticExportRouteDocumentArtifact } from './static-export-document.js';

describe('server static export document boundary', () => {
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
      replayStaticExportRouteDocumentArtifact({
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
      replayStaticExportRouteDocumentArtifact({
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

  it('reads static document refs from unquoted attributes and decoded entities', () => {
    const exportOrigin = 'https://shop.example.test';
    const routeArtifacts = [
      {
        body: [
          '<main>',
          '<form ACTION=/_m/cart/add><button>add</button></form>',
          '<a HREF=&#x2f;_q&#x2f;cart?args=1>Refresh</a>',
          '<button on:click=&#47;c&#47;cart.client.js?v=1#Cart$add>Client add</button>',
          '<span data-invalid=&#9999999999;>Ignored</span>',
          '</main>',
        ].join(''),
        headers: {},
        path: '/cart/index.html',
        status: 200,
      },
    ];

    expect(
      collectStaticExportServerEndpointRefs(routeArtifacts[0]?.body ?? '', exportOrigin),
    ).toEqual([
      { name: 'action', path: '/_m/cart/add', phase: 'mutation', value: '/_m/cart/add' },
      { name: 'href', path: '/_q/cart', phase: 'query', value: '/_q/cart?args=1' },
    ]);
    expect(collectStaticExportClientModuleHrefs(routeArtifacts, exportOrigin)).toEqual([
      '/c/cart.client.js?v=1#Cart$add',
    ]);
  });

  it('ignores refs inside comments and raw-text element bodies while reading opening attributes', () => {
    const exportOrigin = 'https://shop.example.test';
    const routeArtifacts = [
      {
        body: [
          '<main>',
          '<!-- <form action="/_m/comment/add"><button>Add</button></form> -->',
          '<script type="application/json" src="/c/config.client.js?v=1">',
          '{"template":"</scripture><button on:click=\\"/c/script-body.client.js?v=1#open\\" formaction=\\"/_m/script/add\\">Add</button>"}',
          '</script>',
          '<style>.demo::before { content: \'<a href="/_q/style">\'; }</style>',
          '<textarea><a href="/_q/textarea">example</a></textarea>',
          '<title><a href="/_q/title">example</a></title>',
          '<button on:click="/c/real.client.js?v=2#Real$open">Open</button>',
          '</main>',
        ].join(''),
        headers: {},
        path: '/cart/index.html',
        status: 200,
      },
    ];

    expect(
      collectStaticExportServerEndpointRefs(routeArtifacts[0]?.body ?? '', exportOrigin),
    ).toEqual([]);
    expect(collectStaticExportClientModuleHrefs(routeArtifacts, exportOrigin)).toEqual([
      '/c/config.client.js?v=1',
      '/c/real.client.js?v=2#Real$open',
    ]);
  });
});
