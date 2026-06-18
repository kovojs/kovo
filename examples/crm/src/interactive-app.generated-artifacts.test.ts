import { asc } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { csrfToken } from '@kovojs/server';

import { buildCrmInteractiveApp } from './interactive-app.generated-fixtures.js';
import { crmCsrf } from './mutations.js';
import { contacts } from './schema.js';

const contactsTarget = 'contacts-region';
const contactsComponent = 'components/contacts/contacts-region';
const demoCsrfRequest = { session: { id: 'demo-session' } };

function withCsrf(fields: Record<string, string>): Record<string, string> {
  return {
    csrf: csrfToken(demoCsrfRequest, crmCsrf),
    ...fields,
  };
}

function liveHeader(
  target: string,
  component: string,
  props: Record<string, unknown> = {},
): string {
  return `${target}#${component}:${JSON.stringify(props)}`;
}

async function postForm(
  handler: (request: Request) => Promise<Response>,
  key: string,
  fields: Record<string, string>,
  targets: string,
  liveTargets: string,
): Promise<{ status: number; html: string }> {
  const response = await handler(
    new Request(`http://example.test/_m/${key}`, {
      body: new URLSearchParams(fields),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': `${key}-${Object.values(fields).join('-')}`,
        'Kovo-Live-Targets': liveTargets,
        'Kovo-Targets': targets,
      },
      method: 'POST',
    }),
  );
  return { status: response.status, html: await response.text() };
}

describe('crm generated app artifacts', () => {
  it('render generated live-target fragments for contact mutations', async () => {
    const { db, handler } = await buildCrmInteractiveApp();
    const before = (await db.select().from(contacts)).length;

    const { status, html } = await postForm(
      handler,
      'addContact',
      withCsrf({
        email: 'edsger@demo.example.com',
        id: 'c-test-1',
        name: 'Edsger Dijkstra',
        ownerId: 'u1',
      }),
      `${contactsTarget}=contactList`,
      liveHeader(contactsTarget, contactsComponent),
    );

    expect(status).toBe(200);
    expect(html).toContain(`target="${contactsTarget}"`);
    expect(html).toContain('Edsger Dijkstra');
    expect(await db.select().from(contacts)).toHaveLength(before + 1);
  });

  it('render generated form-helper failure fragments for contact mutations', async () => {
    const { db, handler } = await buildCrmInteractiveApp();
    const [contact] = await db.select().from(contacts).orderBy(asc(contacts.id)).limit(1);
    if (!contact) throw new Error('seed produced no contacts');

    const { status, html } = await postForm(
      handler,
      'addContact',
      withCsrf({
        email: contact.email,
        id: 'c-duplicate-email',
        name: 'Duplicate Contact',
        ownerId: 'u1',
      }),
      `${contactsTarget}=contactList`,
      liveHeader(contactsTarget, contactsComponent),
    );

    expect(status).toBe(422);
    expect(html).toContain(`target="${contactsTarget}"`);
    expect(html).toContain('data-error-code="DUPLICATE_EMAIL"');
    expect(html).toContain(`${contact.email} is already in the contact book.`);
  });
});
