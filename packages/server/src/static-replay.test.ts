import { describe, expect, it } from 'vitest';

import type { RequestHandler } from './app.js';
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
