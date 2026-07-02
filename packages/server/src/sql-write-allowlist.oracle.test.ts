import { describe, expect, it } from 'vitest';

import { createPgliteTestDb } from '@kovojs/test/pglite';
import { createSqliteTestDb } from '@kovojs/test/sqlite';
import { parseSqlWriteTables } from './sql-write-allowlist.js';
import { sqlWriteOracle, type SqlWriteOracleExecutor } from './sql-write-oracle.js';

interface OracleCase {
  name: string;
  postgres?: string;
  sqlite?: string;
  write: boolean;
}

const oracleCases: readonly OracleCase[] = [
  {
    name: 'plain select',
    postgres: 'select id, name from contacts',
    sqlite: 'select id, name from contacts',
    write: false,
  },
  {
    name: 'insert',
    postgres: "insert into contacts (id, name) values ('c2', 'Bryn')",
    sqlite: "insert into contacts (id, name) values ('c2', 'Bryn')",
    write: true,
  },
  {
    name: 'update',
    postgres: "update contacts set name = 'Ada Lovelace' where id = 'c1'",
    sqlite: "update contacts set name = 'Ada Lovelace' where id = 'c1'",
    write: true,
  },
  {
    name: 'delete',
    postgres: "delete from contacts where id = 'c1'",
    sqlite: "delete from contacts where id = 'c1'",
    write: true,
  },
  {
    name: 'create table',
    postgres: 'create table audit_log (id text primary key)',
    sqlite: 'create table audit_log (id text primary key)',
    write: true,
  },
  {
    name: 'alter table',
    postgres: 'alter table contacts add column nickname text',
    sqlite: 'alter table contacts add column nickname text',
    write: true,
  },
  {
    name: 'create index',
    postgres: 'create index contacts_name_idx on contacts(name)',
    sqlite: 'create index contacts_name_idx on contacts(name)',
    write: true,
  },
  {
    name: 'create view',
    postgres: 'create view contact_names as select name from contacts',
    sqlite: 'create view contact_names as select name from contacts',
    write: true,
  },
  {
    name: 'pragma user_version',
    sqlite: 'pragma user_version = 7',
    write: true,
  },
];

describe('sqlWriteOracle', () => {
  it.each(oracleCases.filter((entry) => entry.postgres))(
    'matches the parser for Postgres: $name',
    async ({ postgres: sql, write }) => {
      const db = await createPgliteTestDb();
      try {
        await seedPostgres(db);
        const oracle = await sqlWriteOracle(db, sql!, { dialect: 'postgres' });
        expect(oracle.changed).toBe(write);
        expect(parserSaysWrite(sql!, 'postgres')).toBe(write);
      } finally {
        await db.close();
      }
    },
  );

  it.each(oracleCases.filter((entry) => entry.sqlite))(
    'matches the parser for SQLite: $name',
    async ({ sqlite: sql, write }) => {
      const db = createSqliteTestDb();
      try {
        seedSqlite(db);
        const oracle = await sqlWriteOracle(db, sql!, { dialect: 'sqlite' });
        expect(oracle.changed).toBe(write);
        expect(parserSaysWrite(sql!, 'sqlite')).toBe(write);
      } finally {
        db.close();
      }
    },
  );

  it.each(generatedPostgresVolatileSelects())(
    'matches the parser for generated volatile Postgres SELECT: %s',
    async (sql) => {
      const db = await createPgliteTestDb();
      try {
        await seedPostgres(db);
        const oracle = await sqlWriteOracle(db, sql, { dialect: 'postgres' });
        expect(oracle.changed).toBe(true);
        expect(parserSaysWrite(sql, 'postgres')).toBe(true);
      } finally {
        await db.close();
      }
    },
  );
});

async function seedPostgres(db: SqlWriteOracleExecutor): Promise<void> {
  await db.exec('create table contacts (id text primary key, name text not null)');
  await db.exec('create sequence probe_seq');
  await db.exec("insert into contacts (id, name) values ('c1', 'Ada')");
}

function seedSqlite(db: SqlWriteOracleExecutor): void {
  db.exec('create table contacts (id text primary key, name text not null)');
  db.exec("insert into contacts (id, name) values ('c1', 'Ada')");
}

function parserSaysWrite(sql: string, dialect: 'postgres' | 'sqlite'): boolean {
  return parseSqlWriteTables(sql, { dialect }).length > 0;
}

function generatedPostgresVolatileSelects(): string[] {
  const calls = ["nextval('probe_seq')", "setval('probe_seq', 10)"] as const;
  return Array.from({ length: 24 }, (_, index) => wrapVolatileCall(calls[index % 2]!, index));
}

function wrapVolatileCall(call: string, index: number): string {
  switch (index % 6) {
    case 0:
      return `select ${call}`;
    case 1:
      return `select coalesce(${call}, 0)`;
    case 2:
      return `values (${call})`;
    case 3:
      return `with probe as (select ${call} as value) select value from probe`;
    case 4:
      return `select 1 where ${call} is not null`;
    default:
      return `select abs(${call})`;
  }
}
