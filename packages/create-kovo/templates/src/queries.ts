import { query, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';

import { appAuthed } from './auth.js';
import type { AppDb } from './db.js';
import { contacts } from './schema.js';

export interface ContactRow {
  readonly [key: string]: JsonValue;
  id: string;
  name: string;
  email: string;
  company: string;
}

export interface ContactListResult {
  readonly [key: string]: JsonValue;
  items: ContactRow[];
}

export interface AppQueryRequest {
  session?: { user: { id: string } } | null;
}

// SPEC §9.4/§10.3 (MARQUEE): a query loader narrows the framework-owned read-only `context.db`
// handle into an immutable `Reader<AppDb>` binding — the write verbs are removed at the type level
// and throw `KovoReadonlyHandleError` at runtime. The loader no longer brings its own db; the
// framework threads this SQL-safe managed handle. A write in a loader is a `tsc` error AND a
// runtime throw AND a KV433 static-gate error.
type AppQueryLoadContext = QueryLoadContext<AppQueryRequest, AppDb>;

// AGG(contacts) ordered by id — the full contact book. The Drizzle read is
// extracted from this loader so the compiler knows it depends on the `contact`
// domain and refreshes after `contacts/add`. The read shows the signed-in user's
// data, so its KV436 access decision is the session-presence guard (SPEC §10.2).
export const contactsQuery = query({
  access: [appAuthed],
  async load(_input: unknown, context?: AppQueryLoadContext): Promise<ContactListResult> {
    const db: Reader<AppDb> | undefined = context?.db;
    if (!db) {
      throw new Error('contacts query requires the framework-provided context.db');
    }
    return {
      items: await db
        .select({
          id: contacts.id,
          name: contacts.name,
          email: contacts.email,
          company: contacts.company,
        })
        .from(contacts)
        .orderBy(contacts.id),
    };
  },
});
