import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { kovo, sql } from '@kovojs/drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it } from 'vitest';

import { role } from '../../better-auth/src/guards.js';
import { drainCrossOwnerReadAuditFacts, managedDb } from './managed-db.js';
import { explainGuard } from './guards.js';
import { createPostgresAppRuntimeDb } from './postgres-runtime.js';

const notes = pgTable(
  'kovo_better_auth_notes',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    title: text('title').notNull(),
  },
  kovo({
    domain: 'better-auth-note',
    key: 'id',
    owner: 'ownerId',
  }),
);

const schema = { notes };
const seedSql =
  'INSERT INTO kovo_better_auth_notes (id, "ownerId", title) VALUES ' +
  "('n1', 'user-a', 'One'), ('n2', 'user-b', 'Two')";

describe('@kovojs/better-auth role guard runtime integration', () => {
  const roots: string[] = [];

  afterEach(() => {
    drainCrossOwnerReadAuditFacts();
    for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
  });

  it('delegates to server role guard audit facts and unlocks crossOwnerRead', async () => {
    drainCrossOwnerReadAuditFacts();
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-better-auth-role-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({
      crossOwnerReadTables: ['kovo_better_auth_notes'],
      dataDir,
      driver: 'pglite',
      schema,
      seedSql,
    });
    const guard = role<{
      session: { user: { id: string; roles: readonly ('admin' | 'support')[] } };
    }>('admin');

    try {
      await runtime.ready;
      const request = { session: { user: { id: 'admin-user', roles: ['admin'] } } };
      const readDb = managedDb(runtime.db(request), 'read');

      expect(() =>
        readDb.crossOwnerRead(sql`SELECT id, title FROM ${notes} ORDER BY id`, {
          reads: ['kovo_better_auth_notes'],
          reason: 'before better-auth role guard',
          role: 'admin',
        }),
      ).toThrow(/guards\.role\("admin"\)/);
      expect(await guard(request)).toBe(true);

      const rows = await readDb.crossOwnerRead<{ id: string; title: string }>(
        sql`SELECT id, title FROM ${notes} ORDER BY id`,
        {
          reads: ['kovo_better_auth_notes'],
          reason: 'better-auth admin export',
          role: 'admin',
          site: 'server/better-auth-role-guard.test.ts',
        },
      );

      expect(rowsOf(rows)).toEqual([
        { id: 'n1', title: 'One' },
        { id: 'n2', title: 'Two' },
      ]);
      expect(explainGuard(guard)).toEqual([
        {
          auth: 'session-role',
          kind: 'role',
          name: 'role:admin',
          principal: {
            expression: 'session.user.roles',
            path: 'user.roles',
            source: 'session',
          },
          role: 'admin',
        },
      ]);
      expect(drainCrossOwnerReadAuditFacts()).toEqual([
        {
          declaredReads: ['public.kovo_better_auth_notes'],
          dialectLabel: 'PGlite',
          observedRead: 'public.kovo_better_auth_notes',
          principal: 'admin-user',
          reason: 'better-auth admin export',
          site: 'server/better-auth-role-guard.test.ts',
        },
      ]);
    } finally {
      await runtime.close();
    }
  });
});

function rowsOf<Row>(result: Row[] | { rows: Row[] }): Row[] {
  return Array.isArray(result) ? result : result.rows;
}
