// SPEC.md §10.1/§10.3: the shared fixture read always binds the requested row to the
// session-derived owner before returning it to a route or typed read endpoint.
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

interface InvoiceRow {
  [key: string]: unknown;
  id: string;
  owner_id: string;
  total: number;
}

export async function readInvoice(
  db: KovoFixtureRequest['db'],
  invoiceId: string,
  ownerId: string,
): Promise<InvoiceRow | null> {
  const [row] = await db.query<InvoiceRow>({
    text: 'select id, owner_id, total from invoices where id = $1 and owner_id = $2',
    values: [invoiceId, ownerId],
  });
  return row ?? null;
}
