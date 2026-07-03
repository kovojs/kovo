import { kovo } from '@kovojs/drizzle';
import { createPostgresTestRuntime } from '@kovojs/server/testing';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

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
});
