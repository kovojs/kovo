import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { alias, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createSqliteAuthorizationDb, type SqliteAuthorizationMetadata } from './managed-db.js';

const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  userId: text('user_id').notNull(),
});
const orderItems = sqliteTable('order_items', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull(),
  sku: text('sku').notNull(),
});
const referenceTags = sqliteTable('reference_tags', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
});
const sharedDocs = sqliteTable('shared_docs', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
});
const unclassifiedRows = sqliteTable('unclassified_rows', {
  id: text('id').primaryKey(),
});

const metadata: SqliteAuthorizationMetadata = {
  authorizationClassificationsByTable: new Map([
    ['orders', ['owned']],
    ['order_items', ['ownedVia']],
    ['reference_tags', ['reference']],
    ['shared_docs', ['authzPolicy']],
  ]),
  ownerSourcesByTable: new Map([
    ['orders', { columnKey: 'userId', columnName: 'user_id', table: 'orders' }],
  ]),
  ownerViaSourcesByTable: new Map([
    [
      'order_items',
      {
        fkColumnKey: 'orderId',
        fkColumnName: 'order_id',
        parentKeyColumnKey: 'id',
        parentKeyColumnName: 'id',
        parentTable: 'orders',
        table: 'order_items',
      },
    ],
  ]),
};

describe('SQLite managed authorization predicate binding', () => {
  const clients: Database.Database[] = [];

  afterEach(() => {
    for (const client of clients.splice(0)) client.close();
  });

  function seededDb() {
    const client = new Database(':memory:');
    clients.push(client);
    client.exec(`
      create table orders (id text primary key, user_id text not null, status text not null);
      create table order_items (id text primary key, order_id text not null, sku text not null);
      create table reference_tags (id text primary key, label text not null);
      create table shared_docs (id text primary key, label text not null);
      create table unclassified_rows (id text primary key);
      insert into orders (id, user_id, status) values
        ('o1', 'u1', 'open'),
        ('o2', 'u2', 'open'),
        ('o3', 'u1', 'closed');
      insert into order_items (id, order_id, sku) values
        ('i1', 'o1', 'sku-u1'),
        ('i2', 'o2', 'sku-u2');
      insert into reference_tags (id, label) values ('t1', 'public');
      insert into shared_docs (id, label) values ('d1', 'guard-owned');
      insert into unclassified_rows (id) values ('x1');
    `);
    return drizzle({ client });
  }

  it('scopes owner reads and composes with author predicates without replacing them', () => {
    const db = createSqliteAuthorizationDb(seededDb(), { metadata, principal: 'u1' });
    const query = db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.status, 'open')));

    expect(query.toSQL()).toMatchObject({
      params: ['open', 'u1'],
      sql: expect.stringMatching(/"orders"\."status" = \?\)? and \("orders"\."user_id" = \?/),
    });
    expect(query.all()).toEqual([{ id: 'o1' }]);
  });

  it('uses Drizzle original table names so aliased owner tables stay scoped', () => {
    const db = createSqliteAuthorizationDb(seededDb(), { metadata, principal: 'u1' });
    const ownedOrders = alias(orders, 'owned_orders');
    const query = db.select({ id: ownedOrders.id }).from(ownedOrders);

    expect(query.toSQL()).toMatchObject({
      params: ['u1'],
      sql: expect.stringContaining('"owned_orders"."user_id" = ?'),
    });
    expect(query.all()).toEqual([{ id: 'o1' }, { id: 'o3' }]);
  });

  it('fails closed for anonymous owner-table reads', () => {
    const db = createSqliteAuthorizationDb(seededDb(), { metadata });

    expect(db.select({ id: orders.id }).from(orders).all()).toEqual([]);
  });

  it('recurses into compound select arms before SQL emission', () => {
    const db = createSqliteAuthorizationDb(seededDb(), { metadata, principal: 'u1' });
    const query = db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, 'o1'))
      .union(db.select({ id: orders.id }).from(orders).where(eq(orders.id, 'o2')));

    expect(query.toSQL()).toMatchObject({
      params: ['o1', 'u1', 'o2', 'u1'],
      sql: expect.stringMatching(/union select "id" from "orders" where/),
    });
    expect(query.all()).toEqual([{ id: 'o1' }]);
  });

  it('fails closed for owner-table subqueries in FROM that cannot be safely mutated', () => {
    const db = createSqliteAuthorizationDb(seededDb(), { metadata, principal: 'u1' });
    const subquery = seededDb()
      .select({ id: orders.id, userId: orders.userId })
      .from(orders)
      .as('sq');
    const query = db.select({ id: subquery.id }).from(subquery);

    expect(query.toSQL()).toMatchObject({
      params: [],
      sql: expect.stringMatching(/where 1 = 0$/),
    });
    expect(query.all()).toEqual([]);
  });

  it('scopes update and delete writes to the current owner', () => {
    const db = createSqliteAuthorizationDb(seededDb(), { metadata, principal: 'u1' });

    expect(
      db.update(orders).set({ status: 'closed' }).where(eq(orders.id, 'o2')).run().changes,
    ).toBe(0);
    expect(db.update(orders).set({ status: 'paid' }).where(eq(orders.id, 'o1')).run().changes).toBe(
      1,
    );
    expect(db.delete(orders).where(eq(orders.id, 'o2')).run().changes).toBe(0);
    expect(db.delete(orders).where(eq(orders.id, 'o3')).run().changes).toBe(1);
    expect(() => db.update(orders).set({ userId: 'u2' }).where(eq(orders.id, 'o1')).run()).toThrow(
      /cannot reassign an owner column/,
    );
    expect(() =>
      db.insert(orders).values({ id: 'o4', status: 'open', userId: 'u1' }).run(),
    ).toThrow(/insert into an owner-scoped table/);
  });

  it('scopes ownerVia tables with a framework-generated parent-owner subquery', () => {
    const db = createSqliteAuthorizationDb(seededDb(), { metadata, principal: 'u1' });
    const query = db.select({ id: orderItems.id }).from(orderItems);

    expect(query.toSQL()).toMatchObject({
      params: ['u1'],
      sql: expect.stringMatching(
        /"order_items"\."order_id" in \(select "id" from "orders" where "user_id" = \?\)/,
      ),
    });
    expect(query.all()).toEqual([{ id: 'i1' }]);
  });

  it('denies raw owner-table SQL and builder access to unclassified tables', () => {
    const db = createSqliteAuthorizationDb(seededDb(), { metadata, principal: 'u1' });

    expect(() => db.all('select id from orders')).toThrow(/KV414/);
    expect(() => db.all('select id from shared_docs')).toThrow(/KV414/);
    expect(db.select().from(referenceTags).all()).toEqual([{ id: 't1', label: 'public' }]);
    expect(db.select().from(sharedDocs).all()).toEqual([{ id: 'd1', label: 'guard-owned' }]);
    expect(db.select().from(unclassifiedRows).all()).toEqual([]);
  });
});
