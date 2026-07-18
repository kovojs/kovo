import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { stampTrustedSql } from '@kovojs/core/internal/sql-safety';

import './sql-parser-authority-bootstrap.js';
import {
  createPostgresScopedClient,
  drainPostgresRlsSilentDenyDiagnostics,
  readonlyDb,
  type PostgresScopedClientOptions,
} from './managed-db.js';

// SPEC §10.3/§11.1: Postgres/PGlite owner authorization is enforced by RLS on the
// proven owner principal, not by query-shape inspection. These tests use real
// PGlite so raw reads and write result counts are storage-engine behavior.

const APP_ROLE = 'kovo_app_test';

describe('Postgres/PGlite owner RLS runtime floor', () => {
  const clients: PGlite[] = [];

  afterEach(async () => {
    drainPostgresRlsSilentDenyDiagnostics();
    await Promise.all(clients.map((client) => client.close()));
    clients.length = 0;
  });

  it('confines reads and writes to the transaction-scoped owner principal', async () => {
    const client = new PGlite();
    clients.push(client);
    await installOwnerScopedSchema(client);

    const u1 = scopedClient(client, 'u1');
    const u2 = scopedClient(client, 'u2');
    const anonymous = scopedClient(client, undefined);

    await expect(orderIds(u1)).resolves.toEqual(['o1']);
    await expect(orderIds(u2)).resolves.toEqual(['o2']);
    await expect(orderIds(anonymous)).resolves.toEqual([]);

    await expect(
      rowsOf(u1.query('select id from orders where user_id = $1 order by id', ['u2'])),
    ).resolves.toEqual([]);
    await expect(rowsOf(u1.query('select id from orders order by id'))).resolves.toEqual([
      { id: 'o1' },
    ]);

    await expect(
      rowsOf(
        u1.query('update orders set label = $1 where id = $2 returning id', [
          'cross-owner update',
          'o2',
        ]),
      ),
    ).resolves.toEqual([]);
    await expect(
      rowsOf(u1.query('delete from orders where id = $1 returning id', ['o2'])),
    ).resolves.toEqual([]);
    await expect(orderIds(u2)).resolves.toEqual(['o2']);

    await expect(
      u1.query('insert into orders (id, user_id, label) values ($1, $2, $3)', [
        'forged-insert',
        'u2',
        'forged',
      ]),
    ).rejects.toThrow(/KV433: Postgres RLS rejected a write to table orders/);
    await expect(
      u1.query('update orders set user_id = $1 where id = $2', ['u2', 'o1']),
    ).rejects.toThrow(/KV433: Postgres RLS rejected a write to table orders/);

    await expect(
      rowsOf(
        u1.query('insert into orders (id, user_id, label) values ($1, $2, $3) returning id', [
          'o3',
          'u1',
          'own insert',
        ]),
      ),
    ).resolves.toEqual([{ id: 'o3' }]);
    await expect(orderIds(u1)).resolves.toEqual(['o1', 'o3']);
  });

  it('confines ownerVia child tables through the parent owner policy', async () => {
    const client = new PGlite();
    clients.push(client);
    await installOwnerScopedSchema(client);

    const u1 = scopedClient(client, 'u1');
    const u2 = scopedClient(client, 'u2');
    const anonymous = scopedClient(client, undefined);

    await expect(itemIds(u1)).resolves.toEqual(['i1']);
    await expect(itemIds(u2)).resolves.toEqual(['i2']);
    await expect(itemIds(anonymous)).resolves.toEqual([]);
    await expect(
      rowsOf(u1.query('select id from order_items where order_id = $1 order by id', ['o2'])),
    ).resolves.toEqual([]);
    await expect(
      rowsOf(
        u1.query('insert into order_items (id, order_id, label) values ($1, $2, $3)', [
          'forged-child',
          'o2',
          'forged child',
        ]),
      ),
    ).rejects.toThrow(/KV433: Postgres RLS rejected a write to table order_items/);
    await expect(
      rowsOf(u1.query('update order_items set order_id = $1 where id = $2', ['o2', 'i1'])),
    ).rejects.toThrow(/KV433: Postgres RLS rejected a write to table order_items/);
  });

  it('binds the principal before role assumption and prevents SQL text from widening it', async () => {
    const client = new PGlite();
    clients.push(client);
    await installOwnerScopedSchema(client);
    const u1 = scopedClient(client, 'u1');

    expect(() =>
      u1.query("select pg_catalog.set_config('kovo.principal', $1, true)", ['u2']),
    ).toThrow(/KV414/);
    await expect(orderIds(u1)).resolves.toEqual(['o1']);

    expect(() => u1.query('select id from orders; reset role; select id from orders')).toThrow(
      /KV414/,
    );
    await expect(orderIds(u1)).resolves.toEqual(['o1']);
  });

  it('keeps declared rawRead scoped by Postgres RLS regardless of declaration breadth', async () => {
    const client = new PGlite();
    clients.push(client);
    await installOwnerScopedSchema(client);
    const u1 = rawReadClient(client, 'u1');
    const anonymous = rawReadClient(client, undefined);
    const statement = stampTrustedSql(
      { sql: 'select id from orders order by id', values: [] },
      'Postgres owner-scoped rawRead proof',
    );

    await expect(
      rowsOf<{ id: string }>(
        u1.rawRead(statement, { reads: ['orders'] }) as unknown as Promise<{
          rows: { id: string }[];
        }>,
      ),
    ).resolves.toEqual([{ id: 'o1' }]);
    await expect(
      rowsOf<{ id: string }>(
        anonymous.rawRead(statement, { reads: ['orders'] }) as unknown as Promise<{
          rows: { id: string }[];
        }>,
      ),
    ).resolves.toEqual([]);
  });

  it('keeps explicit transactions inside the same Postgres role and principal frame', async () => {
    const client = new PGlite();
    clients.push(client);
    await installOwnerScopedSchema(client);
    const u1 = scopedClient(client, 'u1') as PGlite;

    await expect(
      u1.transaction(async (tx) => {
        await tx.query(
          "insert into orders (id, user_id, label) values ('own-tx', 'u1', 'own transaction')",
        );
      }),
    ).resolves.toBeUndefined();
    await expect(orderIds(u1)).resolves.toEqual(['o1', 'own-tx']);
    await expect(
      u1.transaction(async (tx) => {
        await tx.query(
          "insert into orders (id, user_id, label) values ('cross-tx', 'u2', 'cross transaction')",
        );
      }),
    ).rejects.toThrow(/row-level security|violates/u);
  });

  it('diagnoses dev empty reads when RLS filtered a non-empty owner table', async () => {
    const client = new PGlite();
    clients.push(client);
    await installOwnerScopedSchema(client);
    const missingOwner = scopedClient(client, 'u-missing', {
      privilegedClient: client,
      tableName: 'orders',
    });

    await expect(orderIds(missingOwner)).resolves.toEqual([]);

    expect(drainPostgresRlsSilentDenyDiagnostics()).toEqual([
      {
        filteredRows: 2,
        kind: 'owner-scope-filtered',
        message: 'kovo_owner_scope filtered 2 rows for principal u-missing.',
        principal: 'u-missing',
        table: 'orders',
      },
    ]);
  });

  it('keeps genuinely empty owner tables silent', async () => {
    const client = new PGlite();
    clients.push(client);
    await installOwnerScopedSchema(client);
    await client.query('delete from order_items');
    await client.query('delete from orders');
    const user = scopedClient(client, 'u1', { privilegedClient: client, tableName: 'orders' });

    await expect(orderIds(user)).resolves.toEqual([]);

    expect(drainPostgresRlsSilentDenyDiagnostics()).toEqual([]);
  });

  it('does not run the privileged recount when the scoped read has no principal', async () => {
    const log: string[] = [];
    type FakePostgresClient = {
      exec(statement: string): Promise<void>;
      query(statement: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
      transaction<Result>(callback: (tx: FakePostgresClient) => Promise<Result>): Promise<Result>;
    };
    const client: FakePostgresClient = {
      async transaction<Result>(callback: (tx: FakePostgresClient) => Promise<Result>) {
        log.push('transaction');
        return await callback(this);
      },
      exec(statement: string) {
        log.push(`exec:${statement}`);
        return Promise.resolve();
      },
      query(statement: string, params?: unknown[]) {
        log.push(`query:${statement}:${JSON.stringify(params ?? [])}`);
        return Promise.resolve({ rows: [] });
      },
    };
    const privilegedClient = {
      query() {
        throw new Error('principal-unset diagnostics must not recount');
      },
    };
    const anonymous = createPostgresScopedClient(client, {
      readOnly: true,
      role: APP_ROLE,
      rlsDiagnostics: { privilegedClient, tableName: 'orders' },
    });

    await expect(anonymous.query('select id from orders order by id')).resolves.toEqual({
      rows: [],
    });

    expect(log).toEqual([
      'transaction',
      'exec:SET LOCAL search_path = pg_catalog, public, pg_temp',
      'exec:SET TRANSACTION READ ONLY',
      `exec:SET LOCAL ROLE "${APP_ROLE}"`,
      'query:select id from orders order by id:[]',
    ]);
    expect(drainPostgresRlsSilentDenyDiagnostics()).toEqual([
      {
        kind: 'principal-unset',
        message: 'Postgres owner-scoped read returned 0 rows because no kovo.principal was set.',
        table: 'orders',
      },
    ]);
  });

  it('does not diagnose empty scoped reads in production', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const client = new PGlite();
    clients.push(client);
    try {
      await installOwnerScopedSchema(client);
      const missingOwner = scopedClient(client, 'u-missing', {
        privilegedClient: client,
        tableName: 'orders',
      });

      await expect(orderIds(missingOwner)).resolves.toEqual([]);

      expect(drainPostgresRlsSilentDenyDiagnostics()).toEqual([]);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});

function scopedClient(
  client: PGlite,
  principal: string | undefined,
  rlsDiagnostics?: PostgresScopedClientOptions['rlsDiagnostics'],
): PGlite {
  const options: { principal?: string | undefined; role: string } = { role: APP_ROLE };
  if (principal !== undefined) options.principal = principal;
  if (rlsDiagnostics !== undefined) {
    return createPostgresScopedClient(client, {
      ...options,
      readOnly: true,
      rlsDiagnostics,
    });
  }
  return createPostgresScopedClient(client, options);
}

function rawReadClient(client: PGlite, principal: string | undefined) {
  const scoped = scopedClient(client, principal);
  return readonlyDb(
    {
      query(statement: { sql: string; values?: unknown[] }) {
        return scoped.query(statement.sql, statement.values);
      },
    },
    {
      rawRead: {
        dialect: 'postgres',
        dialectLabel: 'PGlite',
        executeMethod: 'query',
        normalizeTableName: (table) => table,
      },
    },
  );
}

async function orderIds(client: PGlite): Promise<string[]> {
  const rows = await rowsOf<{ id: string }>(client.query('select id from orders order by id'));
  return rows.map((row) => row.id);
}

async function itemIds(client: PGlite): Promise<string[]> {
  const rows = await rowsOf<{ id: string }>(client.query('select id from order_items order by id'));
  return rows.map((row) => row.id);
}

async function rowsOf<Row>(result: Promise<{ rows: Row[] }>): Promise<Row[]> {
  return (await result).rows;
}

async function installOwnerScopedSchema(client: PGlite): Promise<void> {
  await client.exec(`CREATE ROLE ${APP_ROLE}`);
  await client.exec(
    'REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean) FROM PUBLIC',
  );
  await client.exec(`
    CREATE TABLE orders (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      label text NOT NULL
    );
    CREATE TABLE order_items (
      id text PRIMARY KEY,
      order_id text NOT NULL REFERENCES orders(id),
      label text NOT NULL
    );
    INSERT INTO orders (id, user_id, label) VALUES
      ('o1', 'u1', 'owner one'),
      ('o2', 'u2', 'owner two');
    INSERT INTO order_items (id, order_id, label) VALUES
      ('i1', 'o1', 'owner one child'),
      ('i2', 'o2', 'owner two child');
    ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE orders FORCE ROW LEVEL SECURITY;
    CREATE POLICY kovo_owner_scope ON orders
      FOR ALL TO ${APP_ROLE}
      USING (user_id = current_setting('kovo.principal', true))
      WITH CHECK (user_id = current_setting('kovo.principal', true));
    ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE order_items FORCE ROW LEVEL SECURITY;
    CREATE POLICY kovo_owner_via_scope ON order_items
      FOR ALL TO ${APP_ROLE}
      USING (
        EXISTS (
          SELECT 1 FROM orders
          WHERE orders.id = order_items.order_id
            AND orders.user_id = current_setting('kovo.principal', true)
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM orders
          WHERE orders.id = order_items.order_id
            AND orders.user_id = current_setting('kovo.principal', true)
        )
      );
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE orders TO ${APP_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE order_items TO ${APP_ROLE};
  `);
}
