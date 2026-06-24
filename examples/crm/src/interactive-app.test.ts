import '../../../tests/example-generated-graphs.setup.js';

import { readFileSync } from 'node:fs';

import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { csrfToken } from '@kovojs/server';

import { buildCrmInteractiveApp } from './interactive-app.js';
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
const insertedContactId = 'c-11111111-1111-4111-8111-111111111111';
const duplicateEmailContactId = 'c-22222222-2222-4222-8222-222222222222';
const spoofedOwnerContactId = 'c-33333333-3333-4333-8333-333333333333';
const insertedDealId = 'd-11111111-1111-4111-8111-111111111111';
const unownedDealInputId = 'd-22222222-2222-4222-8222-222222222222';
const invalidStageDealId = 'd-33333333-3333-4333-8333-333333333333';

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
  it('keeps authored global CSS limited to app resets', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(css).not.toContain('./generated/');
    expect(css).not.toContain('.bg-slate-50');
    expect(css).not.toContain('.text-slate-900');
    expect(css).not.toContain('.rounded-lg');
    expect(css).not.toContain('.grid {');
  });

  it('serves every authored route as no-JS full HTML documents', async () => {
    const { handler } = await buildCrmInteractiveApp();

    for (const route of ['/', '/contacts', '/deals/d1']) {
      const response = await handler(
        new Request(`http://example.test${route}`, {
          headers: { Accept: 'text/html' },
        }),
      );
      const html = await response.text();

      expect(response.status, html).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('<main');
      expect(html).not.toContain('<kovo-fragment');
    }
  });

  it('addContact inserts the contact and re-renders the contact-list region', async () => {
    const { db, handler } = await buildCrmInteractiveApp();
    const before = (await db.select().from(contacts)).length;

    const { status, html } = await postForm(
      handler,
      'addContact',
      withCsrf({
        id: insertedContactId,
        name: 'Edsger Dijkstra',
        email: 'edsger@demo.example.com',
      }),
      `${contactsTarget}=contactList`,
      liveHeader(contactsTarget, contactsComponent),
    );

    expect(status).toBe(200);
    expect(html).toContain('<kovo-query name="contactList"');
    expect(html).toContain('Edsger Dijkstra');

    const rows = await db.select().from(contacts);
    expect(rows).toHaveLength(before + 1);
    const inserted = rows.find((row) => row.id === insertedContactId);
    expect(inserted?.ownerId).toBe('u1');
  });

  it('addContact typed failure re-renders the contact form with duplicate-email state', async () => {
    const { db, handler } = await buildCrmInteractiveApp();
    const [contact] = await db.select().from(contacts).orderBy(asc(contacts.id)).limit(1);
    if (!contact) throw new Error('seed produced no contacts');

    const { status, html } = await postForm(
      handler,
      'addContact',
      withCsrf({
        id: duplicateEmailContactId,
        name: 'Duplicate Contact',
        email: contact.email,
      }),
      `${contactsTarget}=contactList`,
      liveHeader(contactsTarget, contactsComponent),
    );

    expect(status).toBe(422);
    expect(html).toContain(`target="${contactsTarget}"`);
    expect(html).toContain('data-error-code="DUPLICATE_EMAIL"');
    expect(html).toContain(`${contact.email} is already in the contact book.`);
  });

  it('rejects arbitrary client-provided contact IDs before writing rows', async () => {
    const { db, handler } = await buildCrmInteractiveApp();
    const before = (await db.select().from(contacts)).length;

    const { status, html } = await postForm(
      handler,
      'addContact',
      withCsrf({
        id: 'contact-card" onmouseover="alert(1)',
        name: 'Attacker Controlled',
        email: 'attacker-id@demo.example.com',
      }),
      `${contactsTarget}=contactList`,
      liveHeader(contactsTarget, contactsComponent),
    );

    expect(status).toBe(422);
    expect(await db.select().from(contacts)).toHaveLength(before);
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
        id: insertedDealId,
        contactId: contact.id,
        stage: 'open',
        amount: '7500',
      }),
      `${pipelineTarget}=contactList openDeals pipelineByStage`,
      liveHeader(pipelineTarget, pipelineComponent),
    );

    expect(status).toBe(200);
    expect(html).toContain('<kovo-query name="contactList"');
    expect(html).toContain('<kovo-query name="openDeals"');
    expect(html).toContain('<kovo-query name="pipelineByStage"');

    const dealRows = await db.select().from(deals);
    expect(dealRows).toHaveLength(beforeDeals + 1);
    const inserted = dealRows.find((row) => row.id === insertedDealId);
    expect(inserted?.amount).toBe(7500);
    expect(inserted?.ownerId).toBe('u1');

    const [after] = await db.select().from(contacts).where(eq(contacts.id, contact.id)).limit(1);
    expect(after?.dealCount).toBe(beforeCount + 1);
  });

  it('createDeal rejects unowned contacts and invalid stages before writing rows', async () => {
    const { db, handler } = await buildCrmInteractiveApp();
    const [unowned] = await db.select().from(contacts).where(eq(contacts.ownerId, 'u2')).limit(1);
    if (!unowned) throw new Error('seed produced no u2 contact');
    const beforeDeals = (await db.select().from(deals)).length;

    const unownedResult = await postForm(
      handler,
      'createDeal',
      withCsrf({
        id: unownedDealInputId,
        contactId: unowned.id,
        stage: 'open',
        amount: '7500',
      }),
      `${pipelineTarget}=contactList openDeals pipelineByStage`,
      liveHeader(pipelineTarget, pipelineComponent),
    );

    expect(unownedResult.status).toBe(422);

    const invalidStageResult = await postForm(
      handler,
      'createDeal',
      withCsrf({
        id: invalidStageDealId,
        contactId: 'c1',
        stage: 'javascript:alert(1)',
        amount: '7500',
      }),
      `${pipelineTarget}=contactList openDeals pipelineByStage`,
      liveHeader(pipelineTarget, pipelineComponent),
    );

    expect(invalidStageResult.status).toBe(422);
    expect(await db.select().from(deals)).toHaveLength(beforeDeals);
  });

  it('ignores spoofed ownerId fields and derives CRM identity from the session', async () => {
    const { db, handler } = await buildCrmInteractiveApp();

    const { status } = await postForm(
      handler,
      'addContact',
      withCsrf({
        id: spoofedOwnerContactId,
        name: 'Spoofed Owner',
        email: 'spoofed-owner@demo.example.com',
        ownerId: 'u2',
      }),
      `${contactsTarget}=contactList`,
      liveHeader(contactsTarget, contactsComponent),
    );

    expect(status).toBe(200);
    const [inserted] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, spoofedOwnerContactId))
      .limit(1);
    expect(inserted?.ownerId).toBe('u1');
  });

  it('moveDeal updates the stage and re-renders the deal-detail region', async () => {
    const { db, handler } = await buildCrmInteractiveApp();
    // d1 is seeded 'open'; move it to 'proposal'.
    const { status, html } = await postForm(
      handler,
      'moveDeal',
      withCsrf({ dealId: 'd1', stage: 'proposal' }),
      `${dealDetailTarget}:d1=activityList contactList dealList`,
      liveHeader(`${dealDetailTarget}:d1`, dealDetailComponent, { dealId: 'd1' }),
    );

    expect(status).toBe(200);
    expect(html).toContain('<kovo-query name="dealList"');

    const [after] = await db.select().from(deals).where(eq(deals.id, 'd1')).limit(1);
    expect(after?.stage).toBe('proposal');
  });

  it('moveDeal refuses deals outside the authenticated owner scope', async () => {
    const { db, handler } = await buildCrmInteractiveApp();
    const [unowned] = await db.select().from(deals).where(eq(deals.ownerId, 'u2')).limit(1);
    if (!unowned) throw new Error('seed produced no u2 deal');

    const { status, html } = await postForm(
      handler,
      'moveDeal',
      withCsrf({ dealId: unowned.id, stage: 'proposal' }),
      `${dealDetailTarget}:${unowned.id}=activityList contactList dealList`,
      liveHeader(`${dealDetailTarget}:${unowned.id}`, dealDetailComponent, { dealId: unowned.id }),
    );

    expect(status).toBe(422);

    const [after] = await db.select().from(deals).where(eq(deals.id, unowned.id)).limit(1);
    expect(after?.stage).toBe(unowned.stage);
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
      `${dealDetailTarget}:d1=activityList contactList dealList`,
      liveHeader(`${dealDetailTarget}:d1`, dealDetailComponent, { dealId: 'd1' }),
    );

    expect(status).toBe(200);
    expect(html).toContain('<kovo-query name="dealList"');

    const [after] = await db.select().from(deals).where(eq(deals.id, 'd1')).limit(1);
    expect(after?.stage).toBe('won');
    // compute_commission applies an 80% factor (server truth), so the amount drops.
    expect(after?.amount).toBe(Math.trunc((beforeAmount * 8) / 10));
  });
});
