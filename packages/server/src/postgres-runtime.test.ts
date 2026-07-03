import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { kovo, sql } from '@kovojs/drizzle';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it } from 'vitest';

import { checkPostgresAppDbPosture, createPostgresAppRuntimeDb } from './postgres-runtime.js';

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

  it('reports a missing provisioned posture without running DDL during check', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-empty-'));
    roots.push(dataDir);

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('KV433_SCHEMA_FINGERPRINT');
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
