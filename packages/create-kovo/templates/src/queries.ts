import type { JsonValue } from '@kovojs/server';

import { app } from './kovo.js';
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

// SPEC §9.4/§10.3 (MARQUEE): a query loader narrows the framework-owned read-only `context.db`
// handle inferred from `defineKovo({ db })` — write verbs are removed at the type level and throw
// `KovoReadonlyHandleError` at runtime. A write in a loader is a `tsc` error AND a runtime throw
// AND a KV433 static-gate error.

// AGG(contacts) ordered by id — the full contact book. The Drizzle read is
// extracted from this loader so the compiler knows it depends on the `contact`
// domain and refreshes after `contacts/add`. The read shows the signed-in user's
// data, so its KV436 access decision is the session-presence guard (SPEC §10.2).
export const contactsQuery = app.query({
  access: [app.authenticated],
  async load(_input, context): Promise<ContactListResult> {
    const db = context.db;
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
