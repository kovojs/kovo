import { isKovoApp } from '@kovojs/server';
import { describe, expect, it } from 'vitest';

import app, { requestHandler } from './app.js';
import { ContactsRegion } from './components/contacts.js';
import { readonlyAppDb } from './db.js';
import { contactsQuery } from './queries.js';

// SPEC.md §9.5: route dispatch, document assembly, and the request shell all run
// through the same app aggregate that `kovo build`/static export replay.
describe('starter app', () => {
  it('is a closed Kovo app aggregate', () => {
    expect(isKovoApp(app)).toBe(true);
  });

  it('redirects anonymous visitors from the guarded home page to /login', async () => {
    const response = await requestHandler(new Request('https://app.test/'));
    expect([302, 303, 307]).toContain(response.status);
    // The home route's KV436 access guard (SPEC §10.2) redirects to login with a
    // `next` param so sign-in returns the visitor to the page they requested.
    expect(response.headers.get('location')).toBe('/login?next=%2F');
  });

  it('serves the login page', async () => {
    const response = await requestHandler(new Request('https://app.test/login'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    await expect(response.text()).resolves.toContain('Sign in');
  });

  it('reads seeded contacts through the typed query', async () => {
    const result = await contactsQuery.load(undefined, { db: readonlyAppDb, request: {} });
    expect(result.items.map((contact) => contact.id)).toContain('c1');
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
