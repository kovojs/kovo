import { PGlite } from '@electric-sql/pglite';
import {
  isManagedSqlStatement,
  snapshotManagedSqlStatement,
  type ManagedSqlStatement,
} from '@kovojs/core/internal/sql-safety';
import { sql, staticSql, trustedSql } from '@kovojs/drizzle';
import { describe, expect, it } from 'vitest';

import { managedDb } from './managed-db.js';

describe('managed SQL immutable construction recipe (SPEC §6.6/§10.3 C15)', () => {
  it('preserves parameterization and recursively composed Kovo SQL semantics', () => {
    const projection = sql.join(
      [sql.identifier('id', { allow: ['id'] }), sql.identifier('status', { allow: ['status'] })],
      staticSql`, `,
    );
    const statement = sql`select ${projection} from ${sql.identifier('accounts', {
      allow: ['accounts'],
    })} where id = ${'a1'} order by id ${sql.allow('desc', ['asc', 'desc'])}`;
    const snapshot = snapshotManagedSqlStatement(statement, 'postgres');

    expect(snapshot).toMatchObject({
      ok: true,
      statement: {
        dialect: 'postgres',
        text: 'select "id", "status" from "accounts" where id = $1 order by id desc',
        values: ['a1'],
      },
    });
    expect(
      snapshotManagedSqlStatement(
        trustedSql(sql.raw('select 1'), { justification: 'fixed health probe' }),
        'sqlite',
      ),
    ).toMatchObject({ ok: true, statement: { dialect: 'sqlite', text: 'select 1', values: [] } });
  });

  it('executes only the pinned parameterized write after public queryChunks replacement', async () => {
    const client = new PGlite();
    const observed: ManagedSqlStatement[] = [];
    try {
      await client.exec(`
        create table accounts (id text primary key);
        insert into accounts (id) values ('a1'), ('a2');
      `);
      const adapter = {
        async execute(statement: unknown) {
          expect(isManagedSqlStatement(statement)).toBe(true);
          const managed = statement as ManagedSqlStatement;
          observed.push(managed);
          return client.query(managed.text, [...managed.values]);
        },
      };
      const handle = managedDb(adapter, 'write', {
        sqlWritePolicy: {
          dialect: 'postgres',
          tables: ['accounts'],
          touches: ['account'],
        },
      });
      const statement = sql`delete from accounts where id = ${'missing'}`;

      Object.assign(statement, {
        queryChunks: [{ value: ['delete from accounts where 1=1'] }],
      });
      await handle.execute(statement);

      expect(observed).toHaveLength(1);
      expect(observed[0]).toMatchObject({
        text: 'delete from accounts where id = $1',
        values: ['missing'],
      });
      expect(Object.isFrozen(observed[0])).toBe(true);
      expect(Object.isFrozen(observed[0]?.values)).toBe(true);
      const remaining = await client.query<{ count: number }>(
        'select count(*)::int as count from accounts',
      );
      expect(remaining.rows[0]?.count).toBe(2);
    } finally {
      await client.close();
    }
  });

  it('ignores nested and shallow-frozen carrier mutation and keeps snapshots isolated', () => {
    const predicate = sql`id = ${'missing'}`;
    const nested = sql`delete from accounts where ${predicate}`;
    Object.assign(predicate, {
      queryChunks: [{ value: ['1=1'] }],
    });
    expect(snapshotManagedSqlStatement(nested, 'postgres')).toMatchObject({
      ok: true,
      statement: {
        text: 'delete from accounts where id = $1',
        values: ['missing'],
      },
    });

    const shallow = sql`delete from accounts where id = ${'missing'}`;
    Object.freeze(shallow);
    const literal = shallow.queryChunks[0];
    if (literal === null || typeof literal !== 'object') {
      throw new Error('expected Drizzle StringChunk');
    }
    Object.assign(literal, { value: ['delete from accounts where 1=1'] });
    shallow.queryChunks.splice(1);
    const beforeLaterMutation = snapshotManagedSqlStatement(shallow, 'postgres');
    Object.assign(literal, { value: ['drop table accounts'] });
    const afterLaterMutation = snapshotManagedSqlStatement(shallow, 'postgres');

    expect(beforeLaterMutation).toMatchObject({
      ok: true,
      statement: {
        text: 'delete from accounts where id = $1',
        values: ['missing'],
      },
    });
    expect(afterLaterMutation).toEqual(beforeLaterMutation);
    if (beforeLaterMutation.ok) {
      expect(Object.isFrozen(beforeLaterMutation.statement)).toBe(true);
      expect(Object.isFrozen(beforeLaterMutation.statement.values)).toBe(true);
    }
  });

  it('rejects an unbranded lookalike and keeps managed read mode fail-closed', () => {
    expect(
      snapshotManagedSqlStatement({
        queryChunks: [{ value: ['delete from accounts where 1=1'] }],
      }).ok,
    ).toBe(false);

    let executions = 0;
    const adapter = {
      query(_statement: unknown) {
        executions += 1;
      },
    };
    const handle = managedDb(adapter, 'read', {
      sqlWritePolicy: { dialect: 'postgres' },
    });
    const statement = sql`delete from accounts where id = ${'missing'}`;
    Object.assign(statement, {
      queryChunks: [{ value: ['select 1'] }],
    });

    expect(() => (handle as unknown as { query(value: unknown): void }).query(statement)).toThrow(
      /KV433|read-only|read capability/i,
    );
    expect(executions).toBe(0);
  });
});
