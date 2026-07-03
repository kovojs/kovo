import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { kovo, sql, trustedSql } from '@kovojs/drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  drainCrossOwnerReadAuditFacts,
  kovoReadonlyDbHandle,
  type KovoReadonlyDbCapable,
  type Reader,
} from './managed-db.js';
import { declareSystemPrincipal } from './auth-principal.js';
import { guards } from './guards.js';
import {
  checkPostgresAppDbPosture,
  createPostgresAppRuntimeDb,
  type KovoPostgresRuntimeDb,
} from './postgres-runtime.js';

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

const schema = { labels, notes };
const seedSql = [
  'INSERT INTO kovo_runtime_notes (id, "ownerId", "secretNote", title) VALUES ' +
    "('n1', 'u1', 's1', 'One'), ('n2', 'u2', 's2', 'Two')",
  "INSERT INTO kovo_runtime_labels (id, label) VALUES ('l1', 'Inbox')",
];

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
    reference: true,
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
      const u1Db = runtime.db({ principalPosture: { kind: 'act-as', principal: 'u1' } });
      const u2Db = runtime.db({ principalPosture: { kind: 'act-as', principal: 'u2' } });

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

  it('threads Postgres rawRead through the runtime reader without bypassing RLS or column grants', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-raw-read-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });

    try {
      await runtime.ready;
      const writer = runtime.db({ principalPosture: { kind: 'act-as', principal: 'u1' } });
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

  it('uses an audited system posture for cross-owner owner-table work without bypassing RLS', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-system-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });

    try {
      await runtime.ready;
      const u1Db = runtime.db({ principalPosture: { kind: 'act-as', principal: 'u1' } });
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

  it('reports a missing provisioned posture without running DDL during check', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-empty-'));
    roots.push(dataDir);

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('KV433_SCHEMA_FINGERPRINT');
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
      const u1Db = runtime.db({ principalPosture: { kind: 'act-as', principal: 'u1' } });
      const u2Db = runtime.db({ principalPosture: { kind: 'act-as', principal: 'u2' } });

      await expect(u1Db.select().from(teamDocuments)).resolves.toEqual([
        { id: 'd1', teamId: 'team-a', title: 'Alpha' },
      ]);
      await expect(u2Db.select().from(teamDocuments)).resolves.toEqual([
        { id: 'd2', teamId: 'team-b', title: 'Beta' },
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

function rowsOf<Row>(result: Row[] | { rows?: Row[] }): Row[] {
  return Array.isArray(result) ? result : (result.rows ?? []);
}
