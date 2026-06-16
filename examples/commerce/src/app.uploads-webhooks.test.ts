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

    // SECURITY (SECURITY_FINDINGS.md M8): the key is namespaced with a server-generated
    // unguessable random id and a sanitized filename segment, so it can never be the
    // bare `receipts/<filename>` that allowed cross-user overwrite/disclosure.
    const namespacedKeyPattern = /^receipts\/[0-9a-f-]{36}\/receipt\.pdf$/;
    expect(storedReceipt.receipt.key).toMatch(namespacedKeyPattern);
    expect(storedReceipt.receipt).toMatchObject({
      file: receipt,
      storage: {
        contentType: 'application/pdf',
        key: storedReceipt.receipt.key,
        metadata: { filename: 'receipt.pdf' },
        size: 2048,
      },
    });
    // The download path resolves the blob by the row's stored key — verify that
    // exact key streams the bytes (the row -> blob mapping stays consistent).
    const storedObject = await commerceAttachmentStorage.stream(storedReceipt.receipt.key);
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
        storageKey: storedReceipt.receipt.key,
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
        // SECURITY (SECURITY_FINDINGS.md M9): the export is scoped to the requesting
        // user at the SOURCE read, so only u1's single order is loaded (etag counts
        // the scoped rowset, not the global order count).
        ETag: '"orders-1"',
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

  // SECURITY (SECURITY_FINDINGS.md M8): two users uploading the same filename must get
  // distinct, unguessable storage keys, so neither can overwrite or read the other's
  // bytes via a shared `receipts/<filename>` key.
  it('namespaces receipt keys so same-filename uploads from two users never collide (M8)', async () => {
    const parseReceipt = (input: unknown) =>
      (
        uploadReceipt.input as typeof uploadReceipt.input & {
          parseAsync(input: unknown): Promise<UploadReceiptInput>;
        }
      ).parseAsync(input);

    // Both users upload a file with the IDENTICAL client filename and distinct bytes.
    const userAReceipt = await parseReceipt({
      orderId: 'order-1',
      receipt: commerceFile('invoice.pdf', 'application/pdf', 11),
    });
    const userBReceipt = await parseReceipt({
      orderId: 'order-1',
      receipt: commerceFile('invoice.pdf', 'application/pdf', 22),
    });

    // Distinct keys despite the identical filename.
    expect(userAReceipt.receipt.key).not.toBe(userBReceipt.receipt.key);
    expect(userAReceipt.receipt.key).toMatch(/^receipts\/[0-9a-f-]{36}\/invoice\.pdf$/);
    expect(userBReceipt.receipt.key).toMatch(/^receipts\/[0-9a-f-]{36}\/invoice\.pdf$/);

    // Each user's bytes live under their own key — neither overwrote the other.
    const aBlob = await commerceAttachmentStorage.stream(userAReceipt.receipt.key);
    const bBlob = await commerceAttachmentStorage.stream(userBReceipt.receipt.key);
    expect(await storageBodyToBytes(aBlob!.body)).toHaveLength(11);
    expect(await storageBodyToBytes(bBlob!.body)).toHaveLength(22);
  });

  it('strips path separators from the receipt filename segment (M8 traversal hardening)', async () => {
    const traversal = await (
      uploadReceipt.input as typeof uploadReceipt.input & {
        parseAsync(input: unknown): Promise<UploadReceiptInput>;
      }
    ).parseAsync({
      orderId: 'order-1',
      receipt: commerceFile('../../etc/passwd', 'application/pdf', 5),
    });
    // The trailing segment is sanitized: no `/` or `\`, no parent-dir escape.
    expect(traversal.receipt.key).toMatch(/^receipts\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/);
    expect(traversal.receipt.key).not.toContain('..');
  });

  // SECURITY (SECURITY_FINDINGS.md M9): the webhook must reject attacker-chosen
  // productId / userId that do not resolve to a real catalog product / known user.
  it('rejects payment webhooks with an unknown productId or userId (M9 owner/catalog validation)', async () => {
    const signedBody = (overrides: { productId: string; userId: string; id: string }) =>
      JSON.stringify({
        data: {
          object: {
            id: overrides.id,
            productId: overrides.productId,
            quantity: 1,
            total: 100,
            userId: overrides.userId,
          },
        },
        id: overrides.id,
        type: 'checkout.session.completed',
      });

    const post = (body: string, db: ReturnType<typeof createCommerceDb>) =>
      runPaymentWebhook(
        requestWithDb(body, db, {
          'stripe-signature': stripeHeader(body, commercePaymentWebhookSecret),
        }),
      );

    // Unknown product (a formula-injection-style id that should never be persisted).
    const unknownProductDb = createCommerceDb();
    const unknownProductBody = signedBody({
      id: 'evt_bad_product',
      productId: '=HYPERLINK("http://evil")',
      userId: 'u1',
    });
    const unknownProduct = await post(unknownProductBody, unknownProductDb);
    expect(unknownProduct.response.status).toBe(422);
    expect(unknownProduct.value).toBeUndefined();
    expect(await readOrders(unknownProductDb)).toHaveLength(0);

    // Unknown user (attacker-chosen victim id that is not a real account).
    const unknownUserDb = createCommerceDb();
    const unknownUserBody = signedBody({
      id: 'evt_bad_user',
      productId: 'p1',
      userId: 'attacker-chosen-victim',
    });
    const unknownUser = await post(unknownUserBody, unknownUserDb);
    expect(unknownUser.response.status).toBe(422);
    expect(unknownUser.value).toBeUndefined();
    expect(await readOrders(unknownUserDb)).toHaveLength(0);
  });

  // SECURITY (SECURITY_FINDINGS.md M9): csvCell must neutralize spreadsheet formula
  // injection, not merely RFC-4180-quote.
  it('neutralizes CSV formula-injection in the orders export (M9 csvCell defang)', async () => {
    const db = createCommerceDb();
    // A poisoned productId that, unquoted, executes as a spreadsheet formula.
    await seedOrders(db, [
      {
        id: 'order-formula',
        productId: '=HYPERLINK("http://x")',
        qty: 1,
        total: 100,
        userId: 'u1',
      },
    ]);

    const csv = await renderOrderCsvRoute({ db, session: { id: 's-csv', user: { id: 'u1' } } });
    const text = new TextDecoder().decode(await storageBodyToBytes(csv.body));

    // The dangerous cell is prefixed with a single quote (defanged) BEFORE RFC-4180
    // quoting, so a spreadsheet treats it as literal text rather than a formula.
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
    // The raw, un-defanged formula must NOT appear as a bare leading-`=` cell.
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});
