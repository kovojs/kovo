import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createDeclaredWriteDb, kovoDeclaredWriteDbHandle, managedDb } from './managed-db.js';

const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  userId: text('user_id').notNull(),
});
const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
});
const DRIZZLE_NAME_SYMBOL = Symbol.for('drizzle:Name');

describe('SQLite managed runtime quarantine', () => {
  const clients: Database.Database[] = [];

  afterEach(() => {
    for (const client of clients.splice(0)) client.close();
  });

  function seededDb() {
    const client = new Database(':memory:');
    clients.push(client);
    client.exec(`
      create table orders (id text primary key, user_id text not null, status text not null);
      create table audit_log (id text primary key);
      insert into orders (id, user_id, status) values
        ('o1', 'u1', 'open'),
        ('o2', 'u2', 'open');
    `);
    const db = drizzle({ client });
    Object.defineProperty(db, kovoDeclaredWriteDbHandle, {
      configurable: true,
      value: (policy: { tables?: readonly string[]; touches?: readonly string[] }) =>
        createDeclaredWriteDb(db, policy, {
          dialectLabel: 'SQLite',
          normalizeTableName: normalizePolicyTable,
          tableNames: sqliteTablePolicyNames,
        }),
    });
    return db;
  }

  it('keeps read mode read-only without claiming owner scoping', () => {
    const db = managedDb(seededDb(), 'read');

    expect(db.select({ id: orders.id, userId: orders.userId }).from(orders).all()).toEqual([
      { id: 'o1', userId: 'u1' },
      { id: 'o2', userId: 'u2' },
    ]);
    expect(() =>
      (db as never as ReturnType<typeof seededDb>).insert(orders).values({
        id: 'o3',
        status: 'open',
        userId: 'u1',
      }),
    ).toThrow(/KV433/);
  });

  it('keeps the declared-write floor but allows owner-table inserts on SQLite', () => {
    const db = managedDb(seededDb(), 'write', {
      sqlWritePolicy: { tables: ['orders'], touches: ['orders'] },
    });

    expect(db.insert(orders).values({ id: 'o3', status: 'open', userId: 'u1' }).run().changes).toBe(
      1,
    );
    expect(db.select({ id: orders.id }).from(orders).all()).toEqual([
      { id: 'o1' },
      { id: 'o2' },
      { id: 'o3' },
    ]);
    expect(() => db.insert(auditLog).values({ id: 'a1' }).run()).toThrow(/KV406/);
  });
});

function sqliteTablePolicyNames(table: unknown): string[] {
  const name = (table as Record<symbol, unknown>)[DRIZZLE_NAME_SYMBOL];
  if (typeof name !== 'string' || name === '') return [];
  return [normalizePolicyTable(name)];
}

function normalizePolicyTable(table: string): string {
  return table.includes('.') ? table : `main.${table}`;
}
