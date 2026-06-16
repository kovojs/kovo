import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { CONTACT_LIST_TARGET } from './components/contacts.js';
import { DEAL_DETAIL_TARGET } from './components/deal-detail.js';
import { PIPELINE_TARGET } from './components/pipeline.js';
import { buildCrmInteractiveApp } from './interactive-app.js';
import { contacts, deals } from './schema.js';

// SPEC.md §9.1: the interactive CRM app's mutation endpoints run the REAL Drizzle
// mutations against PGlite and return the fragment wire — the same handler the
// Node server (scripts/serve.mjs) serves. These tests prove the server half of
// each round-trip (no browser): a POST /_m/<key> mutates the persisted rows AND
// the re-rendered fragment carries the new server truth. The handler attaches the
// db + a demo session, so the mutations' `guards.authed` guard passes.

async function postForm(
  handler: (request: Request) => Promise<Response>,
  key: string,
  fields: Record<string, string>,
  targets: string,
): Promise<{ status: number; html: string }> {
  const response = await handler(
    new Request(`http://example.test/_m/${key}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': `${key}-${Object.values(fields).join('-')}`,
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
      { id: 'c-test-1', name: 'Edsger Dijkstra', email: 'edsger@demo.example.com', ownerId: 'u1' },
      CONTACT_LIST_TARGET,
    );

    expect(status).toBe(200);
    expect(html).toContain(`target="${CONTACT_LIST_TARGET}"`);
    expect(html).toContain('Edsger Dijkstra');

    const rows = await db.select().from(contacts);
    expect(rows).toHaveLength(before + 1);
    expect(rows.some((row) => row.id === 'c-test-1')).toBe(true);
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
      { id: 'd-test-1', contactId: contact.id, stage: 'open', amount: '7500', ownerId: 'u1' },
      PIPELINE_TARGET,
    );

    expect(status).toBe(200);
    expect(html).toContain(`target="${PIPELINE_TARGET}"`);

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
      { dealId: 'd1', stage: 'proposal' },
      DEAL_DETAIL_TARGET,
    );

    expect(status).toBe(200);
    expect(html).toContain(`target="${DEAL_DETAIL_TARGET}"`);

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
      { dealId: 'd1' },
      DEAL_DETAIL_TARGET,
    );

    expect(status).toBe(200);
    expect(html).toContain(`target="${DEAL_DETAIL_TARGET}"`);

    const [after] = await db.select().from(deals).where(eq(deals.id, 'd1')).limit(1);
    expect(after?.stage).toBe('won');
    // compute_commission applies an 80% factor (server truth), so the amount drops.
    expect(after?.amount).toBe(Math.trunc((beforeAmount * 8) / 10));
  });
});
