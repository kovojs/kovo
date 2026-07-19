import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { frameworkScopedKey } from '@kovojs/core/internal/storage';
import { compareAndSet, kovo, sql } from '@kovojs/drizzle';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { bigint, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { Pool, type PoolClient, type QueryConfig, type QueryResultRow } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';

// @kovo-security-classifier-corpus postgres-identity-posture

vi.mock('@kovojs/better-auth/internal/server-mount-adapter', () => ({
  assertBetterAuthMountAdapter: vi.fn(),
  invokeBetterAuthMountAdapter: vi.fn(),
}));

import { actAsNonRequestPrincipal } from './auth-principal.js';
import { createDatabaseEgressSocket, EGRESS_BLOCKED_ERROR_NAME } from './egress.js';
import { installEgressFloorSync, registerEgressDatabaseUrl } from './egress-bootstrap.js';
import { guards } from './guards.js';
import { createBetterAuthPostgresRateLimitBucketConsumer } from './internal/better-auth.js';
import { createPostgresSystemDb, usePostgresAppRuntimeDb } from './internal/postgres-capability.js';
import {
  createPostgresReadonlyClient,
  createPostgresScopedClient,
  drainCrossOwnerReadAuditFacts,
  managedDb,
} from './managed-db.js';
import {
  checkPostgresAppDbPosture,
  createPostgresAppRuntimeDb,
  migratePostgresAppDb,
  provisionPostgresAppDb,
  type KovoPostgresAppRuntimeOptions,
} from './postgres-runtime.js';

const POSTGRES_BINARIES = ['initdb', 'postgres'] as const;
const probeToolchain = localPostgresToolchain();
const describeIfPostgres = probeToolchain.available ? describe : describe.skip;
const itIfPostgresTls = localBinaryAvailable('openssl') ? it : it.skip;

const probeNotes = pgTable(
  'kovo_ext_probe_notes',
  {
    classified: text('classified').notNull().default(''),
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    title: text('title').notNull(),
  },
  kovo({
    domain: 'external-postgres-probe-notes',
    key: 'id',
    owner: 'ownerId',
    secret: ['classified'],
  }),
);

const probeNotesV2 = pgTable(
  'kovo_ext_probe_notes',
  {
    classified: text('classified').notNull().default(''),
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    summary: text('summary'),
    title: text('title').notNull(),
  },
  kovo({
    domain: 'external-postgres-probe-notes',
    key: 'id',
    owner: 'ownerId',
    secret: ['classified'],
  }),
);

const schema = { probeNotes };
const evolvedSchema = { probeNotes: probeNotesV2 };
const guardAssertionProbeNotes = pgTable(
  'kovo_ext_guard_assertion_notes',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    title: text('title').notNull(),
  },
  kovo({
    authzPolicy: 'the request guard checks note ownership',
    domain: 'external-postgres-guard-assertion-notes',
    key: 'id',
  }),
);
const guardAssertionSchema = { guardAssertionProbeNotes };
const lostUpdateCounters = pgTable(
  'kovo_ext_lost_update_counters',
  {
    count: integer('count').notNull(),
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    version: integer('version').notNull(),
  },
  kovo({
    atomic: 'count',
    domain: 'external-postgres-lost-update-counter',
    key: 'id',
    owner: 'ownerId',
    version: 'version',
  }),
);
const lostUpdateSchema = { lostUpdateCounters };
const externalRateLimit = pgTable('rateLimit', {
  count: integer('count').notNull(),
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  lastRequest: bigint('lastRequest', { mode: 'number' }).notNull(),
});
const createNotesMigration = {
  id: '001-create-probe-notes.sql',
  sql: `
    CREATE TABLE kovo_ext_probe_notes (
      id text PRIMARY KEY,
      owner_id text NOT NULL,
      classified text NOT NULL DEFAULT '',
      title text NOT NULL
    );
  `,
};
const addSummaryMigration = {
  id: '002-add-note-summary.sql',
  sql: 'ALTER TABLE kovo_ext_probe_notes ADD COLUMN summary text;',
};
const createGuardAssertionNotesMigration = {
  id: '001-create-guard-assertion-notes.sql',
  sql: `
    CREATE TABLE kovo_ext_guard_assertion_notes (
      id text PRIMARY KEY,
      owner_id text NOT NULL,
      title text NOT NULL
    );
  `,
};
const createLostUpdateCountersMigration = {
  id: '001-create-lost-update-counters.sql',
  sql: `
    CREATE TABLE kovo_ext_lost_update_counters (
      id text PRIMARY KEY,
      owner_id text NOT NULL,
      count integer NOT NULL,
      version integer NOT NULL
    );
    INSERT INTO kovo_ext_lost_update_counters (id, owner_id, count, version)
      VALUES ('shared', 'counter-owner', 0, 0);
  `,
};

const probeRun = `kovo_ext_${process.pid}_${Date.now()}`;

function actAsProbePrincipal(principal: string) {
  return actAsNonRequestPrincipal(principal, {
    ingress: 'task',
    operation: 'write',
    surface: 'postgres-external-probe.test.ts',
  });
}

describeIfPostgres('external Postgres runtime/provisioning probes', () => {
  const roots: string[] = [];
  const clusters: LocalPostgresCluster[] = [];

  afterAll(async () => {
    await Promise.allSettled(clusters.splice(0).map((cluster) => cluster.stop()));
    for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
  });

  it('confines literal and hostname DB authority to pg sockets across reconnects', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-external-egress-pg-'));
    roots.push(root);
    const cluster = await startLocalPostgres(root);
    clusters.push(cluster);
    const literalUrl = cluster.url('postgres', 'postgres');
    const hostnameUrl = literalUrl.replace('@127.0.0.1:', '@localhost:');
    const floor = installEgressFloorSync({ allowInternal: [] }, () => {});

    try {
      for (const databaseUrl of [literalUrl, hostnameUrl]) {
        const unregister = registerEgressDatabaseUrl(databaseUrl);
        let streamCreations = 0;
        const pool = new Pool({
          connectionString: databaseUrl,
          max: 1,
          stream: () => {
            streamCreations += 1;
            return createDatabaseEgressSocket(databaseUrl);
          },
        });
        try {
          await expect(pool.query('SELECT 1 AS connected')).resolves.toMatchObject({
            rows: [{ connected: 1 }],
          });
          const firstClient = await pool.connect();
          firstClient.release(true);
          await expect(pool.query('SELECT 2 AS reconnected')).resolves.toMatchObject({
            rows: [{ reconnected: 2 }],
          });
          expect(streamCreations).toBeGreaterThanOrEqual(2);

          const endpoint = new URL(databaseUrl);
          const host = endpoint.hostname;
          const port = Number(endpoint.port);
          await expect(fetch(`http://${host}:${port}/`)).rejects.toSatisfy(hasEgressBlockedCause);
          await expect(connectRawSocket(host, port)).rejects.toMatchObject({
            name: EGRESS_BLOCKED_ERROR_NAME,
          });
          await expect(requestWithNodeHttp(host, port)).rejects.toMatchObject({
            name: EGRESS_BLOCKED_ERROR_NAME,
          });
        } finally {
          await pool.end();
          unregister();
        }
      }
    } finally {
      floor.uninstall();
    }
  }, 30_000);

  itIfPostgresTls(
    'uses certificate-and-hostname verified TLS through reconnects',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'kovo-external-egress-pg-tls-'));
      roots.push(root);
      const cluster = await startLocalPostgres(root, { tls: true });
      clusters.push(cluster);
      const cleartextUrl = cluster
        .url('postgres', 'postgres')
        .replace('@127.0.0.1:', '@localhost:');
      const cleartextPool = new Pool({ connectionString: cleartextUrl, max: 1 });
      try {
        // Reproduction control: a TLS-capable Postgres server still accepts plaintext when pg is
        // given no sslmode, so server capability alone does not protect credentials or queries.
        await expect(
          cleartextPool.query<{ tls: boolean }>(
            'SELECT ssl AS tls FROM pg_stat_ssl WHERE pid = pg_backend_pid()',
          ),
        ).resolves.toMatchObject({ rows: [{ tls: false }] });
      } finally {
        await cleartextPool.end();
      }

      const databaseUrl = `${cleartextUrl}?sslmode=verify-full&sslrootcert=${encodeURIComponent(
        cluster.certificatePath!,
      )}`;
      const ipLiteralUrl = `${cluster.url(
        'postgres',
        'postgres',
      )}?sslmode=verify-full&sslrootcert=${encodeURIComponent(cluster.certificatePath!)}`;
      const mismatchedHostnameUrl = `${cleartextUrl.replace(
        '@localhost:',
        '@wrong.localhost:',
      )}?sslmode=verify-full&sslrootcert=${encodeURIComponent(cluster.certificatePath!)}`;
      const unregister = registerEgressDatabaseUrl(databaseUrl);
      const unregisterIpLiteral = registerEgressDatabaseUrl(ipLiteralUrl);
      const unregisterMismatch = registerEgressDatabaseUrl(mismatchedHostnameUrl);
      const floor = installEgressFloorSync({ allowInternal: [] }, () => {});
      const ipLiteralPool = new Pool({
        connectionString: ipLiteralUrl,
        max: 1,
        stream: () => createDatabaseEgressSocket(ipLiteralUrl),
      });
      const mismatchedHostnamePool = new Pool({
        connectionString: mismatchedHostnameUrl,
        max: 1,
        stream: () => createDatabaseEgressSocket(mismatchedHostnameUrl),
      });
      let streamCreations = 0;
      const pool = new Pool({
        connectionString: databaseUrl,
        max: 1,
        stream: () => {
          streamCreations += 1;
          return createDatabaseEgressSocket(databaseUrl);
        },
      });

      try {
        // Pinned pg does not pass an IP literal as TLS servername, so even verify-full accepts a
        // CA-trusted CN=localhost certificate for 127.0.0.1. Kovo therefore refuses non-loopback
        // IP literals before pool creation and requires a DNS hostname for remote databases.
        await expect(
          ipLiteralPool.query<{ tls: boolean }>(
            'SELECT ssl AS tls FROM pg_stat_ssl WHERE pid = pg_backend_pid()',
          ),
        ).resolves.toMatchObject({ rows: [{ tls: true }] });

        // With a DNS hostname, pg does perform endpoint-identity validation.
        await expect(mismatchedHostnamePool.query('SELECT 1')).rejects.toMatchObject({
          code: 'ERR_TLS_CERT_ALTNAME_INVALID',
        });
        await expect(
          pool.query<{ tls: boolean }>(
            'SELECT ssl AS tls FROM pg_stat_ssl WHERE pid = pg_backend_pid()',
          ),
        ).resolves.toMatchObject({ rows: [{ tls: true }] });
        const firstClient = await pool.connect();
        firstClient.release(true);
        await expect(pool.query('SELECT 2 AS reconnected')).resolves.toMatchObject({
          rows: [{ reconnected: 2 }],
        });
        expect(streamCreations).toBeGreaterThanOrEqual(2);
      } finally {
        await ipLiteralPool.end();
        await mismatchedHostnamePool.end();
        await pool.end();
        floor.uninstall();
        unregisterMismatch();
        unregisterIpLiteral();
        unregister();
      }
    },
    30_000,
  );

  it('keeps the bounded Better Auth upsert atomic without dual-unique 23505 failures', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-external-better-auth-rate-limit-'));
    roots.push(root);
    const cluster = await startLocalPostgres(root);
    clusters.push(cluster);
    const pool = new Pool({ connectionString: cluster.url('postgres', 'postgres') });
    try {
      await pool.query(`
        CREATE TABLE "rateLimit" (
          "id" text PRIMARY KEY,
          "key" text NOT NULL UNIQUE,
          "count" integer NOT NULL,
          "lastRequest" bigint NOT NULL
        )
      `);
      const database = drizzle({ client: pool });
      const systemDb = createPostgresSystemDb(database);
      const first = createBetterAuthPostgresRateLimitBucketConsumer(systemDb, externalRateLimit);
      const second = createBetterAuthPostgresRateLimitBucketConsumer(systemDb, externalRateLimit);
      const input = {
        bucketKey: frameworkScopedKey('better-auth-rate-limit', '0042'),
        max: 3,
        windowMs: 10_000,
      } as const;

      const decisions = await Promise.all(
        Array.from({ length: 20 }, (_, index) => (index % 2 === 0 ? first(input) : second(input))),
      );
      const rows = await pool.query<{
        count: number;
        id: string;
        key: string;
      }>('SELECT "id", "key", "count" FROM "rateLimit"');

      expect(decisions.filter(Boolean)).toHaveLength(3);
      expect(decisions.filter((allowed) => !allowed)).toHaveLength(17);
      expect(rows.rows).toEqual([
        expect.objectContaining({
          count: 3,
          id: expect.stringMatching(/^[0-9a-f-]{36}$/u),
          key: '18:kovo-scoped-key-v16:system22:better-auth-rate-limit4:0042',
        }),
      ]);
    } finally {
      await pool.end();
    }
  }, 30_000);

  it('witnesses runtime current_user on standalone and boot split-authority posture paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-external-posture-identity-'));
    roots.push(root);
    const cluster = await startLocalPostgres(root);
    clusters.push(cluster);
    const database = `${probeRun}_identity`;
    const adminRole = `${probeRun}_identity_admin`;
    const runtimeRole = `${probeRun}_identity_runtime`;
    const superPool = await connect(cluster.url('postgres', 'postgres'));
    try {
      await superPool.query(`CREATE ROLE ${quoteIdent(adminRole)} LOGIN CREATEROLE NOBYPASSRLS`);
      await superPool.query(
        `CREATE ROLE ${quoteIdent(runtimeRole)} LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS`,
      );
      await superPool.query(
        `CREATE DATABASE ${quoteIdent(database)} OWNER ${quoteIdent(adminRole)}`,
      );
    } finally {
      await superPool.end();
    }

    const adminDatabaseUrl = cluster.url(database, adminRole);
    const runtimeDatabaseUrl = cluster.url(database, runtimeRole);
    const migrated = await migratePostgresAppDb({
      databaseUrl: adminDatabaseUrl,
      migrations: [createNotesMigration],
      runtimeDatabaseUrl,
      schema,
    });
    expect(migrated.posture.ok, JSON.stringify(migrated.posture.issues)).toBe(true);

    await withPool(cluster.url(database, 'postgres'), async (pool) => {
      await pool.query(`GRANT kovo_admin TO ${quoteIdent(runtimeRole)}`);
    });
    const assumedAdminRuntimeUrl = `${runtimeDatabaseUrl}?options=${encodeURIComponent(
      '-c role=kovo_admin',
    )}`;
    await expectStandalonePostureWitnessesAuthenticatedRuntimeConnection(
      assumedAdminRuntimeUrl,
      adminDatabaseUrl,
    );
    await expectBootPostureWitnessesAuthenticatedRuntimeConnection(
      assumedAdminRuntimeUrl,
      adminDatabaseUrl,
    );
  }, 30_000);

  it('races declared-version read-decide-write handlers under real Postgres READ COMMITTED', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-external-lost-update-'));
    roots.push(root);
    const cluster = await startLocalPostgres(root);
    clusters.push(cluster);
    const database = `${probeRun}_lost_update`;
    const adminRole = `${probeRun}_lost_update_admin`;
    const runtimeRole = `${probeRun}_lost_update_runtime`;
    await withPool(cluster.url('postgres', 'postgres'), async (pool) => {
      await pool.query(`CREATE ROLE ${quoteIdent(adminRole)} LOGIN CREATEROLE NOBYPASSRLS`);
      await pool.query(
        `CREATE ROLE ${quoteIdent(runtimeRole)} LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS`,
      );
      await pool.query(`CREATE DATABASE ${quoteIdent(database)} OWNER ${quoteIdent(adminRole)}`);
    });

    const adminDatabaseUrl = cluster.url(database, adminRole);
    const runtimeDatabaseUrl = cluster.url(database, runtimeRole);
    const migrated = await migratePostgresAppDb({
      databaseUrl: adminDatabaseUrl,
      migrations: [createLostUpdateCountersMigration],
      runtimeDatabaseUrl,
      schema: lostUpdateSchema,
    });
    expect(migrated.posture.ok, JSON.stringify(migrated.posture.issues)).toBe(true);

    const pool = new Pool({ connectionString: runtimeDatabaseUrl, max: 2 });
    try {
      const runtimeClient = new TestNodePostgresRuntimeClient(pool);
      const clients = [
        createPostgresScopedClient(runtimeClient, {
          principal: 'counter-owner',
          role: 'kovo_writer',
        }),
        createPostgresScopedClient(runtimeClient, {
          principal: 'counter-owner',
          role: 'kovo_writer',
        }),
      ] as const;
      let readersAtBarrier = 0;
      let releaseBarrier: () => void = () => undefined;
      const bothRead = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });
      const waitForBothReads = async (): Promise<void> => {
        readersAtBarrier += 1;
        if (readersAtBarrier === 2) releaseBarrier();
        await bothRead;
      };

      const attempt = async (clientIndex: 0 | 1, amount: number) =>
        clients[clientIndex].transaction(async (tx) => {
          const isolation = await tx.query<{ transaction_isolation: string }>(
            "SELECT pg_catalog.current_setting('transaction_isolation') AS transaction_isolation",
          );
          expect(isolation.rows).toEqual([{ transaction_isolation: 'read committed' }]);
          const before = await tx.query<{ count: number; version: number }>(
            'SELECT count, version FROM kovo_ext_lost_update_counters WHERE id = $1',
            ['shared'],
          );
          const snapshot = before.rows[0];
          if (snapshot === undefined) throw new Error('versioned counter disappeared');
          await waitForBothReads();
          const cas = await compareAndSet(
            tx.query(
              [
                'UPDATE kovo_ext_lost_update_counters',
                'SET count = $1, version = $2',
                'WHERE id = $3 AND version = $4',
              ].join(' '),
              [snapshot.count + amount, snapshot.version + 1, 'shared', snapshot.version],
            ),
          );
          return { amount, cas, clientIndex };
        });

      const attempts = await Promise.all([attempt(0, 10), attempt(1, 1)]);
      expect(attempts.filter((result) => result.cas.ok)).toHaveLength(1);
      const conflicted = attempts.find((result) => !result.cas.ok);
      if (conflicted === undefined) throw new Error('the version race did not produce a conflict');

      const retry = await clients[conflicted.clientIndex].transaction(async (tx) => {
        const current = await tx.query<{ count: number; version: number }>(
          'SELECT count, version FROM kovo_ext_lost_update_counters WHERE id = $1',
          ['shared'],
        );
        const snapshot = current.rows[0];
        if (snapshot === undefined) throw new Error('versioned counter disappeared before retry');
        return compareAndSet(
          tx.query(
            [
              'UPDATE kovo_ext_lost_update_counters',
              'SET count = $1, version = $2',
              'WHERE id = $3 AND version = $4',
            ].join(' '),
            [snapshot.count + conflicted.amount, snapshot.version + 1, 'shared', snapshot.version],
          ),
        );
      });
      expect(retry).toEqual({ ok: true });

      const final = await clients[0].query<{ count: number; version: number }>(
        'SELECT count, version FROM kovo_ext_lost_update_counters WHERE id = $1',
        ['shared'],
      );
      expect(final.rows).toEqual([{ count: 11, version: 2 }]);
    } finally {
      await pool.end();
    }
  }, 30_000);

  it('rejects privileged startup settings before they can disable runtime enforcement', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-external-posture-settings-'));
    roots.push(root);
    const cluster = await startLocalPostgres(root);
    clusters.push(cluster);
    const database = `${probeRun}_settings`;
    const adminRole = `${probeRun}_settings_admin`;
    const runtimeRole = `${probeRun}_settings_runtime`;
    await withPool(cluster.url('postgres', 'postgres'), async (pool) => {
      await pool.query(`CREATE ROLE ${quoteIdent(adminRole)} LOGIN CREATEROLE NOBYPASSRLS`);
      await pool.query(
        `CREATE ROLE ${quoteIdent(runtimeRole)} LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS`,
      );
      await pool.query(`CREATE DATABASE ${quoteIdent(database)} OWNER ${quoteIdent(adminRole)}`);
    });
    const adminDatabaseUrl = cluster.url(database, adminRole);
    const runtimeDatabaseUrl = cluster.url(database, runtimeRole);
    const provisioned = await migratePostgresAppDb({
      databaseUrl: adminDatabaseUrl,
      migrations: [createNotesMigration],
      runtimeDatabaseUrl,
      schema,
    });
    expect(provisioned.posture.ok, JSON.stringify(provisioned.posture.issues)).toBe(true);

    await withPool(cluster.url(database, 'postgres'), async (pool) => {
      await pool.query('CREATE TABLE posture_parent (id integer PRIMARY KEY)');
      await pool.query(
        'CREATE TABLE posture_child (parent_id integer REFERENCES posture_parent(id))',
      );
      await pool.query(`GRANT INSERT ON posture_child TO ${quoteIdent(runtimeRole)}`);
      await pool.query(
        `ALTER ROLE ${quoteIdent(runtimeRole)} SET session_replication_role = replica`,
      );
    });

    // PostgreSQL applies this superuser-authored role setting to the non-superuser login. The
    // reproduction is an invalid FK insert that succeeds because replica mode suppresses the
    // constraint trigger; Kovo must reject the session before any framework SQL can run.
    await withPool(runtimeDatabaseUrl, async (pool) => {
      await expect(pool.query('SHOW session_replication_role')).resolves.toMatchObject({
        rows: [{ session_replication_role: 'replica' }],
      });
      await expect(
        pool.query('INSERT INTO posture_child (parent_id) VALUES (404)'),
      ).resolves.toBeDefined();
    });
    await expectRuntimeSettingPostureFailure(runtimeDatabaseUrl, adminDatabaseUrl, {
      name: 'session_replication_role',
      value: 'replica',
    });
    const unsafeRuntime = createPostgresAppRuntimeDb({
      adminDatabaseUrl,
      databaseUrl: runtimeDatabaseUrl,
      schema,
    });
    try {
      await expect(unsafeRuntime.ready).rejects.toThrow(
        /session_replication_role.*origin.*replica/u,
      );
    } finally {
      await unsafeRuntime.close();
    }

    await withPool(cluster.url(database, 'postgres'), async (pool) => {
      await pool.query(`ALTER ROLE ${quoteIdent(runtimeRole)} RESET session_replication_role`);
      await pool.query(`ALTER ROLE ${quoteIdent(runtimeRole)} SET row_security = off`);
    });
    await expectRuntimeSettingPostureFailure(runtimeDatabaseUrl, adminDatabaseUrl, {
      name: 'row_security',
      value: 'off',
    });

    await withPool(cluster.url(database, 'postgres'), async (pool) => {
      await pool.query(`ALTER ROLE ${quoteIdent(runtimeRole)} RESET row_security`);
      await pool.query(`ALTER DATABASE ${quoteIdent(database)} SET search_path = public`);
    });
    await expectRuntimeSettingPostureFailure(runtimeDatabaseUrl, adminDatabaseUrl, {
      name: 'search_path',
      value: 'database',
    });

    await withPool(cluster.url(database, 'postgres'), async (pool) => {
      await pool.query(`ALTER DATABASE ${quoteIdent(database)} RESET search_path`);
      await pool.query(
        `ALTER ROLE ${quoteIdent(runtimeRole)} IN DATABASE ${quoteIdent(database)} SET transform_null_equals = on`,
      );
    });
    await expectRuntimeSettingPostureFailure(runtimeDatabaseUrl, adminDatabaseUrl, {
      name: 'transform_null_equals',
      value: 'on',
    });
  }, 60_000);

  it('pins the whole pre-reset witness under hostile search_path shadow objects', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-external-posture-search-path-'));
    roots.push(root);
    const cluster = await startLocalPostgres(root);
    clusters.push(cluster);
    const database = `${probeRun}_shadow`;
    const adminRole = `${probeRun}_shadow_admin`;
    const runtimeRole = `${probeRun}_shadow_runtime`;
    await withPool(cluster.url('postgres', 'postgres'), async (pool) => {
      await pool.query(`CREATE ROLE ${quoteIdent(adminRole)} LOGIN CREATEROLE NOBYPASSRLS`);
      await pool.query(
        `CREATE ROLE ${quoteIdent(runtimeRole)} LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS`,
      );
      await pool.query(`CREATE DATABASE ${quoteIdent(database)} OWNER ${quoteIdent(adminRole)}`);
    });
    const adminDatabaseUrl = cluster.url(database, adminRole);
    const runtimeDatabaseUrl = cluster.url(database, runtimeRole);
    const provisioned = await migratePostgresAppDb({
      databaseUrl: adminDatabaseUrl,
      migrations: [createNotesMigration],
      runtimeDatabaseUrl,
      schema,
    });
    expect(provisioned.posture.ok, JSON.stringify(provisioned.posture.issues)).toBe(true);

    await withPool(cluster.url(database, 'postgres'), async (pool) => {
      await pool.query(`
        CREATE FUNCTION public.current_setting(pg_catalog.text)
        RETURNS pg_catalog.text LANGUAGE sql IMMUTABLE
        AS 'SELECT ''origin''::pg_catalog.text'
      `);
      await pool.query('CREATE DOMAIN public.text AS pg_catalog.text');
      await pool.query(`
        CREATE FUNCTION public.kovo_name_text_equal(pg_catalog.name, pg_catalog.text)
        RETURNS pg_catalog.bool LANGUAGE sql IMMUTABLE AS 'SELECT true'
      `);
      await pool.query(`
        CREATE OPERATOR public.= (
          FUNCTION = public.kovo_name_text_equal,
          LEFTARG = pg_catalog.name,
          RIGHTARG = pg_catalog.text
        )
      `);
    });

    const hostileRuntimeUrl = `${runtimeDatabaseUrl}?options=${encodeURIComponent(
      '-c search_path=public,pg_catalog',
    )}`;
    const report = await checkPostgresAppDbPosture({
      adminDatabaseUrl,
      databaseUrl: hostileRuntimeUrl,
      schema,
    });
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'KV433_RUNTIME_SETTING',
        detail: expect.stringContaining('search_path'),
      }),
    ]);
  }, 30_000);

  it('binds split posture authority to the same live database and writable cluster', async () => {
    const firstRoot = mkdtempSync(join(tmpdir(), 'kovo-external-posture-binding-a-'));
    const secondRoot = mkdtempSync(join(tmpdir(), 'kovo-external-posture-binding-b-'));
    roots.push(firstRoot, secondRoot);
    const firstCluster = await startLocalPostgres(firstRoot);
    const secondCluster = await startLocalPostgres(secondRoot);
    clusters.push(firstCluster, secondCluster);
    const firstDatabase = `${probeRun}_binding_a`;
    const secondDatabase = `${probeRun}_binding_b`;
    const siblingDatabase = `${probeRun}_binding_sibling`;
    const adminRole = `${probeRun}_binding_admin`;
    const runtimeRole = `${probeRun}_binding_runtime`;

    for (const cluster of [firstCluster, secondCluster]) {
      await withPool(cluster.url('postgres', 'postgres'), async (pool) => {
        await pool.query(`CREATE ROLE ${quoteIdent(adminRole)} LOGIN CREATEROLE NOBYPASSRLS`);
        await pool.query(
          `CREATE ROLE ${quoteIdent(runtimeRole)} LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS`,
        );
      });
    }
    await withPool(firstCluster.url('postgres', 'postgres'), async (pool) => {
      await pool.query(
        `CREATE DATABASE ${quoteIdent(firstDatabase)} OWNER ${quoteIdent(adminRole)}`,
      );
      await pool.query(
        `CREATE DATABASE ${quoteIdent(siblingDatabase)} OWNER ${quoteIdent(adminRole)}`,
      );
    });
    await withPool(secondCluster.url('postgres', 'postgres'), async (pool) => {
      await pool.query(
        `CREATE DATABASE ${quoteIdent(secondDatabase)} OWNER ${quoteIdent(adminRole)}`,
      );
    });

    const firstAdminUrl = firstCluster.url(firstDatabase, adminRole);
    const firstRuntimeUrl = firstCluster.url(firstDatabase, runtimeRole);
    const siblingAdminUrl = firstCluster.url(siblingDatabase, adminRole);
    const siblingRuntimeUrl = firstCluster.url(siblingDatabase, runtimeRole);
    const secondAdminUrl = secondCluster.url(secondDatabase, adminRole);
    const secondRuntimeUrl = secondCluster.url(secondDatabase, runtimeRole);
    for (const [databaseUrl, runtimeDatabaseUrl] of [
      [firstAdminUrl, firstRuntimeUrl],
      [siblingAdminUrl, siblingRuntimeUrl],
      [secondAdminUrl, secondRuntimeUrl],
    ] as const) {
      const provisioned = await migratePostgresAppDb({
        databaseUrl,
        migrations: [createNotesMigration],
        runtimeDatabaseUrl,
        schema,
      });
      expect(provisioned.posture.ok, JSON.stringify(provisioned.posture.issues)).toBe(true);
    }

    await expectDatabaseIdentityPostureFailure(firstRuntimeUrl, secondAdminUrl);
    await expectDatabaseIdentityPostureFailure(firstRuntimeUrl, siblingAdminUrl);

    await withPool(secondCluster.url(secondDatabase, 'postgres'), async (pool) => {
      await pool.query('ALTER ROLE kovo_system LOGIN');
    });
    const wrongSystemUrl = secondCluster.url(secondDatabase, 'kovo_system');
    const systemPreferred = await checkPostgresAppDbPosture({
      adminDatabaseUrl: firstAdminUrl,
      databaseUrl: firstRuntimeUrl,
      schema,
      systemDatabaseUrl: wrongSystemUrl,
    });
    expect(systemPreferred.ok).toBe(false);
    expect(systemPreferred.issues).toEqual([
      expect.objectContaining({ code: 'KV433_DATABASE_IDENTITY' }),
    ]);

    await withPool(firstCluster.url(firstDatabase, 'postgres'), async (pool) => {
      await pool.query('REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM PUBLIC');
      await pool.query('REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_checkpoint() FROM PUBLIC');
    });
    const unavailableOracle = await checkPostgresAppDbPosture({
      adminDatabaseUrl: firstAdminUrl,
      databaseUrl: firstRuntimeUrl,
      schema,
    });
    expect(unavailableOracle.ok).toBe(false);
    expect(unavailableOracle.issues).toEqual([
      expect.objectContaining({
        code: 'KV433_DATABASE_IDENTITY',
        detail: expect.stringContaining('identity oracles'),
      }),
    ]);
  }, 90_000);

  it('proves split provisioning, adopted roles, fail-closed posture, and pg Pool scope reset', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-external-postgres-probe-'));
    roots.push(root);
    const cluster = await startLocalPostgres(root);
    clusters.push(cluster);
    const admin = await connect(cluster.url('postgres', 'postgres'));

    const defaultDb = `${probeRun}_default`;
    const adoptedDb = `${probeRun}_adopted`;
    const guardAssertionDb = `${probeRun}_guard_assertion`;
    const staleDb = `${probeRun}_stale`;
    const defaultAdmin = `${probeRun}_admin`;
    const defaultRuntime = `${probeRun}_runtime`;
    const adminMemberRuntime = `${probeRun}_admin_member_runtime`;
    const adoptedAdmin = `${probeRun}_adopt_admin`;
    const adoptedRuntime = `${probeRun}_adopt_runtime`;
    const adoptedReader = `${probeRun}_reader`;
    const adoptedSystem = `${probeRun}_system`;
    const adoptedWriter = `${probeRun}_writer`;
    const staleRuntimeRole = `${probeRun}_stale_runtime`;

    try {
      await admin.query(`CREATE ROLE ${quoteIdent(defaultAdmin)} LOGIN CREATEROLE NOBYPASSRLS`);
      await admin.query(
        `CREATE ROLE ${quoteIdent(defaultRuntime)} LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS`,
      );
      await admin.query(
        `CREATE ROLE ${quoteIdent(adminMemberRuntime)} LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS`,
      );
      await admin.query(
        `CREATE DATABASE ${quoteIdent(defaultDb)} OWNER ${quoteIdent(defaultAdmin)}`,
      );
      await admin.query(
        `CREATE DATABASE ${quoteIdent(guardAssertionDb)} OWNER ${quoteIdent(defaultAdmin)}`,
      );

      await admin.query(
        `CREATE ROLE ${quoteIdent(adoptedAdmin)} LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS`,
      );
      await admin.query(
        `CREATE ROLE ${quoteIdent(adoptedRuntime)} LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS`,
      );
      await admin.query(`CREATE ROLE ${quoteIdent(adoptedReader)} NOBYPASSRLS`);
      await admin.query(`CREATE ROLE ${quoteIdent(adoptedSystem)} NOBYPASSRLS`);
      await admin.query(`CREATE ROLE ${quoteIdent(adoptedWriter)} NOBYPASSRLS`);
      await admin.query(`GRANT ${quoteIdent(adoptedReader)} TO ${quoteIdent(adoptedRuntime)}`);
      await admin.query(`GRANT ${quoteIdent(adoptedWriter)} TO ${quoteIdent(adoptedRuntime)}`);
      await admin.query(
        `CREATE DATABASE ${quoteIdent(adoptedDb)} OWNER ${quoteIdent(adoptedAdmin)}`,
      );

      await admin.query(
        `CREATE ROLE ${quoteIdent(staleRuntimeRole)} LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS`,
      );
      await admin.query(`CREATE DATABASE ${quoteIdent(staleDb)} OWNER postgres`);
    } finally {
      await admin.end();
    }

    const defaultAdminUrl = cluster.url(defaultDb, defaultAdmin);
    const defaultRuntimeUrl = cluster.url(defaultDb, defaultRuntime);
    await expect(
      migratePostgresAppDb({
        databaseUrl: cluster.url(guardAssertionDb, defaultAdmin),
        migrations: [createGuardAssertionNotesMigration],
        runtimeDatabaseUrl: cluster.url(guardAssertionDb, defaultRuntime),
        schema: guardAssertionSchema,
      }),
    ).rejects.toThrow(/KV433_AUTHZ_POLICY_UNSUPPORTED.*string guard assertion.*RLS/u);
    const defaultMigrationReport = await migratePostgresAppDb({
      crossOwnerReadTables: ['kovo_ext_probe_notes'],
      databaseUrl: defaultAdminUrl,
      migrations: [createNotesMigration],
      runtimeDatabaseUrl: defaultRuntimeUrl,
      schema,
    });
    expect(defaultMigrationReport.applied).toEqual(['001-create-probe-notes.sql']);
    expect(defaultMigrationReport.skipped).toEqual([]);
    expect(defaultMigrationReport.posture.ok).toBe(true);
    expect(defaultMigrationReport.posture.issues).toEqual([]);

    const defaultReport = await provisionPostgresAppDb({
      crossOwnerReadTables: ['kovo_ext_probe_notes'],
      databaseUrl: defaultAdminUrl,
      runtimeDatabaseUrl: defaultRuntimeUrl,
      schema,
    });
    expect(defaultReport.ok).toBe(true);
    expect(defaultReport.issues).toEqual([]);
    await expectRuntimeIdentityClosure(defaultRuntimeUrl, {
      allowedRoles: ['kovo_reader', 'kovo_writer'],
      deniedRoles: ['kovo_admin', 'postgres'],
    });

    await withPool(cluster.url(defaultDb, 'postgres'), async (superPool) => {
      await superPool.query(`GRANT kovo_admin TO ${quoteIdent(adminMemberRuntime)}`);
    });
    await expectLeastPrivilegeRuntimeFailure(cluster.url(defaultDb, 'postgres'));
    await expectLeastPrivilegeRuntimeFailure(cluster.url(defaultDb, adminMemberRuntime));
    await expectLeastPrivilegeRuntimePostureFailure(cluster.url(defaultDb, 'postgres'));
    await expectLeastPrivilegeRuntimePostureFailure(cluster.url(defaultDb, adminMemberRuntime));
    await expectPermissionDenied(
      defaultRuntimeUrl,
      `CREATE ROLE ${quoteIdent(`${probeRun}_blocked_role`)}`,
    );
    await expectPermissionDenied(
      defaultRuntimeUrl,
      'ALTER TABLE kovo_ext_probe_notes FORCE ROW LEVEL SECURITY',
    );

    const defaultMigrationReportAgain = await migratePostgresAppDb({
      crossOwnerReadTables: ['kovo_ext_probe_notes'],
      databaseUrl: defaultAdminUrl,
      migrations: [createNotesMigration],
      runtimeDatabaseUrl: defaultRuntimeUrl,
      schema,
    });
    expect(defaultMigrationReportAgain.applied).toEqual([]);
    expect(defaultMigrationReportAgain.skipped).toEqual(['001-create-probe-notes.sql']);
    expect(defaultMigrationReportAgain.posture.ok).toBe(true);
    expect(defaultMigrationReportAgain.posture.issues).toEqual([]);

    await expect(
      migratePostgresAppDb({
        crossOwnerReadTables: ['kovo_ext_probe_notes'],
        databaseUrl: defaultAdminUrl,
        migrations: [{ ...createNotesMigration, sql: `${createNotesMigration.sql}\nSELECT 1;` }],
        schema,
      }),
    ).rejects.toThrow(/KV433_MIGRATION_CHECKSUM/);

    const defaultReportAgain = await provisionPostgresAppDb({
      crossOwnerReadTables: ['kovo_ext_probe_notes'],
      databaseUrl: defaultAdminUrl,
      runtimeDatabaseUrl: defaultRuntimeUrl,
      schema,
    });
    expect(defaultReportAgain.ok).toBe(true);
    expect(defaultReportAgain.issues).toEqual([]);

    await expectOwnerIsolation(defaultRuntimeUrl, {
      adminDatabaseUrl: defaultAdminUrl,
      crossOwnerReadTables: ['kovo_ext_probe_notes'],
    });
    await expectRawRuntimeReconnectHarmless(defaultRuntimeUrl);
    await expectPooledScopeDoesNotLeak(defaultRuntimeUrl, 'kovo_writer');
    await expectSecretColumnsDenied(defaultRuntimeUrl, 'kovo_reader', 'kovo_admin');
    await withPool(cluster.url(defaultDb, 'postgres'), async (superPool) => {
      await superPool.query(`GRANT kovo_admin TO ${quoteIdent(defaultAdmin)} WITH SET TRUE`);
    });
    await expectCrossOwnerRead(defaultRuntimeUrl, defaultAdminUrl);
    await expectSchemaEvolutionWithData(defaultAdminUrl, defaultRuntimeUrl);
    await expectUnexpectedCatalogPrivilegesRefuse(
      defaultRuntimeUrl,
      cluster.url(defaultDb, 'postgres'),
    );

    await expectPermissionDenied(
      cluster.url(adoptedDb, adoptedAdmin),
      `CREATE ROLE ${quoteIdent(`${probeRun}_blocked_adopted_role`)}`,
    );
    await withAdoptedRoleEnv(
      { admin: adoptedAdmin, reader: adoptedReader, system: adoptedSystem, writer: adoptedWriter },
      async () => {
        const adoptedReport = await provisionPostgresAppDb({
          databaseUrl: cluster.url(adoptedDb, adoptedAdmin),
          migrations: [createNotesMigration],
          runtimeDatabaseUrl: cluster.url(adoptedDb, adoptedRuntime),
          schema,
        });
        expect(adoptedReport.ok, JSON.stringify(adoptedReport.issues)).toBe(true);
        expect(adoptedReport.issues).toEqual([]);
        await expectOwnerIsolation(cluster.url(adoptedDb, adoptedRuntime), {
          adminDatabaseUrl: cluster.url(adoptedDb, adoptedAdmin),
          readerRole: adoptedReader,
          writerRole: adoptedWriter,
        });
        await expectPooledScopeDoesNotLeak(cluster.url(adoptedDb, adoptedRuntime), adoptedWriter);
      },
    );

    await withPool(cluster.url(staleDb, 'postgres'), async (superPool) => {
      await superPool.query(createNotesMigration.sql);
      await superPool.query(
        `GRANT SELECT ON TABLE kovo_ext_probe_notes TO ${quoteIdent(staleRuntimeRole)}`,
      );
    });
    const staleReport = await checkPostgresAppDbPosture({
      databaseUrl: cluster.url(staleDb, staleRuntimeRole),
      schema,
    });
    expect(staleReport.ok).toBe(false);
    expect(staleReport.issues).toEqual([
      expect.objectContaining({ code: 'KV433_DATABASE_IDENTITY' }),
    ]);
    const staleRuntime = createPostgresAppRuntimeDb({
      databaseUrl: cluster.url(staleDb, staleRuntimeRole),
      schema,
    });
    try {
      await expect(staleRuntime.ready).rejects.toThrow(/KV433.*run `kovo db provision`|KV433/);
    } finally {
      await staleRuntime.close();
    }
  }, 120_000);
});

async function expectOwnerIsolation(
  databaseUrl: string,
  options: Pick<
    KovoPostgresAppRuntimeOptions,
    'adminDatabaseUrl' | 'crossOwnerReadTables' | 'readerRole' | 'writerRole'
  >,
): Promise<void> {
  const runtime = createPostgresAppRuntimeDb({
    ...options,
    databaseUrl,
    schema,
  });
  try {
    await runtime.ready;
    const u1Db = usePostgresAppRuntimeDb(runtime, { principalPosture: actAsProbePrincipal('u1') });
    const u2Db = usePostgresAppRuntimeDb(runtime, { principalPosture: actAsProbePrincipal('u2') });

    await u1Db
      .insert(probeNotes)
      .values({ classified: 'secret-one', id: 'u1-note', ownerId: 'u1', title: 'One' });
    await u2Db
      .insert(probeNotes)
      .values({ classified: 'secret-two', id: 'u2-note', ownerId: 'u2', title: 'Two' });
    const publicColumns = {
      id: probeNotes.id,
      ownerId: probeNotes.ownerId,
      title: probeNotes.title,
    };
    await expect(
      u1Db.select(publicColumns).from(probeNotes).orderBy(probeNotes.id),
    ).resolves.toEqual([{ id: 'u1-note', ownerId: 'u1', title: 'One' }]);
    await expect(
      u2Db.select(publicColumns).from(probeNotes).orderBy(probeNotes.id),
    ).resolves.toEqual([{ id: 'u2-note', ownerId: 'u2', title: 'Two' }]);
    await expect(
      u1Db.select(publicColumns).from(probeNotes).where(eq(probeNotes.ownerId, 'u2')),
    ).resolves.toEqual([]);
  } finally {
    await runtime.close();
  }
}

async function expectRawRuntimeReconnectHarmless(databaseUrl: string): Promise<void> {
  await withPool(databaseUrl, async (pool) => {
    try {
      const result = await pool.query('SELECT id FROM kovo_ext_probe_notes ORDER BY id');
      expect(result.rows).toEqual([]);
    } catch (error) {
      expect(error).toMatchObject({ code: '42501' });
    }
  });
}

async function expectLeastPrivilegeRuntimeFailure(databaseUrl: string): Promise<void> {
  const runtime = createPostgresAppRuntimeDb({
    databaseUrl,
    schema,
  });
  try {
    await expect(runtime.ready).rejects.toThrow(/runtime must be a least-privilege login role/);
  } finally {
    await runtime.close();
  }
}

async function expectLeastPrivilegeRuntimePostureFailure(databaseUrl: string): Promise<void> {
  const report = await checkPostgresAppDbPosture({
    crossOwnerReadTables: ['kovo_ext_probe_notes'],
    databaseUrl,
    schema,
  });
  expect(report.ok).toBe(false);
  expect(report.issues).toHaveLength(1);
  expect(report.issues[0]?.code).toBe('KV433_RUNTIME_ROLE');
  expect(report.issues[0]?.detail).toMatch(
    /runtime login .* (must have no elevated role attributes|must not be able to SET ROLE to adminRole=)/,
  );
}

async function expectStandalonePostureWitnessesAuthenticatedRuntimeConnection(
  databaseUrl: string,
  adminDatabaseUrl: string,
): Promise<void> {
  // SPEC §10.3: the ordinary connection, rather than the URL parser or privileged posture pool,
  // owns the runtime-identity witness. A startup role setting makes current_user observably differ
  // from the authority username and proves standalone check inspects that live session.
  const report = await checkPostgresAppDbPosture({
    adminDatabaseUrl,
    databaseUrl,
    schema,
  });
  expect(report.ok).toBe(false);
  expect(report.issues).toHaveLength(1);
  expect(report.issues[0]).toMatchObject({
    code: 'KV433_RUNTIME_ROLE',
    detail: expect.stringContaining(
      'runtime connection current_user kovo_admin must match authenticated session_user',
    ),
  });
  expect(report.roleTopology.runtimeLogin).toBe('kovo_admin');
}

async function expectBootPostureWitnessesAuthenticatedRuntimeConnection(
  databaseUrl: string,
  adminDatabaseUrl: string,
): Promise<void> {
  const runtime = createPostgresAppRuntimeDb({ adminDatabaseUrl, databaseUrl, schema });
  try {
    await expect(runtime.ready).rejects.toThrow(
      /runtime connection current_user kovo_admin must match authenticated session_user/,
    );
  } finally {
    await runtime.close();
  }
}

async function expectRuntimeSettingPostureFailure(
  databaseUrl: string,
  adminDatabaseUrl: string,
  expected: { name: string; value: string },
): Promise<void> {
  const report = await checkPostgresAppDbPosture({ adminDatabaseUrl, databaseUrl, schema });
  expect(report.ok).toBe(false);
  expect(report.issues).toEqual([
    expect.objectContaining({
      code: 'KV433_RUNTIME_SETTING',
      detail: expect.stringMatching(
        new RegExp(`${expected.name}.*${expected.value}|${expected.value}.*${expected.name}`, 'u'),
      ),
    }),
  ]);
}

async function expectDatabaseIdentityPostureFailure(
  databaseUrl: string,
  adminDatabaseUrl: string,
): Promise<void> {
  const report = await checkPostgresAppDbPosture({ adminDatabaseUrl, databaseUrl, schema });
  expect(report.ok).toBe(false);
  expect(report.issues).toEqual([
    expect.objectContaining({
      code: 'KV433_DATABASE_IDENTITY',
      detail: expect.stringContaining('not bound to the witnessed runtime database'),
    }),
  ]);
}

async function expectSchemaEvolutionWithData(adminUrl: string, runtimeUrl: string): Promise<void> {
  const evolved = await migratePostgresAppDb({
    crossOwnerReadTables: ['kovo_ext_probe_notes'],
    databaseUrl: adminUrl,
    migrations: [createNotesMigration, addSummaryMigration],
    runtimeDatabaseUrl: runtimeUrl,
    schema: evolvedSchema,
  });
  expect(evolved.applied).toEqual(['002-add-note-summary.sql']);
  expect(evolved.skipped).toEqual(['001-create-probe-notes.sql']);
  expect(evolved.posture.ok).toBe(true);
  expect(evolved.posture.issues).toEqual([]);

  const runtime = createPostgresAppRuntimeDb({
    adminDatabaseUrl: adminUrl,
    crossOwnerReadTables: ['kovo_ext_probe_notes'],
    databaseUrl: runtimeUrl,
    schema: evolvedSchema,
  });
  try {
    await runtime.ready;
    const u1Db = usePostgresAppRuntimeDb(runtime, { principalPosture: actAsProbePrincipal('u1') });
    await expect(
      u1Db
        .select({ id: probeNotesV2.id, summary: probeNotesV2.summary, title: probeNotesV2.title })
        .from(probeNotesV2)
        .where(eq(probeNotesV2.id, 'u1-note')),
    ).resolves.toEqual([{ id: 'u1-note', summary: null, title: 'One' }]);
  } finally {
    await runtime.close();
  }
}

async function expectSecretColumnsDenied(
  databaseUrl: string,
  readerRole: string,
  adminRole: string,
): Promise<void> {
  await withPool(databaseUrl, async (pool) => {
    const txClient = new TestNodePostgresRuntimeClient(pool);
    const reader = createPostgresReadonlyClient(txClient, {
      principal: 'u1',
      readerRole,
    });
    await expect(
      reader.query('SELECT classified FROM kovo_ext_probe_notes ORDER BY id'),
    ).rejects.toMatchObject({
      code: '42501',
    });

    const admin = createPostgresReadonlyClient(txClient, {
      principal: 'admin-user',
      readerRole: adminRole,
      roleSetting: 'admin',
    });
    await expect(
      admin.query('SELECT classified FROM kovo_ext_probe_notes ORDER BY id'),
    ).rejects.toMatchObject({
      code: '42501',
    });
  });
}

async function expectUnexpectedCatalogPrivilegesRefuse(
  runtimeUrl: string,
  superuserUrl: string,
): Promise<void> {
  const fdw = `${probeRun}_fdw`;
  const server = `${probeRun}_server`;
  const largeObjectOid = 700_000 + process.pid;
  await withPool(superuserUrl, async (pool) => {
    await pool.query(`CREATE FOREIGN DATA WRAPPER ${quoteIdent(fdw)}`);
    await pool.query(`CREATE SERVER ${quoteIdent(server)} FOREIGN DATA WRAPPER ${quoteIdent(fdw)}`);
    await pool.query(`GRANT USAGE ON FOREIGN DATA WRAPPER ${quoteIdent(fdw)} TO kovo_writer`);
    await pool.query(`GRANT USAGE ON FOREIGN SERVER ${quoteIdent(server)} TO kovo_reader`);
    await pool.query('GRANT USAGE ON LANGUAGE plpgsql TO kovo_reader');
    await pool.query('SELECT lo_create($1::oid)', [largeObjectOid]);
    await pool.query(`GRANT SELECT ON LARGE OBJECT ${largeObjectOid} TO kovo_writer`);
  });

  const report = await checkPostgresAppDbPosture({
    databaseUrl: runtimeUrl,
    schema: evolvedSchema,
  });
  expect(report.ok).toBe(false);
  const unexpectedDetails = report.issues
    .filter((issue) => issue.code === 'KV433_UNEXPECTED_PRIVILEGE')
    .map((issue) => issue.detail)
    .join('\n');
  expect(unexpectedDetails).toContain('foreign_data_wrapper');
  expect(unexpectedDetails).toContain('foreign_server');
  expect(unexpectedDetails).toContain('language');
  expect(unexpectedDetails).toContain('large_object');
}

async function expectCrossOwnerRead(databaseUrl: string, adminDatabaseUrl: string): Promise<void> {
  drainCrossOwnerReadAuditFacts();
  const runtime = createPostgresAppRuntimeDb({
    adminDatabaseUrl,
    crossOwnerReadTables: ['kovo_ext_probe_notes'],
    databaseUrl,
    schema,
  });
  try {
    await runtime.ready;
    const request = { session: { user: { id: 'admin-user', roles: ['admin'] } } };
    const readDb = managedDb(usePostgresAppRuntimeDb(runtime, request), 'read');
    expect(() =>
      readDb.crossOwnerRead(sql`SELECT id, title FROM ${probeNotes} ORDER BY id`, {
        reads: ['kovo_ext_probe_notes'],
        reason: 'attempt before admin guard',
        role: 'admin',
      }),
    ).toThrow(/guards\.role\("admin"\)/);
    expect(await guards.role<typeof request>('admin')(request)).toBe(true);

    const rows = await readDb.crossOwnerRead<{ id: string; title: string }>(
      sql`SELECT id, title FROM ${probeNotes} ORDER BY id`,
      {
        reads: ['kovo_ext_probe_notes'],
        reason: 'external admin export',
        role: 'admin',
        site: 'postgres-external-probe.test.ts',
      },
    );
    expect(rowsOf(rows)).toEqual([
      { id: 'u1-note', title: 'One' },
      { id: 'u2-note', title: 'Two' },
    ]);
    expect(drainCrossOwnerReadAuditFacts()).toEqual([
      {
        declaredReads: ['public.kovo_ext_probe_notes'],
        dialectLabel: 'Postgres',
        observedRead: 'public.kovo_ext_probe_notes',
        principal: 'admin-user',
        reason: 'external admin export',
        site: 'postgres-external-probe.test.ts',
      },
    ]);
  } finally {
    await runtime.close();
  }
}

async function expectPooledScopeDoesNotLeak(
  databaseUrl: string,
  writerRole: string,
): Promise<void> {
  await withPool(databaseUrl, async (pool) => {
    const txClient = new TestNodePostgresRuntimeClient(pool);
    const u1 = createPostgresScopedClient(txClient, { principal: 'u1', role: writerRole });
    const u2 = createPostgresScopedClient(txClient, { principal: 'u2', role: writerRole });
    const requests = Array.from({ length: 24 }, (_, index) => {
      const client = index % 2 === 0 ? u1 : u2;
      const expectedId = index % 2 === 0 ? 'u1-note' : 'u2-note';
      return client
        .query<{ id: string }>('SELECT id FROM kovo_ext_probe_notes ORDER BY id')
        .then((result) => expect(result.rows).toEqual([{ id: expectedId }]));
    });
    await Promise.all(requests);

    const leaked = await pool.query<{ current_user: string; principal: string | null }>(
      "SELECT current_user, current_setting('kovo.principal', true) AS principal",
    );
    expect(leaked.rows[0]?.current_user).toBe(databaseUser(databaseUrl));
    expect(leaked.rows[0]?.principal ?? '').toBe('');
  });
}

function rowsOf<Row>(result: Row[] | { rows?: Row[] }): Row[] {
  return Array.isArray(result) ? result : (result.rows ?? []);
}

async function expectPermissionDenied(databaseUrl: string, statement: string): Promise<void> {
  await withPool(databaseUrl, async (pool) => {
    await expect(pool.query(statement)).rejects.toMatchObject({
      code: expect.stringMatching(/^(42501|0LP01)$/),
    });
  });
}

async function expectRuntimeIdentityClosure(
  databaseUrl: string,
  options: { allowedRoles: readonly string[]; deniedRoles: readonly string[] },
): Promise<void> {
  await withPool(databaseUrl, async (pool) => {
    const client = await pool.connect();
    try {
      const identity = await client.query<{
        current_role: string;
        current_user: string;
        rolbypassrls: boolean;
        rolsuper: boolean;
      }>(
        [
          'SELECT current_user, current_role, r.rolsuper, r.rolbypassrls',
          'FROM pg_roles r WHERE r.rolname = current_user',
        ].join(' '),
      );
      expect(identity.rows[0]).toEqual({
        current_role: databaseUser(databaseUrl),
        current_user: databaseUser(databaseUrl),
        rolbypassrls: false,
        rolsuper: false,
      });
      await expect(client.query('SELECT key FROM kovo_schema_state')).resolves.toMatchObject({
        rows: [{ key: 'database_instance_id' }],
      });

      for (const role of options.allowedRoles) {
        await client.query('RESET ROLE');
        await client.query(`SET ROLE ${quoteIdent(role)}`);
        const scoped = await client.query<{ current_role: string }>('SELECT current_role');
        expect(scoped.rows[0]?.current_role).toBe(role);
      }

      for (const role of options.deniedRoles) {
        await client.query('RESET ROLE');
        await expect(client.query(`SET ROLE ${quoteIdent(role)}`)).rejects.toMatchObject({
          code: '42501',
        });
      }
    } finally {
      await client.query('RESET ROLE').catch(() => undefined);
      client.release();
    }
  });
}

async function withPool<Result>(
  connectionString: string,
  callback: (pool: Pool) => Promise<Result>,
): Promise<Result> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
}

class TestNodePostgresRuntimeClient {
  constructor(private readonly pool: Pool) {}

  async exec(statement: string): Promise<unknown> {
    return this.pool.query(statement);
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    query: QueryConfig | string,
    params?: unknown[],
  ): Promise<{ rowCount: number | null; rows: Row[] }> {
    const result = await this.pool.query<Row>(query as QueryConfig, params);
    return { rowCount: result.rowCount, rows: result.rows };
  }

  async transaction<Result>(
    callback: (tx: TestNodePostgresTransactionClient) => Promise<Result>,
  ): Promise<Result> {
    const client = await this.pool.connect();
    const tx = new TestNodePostgresTransactionClient(client);
    try {
      await client.query('BEGIN');
      const result = await callback(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

class TestNodePostgresTransactionClient {
  constructor(private readonly client: PoolClient) {}

  async exec(statement: string): Promise<unknown> {
    return this.client.query(statement);
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    query: QueryConfig | string,
    params?: unknown[],
  ): Promise<{ rowCount: number | null; rows: Row[] }> {
    const result = await this.client.query<Row>(query as QueryConfig, params);
    return { rowCount: result.rowCount, rows: result.rows };
  }
}

interface LocalPostgresCluster {
  certificatePath?: string;
  stop(): Promise<void>;
  url(database: string, user: string): string;
}

async function startLocalPostgres(
  root: string,
  options: { tls?: boolean } = {},
): Promise<LocalPostgresCluster> {
  const dataDir = join(root, 'data');
  const socketDir = '/tmp';
  execFileSync('initdb', ['-D', dataDir, '-A', 'trust', '-U', 'postgres'], {
    stdio: 'ignore',
  });
  const port = await availablePort();
  const postgresArgs = ['-D', dataDir, '-h', '127.0.0.1', '-k', socketDir, '-p', String(port)];
  let certificatePath: string | undefined;
  if (options.tls === true) {
    const certificate = join(root, 'server.crt');
    certificatePath = certificate;
    const privateKey = join(root, 'server.key');
    execFileSync(
      'openssl',
      [
        'req',
        '-new',
        '-x509',
        '-days',
        '1',
        '-nodes',
        '-out',
        certificate,
        '-keyout',
        privateKey,
        '-subj',
        '/CN=localhost',
      ],
      { stdio: 'ignore' },
    );
    chmodSync(privateKey, 0o600);
    postgresArgs.push(
      '-c',
      'ssl=on',
      '-c',
      `ssl_cert_file=${certificate}`,
      '-c',
      `ssl_key_file=${privateKey}`,
    );
  }
  const process = spawn('postgres', postgresArgs, { stdio: 'pipe' });
  const stderr: string[] = [];
  process.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')));
  const cluster: LocalPostgresCluster = {
    ...(certificatePath === undefined ? {} : { certificatePath }),
    async stop() {
      process.kill('SIGTERM');
      await onceExit(process);
    },
    url(database: string, user: string) {
      return `postgres://${encodeURIComponent(user)}@127.0.0.1:${port}/${encodeURIComponent(database)}`;
    },
  };

  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (process.exitCode !== null) {
      throw new Error(`local postgres exited before accepting connections: ${stderr.join('')}`);
    }
    try {
      const pool = new Pool({ connectionString: cluster.url('postgres', 'postgres'), max: 1 });
      await pool.query('SELECT 1');
      await pool.end();
      return cluster;
    } catch {
      await delay(100);
    }
  }
  await cluster.stop();
  throw new Error(`local postgres did not accept connections: ${stderr.join('')}`);
}

function localPostgresToolchain(): { available: true } | { available: false; reason: string } {
  const missing = POSTGRES_BINARIES.filter((binary) => !localBinaryAvailable(binary));
  if (missing.length > 0) {
    return {
      available: false,
      reason: `missing local Postgres binaries: ${missing.join(', ')}`,
    };
  }
  return { available: true };
}

function localBinaryAvailable(binary: string): boolean {
  try {
    execFileSync(binary, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hasEgressBlockedCause(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    if ('name' in current && current.name === EGRESS_BLOCKED_ERROR_NAME) return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

async function connectRawSocket(host: string, port: number): Promise<void> {
  const socket = new net.Socket();
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.connect(port, host, resolve);
    });
  } finally {
    socket.destroy();
  }
}

async function requestWithNodeHttp(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = http.get({ host, port }, (response) => {
      response.resume();
      response.once('end', resolve);
    });
    request.once('error', reject);
  });
}

async function connect(connectionString: string): Promise<Pool> {
  const pool = new Pool({ connectionString, max: 1 });
  await pool.query('SELECT 1');
  return pool;
}

function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    import('node:net')
      .then(({ createServer }) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          server.close(() => {
            if (typeof address === 'object' && address !== null) resolve(address.port);
            else reject(new Error('could not allocate a local Postgres probe port'));
          });
        });
      })
      .catch(reject);
  });
}

async function withAdoptedRoleEnv<Result>(
  roles: { admin?: string; reader: string; system?: string; writer: string },
  callback: () => Promise<Result>,
): Promise<Result> {
  const previousAdmin = process.env.KOVO_DB_ADMIN_ROLE;
  const previousReader = process.env.KOVO_DB_READER_ROLE;
  const previousSystem = process.env.KOVO_DB_SYSTEM_ROLE;
  const previousWriter = process.env.KOVO_DB_WRITER_ROLE;
  if (roles.admin !== undefined) process.env.KOVO_DB_ADMIN_ROLE = roles.admin;
  process.env.KOVO_DB_READER_ROLE = roles.reader;
  if (roles.system !== undefined) process.env.KOVO_DB_SYSTEM_ROLE = roles.system;
  process.env.KOVO_DB_WRITER_ROLE = roles.writer;
  try {
    return await callback();
  } finally {
    restoreEnv('KOVO_DB_ADMIN_ROLE', previousAdmin);
    restoreEnv('KOVO_DB_READER_ROLE', previousReader);
    restoreEnv('KOVO_DB_SYSTEM_ROLE', previousSystem);
    restoreEnv('KOVO_DB_WRITER_ROLE', previousWriter);
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function databaseUser(databaseUrl: string): string {
  return decodeURIComponent(new URL(databaseUrl).username);
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function onceExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
}

void probeToolchain;
