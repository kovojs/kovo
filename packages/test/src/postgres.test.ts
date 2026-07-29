import { createPostgresTestRuntime } from '@kovojs/test/postgres';
import { kovo } from '@kovojs/drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

const notes = pgTable(
  'kovo_test_package_notes',
  {
    body: text('body').notNull(),
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
  },
  kovo((columns) => ({
    domain: 'test-package-note',
    key: columns.id,
    owner: columns.ownerId,
  })),
);

describe('@kovojs/test/postgres', () => {
  it('runs public test callbacks through the real owner-scoped Postgres posture', async () => {
    const runtime = await createPostgresTestRuntime({ schema: { notes } });

    try {
      await runtime.withPrincipal('owner-a', (db) =>
        db.insert(notes).values({
          body: 'private to owner-a',
          id: 'note-a',
          ownerId: 'owner-a',
        }),
      );

      await expect(
        runtime.withPrincipal('owner-a', (db) => db.select().from(notes)),
      ).resolves.toEqual([
        {
          body: 'private to owner-a',
          id: 'note-a',
          ownerId: 'owner-a',
        },
      ]);
      await expect(
        runtime.withPrincipal('owner-b', (db) => db.select().from(notes)),
      ).resolves.toEqual([]);
    } finally {
      await runtime.close();
    }
  });
});
