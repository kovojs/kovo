import { query, type QueryLoadContext } from '@kovojs/server';

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
  db: AppDb;
  session?: { user: { id: string } } | null;
}

type AppQueryLoadContext = QueryLoadContext<AppQueryRequest> & { db?: AppDb };

// AGG(contacts) ordered by id — the full contact book. The Drizzle read is
// extracted from this loader so the compiler knows it depends on the `contact`
// domain and refreshes after `contacts/add`. The read shows the signed-in user's
// data, so its KV436 access decision is the session-presence guard (SPEC §10.2).
export const contactsQuery = query('contacts', {
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

function requireDb(context?: AppQueryLoadContext): AppDb {
  const db = context?.db ?? context?.request?.db;
  if (!db) {
    throw new Error('contacts query requires context.db or request.db');
  }
  return db;
}
