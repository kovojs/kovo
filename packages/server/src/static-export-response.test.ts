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

  it('raises concrete KV229 for replayed route redirects', async () => {
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: new Response('', {
          headers: { Location: '/new-home' },
          status: 303,
        }),
        routePath: '/old-home',
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          message: expect.stringContaining('replay returned redirect status 303'),
          routePath: '/old-home',
        },
      ],
    });
  });

  it('raises concrete KV229 for replayed file and stream route outcomes', async () => {
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: new Response('report', {
          headers: {
            'Content-Disposition': 'attachment; filename="report.txt"',
            'Content-Type': 'text/plain; charset=utf-8',
          },
          status: 200,
        }),
        routePath: '/report',
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          message: expect.stringContaining('replay returned a file/stream response'),
          routePath: '/report',
        },
      ],
    });
  });

  it('raises concrete KV229 for public deferred route documents', async () => {
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: new Response(
          [
            '<!doctype html><main>',
            '<kovo-defer target="reviews:p1" state="pending">Loading</kovo-defer>',
            '--kovo-boundary',
            '<kovo-fragment target="reviews:p1">Reviews ready</kovo-fragment>',
            '</main>',
          ].join('\n'),
          {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            status: 200,
          },
        ),
        routePath: '/products/p1',
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          message: expect.stringContaining('deferred/streamed route fragments'),
          routePath: '/products/p1',
        },
      ],
    });
  });

  it('reports replayed HTML endpoint refs instead of an opaque route 500', async () => {
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: new Response(
          [
            '<main>',
            '<form action="/_m/chat/send" data-mutation-stream="true">',
            '<button>Send</button>',
            '</form>',
            '</main>',
          ].join(''),
          {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            status: 500,
          },
        ),
        routePath: '/streaming-deferred',
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          message: expect.stringContaining(
            "replayed HTML attribute 'action' references server mutation endpoint '/_m/chat/send'",
          ),
          routePath: '/streaming-deferred',
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
