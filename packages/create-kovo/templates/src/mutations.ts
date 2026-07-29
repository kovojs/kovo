import { s } from '@kovojs/server';
import { trustedAssign } from '@kovojs/server/write-safety';
import { eq } from 'drizzle-orm';

import { app } from './kovo.js';
import { contact } from './model.js';
import { contactsQuery } from './queries.js';
import { contacts } from './schema.js';

const duplicateEmailError = s.object({ email: s.string() });
const addContactInput = s.object({
  name: s.string(),
  email: s.string(),
  company: s.string(),
});

// One real write: validate input, guard it behind a session, insert a row, and
// predict the optimistic list update. No-JS clients POST to the typed mutation
// endpoint and get the refreshed page; `enhance` upgrades the same form to a fragment swap.
export const addContact = app.mutation({
  access: [app.authenticated],
  errors: { DUPLICATE_EMAIL: duplicateEmailError },
  input: addContactInput,
  optimistic: [
    contactsQuery.optimistic(addContactInput, (value, input) => {
      const row = {
        id: `pending-${input.email}`,
        name: input.name,
        email: input.email,
        company: input.company,
      };
      return {
        ...value,
        items: [...value.items, row].sort((left, right) => left.id.localeCompare(right.id)),
      };
    }),
  ],
  registry: { tables: ['contacts'], touches: [contact] },
  async handler({ name, email, company }, request, context) {
    const [existing] = await request.db
      .select()
      .from(contacts)
      .where(eq(contacts.email, email))
      .limit(1);
    if (existing) {
      return context.fail('DUPLICATE_EMAIL', { email });
    }
    await request.db.insert(contacts).values({
      company,
      email,
      id: trustedAssign(email, {
        evidence: {
          digest: 'sha256:18a30ad899a45b62f335cc711d04e66652b0d0edbe5bf7baeb7ccaa111d7808e',
          kind: 'test',
          reference: 'starter-tests/contact-email-primary-key',
        },
        invariant: 'governed-write.authorized-principal',
        why: { kind: 'policy', policy: 'starter.contact-email-primary-key/v1' },
      }),
      name,
    });
    return { ok: true };
  },
});

export const appMutations = [addContact];
