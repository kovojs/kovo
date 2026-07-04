import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { kovo, sql, trustedSql } from '@kovojs/drizzle';
import { eq } from 'drizzle-orm';
import { pgTable, serial, text } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  drainCrossOwnerReadAuditFacts,
  drainPostgresRlsSilentDenyDiagnostics,
  kovoReadonlyDbHandle,
  type KovoReadonlyDbCapable,
  type Reader,
} from './managed-db.js';
import { actAsNonRequestPrincipal, declareSystemPrincipal } from './auth-principal.js';
import { guards } from './guards.js';
import {
  checkPostgresAppDbPosture,
  createPostgresAppRuntimeDb,
  declarePublicRelation,
  drainPostgresPostureCheckOptOutFacts,
  __testPostgresRuntimeInternals,
  migratePostgresAppDb,
  type KovoPostgresAppRuntimeOptions,
  type KovoPostgresRuntimeDb,
} from './postgres-runtime.js';
import { PostgresDurableTaskQueue, createDurableTaskSqlExecutor } from './task-queue.js';

const notes = pgTable(
  'kovo_runtime_notes',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    secretNote: text('secretNote').notNull(),
    title: text('title').notNull(),
  },
  kovo({
    domain: 'runtime-notes',
    key: 'id',
    owner: 'ownerId',
    secret: ['secretNote'],
  }),
);

const labels = pgTable(
  'kovo_runtime_labels',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
  },
  kovo({
    authzPolicy: 'labels are shared app reference data in this runtime test',
    domain: 'runtime-labels',
    key: 'id',
  }),
);

const shadowNotes = pgTable(
  'kovo_runtime_shadow_notes',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    title: text('title').notNull(),
  },
  kovo({
    domain: 'runtime-shadow-notes',
    key: 'id',
    owner: 'ownerId',
  }),
);

const serialNotes = pgTable(
  'kovo_runtime_serial_notes',
  {
    id: serial('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    title: text('title').notNull(),
  },
  kovo({
    domain: 'runtime-serial-notes',
    key: 'id',
    owner: 'ownerId',
  }),
);

const fkParents = pgTable(
  'kovo_runtime_fk_parents',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
  },
  kovo({
    domain: 'runtime-fk-parents',
    key: 'id',
    owner: 'ownerId',
  }),
);

const fkChildren = pgTable(
  'kovo_runtime_fk_children',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    parentId: text('parent_id')
      .notNull()
      .references(() => fkParents.id),
  },
  kovo({
    domain: 'runtime-fk-children',
    key: 'id',
    owner: 'ownerId',
  }),
);

const schema = { labels, notes };
// eslint-disable-next-line no-unused-vars -- compile-time removal assertion only.
type RemovedPostureCheckOnBootOption =
  // @ts-expect-error SPEC §10.3: disabling boot posture checks requires postureCheck.justification.
  KovoPostgresAppRuntimeOptions['postureCheckOnBoot'];
const seedSql = [
  'INSERT INTO kovo_runtime_notes (id, "ownerId", "secretNote", title) VALUES ' +
    "('n1', 'u1', 's1', 'One'), ('n2', 'u2', 's2', 'Two')",
  "INSERT INTO kovo_runtime_labels (id, label) VALUES ('l1', 'Inbox')",
];
const runtimeSchemaMigrationSql = [
  'CREATE TABLE kovo_runtime_notes (id text PRIMARY KEY, "ownerId" text NOT NULL, "secretNote" text NOT NULL, title text NOT NULL)',
  'CREATE TABLE kovo_runtime_labels (id text PRIMARY KEY, label text NOT NULL)',
].join('; ');

function actAsRuntimePrincipal(principal: string) {
  return actAsNonRequestPrincipal(principal, {
    ingress: 'task',
    operation: 'write',
    surface: 'postgres-runtime-test',
  });
}

const teamMemberships = pgTable(
  'kovo_runtime_team_memberships',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id').notNull(),
    userId: text('user_id').notNull(),
  },
  kovo({
    domain: 'runtime-team-memberships',
    key: 'id',
    owner: 'userId',
  }),
);

const teamDocuments = pgTable(
  'kovo_runtime_team_documents',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id').notNull(),
    title: text('title').notNull(),
  },
  kovo({
    authzPolicy: sql`EXISTS (
      SELECT 1 FROM ${teamMemberships}
      WHERE ${teamMemberships.teamId} = "kovo_runtime_team_documents"."team_id"
        AND ${teamMemberships.userId} = current_setting('kovo.principal', true)
    )`,
    domain: 'runtime-team-documents',
    key: 'id',
  }),
);

const teamSchema = { teamDocuments, teamMemberships };
const teamSeedSql = [
  [
    'INSERT INTO kovo_runtime_team_memberships (id, team_id, user_id) VALUES',
    "('m1', 'team-a', 'u1'), ('m2', 'team-b', 'u2')",
  ].join(' '),
  [
    'INSERT INTO kovo_runtime_team_documents (id, team_id, title) VALUES',
    "('d1', 'team-a', 'Alpha'), ('d2', 'team-b', 'Beta')",
  ].join(' '),
];

const parameterizedPolicyDocuments = pgTable(
  'kovo_runtime_parameterized_policy_documents',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id').notNull(),
  },
  kovo({
    authzPolicy: sql`team_id = ${'team-a'}`,
    domain: 'runtime-parameterized-policy-documents',
    key: 'id',
  }),
);

const sharedContainers = pgTable(
  'kovo_runtime_shared_containers',
  {
    id: text('id').primaryKey(),
  },
  kovo({
    domain: 'runtime-shared-containers',
    key: 'id',
    reference: true,
  }),
);

const orphanedContainerItems = pgTable(
  'kovo_runtime_orphaned_container_items',
  {
    id: text('id').primaryKey(),
    containerId: text('container_id').notNull(),
  },
  kovo({
    domain: 'runtime-orphaned-container-items',
    key: 'id',
    ownerVia: { fk: (table) => table.containerId, parent: sharedContainers, parentKey: 'id' },
  }),
);

const unresolvableOwnerViaSchema = { orphanedContainerItems, sharedContainers };

describe('createPostgresAppRuntimeDb', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
  });

  it('provisions the default PGlite runtime from a schema module and enforces owner RLS', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });

    try {
      await runtime.ready;
      const u1Db = runtime.db({ principalPosture: actAsRuntimePrincipal('u1') });
      const u2Db = runtime.db({ principalPosture: actAsRuntimePrincipal('u2') });

      await expect(u1Db.select().from(notes)).resolves.toEqual([
        { id: 'n1', ownerId: 'u1', secretNote: 's1', title: 'One' },
      ]);
      await expect(u2Db.select().from(notes)).resolves.toEqual([
        { id: 'n2', ownerId: 'u2', secretNote: 's2', title: 'Two' },
      ]);
    } finally {
      await runtime.close();
    }

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('refuses production boot on in-process PGlite', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-prod-pglite-'));
    roots.push(dataDir);
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema })).toThrow(
        /KV433: production requires a least-privilege external Postgres via KOVO_DATABASE_URL; PGlite is dev\/test-only and runs in-process as superuser \(SPEC §10\.3\)\./,
      );
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('grants protected tables only with FORCE RLS and live Kovo policies', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-grant-policy-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });

    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    const granted = await queryPglite<{ table_name: string }>(
      dataDir,
      [
        'SELECT DISTINCT table_name FROM information_schema.role_table_grants',
        "WHERE grantee IN ('kovo_reader', 'kovo_writer')",
        "AND table_name IN ('kovo_runtime_notes', 'kovo_runtime_labels')",
        'UNION',
        'SELECT DISTINCT table_name FROM information_schema.column_privileges',
        "WHERE grantee IN ('kovo_reader', 'kovo_writer')",
        "AND table_name IN ('kovo_runtime_notes', 'kovo_runtime_labels')",
        'ORDER BY table_name',
      ].join(' '),
    );
    expect(granted.rows.map((row) => row.table_name)).toEqual([
      'kovo_runtime_labels',
      'kovo_runtime_notes',
    ]);

    const protectedGrantPosture = await queryPglite<{
      policy_count: number | string;
      relforcerowsecurity: boolean;
      relrowsecurity: boolean;
      table_name: string;
    }>(
      dataDir,
      [
        'SELECT c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity,',
        "COUNT(p.polname) FILTER (WHERE p.polname IN ('kovo_owner_scope', 'kovo_authz_policy', 'kovo_system_scope')) AS policy_count",
        'FROM pg_class c',
        'LEFT JOIN pg_policy p ON p.polrelid = c.oid',
        "WHERE c.relname = 'kovo_runtime_notes'",
        'GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity',
      ].join(' '),
    );
    expect(protectedGrantPosture.rows).toEqual([
      {
        policy_count: expect.toSatisfy((count: number | string) => Number(count) >= 2),
        relforcerowsecurity: true,
        relrowsecurity: true,
        table_name: 'kovo_runtime_notes',
      },
    ]);
  });

  it('keeps database tables outside the app schema default-denied until they are declared', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-default-deny-'));
    roots.push(dataDir);
    await execPglite(
      dataDir,
      [
        'CREATE TABLE kovo_runtime_shadow_notes (id text PRIMARY KEY, "ownerId" text NOT NULL, title text NOT NULL)',
        "INSERT INTO kovo_runtime_shadow_notes (id, \"ownerId\", title) VALUES ('s1', 'u1', 'Shadow')",
      ].join('; '),
    );

    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await runtime.ready;
      const u1Db = runtime.db({ principalPosture: actAsRuntimePrincipal('u1') });
      await expect(u1Db.select().from(shadowNotes)).rejects.toThrow();
    } finally {
      await runtime.close();
    }

    const declaredRuntime = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      schema: { labels, notes, shadowNotes },
    });
    try {
      await declaredRuntime.ready;
      const u1Db = declaredRuntime.db({ principalPosture: actAsRuntimePrincipal('u1') });
      await expect(u1Db.select().from(shadowNotes)).resolves.toEqual([
        { id: 's1', ownerId: 'u1', title: 'Shadow' },
      ]);
    } finally {
      await declaredRuntime.close();
    }
  });

  it('returns least-privilege PGlite app handles when called without a request', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-no-request-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });

    try {
      await runtime.ready;
      const appDb = runtime.db();

      await expect(appDb.select().from(notes).orderBy(notes.id)).resolves.toEqual([]);
      await expect(
        appDb.execute(sql.raw('CREATE TABLE kovo_no_request_superuser_escape (id text)')),
      ).rejects.toThrow();
    } finally {
      await runtime.close();
    }
  });

  it('threads Postgres rawRead through the runtime reader without bypassing RLS or column grants', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-raw-read-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });

    try {
      await runtime.ready;
      const writer = runtime.db({ principalPosture: actAsRuntimePrincipal('u1') });
      const readDb = (writer as unknown as KovoReadonlyDbCapable<Reader<KovoPostgresRuntimeDb>>)[
        kovoReadonlyDbHandle
      ]();

      const rows = await readDb.rawRead<{ id: string; title: string }>(
        trustedSql(sql.raw('select id, title from kovo_runtime_notes order by id'), {
          justification: 'runtime rawRead RLS proof',
        }),
        { reads: ['kovo_runtime_notes'] },
      );
      expect(rowsOf(rows)).toEqual([{ id: 'n1', title: 'One' }]);
      await expect(
        readDb.rawRead<{ secretNote: string }>(
          trustedSql(sql.raw('select "secretNote" from kovo_runtime_notes'), {
            justification: 'runtime rawRead secret-column denial proof',
          }),
          { reads: ['kovo_runtime_notes'] },
        ),
      ).rejects.toThrow();
    } finally {
      await runtime.close();
    }
  });

  it('wires dev RLS empty-read diagnostics through the runtime readonly boundary', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-rls-diagnostic-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });

    try {
      await runtime.ready;
      drainPostgresRlsSilentDenyDiagnostics();
      const writer = runtime.db({ principalPosture: actAsRuntimePrincipal('missing') });
      const readDb = (writer as unknown as KovoReadonlyDbCapable<Reader<KovoPostgresRuntimeDb>>)[
        kovoReadonlyDbHandle
      ]();

      await expect(
        readDb.select({ id: notes.id, title: notes.title }).from(notes),
      ).resolves.toEqual([]);
      expect(drainPostgresRlsSilentDenyDiagnostics()).toEqual([
        {
          filteredRows: 2,
          kind: 'owner-scope-filtered',
          message: 'kovo_owner_scope filtered 2 rows for principal missing.',
          principal: 'missing',
          table: 'kovo_runtime_notes',
        },
      ]);
    } finally {
      await runtime.close();
    }
  });

  it('uses an audited system posture for cross-owner owner-table work without bypassing RLS', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-system-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });

    try {
      await runtime.ready;
      const u1Db = runtime.db({ principalPosture: actAsRuntimePrincipal('u1') });
      const systemDb = runtime.db({
        principalPosture: declareSystemPrincipal('repair owner index in runtime test', {
          ingress: 'task',
          operation: 'write',
          surface: 'postgres-runtime.test',
        }),
      });

      await expect(u1Db.select().from(notes).orderBy(notes.id)).resolves.toEqual([
        { id: 'n1', ownerId: 'u1', secretNote: 's1', title: 'One' },
      ]);
      await systemDb.update(notes).set({ title: 'System touched' });
      await expect(systemDb.select().from(notes).orderBy(notes.id)).resolves.toEqual([
        { id: 'n1', ownerId: 'u1', secretNote: 's1', title: 'System touched' },
        { id: 'n2', ownerId: 'u2', secretNote: 's2', title: 'System touched' },
      ]);
      await expect(u1Db.select().from(notes).orderBy(notes.id)).resolves.toEqual([
        { id: 'n1', ownerId: 'u1', secretNote: 's1', title: 'System touched' },
      ]);
      await expect(runtime.db({}).select().from(notes)).resolves.toEqual([]);
    } finally {
      await runtime.close();
    }

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('provisions framework task store tables for least-privilege writer handles', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-task-store-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });

    try {
      await runtime.ready;
      const executor = createDurableTaskSqlExecutor(runtime.db({}));
      const queue = new PostgresDurableTaskQueue(executor);

      await expect(
        queue.enqueue({
          args: { proof: true },
          task: 'runtime/task-store-proof',
        }),
      ).resolves.toMatchObject({ task: 'runtime/task-store-proof' });
      await expect(
        executor.execute({
          text: [
            'insert into _kovo_task_cron_occurrences (cron_name, occurrence_ts, job_id)',
            'values ($1, $2, null)',
            'returning cron_name',
          ].join(' '),
          values: ['runtime/task-store-proof', new Date('2026-07-03T00:00:00.000Z')],
        }),
      ).resolves.toMatchObject({
        rows: [{ cron_name: 'runtime/task-store-proof' }],
      });
    } finally {
      await runtime.close();
    }

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('creates app roles before applying migrations that reference them', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-migration-roles-'));
    roots.push(dataDir);

    const report = await migratePostgresAppDb({
      dataDir,
      driver: 'pglite',
      migrations: [
        {
          id: '001_create_schema_after_roles',
          sql: [
            runtimeSchemaMigrationSql,
            'GRANT SELECT ON TABLE kovo_runtime_notes TO kovo_reader',
          ].join('; '),
        },
      ],
      schema,
    });

    expect(report.applied).toEqual(['001_create_schema_after_roles']);
    expect(report.posture.ok).toBe(true);
    expect(report.posture.issues).toEqual([]);
  });

  it('rolls back migration SQL and bookkeeping when provision reassertion fails', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-migration-rollback-'));
    roots.push(dataDir);

    await expect(
      migratePostgresAppDb({
        dataDir,
        driver: 'pglite',
        migrations: [
          {
            id: '001_broken_schema',
            sql: 'CREATE TABLE kovo_runtime_notes (id text PRIMARY KEY, "ownerId" text NOT NULL, "secretNote" text NOT NULL, title text NOT NULL)',
          },
        ],
        schema,
      }),
    ).rejects.toThrow();

    const leakedObjects = await queryPglite<{ relname: string }>(
      dataDir,
      [
        'SELECT relname FROM pg_class',
        "WHERE relname IN ('kovo_runtime_notes', 'kovo_migrations')",
        'ORDER BY relname',
      ].join(' '),
    );
    expect(leakedObjects.rows).toEqual([]);
  });

  it('grants set_config only to the least-privilege runtime login role', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-set-config-grant-'));
    roots.push(dataDir);

    const report = await migratePostgresAppDb({
      dataDir,
      driver: 'pglite',
      migrations: [
        {
          id: '001_runtime_login_schema',
          sql: ['CREATE ROLE kovo_runtime_login LOGIN', runtimeSchemaMigrationSql].join('; '),
        },
      ],
      runtimeDatabaseUrl: 'postgres://kovo_runtime_login@127.0.0.1/kovo',
      schema,
    });
    expect(report.posture.ok).toBe(true);

    const privileges = await queryPglite<{
      public_can_execute: boolean;
      reader_can_execute: boolean;
      runtime_can_execute: boolean;
    }>(
      dataDir,
      [
        'SELECT',
        "has_function_privilege('kovo_runtime_login', 'pg_catalog.set_config(text,text,boolean)', 'EXECUTE') AS runtime_can_execute,",
        "has_function_privilege('kovo_reader', 'pg_catalog.set_config(text,text,boolean)', 'EXECUTE') AS reader_can_execute,",
        'EXISTS (',
        '  SELECT 1 FROM pg_proc p',
        '  JOIN pg_namespace n ON n.oid = p.pronamespace',
        '  JOIN aclexplode(p.proacl) acl ON true',
        "  WHERE n.nspname = 'pg_catalog'",
        "  AND p.proname = 'set_config'",
        "  AND pg_get_function_identity_arguments(p.oid) = 'text, text, boolean'",
        "  AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'",
        ') AS public_can_execute',
      ].join(' '),
    );
    expect(privileges.rows[0]).toEqual({
      public_can_execute: false,
      reader_can_execute: false,
      runtime_can_execute: true,
    });
  });

  it('revokes app-schema table and sequence default privileges from PUBLIC during provision', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-default-privs-'));
    roots.push(dataDir);

    const report = await migratePostgresAppDb({
      dataDir,
      driver: 'pglite',
      migrations: [
        {
          id: '001_schema_after_public_defaults',
          sql: [
            'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC',
            'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO PUBLIC',
            runtimeSchemaMigrationSql,
          ].join('; '),
        },
      ],
      schema,
    });
    expect(report.posture.ok).toBe(true);

    await execPglite(
      dataDir,
      [
        'CREATE TABLE kovo_runtime_future_default_privs (id text PRIMARY KEY)',
        'CREATE SEQUENCE kovo_runtime_future_default_privs_seq',
      ].join('; '),
    );
    const privileges = await queryPglite<{
      can_read_table: boolean;
      can_use_sequence: boolean;
    }>(
      dataDir,
      [
        'SELECT',
        "has_table_privilege('kovo_reader', 'kovo_runtime_future_default_privs', 'SELECT') AS can_read_table,",
        "has_sequence_privilege('kovo_reader', 'kovo_runtime_future_default_privs_seq', 'USAGE') AS can_use_sequence",
      ].join(' '),
    );
    expect(privileges.rows[0]).toEqual({
      can_read_table: false,
      can_use_sequence: false,
    });
  });

  it('rejects unbranded system posture instead of granting ambient system authority', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-system-unbranded-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });

    try {
      await runtime.ready;
      expect(() =>
        runtime.db({ principalPosture: { kind: 'system', reason: 'plain object' } }),
      ).toThrow(/framework-minted actAs\(id\) or declareSystemRead\/Write\(reason\)/);
    } finally {
      await runtime.close();
    }
  });

  it('rejects unbranded act-as posture instead of setting kovo.principal', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-act-as-unbranded-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });

    try {
      await runtime.ready;
      expect(() => runtime.db({ principalPosture: { kind: 'act-as', principal: 'u1' } })).toThrow(
        /framework-minted actAs\(id\) or declareSystemRead\/Write\(reason\)/,
      );
    } finally {
      await runtime.close();
    }
  });

  it('requires a justification when disabling boot posture checks and records an audit fact', async () => {
    drainPostgresPostureCheckOptOutFacts();
    const rejectedDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-posture-reject-'));
    roots.push(rejectedDir);
    expect(() =>
      createPostgresAppRuntimeDb({
        dataDir: rejectedDir,
        driver: 'pglite',
        postureCheck: { justification: ' ', onBoot: false },
        schema,
      }),
    ).toThrow(/postureCheck[\s\S]*justification/);

    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-posture-optout-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      postureCheck: {
        justification: 'migration smoke test owns the posture check in this process',
        onBoot: false,
        site: 'postgres-runtime.test.ts',
      },
      provisionOnBoot: false,
      schema,
    });

    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }
    expect(drainPostgresPostureCheckOptOutFacts()).toEqual([
      {
        driver: 'pglite',
        justification: 'migration smoke test owns the posture check in this process',
        site: 'postgres-runtime.test.ts',
      },
    ]);
  });

  it('reports a missing provisioned posture without running DDL during check', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-empty-'));
    roots.push(dataDir);

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('KV433_SCHEMA_TABLE');
  });

  it('refuses boot when a granted definer view can reach an owner table', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-definer-view-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    await execPglite(
      dataDir,
      [
        'CREATE VIEW kovo_runtime_notes_v AS SELECT id, title FROM kovo_runtime_notes',
        'GRANT SELECT ON TABLE kovo_runtime_notes_v TO kovo_reader',
      ].join('; '),
    );

    const drifted = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      postureCheck: { onBoot: true },
      provisionOnBoot: false,
      schema,
    });
    try {
      await expect(drifted.ready).rejects.toThrow(
        /reachable non-security_invoker view kovo_runtime_notes_v over owner table kovo_runtime_notes/,
      );
    } finally {
      await drifted.close();
    }
  });

  it('refuses boot when a materialized view is reachable by an app role', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-materialized-view-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    await execPglite(
      dataDir,
      [
        'CREATE MATERIALIZED VIEW kovo_runtime_notes_mv AS SELECT id, "ownerId", "secretNote" FROM kovo_runtime_notes',
        'GRANT SELECT ON TABLE kovo_runtime_notes_mv TO kovo_reader',
      ].join('; '),
    );

    const drifted = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      postureCheck: { onBoot: true },
      provisionOnBoot: false,
      schema,
    });
    try {
      await expect(drifted.ready).rejects.toThrow(
        /materialized views cannot enforce row-level security/,
      );
    } finally {
      await drifted.close();
    }
  });

  it('admits a reachable public materialized view only when declared', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-public-matview-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    await execPglite(
      dataDir,
      [
        'CREATE MATERIALIZED VIEW kovo_runtime_public_notes_mv AS SELECT id, title FROM kovo_runtime_notes',
        'GRANT SELECT ON TABLE kovo_runtime_public_notes_mv TO kovo_reader',
      ].join('; '),
    );

    const undeclared = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(undeclared.ok).toBe(false);
    expect(undeclared.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV433_REACHABLE_OBJECT',
        detail: expect.stringContaining('materialized views cannot enforce row-level security'),
      }),
    );

    const declared = await checkPostgresAppDbPosture({
      dataDir,
      driver: 'pglite',
      publicRelations: [
        declarePublicRelation({
          reason: 'public report projects non-secret note titles only',
          relation: 'kovo_runtime_public_notes_mv',
          site: 'postgres-runtime.test.ts',
        }),
      ],
      schema,
    });
    expect(declared.ok).toBe(true);
    expect(declared.issues).toEqual([]);
  });

  it('refuses boot when PUBLIC grants make an unprotected table reachable', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-public-grant-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    await execPglite(
      dataDir,
      [
        'CREATE TABLE kovo_runtime_public_leak (id text PRIMARY KEY, secret text NOT NULL)',
        "INSERT INTO kovo_runtime_public_leak (id, secret) VALUES ('leak', 'PUBLIC-SECRET')",
        'GRANT SELECT ON TABLE kovo_runtime_public_leak TO PUBLIC',
      ].join('; '),
    );

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV433_REACHABLE_TABLE',
        detail: expect.stringContaining('kovo_runtime_public_leak'),
      }),
    );

    const declared = await checkPostgresAppDbPosture({
      dataDir,
      driver: 'pglite',
      publicRelations: [
        declarePublicRelation({
          reason: 'attempting to bypass ordinary table posture',
          relation: 'kovo_runtime_public_leak',
        }),
      ],
      schema,
    });
    expect(declared.ok).toBe(false);
    expect(declared.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV433_PUBLIC_RELATION',
        detail: expect.stringContaining('can carry Kovo RLS'),
      }),
    );
  });

  it('forces app-schema views over protected tables to security_invoker during provision', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-security-invoker-view-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    await execPglite(
      dataDir,
      [
        'CREATE VIEW kovo_runtime_notes_safe_v AS SELECT id, title FROM kovo_runtime_notes',
        'GRANT SELECT ON TABLE kovo_runtime_notes_safe_v TO kovo_reader',
      ].join('; '),
    );

    const reprovisioned = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      postureCheck: { onBoot: true },
      provisionOnBoot: true,
      schema,
    });
    try {
      await reprovisioned.ready;
    } finally {
      await reprovisioned.close();
    }

    const view = await queryPglite<{ reloptions: string[] | null }>(
      dataDir,
      "SELECT reloptions FROM pg_class WHERE relname = 'kovo_runtime_notes_safe_v'",
    );
    expect(view.rows[0]?.reloptions).toContain('security_invoker=true');
  });

  it('refuses boot when an app role can reach a table without FORCE RLS and Kovo policy', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-granted-unprotected-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    await execPglite(
      dataDir,
      [
        'CREATE TABLE kovo_runtime_unprotected (id text PRIMARY KEY)',
        "INSERT INTO kovo_runtime_unprotected (id) VALUES ('leak')",
        'GRANT SELECT ON TABLE kovo_runtime_unprotected TO kovo_reader',
      ].join('; '),
    );

    const drifted = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      postureCheck: { onBoot: true },
      provisionOnBoot: false,
      schema,
    });
    try {
      await expect(drifted.ready).rejects.toThrow(
        /kovo_runtime_unprotected is reachable by an app role but is not a Kovo-protected table/,
      );
    } finally {
      await drifted.close();
    }
  });

  it('refuses column-only grants to app roles or PUBLIC on unprotected tables', async () => {
    for (const [suffix, grantee] of [
      ['reader', 'kovo_reader'],
      ['public', 'PUBLIC'],
    ] as const) {
      const dataDir = mkdtempSync(join(tmpdir(), `kovo-postgres-runtime-column-${suffix}-`));
      roots.push(dataDir);
      const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
      try {
        await runtime.ready;
      } finally {
        await runtime.close();
      }

      await execPglite(
        dataDir,
        [
          `CREATE TABLE kovo_runtime_column_leak_${suffix} (id text PRIMARY KEY, secret text NOT NULL)`,
          `INSERT INTO kovo_runtime_column_leak_${suffix} (id, secret) VALUES ('leak', 'SECRET')`,
          `GRANT SELECT (secret) ON TABLE kovo_runtime_column_leak_${suffix} TO ${grantee}`,
        ].join('; '),
      );

      const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
      expect(report.ok).toBe(false);
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: 'KV433_REACHABLE_TABLE',
          detail: expect.stringContaining(`kovo_runtime_column_leak_${suffix}`),
        }),
      );
    }
  });

  it('refuses effective PUBLIC access to a protected secret column', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-secret-public-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    await execPglite(dataDir, 'GRANT SELECT ("secretNote") ON TABLE kovo_runtime_notes TO PUBLIC');

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV435_SECRET_COLUMN_GRANT',
        detail: expect.stringContaining('effective SELECT on kovo_runtime_notes.secretNote'),
      }),
    );
  });

  it('refuses boot when an app role can execute an app-schema routine', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-granted-routine-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    await execPglite(
      dataDir,
      [
        "CREATE FUNCTION kovo_runtime_leak() RETURNS text LANGUAGE SQL SECURITY DEFINER AS $$ SELECT 'leak' $$",
        'GRANT EXECUTE ON FUNCTION kovo_runtime_leak() TO kovo_reader',
      ].join('; '),
    );

    const drifted = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      postureCheck: { onBoot: true },
      provisionOnBoot: false,
      schema,
    });
    try {
      await expect(drifted.ready).rejects.toThrow(
        /kovo_runtime_leak is a SECURITY DEFINER routine executable by .*routine reachability has no vetted Kovo allowlist/,
      );
    } finally {
      await drifted.close();
    }
  });

  it('refuses cross-schema SECURITY DEFINER routines executable by app roles', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-cross-schema-routine-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    await execPglite(
      dataDir,
      [
        'CREATE SCHEMA kovo_runtime_extra',
        "CREATE FUNCTION kovo_runtime_extra.leak() RETURNS text LANGUAGE SQL SECURITY DEFINER AS $$ SELECT 'leak' $$",
        'GRANT EXECUTE ON FUNCTION kovo_runtime_extra.leak() TO kovo_reader',
      ].join('; '),
    );

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV433_REACHABLE_ROUTINE',
        detail: expect.stringContaining('kovo_runtime_extra.leak'),
      }),
    );
  });

  it('refuses SECURITY DEFINER code attached to app-role-reachable tables by side effect', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-attached-code-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    await execPglite(
      dataDir,
      [
        [
          'CREATE FUNCTION kovo_runtime_attached_trigger() RETURNS trigger',
          'LANGUAGE plpgsql SECURITY DEFINER',
          'AS $$ BEGIN RETURN NEW; END $$',
        ].join(' '),
        [
          'CREATE TRIGGER kovo_runtime_attached_trigger',
          'BEFORE UPDATE ON kovo_runtime_notes',
          'FOR EACH ROW EXECUTE FUNCTION kovo_runtime_attached_trigger()',
        ].join(' '),
        [
          'CREATE FUNCTION kovo_runtime_attached_check(value text) RETURNS boolean',
          'LANGUAGE SQL SECURITY DEFINER',
          'AS $$ SELECT true $$',
        ].join(' '),
        [
          'ALTER TABLE kovo_runtime_notes ADD CONSTRAINT kovo_runtime_attached_check',
          'CHECK (kovo_runtime_attached_check(title))',
        ].join(' '),
        [
          'CREATE FUNCTION kovo_runtime_attached_default() RETURNS text',
          'LANGUAGE SQL SECURITY DEFINER',
          "AS $$ SELECT 'attached'::text $$",
        ].join(' '),
        [
          'ALTER TABLE kovo_runtime_notes ADD COLUMN attached_default text',
          'DEFAULT kovo_runtime_attached_default()',
        ].join(' '),
        [
          'CREATE FUNCTION kovo_runtime_attached_index(value text) RETURNS text',
          'LANGUAGE SQL IMMUTABLE SECURITY DEFINER',
          'AS $$ SELECT value $$',
        ].join(' '),
        [
          'CREATE INDEX kovo_runtime_attached_index',
          'ON kovo_runtime_notes (kovo_runtime_attached_index(title))',
        ].join(' '),
      ].join('; '),
    );

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV433_ATTACHED_CODE',
          detail: expect.stringContaining('DML trigger'),
        }),
        expect.objectContaining({
          code: 'KV433_ATTACHED_CODE',
          detail: expect.stringContaining('CHECK/domain constraint function'),
        }),
        expect.objectContaining({
          code: 'KV433_ATTACHED_CODE',
          detail: expect.stringContaining('default/generated expression function'),
        }),
        expect.objectContaining({
          code: 'KV433_ATTACHED_CODE',
          detail: expect.stringContaining('index/predicate expression function'),
        }),
      ]),
    );
  });

  it('allows framework/internal FK triggers on app-role-reachable tables', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-fk-triggers-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      schema: { fkChildren, fkParents },
      seedSql: [
        "INSERT INTO kovo_runtime_fk_parents (id, \"ownerId\") VALUES ('p1', 'u1')",
        [
          'INSERT INTO kovo_runtime_fk_children (id, "ownerId", parent_id)',
          "VALUES ('c1', 'u1', 'p1')",
        ].join(' '),
      ],
    });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    const report = await checkPostgresAppDbPosture({
      dataDir,
      driver: 'pglite',
      schema: { fkChildren, fkParents },
    });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('allows protected-table serial sequences but refuses unrelated reachable sequences', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-sequences-'));
    roots.push(dataDir);
    const serialSchema = { serialNotes };
    const runtime = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      schema: serialSchema,
      seedSql: ["INSERT INTO kovo_runtime_serial_notes (\"ownerId\", title) VALUES ('u1', 'One')"],
    });
    try {
      await runtime.ready;
      const u1Db = runtime.db({ principalPosture: actAsRuntimePrincipal('u1') });
      await expect(
        u1Db.insert(serialNotes).values({ ownerId: 'u1', title: 'Two' }).returning(),
      ).resolves.toEqual([expect.objectContaining({ ownerId: 'u1', title: 'Two' })]);
    } finally {
      await runtime.close();
    }

    const clean = await checkPostgresAppDbPosture({
      dataDir,
      driver: 'pglite',
      schema: serialSchema,
    });
    expect(clean.ok).toBe(true);
    expect(clean.issues).toEqual([]);

    await execPglite(
      dataDir,
      [
        'CREATE SEQUENCE kovo_runtime_sensitive_seq',
        'GRANT USAGE ON SEQUENCE kovo_runtime_sensitive_seq TO kovo_reader',
      ].join('; '),
    );

    const drifted = await checkPostgresAppDbPosture({
      dataDir,
      driver: 'pglite',
      schema: serialSchema,
    });
    expect(drifted.ok).toBe(false);
    expect(drifted.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV433_REACHABLE_OBJECT',
        detail: expect.stringContaining('kovo_runtime_sensitive_seq'),
      }),
    );
  });

  it('refuses default ACL grants that would give future objects to app roles', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-default-acl-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    await execPglite(dataDir, 'ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO kovo_reader');

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV433_UNEXPECTED_PRIVILEGE',
        detail: expect.stringContaining('default_acl'),
      }),
    );
  });

  it('fails ownerVia whose parent chain cannot resolve to an owner before granting the child table', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-owner-via-bad-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      schema: unresolvableOwnerViaSchema,
    });

    try {
      await expect(runtime.ready).rejects.toThrow(
        /KV414[\s\S]*kovo_runtime_orphaned_container_items[\s\S]*kovo_runtime_shared_containers/,
      );
    } finally {
      await runtime.close();
    }
  });

  it('adopts pre-created provider roles from env without creating them', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-adopt-roles-'));
    roots.push(dataDir);
    await execPglite(dataDir, 'CREATE ROLE "provider_reader"');
    await execPglite(dataDir, 'CREATE ROLE "provider_writer"');

    await withPostgresRoleEnv(
      { reader: 'provider_reader', writer: 'provider_writer' },
      async () => {
        const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
        try {
          await runtime.ready;
        } finally {
          await runtime.close();
        }

        const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
        expect(report.ok).toBe(true);
        expect(report.issues).toEqual([]);
      },
    );
  });

  it('fails closed instead of creating missing provider-adopted roles', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-adopt-roles-missing-'));
    roots.push(dataDir);

    await withPostgresRoleEnv(
      { reader: 'missing_provider_reader', writer: 'missing_provider_writer' },
      async () => {
        const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema });
        try {
          await expect(runtime.ready).rejects.toThrow(/missing_provider_reader/);
        } finally {
          await runtime.close();
        }
      },
    );
  });

  it('provisions audited crossOwnerRead as an opted-in admin RLS policy', async () => {
    drainCrossOwnerReadAuditFacts();
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-cross-owner-read-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({
      crossOwnerReadTables: ['kovo_runtime_notes'],
      dataDir,
      driver: 'pglite',
      schema,
      seedSql,
    });

    try {
      await runtime.ready;
      const request = { session: { user: { id: 'admin-user', roles: ['admin'] } } };
      const writer = runtime.db(request) as unknown as KovoReadonlyDbCapable<
        Reader<KovoPostgresRuntimeDb>
      >;
      const readDb = writer[kovoReadonlyDbHandle]();
      expect(() =>
        readDb.crossOwnerRead(sql`SELECT id, title FROM ${notes} ORDER BY id`, {
          reads: ['kovo_runtime_notes'],
          reason: 'attempt before role guard',
          role: 'admin',
        }),
      ).toThrow(/guards\.role\("admin"\)/);
      expect(await guards.role<typeof request>('admin')(request)).toBe(true);
      const result = await readDb.crossOwnerRead<{ id: string; title: string }>(
        sql`SELECT id, title FROM ${notes} ORDER BY id`,
        {
          reads: ['kovo_runtime_notes'],
          reason: 'support export for an admin-guarded endpoint',
          role: 'admin',
          site: 'admin.ts:12',
        },
      );
      expect(rowsOf(result)).toEqual([
        { id: 'n1', title: 'One' },
        { id: 'n2', title: 'Two' },
      ]);
      expect(drainCrossOwnerReadAuditFacts()).toEqual([
        {
          declaredReads: ['public.kovo_runtime_notes'],
          dialectLabel: 'PGlite',
          observedRead: 'public.kovo_runtime_notes',
          principal: 'admin-user',
          reason: 'support export for an admin-guarded endpoint',
          site: 'admin.ts:12',
        },
      ]);
      expect(() =>
        readDb.crossOwnerRead(sql`SELECT id, label FROM ${labels}`, {
          reads: ['kovo_runtime_labels'],
          reason: 'attempt unconfigured table',
          role: 'admin',
        }),
      ).toThrow(/not opted in/);
      expect(() =>
        readDb.crossOwnerRead(sql`SELECT ${notes.id} FROM ${notes} JOIN ${labels} ON true`, {
          reads: ['kovo_runtime_notes'],
          reason: 'attempt joined read',
          role: 'admin',
        }),
      ).toThrow(/one simple SELECT/);
    } finally {
      await runtime.close();
    }

    const report = await checkPostgresAppDbPosture({
      crossOwnerReadTables: ['kovo_runtime_notes'],
      dataDir,
      driver: 'pglite',
      schema,
    });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('uses engine roles, not kovo.role GUCs, for admin and system RLS scope', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-engine-roles-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({
      crossOwnerReadTables: ['kovo_runtime_notes'],
      dataDir,
      driver: 'pglite',
      schema,
      seedSql,
    });

    try {
      await runtime.ready;
      const systemDb = runtime.systemDb({
        operation: 'write',
        reason: 'repair every note in engine-role proof',
        surface: 'postgres-runtime.test',
      });
      await systemDb.update(notes).set({ title: 'System repaired' });
      await expect(systemDb.select().from(notes).orderBy(notes.id)).resolves.toEqual([
        { id: 'n1', ownerId: 'u1', secretNote: 's1', title: 'System repaired' },
        { id: 'n2', ownerId: 'u2', secretNote: 's2', title: 'System repaired' },
      ]);
    } finally {
      await runtime.close();
    }

    const policies = await queryPglite<{
      policyname: string;
      qual: string | null;
      roles: string[];
      with_check: string | null;
    }>(
      dataDir,
      [
        'SELECT policyname, roles, qual, with_check',
        'FROM pg_policies',
        "WHERE tablename IN ('kovo_runtime_notes', 'kovo_runtime_labels')",
        "AND policyname IN ('kovo_admin_scope', 'kovo_system_scope')",
        'ORDER BY tablename, policyname',
      ].join(' '),
    );
    expect(policies.rows).toEqual(
      expect.arrayContaining([
        {
          policyname: 'kovo_admin_scope',
          qual: 'true',
          roles: ['kovo_admin'],
          with_check: null,
        },
        {
          policyname: 'kovo_system_scope',
          qual: 'true',
          roles: ['kovo_system'],
          with_check: 'true',
        },
      ]),
    );
    expect(
      policies.rows.some(
        (policy) => policy.qual?.includes('kovo.role') || policy.with_check?.includes('kovo.role'),
      ),
    ).toBe(false);

    await usingPgliteRole(dataDir, 'kovo_reader', async (client) => {
      await client.exec("SET kovo.role = 'admin'");
      await expect(
        client.query('SELECT id, title FROM kovo_runtime_notes ORDER BY id'),
      ).resolves.toMatchObject({ rows: [] });
    });
    await usingPgliteRole(dataDir, 'kovo_writer', async (client) => {
      await client.exec("SET kovo.role = 'system'");
      await expect(
        client.query("UPDATE kovo_runtime_notes SET title = 'forged system' RETURNING id"),
      ).resolves.toMatchObject({ rows: [] });
    });
    await usingPgliteRole(dataDir, 'kovo_admin', async (client) => {
      await expect(
        client.query('SELECT id, title FROM kovo_runtime_notes ORDER BY id'),
      ).resolves.toMatchObject({
        rows: [
          { id: 'n1', title: 'System repaired' },
          { id: 'n2', title: 'System repaired' },
        ],
      });
      await expect(client.query('SELECT id, label FROM kovo_runtime_labels')).rejects.toThrow();
    });

    const memberships = await queryPglite<{
      reader_can_admin: boolean;
      reader_can_system: boolean;
      writer_can_admin: boolean;
      writer_can_system: boolean;
    }>(
      dataDir,
      [
        'SELECT',
        "pg_has_role('kovo_reader', 'kovo_admin', 'USAGE') AS reader_can_admin,",
        "pg_has_role('kovo_reader', 'kovo_system', 'USAGE') AS reader_can_system,",
        "pg_has_role('kovo_writer', 'kovo_admin', 'USAGE') AS writer_can_admin,",
        "pg_has_role('kovo_writer', 'kovo_system', 'USAGE') AS writer_can_system",
      ].join(' '),
    );
    expect(memberships.rows[0]).toEqual({
      reader_can_admin: false,
      reader_can_system: false,
      writer_can_admin: false,
      writer_can_system: false,
    });
  });

  it('discards node-postgres session state before pooled client reuse', async () => {
    const log: string[] = [];
    const sessionState = new Map<string, string>();
    const client = {
      async query(statement: string) {
        log.push(statement);
        const normalized = statement.trim().toUpperCase();
        if (normalized === 'DISCARD ALL') sessionState.clear();
        else if (normalized.startsWith('SET ROLE ')) sessionState.set('role', statement);
        else if (normalized.startsWith('SET KOVO.ROLE')) sessionState.set('kovo.role', statement);
        return { rows: [] };
      },
      release(error?: Error | boolean) {
        log.push(error === undefined ? 'release' : `release:${String(error)}`);
      },
    };
    const pool = {
      async connect() {
        log.push('connect');
        return client;
      },
      async end() {
        log.push('end');
      },
    };
    const runtimeClient = __testPostgresRuntimeInternals.createNodePostgresRuntimeClient(
      pool as never,
    );

    await runtimeClient.transaction(async (tx) => {
      await tx.exec('SET ROLE kovo_admin');
      await tx.exec("SET kovo.role = 'admin'");
      expect(Object.fromEntries(sessionState)).toEqual({
        'kovo.role': "SET kovo.role = 'admin'",
        role: 'SET ROLE kovo_admin',
      });
    });
    expect(Object.fromEntries(sessionState)).toEqual({});

    await runtimeClient.transaction(async () => {
      expect(Object.fromEntries(sessionState)).toEqual({});
    });

    expect(log).toEqual([
      'connect',
      'BEGIN',
      'SET ROLE kovo_admin',
      "SET kovo.role = 'admin'",
      'COMMIT',
      'DISCARD ALL',
      'release',
      'connect',
      'BEGIN',
      'COMMIT',
      'DISCARD ALL',
      'release',
    ]);
  });

  it('requires separate external Postgres URLs for framework admin and system roles', async () => {
    const baseConfig = __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
      crossOwnerReadTables: ['kovo_runtime_notes'],
      databaseUrl: 'postgres://app-runtime@127.0.0.1/kovo',
      driver: 'node-postgres',
      postureCheck: {
        justification: 'unit test constructs handles without connecting',
        onBoot: false,
      },
      provisionOnBoot: false,
      schema,
    });
    const appOnlyClient = __testPostgresRuntimeInternals.createRuntimeClient(baseConfig);
    try {
      expect(() => appOnlyClient.drizzleReadonlyDb('u1', 'kovo_reader')).not.toThrow();
      expect(() => appOnlyClient.drizzleReadonlyDb('u1', 'kovo_reader', 'admin')).toThrow(
        /adminDatabaseUrl\/KOVO_DB_ADMIN_URL/,
      );
      expect(() => appOnlyClient.drizzleRequestDb(undefined, 'system')).toThrow(
        /systemDatabaseUrl\/KOVO_DB_SYSTEM_URL/,
      );
    } finally {
      await appOnlyClient.close();
    }

    const privilegedConfig = __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
      adminDatabaseUrl: 'postgres://framework-admin@127.0.0.1/kovo',
      crossOwnerReadTables: ['kovo_runtime_notes'],
      databaseUrl: 'postgres://app-runtime@127.0.0.1/kovo',
      driver: 'node-postgres',
      postureCheck: {
        justification: 'unit test constructs handles without connecting',
        onBoot: false,
      },
      provisionOnBoot: false,
      schema,
      systemDatabaseUrl: 'postgres://framework-system@127.0.0.1/kovo',
    });
    const privilegedClient = __testPostgresRuntimeInternals.createRuntimeClient(privilegedConfig);
    try {
      expect(() => privilegedClient.drizzleReadonlyDb('u1', 'kovo_reader', 'admin')).not.toThrow();
      expect(() => privilegedClient.drizzleRequestDb(undefined, 'system')).not.toThrow();
    } finally {
      await privilegedClient.close();
    }
  });

  it('provisions custom authzPolicy predicates as FORCE RLS policies', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-authz-policy-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      schema: teamSchema,
      seedSql: teamSeedSql,
    });

    try {
      await runtime.ready;
      const u1Db = runtime.db({ principalPosture: actAsRuntimePrincipal('u1') });
      const u2Db = runtime.db({ principalPosture: actAsRuntimePrincipal('u2') });

      await expect(u1Db.select().from(teamDocuments)).resolves.toEqual([
        { id: 'd1', teamId: 'team-a', title: 'Alpha' },
      ]);
      await expect(u2Db.select().from(teamDocuments)).resolves.toEqual([
        { id: 'd2', teamId: 'team-b', title: 'Beta' },
      ]);

      await u1Db.insert(teamMemberships).values({
        id: 'm3',
        teamId: 'team-c',
        userId: 'u1',
      });
      await expect(
        u1Db.insert(teamMemberships).values({
          id: 'blocked-membership',
          teamId: 'team-c',
          userId: 'u2',
        }),
      ).rejects.toThrow(/Failed query|row-level security/i);
      await u1Db.delete(teamMemberships).where(eq(teamMemberships.id, 'm3'));
      await expect(u1Db.select().from(teamMemberships)).resolves.toEqual([
        { id: 'm1', teamId: 'team-a', userId: 'u1' },
      ]);

      await u1Db.insert(teamDocuments).values({
        id: 'd3',
        teamId: 'team-a',
        title: 'Alpha draft',
      });
      await expect(
        u2Db.insert(teamDocuments).values({
          id: 'blocked',
          teamId: 'team-a',
          title: 'Cross-team draft',
        }),
      ).rejects.toThrow();

      const u1Titles = (await u1Db.select().from(teamDocuments))
        .map((document) => document.title)
        .sort((left, right) => left.localeCompare(right));
      expect(u1Titles).toEqual(['Alpha', 'Alpha draft']);
      await expect(u2Db.select().from(teamDocuments)).resolves.toEqual([
        { id: 'd2', teamId: 'team-b', title: 'Beta' },
      ]);
    } finally {
      await runtime.close();
    }

    const report = await checkPostgresAppDbPosture({
      dataDir,
      driver: 'pglite',
      schema: teamSchema,
    });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('reports missing FORCE RLS and policy posture for custom authzPolicy tables', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-authz-policy-posture-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      schema: teamSchema,
      seedSql: teamSeedSql,
    });

    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    await execPglite(
      dataDir,
      'ALTER TABLE "kovo_runtime_team_documents" NO FORCE ROW LEVEL SECURITY',
    );
    let report = await checkPostgresAppDbPosture({
      dataDir,
      driver: 'pglite',
      schema: teamSchema,
    });
    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('KV433_FORCE_RLS');

    await execPglite(dataDir, 'ALTER TABLE "kovo_runtime_team_documents" FORCE ROW LEVEL SECURITY');
    await execPglite(dataDir, 'DROP POLICY kovo_authz_policy ON "kovo_runtime_team_documents"');
    report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema: teamSchema });
    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('KV433_AUTHZ_POLICY');
  });

  it('fails closed for unsupported custom authzPolicy SQL shapes', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-authz-policy-bad-'));
    roots.push(dataDir);

    expect(() =>
      createPostgresAppRuntimeDb({
        dataDir,
        driver: 'pglite',
        schema: { parameterizedPolicyDocuments },
      }),
    ).toThrow(/KV433_AUTHZ_POLICY_UNSUPPORTED/);
  });
});

async function execPglite(dataDir: string, statement: string): Promise<void> {
  const client = new PGlite(dataDir);
  try {
    await client.exec(statement);
  } finally {
    await client.close();
  }
}

async function queryPglite<Row>(dataDir: string, statement: string): Promise<{ rows: Row[] }> {
  const client = new PGlite(dataDir);
  try {
    return await client.query<Row>(statement);
  } finally {
    await client.close();
  }
}

async function usingPgliteRole(
  dataDir: string,
  role: string,
  callback: (client: PGlite) => Promise<void>,
): Promise<void> {
  const client = new PGlite(dataDir);
  try {
    await client.exec('BEGIN');
    await client.exec(`SET LOCAL ROLE ${quoteTestIdent(role)}`);
    await callback(client);
  } finally {
    await client.exec('ROLLBACK').catch(() => undefined);
    await client.close();
  }
}

async function withPostgresRoleEnv<Result>(
  roles: { reader: string; writer: string },
  callback: () => Promise<Result>,
): Promise<Result> {
  const previousReader = process.env.KOVO_DB_READER_ROLE;
  const previousWriter = process.env.KOVO_DB_WRITER_ROLE;
  process.env.KOVO_DB_READER_ROLE = roles.reader;
  process.env.KOVO_DB_WRITER_ROLE = roles.writer;
  try {
    return await callback();
  } finally {
    restoreEnv('KOVO_DB_READER_ROLE', previousReader);
    restoreEnv('KOVO_DB_WRITER_ROLE', previousWriter);
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function quoteTestIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function rowsOf<Row>(result: Row[] | { rows?: Row[] }): Row[] {
  return Array.isArray(result) ? result : (result.rows ?? []);
}
