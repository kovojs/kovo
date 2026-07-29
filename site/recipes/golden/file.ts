import { respond } from '@kovojs/server';

export const invoiceDownload = respond.file(new TextEncoder().encode('invoice,paid\n42,true\n'), {
  contentType: 'text/csv; charset=utf-8',
  filename: 'invoice-42.csv',
  headers: { 'Cache-Control': 'private, no-store' },
});
