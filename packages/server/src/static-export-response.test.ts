import { describe, expect, it } from 'vitest';

import { markFrameworkDocumentResponse } from './response.js';
import { readStaticExportReplayedResponse } from './static-export-response.js';

const responseTestBuildToken = 'static-export-response-test-build';

function frameworkDocumentResponse(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Kovo-Build', responseTestBuildToken);
  return markFrameworkDocumentResponse(
    new Response(body, { ...init, headers }),
    responseTestBuildToken,
  );
}

describe('server static export replay response boundary', () => {
  it('snapshots successful route document responses with sorted headers', async () => {
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: frameworkDocumentResponse('<main>Docs</main>', {
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

  it('rejects generic HTML without framework document provenance', async () => {
    // SPEC §6.6/§9.5: copyable HTML syntax and headers cannot substitute for the module-private
    // receipt minted by request-shell document assembly.
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: new Response('<script>globalThis.staticExportPwned = true</script>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
        routePath: '/docs',
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        expect.objectContaining({
          message: expect.stringContaining('provenance-marked framework document'),
          routePath: '/docs',
        }),
      ],
    });
  });

  it('verifies and omits only a provenance-marked framework Kovo-Build header', async () => {
    const response = markFrameworkDocumentResponse(
      new Response('<meta name="kovo-build" content="build-a"><main>Docs</main>', {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Kovo-Build': 'build-a',
          'X-Route': '/docs',
        },
      }),
      'build-a',
    );

    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response,
        routePath: '/docs',
      }),
    ).resolves.toMatchObject({
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-route': '/docs',
      },
    });

    response.headers.set('Kovo-Build', 'build-b');
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response,
        routePath: '/docs',
      }),
    ).rejects.toThrow(/Kovo-Build transport proof does not match/u);
  });

  it('rejects a provenance-marked document without its exact Kovo-Build transport proof', async () => {
    const response = markFrameworkDocumentResponse(
      new Response('<main>Docs</main>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
      'build-a',
    );

    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response,
        routePath: '/docs',
      }),
    ).rejects.toThrow(/missing its Kovo-Build transport proof/u);
  });

  it('rejects static route document response headers that cannot be exported', async () => {
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: frameworkDocumentResponse('<main>Docs</main>', {
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
        response: frameworkDocumentResponse('nope', {
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

  it('does not classify media types that merely contain the text/html substring', async () => {
    // SPEC §6.6/§9.5: exact media-type classification prevents an active app response from using a
    // token such as application/x-text/html-evil to enter the route-document publication path.
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: frameworkDocumentResponse('<script>globalThis.pwned = true</script>', {
          headers: { 'Content-Type': 'application/x-text/html-evil' },
        }),
        routePath: '/malformed-media',
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        expect.objectContaining({
          message: expect.stringContaining(
            "returned status 200 with Content-Type 'application/x-text/html-evil'",
          ),
          routePath: '/malformed-media',
        }),
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

  it('pins response headers before classifying file responses as route documents', async () => {
    const response = new Response('DATABASE_PASSWORD=prod-only-secret', {
      headers: {
        'Content-Disposition': 'attachment; filename="private-report.txt"',
        'Content-Type': 'text/plain; charset=utf-8',
      },
      status: 200,
    });
    const headers = response.headers;
    const originalGet = Headers.prototype.get;

    try {
      Headers.prototype.get = function (name) {
        if (this === headers && String(name).toLowerCase() === 'content-disposition') return null;
        if (this === headers && String(name).toLowerCase() === 'content-type') {
          return 'text/html; charset=utf-8';
        }
        return Reflect.apply(originalGet, this, [name]);
      };

      await expect(
        readStaticExportReplayedResponse({
          kind: 'route-document',
          response,
          routePath: '/private-report',
        }),
      ).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          expect.objectContaining({
            message: expect.stringContaining('file/stream response'),
            routePath: '/private-report',
          }),
        ],
      });
    } finally {
      Headers.prototype.get = originalGet;
    }
  });

  it('pins the Response headers carrier before classifying route documents', async () => {
    const response = new Response('DATABASE_PASSWORD=prod-only-secret', {
      headers: {
        'Content-Disposition': 'attachment; filename="private-report.txt"',
        'Content-Type': 'text/plain; charset=utf-8',
      },
      status: 200,
    });
    const descriptor = Object.getOwnPropertyDescriptor(Response.prototype, 'headers');
    expect(descriptor?.get).toBeTypeOf('function');
    const forgedHeaders = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });

    Object.defineProperty(Response.prototype, 'headers', {
      configurable: true,
      get(this: Response) {
        return this === response ? forgedHeaders : Reflect.apply(descriptor!.get!, this, []);
      },
    });
    try {
      await expect(
        readStaticExportReplayedResponse({
          kind: 'route-document',
          response,
          routePath: '/private-report',
        }),
      ).rejects.toMatchObject({
        code: 'KV229',
        diagnostics: [
          expect.objectContaining({
            message: expect.stringContaining('file/stream response'),
            routePath: '/private-report',
          }),
        ],
      });
    } finally {
      Object.defineProperty(Response.prototype, 'headers', descriptor!);
    }
  });

  it('snapshots response headers before awaiting a route document body', async () => {
    const encoder = new TextEncoder();
    let response!: Response;
    response = new Response(
      new ReadableStream({
        pull(controller) {
          response.headers.delete('content-disposition');
          controller.enqueue(encoder.encode('DATABASE_PASSWORD=prod-only-secret'));
          controller.close();
        },
      }),
      {
        headers: {
          'Content-Disposition': 'attachment; filename="private-report.html"',
          'Content-Type': 'text/html; charset=utf-8',
        },
        status: 200,
      },
    );

    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response,
        routePath: '/private-report',
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        expect.objectContaining({
          message: expect.stringContaining('file/stream response'),
          routePath: '/private-report',
        }),
      ],
    });
  });

  it('raises concrete KV229 for public deferred route documents', async () => {
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: frameworkDocumentResponse(
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
          message: expect.stringContaining('deferred, streamed, or fragment route markers'),
          routePath: '/products/p1',
        },
      ],
    });
  });

  it('allows marker-looking documentation text inside preformatted code blocks', async () => {
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: frameworkDocumentResponse(
          [
            '<!doctype html><main>',
            '<pre class="shiki"><code>',
            '<span>&lt;kovo-fragment target=&quot;docs&quot;&gt;</span>',
            '<span>--kovo-boundary</span>',
            '</code></pre>',
            '<p>Docs page</p>',
            '</main>',
          ].join(''),
          {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            status: 200,
          },
        ),
        routePath: '/docs/streaming',
      }),
    ).resolves.toMatchObject({
      body: expect.stringContaining('--kovo-boundary'),
      status: 200,
    });
  });

  it('allows server-only protocol examples inside inert templates', async () => {
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: frameworkDocumentResponse(
          [
            '<!doctype html><main>',
            '<template>',
            '<form action="/_m/example"><button>Example</button></form>',
            '<kovo-fragment target="docs">Example</kovo-fragment>',
            '--kovo-boundary',
            '</template>',
            '<p>Docs page</p>',
            '</main>',
          ].join(''),
          {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            status: 200,
          },
        ),
        routePath: '/docs/templates',
      }),
    ).resolves.toMatchObject({
      body: expect.stringContaining('--kovo-boundary'),
      status: 200,
    });
  });

  it('reports concrete deferred route markers instead of an opaque route 500', async () => {
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: frameworkDocumentResponse(
          '<main><kovo-fragment target="feed">Loading</kovo-fragment></main>',
          {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            status: 500,
          },
        ),
        routePath: '/',
      }),
    ).rejects.toMatchObject({
      code: 'KV229',
      diagnostics: [
        {
          code: 'KV229',
          message: expect.stringContaining('deferred, streamed, or fragment route markers'),
          routePath: '/',
        },
      ],
    });
  });

  it('reports replayed HTML endpoint refs instead of an opaque route 500', async () => {
    await expect(
      readStaticExportReplayedResponse({
        kind: 'route-document',
        response: frameworkDocumentResponse(
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
