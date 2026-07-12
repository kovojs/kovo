import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { kovo, sql } from '@kovojs/drizzle';
import { eq } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { Pool, type PoolClient, type QueryConfig, type QueryResultRow } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { actAsNonRequestPrincipal } from './auth-principal.js';
import { guards } from './guards.js';
import {
  createPostgresReadonlyClient,
  createPostgresScopedClient,
  drainCrossOwnerReadAuditFacts,
  kovoReadonlyDbHandle,
  type KovoReadonlyDbCapable,
  type Reader,
} from './managed-db.js';
import {
  checkPostgresAppDbPosture,
  createPostgresAppRuntimeDb,
  migratePostgresAppDb,
  provisionPostgresAppDb,
  type KovoPostgresAppRuntimeOptions,
  type KovoPostgresRuntimeDb,
} from './postgres-runtime.js';

const POSTGRES_BINARIES = ['initdb', 'postgres'] as const;
const probeToolchain = localPostgresToolchain();
const describeIfPostgres = probeToolchain.available ? describe : describe.skip;

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

  it('proves split provisioning, adopted roles, fail-closed posture, and pg Pool scope reset', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-external-postgres-probe-'));
    roots.push(root);
    const cluster = await startLocalPostgres(root);
    clusters.push(cluster);
    const admin = await connect(cluster.url('postgres', 'postgres'));

    const defaultDb = `${probeRun}_default`;
    const adoptedDb = `${probeRun}_adopted`;
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
        expect(adoptedReport.ok).toBe(true);
        expect(adoptedReport.issues).toEqual([]);
        await expectOwnerIsolation(cluster.url(adoptedDb, adoptedRuntime), {
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
    expect(staleReport.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['KV433_FORCE_RLS', 'KV433_OWNER_POLICY']),
    );
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
    const u1Db = runtime.db({ principalPosture: actAsProbePrincipal('u1') });
    const u2Db = runtime.db({ principalPosture: actAsProbePrincipal('u2') });

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
    const u1Db = runtime.db({ principalPosture: actAsProbePrincipal('u1') });
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
    const writer = runtime.db(request) as unknown as KovoReadonlyDbCapable<
      Reader<KovoPostgresRuntimeDb>
    >;
    const readDb = writer[kovoReadonlyDbHandle]();
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
        rows: [],
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
  ): Promise<{ rows: Row[] }> {
    const result = await this.pool.query<Row>(query as QueryConfig, params);
    return { rows: result.rows };
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
  ): Promise<{ rows: Row[] }> {
    const result = await this.client.query<Row>(query as QueryConfig, params);
    return { rows: result.rows };
  }
}

interface LocalPostgresCluster {
  stop(): Promise<void>;
  url(database: string, user: string): string;
}

async function startLocalPostgres(root: string): Promise<LocalPostgresCluster> {
  const dataDir = join(root, 'data');
  const socketDir = '/tmp';
  execFileSync('initdb', ['-D', dataDir, '-A', 'trust', '-U', 'postgres'], {
    stdio: 'ignore',
  });
  const port = await availablePort();
  const process = spawn(
    'postgres',
    ['-D', dataDir, '-h', '127.0.0.1', '-k', socketDir, '-p', String(port)],
    {
      stdio: 'pipe',
    },
  );
  const stderr: string[] = [];
  process.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')));
  const cluster: LocalPostgresCluster = {
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
  const missing = POSTGRES_BINARIES.filter((binary) => {
    try {
      execFileSync(binary, ['--version'], { stdio: 'ignore' });
      return false;
    } catch {
      return true;
    }
  });
  if (missing.length > 0) {
    return {
      available: false,
      reason: `missing local Postgres binaries: ${missing.join(', ')}`,
    };
  }
  return { available: true };
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
