import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { csrfToken } from '@kovojs/server';

import { buildCrmInteractiveApp } from './generated/interactive-app.kovo-route.js';
import { crmCsrf } from './mutations.js';
import { contacts, deals } from './schema.js';

// SPEC.md §9.1: the interactive CRM app's mutation endpoints run the REAL Drizzle
// mutations against PGlite and return the fragment wire — the same handler the
// Node server (scripts/serve.mjs) serves. These tests prove the server half of
// each round-trip (no browser): a POST /_m/<key> mutates the persisted rows AND
// the re-rendered fragment carries the new server truth. The handler attaches the
// db + a demo session, so the mutations' `guards.authed` guard passes.

const contactsTarget = 'contacts-region';
const contactsComponent = 'components/contacts/contacts-region';
const pipelineTarget = 'pipeline-region';
const pipelineComponent = 'components/pipeline/pipeline-region';
const dealDetailTarget = 'deal-detail-region';
const dealDetailComponent = 'components/deal-detail/deal-detail-region';
const demoCsrfRequest = { session: { id: 'demo-session' } };

function withCsrf(fields: Record<string, string>): Record<string, string> {
  return {
    csrf: csrfToken(demoCsrfRequest, crmCsrf),
    ...fields,
  };
}

function liveHeader(target: string, component: string, props: Record<string, unknown> = {}): string {
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
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': `${key}-${Object.values(fields).join('-')}`,
        'Kovo-Live-Targets': liveTargets,
        'Kovo-Targets': targets,
      },
      body: new URLSearchParams(fields),
    }),
  );
  return { status: response.status, html: await response.text() };
}

describe('crm interactive app', () => {
  it('addContact inserts the contact and re-renders the contact-list region', async () => {
    const { db, handler } = await buildCrmInteractiveApp();
    const before = (await db.select().from(contacts)).length;

    const { status, html } = await postForm(
      handler,
      'addContact',
      withCsrf({
        id: 'c-test-1',
        name: 'Edsger Dijkstra',
        email: 'edsger@demo.example.com',
        ownerId: 'u1',
      }),
      `${contactsTarget}=contactList`,
      liveHeader(contactsTarget, contactsComponent),
    );

    expect(status).toBe(200);
    expect(html).toContain(`target="${contactsTarget}"`);
    expect(html).toContain('Edsger Dijkstra');

    const rows = await db.select().from(contacts);
    expect(rows).toHaveLength(before + 1);
    expect(rows.some((row) => row.id === 'c-test-1')).toBe(true);
  });

  it('addContact typed failure re-renders the contact form with duplicate-email state', async () => {
    const { db, handler } = await buildCrmInteractiveApp();
    const [contact] = await db.select().from(contacts).orderBy(asc(contacts.id)).limit(1);
    if (!contact) throw new Error('seed produced no contacts');

    const { status, html } = await postForm(
      handler,
      'addContact',
      withCsrf({
        id: 'c-duplicate-email',
        name: 'Duplicate Contact',
        email: contact.email,
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

  it('createDeal inserts the deal, bumps the contact dealCount, and re-renders the pipeline', async () => {
    const { db, handler } = await buildCrmInteractiveApp();
    const [contact] = await db.select().from(contacts).orderBy(asc(contacts.id)).limit(1);
    if (!contact) throw new Error('seed produced no contacts');
    const beforeCount = contact.dealCount;
    const beforeDeals = (await db.select().from(deals)).length;

    const { status, html } = await postForm(
      handler,
      'createDeal',
      withCsrf({
        id: 'd-test-1',
        contactId: contact.id,
        stage: 'open',
        amount: '7500',
        ownerId: 'u1',
      }),
      `${pipelineTarget}=contactList openDeals pipelineByStage`,
      liveHeader(pipelineTarget, pipelineComponent),
    );

    expect(status).toBe(200);
    expect(html).toContain(`target="${pipelineTarget}"`);

    const dealRows = await db.select().from(deals);
    expect(dealRows).toHaveLength(beforeDeals + 1);
    const inserted = dealRows.find((row) => row.id === 'd-test-1');
    expect(inserted?.amount).toBe(7500);

    const [after] = await db.select().from(contacts).where(eq(contacts.id, contact.id)).limit(1);
    expect(after?.dealCount).toBe(beforeCount + 1);
  });

  it('moveDeal updates the stage and re-renders the deal-detail region', async () => {
    const { db, handler } = await buildCrmInteractiveApp();
    // d1 is seeded 'open'; move it to 'proposal'.
    const { status, html } = await postForm(
      handler,
      'moveDeal',
      withCsrf({ dealId: 'd1', stage: 'proposal' }),
      `${dealDetailTarget}=activityList contactList dealList`,
      liveHeader(dealDetailTarget, dealDetailComponent, { dealId: 'd1' }),
    );

    expect(status).toBe(200);
    expect(html).toContain(`target="${dealDetailTarget}"`);

    const [after] = await db.select().from(deals).where(eq(deals.id, 'd1')).limit(1);
    expect(after?.stage).toBe('proposal');
  });

  it('closeDeal sets stage=won, applies the server commission, and re-renders the deal detail', async () => {
    const { db, handler } = await buildCrmInteractiveApp();
    const [before] = await db.select().from(deals).where(eq(deals.id, 'd1')).limit(1);
    if (!before) throw new Error('seed produced no d1 deal');
    const beforeAmount = before.amount;

    const { status, html } = await postForm(
      handler,
      'closeDeal',
      withCsrf({ dealId: 'd1' }),
      `${dealDetailTarget}=activityList contactList dealList`,
      liveHeader(dealDetailTarget, dealDetailComponent, { dealId: 'd1' }),
    );

    expect(status).toBe(200);
    expect(html).toContain(`target="${dealDetailTarget}"`);

    const [after] = await db.select().from(deals).where(eq(deals.id, 'd1')).limit(1);
    expect(after?.stage).toBe('won');
    // compute_commission applies an 80% factor (server truth), so the amount drops.
    expect(after?.amount).toBe(Math.trunc((beforeAmount * 8) / 10));
  });
});
