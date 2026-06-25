import { describe, expect, it } from 'vitest';

import { readStaticExportReplayedResponse } from './static-export-response.js';

describe('server static export replay response boundary', () => {
  it('snapshots successful route document responses with sorted headers', async () => {
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: new Response('<main>Docs</main>', {
          headers: { 'X-Route': '/docs', 'Content-Type': 'text/html; charset=utf-8' },
        }),
        routePath: '/docs',
      }),
    ).resolves.toEqual({
      body: '<main>Docs</main>',
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-route': '/docs',
      },
      status: 200,
    });
  });

  it('rejects static route document response headers that cannot be exported', async () => {
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: new Response('<main>Docs</main>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'sid=1; Path=/' },
        }),
        routePath: '/docs',
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          message: expect.stringContaining('static export artifacts cannot carry Set-Cookie'),
          routePath: '/docs',
        },
      ],
    });
  });

  it('raises KV229 for non-HTML route document responses', async () => {
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: new Response('nope', {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }),
        routePath: '/docs',
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          message: expect.stringContaining(
            "successful HTML route documents; '/docs' returned status 200",
          ),
          routePath: '/docs',
        },
      ],
    });
  });

  it('snapshots JavaScript client module responses', async () => {
    await expect(
      readStaticExportReplayedResponse({
        href: '/c/docs.client.js?v=build',
        kind: 'client-module',
        path: '/c/docs.client.js',
        response: new Response('export const docs = true;', {
          headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
        }),
      }),
    ).resolves.toEqual({
      body: 'export const docs = true;',
      headers: { 'content-type': 'text/javascript; charset=utf-8' },
      status: 200,
    });
  });

  it('raises KV229 for client module responses that are not JavaScript', async () => {
    await expect(
      readStaticExportReplayedResponse({
        href: '/c/docs.client.js?v=build',
        kind: 'client-module',
        path: '/c/docs.client.js',
        response: new Response('<main>Docs</main>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          message: expect.stringContaining("cannot copy client module '/c/docs.client.js?v=build'"),
          routePath: '/c/docs.client.js',
        },
      ],
    });
  });
});
