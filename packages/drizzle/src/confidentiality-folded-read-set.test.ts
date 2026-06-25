import { describe, expect, it } from 'vitest';

import {
  diagnosticsForQueryFacts,
  extractQueryFactsFromProject as extractBase,
} from '@kovojs/drizzle/internal/static';
import { withPgDatabaseTypes } from './test-helpers.js';

const extract = (o: Parameters<typeof extractBase>[0]) => extractBase(withPgDatabaseTypes(o));

const TABLES = `
  export const users = pgTable("users", {
    id: text("id").primaryKey(),
    passwordHash: text("password_hash").notNull(),
  }, kovo({ domain: "user", key: "id", secret: ["passwordHash"] }));
  export const sessions = pgTable("sessions", {
    id: text("id").primaryKey(),
  }, kovo({ domain: "session", key: "id" }));
`;

function diagsFor(querySource: string) {
  const facts = extract({ files: [{ fileName: 'q.queries.ts', source: TABLES + querySource }] });
  return { diags: diagnosticsForQueryFacts(facts), facts };
}

describe('F2: opaque sql<T> secret-column leak (KV435/KV410)', () => {
  it('CONTROL: KV435 fires for an opaque projection that reads the secret table via .from', () => {
    const { diags } = diagsFor(`
      export const c = query("c", {
        output: s.object({ secret: s.string() }),
        load(_i, db: PgAsyncDatabase<any, any>) {
          return db.select({ secret: sql<string>\`password_hash\` }).from(users);
        },
      });
    `);
    expect(diags.some((d) => d.code === 'KV435')).toBe(true);
  });

  // CASE A (omitted reads): SPEC §10.2 — an opaque sql<T>/raw projection must declare BOTH an
  // `output` schema AND a `reads:` table set; "a KV410 projection with no `reads:` declaration is
  // itself a KV410 error." Here the secret table `users` lives only in raw SQL text (invisible to
  // static table extraction, hard-rule #9) and there is NO `reads:`, so the build must fail closed
  // with KV410 (F2 fix #1, plans/compiler-soundness.md) — without it the secret column would ship to
  // the client wire on a green build.
  it('CASE A (omitted reads): raw-SQL-only secret table with NO reads MUST be KV410', () => {
    const { diags } = diagsFor(`
      export const leak1 = query("leak1", {
        output: s.object({ stolen: s.string() }),
        load(_i, db: PgAsyncDatabase<any, any>) {
          return db.select({ stolen: sql<string>\`(SELECT password_hash FROM users LIMIT 1)\` }).from(sessions);
        },
      });
    `);
    expect(diags.some((d) => d.code === 'KV410')).toBe(true);
  });

  it('CASE B (honest reads): declared reads:[users] -> KV435 MUST fire (secret in folded read set)', () => {
    const { diags } = diagsFor(`
      export const leak2 = query("leak2", {
        output: s.object({ stolen: s.string() }),
        reads: [users],
        load(_i, db: PgAsyncDatabase<any, any>) {
          return db.select({ stolen: sql<string>\`(SELECT password_hash FROM users LIMIT 1)\` }).from(sessions);
        },
      });
    `);
    expect(diags.some((d) => d.code === 'KV435')).toBe(true);
  });

  it('NEGATIVE: opaque projection over a NON-secret declared read stays green', () => {
    const { diags } = diagsFor(`
      export const ok = query("ok", {
        output: s.object({ n: s.string() }),
        reads: [sessions],
        load(_i, db: PgAsyncDatabase<any, any>) {
          return db.select({ n: sql<string>\`(SELECT id FROM sessions LIMIT 1)\` }).from(sessions);
        },
      });
    `);
    expect(diags.filter((d) => d.code === 'KV435')).toEqual([]);
    expect(diags.filter((d) => d.code === 'KV410')).toEqual([]);
  });
});
