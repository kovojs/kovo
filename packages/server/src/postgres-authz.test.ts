import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { createPostgresScopedClient } from './managed-db.js';

// SPEC §10.3/§11.1: Postgres/PGlite owner authorization is enforced by RLS on the
// proven owner principal, not by query-shape inspection. These tests use real
// PGlite so raw reads and write result counts are storage-engine behavior.

const APP_ROLE = 'kovo_app_test';

describe('Postgres/PGlite owner RLS runtime floor', () => {
  const clients: PGlite[] = [];

  afterEach(async () => {
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
    ).rejects.toThrow(/row-level security|violates/i);
    await expect(
      u1.query('update orders set user_id = $1 where id = $2', ['u2', 'o1']),
    ).rejects.toThrow(/row-level security|violates/i);

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

  it('binds the principal before role assumption and prevents SQL text from widening it', async () => {
    const client = new PGlite();
    clients.push(client);
    await installOwnerScopedSchema(client);
    const u1 = scopedClient(client, 'u1');

    await expect(
      u1.query("select pg_catalog.set_config('kovo.principal', $1, true)", ['u2']),
    ).rejects.toThrow(/permission denied|set_config/i);
    await expect(orderIds(u1)).resolves.toEqual(['o1']);

    await expect(
      u1.query('select id from orders; reset role; select id from orders'),
    ).rejects.toThrow();
    await expect(orderIds(u1)).resolves.toEqual(['o1']);
  });
});

function scopedClient(client: PGlite, principal: string | undefined): PGlite {
  const options: { principal?: string | undefined; role: string } = { role: APP_ROLE };
  if (principal !== undefined) options.principal = principal;
  return createPostgresScopedClient(client, options);
}

async function orderIds(client: PGlite): Promise<string[]> {
  const rows = await rowsOf<{ id: string }>(client.query('select id from orders order by id'));
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
    INSERT INTO orders (id, user_id, label) VALUES
      ('o1', 'u1', 'owner one'),
      ('o2', 'u2', 'owner two');
    ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE orders FORCE ROW LEVEL SECURITY;
    CREATE POLICY kovo_owner_scope ON orders
      FOR ALL TO ${APP_ROLE}
      USING (user_id = current_setting('kovo.principal', true))
      WITH CHECK (user_id = current_setting('kovo.principal', true));
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE orders TO ${APP_ROLE};
  `);
}
