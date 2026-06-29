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
const pipelineTarget = 'pipeline-region';
const dealDetailTarget = 'deal-detail-region';
const demoCsrfRequest = { session: { id: 'demo-session' } };
const insertedContactId = 'c-11111111-1111-4111-8111-111111111111';
const duplicateEmailContactId = 'c-22222222-2222-4222-8222-222222222222';
const spoofedOwnerContactId = 'c-33333333-3333-4333-8333-333333333333';
const insertedDealId = 'd-11111111-1111-4111-8111-111111111111';
const unownedDealInputId = 'd-22222222-2222-4222-8222-222222222222';
const invalidStageDealId = 'd-33333333-3333-4333-8333-333333333333';

function withCsrf(fields: Record<string, string>): Record<string, string> {
  return fields;
}

async function postForm(
  handler: (request: Request) => Promise<Response>,
  key: string,
  fields: Record<string, string>,
  options: { route: string; targets: readonly string[] },
): Promise<{ status: number; html: string }> {
  const headers = await enhancedHeadersForRoute(handler, options.route, options.targets);
  const response = await handler(
    new Request(`http://example.test/_m/${key}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'Kovo-Fragment': 'true',
        'Kovo-Idem': `${key}-${Object.values(fields).join('-')}`,
        'Kovo-Live-Targets': headers.liveTargets,
        'Kovo-Targets': headers.targets,
        Origin: 'http://example.test',
      },
      body: new URLSearchParams({
        ...fields,
        csrf: csrfToken(demoCsrfRequest, crmCsrf, { mutation: key }),
      }),
    }),
  );
  return { status: response.status, html: await response.text() };
}

async function enhancedHeadersForRoute(
  handler: (request: Request) => Promise<Response>,
  route: string,
  targets: readonly string[],
): Promise<{ liveTargets: string; targets: string }> {
  const response = await handler(
    new Request(`http://example.test${route}`, {
      headers: { Accept: 'text/html' },
    }),
  );
  const html = await response.text();
  const wanted = new Set(targets);
  const liveTargets = new Map<string, string>();
  const targetHeaders = new Set<string>();

  for (const match of html.matchAll(/<[^>]*\bkovo-deps=(?:"[^"]*"|'[^']*')[^>]*>/g)) {
    const attrs = readTagAttributes(match[0]);
    const target = attrs['kovo-fragment-target'] ?? attrs.id ?? attrs['kovo-c'];
    if (!target || !wanted.has(target)) continue;
    const deps = readDeps(attrs['kovo-deps']);
    if (deps.length === 0) continue;

    targetHeaders.add(`${target}=${deps.join(' ')}`);

    const component = attrs['kovo-live-component'];
    const token = attrs['kovo-live-token'];
    if (!component || !token || liveTargets.has(target)) continue;
    liveTargets.set(target, `${target}#${component}@${token}:${attrs['kovo-props'] ?? '{}'}`);
  }

  return {
    liveTargets: [...liveTargets.values()].join('; '),
    targets: [...targetHeaders].join('; '),
  };
}

function readTagAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/\s([A-Za-z_:][\w:.-]*)=(?:"([^"]*)"|'([^']*)')/g)) {
    const name = match[1];
    if (!name) continue;
    attrs[name] = decodeHtmlAttribute(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

function readDeps(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((dep) => dep.trim())
    .filter(Boolean);
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
      'mutations/add-contact',
      withCsrf({
        id: insertedContactId,
        name: 'Edsger Dijkstra',
        email: 'edsger@demo.example.com',
      }),
      { route: '/contacts', targets: [contactsTarget] },
    );

    expect(status).toBe(200);
    expect(html).toContain('<kovo-query name="queries/contact-list-query"');
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
      'mutations/add-contact',
      withCsrf({
        id: duplicateEmailContactId,
        name: 'Duplicate Contact',
        email: contact.email,
      }),
      { route: '/contacts', targets: [contactsTarget] },
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
      'mutations/add-contact',
      withCsrf({
        id: 'contact-card" onmouseover="alert(1)',
        name: 'Attacker Controlled',
        email: 'attacker-id@demo.example.com',
      }),
      { route: '/contacts', targets: [contactsTarget] },
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
      'mutations/create-deal',
      withCsrf({
        id: insertedDealId,
        contactId: contact.id,
        stage: 'open',
        amount: '7500',
      }),
      { route: '/', targets: [pipelineTarget] },
    );

    expect(status).toBe(200);
    expect(html).toContain('<kovo-query name="queries/contact-list-query"');
    expect(html).toContain('<kovo-query name="queries/open-deals-query"');
    expect(html).toContain('<kovo-query name="queries/pipeline-by-stage-query"');

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
      'mutations/create-deal',
      withCsrf({
        id: unownedDealInputId,
        contactId: unowned.id,
        stage: 'open',
        amount: '7500',
      }),
      { route: '/', targets: [pipelineTarget] },
    );

    expect(unownedResult.status).toBe(422);

    const invalidStageResult = await postForm(
      handler,
      'mutations/create-deal',
      withCsrf({
        id: invalidStageDealId,
        contactId: 'c1',
        stage: 'javascript:alert(1)',
        amount: '7500',
      }),
      { route: '/', targets: [pipelineTarget] },
    );

    expect(invalidStageResult.status).toBe(422);
    expect(await db.select().from(deals)).toHaveLength(beforeDeals);
  });

  it('ignores spoofed ownerId fields and derives CRM identity from the session', async () => {
    const { db, handler } = await buildCrmInteractiveApp();

    const { status } = await postForm(
      handler,
      'mutations/add-contact',
      withCsrf({
        id: spoofedOwnerContactId,
        name: 'Spoofed Owner',
        email: 'spoofed-owner@demo.example.com',
        ownerId: 'u2',
      }),
      { route: '/contacts', targets: [contactsTarget] },
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
      'mutations/move-deal',
      withCsrf({ dealId: 'd1', stage: 'proposal' }),
      { route: '/deals/d1', targets: [`${dealDetailTarget}:d1`] },
    );

    expect(status).toBe(200);
    expect(html).toContain('<kovo-query name="queries/deal-list-query"');

    const [after] = await db.select().from(deals).where(eq(deals.id, 'd1')).limit(1);
    expect(after?.stage).toBe('proposal');
  });

  it('moveDeal refuses deals outside the authenticated owner scope', async () => {
    const { db, handler } = await buildCrmInteractiveApp();
    const [unowned] = await db.select().from(deals).where(eq(deals.ownerId, 'u2')).limit(1);
    if (!unowned) throw new Error('seed produced no u2 deal');

    const { status, html } = await postForm(
      handler,
      'mutations/move-deal',
      withCsrf({ dealId: unowned.id, stage: 'proposal' }),
      { route: '/deals/d1', targets: [`${dealDetailTarget}:d1`] },
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
      'mutations/close-deal',
      withCsrf({ dealId: 'd1' }),
      { route: '/deals/d1', targets: [`${dealDetailTarget}:d1`] },
    );

    expect(status).toBe(200);
    expect(html).toContain('<kovo-query name="queries/deal-list-query"');

    const [after] = await db.select().from(deals).where(eq(deals.id, 'd1')).limit(1);
    expect(after?.stage).toBe('won');
    // compute_commission applies an 80% factor (server truth), so the amount drops.
    expect(after?.amount).toBe(Math.trunc((beforeAmount * 8) / 10));
  });
});
