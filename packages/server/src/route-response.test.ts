import { describe, expect, it } from 'vitest';

import { respond } from './response.js';
import { renderRoutePageResponse, route } from './route.js';

describe('route responses', () => {
  it('renders route file and stream outcomes without passing through the HTML renderer', async () => {
    const csvRoute = route('/exports/orders.csv', {
      page() {
        return respond.file('id,total\nord_1,42\n', {
          contentType: 'text/csv; charset=utf-8',
          etag: '"orders-v1"',
          filename: 'orders.csv',
        });
      },
    });
    const streamRoute = route('/attachments/:id', {
      page(context) {
        return respond.stream(new ReadableStream<Uint8Array>(), {
          contentType: 'application/octet-stream',
          disposition: 'inline',
          filename: `${context.params.id}.bin`,
        });
      },
    });

    await expect(
      renderRoutePageResponse(csvRoute, {}, { headers: { 'If-None-Match': '"stale"' } }, () => {
        throw new Error('file outcomes do not render as HTML');
      }),
    ).resolves.toEqual({
      body: 'id,total\nord_1,42\n',
      headers: {
        'Content-Disposition': 'attachment; filename="orders.csv"',
        'Content-Type': 'text/csv; charset=utf-8',
        ETag: '"orders-v1"',
      },
      status: 200,
    });
    await expect(
      renderRoutePageResponse(csvRoute, {}, { headers: { 'If-None-Match': '"orders-v1"' } }),
    ).resolves.toEqual({
      body: '',
      headers: { ETag: '"orders-v1"' },
      status: 304,
    });

    const streamResponse = await renderRoutePageResponse(
      streamRoute,
      { params: { id: 'receipt' } },
      {},
    );
    expect(streamResponse).toMatchObject({
      headers: {
        'Content-Disposition': 'inline; filename="receipt.bin"',
        'Content-Type': 'application/octet-stream',
      },
      status: 200,
    });
    expect(streamResponse.body).toBeInstanceOf(ReadableStream);
  });
});
