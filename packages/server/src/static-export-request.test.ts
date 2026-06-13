import { describe, expect, it } from 'vitest';

import type { RequestHandler } from './app.js';
import { replayStaticExportRequest } from './static-export-request.js';

describe('server static export request replay boundary', () => {
  it('creates synthetic GET requests from normalized route pathnames', async () => {
    const seen: string[] = [];
    const handler: RequestHandler = async (request) => {
      const url = new URL(request.url);
      seen.push(`${request.method} ${url.href}`);
      return new Response(url.pathname);
    };

    await expect(
      replayStaticExportRequest({
        handler,
        origin: 'https://jiso.local/root?ignored=1',
        pathname: '/docs/intro',
      }),
    ).resolves.toMatchObject({
      url: new URL('https://jiso.local/docs/intro'),
    });
    expect(seen).toEqual(['GET https://jiso.local/docs/intro']);
  });

  it('preserves versioned client module query and fragment refs', async () => {
    const seen: string[] = [];
    const handler: RequestHandler = async (request) => {
      const url = new URL(request.url);
      seen.push(`${request.method} ${url.pathname}${url.search}${url.hash}`);
      return new Response('export const loaded = true;');
    };

    await replayStaticExportRequest({
      handler,
      href: '/c/cart.client.js?v=cart-1#Cart$add',
      origin: 'https://jiso.local',
    });

    expect(seen).toEqual(['GET /c/cart.client.js?v=cart-1#Cart$add']);
  });
});
