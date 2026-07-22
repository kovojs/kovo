import { describe, expect, it } from 'vitest';

import type { RequestHandler } from './app-types.js';
import {
  collectStaticExportClientModuleHrefs,
  collectStaticExportServerEndpointRefs,
} from './static-export-document-refs.js';

import { markFrameworkDocumentResponse } from './response.js';
import { replayStaticExportRouteDocumentArtifact } from './static-export-document.js';

const TEST_REPRESENTATION_DIGEST = 'a'.repeat(64);
const testClientHref = (file: string): string => `/c/__v/${TEST_REPRESENTATION_DIGEST}/${file}`;

describe('server static export document boundary', () => {
  it('replays route documents as synthetic GET requests at normalized pathnames', async () => {
    const seen: string[] = [];
    const handler: RequestHandler = async (request) => {
      const url = new URL(request.url);
      seen.push(`${request.method} ${url.pathname}${url.search}`);
      return markFrameworkDocumentResponse(
        new Response('<main>Docs</main>', {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Kovo-Build': 'static-export-document-test-build',
            'X-Route': url.pathname,
          },
          status: 200,
        }),
        'static-export-document-test-build',
      );
    };
    const context = { handler, origin: 'https://kovo.local/root?ignored=1' };

    await expect(
      replayStaticExportRouteDocumentArtifact({
        context,
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

  it('raises KV229 when synthetic route replay reaches a non-document boundary', async () => {
    const handler: RequestHandler = async () =>
      new Response('Method Not Allowed', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        status: 405,
      });
    const context = { handler, origin: 'https://kovo.local' };

    await expect(
      replayStaticExportRouteDocumentArtifact({
        context,
        routePath: '/private',
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          message: expect.stringContaining('provenance-marked framework document'),
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
          `<button on:click="${testClientHref('cart.client.js')}#Cart$add https://cdn.example.test/c/remote.js?v=1#Remote$open">`,
          'Add locally',
          '</button>',
          '<a data-docs="https://shop.example.test/c/example-only.client.js?v=docs">Docs</a>',
          '<link rel="stylesheet" href="/c/not-a-module.css?v=style">',
          '<link rel="preload" as="script" href="/c/not-modulepreload.client.js?v=preload">',
          `<script type="module" src="https://shop.example.test${testClientHref('menu.client.js')}"></script>`,
          '</main>',
        ].join(''),
        headers: {
          link: [
            `<${testClientHref('header.client.js')}>; rel=modulepreload`,
            '</c/not-a-client-style.css?v=5>; rel=preload; as=style',
            '</c/not-a-client-script.js?v=6>; rel=preload; as=script',
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
      `${testClientHref('cart.client.js')}#Cart$add`,
      testClientHref('header.client.js'),
      testClientHref('menu.client.js'),
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
          `<button on:click=&#47;c&#47;__v&#47;${TEST_REPRESENTATION_DIGEST}&#47;cart.client.js#Cart$add>Client add</button>`,
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
      `${testClientHref('cart.client.js')}#Cart$add`,
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
          '<template><form action="/_m/template/add"><button on:click="/c/template.client.js?v=1#open">Template</button></form></template>',
          '<pre><form action="/_m/pre/add"><button on:click="/c/pre.client.js?v=1#open">Pre</button></form></pre>',
          `<button on:click="${testClientHref('real.client.js')}#Real$open">Open</button>`,
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
      `${testClientHref('real.client.js')}#Real$open`,
    ]);
  });

  it('discovers only declared module surfaces for static-host client module replay', () => {
    const exportOrigin = 'https://shop.example.test';
    const routeArtifacts = [
      {
        body: [
          '<main>',
          `<button on:idle="${testClientHref('idle.client.js')}#Idle$run ${testClientHref('load.client.js')}#Load$run">Run</button>`,
          '<script src="/c/plain-script.client.js?v=ignored"></script>',
          '<script type="application/json" src="/c/config.client.js?v=ignored"></script>',
          `<script type="module" src="${testClientHref('bootstrap.client.js')}"></script>`,
          `<link rel="modulepreload alternate" href="${testClientHref('head.client.js')}">`,
          '<link rel="stylesheet" href="/c/theme.css?v=ignored">',
          '<span data-example="/c/example-only.client.js?v=ignored"></span>',
          '</main>',
        ].join(''),
        headers: {
          link: [
            `<${testClientHref('header.client.js')}>; rel="modulepreload"; title="a, b"`,
            '</c/style.css?v=ignored>; rel=preload; as=style',
            '</c/script.client.js?v=ignored>; rel=preload; as=script',
          ].join(', '),
        },
        path: '/cart/index.html',
        status: 200,
      },
    ];

    expect(collectStaticExportClientModuleHrefs(routeArtifacts, exportOrigin)).toEqual([
      testClientHref('bootstrap.client.js'),
      testClientHref('head.client.js'),
      testClientHref('header.client.js'),
      `${testClientHref('idle.client.js')}#Idle$run`,
      `${testClientHref('load.client.js')}#Load$run`,
    ]);
  });
});
