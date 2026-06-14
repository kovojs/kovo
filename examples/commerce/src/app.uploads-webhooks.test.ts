import { describe, expect, it } from 'vitest';

import { storageBodyToBytes } from '@jiso/core';
import { htmlElementFacts, htmlFormFieldsByName, htmlFormFacts } from '@jiso/test/html-fragment';

import {
  attachmentDownloadRoute,
  commerceAttachmentStorage,
  commercePaymentWebhookSecret,
  createCommerceDb,
  orderCsvRoute,
  paymentWebhook,
  renderAttachmentDownloadRoute,
  renderOrderCsvRoute,
  renderCartPage,
  renderReceiptUploadForm,
  uploadReceipt,
  runPaymentWebhook,
  type UploadReceiptInput,
} from './app.js';
import {
  commerceFile,
  readAttachments,
  readOrders,
  requestWithDb,
  seedOrders,
  stripeHeader,
} from './app-test-helpers.js';

describe('commerce example', () => {
  it('renders a multipart receipt upload form on the commerce page', async () => {
    const form = renderReceiptUploadForm('order-1');
    const html = await renderCartPage();
    const [uploadForm] = htmlFormFacts(form);
    const fieldsByName = htmlFormFieldsByName(uploadForm);

    expect(uploadForm).toMatchObject({
      action: '/_m/order/receipt',
      attrs: {
        'aria-busy': 'false',
        'data-mutation': 'order/receipt',
        enctype: 'multipart/form-data',
        enhance: '',
        'fw-deps': 'order',
        method: 'post',
      },
      method: 'post',
    });
    expect(fieldsByName.orderId).toMatchObject({ value: 'order-1' });
    expect(fieldsByName.receipt).toMatchObject({
      attrs: { accept: 'application/pdf,image/png', type: 'file' },
    });
    expect(
      htmlElementFacts(form, { attrs: { 'fw-upload-progress': true }, tag: 'progress' }),
    ).toMatchObject([{ attrs: { max: '100', value: '0' } }]);
    expect(
      htmlFormFacts(html).some((pageForm) => pageForm.attrs['data-mutation'] === 'order/receipt'),
    ).toBe(true);
  });

  it('coerces commerce receipt uploads through storage-backed s.file()', async () => {
    const db = createCommerceDb();
    const receipt = commerceFile('receipt.pdf', 'application/pdf', 2048);
    const storedReceipt = await (
      uploadReceipt.input as typeof uploadReceipt.input & {
        parseAsync(input: unknown): Promise<UploadReceiptInput>;
      }
    ).parseAsync({
      orderId: 'order-1',
      receipt,
    });

    expect(storedReceipt.receipt).toMatchObject({
      file: receipt,
      key: 'receipts/receipt.pdf',
      storage: {
        contentType: 'application/pdf',
        key: 'receipts/receipt.pdf',
        metadata: { filename: 'receipt.pdf' },
        size: 2048,
      },
    });
    const storedObject = await commerceAttachmentStorage.stream('receipts/receipt.pdf');
    expect(storedObject).not.toBeUndefined();
    expect(await storageBodyToBytes(storedObject!.body)).toHaveLength(2048);

    await expect(
      uploadReceipt.handler(
        storedReceipt,
        { db, session: { id: 's-upload', user: { id: 'u1' } } },
        {
          fail(code, payload) {
            return { error: { code, payload }, ok: false, status: 422 };
          },
          invalidate(domain, options) {
            return { domain: domain.key, ...options, manual: true };
          },
        },
      ),
    ).resolves.toEqual({
      attachmentId: 'attachment-1',
      fileName: 'receipt.pdf',
      orderId: 'order-1',
      size: 2048,
      uploadedBy: 'u1',
    });
    expect(await readAttachments(db)).toEqual([
      {
        contentType: 'application/pdf',
        filename: 'receipt.pdf',
        id: 'attachment-1',
        orderId: 'order-1',
        size: 2048,
        storageKey: 'receipts/receipt.pdf',
        userId: 'u1',
      },
    ]);

    expect(() =>
      uploadReceipt.input.parse({
        orderId: 'order-1',
        receipt: commerceFile('receipt.txt', 'text/plain', 12),
      }),
    ).toThrow('Expected file type application/pdf, image/png');
  });

  it('adopts the webhook primitive for signed payment order writes', async () => {
    const db = createCommerceDb();
    const body = JSON.stringify({
      data: {
        object: {
          id: 'order-paid-1',
          productId: 'p1',
          quantity: 2,
          total: 2998,
          userId: 'u1',
        },
      },
      id: 'evt_paid_1',
      livemode: false,
      type: 'checkout.session.completed',
    });

    expect(paymentWebhook.webhook).toBe(true);
    expect(paymentWebhook.path).toBe('/webhooks/stripe');
    expect(paymentWebhook.auth).toEqual({
      kind: 'verifier',
      name: 'stripe:v1:hmac-sha256',
    });
    expect(paymentWebhook.csrf).toEqual({
      exempt: true,
      justification: 'payment/stripe webhook verifier stripe:v1:hmac-sha256',
    });

    const first = await runPaymentWebhook(
      requestWithDb(body, db, {
        'stripe-signature': stripeHeader(body, commercePaymentWebhookSecret),
      }),
    );

    expect(first.replayed).toBe(false);
    expect(first.value).toEqual({ orderId: 'order-paid-1' });
    expect(first.changes).toEqual([
      {
        domain: 'order',
        input: { eventId: 'evt_paid_1', orderId: 'order-paid-1' },
        keys: ['order-paid-1'],
        reason: 'payment webhook',
      },
    ]);
    expect(first.response.status).toBe(200);
    expect(first.response.headers.get('FW-Changes')).toBe(
      '[{"domain":"order","keys":["order-paid-1"]}]',
    );
    expect(await readOrders(db)).toEqual([
      {
        id: 'order-paid-1',
        productId: 'p1',
        qty: 2,
        total: 2998,
        userId: 'u1',
      },
    ]);

    const replay = await runPaymentWebhook(
      requestWithDb(body, db, {
        'stripe-signature': stripeHeader(body, commercePaymentWebhookSecret),
      }),
    );
    expect(replay.replayed).toBe(true);
    expect(await readOrders(db)).toHaveLength(1);

    const tampered = await runPaymentWebhook(
      requestWithDb(body.replace('2998', '9999'), db, {
        'stripe-signature': stripeHeader(body, commercePaymentWebhookSecret),
      }),
    );
    expect(tampered.response.status).toBe(401);
  });

  it('uses route file and stream outcomes for order CSV export and attachment download', async () => {
    const db = createCommerceDb();
    await seedOrders(db, [
      {
        id: 'order-1',
        productId: 'p1',
        qty: 2,
        total: 2998,
        userId: 'u1',
      },
      {
        id: 'order-2',
        productId: 'p2',
        qty: 1,
        total: 2599,
        userId: 'u2',
      },
    ]);
    const storedReceipt = await (
      uploadReceipt.input as typeof uploadReceipt.input & {
        parseAsync(input: unknown): Promise<UploadReceiptInput>;
      }
    ).parseAsync({
      orderId: 'order-1',
      receipt: commerceFile('download.pdf', 'application/pdf', 12),
    });
    await uploadReceipt.handler(
      storedReceipt,
      { db, session: { id: 's-upload', user: { id: 'u1' } } },
      {
        fail(code, payload) {
          return { error: { code, payload }, ok: false, status: 422 };
        },
        invalidate(domain, options) {
          return { domain: domain.key, ...options, manual: true };
        },
      },
    );

    expect(orderCsvRoute.path).toBe('/exports/orders.csv');
    expect(attachmentDownloadRoute.path).toBe('/attachments/:id');

    const csv = await renderOrderCsvRoute({ db, session: { id: 's-csv', user: { id: 'u1' } } });
    expect(csv).toMatchObject({
      headers: {
        'Content-Disposition': 'attachment; filename="orders.csv"',
        'Content-Type': 'text/csv; charset=utf-8',
        ETag: '"orders-2"',
      },
      status: 200,
    });
    expect(await storageBodyToBytes(csv.body)).toEqual(
      new TextEncoder().encode('id,productId,qty,total,userId\norder-1,p1,2,2998,u1\n'),
    );

    const download = await renderAttachmentDownloadRoute(db, 'attachment-1', {
      db,
      session: { id: 's-download', user: { id: 'u1' } },
    });
    expect(download).toMatchObject({
      headers: {
        'Content-Disposition': 'inline; filename="download.pdf"',
        'Content-Type': 'application/pdf',
      },
      status: 200,
    });
    expect(await storageBodyToBytes(download.body)).toHaveLength(12);

    await expect(
      renderAttachmentDownloadRoute(db, 'attachment-1', {
        db,
        session: { id: 's-download-other', user: { id: 'u2' } },
      }),
    ).resolves.toMatchObject({ status: 404 });
  });
});
