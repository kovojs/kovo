import { describe, expect, it } from 'vitest';
import {
  kovoDeferredRuntimeModulePath,
  kovoDeferredRuntimeModuleSource,
} from '@kovojs/browser/internal/inline-loader';
import {
  clientModuleRepresentationDigest,
  versionedClientModuleHref,
} from '@kovojs/core/internal/client-module-url';

import type { RequestHandler } from './app-types.js';
import { replayStaticExportClientModuleArtifacts } from './static-export-client-modules.js';

interface TestClientModule {
  href: string;
  source: string;
}

const runtimeModule = testClientModule(
  kovoDeferredRuntimeModulePath,
  kovoDeferredRuntimeModuleSource,
);

describe('server static export client module replay boundary', () => {
  it('rejects retired query/author module versions before handler work', async () => {
    const seen: string[] = [];
    const handler: RequestHandler = async (request) => {
      seen.push(request.url);
      return new Response('export {};', {
        headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
      });
    };

    await expect(
      replayStaticExportClientModuleArtifacts({
        context: { handler, origin: 'https://kovo.local' },
        routeArtifacts: [
          {
            body: '<button on:click="/c/cart.client.js?v=author-v1#Cart$add">Add</button>',
            headers: {},
            path: '/cart/index.html',
            status: 200,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          message: expect.stringContaining('no query string or author version'),
          routePath: '/c/cart.client.js?v=author-v1#Cart$add',
        },
      ],
    });
    expect(seen).toEqual([]);
  });

  it('rejects truncated representation digests before handler work', async () => {
    const handler = async () => {
      throw new Error('handler must not run');
    };

    await expect(
      replayStaticExportClientModuleArtifacts({
        context: { handler, origin: 'https://kovo.local' },
        routeArtifacts: [
          {
            body: '<script type="module" src="/c/__v/abc123/cart.client.js"></script>',
            headers: {},
            path: '/cart/index.html',
            status: 200,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          message: expect.stringContaining('64-lowercase-hex-representation-digest'),
          routePath: '/c/__v/abc123/cart.client.js',
        },
      ],
    });
  });

  it('replays canonical same-origin absolute refs and Link headers', async () => {
    const cart = testClientModule('/c/cart.client.js', 'export const cart = true;');
    const menu = testClientModule('/c/menu.client.js', 'export const menu = true;');
    const seen: string[] = [];
    const handler = exactModuleHandler([cart, menu, runtimeModule], seen);

    await expect(
      replayStaticExportClientModuleArtifacts({
        context: { handler, origin: 'https://shop.example.test' },
        routeArtifacts: [
          {
            body: [
              '<button',
              ` on:click="https://shop.example.test${cart.href}#Cart$add"`,
              ' data-docs="https://cdn.example.test/c/external.client.js?v=1#External$show"',
              '>Add</button>',
            ].join(''),
            headers: {
              link: [
                `<https://shop.example.test${menu.href}>; rel=modulepreload`,
                '<https://cdn.example.test/c/remote.client.js?v=remote>; rel=modulepreload',
              ].join(', '),
            },
            path: '/cart/index.html',
            status: 200,
          },
        ],
      }),
    ).resolves.toEqual([
      staticModuleArtifact(cart, `${cart.href}#Cart$add`),
      staticModuleArtifact(menu),
      staticModuleArtifact(runtimeModule),
    ]);
    expect(seen).toEqual([`${cart.href}#Cart$add`, menu.href, runtimeModule.href]);
  });

  it('ignores non-module /c/ references while replaying canonical declared modules', async () => {
    const cart = testClientModule('/c/cart.client.js', 'export const cart = true;');
    const menu = testClientModule('/c/menu.client.js', 'export const menu = true;');
    const seen: string[] = [];
    const handler = exactModuleHandler([cart, menu, runtimeModule], seen);

    await expect(
      replayStaticExportClientModuleArtifacts({
        context: { handler, origin: 'https://shop.example.test' },
        routeArtifacts: [
          {
            body: [
              '<main>',
              `<button on:click="${cart.href}#Cart$add">Add</button>`,
              '<a data-docs="/c/example-only.client.js?v=docs">Docs</a>',
              '<script src="/c/plain.client.js?v=plain"></script>',
              '<script type="application/json" src="/c/config.client.js?v=config"></script>',
              '<link rel="stylesheet" href="/c/theme.css?v=theme">',
              '</main>',
            ].join(''),
            headers: {
              link: [
                `<${menu.href}>; rel=modulepreload`,
                '</c/ignored-style.css?v=style>; rel=preload; as=style',
              ].join(', '),
            },
            path: '/cart/index.html',
            status: 200,
          },
        ],
      }),
    ).resolves.toEqual([
      staticModuleArtifact(cart, `${cart.href}#Cart$add`),
      staticModuleArtifact(menu),
      staticModuleArtifact(runtimeModule),
    ]);
    expect(seen).toEqual([`${cart.href}#Cart$add`, menu.href, runtimeModule.href]);
  });

  it('rejects a canonical href whose replayed bytes do not match its digest', async () => {
    const expected = testClientModule('/c/cart.client.js', 'export const cart = true;');
    const handler: RequestHandler = async () =>
      new Response('export const cart = false;', {
        headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
      });

    await expect(
      replayStaticExportClientModuleArtifacts({
        context: { handler, origin: 'https://kovo.local' },
        routeArtifacts: [
          {
            body: `<script type="module" src="${expected.href}"></script>`,
            headers: {},
            path: '/index.html',
            status: 200,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          message: expect.stringContaining('do not match the full representation digest'),
          routePath: expected.href,
        },
      ],
    });
  });

  it('raises KV229 when a canonical client module replays to non-JavaScript', async () => {
    const expected = testClientModule('/c/missing.client.js', 'export {};');
    const handler: RequestHandler = async () =>
      new Response('<!doctype html><h1>Not found</h1>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200,
      });

    await expect(
      replayStaticExportClientModuleArtifacts({
        context: { handler, origin: 'https://kovo.local' },
        routeArtifacts: [
          {
            body: `<script type="module" src="${expected.href}"></script>`,
            headers: {},
            path: '/index.html',
            status: 200,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          message: expect.stringContaining(
            "returned status 200 with Content-Type 'text/html; charset=utf-8'",
          ),
          routePath: expected.href,
        },
      ],
    });
  });
});

function testClientModule(path: string, source: string): TestClientModule {
  return {
    href: versionedClientModuleHref(path, clientModuleRepresentationDigest(source)),
    source,
  };
}

function exactModuleHandler(modules: readonly TestClientModule[], seen: string[]): RequestHandler {
  return async (request) => {
    const url = new URL(request.url);
    seen.push(`${url.pathname}${url.hash}`);
    const module = modules.find((candidate) => candidate.href === url.pathname);
    return new Response(module?.source ?? 'Not Found', {
      headers: {
        'Content-Type': module ? 'text/javascript; charset=utf-8' : 'text/plain; charset=utf-8',
      },
      status: module ? 200 : 404,
    });
  };
}

function staticModuleArtifact(module: TestClientModule, href = module.href) {
  return {
    body: module.source,
    headers: { 'content-type': 'text/javascript; charset=utf-8' },
    href,
    path: module.href,
    status: 200,
  };
}
