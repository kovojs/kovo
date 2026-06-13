import { describe, expect, it } from 'vitest';

import type { RequestHandler } from './app.js';
import { replayStaticExportRequest } from './static-export-request.js';

describe('server static export replay request boundary', () => {
  it('constructs SPEC 9.5 synthetic GET requests from pathnames and hrefs', async () => {
    const seen: string[] = [];
    const handler: RequestHandler = async (request) => {
      const url = new URL(request.url);
      seen.push(`${request.method} ${url.pathname}${url.search}${url.hash}`);
      return new Response('ok');
    };

    await expect(
      replayStaticExportRequest({
        handler,
        origin: 'https://jiso.local/base?ignored=1',
        pathname: '/docs/intro?from=route#hash',
      }),
    ).resolves.toMatchObject({
      url: new URL('https://jiso.local/docs/intro?from=route#hash'),
    });

    await expect(
      replayStaticExportRequest({
        handler,
        href: '/c/cart.client.js?v=build-1#Cart$add',
        origin: 'https://jiso.local',
      }),
    ).resolves.toMatchObject({
      url: new URL('https://jiso.local/c/cart.client.js?v=build-1#Cart$add'),
    });

    expect(seen).toEqual([
      'GET /docs/intro?from=route#hash',
      'GET /c/cart.client.js?v=build-1#Cart$add',
    ]);
  });
});
