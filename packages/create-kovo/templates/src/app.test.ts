import { isKovoApp } from '@kovojs/server';
import { describe, expect, it } from 'vitest';

import app from './app.js';
import { ContactsRegion } from './components/contacts.js';
import { contactsQuery } from './queries.js';

// SPEC.md §9.5: unit tests inspect the same pure app aggregate that `kovo build` and
// static export replay. Request dispatch runs against the built bootstrap-first artifact
// in endpoint-posture.test.ts rather than locking Vitest's shared timer realm.
describe('starter app', () => {
  it('is a closed Kovo app aggregate', () => {
    expect(isKovoApp(app)).toBe(true);
  });

  it('requires the framework-provided read-only database context', async () => {
    await expect(contactsQuery.load(undefined)).rejects.toThrow(
      'contacts query requires the framework-provided context.db',
    );
  });

  it('preserves submitted contact fields on duplicate-email failure renders', () => {
    const html = String(
      ContactsRegion.definition.render({ contacts: { items: [] } }, undefined, {
        forms: {
          addContact: {
            failure: {
              code: 'DUPLICATE_EMAIL',
              payload: { email: 'ada@example.com' },
            },
            submitted: {
              company: 'Dogfood LLC',
              email: 'ada@example.com',
              name: 'Ada Clone',
            },
          },
        },
      }),
    );

    expect(html).toContain('name="name"');
    expect(html).toContain('value="Ada Clone"');
    expect(html).toContain('value="ada@example.com"');
    expect(html).toContain('value="Dogfood LLC"');
    expect(html).toContain('ada@example.com is already in the contact book.');
  });
});
