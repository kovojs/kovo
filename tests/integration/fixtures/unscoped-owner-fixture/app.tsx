// SPEC.md §10.1/§10.3: owner-scoped request paths must derive row ownership
// from the resolved session and avoid serving cross-user rows.
import { createApp, domain, guards, query, route, runQuery, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/integration/define';

interface OwnerSession {
  user: { id: string; roles: readonly string[] };
}
type OwnerRequest = KovoFixtureRequest & { session?: OwnerSession | null };

interface InvoiceRow {
  [key: string]: unknown;
  id: string;
  owner_id: string;
  total: number;
}

const COOKIE = 'owner_user';
const invoiceDomain = domain('invoice');

function readSessionCookie(request: Request): OwnerSession | null {
  const raw = request.headers.get('cookie') ?? '';
  const entry = raw
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  if (!entry) return null;

  const id = decodeURIComponent(entry.slice(COOKIE.length + 1));
  return id ? { user: { id, roles: [] } } : null;
}

async function readInvoice(
  db: KovoFixtureRequest['db'],
  invoiceId: string,
  ownerId: string,
): Promise<InvoiceRow | null> {
  const [row] = await db.query<InvoiceRow>(
    'select id, owner_id, total from invoices where id = $1 and owner_id = $2',
    [invoiceId, ownerId],
  );
  return row ?? null;
}

export const ownerInvoiceQuery = query('owner-invoice', {
  args: s.object({ id: s.string() }),
  guard: guards.authed<OwnerRequest>(),
  instanceKey: (input) => `owner-invoice:${(input as { id?: string }).id ?? ''}`,
  async load(input: { id: string }, { request }: { request: OwnerRequest }) {
    const ownerId = request.session?.user.id;
    if (!ownerId) return { invoice: null };
    return { invoice: await readInvoice(request.db, input.id, ownerId) };
  },
  reads: [invoiceDomain],
});

const invoiceRoute = route('/invoice', {
  guard: guards.authed<OwnerRequest>(),
  search: s.object({ id: s.string() }),
  async page({ search }, request: OwnerRequest) {
    const result = await runQuery(ownerInvoiceQuery, search, request);
    const invoice = result.ok ? result.value.invoice : null;

    if (!invoice) {
      return `<main><h1>Invoice</h1><p data-denied>not-found</p></main>`;
    }

    return `<main>
      <h1>Invoice</h1>
      <p data-invoice>${invoice.owner_id}:${invoice.id}:$${invoice.total}</p>
    </main>`;
  },
});

export default defineFixture({
  app: createApp<OwnerSession>({
    queries: [ownerInvoiceQuery],
    routes: [invoiceRoute],
    sessionProvider: (request) => readSessionCookie(request),
  }),
  schema: `create table invoices (
    id text primary key,
    owner_id text not null,
    total integer not null
  )`,
  seed: async (db) => {
    await db.write('invoices', { id: 'inv-u1', owner_id: 'u1', total: 31 });
    await db.write('invoices', { id: 'inv-u2', owner_id: 'u2', total: 47 });
  },
});
