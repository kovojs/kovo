import { query, type QueryLoadContext, type Reader } from '@kovojs/server';

import { appAuthed } from './auth.js';
import type { AppDb } from './db.js';
import { contacts } from './schema.js';

export interface ContactRow {
  id: string;
  name: string;
  email: string;
  company: string;
}

export interface ContactListResult {
  items: ContactRow[];
}

export interface AppQueryRequest {
  session?: { user: { id: string } } | null;
}

// SPEC §9.4/§10.3 (MARQUEE): a query loader destructures the framework-owned read-only handle
// `{ db }` (typed `Reader<AppDb>` — the write verbs are removed at the type level and throw
// `KovoReadonlyHandleError` at runtime). The loader no longer brings its own db; the framework
// threads the SQL-safe, read-only managed handle as `context.db`. A write in a loader is a `tsc`
// error AND a runtime throw AND a KV433 static-gate error.
type AppQueryLoadContext = QueryLoadContext<AppQueryRequest, AppDb>;

// AGG(contacts) ordered by id — the full contact book. The Drizzle read is
// extracted from this loader so the compiler knows it depends on the `contact`
// domain and refreshes after `contacts/add`. The read shows the signed-in user's
// data, so its KV436 access decision is the session-presence guard (SPEC §10.2).
export const contactsQuery = query({
  guard: appAuthed,
  async load(_input: unknown, context?: AppQueryLoadContext): Promise<ContactListResult> {
    const db = requireDb(context);
    const items = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        company: contacts.company,
      })
      .from(contacts)
      .orderBy(contacts.id);
    return { items };
  },
});

// SPEC §9.4 (MARQUEE): the framework provides `context.db` as the read-only managed handle. A loader
// destructures it directly; this guard surfaces a clear error when a loader is invoked without the
// framework-threaded handle (e.g. a direct `query.load()` call missing its db).
function requireDb(context?: AppQueryLoadContext): Reader<AppDb> {
  const db = context?.db;
  if (!db) {
    throw new Error('contacts query requires the framework-provided context.db');
  }
  return db;
}
