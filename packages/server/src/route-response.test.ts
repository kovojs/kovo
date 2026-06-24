import { publicAccess } from './access.js';
import { describe, expect, it, vi } from 'vitest';

import { respond } from './response.js';
import { renderRoutePageResponse, route } from './route.js';

describe('route responses', () => {
  it('renders route file and stream outcomes without passing through the HTML renderer', async () => {
    const fileRoute = route('/downloads/orders.pdf', {
      access: publicAccess('test fixture'),
      page() {
        return respond.file('%PDF-1.7\n', {
          contentType: 'application/pdf',
          etag: '"orders-pdf-v1"',
          filename: 'orders.pdf',
        });
      },
    });
    const streamRoute = route('/attachments/:id', {
      access: publicAccess('test fixture'),
      page(context) {
        return respond.stream(new ReadableStream<Uint8Array>(), {
          contentType: 'application/octet-stream',
          disposition: 'inline',
          filename: `${context.params.id}.bin`,
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

  it('reports respond.stream mid-stream failures with an opaque correlation id', async () => {
    const thrown = new Error('private export stream failure');
    const onError = vi.fn();
    const request = {};
    const exportRoute = route('/exports.csv', {
      access: publicAccess('test fixture'),
      page() {
        return respond.stream(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('id,name\n'));
            },
            pull() {
              throw thrown;
            },
          }),
          { contentType: 'text/csv' },
        );
      },
    });

    const response = await renderRoutePageResponse(exportRoute, {}, request, undefined, {
      onError,
    });
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(response.headers).toMatchObject({
      'Content-Disposition': 'attachment',
      'Content-Type': 'text/csv',
      'Kovo-Error-Id': expect.stringMatching(/^kovo-/),
      'X-Content-Type-Options': 'nosniff',
    });

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await expect(reader.read()).rejects.toThrow(
      `Kovo stream failed. Reference: ${response.headers['Kovo-Error-Id']}`,
    );
    expect(onError).toHaveBeenCalledWith(thrown, {
      correlationId: response.headers['Kovo-Error-Id'],
      operation: 'route-render',
      request,
      routePath: '/exports.csv',
    });
  });
});
