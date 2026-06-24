import { describe, expect, it } from 'vitest';

import { respond } from './response.js';
import { renderRoutePageResponse, route } from './route.js';

describe('route responses', () => {
  it('renders route file and stream outcomes without passing through the HTML renderer', async () => {
    const fileRoute = route('/downloads/orders.pdf', {
      page() {
        return respond.file('%PDF-1.7\n', {
          contentType: 'application/pdf',
          etag: '"orders-pdf-v1"',
          filename: 'orders.pdf',
        });
      },
    });
    const streamRoute = route('/attachments/:id', {
      page(context) {
        // KV428: an un-bufferable stream served inline is the branded opt-in — the route attests
        // the bytes are verified-safe (re-encoded/rasterized) via `verifiedSafe: true`.
        return respond.stream(new ReadableStream<Uint8Array>(), {
          contentType: 'application/octet-stream',
          disposition: 'inline',
          filename: `${context.params.id}.bin`,
          verifiedSafe: true,
        });
      },
    });

    await expect(
      renderRoutePageResponse(fileRoute, {}, { headers: { 'If-None-Match': '"stale"' } }, () => {
        throw new Error('file outcomes do not render as HTML');
      }),
    ).resolves.toEqual({
      body: '%PDF-1.7\n',
      headers: {
        'Content-Disposition': 'attachment; filename="orders.pdf"',
        'Content-Type': 'application/pdf',
        ETag: '"orders-pdf-v1"',
        // SECURITY_FINDINGS.md M1: file/stream outcomes default to nosniff.
        'X-Content-Type-Options': 'nosniff',
      },
      status: 200,
    });
    await expect(
      renderRoutePageResponse(fileRoute, {}, { headers: { 'If-None-Match': '"orders-pdf-v1"' } }),
    ).resolves.toEqual({
      body: '',
      headers: { ETag: '"orders-pdf-v1"' },
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
