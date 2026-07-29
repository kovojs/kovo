import { describe, expect, it } from 'vitest';

import { collectUnregisteredSinksFromProject } from '@kovojs/drizzle/internal/static';
import type { TrustEscapeSourceFileInput } from '@kovojs/drizzle/internal/static';

function sinksForFiles(files: readonly TrustEscapeSourceFileInput[]) {
  return collectUnregisteredSinksFromProject({ files });
}

describe('defineKovo request-authority provenance', () => {
  it('keeps the exact imported contract, declaration handles, guards, optimism, and assembly open', () => {
    const facts = sinksForFiles([
      {
        fileName: 'kovo.ts',
        source: `
          import { defineKovo } from '@kovojs/server';
          export const app = defineKovo({
            appId: '5f31d8d7-45e7-4e91-a34b-2b1263de9b5e',
            auth: async () => null,
            db: async () => ({ rows: [] }),
          });
        `,
      },
      {
        fileName: 'declarations.ts',
        source: `
          import { app } from './kovo.js';
          const input = { parse(value) { return value; } };
          export const contacts = app.query({
            access: [app.authenticated],
            load() { return { items: [] }; },
          });
          const optimistic = contacts.optimistic(input, (value) => value);
          export const add = app.mutation({
            access: [app.all(app.authenticated)],
            input,
            optimistic: [optimistic],
            handler() { return { ok: true }; },
          });
          export const shell = app.layout({ render() { return 'shell'; } });
          export const home = app.route('/', {
            access: app.publicAccess('public home'),
            layout: shell,
            page() { return 'home'; },
          });
          export const health = app.endpoint('/api/health', {
            access: app.publicAccess('public health'),
            handler() { return Response.json({ ok: true }); },
            method: 'GET',
          });
          export const cleanup = app.task({ input, run() { return { ok: true }; } });
        `,
      },
      {
        fileName: 'app.ts',
        source: `
          import { app } from './kovo.js';
          import { add, cleanup, contacts, health, home, shell } from './declarations.js';
          export default app.assemble({
            endpoints: [health],
            layouts: [shell],
            mutations: [add],
            queries: [contacts],
            routes: [home],
            tasks: [cleanup],
          });
        `,
      },
    ]);

    expect(facts, JSON.stringify(facts)).toEqual([]);
  });

  it('scans defineKovo auth providers and app-scoped request roots', () => {
    const facts = sinksForFiles([
      {
        fileName: 'kovo.ts',
        source: `
          import { execFileSync } from 'node:child_process';
          import { defineKovo } from '@kovojs/server';
          export const app = defineKovo({
            appId: '5f31d8d7-45e7-4e91-a34b-2b1263de9b5e',
            auth(request) { execFileSync(request.url); return null; },
          });
        `,
      },
      {
        fileName: 'routes.ts',
        source: `
          import { execFileSync } from 'node:child_process';
          import { app } from './kovo.js';
          app.route('/', { page(_context, request) { return execFileSync(request.url); } });
        `,
      },
    ]);

    expect(
      facts.filter((fact) => fact.sink === 'child_process.execFileSync'),
      JSON.stringify(facts),
    ).toHaveLength(2);
  });

  it('reviews exact Drizzle schema, domain, and column uses reached through app-scoped roots', () => {
    const facts = sinksForFiles([
      {
        fileName: 'kovo.ts',
        source: `
          import { defineKovo } from '@kovojs/server';
          export const app = defineKovo({
            appId: '5f31d8d7-45e7-4e91-a34b-2b1263de9b5e',
          });
        `,
      },
      {
        fileName: 'model.ts',
        source: `
          import { domain } from '@kovojs/server';
          export const contact = domain('contact');
        `,
      },
      {
        fileName: 'schema.ts',
        source: `
          import { kovo } from '@kovojs/drizzle';
          import { sql } from 'drizzle-orm';
          import { pgTable, text } from 'drizzle-orm/pg-core';
          import { contact } from './model.js';
          export const contacts = pgTable(
            'contacts',
            {
              id: text('id').primaryKey(),
              email: text('email').notNull(),
            },
            kovo((columns) => ({
              authzPolicy: sql\`current_setting('kovo.principal', true) <> ''\`,
              domain: contact,
              key: (table) => table.id,
            })),
          );
        `,
      },
      {
        fileName: 'declarations.ts',
        source: `
          import { eq } from 'drizzle-orm';
          import { app } from './kovo.js';
          import { contact } from './model.js';
          import { contacts } from './schema.js';
          export const contactsQuery = app.query({
            async load(_input, context) {
              return context.db
                .select({ id: contacts.id, email: contacts.email })
                .from(contacts)
                .orderBy(contacts.id);
            },
          });
          export const addContact = app.mutation({
            registry: { tables: ['contacts'], touches: [contact] },
            async handler({ email }, request) {
              return request.db
                .select()
                .from(contacts)
                .where(eq(contacts.email, email));
            },
          });
        `,
      },
    ]);

    expect(facts, JSON.stringify(facts)).toEqual([]);
  });

  it('keeps app-scoped Drizzle review closed for forged contracts and dynamic policies', () => {
    const facts = sinksForFiles([
      {
        fileName: 'app.ts',
        source: `
          import { kovo } from '@kovojs/drizzle';
          import { sql } from 'drizzle-orm';
          import { pgTable, text } from 'drizzle-orm/pg-core';
          import { domain } from '@kovojs/server';
          const contact = domain('contact');
          const policy = process.env.KOVO_POLICY;
          const contacts = pgTable(
            'contacts',
            { id: text('id').primaryKey() },
            kovo((columns) => ({
              authzPolicy: sql\`\${policy}\`,
              domain: contact,
              key: (table) => table.id,
            })),
          );
          const app = { mutation(definition) { return definition; } };
          app.mutation({
            registry: { touches: [contact] },
            handler() { return contacts.id; },
          });
        `,
      },
    ]);

    expect(
      facts.some(
        (fact) =>
          fact.sink === 'request-handler.opaque-call' ||
          fact.sink === 'request-handler.opaque-protocol' ||
          fact.source === '<mutated-retained-config>',
      ),
      JSON.stringify(facts),
    ).toBe(true);
  });

  it.each([
    [
      'same-named local constructor',
      `
        import { execFileSync } from 'node:child_process';
        function defineKovo() {
          return { query() { execFileSync('forged-query'); return {}; } };
        }
        const app = defineKovo();
        app.query({ load() { return 'forged'; } });
      `,
    ],
    [
      'reassigned contract binding',
      `
        import { defineKovo } from '@kovojs/server';
        let app = defineKovo({ appId: '5f31d8d7-45e7-4e91-a34b-2b1263de9b5e' });
        app = { query() { return {}; } };
        app.query({ load() { return 'forged'; } });
      `,
    ],
  ])('fails closed for a %s', (_label, source) => {
    const facts = sinksForFiles([{ fileName: 'app.ts', source }]);
    expect(
      facts.some(
        (fact) =>
          fact.sink === 'request-handler.opaque-call' || fact.sink === 'child_process.execFileSync',
      ),
      JSON.stringify(facts),
    ).toBe(true);
  });
});
