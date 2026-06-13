import { describe, expect, it } from 'vitest';

import { readStaticExportReplayedResponse } from './static-export-response.js';

describe('server static export replay response boundary', () => {
  it('accepts successful HTML documents and JavaScript client modules as snapshots', async () => {
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: new Response('<main>Home</main>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Route': '/' },
        }),
        routePath: '/',
      }),
    ).resolves.toEqual({
      body: '<main>Home</main>',
      headers: { 'content-type': 'text/html; charset=utf-8', 'x-route': '/' },
      status: 200,
    });

    await expect(
      readStaticExportReplayedResponse({
        href: '/c/cart.client.js?v=build-1#Cart$add',
        kind: 'client-module',
        path: '/c/cart.client.js',
        response: new Response('export const cart = true;', {
          headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
        }),
      }),
    ).resolves.toEqual({
      body: 'export const cart = true;',
      headers: { 'content-type': 'application/javascript; charset=utf-8' },
      status: 200,
    });
  });

  it('reports FW229 through one replay response diagnostic seam', async () => {
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: new Response('missing', {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          status: 404,
        }),
        routePath: '/missing',
      }),
    ).rejects.toMatchObject({
      code: 'FW229',
      diagnostics: [
        {
          code: 'FW229',
          message: expect.stringContaining(
            "successful HTML route documents; '/missing' returned status 404",
          ),
          routePath: '/missing',
        },
      ],
    });

    await expect(
      readStaticExportReplayedResponse({
        href: '/c/missing.client.js?v=build-1',
        kind: 'client-module',
        path: '/c/missing.client.js',
        response: new Response('<main>Missing</main>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      }),
    ).rejects.toMatchObject({
      code: 'FW229',
      diagnostics: [
        {
          code: 'FW229',
          message: expect.stringContaining(
            "cannot copy client module '/c/missing.client.js?v=build-1'",
          ),
          routePath: '/c/missing.client.js',
        },
      ],
    });
  });
});
