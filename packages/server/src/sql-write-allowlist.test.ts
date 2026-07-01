import { describe, expect, it } from 'vitest';

import { parseSqlWriteTables, UNTABLED_SQL_WRITE } from './sql-write-allowlist.js';

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
});
