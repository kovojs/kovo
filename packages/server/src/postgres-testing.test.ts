import { kovo, sql } from '@kovojs/drizzle';
import { createPostgresTestRuntime } from '@kovojs/server/testing';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { drainCrossOwnerReadAuditFacts } from './managed-db.js';

const notes = pgTable(
  'kovo_testing_notes',
  {
    body: text('body').notNull(),
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
  },
  kovo({
    domain: 'testing-note',
    key: 'id',
    owner: 'ownerId',
  }),
);

const schema = { notes };

describe('@kovojs/server/testing Postgres helpers', () => {
  it('writes as one principal and hides owner-scoped rows from another principal', async () => {
    const runtime = await createPostgresTestRuntime({ schema });

    try {
      await runtime.withPrincipal('user-a', async (db) => {
        await db.insert(notes).values({
          body: 'only user-a should see this',
          id: 'note-1',
          ownerId: 'user-a',
        });
      });

      await expect(
        runtime.withPrincipal('user-a', (db) => db.select().from(notes)),
      ).resolves.toEqual([
        {
          body: 'only user-a should see this',
          id: 'note-1',
          ownerId: 'user-a',
        },
      ]);
      await expect(
        runtime.withPrincipal('user-b', (db) => db.select().from(notes)),
      ).resolves.toEqual([]);
    } finally {
      await runtime.close();
    }
  });

  it('exposes admin-guarded cross-owner reads only for opted-in owner tables', async () => {
    drainCrossOwnerReadAuditFacts();
    const runtime = await createPostgresTestRuntime({
      crossOwnerReadTables: ['kovo_testing_notes'],
      schema,
    });

    try {
      await runtime.withPrincipal('user-a', async (db) => {
        await db.insert(notes).values({
          body: 'visible to user-a',
          id: 'note-a',
          ownerId: 'user-a',
        });
      });
      await runtime.withPrincipal('user-b', async (db) => {
        await db.insert(notes).values({
          body: 'visible to user-b',
          id: 'note-b',
          ownerId: 'user-b',
        });
      });

      await expect(
        runtime.withPrincipal('user-a', (db) =>
          db.select({ body: notes.body, id: notes.id }).from(notes),
        ),
      ).resolves.toEqual([{ body: 'visible to user-a', id: 'note-a' }]);

      const rows = await runtime.asAdmin('admin-user', (db) =>
        db.crossOwnerRead<{ body: string; id: string }>(
          sql`SELECT body, id FROM ${notes} ORDER BY id`,
          {
            reads: ['kovo_testing_notes'],
            reason: 'test admin export',
            role: 'admin',
            site: 'postgres-testing.test.ts',
          },
        ),
      );
      expect(rowsOf(rows)).toEqual([
        { body: 'visible to user-a', id: 'note-a' },
        { body: 'visible to user-b', id: 'note-b' },
      ]);
      expect(drainCrossOwnerReadAuditFacts()).toEqual([
        {
          declaredReads: ['public.kovo_testing_notes'],
          dialectLabel: 'PGlite',
          observedRead: 'public.kovo_testing_notes',
          principal: 'admin-user',
          reason: 'test admin export',
          site: 'postgres-testing.test.ts',
        },
      ]);
    } finally {
      await runtime.close();
    }
  });

  it('requires an explicit admin table opt-in before asAdmin can run', async () => {
    const runtime = await createPostgresTestRuntime({ schema });

    try {
      await expect(runtime.asAdmin('admin-user', () => [])).rejects.toThrow(/crossOwnerReadTables/);
    } finally {
      await runtime.close();
    }
  });

  it('exposes audited asSystem for cross-owner work through the real RLS runtime', async () => {
    const runtime = await createPostgresTestRuntime({ schema });

    try {
      await runtime.withPrincipal('user-a', async (db) => {
        await db.insert(notes).values({
          body: 'visible to user-a',
          id: 'note-a',
          ownerId: 'user-a',
        });
      });
      await runtime.withPrincipal('user-b', async (db) => {
        await db.insert(notes).values({
          body: 'visible to user-b',
          id: 'note-b',
          ownerId: 'user-b',
        });
      });

      await expect(
        runtime.withPrincipal('user-a', (db) =>
          db.select({ body: notes.body, id: notes.id }).from(notes),
        ),
      ).resolves.toEqual([{ body: 'visible to user-a', id: 'note-a' }]);

      const systemRows = await runtime.asSystem('test fixture repair across owners', async (db) => {
        await db.update(notes).set({ body: 'system touched' });
        return await db.select({ body: notes.body, id: notes.id }).from(notes).orderBy(notes.id);
      });

      expect(systemRows).toEqual([
        { body: 'system touched', id: 'note-a' },
        { body: 'system touched', id: 'note-b' },
      ]);
      await expect(
        runtime.withPrincipal('user-a', (db) =>
          db.select({ body: notes.body, id: notes.id }).from(notes).orderBy(notes.id),
        ),
      ).resolves.toEqual([{ body: 'system touched', id: 'note-a' }]);
    } finally {
      await runtime.close();
    }
  });

  it('requires a non-empty audited reason before asSystem can run', async () => {
    const runtime = await createPostgresTestRuntime({ schema });

    try {
      await expect(runtime.asSystem('', () => [])).rejects.toThrow(/non-empty audit reason/);
      await expect(runtime.asSystem(' padded ', () => [])).rejects.toThrow(
        /non-empty audit reason/,
      );
    } finally {
      await runtime.close();
    }
  });
});

function rowsOf<Row>(result: Row[] | { rows?: Row[] }): Row[] {
  return Array.isArray(result) ? result : (result.rows ?? []);
}
