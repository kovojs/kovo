import { describe, expect, it } from 'vitest';

import {
  classifyStatement,
  parseSqlWriteTables,
  UNTABLED_SQL_WRITE,
} from './sql-write-allowlist.js';

describe('parseSqlWriteTables', () => {
  it('keeps DML write table extraction precise', () => {
    expect(parseSqlWriteTables('DELETE FROM contacts', { dialect: 'sqlite' })).toEqual([
      'contacts',
    ]);
  });

  it.each([
    'DROP TABLE contacts',
    'ALTER TABLE contacts ADD COLUMN nickname text',
    'CREATE TABLE contacts (id text)',
    'CREATE INDEX contacts_id_idx ON contacts(id)',
    'REFRESH MATERIALIZED VIEW contacts_cache',
    'DROP INDEX contacts_id_idx',
    'CREATE VIEW contact_names AS SELECT name FROM contacts',
    "DO $$ BEGIN RAISE NOTICE 'x'; END $$;",
    'PRAGMA user_version = 1',
    'VACUUM',
    'REINDEX',
    "ATTACH DATABASE 'tenant.db' AS tenant",
  ])('classifies untableable statements as writes: %s', (sql) => {
    expect(parseSqlWriteTables(sql, { dialect: 'sqlite' })).toEqual([UNTABLED_SQL_WRITE]);
  });

  it('keeps positively proven reads empty', () => {
    expect(parseSqlWriteTables('SELECT id FROM contacts', { dialect: 'sqlite' })).toEqual([]);
  });

  it('fails closed for read-shaped statements with unproven SQL function calls', () => {
    expect(parseSqlWriteTables("SELECT setval('probe_seq', 1)", { dialect: 'postgres' })).toEqual([
      UNTABLED_SQL_WRITE,
    ]);
    expect(parseSqlWriteTables("SELECT nextval('probe_seq')", { dialect: 'postgres' })).toEqual([
      UNTABLED_SQL_WRITE,
    ]);
  });
});

describe('classifyStatement', () => {
  it('separates proven reads, proven writes, and unproven function-bearing reads', () => {
    expect(classifyStatement('select now()', { dialect: 'postgres' })).toEqual({
      kind: 'proven-safe',
    });
    expect(classifyStatement('update contacts set name = $1 where id = $2')).toEqual({
      kind: 'proven-unsafe',
      detail: ['contacts'],
    });
    expect(classifyStatement("select setval('probe_seq', 1)", { dialect: 'postgres' })).toEqual({
      kind: 'unproven',
      reason: 'SQL read contains non-allowlisted function call(s): setval',
    });
  });

  it('keeps unqualified unknown and volatile wrappers unproven across generated shapes', () => {
    const cases = generatedFunctionCases(240);
    expect(cases).toHaveLength(240);

    for (const entry of cases) {
      const verdict = classifyStatement(entry.sql, { dialect: 'postgres' });
      expect(verdict.kind, entry.sql).toBe(entry.provenPure ? 'proven-safe' : 'unproven');
    }
  });
});

interface GeneratedFunctionCase {
  provenPure: boolean;
  sql: string;
}

const PURE_CALLS = [
  "lower('Ada')",
  "upper('Ada')",
  'abs(-7)',
  "coalesce(null, 'Ada')",
  "length('Ada')",
  'round(7.25)',
  'now()',
] as const;

const UNKNOWN_CALLS = [
  "setval('probe_seq', 1)",
  "nextval('probe_seq')",
  "user_mutate('Ada')",
  "audit.bump('Ada')",
] as const;

function generatedFunctionCases(count: number): GeneratedFunctionCase[] {
  return Array.from({ length: count }, (_, index) => {
    const provenPure = index % 2 === 0;
    const calls = provenPure ? PURE_CALLS : UNKNOWN_CALLS;
    const call = calls[(index * 17 + 5) % calls.length]!;
    return {
      provenPure,
      sql: wrapFunctionCall(call, index),
    };
  });
}

function wrapFunctionCall(call: string, index: number): string {
  switch (index % 6) {
    case 0:
      return `select ${call}`;
    case 1:
      return `select coalesce((${call})::text, 'fallback')`;
    case 2:
      return `values (${call})`;
    case 3:
      return `with probe as (select ${call} as value) select value from probe`;
    case 4:
      return `select 1 where ${call} is not null`;
    default:
      return `select lower((${call})::text)`;
  }
}
