import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createPgliteTestDb, type PgliteTestDb } from '@kovojs/test/pglite';
import { createSqliteTestDb, type SqliteTestDb } from '@kovojs/test/sqlite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig, pgTable, text } from 'drizzle-orm/pg-core';
import { createAuthorizationCensusDb } from './managed-db.js';

// SPEC section 2 / plans/fundamental-fixes-followup-5.md DEC-A/DEC-I:
// feasibility probes for the runtime authorization choke substrate. These helpers
// deliberately stay local to the test; they are evidence, not the authz runtime.

const APP_ROLE = 'kovo_app';
const DRIZZLE_ORIGINAL_NAME = Symbol.for('drizzle:OriginalName');
const DRIZZLE_BASE_NAME = Symbol.for('drizzle:BaseName');
const DRIZZLE_TABLE_NAME = Symbol.for('drizzle:Name');
const DRIZZLE_IS_ALIAS = Symbol.for('drizzle:IsAlias');

const censusContacts = pgTable('contacts', { id: text('id').primaryKey() });
const censusTags = pgTable('reference_tags', { id: text('id').primaryKey() });
const censusPosts = pgTable('published_posts', { id: text('id').primaryKey() });
const censusDrafts = pgTable('drafts', { id: text('id').primaryKey() });

async function setupPgliteAuthorizationProbe(options: {
  revokeSetConfigFromAppRole: boolean;
}): Promise<PgliteTestDb> {
  const db = await createPgliteTestDb();
  await db.exec(`
    create role ${APP_ROLE};
    ${options.revokeSetConfigFromAppRole ? 'revoke execute on function pg_catalog.set_config(text, text, boolean) from public;' : ''}

    create table orders (
      id text primary key,
      user_id text not null,
      note text not null
    );
    create table order_items (
      id text primary key,
      order_id text not null references orders(id),
      sku text not null
    );
    create index orders_user_id_id_idx on orders(user_id, id);
    create index order_items_order_id_idx on order_items(order_id);

    alter table orders enable row level security;
    alter table orders force row level security;
    create policy orders_owner on orders
      using (user_id = current_setting('kovo.principal', true))
      with check (user_id = current_setting('kovo.principal', true));

    alter table order_items enable row level security;
    alter table order_items force row level security;
    create policy order_items_owner_via_order on order_items
      using (
        exists (
          select 1
          from orders o
          where o.id = order_items.order_id
            and o.user_id = current_setting('kovo.principal', true)
        )
      )
      with check (
        exists (
          select 1
          from orders o
          where o.id = order_items.order_id
            and o.user_id = current_setting('kovo.principal', true)
        )
      );

    insert into orders (id, user_id, note)
    values ('a1', 'A', 'own-a1'), ('a2', 'A', 'own-a2'), ('b1', 'B', 'own-b1');
    insert into order_items (id, order_id, sku)
    values ('ia1', 'a1', 'book'), ('ia2', 'a2', 'pen'), ('ib1', 'b1', 'book');

    grant select, insert, update, delete on orders, order_items to ${APP_ROLE};
  `);
  return db;
}

async function withPglitePrincipal<Result>(
  db: PgliteTestDb,
  principal: string,
  callback: () => Promise<Result>,
): Promise<Result> {
  await db.exec('begin');
  await db.query("select set_config('kovo.principal', $1, true)", [principal]);
  await db.exec(`set local role ${APP_ROLE}`);
  try {
    const result = await callback();
    await db.exec('rollback');
    return result;
  } catch (error) {
    await db.exec('rollback').catch(() => undefined);
    throw error;
  }
}

async function withPgliteRoleOnly<Result>(
  db: PgliteTestDb,
  callback: () => Promise<Result>,
): Promise<Result> {
  await db.exec('begin');
  await db.exec(`set local role ${APP_ROLE}`);
  try {
    const result = await callback();
    await db.exec('rollback');
    return result;
  } catch (error) {
    await db.exec('rollback').catch(() => undefined);
    throw error;
  }
}

async function withUnsafeRoleThenPrincipal<Result>(
  db: PgliteTestDb,
  principal: string,
  callback: () => Promise<Result>,
): Promise<Result> {
  await db.exec('begin');
  await db.exec(`set local role ${APP_ROLE}`);
  await db.query("select set_config('kovo.principal', $1, true)", [principal]);
  try {
    const result = await callback();
    await db.exec('rollback');
    return result;
  } catch (error) {
    await db.exec('rollback').catch(() => undefined);
    throw error;
  }
}

async function pgliteIds(
  db: PgliteTestDb,
  statement: string,
  params: readonly unknown[] = [],
): Promise<string[]> {
  const rows = await db.query<{ id: string }>(statement, params);
  return rows.map((row) => row.id);
}

describe('authorization feasibility gates (followup-5 phase 1.0/1.0b)', () => {
  it('proves the PGlite managed census wrapper denies unclassified schema tables only', async () => {
    const db = await createPgliteTestDb();
    try {
      await db.exec(`
        create table contacts (id text primary key);
        create table reference_tags (id text primary key);
        create table published_posts (id text primary key);
        create table drafts (id text primary key);
        insert into contacts (id) values ('c1');
        insert into reference_tags (id) values ('t1');
        insert into published_posts (id) values ('p1');
        insert into drafts (id) values ('d1');
      `);
      const handle = createAuthorizationCensusDb(drizzle({ client: db.pglite }), {
        dialectLabel: 'PGlite',
        metadata: {
          authorizationClassificationsByTable: new Map([
            ['contacts', ['authzPolicy']],
            ['reference_tags', ['reference']],
            ['published_posts', ['public']],
          ]),
          schemaTableNames: new Set(['contacts', 'reference_tags', 'published_posts', 'drafts']),
        },
        normalizeTableName: (table) => (table.includes('.') ? table : `public.${table}`),
        tableNames: (table) => [getTableConfig(table as Parameters<typeof getTableConfig>[0]).name],
      });

      await expect(handle.select({ id: censusContacts.id }).from(censusContacts)).resolves.toEqual([
        { id: 'c1' },
      ]);
      await expect(handle.select({ id: censusTags.id }).from(censusTags)).resolves.toEqual([
        { id: 't1' },
      ]);
      await expect(handle.select({ id: censusPosts.id }).from(censusPosts)).resolves.toEqual([
        { id: 'p1' },
      ]);
      expect(() => handle.select({ id: censusDrafts.id }).from(censusDrafts)).toThrow(
        /KV414[\s\S]*drafts[\s\S]*no authorization classification/,
      );
    } finally {
      await db.close();
    }
  });

  it('proves the PGlite RLS path is single-statement and fail-closed under the locked app role', async () => {
    const db = await setupPgliteAuthorizationProbe({ revokeSetConfigFromAppRole: true });
    try {
      await expect(
        withPgliteRoleOnly(db, () => pgliteIds(db, 'select id from orders order by id')),
      ).resolves.toEqual([]);

      await expect(
        withPglitePrincipal(db, 'A', () => pgliteIds(db, 'select id from orders order by id')),
      ).resolves.toEqual(['a1', 'a2']);

      await expect(
        withPglitePrincipal(db, "A'); reset role; select id from orders; --", () =>
          pgliteIds(db, 'select id from orders order by id'),
        ),
      ).resolves.toEqual([]);

      await expect(
        withPglitePrincipal(db, 'A', () =>
          db.query('select id from orders; reset role; select id from orders'),
        ),
      ).rejects.toThrow(/multiple commands|prepared statement/);

      await expect(
        withPglitePrincipal(db, 'A', () =>
          db.query(`
            with poisoned as materialized (
              select set_config('role', 'postgres', false)
            )
            select orders.id
            from poisoned cross join orders
            order by orders.id
          `),
        ),
      ).rejects.toThrow(/permission denied for function set_config/);

      await expect(
        withPglitePrincipal(db, 'A', () =>
          db.query(`
            with poisoned as materialized (
              select set_config('kovo.principal', 'B', true)
            )
            select orders.id
            from poisoned cross join orders
            order by orders.id
          `),
        ),
      ).rejects.toThrow(/permission denied for function set_config/);

      await expect(
        withPglitePrincipal(db, 'A', () =>
          pgliteIds(db, 'update orders set note = $1 where id = $2 returning id', [
            'updated',
            'a1',
          ]),
        ),
      ).resolves.toEqual(['a1']);

      await expect(
        withPglitePrincipal(db, 'A', () =>
          db.query('insert into orders (id, user_id, note) values ($1, $2, $3)', [
            'forged',
            'B',
            'bad',
          ]),
        ),
      ).rejects.toThrow(/row-level security policy/);

      await expect(
        withPglitePrincipal(db, 'A', () =>
          db.query('update orders set user_id = $1 where id = $2 returning id', ['B', 'a1']),
        ),
      ).rejects.toThrow(/row-level security policy/);

      await expect(
        withPglitePrincipal(db, 'A', () =>
          pgliteIds(db, 'delete from orders where id = $1 returning id', ['b1']),
        ),
      ).resolves.toEqual([]);

      await expect(
        withPglitePrincipal(db, 'A', () => pgliteIds(db, 'select id from order_items order by id')),
      ).resolves.toEqual(['ia1', 'ia2']);
      await expect(
        withPglitePrincipal(db, 'B', () => pgliteIds(db, 'select id from order_items order by id')),
      ).resolves.toEqual(['ib1']);

      const explain = await withPglitePrincipal(db, 'A', () =>
        db.query<Record<'QUERY PLAN', string>>(
          'explain (costs off) select id from order_items order by id',
        ),
      );
      expect(explain.map((row) => row['QUERY PLAN']).join('\n')).toContain('orders_user_id_id_idx');
    } finally {
      await db.close();
    }
  });

  it('documents that PGlite principal setting after role switch is infeasible without set_config revocation', async () => {
    const db = await setupPgliteAuthorizationProbe({ revokeSetConfigFromAppRole: false });
    try {
      await expect(
        withUnsafeRoleThenPrincipal(db, 'A', () =>
          pgliteIds(
            db,
            `
              with poisoned as materialized (
                select set_config('kovo.principal', 'B', true)
              )
              select orders.id
              from poisoned cross join orders
              order by orders.id
            `,
          ),
        ),
      ).resolves.toEqual(['b1']);
    } finally {
      await db.close();
    }
  });
});

type ObjectRecord = Record<PropertyKey, unknown>;
type SqliteColumnBuilder = {
  notNull(): SqliteColumnBuilder;
  primaryKey(): SqliteColumnBuilder;
};
type SqliteTable = ObjectRecord;
type OrdersTable = SqliteTable & {
  id: unknown;
  userId: unknown;
  status: unknown;
};
type OrderItemsTable = SqliteTable & {
  id: unknown;
  orderId: unknown;
  sku: unknown;
};
type SelectFromBuilder = {
  from(table: unknown): SelectQuery;
};
type SelectQuery = ObjectRecord & {
  as(alias: string): unknown;
  leftJoin(table: unknown, on: unknown): SelectQuery;
  toSQL(): { sql: string; params: unknown[] };
  unionAll(right: SelectQuery): SelectQuery;
  where(condition: unknown): SelectQuery;
};
type QueryBuilder = {
  select(fields: Record<string, unknown>): SelectFromBuilder;
};
type SelectConfig = ObjectRecord & {
  joins?: unknown;
  setOperators?: unknown;
  table?: unknown;
  where?: unknown;
};
type JoinConfig = ObjectRecord & { table?: unknown };
type SetOperatorConfig = ObjectRecord & { rightSelect?: unknown };
type TableIdentity = {
  baseName: string;
  isAlias: boolean;
  originalName: string;
  renderedName: string;
};

const drizzleRequire = createRequire(new URL('../../drizzle/package.json', import.meta.url));
const sqliteCore = drizzleRequire('drizzle-orm/sqlite-core') as {
  QueryBuilder: new () => QueryBuilder;
  alias<T extends SqliteTable>(table: T, alias: string): T;
  getTableConfig(table: unknown): { name: string };
  sqliteTable(name: string, columns: Record<string, unknown>): SqliteTable;
  text(name: string): SqliteColumnBuilder;
};
const drizzleOrm = drizzleRequire('drizzle-orm') as {
  and(...conditions: unknown[]): unknown;
  eq(left: unknown, right: unknown): unknown;
};

function asRecord(value: unknown): ObjectRecord | null {
  return value !== null && typeof value === 'object' ? (value as ObjectRecord) : null;
}

function tableIdentity(value: unknown): TableIdentity | null {
  const record = asRecord(value);
  if (record === null) return null;
  const originalName = record[DRIZZLE_ORIGINAL_NAME];
  const baseName = record[DRIZZLE_BASE_NAME];
  const renderedName = record[DRIZZLE_TABLE_NAME];
  const isAlias = record[DRIZZLE_IS_ALIAS];
  if (
    typeof originalName !== 'string' ||
    typeof baseName !== 'string' ||
    typeof renderedName !== 'string'
  ) {
    return null;
  }
  return {
    baseName,
    isAlias: isAlias === true,
    originalName,
    renderedName,
  };
}

function selectConfig(query: unknown): SelectConfig {
  const config = asRecord(query)?.config;
  if (asRecord(config) === null) {
    throw new Error('Drizzle select builder no longer exposes a mutable config object.');
  }
  return config as SelectConfig;
}

function collectSqlChunkTableNames(value: unknown, seen = new Set<unknown>()): string[] {
  if (value === null || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  const identity = tableIdentity(value);
  if (identity !== null) return [identity.originalName];
  const queryChunks = asRecord(value)?.queryChunks;
  if (!Array.isArray(queryChunks)) return [];
  return queryChunks.flatMap((chunk) => collectSqlChunkTableNames(chunk, seen));
}

function subqueryOwnerTables(value: unknown, ownerTables: ReadonlySet<string>): string[] {
  const metadata = asRecord(value)?._;
  if (asRecord(metadata)?.brand !== 'Subquery') return [];
  const usedTables = asRecord(metadata)?.usedTables;
  const byUsedTables = Array.isArray(usedTables)
    ? usedTables.filter((table): table is string => typeof table === 'string')
    : [];
  const bySqlChunks = collectSqlChunkTableNames(asRecord(metadata)?.sql);
  return [...new Set([...byUsedTables, ...bySqlChunks])].filter((table) => ownerTables.has(table));
}

function applyOwnerPredicateProbe(
  query: SelectQuery,
  ownerTables: ReadonlySet<string>,
  principal: string,
): { failClosed: string[]; injected: string[] } {
  const result = { failClosed: [] as string[], injected: [] as string[] };
  applyOwnerPredicateToSelect(query, ownerTables, principal, result);
  result.failClosed.sort();
  result.injected.sort();
  return result;
}

function applyOwnerPredicateToSelect(
  query: unknown,
  ownerTables: ReadonlySet<string>,
  principal: string,
  result: { failClosed: string[]; injected: string[] },
): void {
  const config = selectConfig(query);
  const joins = Array.isArray(config.joins) ? (config.joins as JoinConfig[]) : [];
  for (const table of [config.table, ...joins.map((join) => join.table)]) {
    const identity = tableIdentity(table);
    if (identity !== null && ownerTables.has(identity.originalName)) {
      const ownerColumn = asRecord(table)?.userId;
      if (ownerColumn === undefined) {
        result.failClosed.push(`missing-owner-column:${identity.originalName}`);
        continue;
      }
      const predicate = drizzleOrm.eq(ownerColumn, principal);
      config.where =
        config.where === undefined ? predicate : drizzleOrm.and(config.where, predicate);
      result.injected.push(
        identity.isAlias
          ? `${identity.originalName} as ${identity.renderedName}`
          : identity.originalName,
      );
      continue;
    }
    for (const ownerTable of subqueryOwnerTables(table, ownerTables)) {
      result.failClosed.push(`subquery-from:${ownerTable}`);
    }
  }

  const setOperators = Array.isArray(config.setOperators)
    ? (config.setOperators as SetOperatorConfig[])
    : [];
  for (const setOperator of setOperators) {
    applyOwnerPredicateToSelect(setOperator.rightSelect, ownerTables, principal, result);
  }
}

function sqliteDrizzleFixture(): {
  orderItems: OrderItemsTable;
  orders: OrdersTable;
  qb: QueryBuilder;
} {
  const orders = sqliteCore.sqliteTable('orders', {
    id: sqliteCore.text('id').primaryKey(),
    status: sqliteCore.text('status').notNull(),
    userId: sqliteCore.text('user_id').notNull(),
  }) as OrdersTable;
  const orderItems = sqliteCore.sqliteTable('order_items', {
    id: sqliteCore.text('id').primaryKey(),
    orderId: sqliteCore.text('order_id').notNull(),
    sku: sqliteCore.text('sku').notNull(),
  }) as OrderItemsTable;
  return { orderItems, orders, qb: new sqliteCore.QueryBuilder() };
}

describe('SQLite Drizzle authorization feasibility (followup-5 phase 1.0)', () => {
  it('proves pinned Drizzle internals support flat, join, alias, and compound predicate injection', () => {
    const { orderItems, orders, qb } = sqliteDrizzleFixture();
    const ownerTables = new Set(['orders']);

    const flat = qb
      .select({ id: orders.id })
      .from(orders)
      .where(drizzleOrm.eq(orders.status, 'open'));
    expect(applyOwnerPredicateProbe(flat, ownerTables, 'A')).toEqual({
      failClosed: [],
      injected: ['orders'],
    });
    expect(flat.toSQL()).toEqual({
      params: ['open', 'A'],
      sql: 'select "id" from "orders" where (("orders"."status" = ?) and ("orders"."user_id" = ?))',
    });

    const orderAlias = sqliteCore.alias(orders, 'o') as OrdersTable;
    expect(sqliteCore.getTableConfig(orderAlias).name).toBe('o');
    expect(tableIdentity(orderAlias)).toEqual({
      baseName: 'orders',
      isAlias: true,
      originalName: 'orders',
      renderedName: 'o',
    });
    const aliasJoin = qb
      .select({ id: orderAlias.id, sku: orderItems.sku })
      .from(orderAlias)
      .leftJoin(orderItems, drizzleOrm.eq(orderItems.orderId, orderAlias.id));
    expect(applyOwnerPredicateProbe(aliasJoin, ownerTables, 'A')).toEqual({
      failClosed: [],
      injected: ['orders as o'],
    });
    expect(aliasJoin.toSQL()).toEqual({
      params: ['A'],
      sql: 'select "o"."id", "order_items"."sku" from "orders" "o" left join "order_items" on "order_items"."order_id" = "o"."id" where "o"."user_id" = ?',
    });

    const compoundLeft = qb
      .select({ id: orders.id })
      .from(orders)
      .where(drizzleOrm.eq(orders.status, 'open'));
    const compoundRight = qb
      .select({ id: orders.id })
      .from(orders)
      .where(drizzleOrm.eq(orders.status, 'closed'));
    const compound = compoundLeft.unionAll(compoundRight);
    expect(applyOwnerPredicateProbe(compound, ownerTables, 'A')).toEqual({
      failClosed: [],
      injected: ['orders', 'orders'],
    });
    expect(compound.toSQL()).toEqual({
      params: ['open', 'A', 'closed', 'A'],
      sql: 'select "id" from "orders" where (("orders"."status" = ?) and ("orders"."user_id" = ?)) union all select "id" from "orders" where (("orders"."status" = ?) and ("orders"."user_id" = ?))',
    });
  });

  it('documents subquery-FROM as fail-closed when Drizzle exposes only compiled SQL chunks', () => {
    const { orders, qb } = sqliteDrizzleFixture();
    const subquery = qb
      .select({ id: orders.id, userId: orders.userId })
      .from(orders)
      .as('owned_orders');
    const outer = qb.select({ id: (subquery as { id: unknown }).id }).from(subquery) as SelectQuery;

    expect(applyOwnerPredicateProbe(outer, new Set(['orders']), 'A')).toEqual({
      failClosed: ['subquery-from:orders'],
      injected: [],
    });
    expect(outer.toSQL()).toEqual({
      params: [],
      sql: 'select "id" from (select "id", "user_id" from "orders") "owned_orders"',
    });
  });
});

const SQLITE_OWNER_VIA_SQL = `
  select id
  from order_items
  where order_id in (
    select id from orders where user_id = ?
  )
  order by id
`;

function setupSqliteOwnerViaProbe(): SqliteTestDb {
  const db = createSqliteTestDb();
  db.exec(`
    create table orders (
      id text primary key,
      user_id text not null
    );
    create table order_items (
      id text primary key,
      order_id text not null references orders(id),
      sku text not null
    );
    create index orders_user_id_id_idx on orders(user_id, id);
    create index order_items_order_id_idx on order_items(order_id);
    insert into orders (id, user_id) values ('a1', 'A'), ('a2', 'A'), ('b1', 'B');
    insert into order_items (id, order_id, sku)
    values ('ia1', 'a1', 'book'), ('ia2', 'a2', 'pen'), ('ib1', 'b1', 'book');
  `);
  return db;
}

function sqliteIds(db: SqliteTestDb, statement: string, params: readonly unknown[] = []): string[] {
  return db.query<{ id: string }>(statement, params).map((row) => row.id);
}

function sqlitePlanDetails(
  db: SqliteTestDb,
  statement: string,
  params: readonly unknown[] = [],
): string[] {
  return db
    .query<{ detail: string }>(`explain query plan ${statement}`, params)
    .map((row) => row.detail);
}

describe('ownerVia feasibility (followup-5 phase 1.0b)', () => {
  it('proves SQLite IN-subquery ownerVia filters direct child-table reads and uses the declared indexes', () => {
    const db = setupSqliteOwnerViaProbe();
    try {
      expect(sqliteIds(db, SQLITE_OWNER_VIA_SQL, ['A'])).toEqual(['ia1', 'ia2']);
      expect(sqliteIds(db, SQLITE_OWNER_VIA_SQL, ['B'])).toEqual(['ib1']);

      const compound = `
        select id
        from order_items
        where sku = ?
          and order_id in (select id from orders where user_id = ?)
        union all
        select id
        from order_items
        where sku = ?
          and order_id in (select id from orders where user_id = ?)
      `;
      expect(sqliteIds(db, compound, ['book', 'A', 'pen', 'A']).sort()).toEqual(['ia1', 'ia2']);

      const subqueryFrom = `
        select id
        from (
          select *
          from order_items
          where order_id in (select id from orders where user_id = ?)
        ) scoped_items
        order by id
      `;
      expect(sqliteIds(db, subqueryFrom, ['A'])).toEqual(['ia1', 'ia2']);

      const plan = sqlitePlanDetails(db, SQLITE_OWNER_VIA_SQL, ['A']).join('\n');
      expect(plan).toContain('SEARCH order_items USING INDEX order_items_order_id_idx');
      expect(plan).toContain('SEARCH orders USING COVERING INDEX orders_user_id_id_idx');
    } finally {
      db.close();
    }
  });
});
