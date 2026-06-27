import { form, type FormInput } from '@kovojs/core';
import { guards, mutation, s, type MutationContext } from '@kovojs/server';
import { eq } from 'drizzle-orm';

import { appCsrf, type AppRequest } from './auth.js';
import type { ContactListResult } from './queries.js';
import { contacts } from './schema.js';

// Register the query result + the queries this mutation invalidates. The compiler
// uses these to type-check optimistic coverage (KV310) and to refresh the contact
// list after a write (SPEC.md §11.1).
declare module '@kovojs/core' {
  interface QueryRegistry {
    contacts: ContactListResult;
  }
  interface InvalidationSets {
    addContact: 'contacts';
  }
}

export const addContactForm = form('addContact');
export type AddContactInput = FormInput<typeof addContactForm>;

const duplicateEmailError = s.object({ email: s.string() });

// One real write: validate input, guard it behind a session, insert a row, and
// predict the optimistic list update. No-JS clients POST to the typed mutation
// endpoint and get the refreshed page; `enhance` upgrades the same form to a fragment swap.
export const addContact = mutation('addContact', {
  csrf: appCsrf,
  errors: { DUPLICATE_EMAIL: duplicateEmailError },
  guard: guards.authed<AppRequest>(),
  input: s.object({
    id: s.string(),
    name: s.string(),
    email: s.string(),
    company: s.string(),
  }),
  optimistic: {
    contacts(draft, $input) {
      const row = {
        id: $input.id,
        name: $input.name,
        email: $input.email,
        company: $input.company,
      };
      const index = draft.items.findIndex((entry) => entry.id > row.id);
      if (index < 0) draft.items.push(row);
      else draft.items.splice(index, 0, row);
    },
  },
  async handler(
    { id, name, email, company },
    request: AppRequest,
    context: MutationContext<{ DUPLICATE_EMAIL: typeof duplicateEmailError }>,
  ) {
    const db = request.db;
    const [existing] = await db.select().from(contacts).where(eq(contacts.email, email)).limit(1);
    if (existing) {
      return context.fail('DUPLICATE_EMAIL', { email });
    }
    await db.insert(contacts).values({ id, name, email, company });
    return { id };
  },
});

export const appMutations = [addContact];
