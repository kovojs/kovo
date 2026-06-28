import { form } from '@kovojs/core';
import { domain, guards, mutation, s, serverValue, type MutationContext } from '@kovojs/server';
import { eq } from 'drizzle-orm';

import { appCsrf, type AppRequest } from './auth.js';
import type { ContactListResult } from './queries.js';
import { contacts } from './schema.js';

const contact = domain('contact');

// Register the query result + the queries this mutation invalidates. The compiler
// uses these to type-check optimistic coverage (KV310) and to refresh the contact
// list after a write (SPEC.md §11.1).
declare module '@kovojs/core' {
  interface QueryRegistry {
    contacts: ContactListResult;
  }
  interface InvalidationSets {
    'mutations/add-contact': 'contacts';
  }
}

export const addContactForm = form('mutations/add-contact');
export interface AddContactInput {
  company: string;
  email: string;
  name: string;
}

const duplicateEmailError = s.object({ email: s.string() });

// One real write: validate input, guard it behind a session, insert a row, and
// predict the optimistic list update. No-JS clients POST to the typed mutation
// endpoint and get the refreshed page; `enhance` upgrades the same form to a fragment swap.
export const addContact = mutation({
  csrf: appCsrf,
  errors: { DUPLICATE_EMAIL: duplicateEmailError },
  guard: guards.authed<AppRequest>(),
  input: s.object({
    name: s.string(),
    email: s.string(),
    company: s.string(),
  }),
  optimistic: {
    contacts(draft: ContactListResult, $input: AddContactInput) {
      const row = {
        id: `pending-${$input.email}`,
        name: $input.name,
        email: $input.email,
        company: $input.company,
      };
      const index = draft.items.findIndex((entry) => entry.id > row.id);
      if (index < 0) draft.items.push(row);
      else draft.items.splice(index, 0, row);
    },
  },
  registry: { touches: [contact] },
  async handler(
    { name, email, company },
    request: AppRequest,
    context: MutationContext<{ DUPLICATE_EMAIL: typeof duplicateEmailError }>,
  ) {
    const db = request.db;
    const [existing] = await db.select().from(contacts).where(eq(contacts.email, email)).limit(1);
    if (existing) {
      return context.fail('DUPLICATE_EMAIL', { email });
    }
    const id = `c-${crypto.randomUUID()}`;
    await db
      .insert(contacts)
      .values({ id: serverValue(id, 'server-generated contact id'), name, email, company });
    return { id };
  },
});

export const appMutations = [addContact];
