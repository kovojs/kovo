import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lookup as dnsLookup } from 'node:dns/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { kovo, sql, trustedSql } from '@kovojs/drizzle';
import { eq } from 'drizzle-orm';
import { PgDialect, bigint, pgSchema, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { Client, Pool } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import {
  drainCrossOwnerReadAuditFacts,
  drainPostgresRlsSilentDenyDiagnostics,
  managedDb,
} from './managed-db.js';
import { actAsNonRequestPrincipal, declareSystemPrincipal } from './auth-principal.js';
import { isDurableCapabilityReplayStore } from './capability-url.js';
import { guards } from './guards.js';
import { usePostgresAppRuntimeDb, usePostgresSystemDb } from './internal/postgres-capability.js';
import {
  checkPostgresAppDbPosture,
  createPostgresAppRuntimeDb,
  declarePublicRelation,
  drainPostgresPostureCheckOptOutFacts,
  __testPostgresRuntimeInternals,
  migratePostgresAppDb,
  postgresSchemaModule,
  provisionPostgresAppDb,
  type KovoPostgresAppRuntimeOptions,
  type KovoPostgresAppRuntimeDb,
  type KovoPostgresRuntimeDb,
} from './postgres-runtime.js';
import { PostgresDurableTaskQueue, createDurableTaskSqlExecutor } from './task-queue.js';
import { mintMutationIdemToken } from './mutation-idem.js';
import { isDurableMutationReplayStore } from './replay.js';
import { replayMutationWireBody } from './response.js';
import { isDurableWebhookReplayStore } from './webhook.js';

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
    domain: 'runtime-labels',
    key: 'id',
    reference: true,
  }),
);

const guardAssertionNotes = pgTable(
  'kovo_runtime_guard_assertion_notes',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    title: text('title').notNull(),
  },
  kovo({
    authzPolicy: 'the request guard checks note ownership',
    domain: 'runtime-guard-assertion-notes',
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

const bigintNotes = pgTable(
  'kovo_runtime_bigint_notes',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    lastRequest: bigint('lastRequest', { mode: 'number' }).notNull(),
  },
  kovo({
    domain: 'runtime-bigint-notes',
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
const postgresRuntimeTestRequire = createRequire(import.meta.url);
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

const primordialPolicyPredicate = sql`"ownerId" = current_setting('kovo.principal', true)`;
const primordialPolicyNotes = pgTable(
  'kovo_runtime_primordial_policy_notes',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
  },
  kovo({
    authzPolicy: primordialPolicyPredicate,
    domain: 'runtime-primordial-policy-notes',
    key: 'id',
  }),
);

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
      // SPEC §10.3: the framework-owned aggregate is immutable even when app helpers retain it;
      // request DB and replay authority cannot be replaced before createApp snapshots a provider.
      expect(Object.isFrozen(runtime)).toBe(true);
      expect(Object.isFrozen(runtime.db)).toBe(true);
      expect(typeof runtime.db).toBe('object');
      expect(Reflect.ownKeys(runtime.db)).toEqual([]);
      assertOpaquePostgresProviderTypes(runtime);
      const originalDb = runtime.db;
      const poison = (value: typeof runtime) => Reflect.set(value, 'db', () => ({ forged: true }));
      expect(poison(runtime)).toBe(false);
      expect(runtime.db).toBe(originalDb);
      expect(isDurableCapabilityReplayStore(runtime.capabilityReplayStore)).toBe(true);
      expect(isDurableMutationReplayStore(runtime.mutationReplayStore)).toBe(true);
      expect(isDurableWebhookReplayStore(runtime.webhookReplayStore)).toBe(true);
      await runtime.ready;
      const expiresAt = Date.now() + 60_000;
      await expect(
        runtime.capabilityReplayStore.consume('runtime-capability', expiresAt),
      ).resolves.toBe(true);
      await expect(
        runtime.capabilityReplayStore.consume('runtime-capability', expiresAt),
      ).resolves.toBe(false);
      const u1Db = usePostgresAppRuntimeDb(runtime, {
        principalPosture: actAsRuntimePrincipal('u1'),
      });
      const u2Db = usePostgresAppRuntimeDb(runtime, {
        principalPosture: actAsRuntimePrincipal('u2'),
      });

      await expect(
        u1Db.select({ id: notes.id, ownerId: notes.ownerId, title: notes.title }).from(notes),
      ).resolves.toEqual([{ id: 'n1', ownerId: 'u1', title: 'One' }]);
      await expect(
        u2Db.select({ id: notes.id, ownerId: notes.ownerId, title: notes.title }).from(notes),
      ).resolves.toEqual([{ id: 'n2', ownerId: 'u2', title: 'Two' }]);
    } finally {
      await runtime.close();
    }

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('fails posture on weakened temporal replay constraints, column type, and cleanup index', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-replay-shape-'));
    roots.push(dataDir);
    const initial = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema });
    await initial.ready;
    await initial.close();

    const weakened = new PGlite(dataDir);
    await weakened.exec(
      [
        'ALTER TABLE _kovo_replay DROP CONSTRAINT _kovo_replay_surface_check;',
        'ALTER TABLE _kovo_replay DROP CONSTRAINT _kovo_replay_expires_at_check;',
        'ALTER TABLE _kovo_replay DROP CONSTRAINT _kovo_replay_surface_state_expiry_check;',
        'DROP INDEX _kovo_replay_committed_expiry_idx;',
        "ALTER TABLE _kovo_replay ADD CONSTRAINT _kovo_replay_surface_check CHECK (surface IN ('capability', 'mutation', 'webhook', 'attacker'));",
        'ALTER TABLE _kovo_replay ADD CONSTRAINT _kovo_replay_expires_at_check CHECK (expires_at IS NULL OR expires_at >= 0);',
        'ALTER TABLE _kovo_replay ADD CONSTRAINT _kovo_replay_surface_state_expiry_check CHECK (expires_at IS NULL OR expires_at IS NOT NULL);',
        "CREATE INDEX _kovo_replay_committed_expiry_idx ON _kovo_replay (created_at) WHERE state = 'committed';",
      ].join(' '),
    );
    await weakened.close();

    const weakenedReport = await checkPostgresAppDbPosture({
      dataDir,
      driver: 'pglite',
      schema,
    });
    expect(weakenedReport.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'KV433_REPLAY_STORE_SCHEMA' })]),
    );

    const repaired = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema });
    await repaired.ready;
    await repaired.close();
    await expect(
      checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema }),
    ).resolves.toMatchObject({ ok: true, issues: [] });

    const wrongType = new PGlite(dataDir);
    await wrongType.exec(
      [
        'ALTER TABLE _kovo_replay DROP CONSTRAINT _kovo_replay_expires_at_check;',
        'ALTER TABLE _kovo_replay DROP CONSTRAINT _kovo_replay_surface_state_expiry_check;',
        'DROP INDEX _kovo_replay_committed_expiry_idx;',
        'ALTER TABLE _kovo_replay ALTER COLUMN expires_at TYPE text USING expires_at::text;',
        "ALTER TABLE _kovo_replay ADD CONSTRAINT _kovo_replay_expires_at_check CHECK (expires_at IS NULL OR expires_at <> '');",
        'ALTER TABLE _kovo_replay ADD CONSTRAINT _kovo_replay_surface_state_expiry_check CHECK (expires_at IS NULL OR expires_at IS NOT NULL);',
        "CREATE INDEX _kovo_replay_committed_expiry_idx ON _kovo_replay (surface, expires_at) WHERE state = 'committed';",
      ].join(' '),
    );
    await wrongType.close();

    const wrongTypeReport = await checkPostgresAppDbPosture({
      dataDir,
      driver: 'pglite',
      schema,
    });
    expect(wrongTypeReport.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'KV433_REPLAY_STORE_SCHEMA' })]),
    );
  });

  it('reports and rejects legacy mutation truth without authenticated expiry', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-replay-cutover-'));
    roots.push(dataDir);
    const initial = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema });
    await initial.ready;
    const idem = mintMutationIdemToken();
    const reservation = await initial.mutationReplayStore.reserve('legacy', idem, 'fingerprint');
    expect(reservation).toBeDefined();
    await reservation?.commit({
      body: replayMutationWireBody('', { reason: 'Postgres legacy-cutover posture fixture' }),
      headers: {},
      status: 200,
    });
    await initial.close();

    const legacy = new PGlite(dataDir);
    await legacy.exec(
      [
        'ALTER TABLE _kovo_replay DROP CONSTRAINT _kovo_replay_surface_state_expiry_check;',
        "UPDATE _kovo_replay SET expires_at = NULL WHERE surface = 'mutation'",
      ].join(' '),
    );
    await legacy.close();

    await expect(
      checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema }),
    ).resolves.toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'KV433_REPLAY_STORE_CUTOVER' }),
      ]),
    });

    const rejected = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema });
    try {
      await expect(rejected.ready).rejects.toThrow(
        /KV433_REPLAY_STORE_CUTOVER[\s\S]*operator cutover/u,
      );
    } finally {
      await rejected.close();
    }
  });

  it('fails posture and repairs a weakened or incomplete replay rollback watermark', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-replay-watermark-'));
    roots.push(dataDir);
    const initial = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema });
    await initial.ready;
    await initial.close();

    const weakened = new PGlite(dataDir);
    await weakened.exec(
      [
        'ALTER TABLE _kovo_replay_reclaimed DROP CONSTRAINT _kovo_replay_reclaimed_value_check;',
        'ALTER TABLE _kovo_replay_reclaimed ADD CONSTRAINT _kovo_replay_reclaimed_value_check CHECK (reclaimed_through >= -1);',
        "DELETE FROM _kovo_replay_reclaimed WHERE surface = 'webhook'",
      ].join(' '),
    );
    await weakened.close();

    await expect(
      checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema }),
    ).resolves.toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'KV433_REPLAY_STORE_SCHEMA' }),
      ]),
    });

    const repaired = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema });
    await repaired.ready;
    await repaired.close();
    await expect(
      checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema }),
    ).resolves.toMatchObject({ ok: true, issues: [] });
  });

  it('fails posture when durable replay admission or response-storage bounds are weakened', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-replay-capacity-'));
    roots.push(dataDir);
    const initial = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema });
    await initial.ready;
    await initial.close();

    const weakened = new PGlite(dataDir);
    await weakened.exec(
      [
        'ALTER TABLE _kovo_replay DROP CONSTRAINT _kovo_replay_admission_slot_check;',
        'ALTER TABLE _kovo_replay DROP CONSTRAINT _kovo_replay_state_response_check;',
        'ALTER TABLE _kovo_replay DROP CONSTRAINT _kovo_replay_response_size_check;',
        'DROP INDEX _kovo_replay_admission_slot_idx;',
        'DROP INDEX _kovo_replay_committed_expiry_idx;',
        "ALTER TABLE _kovo_replay ADD CONSTRAINT _kovo_replay_admission_slot_check CHECK (surface = 'capability' OR admission_slot > 0);",
        'ALTER TABLE _kovo_replay ADD CONSTRAINT _kovo_replay_state_response_check CHECK (state IS NOT NULL);',
        'ALTER TABLE _kovo_replay ADD CONSTRAINT _kovo_replay_response_size_check CHECK (response_body IS NULL OR response_body IS NOT NULL);',
        "CREATE UNIQUE INDEX _kovo_replay_admission_slot_idx ON _kovo_replay (surface, admission_slot) WHERE surface IN ('mutation', 'webhook');",
        "CREATE INDEX _kovo_replay_committed_expiry_idx ON _kovo_replay (surface, expires_at) WHERE surface = 'capability';",
      ].join(' '),
    );
    await weakened.close();

    await expect(
      checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema }),
    ).resolves.toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'KV433_REPLAY_STORE_SCHEMA' }),
      ]),
    });

    const repaired = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema });
    await repaired.ready;
    await repaired.close();
    await expect(
      checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema }),
    ).resolves.toMatchObject({ ok: true, issues: [] });
  });

  it('fails posture and repairs a missing durable replay identity primary key', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-replay-identity-'));
    roots.push(dataDir);
    const initial = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema });
    await initial.ready;
    await initial.close();

    const weakened = new PGlite(dataDir);
    await weakened.exec('ALTER TABLE _kovo_replay DROP CONSTRAINT _kovo_replay_pkey');
    await weakened.close();

    await expect(
      checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema }),
    ).resolves.toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'KV433_REPLAY_STORE_SCHEMA' }),
      ]),
    });

    const repaired = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema });
    await repaired.ready;
    const idem = mintMutationIdemToken();
    const owner = await repaired.mutationReplayStore.reserve(
      'session:save',
      idem,
      'same-fingerprint',
    );
    const duplicate = await repaired.mutationReplayStore.reserve(
      'session:save',
      idem,
      'same-fingerprint',
    );
    expect(owner).toBeDefined();
    expect(duplicate).toBeUndefined();
    await owner?.abort?.();
    await repaired.close();

    await expect(
      checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema }),
    ).resolves.toMatchObject({ ok: true, issues: [] });
  });

  it('fails provisioning when duplicate replay truth prevents identity-key repair', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-replay-duplicate-'));
    roots.push(dataDir);
    const initial = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema });
    await initial.ready;
    await initial.close();

    const weakened = new PGlite(dataDir);
    await weakened.exec(
      [
        'ALTER TABLE _kovo_replay DROP CONSTRAINT _kovo_replay_pkey;',
        'INSERT INTO _kovo_replay ',
        '(surface, scope, idem, fingerprint, generation, state, admission_slot, expires_at) VALUES ',
        "('mutation', 'same-scope', 'same-idem', NULL, 'generation-1', 'pending', 1, 9999999999999),",
        "('mutation', 'same-scope', 'same-idem', NULL, 'generation-2', 'pending', 2, 9999999999999)",
      ].join(' '),
    );
    await weakened.close();

    const rejected = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema });
    try {
      await expect(rejected.ready).rejects.toThrow(/unique|duplicate/i);
    } finally {
      await rejected.close();
    }
  });

  it('detects and revokes non-system replay privileges granted to app roles', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-replay-column-acl-'));
    roots.push(dataDir);
    const initial = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema });
    await initial.ready;
    await initial.close();

    const weakened = new PGlite(dataDir);
    await weakened.exec(
      [
        'GRANT SELECT (scope) ON _kovo_replay TO kovo_writer;',
        'GRANT INSERT (surface, scope, idem, fingerprint, generation, state, admission_slot) ',
        'ON _kovo_replay TO kovo_writer;',
        'GRANT UPDATE (state, response_body, response_headers, response_status, committed_at) ',
        'ON _kovo_replay TO kovo_writer;',
        'GRANT TRUNCATE ON _kovo_replay TO kovo_writer;',
        'GRANT TRIGGER ON _kovo_replay TO kovo_system;',
        'GRANT SELECT (reclaimed_through) ON _kovo_replay_reclaimed TO kovo_writer;',
        'GRANT INSERT (surface, reclaimed_through) ON _kovo_replay_reclaimed TO kovo_writer;',
        'GRANT DELETE ON _kovo_replay_reclaimed TO kovo_system',
      ].join(' '),
    );
    await weakened.close();

    await expect(
      checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema }),
    ).resolves.toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'KV433_REPLAY_STORE_ACL' })]),
    });

    const repaired = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema });
    await repaired.ready;
    await repaired.close();
    await expect(
      checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema }),
    ).resolves.toMatchObject({ ok: true, issues: [] });
  });

  it('does not dispatch a one-shot Array.join poison while committing owner RLS', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-policy-primordial-'));
    roots.push(dataDir);
    const nativeJoin = Array.prototype.join;
    let triggered = 0;
    Array.prototype.join = function (this: unknown[], separator?: string): string {
      if (
        this.length === 3 &&
        typeof this[0] === 'string' &&
        this[0].startsWith('CREATE POLICY kovo_owner_scope') &&
        typeof this[2] === 'string' &&
        this[2].startsWith('USING (')
      ) {
        triggered += 1;
        Array.prototype.join = nativeJoin;
        return Reflect.apply(
          nativeJoin,
          [this[0], this[1], 'USING (true) WITH CHECK (true)'],
          [separator],
        );
      }
      return Reflect.apply(nativeJoin, this, [separator]);
    } as typeof Array.prototype.join;

    const runtime = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      schema: { notes },
      seedSql: [
        'INSERT INTO kovo_runtime_notes (id, "ownerId", "secretNote", title) VALUES ' +
          "('n1', 'u1', 's1', 'One'), ('n2', 'u2', 's2', 'Two')",
      ],
    });
    try {
      await runtime.ready;
      await expect(
        usePostgresAppRuntimeDb(runtime, {
          principalPosture: actAsRuntimePrincipal('u1'),
        })
          .select({ id: notes.id })
          .from(notes),
      ).resolves.toEqual([{ id: 'n1' }]);
      expect(triggered).toBe(0);
    } finally {
      Array.prototype.join = nativeJoin;
      await runtime.close();
    }

    const committedPolicy = await queryPglite<{ qual: string; with_check: string }>(
      dataDir,
      [
        'SELECT qual, with_check FROM pg_policies',
        "WHERE schemaname = 'public' AND tablename = 'kovo_runtime_notes'",
        "AND policyname = 'kovo_owner_scope'",
      ].join(' '),
    );
    expect(committedPolicy.rows).toHaveLength(1);
    expect(committedPolicy.rows[0]?.qual).toContain('"ownerId"');
    expect(committedPolicy.rows[0]?.qual).toContain(
      "current_setting('kovo.principal'::text, true)",
    );
    expect(committedPolicy.rows[0]?.with_check).toBe(committedPolicy.rows[0]?.qual);
  });

  it('rejects a Proxy schema before its first ownKeys trap can hide a protected table', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-schema-proxy-'));
    roots.push(dataDir);
    const schemaTarget = { labels, notes };
    let triggered = 0;
    const handler: ProxyHandler<typeof schemaTarget> = {
      ownKeys() {
        triggered += 1;
        handler.ownKeys = Reflect.ownKeys;
        return ['labels'];
      },
    };
    const proxySchema = new Proxy(schemaTarget, handler);

    expect(() =>
      createPostgresAppRuntimeDb({
        dataDir,
        driver: 'pglite',
        schema: proxySchema,
        seedSql: [
          [
            'CREATE TABLE kovo_runtime_notes (id text PRIMARY KEY, "ownerId" text NOT NULL, "secretNote" text NOT NULL, title text NOT NULL)',
            'GRANT SELECT ON kovo_runtime_notes TO kovo_reader, kovo_writer',
            'INSERT INTO kovo_runtime_notes (id, "ownerId", "secretNote", title) VALUES ' +
              "('n1', 'u1', 's1', 'One'), ('n2', 'u2', 's2', 'Two')",
          ].join('; '),
        ],
      }),
    ).toThrow(/Postgres runtime schema must not be a Proxy/);
    expect(triggered).toBe(0);
  });

  // @kovo-security-classifier-corpus postgres-identity-posture
  it('rejects cross-schema duplicate base names before secret grant metadata can collide', () => {
    const wholeSecretSchema = pgSchema('whole_secret_scope');
    const partialSecretSchema = pgSchema('partial_secret_scope');
    const wholeSecretRecords = wholeSecretSchema.table(
      'duplicate_security_records',
      {
        classified: text('classified').notNull(),
        id: text('id').primaryKey(),
        ownerId: text('owner_id').notNull(),
      },
      kovo({
        domain: 'whole-secret-duplicate-records',
        key: 'id',
        owner: 'ownerId',
        secret: true,
      }),
    );
    const partialSecretRecords = partialSecretSchema.table(
      'duplicate_security_records',
      {
        classified: text('classified').notNull(),
        id: text('id').primaryKey(),
        ownerId: text('owner_id').notNull(),
        publicLabel: text('public_label').notNull(),
      },
      kovo({
        domain: 'partial-secret-duplicate-records',
        key: 'id',
        owner: 'ownerId',
        secret: ['classified'],
      }),
    );

    for (const duplicateSchema of [
      { partialSecretRecords, wholeSecretRecords },
      { wholeSecretRecords, partialSecretRecords },
    ]) {
      expect(() =>
        createPostgresAppRuntimeDb({ driver: 'pglite', schema: duplicateSchema }),
      ).toThrow(
        /KV433_DUPLICATE_TABLE_NAME.*whole_secret_scope\.duplicate_security_records.*partial_secret_scope\.duplicate_security_records|KV433_DUPLICATE_TABLE_NAME.*partial_secret_scope\.duplicate_security_records.*whole_secret_scope\.duplicate_security_records/u,
      );
    }
  });

  it('rejects ordinary schema accessors without invoking them', () => {
    let getterHits = 0;
    const accessorSchema = Object.defineProperty({}, 'notes', {
      enumerable: true,
      get() {
        getterHits += 1;
        return notes;
      },
    });

    expect(() => createPostgresAppRuntimeDb({ driver: 'pglite', schema: accessorSchema })).toThrow(
      /Postgres runtime schema properties must be own data/,
    );
    expect(getterHits).toBe(0);
  });

  it('normalizes one stable ESM namespace snapshot and rejects a changing live binding', () => {
    let ordinaryHits = 0;
    const ordinaryAccessor = Object.defineProperty({}, 'notes', {
      enumerable: true,
      get() {
        ordinaryHits += 1;
        return notes;
      },
    });
    expect(() => postgresSchemaModule(ordinaryAccessor)).toThrow(
      /Postgres bundled schema module namespace properties must be own data/,
    );
    expect(ordinaryHits).toBe(0);

    let stableHits = 0;
    const stableNamespace = Object.create(null) as Record<PropertyKey, unknown>;
    Object.defineProperty(stableNamespace, Symbol.toStringTag, {
      configurable: false,
      enumerable: false,
      value: 'Module',
      writable: false,
    });
    Object.defineProperty(stableNamespace, 'notes', {
      configurable: false,
      enumerable: true,
      get() {
        stableHits += 1;
        return notes;
      },
    });
    Object.preventExtensions(stableNamespace);

    const snapshot = postgresSchemaModule(stableNamespace);
    expect(stableHits).toBe(2);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.getPrototypeOf(snapshot)).toBe(null);
    expect(Object.getOwnPropertyDescriptor(snapshot, 'notes')).toMatchObject({ value: notes });

    let bundledHits = 0;
    const bundledNamespace = Object.freeze(
      Object.defineProperties(
        {},
        {
          [Symbol.toStringTag]: {
            configurable: false,
            enumerable: false,
            value: 'Module',
            writable: false,
          },
          notes: {
            configurable: false,
            enumerable: true,
            get() {
              bundledHits += 1;
              return notes;
            },
          },
        },
      ),
    );
    const bundledSnapshot = postgresSchemaModule(bundledNamespace);
    expect(bundledHits).toBe(2);
    expect(Object.getOwnPropertyDescriptor(bundledSnapshot, 'notes')).toMatchObject({
      value: notes,
    });

    let changingHits = 0;
    const changingNamespace = Object.create(null) as Record<PropertyKey, unknown>;
    Object.defineProperty(changingNamespace, Symbol.toStringTag, {
      configurable: false,
      enumerable: false,
      value: 'Module',
      writable: false,
    });
    Object.defineProperty(changingNamespace, 'notes', {
      configurable: false,
      enumerable: true,
      get() {
        changingHits += 1;
        return changingHits === 1 ? notes : labels;
      },
    });
    Object.preventExtensions(changingNamespace);

    expect(() => postgresSchemaModule(changingNamespace)).toThrow(
      /Postgres schema module namespace export notes changed while it was snapshotted/,
    );
    expect(changingHits).toBe(2);
  });

  it('does not dispatch a late PgDialect method while committing a custom RLS predicate', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-dialect-primordial-'));
    roots.push(dataDir);
    const nativeSqlToQuery = PgDialect.prototype.sqlToQuery;
    let triggered = 0;
    PgDialect.prototype.sqlToQuery = function (statement: unknown) {
      if (statement === primordialPolicyPredicate) {
        triggered += 1;
        PgDialect.prototype.sqlToQuery = nativeSqlToQuery;
        return { params: [], sql: 'true' };
      }
      return Reflect.apply(nativeSqlToQuery, this, [statement]);
    } as typeof PgDialect.prototype.sqlToQuery;

    const runtime = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      schema: { primordialPolicyNotes },
      seedSql: [
        'INSERT INTO kovo_runtime_primordial_policy_notes (id, "ownerId") VALUES ' +
          "('n1', 'u1'), ('n2', 'u2')",
      ],
    });
    try {
      await runtime.ready;
      await expect(
        usePostgresAppRuntimeDb(runtime, {
          principalPosture: actAsRuntimePrincipal('u1'),
        })
          .select({ id: primordialPolicyNotes.id })
          .from(primordialPolicyNotes)
          .orderBy(primordialPolicyNotes.id),
      ).resolves.toEqual([{ id: 'n1' }]);
      expect(triggered).toBe(0);
    } finally {
      PgDialect.prototype.sqlToQuery = nativeSqlToQuery;
      await runtime.close();
    }

    const committedPolicy = await queryPglite<{ qual: string; with_check: string }>(
      dataDir,
      [
        'SELECT qual, with_check FROM pg_policies',
        "WHERE schemaname = 'public' AND tablename = 'kovo_runtime_primordial_policy_notes'",
        "AND policyname = 'kovo_authz_policy'",
      ].join(' '),
    );
    expect(committedPolicy.rows).toHaveLength(1);
    expect(committedPolicy.rows[0]?.qual).toContain('"ownerId"');
    expect(committedPolicy.rows[0]?.qual).toContain(
      "current_setting('kovo.principal'::text, true)",
    );
    expect(committedPolicy.rows[0]?.with_check).toBe(committedPolicy.rows[0]?.qual);
  });

  it('does not dispatch a late PGlite transaction method for privileged policy DDL', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-driver-transaction-'));
    roots.push(dataDir);
    const nativeTransaction = PGlite.prototype.transaction;
    let transactionTriggered = 0;
    let ddlTriggered = 0;
    PGlite.prototype.transaction = function (
      callback: (tx: {
        exec: (statement: string, ...args: unknown[]) => Promise<unknown>;
      }) => Promise<unknown>,
      ...args: unknown[]
    ) {
      transactionTriggered += 1;
      PGlite.prototype.transaction = nativeTransaction;
      const wrapped = async (tx: {
        exec: (statement: string, ...args: unknown[]) => Promise<unknown>;
      }): Promise<unknown> => {
        const nativeExec = tx.exec;
        tx.exec = function (statement: string, ...execArgs: unknown[]) {
          if (statement.startsWith('CREATE POLICY kovo_owner_scope')) {
            ddlTriggered += 1;
            tx.exec = nativeExec;
            return Reflect.apply(nativeExec, tx, [
              'CREATE POLICY kovo_owner_scope ON "public"."kovo_runtime_notes" ' +
                'FOR ALL TO "kovo_reader", "kovo_writer" USING (true) WITH CHECK (true)',
              ...execArgs,
            ]);
          }
          return Reflect.apply(nativeExec, tx, [statement, ...execArgs]);
        };
        return callback(tx);
      };
      return Reflect.apply(nativeTransaction, this, [wrapped, ...args]);
    } as typeof PGlite.prototype.transaction;

    const runtime = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      schema: { notes },
      seedSql: [
        'INSERT INTO kovo_runtime_notes (id, "ownerId", "secretNote", title) VALUES ' +
          "('n1', 'u1', 's1', 'One'), ('n2', 'u2', 's2', 'Two')",
      ],
    });
    try {
      await runtime.ready;
      await expect(
        usePostgresAppRuntimeDb(runtime, {
          principalPosture: actAsRuntimePrincipal('u1'),
        })
          .select({ id: notes.id })
          .from(notes)
          .orderBy(notes.id),
      ).resolves.toEqual([{ id: 'n1' }]);
      expect(transactionTriggered).toBe(0);
      expect(ddlTriggered).toBe(0);
    } finally {
      PGlite.prototype.transaction = nativeTransaction;
      await runtime.close();
    }
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

  // @kovo-security-classifier-corpus egress-ip
  it('requires exact authenticated TLS for every non-local managed Postgres URL', () => {
    const rejectedModes = [
      '',
      '?sslmode=disable',
      '?sslmode=allow',
      '?sslmode=prefer',
      '?sslmode=require',
      '?sslmode=verify-ca',
      '?sslmode=no-verify',
      '?ssl=true',
      '?uselibpqcompat=true&sslmode=require',
      '?sslmode=%ZZ',
    ];
    for (const suffix of rejectedModes) {
      expect(() =>
        __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
          databaseUrl: `postgres://app@db.example:5432/kovo${suffix}`,
          driver: 'node-postgres',
          schema,
        }),
      ).toThrow(/KV433_POSTGRES_(?:TLS|URL): non-local databaseUrl|KV433_POSTGRES_URL:/);
    }

    for (const databaseUrl of [
      'postgres://app@db.example:5432/kovo?sslmode=verify-full',
      'postgres://app@db.example:5432/kovo?ssl%6dode=verify%2Dfull',
      // pg-connection-string is last-wins for duplicate query parameters.
      'postgres://app@db.example:5432/kovo?sslmode=disable&sslmode=verify-full',
    ]) {
      expect(() =>
        __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
          databaseUrl,
          driver: 'node-postgres',
          schema,
        }),
      ).not.toThrow();
    }

    expect(() =>
      __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
        databaseUrl: 'postgres://app@db.example:5432/kovo?sslmode=verify-full&sslmode=disable',
        driver: 'node-postgres',
        schema,
      }),
    ).toThrow(/KV433_POSTGRES_TLS: non-local databaseUrl/);
  });

  it('rejects every non-loopback IP literal because pg does not verify its certificate identity', () => {
    for (const databaseUrl of [
      'postgres://app@10.0.0.9:5432/kovo?sslmode=verify-full',
      'postgres://app@203.0.113.9:5432/kovo?sslmode=verify-full',
      'postgres://app@167772169:5432/kovo?sslmode=verify-full',
      'postgres://app@012.0.0.11:5432/kovo?sslmode=verify-full',
      'postgres://app@[2001:4860:4860::8888]:5432/kovo?sslmode=verify-full',
      'postgres://app@[fd12:3456::1]:5432/kovo?sslmode=verify-full',
      'postgres://app@[::ffff:10.0.0.9]:5432/kovo?sslmode=verify-full',
    ]) {
      expect(() =>
        __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
          databaseUrl,
          driver: 'node-postgres',
          schema,
        }),
      ).toThrow(/KV433_POSTGRES_TLS_HOST: non-local databaseUrl must use a DNS hostname/);
    }

    for (const databaseUrl of [
      'postgres://app@db.example:5432/kovo?host=10.0.0.9&sslmode=verify-full',
      'postgres://app@db.example:5432/kovo?host=2001%3A4860%3A4860%3A%3A8888&sslmode=verify-full',
      'postgres://app@db.example:5432/kovo?host=%3A%3Affff%3A10.0.0.9&sslmode=verify-full',
    ]) {
      expect(() =>
        __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
          databaseUrl,
          driver: 'node-postgres',
          schema,
        }),
      ).toThrow(/KV433_POSTGRES_AUTHORITY: (?:non-local )?databaseUrl/);
    }
  });

  it('rejects remote cleartext and no-verify URLs before creating the app pool', () => {
    for (const databaseUrl of [
      'postgres://app@db.example:5432/kovo',
      'postgres://app@db.example:5432/kovo?sslmode=no-verify',
      'postgres://app@203.0.113.9:5432/kovo?sslmode=verify-full',
    ]) {
      expect(() =>
        createPostgresAppRuntimeDb({ databaseUrl, driver: 'node-postgres', schema }),
      ).toThrow(/KV433_POSTGRES_TLS(?:_HOST)?: non-local databaseUrl/);
    }
  });

  it('preserves cleartext only for exact carrier-local loopback or Unix controls', () => {
    for (const databaseUrl of [
      'postgres://app@127.0.0.1:5432/kovo',
      'postgres://app@localhost:5432/kovo?host=%3A%3A1',
      'postgres://app@db.example:5432/kovo?host=127.0.0.1',
      'postgres://app@localhost:5432/kovo?host=%2Ftmp%2Fkovo-pg',
    ]) {
      expect(() =>
        __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
          databaseUrl,
          driver: 'node-postgres',
          schema,
        }),
      ).not.toThrow();
    }

    for (const databaseUrl of [
      'postgres://app@localhost:5432/kovo',
      'postgres://app@api.localhost:5432/kovo',
      'postgres://app@localhost.:5432/kovo',
      'postgres://app@[::1]:5432/kovo',
      'postgres://app@127.1:5432/kovo',
      'postgres://app@2130706433:5432/kovo',
      'postgres://app@0177.0.0.1:5432/kovo',
      'postgres://app@[::ffff:127.0.0.1]:5432/kovo',
      'postgres://app@[64:ff9b::127.0.0.1]:5432/kovo',
    ]) {
      expect(() =>
        __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
          databaseUrl,
          driver: 'node-postgres',
          schema,
        }),
      ).toThrow(/KV433_POSTGRES_TLS(?:_HOST)?: non-local databaseUrl/);
    }

    expect(() =>
      __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
        databaseUrl: 'postgres://app@127.0.0.1:5432/kovo?host=0177.0.0.1',
        driver: 'node-postgres',
        schema,
      }),
    ).toThrow(/KV433_POSTGRES_AUTHORITY: non-local databaseUrl/);

    // The query host, not the cosmetically local authority, is where node-postgres dials.
    expect(() =>
      __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
        databaseUrl: 'postgres://app@127.0.0.1:5432/kovo?host=db.example&sslmode=disable',
        driver: 'node-postgres',
        schema,
      }),
    ).toThrow(/KV433_POSTGRES_AUTHORITY: non-local databaseUrl/);
  });

  it('does not confuse permissive resolver spellings with an exact local Postgres carrier', async () => {
    // macOS resolves this spelling as public 177.0.0.1 even though legacy IPv4 parsers often
    // classify it as octal loopback. The differential sweep covered 708,024 spellings and found
    // 17,576 public resolver outputs; the managed-DB exception therefore compares only exact
    // carrier values (127.0.0.1 or query-host ::1) and rejects every loose spelling.
    const resolved = await dnsLookup('0177.0.0.1');
    if (process.platform === 'darwin') expect(resolved.address).toBe('177.0.0.1');

    expect(() =>
      __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
        databaseUrl: 'postgres://app@0177.0.0.1:5432/kovo',
        driver: 'node-postgres',
        schema,
      }),
    ).toThrow(/KV433_POSTGRES_TLS_HOST: non-local databaseUrl/);
  });

  it('requires canonical remote authority fields and rejects permissive query ports', () => {
    for (const databaseUrl of [
      'postgres://app@db.example/kovo?sslmode=verify-full',
      'postgres://db.example:5432/kovo?sslmode=verify-full',
      'postgres://app@db.example:5432/?sslmode=verify-full',
      'postgres://app@db.example:5432/kovo?host=other.example&sslmode=verify-full',
      'postgres://app@db.example:5432/kovo?port=5432&sslmode=verify-full',
      'postgres://app@db.example:5432/kovo?user=admin&sslmode=verify-full',
      'postgres://app@db.example:5432/kovo?database=other&sslmode=verify-full',
    ]) {
      expect(() =>
        __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
          databaseUrl,
          driver: 'node-postgres',
          schema,
        }),
      ).toThrow(/KV433_POSTGRES_AUTHORITY: (?:non-local )?databaseUrl/);
    }

    for (const port of ['1e3', '0x1538', '0b1010', '01e2', '+5432', '-1', ' 5432']) {
      expect(() =>
        __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
          databaseUrl: `postgres://app@127.0.0.1/kovo?port=${encodeURIComponent(port)}`,
          driver: 'node-postgres',
          schema,
        }),
      ).toThrow(/KV433_POSTGRES_URL:/);
    }
  });

  it('gates runtime, admin, and system URLs and refuses ambient pg authority', () => {
    const localRuntime = 'postgres://app@127.0.0.1:5432/kovo';
    for (const [label, extra] of [
      ['databaseUrl', { databaseUrl: 'postgres://app@db.example:5432/kovo' }],
      ['adminDatabaseUrl', { adminDatabaseUrl: 'postgres://admin@db.example:5432/kovo' }],
      ['systemDatabaseUrl', { systemDatabaseUrl: 'postgres://system@db.example:5432/kovo' }],
    ] as const) {
      expect(() =>
        __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
          databaseUrl: localRuntime,
          driver: 'node-postgres',
          schema,
          ...extra,
        }),
      ).toThrow(new RegExp(`KV433_POSTGRES_TLS: non-local ${label}`));
    }

    const previousHost = process.env.PGHOST;
    const previousMode = process.env.PGSSLMODE;
    try {
      process.env.PGHOST = 'db.example';
      process.env.PGSSLMODE = 'verify-full';
      expect(() =>
        __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
          driver: 'node-postgres',
          schema,
        }),
      ).toThrow(/KV433_POSTGRES_URL: node-postgres requires an explicit databaseUrl/);
    } finally {
      if (previousHost === undefined) delete process.env.PGHOST;
      else process.env.PGHOST = previousHost;
      if (previousMode === undefined) delete process.env.PGSSLMODE;
      else process.env.PGSSLMODE = previousMode;
    }
  });

  it('gates provision and migrate runtime URLs before connecting', async () => {
    const baseOptions = {
      databaseUrl: 'postgres://admin@127.0.0.1:1/kovo',
      driver: 'node-postgres' as const,
      runtimeDatabaseUrl: 'postgres://app@db.example:5432/kovo?sslmode=no-verify',
      schema,
    };
    for (const operation of [
      () => provisionPostgresAppDb(baseOptions),
      () => migratePostgresAppDb({ ...baseOptions, migrations: [] }),
    ]) {
      await expect(operation()).rejects.toThrow(/KV433_POSTGRES_TLS: non-local runtimeDatabaseUrl/);
    }
  });

  it('locks the managed TLS gate to pinned node-postgres parsing behavior', () => {
    const cleartext = new Client({ connectionString: 'postgres://app@db.example/kovo' });
    const unauthenticatedTls = new Client({
      connectionString: 'postgres://app@db.example/kovo?sslmode=no-verify',
    });
    const authenticatedTls = new Client({
      connectionString: 'postgres://app@db.example/kovo?sslmode=verify-full',
    });
    const overriddenEndpoint = new Client({
      connectionString:
        'postgres://app@127.0.0.1:1111/kovo?host=10.0.0.1&port=2222&host=db.example&port=5433&sslmode=verify-full',
    });
    const overriddenLogin = new Client({
      connectionString: 'postgres://app@db.example:5432/kovo?user=admin&sslmode=verify-full',
    });
    const permissivePort = new Client({
      connectionString: 'postgres://app@db.example:5432/kovo?port=1e3&sslmode=verify-full',
    });
    const bracketedIpv6Authority = new Client({
      connectionString: 'postgres://app@[::1]:5432/kovo',
    });
    const exactIpv6QueryHost = new Client({
      connectionString: 'postgres://app@localhost:5432/kovo?host=%3A%3A1',
    });
    expect(cleartext.connectionParameters.ssl).toBe(false);
    expect(unauthenticatedTls.connectionParameters.ssl).toMatchObject({
      rejectUnauthorized: false,
    });
    expect(authenticatedTls.connectionParameters.ssl).toEqual({});
    expect(overriddenEndpoint.connectionParameters.host).toBe('db.example');
    expect(overriddenEndpoint.connectionParameters.port).toBe(5433);
    expect(overriddenLogin.connectionParameters.user).toBe('admin');
    expect(permissivePort.connectionParameters.port).toBe(1);
    expect(bracketedIpv6Authority.connectionParameters.host).toBe('[::1]');
    expect(exactIpv6QueryHost.connectionParameters.host).toBe('::1');
  });

  it('refuses a missing remote port that pinned pg would fill from ambient PGPORT', () => {
    const previousPort = process.env.PGPORT;
    try {
      process.env.PGPORT = '6543';
      const ambientPortClient = new Client({
        connectionString: 'postgres://app@db.example/kovo?sslmode=verify-full',
      });
      expect(ambientPortClient.connectionParameters.port).toBe(6543);
      expect(() =>
        __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
          databaseUrl: 'postgres://app@db.example/kovo?sslmode=verify-full',
          driver: 'node-postgres',
          schema,
        }),
      ).toThrow(/KV433_POSTGRES_AUTHORITY: databaseUrl must include an explicit decimal port/);
    } finally {
      if (previousPort === undefined) delete process.env.PGPORT;
      else process.env.PGPORT = previousPort;
    }
  });

  it('requires explicit Unix-socket identity and port instead of pg ambient fallbacks', () => {
    const previousPort = process.env.PGPORT;
    const previousUser = process.env.PGUSER;
    try {
      process.env.PGPORT = '6543';
      process.env.PGUSER = 'ambient_admin';
      const historical = new Client({ connectionString: '/tmp/kovo-pg kovo' });
      expect(historical.connectionParameters).toMatchObject({
        host: '/tmp/kovo-pg',
        port: 6543,
        user: 'ambient_admin',
      });
      expect(() =>
        __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
          databaseUrl: '/tmp/kovo-pg kovo',
          driver: 'node-postgres',
          schema,
        }),
      ).toThrow(/KV433_POSTGRES_URL:/);

      const canonical = 'postgres://app@localhost:5432/kovo?host=%2Ftmp%2Fkovo-pg';
      const canonicalClient = new Client({ connectionString: canonical });
      expect(canonicalClient.connectionParameters).toMatchObject({
        database: 'kovo',
        host: '/tmp/kovo-pg',
        port: 5432,
        user: 'app',
      });
      expect(() =>
        __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
          databaseUrl: canonical,
          driver: 'node-postgres',
          schema,
        }),
      ).not.toThrow();

      for (const databaseUrl of [
        'postgres://app@localhost/kovo?host=%2Ftmp%2Fkovo-pg',
        'postgres://localhost:5432/kovo?host=%2Ftmp%2Fkovo-pg',
        'postgres://app@localhost:5432/?host=%2Ftmp%2Fkovo-pg',
      ]) {
        expect(() =>
          __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
            databaseUrl,
            driver: 'node-postgres',
            schema,
          }),
        ).toThrow(/KV433_POSTGRES_AUTHORITY:/);
      }
    } finally {
      if (previousPort === undefined) delete process.env.PGPORT;
      else process.env.PGPORT = previousPort;
      if (previousUser === undefined) delete process.env.PGUSER;
      else process.env.PGUSER = previousUser;
    }
  });

  it('rejects raw URL-envelope forms that pinned pg parses against a different authority', () => {
    const leadingSpace = new Client({
      connectionString: ' postgres://app@db.example:5432/kovo?sslmode=verify-full',
    });
    expect(leadingSpace.connectionParameters.host).toBe('base');
    expect(leadingSpace.connectionParameters.database).toBe(' postgres://app@db.example:5432/kovo');

    for (const databaseUrl of [
      ' postgres://app@db.example:5432/kovo?sslmode=verify-full',
      '\npostgres://app@db.example:5432/kovo?sslmode=verify-full',
      'POSTGRES://app@db.example:5432/kovo?sslmode=verify-full',
    ]) {
      expect(() =>
        __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
          databaseUrl,
          driver: 'node-postgres',
          schema,
        }),
      ).toThrow(/KV433_POSTGRES_URL:/);
    }
  });

  it('rejects malformed-percent preprocessing that makes pg ignore reviewed security keys', () => {
    const localFalseProof = 'postgres://u:p%zz@8.8.8.8:5432/db?h%6Fst=127.0.0.1';
    const tlsFalseProof = 'postgres://u:p%zz@db.example:5432/db?sslm%6Fde=verify-full';
    const pgLocalFalseProof = new Client({ connectionString: localFalseProof });
    const pgTlsFalseProof = new Client({ connectionString: tlsFalseProof });

    // pg preprocesses the whole malformed string, leaves the escaped key literal, and therefore
    // ignores the host/TLS fields that a direct WHATWG parse would decode and approve.
    expect(pgLocalFalseProof.connectionParameters).toMatchObject({
      host: '8.8.8.8',
      ssl: false,
    });
    expect(pgTlsFalseProof.connectionParameters).toMatchObject({
      host: 'db.example',
      ssl: false,
    });

    for (const databaseUrl of [
      localFalseProof,
      tlsFalseProof,
      'postgres://u:p%@db.example:5432/db?sslmode=verify-full',
      'postgres://u:p%a@db.example:5432/db?sslmode=verify-full',
      'postgres://u:p%ag@db.example:5432/db?sslmode=verify-full',
      'postgres://u:p%gg@db.example:5432/db?sslmode=verify-full',
    ]) {
      expect(() =>
        __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
          databaseUrl,
          driver: 'node-postgres',
          schema,
        }),
      ).toThrow(/KV433_POSTGRES_URL:/);
    }
  });

  it('refuses a boot-pinned NODE_TLS_REJECT_UNAUTHORIZED=0 before creating a remote pool', () => {
    const runtimeUrl = new URL('./postgres-runtime.ts', import.meta.url).href;
    const environmentUrl = new URL('./runtime-environment-authority.ts', import.meta.url).href;
    const source = `
      import { existsSync } from 'node:fs';
      import { registerHooks } from 'node:module';
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
            const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
            if (existsSync(candidate)) return nextResolve(candidate.href, context);
          }
          return nextResolve(specifier, context);
        },
      });
      const environment = await import(${JSON.stringify(environmentUrl)});
      environment.pinServerRuntimeEnvironment();
      const runtime = await import(${JSON.stringify(runtimeUrl)});
      try {
        runtime.__testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
          databaseUrl: 'postgres://app@db.example:5432/kovo?sslmode=verify-full',
          driver: 'node-postgres',
          schema: {},
        });
        process.stdout.write('accepted');
      } catch (error) {
        process.stdout.write(error instanceof Error ? error.message : String(error));
      }
    `;
    const result = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--experimental-transform-types',
        '--input-type=module',
        '--eval',
        source,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/KV433_POSTGRES_TLS_ENV: non-local databaseUrl/);
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

  it('refuses a same-named allow-all owner policy after proving cross-tenant access', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-owner-policy-shape-'));
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
        'DROP POLICY kovo_owner_scope ON public.kovo_runtime_notes',
        [
          'CREATE POLICY kovo_owner_scope ON public.kovo_runtime_notes',
          'FOR ALL TO kovo_reader, kovo_writer',
          'USING (true) WITH CHECK (true)',
        ].join(' '),
      ].join('; '),
    );
    await usingPgliteRole(dataDir, 'kovo_reader', async (client) => {
      await client.exec("SET LOCAL kovo.principal = 'u1'");
      await expect(
        client.query('SELECT id FROM public.kovo_runtime_notes ORDER BY id'),
      ).resolves.toMatchObject({ rows: [{ id: 'n1' }, { id: 'n2' }] });
    });

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV433_OWNER_POLICY',
        detail: expect.stringContaining('unexpected permissiveness, roles, command, USING'),
      }),
    );
  });

  it('does not dispatch a late parser method while comparing committed policy ASTs', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-parser-primordial-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema: { notes } });
    await runtime.ready;
    await runtime.close();

    await execPglite(
      dataDir,
      [
        'DROP POLICY kovo_owner_scope ON kovo_runtime_notes',
        'CREATE POLICY kovo_owner_scope ON kovo_runtime_notes ' +
          'FOR ALL TO kovo_reader, kovo_writer USING (true) WITH CHECK (true)',
      ].join('; '),
    );
    const baseline = await checkPostgresAppDbPosture({
      dataDir,
      driver: 'pglite',
      schema: { notes },
    });
    expect(baseline.ok).toBe(false);

    const parser = postgresRuntimeTestRequire('pgsql-ast-parser') as {
      parse: (sqlText: string, options?: unknown) => unknown;
    };
    const nativeParse = parser.parse;
    let triggered = 0;
    parser.parse = function (sqlText: string, options?: unknown): unknown {
      if (sqlText === 'SELECT 1 WHERE true' && triggered < 2) {
        triggered += 1;
        if (triggered === 2) parser.parse = nativeParse;
        return Reflect.apply(nativeParse, parser, [
          `SELECT 1 WHERE "ownerId" = current_setting('kovo.principal', true)`,
          options,
        ]);
      }
      return Reflect.apply(nativeParse, parser, [sqlText, options]);
    };
    try {
      const report = await checkPostgresAppDbPosture({
        dataDir,
        driver: 'pglite',
        schema: { notes },
      });
      expect(triggered).toBe(0);
      expect(report.ok).toBe(false);
      expect(report.issues).toContainEqual(expect.objectContaining({ code: 'KV433_OWNER_POLICY' }));
    } finally {
      parser.parse = nativeParse;
    }
  });

  it('refuses a same-named system policy broadened to PUBLIC after proving cross-tenant access', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-system-policy-shape-'));
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
        'DROP POLICY kovo_system_scope ON public.kovo_runtime_notes',
        [
          'CREATE POLICY kovo_system_scope ON public.kovo_runtime_notes',
          'FOR ALL TO PUBLIC USING (true) WITH CHECK (true)',
        ].join(' '),
      ].join('; '),
    );
    await usingPgliteRole(dataDir, 'kovo_reader', async (client) => {
      await client.exec("SET LOCAL kovo.principal = 'u1'");
      await expect(
        client.query('SELECT id FROM public.kovo_runtime_notes ORDER BY id'),
      ).resolves.toMatchObject({ rows: [{ id: 'n1' }, { id: 'n2' }] });
    });

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'KV433_SYSTEM_POLICY' }));
  });

  it('refuses every policy outside the exact Kovo allowlist, including an extra PUBLIC policy', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-extra-policy-'));
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
        'CREATE POLICY attacker_open ON public.kovo_runtime_notes',
        'FOR ALL TO PUBLIC USING (true) WITH CHECK (true)',
      ].join(' '),
    );
    await usingPgliteRole(dataDir, 'kovo_reader', async (client) => {
      await client.exec("SET LOCAL kovo.principal = 'u1'");
      await expect(
        client.query('SELECT id FROM public.kovo_runtime_notes ORDER BY id'),
      ).resolves.toMatchObject({ rows: [{ id: 'n1' }, { id: 'n2' }] });
    });

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV433_POLICY_SET',
        detail: expect.stringContaining('attacker_open'),
      }),
    );
  });

  it('refuses expected policy names with substituted role, command, or permissiveness', async () => {
    const variants = [
      {
        label: 'role',
        setup: [
          'CREATE ROLE kovo_policy_parent NOLOGIN',
          'GRANT kovo_policy_parent TO kovo_reader, kovo_writer',
          'DROP POLICY kovo_owner_scope ON public.kovo_runtime_notes',
          [
            'CREATE POLICY kovo_owner_scope ON public.kovo_runtime_notes',
            'FOR ALL TO kovo_policy_parent',
            'USING ("ownerId" = current_setting(\'kovo.principal\', true))',
            'WITH CHECK ("ownerId" = current_setting(\'kovo.principal\', true))',
          ].join(' '),
        ],
      },
      {
        label: 'command',
        setup: [
          'DROP POLICY kovo_owner_scope ON public.kovo_runtime_notes',
          [
            'CREATE POLICY kovo_owner_scope ON public.kovo_runtime_notes',
            'FOR SELECT TO kovo_reader, kovo_writer',
            'USING ("ownerId" = current_setting(\'kovo.principal\', true))',
          ].join(' '),
        ],
      },
      {
        label: 'restrictive',
        setup: [
          'DROP POLICY kovo_owner_scope ON public.kovo_runtime_notes',
          [
            'CREATE POLICY kovo_owner_scope ON public.kovo_runtime_notes AS RESTRICTIVE',
            'FOR ALL TO kovo_reader, kovo_writer',
            'USING ("ownerId" = current_setting(\'kovo.principal\', true))',
            'WITH CHECK ("ownerId" = current_setting(\'kovo.principal\', true))',
          ].join(' '),
        ],
      },
    ] as const;

    for (const variant of variants) {
      const dataDir = mkdtempSync(join(tmpdir(), `kovo-postgres-runtime-policy-${variant.label}-`));
      roots.push(dataDir);
      const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
      try {
        await runtime.ready;
      } finally {
        await runtime.close();
      }
      await execPglite(dataDir, variant.setup.join('; '));

      const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
      expect(report.ok, variant.label).toBe(false);
      expect(report.issues, variant.label).toContainEqual(
        expect.objectContaining({ code: 'KV433_OWNER_POLICY' }),
      );
    }
  });

  it('does not treat a reachable same-named table in another schema as protected', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-policy-schema-'));
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
        'CREATE SCHEMA shadow',
        [
          'CREATE TABLE shadow.kovo_runtime_notes (',
          'id text PRIMARY KEY, "ownerId" text NOT NULL, "secretNote" text NOT NULL, title text NOT NULL',
          ')',
        ].join(' '),
        'ALTER TABLE shadow.kovo_runtime_notes ENABLE ROW LEVEL SECURITY',
        'ALTER TABLE shadow.kovo_runtime_notes FORCE ROW LEVEL SECURITY',
        [
          'CREATE POLICY kovo_owner_scope ON shadow.kovo_runtime_notes',
          'FOR ALL TO kovo_reader USING (true) WITH CHECK (true)',
        ].join(' '),
        [
          'CREATE POLICY kovo_system_scope ON shadow.kovo_runtime_notes',
          'FOR ALL TO kovo_system USING (true) WITH CHECK (true)',
        ].join(' '),
        [
          'INSERT INTO shadow.kovo_runtime_notes (id, "ownerId", "secretNote", title) VALUES',
          "('shadow-1', 'u1', 'shadow-s1', 'Shadow one'),",
          "('shadow-2', 'u2', 'shadow-s2', 'Shadow two')",
        ].join(' '),
        'GRANT USAGE ON SCHEMA shadow TO kovo_reader',
        'GRANT SELECT ON TABLE shadow.kovo_runtime_notes TO kovo_reader',
      ].join('; '),
    );

    await usingPgliteRole(dataDir, 'kovo_reader', async (client) => {
      await client.exec("SET LOCAL kovo.principal = 'u1'");
      await expect(
        client.query('SELECT id FROM shadow.kovo_runtime_notes ORDER BY id'),
      ).resolves.toMatchObject({ rows: [{ id: 'shadow-1' }, { id: 'shadow-2' }] });
    });

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV433_REACHABLE_TABLE',
        detail: expect.stringContaining('shadow.kovo_runtime_notes'),
      }),
    );
  });

  it('audits the exact policy set on a partitioned protected table root', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-policy-partition-'));
    roots.push(dataDir);
    await execPglite(
      dataDir,
      [
        [
          'CREATE TABLE public.kovo_runtime_notes (',
          'id text NOT NULL, "ownerId" text NOT NULL, "secretNote" text NOT NULL, title text NOT NULL',
          ') PARTITION BY LIST ("ownerId")',
        ].join(' '),
        [
          'CREATE TABLE public.kovo_runtime_notes_u1 PARTITION OF public.kovo_runtime_notes',
          "FOR VALUES IN ('u1')",
        ].join(' '),
        [
          'CREATE TABLE public.kovo_runtime_notes_u2 PARTITION OF public.kovo_runtime_notes',
          "FOR VALUES IN ('u2')",
        ].join(' '),
      ].join('; '),
    );
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }
    const clean = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(clean.ok).toBe(true);

    await execPglite(
      dataDir,
      [
        'CREATE POLICY partition_open ON public.kovo_runtime_notes',
        'FOR ALL TO PUBLIC USING (true) WITH CHECK (true)',
      ].join(' '),
    );
    const drifted = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(drifted.ok).toBe(false);
    expect(drifted.issues).toContainEqual(expect.objectContaining({ code: 'KV433_POLICY_SET' }));
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
      const u1Db = usePostgresAppRuntimeDb(runtime, {
        principalPosture: actAsRuntimePrincipal('u1'),
      });
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
      const u1Db = usePostgresAppRuntimeDb(declaredRuntime, {
        principalPosture: actAsRuntimePrincipal('u1'),
      });
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
      const appDb = usePostgresAppRuntimeDb(runtime);

      await expect(
        appDb
          .select({ id: notes.id, ownerId: notes.ownerId, title: notes.title })
          .from(notes)
          .orderBy(notes.id),
      ).resolves.toEqual([]);
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
      const writer = usePostgresAppRuntimeDb(runtime, {
        principalPosture: actAsRuntimePrincipal('u1'),
      });
      const readDb = managedDb(writer, 'read');

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

  it('denies writer engine reads of secret columns while preserving writes', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-writer-secret-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    await usingPgliteRole(dataDir, 'kovo_writer', async (client) => {
      await client.exec("SET LOCAL kovo.principal = 'u1'");
      await client.query(
        [
          'INSERT INTO kovo_runtime_notes (id, "ownerId", "secretNote", title)',
          "VALUES ('n3', 'u1', 's3', 'Three')",
        ].join(' '),
      );
      await client.query("UPDATE kovo_runtime_notes SET \"secretNote\" = 's3b' WHERE id = 'n3'");
      await expect(
        client.query('SELECT title FROM kovo_runtime_notes WHERE id = $1', ['n3']),
      ).resolves.toMatchObject({ rows: [{ title: 'Three' }] });
      await expect(
        client.query('SELECT "secretNote" FROM kovo_runtime_notes WHERE id = $1', ['n3']),
      ).rejects.toThrow();
    });

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('wires dev RLS empty-read diagnostics through the runtime readonly boundary', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-rls-diagnostic-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });

    try {
      await runtime.ready;
      drainPostgresRlsSilentDenyDiagnostics();
      const writer = usePostgresAppRuntimeDb(runtime, {
        principalPosture: actAsRuntimePrincipal('missing'),
      });
      const readDb = managedDb(writer, 'read');

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
      const u1Db = usePostgresAppRuntimeDb(runtime, {
        principalPosture: actAsRuntimePrincipal('u1'),
      });
      const systemDb = usePostgresAppRuntimeDb(runtime, {
        principalPosture: declareSystemPrincipal('repair owner index in runtime test', {
          ingress: 'task',
          operation: 'write',
          surface: 'postgres-runtime.test',
        }),
      });

      await expect(
        u1Db
          .select({ id: notes.id, ownerId: notes.ownerId, title: notes.title })
          .from(notes)
          .orderBy(notes.id),
      ).resolves.toEqual([{ id: 'n1', ownerId: 'u1', title: 'One' }]);
      await systemDb.update(notes).set({ title: 'System touched' });
      await expect(systemDb.select().from(notes).orderBy(notes.id)).resolves.toEqual([
        { id: 'n1', ownerId: 'u1', secretNote: 's1', title: 'System touched' },
        { id: 'n2', ownerId: 'u2', secretNote: 's2', title: 'System touched' },
      ]);
      await expect(
        u1Db
          .select({ id: notes.id, ownerId: notes.ownerId, title: notes.title })
          .from(notes)
          .orderBy(notes.id),
      ).resolves.toEqual([{ id: 'n1', ownerId: 'u1', title: 'System touched' }]);
      await expect(
        usePostgresAppRuntimeDb(runtime, {})
          .select({ id: notes.id, ownerId: notes.ownerId, title: notes.title })
          .from(notes),
      ).resolves.toEqual([]);
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
      const executor = createDurableTaskSqlExecutor(usePostgresAppRuntimeDb(runtime, {}));
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

  it('does not dispatch a one-shot Array.map poison while binding reviewed migration bytes', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-migration-primordial-'));
    roots.push(dataDir);
    const reviewedSql =
      'CREATE TABLE kovo_runtime_notes (id text PRIMARY KEY, "ownerId" text NOT NULL, "secretNote" text NOT NULL, title text NOT NULL)';
    const poisonedSql = `${reviewedSql}; CREATE TABLE kovo_unreviewed_marker (id text PRIMARY KEY)`;
    const migrations = [{ id: '001_reviewed', sql: reviewedSql }];
    const nativeMap = Array.prototype.map;
    let triggered = 0;
    Array.prototype.map = function (this: unknown[], callback, thisArg) {
      if (this === migrations) {
        triggered += 1;
        Array.prototype.map = nativeMap;
        return [
          {
            checksum: createHash('sha256').update(poisonedSql).digest('hex'),
            id: '001_reviewed',
            sql: poisonedSql,
          },
        ];
      }
      return Reflect.apply(nativeMap, this, [callback, thisArg]);
    } as typeof Array.prototype.map;

    try {
      const report = await migratePostgresAppDb({
        dataDir,
        driver: 'pglite',
        migrations,
        schema: { notes },
      });
      const marker = await queryPglite<{ marker: string | null }>(
        dataDir,
        "SELECT to_regclass('public.kovo_unreviewed_marker')::text AS marker",
      );
      expect(triggered).toBe(0);
      expect(report.posture.ok).toBe(true);
      expect(marker.rows).toEqual([{ marker: null }]);
    } finally {
      Array.prototype.map = nativeMap;
    }
  });

  it('does not dispatch late Hash methods while enforcing applied migration checksums', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-hash-primordial-'));
    roots.push(dataDir);
    const reviewedSql =
      'CREATE TABLE kovo_runtime_notes (id text PRIMARY KEY, "ownerId" text NOT NULL, "secretNote" text NOT NULL, title text NOT NULL)';
    const changedSql = `${reviewedSql} /* changed after apply */`;
    await migratePostgresAppDb({
      dataDir,
      driver: 'pglite',
      migrations: [{ id: '001_reviewed', sql: reviewedSql }],
      schema: { notes },
    });
    await expect(
      migratePostgresAppDb({
        dataDir,
        driver: 'pglite',
        migrations: [{ id: '001_reviewed', sql: changedSql }],
        schema: { notes },
      }),
    ).rejects.toThrow(/MIGRATION_CHECKSUM/);

    const ledger = await queryPglite<{ checksum: string }>(
      dataDir,
      "SELECT checksum FROM kovo_migrations WHERE id = '001_reviewed'",
    );
    const storedChecksum = ledger.rows[0]?.checksum;
    expect(typeof storedChecksum).toBe('string');
    const hashPrototype = Object.getPrototypeOf(createHash('sha256')) as {
      digest: (encoding: 'hex') => string;
    };
    const nativeDigest = hashPrototype.digest;
    let triggered = 0;
    hashPrototype.digest = function (encoding: 'hex'): string {
      if (encoding === 'hex' && triggered < 2) {
        triggered += 1;
        if (triggered === 2) hashPrototype.digest = nativeDigest;
        return storedChecksum as string;
      }
      return Reflect.apply(nativeDigest, this, [encoding]);
    };
    try {
      await expect(
        migratePostgresAppDb({
          dataDir,
          driver: 'pglite',
          migrations: [{ id: '001_reviewed', sql: changedSql }],
          schema: { notes },
        }),
      ).rejects.toThrow(/MIGRATION_CHECKSUM/);
      expect(triggered).toBe(0);
    } finally {
      hashPrototype.digest = nativeDigest;
    }
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
      runtimeDatabaseUrl: 'postgres://kovo_runtime_login@127.0.0.1:5432/kovo',
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

  it('binds the runtime grant to exact URL and SQL identifier bytes under late replacement', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-url-role-'));
    roots.push(dataDir);
    const runtimeDatabaseUrl = 'postgres://victim_runtime_login@127.0.0.1:5432/kovo';
    const NativeURL = globalThis.URL;
    class PoisonedURL extends NativeURL {
      constructor(input: string | URL, base?: string | URL) {
        const source = typeof input === 'string' ? input : input.href;
        super(
          source === runtimeDatabaseUrl
            ? 'postgres://attacker_runtime_login@127.0.0.1:5432/kovo'
            : input,
          base,
        );
      }
    }
    const nativeMap = Array.prototype.map;
    const nativeReplaceAll = String.prototype.replaceAll;
    const nativeStringValueOf = String.prototype.valueOf;
    globalThis.URL = PoisonedURL;
    Array.prototype.map = function (callback, thisArg) {
      if (this.length === 2 && this[0] === 'kovo_reader' && this[1] === 'kovo_writer') {
        return [
          {
            memberRole: 'attacker_runtime_login',
            owner: 'kovo',
            role: 'kovo_reader',
          },
          {
            memberRole: 'attacker_runtime_login',
            owner: 'kovo',
            role: 'kovo_writer',
          },
        ];
      }
      return Reflect.apply(nativeMap, this, [callback, thisArg]);
    } as typeof Array.prototype.map;
    String.prototype.replaceAll = function (search, replacement) {
      const value = Reflect.apply(nativeStringValueOf, this, []);
      return value === 'victim_runtime_login'
        ? 'attacker_runtime_login'
        : Reflect.apply(nativeReplaceAll, this, [search, replacement]);
    };

    try {
      await migratePostgresAppDb({
        dataDir,
        driver: 'pglite',
        migrations: [
          {
            id: '001_exact_runtime_login',
            sql: [
              'CREATE ROLE victim_runtime_login LOGIN',
              'CREATE ROLE attacker_runtime_login LOGIN',
              runtimeSchemaMigrationSql,
            ].join('; '),
          },
        ],
        runtimeDatabaseUrl,
        schema,
      });
    } finally {
      globalThis.URL = NativeURL;
      Array.prototype.map = nativeMap;
      String.prototype.replaceAll = nativeReplaceAll;
    }

    const privileges = await queryPglite<{
      attacker_can_execute: boolean;
      victim_can_execute: boolean;
    }>(
      dataDir,
      [
        'SELECT',
        "has_function_privilege('victim_runtime_login', 'pg_catalog.set_config(text,text,boolean)', 'EXECUTE') AS victim_can_execute,",
        "has_function_privilege('attacker_runtime_login', 'pg_catalog.set_config(text,text,boolean)', 'EXECUTE') AS attacker_can_execute",
      ].join(' '),
    );
    expect(privileges.rows[0]).toEqual({
      attacker_can_execute: false,
      victim_can_execute: true,
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
        usePostgresAppRuntimeDb(runtime, {
          principalPosture: { kind: 'system', reason: 'plain object' },
        }),
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
      expect(() =>
        usePostgresAppRuntimeDb(runtime, { principalPosture: { kind: 'act-as', principal: 'u1' } }),
      ).toThrow(/framework-minted actAs\(id\) or declareSystemRead\/Write\(reason\)/);
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
          'CREATE FUNCTION kovo_runtime_attached_constraint_trigger() RETURNS trigger',
          'LANGUAGE plpgsql SECURITY DEFINER',
          'AS $$ BEGIN RETURN NEW; END $$',
        ].join(' '),
        [
          'CREATE CONSTRAINT TRIGGER kovo_runtime_attached_constraint_trigger',
          'AFTER INSERT ON kovo_runtime_notes',
          'DEFERRABLE INITIALLY IMMEDIATE',
          'FOR EACH ROW EXECUTE FUNCTION kovo_runtime_attached_constraint_trigger()',
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
          detail: expect.stringContaining('CONSTRAINT trigger'),
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

  it('recursively refuses a SECURITY INVOKER function hidden behind a CHECK operator', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-check-operator-'));
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
          'CREATE FUNCTION public.kovo_runtime_invoker_operator(left_value text, right_value text)',
          'RETURNS boolean LANGUAGE SQL IMMUTABLE SECURITY INVOKER',
          'AS $$ SELECT true $$',
        ].join(' '),
        [
          'CREATE OPERATOR public.#=# (',
          'LEFTARG = text, RIGHTARG = text, FUNCTION = public.kovo_runtime_invoker_operator',
          ')',
        ].join(' '),
        [
          'ALTER TABLE public.kovo_runtime_notes ADD CONSTRAINT kovo_runtime_operator_check',
          'CHECK ("secretNote" OPERATOR(public.#=#) title) NOT VALID',
        ].join(' '),
        [
          'CREATE INDEX kovo_runtime_operator_index ON public.kovo_runtime_notes',
          '((title OPERATOR(public.#=#) "ownerId"))',
        ].join(' '),
        [
          'CREATE POLICY kovo_runtime_operator_policy ON public.kovo_runtime_notes',
          'AS RESTRICTIVE FOR SELECT TO kovo_reader',
          'USING (title OPERATOR(public.#=#) "ownerId")',
        ].join(' '),
      ].join('; '),
    );

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV433_ATTACHED_CODE',
          detail: expect.stringContaining(
            'CHECK/domain constraint function reaching app-authored routine public.kovo_runtime_invoker_operator',
          ),
        }),
        expect.objectContaining({
          code: 'KV433_ATTACHED_CODE',
          detail: expect.stringContaining(
            'index/predicate expression function reaching app-authored routine public.kovo_runtime_invoker_operator',
          ),
        }),
        expect.objectContaining({
          code: 'KV433_ATTACHED_CODE',
          detail: expect.stringContaining(
            'RLS policy expression function reaching app-authored routine public.kovo_runtime_invoker_operator',
          ),
        }),
      ]),
    );
  });

  it('allows CHECK expressions whose executable dependency closure is built-in only', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-check-builtins-'));
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
        'ALTER TABLE public.kovo_runtime_notes ADD CONSTRAINT kovo_runtime_builtin_check',
        'CHECK (length(title) > 0 AND "ownerId" <> \'\') NOT VALID',
      ].join(' '),
    );

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
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

  it('refuses SECURITY DEFINER triggers on FK cascade targets reached by app-role writes', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-fk-cascade-code-'));
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
          'CREATE TABLE kovo_runtime_fk_cascade_children (',
          'id text PRIMARY KEY,',
          'note_id text NOT NULL REFERENCES kovo_runtime_notes(id) ON DELETE CASCADE',
          ')',
        ].join(' '),
        [
          'CREATE FUNCTION kovo_runtime_fk_cascade_child_trigger() RETURNS trigger',
          'LANGUAGE plpgsql SECURITY DEFINER',
          'AS $$ BEGIN RETURN OLD; END $$',
        ].join(' '),
        [
          'CREATE TRIGGER kovo_runtime_fk_cascade_child_trigger',
          'BEFORE DELETE ON kovo_runtime_fk_cascade_children',
          'FOR EACH ROW EXECUTE FUNCTION kovo_runtime_fk_cascade_child_trigger()',
        ].join(' '),
      ].join('; '),
    );

    const childPrivileges = await queryPglite<{ writer_can_delete: boolean }>(
      dataDir,
      [
        'SELECT has_table_privilege(',
        "'kovo_writer',",
        "'public.kovo_runtime_fk_cascade_children',",
        "'DELETE'",
        ') AS writer_can_delete',
      ].join(' '),
    );
    expect(childPrivileges.rows).toEqual([{ writer_can_delete: false }]);

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV433_ATTACHED_CODE',
        detail: expect.stringContaining('kovo_runtime_fk_cascade_children has DML trigger'),
      }),
    );
  });

  it('refuses SECURITY DEFINER triggers on partition children reached by app-role writes', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-partition-code-'));
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
          'CREATE TABLE kovo_runtime_partition_parent (',
          'id text NOT NULL,',
          'owner_id text NOT NULL',
          ') PARTITION BY LIST (owner_id)',
        ].join(' '),
        [
          'CREATE TABLE kovo_runtime_partition_child_u1',
          'PARTITION OF kovo_runtime_partition_parent FOR VALUES IN (',
          "'u1'",
          ')',
        ].join(' '),
        [
          'CREATE FUNCTION kovo_runtime_partition_child_trigger() RETURNS trigger',
          'LANGUAGE plpgsql SECURITY DEFINER',
          'AS $$ BEGIN RETURN NEW; END $$',
        ].join(' '),
        [
          'CREATE TRIGGER kovo_runtime_partition_child_trigger',
          'BEFORE INSERT ON kovo_runtime_partition_child_u1',
          'FOR EACH ROW EXECUTE FUNCTION kovo_runtime_partition_child_trigger()',
        ].join(' '),
        'GRANT INSERT ON TABLE kovo_runtime_partition_parent TO kovo_writer',
      ].join('; '),
    );

    const childPrivileges = await queryPglite<{ writer_can_insert: boolean }>(
      dataDir,
      [
        'SELECT has_table_privilege(',
        "'kovo_writer',",
        "'public.kovo_runtime_partition_child_u1',",
        "'INSERT'",
        ') AS writer_can_insert',
      ].join(' '),
    );
    expect(childPrivileges.rows).toEqual([{ writer_can_insert: false }]);

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV433_ATTACHED_CODE',
        detail: expect.stringContaining('kovo_runtime_partition_child_u1 has DML trigger'),
      }),
    );
  });

  it('refuses SECURITY DEFINER triggers on rewrite-rule redirect targets reached by app-role writes', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-rule-target-code-'));
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
        'CREATE TABLE kovo_runtime_rule_source (id text PRIMARY KEY)',
        'CREATE TABLE kovo_runtime_rule_target (id text PRIMARY KEY)',
        [
          'CREATE FUNCTION kovo_runtime_rule_target_trigger() RETURNS trigger',
          'LANGUAGE plpgsql SECURITY DEFINER',
          'AS $$ BEGIN RETURN NEW; END $$',
        ].join(' '),
        [
          'CREATE TRIGGER kovo_runtime_rule_target_trigger',
          'BEFORE INSERT ON kovo_runtime_rule_target',
          'FOR EACH ROW EXECUTE FUNCTION kovo_runtime_rule_target_trigger()',
        ].join(' '),
        [
          'CREATE RULE kovo_runtime_rule_redirect AS ON INSERT TO kovo_runtime_rule_source',
          'DO ALSO INSERT INTO kovo_runtime_rule_target (id) VALUES (NEW.id)',
        ].join(' '),
        'GRANT INSERT ON TABLE kovo_runtime_rule_source TO kovo_writer',
      ].join('; '),
    );

    const targetPrivileges = await queryPglite<{ writer_can_insert: boolean }>(
      dataDir,
      [
        'SELECT has_table_privilege(',
        "'kovo_writer',",
        "'public.kovo_runtime_rule_target',",
        "'INSERT'",
        ') AS writer_can_insert',
      ].join(' '),
    );
    expect(targetPrivileges.rows).toEqual([{ writer_can_insert: false }]);

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV433_ATTACHED_CODE',
        detail: expect.stringContaining('kovo_runtime_rule_target has DML trigger'),
      }),
    );
  });

  it('allows SECURITY DEFINER triggers on relations outside the app-role write closure', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-unreachable-code-'));
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
        'CREATE TABLE kovo_runtime_ops_log (id text PRIMARY KEY)',
        [
          'CREATE FUNCTION kovo_runtime_ops_log_trigger() RETURNS trigger',
          'LANGUAGE plpgsql SECURITY DEFINER',
          'AS $$ BEGIN RETURN NEW; END $$',
        ].join(' '),
        'REVOKE ALL ON FUNCTION kovo_runtime_ops_log_trigger() FROM PUBLIC',
        [
          'CREATE TRIGGER kovo_runtime_ops_log_trigger',
          'BEFORE INSERT ON kovo_runtime_ops_log',
          'FOR EACH ROW EXECUTE FUNCTION kovo_runtime_ops_log_trigger()',
        ].join(' '),
      ].join('; '),
    );

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('refuses SECURITY DEFINER INSTEAD OF triggers on writable views', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-view-trigger-'));
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
          'CREATE VIEW kovo_runtime_notes_write_v AS',
          'SELECT id, "ownerId", title FROM kovo_runtime_notes',
        ].join(' '),
        'ALTER VIEW kovo_runtime_notes_write_v SET (security_invoker = true)',
        [
          'CREATE FUNCTION kovo_runtime_notes_write_v_insert() RETURNS trigger',
          'LANGUAGE plpgsql SECURITY DEFINER',
          'AS $$ BEGIN RETURN NEW; END $$',
        ].join(' '),
        [
          'CREATE TRIGGER kovo_runtime_notes_write_v_insert',
          'INSTEAD OF INSERT ON kovo_runtime_notes_write_v',
          'FOR EACH ROW EXECUTE FUNCTION kovo_runtime_notes_write_v_insert()',
        ].join(' '),
        'GRANT INSERT ON TABLE kovo_runtime_notes_write_v TO kovo_writer',
      ].join('; '),
    );

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV433_ATTACHED_CODE',
        detail: expect.stringContaining('INSTEAD OF trigger'),
      }),
    );
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
      const u1Db = usePostgresAppRuntimeDb(runtime, {
        principalPosture: actAsRuntimePrincipal('u1'),
      });
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

  it('provisions and reads number-mode bigint columns without truncating epoch milliseconds', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-bigint-'));
    roots.push(dataDir);
    const bigintSchema = { bigintNotes };
    const lastRequest = 1_765_432_109_876;
    const runtime = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      schema: bigintSchema,
      seedSql: [
        `INSERT INTO kovo_runtime_bigint_notes (id, "ownerId", "lastRequest") VALUES ('n1', 'u1', ${lastRequest})`,
      ],
    });
    try {
      await runtime.ready;
      const u1Db = usePostgresAppRuntimeDb(runtime, {
        principalPosture: actAsRuntimePrincipal('u1'),
      });
      await expect(
        u1Db.select({ id: bigintNotes.id, lastRequest: bigintNotes.lastRequest }).from(bigintNotes),
      ).resolves.toEqual([{ id: 'n1', lastRequest }]);
    } finally {
      await runtime.close();
    }
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

  it('revokes configured app-role and PUBLIC creation authority while preserving CONNECT and USAGE', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-create-default-deny-'));
    roots.push(dataDir);
    await execPglite(
      dataDir,
      [
        'CREATE ROLE kovo_reader',
        'CREATE ROLE kovo_writer',
        'CREATE SCHEMA kovo_runtime_extension',
        'GRANT CREATE ON SCHEMA public, kovo_runtime_extension TO kovo_writer',
        'GRANT CREATE, TEMPORARY ON DATABASE postgres TO kovo_writer',
        'GRANT CREATE ON SCHEMA public TO PUBLIC',
        'GRANT TEMPORARY ON DATABASE postgres TO PUBLIC',
      ].join('; '),
    );

    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    const privileges = await queryPglite<{
      writer_can_create_database: boolean;
      writer_can_create_schema: boolean;
      writer_can_temp: boolean;
      public_can_temp: boolean;
      writer_can_connect: boolean;
      writer_can_use_schema: boolean;
    }>(
      dataDir,
      [
        "SELECT has_schema_privilege('kovo_writer', 'kovo_runtime_extension', 'CREATE') AS writer_can_create_schema,",
        "has_database_privilege('kovo_writer', current_database(), 'CREATE') AS writer_can_create_database,",
        "has_database_privilege('kovo_writer', current_database(), 'TEMPORARY') AS writer_can_temp,",
        "EXISTS (SELECT 1 FROM pg_database database CROSS JOIN LATERAL aclexplode(COALESCE(database.datacl, acldefault('d', database.datdba))) acl",
        "WHERE database.datname = current_database() AND acl.grantee = 0 AND acl.privilege_type = 'TEMPORARY') AS public_can_temp,",
        "has_database_privilege('kovo_writer', current_database(), 'CONNECT') AS writer_can_connect,",
        "has_schema_privilege('kovo_writer', 'public', 'USAGE') AS writer_can_use_schema",
      ].join(' '),
    );
    expect(privileges.rows).toEqual([
      {
        public_can_temp: false,
        writer_can_connect: true,
        writer_can_create_database: false,
        writer_can_create_schema: false,
        writer_can_temp: false,
        writer_can_use_schema: true,
      },
    ]);

    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('rolls provisioning back without rewriting an undeclared assumable role', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-external-authority-'));
    roots.push(dataDir);
    await execPglite(
      dataDir,
      [
        'CREATE ROLE kovo_reader',
        'CREATE ROLE kovo_writer',
        'CREATE ROLE "shared Ω"',
        'CREATE SCHEMA "tenant Ω"',
        'GRANT CREATE ON SCHEMA "tenant Ω" TO "shared Ω"',
        'GRANT CREATE, TEMPORARY ON DATABASE postgres TO "shared Ω"',
        'GRANT "shared Ω" TO kovo_writer',
        `CREATE FUNCTION public.has_schema_privilege(oid, oid, text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT false'`,
        `CREATE FUNCTION public.has_database_privilege(oid, oid, text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT false'`,
        `CREATE FUNCTION public.pg_has_role(oid, oid, text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT false'`,
        'ALTER DATABASE postgres SET search_path = public, pg_catalog',
      ].join('; '),
    );

    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await expect(runtime.ready).rejects.toThrow(
        /KV433_UNEXPECTED_PRIVILEGE[\s\S]*shared Ω has effective/,
      );
    } finally {
      await runtime.close();
    }

    const rollback = await queryPglite<{
      can_create: boolean;
      can_temp: boolean;
      framework_roles: number;
      table_count: number;
    }>(
      dataDir,
      [
        `SELECT pg_catalog.has_schema_privilege('shared Ω', 'tenant Ω', 'CREATE') AS can_create,`,
        `pg_catalog.has_database_privilege('shared Ω', pg_catalog.current_database(), 'TEMPORARY') AS can_temp,`,
        `count(*) FILTER (WHERE rolname IN ('kovo_admin', 'kovo_system'))::int AS framework_roles,`,
        `(SELECT count(*)::int FROM pg_catalog.pg_class WHERE relname = 'kovo_runtime_notes') AS table_count`,
        `FROM pg_catalog.pg_roles`,
      ].join(' '),
    );
    expect(rollback.rows).toEqual([
      { can_create: true, can_temp: true, framework_roles: 0, table_count: 0 },
    ]);
  });

  it.each([
    {
      expected: 'elevated_external\\(CREATEROLE\\)',
      setup: 'CREATE ROLE elevated_external CREATEROLE; GRANT elevated_external TO kovo_writer',
    },
    {
      expected: 'PostgreSQL predefined role pg_write_all_data',
      setup: 'GRANT pg_write_all_data TO kovo_writer',
    },
    {
      expected:
        'kovo_writer in the reader/writer/runtime assumable-role closure holds ADMIN OPTION',
      setup:
        'CREATE ROLE delegated_external; GRANT delegated_external TO kovo_writer WITH ADMIN OPTION',
    },
  ])('rejects $expected without a separately named runtime login', async ({ expected, setup }) => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-closure-posture-'));
    roots.push(dataDir);
    await execPglite(
      dataDir,
      ['CREATE ROLE kovo_reader', 'CREATE ROLE kovo_writer', setup].join('; '),
    );

    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await expect(runtime.ready).rejects.toThrow(
        new RegExp(`KV433_RUNTIME_ROLE[\\s\\S]*${expected}`),
      );
    } finally {
      await runtime.close();
    }

    const rollback = await queryPglite<{ framework_roles: number; table_count: number }>(
      dataDir,
      [
        `SELECT count(*) FILTER (WHERE rolname IN ('kovo_admin', 'kovo_system'))::int AS framework_roles,`,
        `(SELECT count(*)::int FROM pg_catalog.pg_class WHERE relname = 'kovo_runtime_notes') AS table_count`,
        `FROM pg_catalog.pg_roles`,
      ].join(' '),
    );
    expect(rollback.rows).toEqual([{ framework_roles: 0, table_count: 0 }]);
  });

  it('refuses effective CREATE/TEMP authority for PUBLIC, runtime, writer, members, and owners', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-create-posture-'));
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
        'CREATE ROLE kovo_runtime_creator',
        'CREATE ROLE kovo_runtime_login LOGIN',
        'GRANT kovo_runtime_creator TO kovo_writer',
        'GRANT kovo_reader, kovo_writer TO kovo_runtime_login',
        'CREATE SCHEMA kovo_runtime_member_schema',
        'CREATE SCHEMA kovo_runtime_login_schema',
        'CREATE SCHEMA kovo_runtime_owned_schema AUTHORIZATION kovo_writer',
        'GRANT CREATE ON SCHEMA kovo_runtime_member_schema TO kovo_runtime_creator',
        'GRANT CREATE ON SCHEMA kovo_runtime_login_schema TO kovo_runtime_login',
        'GRANT CREATE ON SCHEMA public TO PUBLIC',
        'GRANT CREATE ON DATABASE postgres TO kovo_writer',
        'GRANT TEMPORARY ON DATABASE postgres TO PUBLIC',
      ].join('; '),
    );

    // TEMP lets an app identity put an attacker-controlled relation first in search_path. The
    // closure check must refuse that engine authority even when no persistent grant row leaks data.
    await usingPgliteRole(dataDir, 'kovo_writer', async (client) => {
      await client.exec(
        'CREATE TEMP TABLE kovo_runtime_notes (id text, "ownerId" text, "secretNote" text, title text)',
      );
      await client.exec(
        "INSERT INTO kovo_runtime_notes VALUES ('shadow', 'attacker', 'shadow-secret', 'shadow')",
      );
      const shadow = await client.query<{ id: string }>('SELECT id FROM kovo_runtime_notes');
      expect(shadow.rows).toEqual([{ id: 'shadow' }]);
    });

    const report = await checkPostgresAppDbPosture({
      dataDir,
      databaseUrl: 'postgres://kovo_runtime_login@127.0.0.1:5432/kovo',
      driver: 'pglite',
      schema,
    });
    expect(report.ok).toBe(false);
    for (const detail of [
      'PUBLIC has effective CREATE on schema public',
      'kovo_runtime_creator has effective CREATE on schema kovo_runtime_member_schema',
      'kovo_runtime_login has effective CREATE on schema kovo_runtime_login_schema',
      'kovo_writer has effective CREATE on schema kovo_runtime_owned_schema',
      'kovo_writer has effective CREATE on database postgres',
      'PUBLIC has effective TEMPORARY on database postgres',
    ]) {
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: 'KV433_UNEXPECTED_PRIVILEGE',
          detail: expect.stringContaining(detail),
        }),
      );
    }
  });

  it('pins live posture to one catalog-first transaction despite public and temporary shadows', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-posture-shadow-'));
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
        'CREATE ROLE posture_login LOGIN',
        'GRANT kovo_reader, kovo_writer TO posture_login',
        'CREATE ROLE elevated_shadow_role CREATEROLE',
        'GRANT elevated_shadow_role TO kovo_writer',
        'GRANT CREATE ON SCHEMA public TO kovo_writer',
        'GRANT CREATE, TEMPORARY ON DATABASE postgres TO kovo_writer',
        `CREATE FUNCTION public.has_schema_privilege(oid, oid, text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT false'`,
        `CREATE FUNCTION public.has_database_privilege(oid, oid, text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT false'`,
        'ALTER DATABASE postgres SET search_path = public, pg_catalog',
      ].join('; '),
    );

    type TestTransaction = {
      exec(statement: string): Promise<unknown>;
      query<Row>(query: string, params?: unknown[]): Promise<{ rows: Row[] }>;
    };
    const prototype = PGlite.prototype as unknown as {
      query<Row>(query: string, params?: unknown[]): Promise<{ rows: Row[] }>;
      transaction<Result>(callback: (tx: TestTransaction) => Promise<Result>): Promise<Result>;
    };
    const originalQuery = prototype.query;
    const originalTransaction = prototype.transaction;
    const directPostureQueries: string[] = [];
    prototype.query = async function <Row>(query: string, params?: unknown[]) {
      directPostureQueries.push(query);
      return originalQuery.call(this, query, params) as Promise<{ rows: Row[] }>;
    };
    prototype.transaction = async function <Result>(
      callback: (tx: TestTransaction) => Promise<Result>,
    ) {
      await originalQuery.call(
        this,
        `CREATE TEMP VIEW pg_roles AS SELECT * FROM pg_catalog.pg_roles WHERE rolname <> 'elevated_shadow_role'`,
      );
      await originalQuery.call(this, 'SET search_path = pg_temp, public, pg_catalog');
      return originalTransaction.call(this, callback);
    };
    try {
      const report = await checkPostgresAppDbPosture({
        dataDir,
        databaseUrl: 'postgres://posture_login@127.0.0.1:5432/kovo',
        driver: 'pglite',
        schema,
      });
      expect(report.ok).toBe(false);
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: 'KV433_RUNTIME_ROLE',
          detail: expect.stringContaining('elevated_shadow_role(CREATEROLE)'),
        }),
      );
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          code: 'KV433_UNEXPECTED_PRIVILEGE',
          detail: expect.stringContaining('kovo_writer has effective CREATE on schema public'),
        }),
      );
      expect(
        directPostureQueries.filter((query) => !query.includes('FROM pg_catalog.pg_type a')),
      ).toEqual([]);
    } finally {
      prototype.query = originalQuery;
      prototype.transaction = originalTransaction;
    }
  });

  it('does not execute attacker-created public function shadows while applying authored seed SQL', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-seed-shadow-'));
    roots.push(dataDir);
    await execPglite(
      dataDir,
      [
        'CREATE ROLE kovo_reader',
        'CREATE ROLE kovo_writer',
        'GRANT CREATE ON SCHEMA public TO kovo_writer',
        'SET ROLE kovo_writer',
        `CREATE FUNCTION public.lower(text) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT ''ATTACKER-SHADOW'''`,
        'RESET ROLE',
      ].join('; '),
    );

    const runtime = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      schema,
      seedSql: [
        `INSERT INTO kovo_runtime_notes (id, "ownerId", "secretNote", title) VALUES ('n1', 'u1', 's1', lower('Safe Title'))`,
        `INSERT INTO kovo_runtime_labels (id, label) VALUES ('l1', 'Inbox')`,
      ],
    });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    const result = await queryPglite<{ title: string }>(
      dataDir,
      `SELECT title FROM kovo_runtime_notes WHERE id = 'n1'`,
    );
    expect(result.rows).toEqual([{ title: 'safe title' }]);
  });

  it('keeps catalog lookup ahead of public while migrations create unqualified app objects in public', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-migration-shadow-'));
    roots.push(dataDir);
    await execPglite(
      dataDir,
      [
        'CREATE ROLE kovo_reader',
        'CREATE ROLE kovo_writer',
        'GRANT CREATE ON SCHEMA public TO kovo_writer',
        'SET ROLE kovo_writer',
        `CREATE FUNCTION public.lower(text) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT ''ATTACKER-SHADOW'''`,
        'RESET ROLE',
      ].join('; '),
    );

    const report = await migratePostgresAppDb({
      dataDir,
      driver: 'pglite',
      migrations: [
        {
          id: '001-shadow-safe-ddl',
          sql: [
            runtimeSchemaMigrationSql,
            `CREATE TABLE kovo_migration_shadow_probe AS SELECT lower('Reviewed DDL') AS value`,
          ].join('; '),
        },
      ],
      schema,
    });
    expect(report.posture.ok).toBe(true);

    const result = await queryPglite<{ schema_name: string; value: string }>(
      dataDir,
      [
        'SELECT namespace.nspname AS schema_name, probe.value',
        'FROM public.kovo_migration_shadow_probe probe',
        "JOIN pg_catalog.pg_class relation ON relation.relname = 'kovo_migration_shadow_probe'",
        'JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace',
      ].join(' '),
    );
    expect(result.rows).toEqual([{ schema_name: 'public', value: 'reviewed ddl' }]);
  });

  it('ignores a late PGlite transaction shim during creation-authority posture checks', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-posture-query-error-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    type TestTransaction = {
      exec(statement: string): Promise<unknown>;
      query<Row>(query: string, params?: unknown[]): Promise<{ rows: Row[] }>;
    };
    const prototype = PGlite.prototype as unknown as {
      transaction<Result>(callback: (tx: TestTransaction) => Promise<Result>): Promise<Result>;
    };
    const originalTransaction = prototype.transaction;
    let triggered = 0;
    prototype.transaction = async function <Result>(
      callback: (tx: TestTransaction) => Promise<Result>,
    ) {
      triggered += 1;
      return originalTransaction.call(this, (tx) =>
        callback({
          exec: (statement) => tx.exec(statement),
          query: <Row>(query: string, params?: unknown[]) => {
            if (query.includes('unsafe_schema_authority')) {
              throw new Error('forced-creation-authority-audit-failure');
            }
            return tx.query<Row>(query, params);
          },
        }),
      );
    };
    try {
      const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
      expect(triggered).toBe(0);
      expect(report.ok).toBe(true);
      expect(report.issues).toEqual([]);
    } finally {
      prototype.transaction = originalTransaction;
    }
  });

  it('refuses implicit current-database owner authority', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-database-owner-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    await execPglite(dataDir, 'ALTER DATABASE postgres OWNER TO kovo_writer');
    const report = await checkPostgresAppDbPosture({ dataDir, driver: 'pglite', schema });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV433_UNEXPECTED_PRIVILEGE',
        detail: expect.stringContaining('kovo_writer has effective CREATE on database postgres'),
      }),
    );
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV433_UNEXPECTED_PRIVILEGE',
        detail: expect.stringContaining('kovo_writer has effective TEMPORARY on database postgres'),
      }),
    );
  });

  it.each([
    {
      expected:
        'kovo_writer has effective OWNER-CREATE on schema kovo_runtime_owned_before_provision',
      label: 'schema ownership',
      setup: [
        'CREATE ROLE kovo_reader',
        'CREATE ROLE kovo_writer',
        'CREATE SCHEMA kovo_runtime_owned_before_provision AUTHORIZATION kovo_writer',
      ].join('; '),
    },
    {
      expected: 'kovo_writer has effective OWNER-CREATE on database postgres',
      label: 'database ownership',
      setup: [
        'CREATE ROLE kovo_reader',
        'CREATE ROLE kovo_writer',
        'ALTER DATABASE postgres OWNER TO kovo_writer',
      ].join('; '),
    },
  ])(
    'fails provisioning transactionally when an app role has $label',
    async ({ expected, setup }) => {
      const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-owned-provision-'));
      roots.push(dataDir);
      await execPglite(dataDir, setup);
      const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
      try {
        await expect(runtime.ready).rejects.toThrow(
          new RegExp(`KV433_UNEXPECTED_PRIVILEGE[\\s\\S]*${expected}`),
        );
      } finally {
        await runtime.close();
      }
    },
  );

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

  it('rejects adopted provider roles with privileged attributes before provisioning', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-adopt-privileged-'));
    roots.push(dataDir);
    await execPglite(
      dataDir,
      'CREATE ROLE "provider_reader" BYPASSRLS; CREATE ROLE "provider_writer";',
    );

    await withPostgresRoleEnv(
      { reader: 'provider_reader', writer: 'provider_writer' },
      async () => {
        const runtime = createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema, seedSql });
        try {
          await expect(runtime.ready).rejects.toThrow(
            /adopted Postgres roles must have no elevated role attributes[\s\S]*provider_reader\(BYPASSRLS\)/,
          );
        } finally {
          await runtime.close();
        }
      },
    );
  });

  it('classifies every known pg_roles attribute column and fails closed on additions', () => {
    expect(
      __testPostgresRuntimeInternals.unclassifiedPostgresRoleColumns([
        'rolbypassrls',
        'rolcanlogin',
        'rolconfig',
        'rolconnlimit',
        'rolcreatedb',
        'rolcreaterole',
        'rolinherit',
        'rolname',
        'rolpassword',
        'rolreplication',
        'rolsuper',
        'rolvaliduntil',
      ]),
    ).toEqual([]);
    expect(
      __testPostgresRuntimeInternals.unclassifiedPostgresRoleColumns([
        'rolsuper',
        'rolfuturebypass',
      ]),
    ).toEqual(['rolfuturebypass']);
  });

  it('classifies every pg_settings source and fails closed on future source categories', () => {
    const issue = __testPostgresRuntimeInternals.externalSessionSettingIssue([
      {
        context: 'user',
        name: 'future_semantics_switch',
        setting: 'unsafe',
        source: 'future provider control plane',
      },
    ]);
    expect(issue).toEqual({
      code: 'KV433_RUNTIME_SETTING',
      detail: expect.stringContaining(
        'unclassified pg_settings source future provider control plane',
      ),
    });

    expect(
      __testPostgresRuntimeInternals.externalSessionSettingIssue([
        {
          context: 'user',
          name: 'transaction_isolation',
          setting: 'repeatable read',
          source: 'session',
        },
        {
          context: 'user',
          name: 'transaction_read_only',
          setting: 'on',
          source: 'session',
        },
      ]),
    ).toBeUndefined();
  });

  it('grants runtime membership for adopted reader and writer roles', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-adopt-membership-'));
    roots.push(dataDir);
    await execPglite(dataDir, 'CREATE ROLE "provider_reader"; CREATE ROLE "provider_writer";');

    await withPostgresRoleEnv(
      { reader: 'provider_reader', writer: 'provider_writer' },
      async () => {
        const report = await migratePostgresAppDb({
          dataDir,
          driver: 'pglite',
          migrations: [
            {
              id: '001_runtime_login_schema',
              sql: ['CREATE ROLE provider_runtime_login LOGIN', runtimeSchemaMigrationSql].join(
                '; ',
              ),
            },
          ],
          runtimeDatabaseUrl: 'postgres://provider_runtime_login@127.0.0.1:5432/kovo',
          schema,
        });
        expect(report.posture.ok).toBe(true);

        const memberships = await queryPglite<{ can_reader: boolean; can_writer: boolean }>(
          dataDir,
          [
            'SELECT',
            "pg_has_role('provider_runtime_login', 'provider_reader', 'USAGE') AS can_reader,",
            "pg_has_role('provider_runtime_login', 'provider_writer', 'USAGE') AS can_writer",
          ].join(' '),
        );
        expect(memberships.rows[0]).toEqual({ can_reader: true, can_writer: true });
      },
    );
  });

  it('rejects elevated attributes on the runtime login and assumable roles', async () => {
    for (const [sqlAttribute, label] of [
      ['SUPERUSER', 'SUPERUSER'],
      ['BYPASSRLS', 'BYPASSRLS'],
      ['REPLICATION', 'REPLICATION'],
      ['CREATEROLE', 'CREATEROLE'],
      ['CREATEDB', 'CREATEDB'],
    ] as const) {
      const runtimeDataDir = mkdtempSync(
        join(tmpdir(), `kovo-postgres-runtime-login-${label.toLowerCase()}-`),
      );
      roots.push(runtimeDataDir);

      await expect(
        migratePostgresAppDb({
          dataDir: runtimeDataDir,
          driver: 'pglite',
          migrations: [
            {
              id: '001_runtime_login_schema',
              sql: [
                `CREATE ROLE elevated_runtime_login LOGIN ${sqlAttribute}`,
                runtimeSchemaMigrationSql,
              ].join('; '),
            },
          ],
          runtimeDatabaseUrl: 'postgres://elevated_runtime_login@127.0.0.1:5432/kovo',
          schema,
        }),
      ).rejects.toThrow(
        new RegExp(`KV433_RUNTIME_ROLE[\\s\\S]*elevated_runtime_login\\(${label}\\)`),
      );

      const assumableDataDir = mkdtempSync(
        join(tmpdir(), `kovo-postgres-runtime-assumable-${label.toLowerCase()}-`),
      );
      roots.push(assumableDataDir);
      await expect(
        migratePostgresAppDb({
          dataDir: assumableDataDir,
          driver: 'pglite',
          migrations: [
            {
              id: '001_runtime_login_schema',
              sql: [
                'CREATE ROLE provider_runtime_login LOGIN',
                `CREATE ROLE elevated_assumable_role ${sqlAttribute}`,
                'GRANT elevated_assumable_role TO provider_runtime_login',
                runtimeSchemaMigrationSql,
              ].join('; '),
            },
          ],
          runtimeDatabaseUrl: 'postgres://provider_runtime_login@127.0.0.1:5432/kovo',
          schema,
        }),
      ).rejects.toThrow(
        new RegExp(`KV433_RUNTIME_ROLE[\\s\\S]*elevated_assumable_role\\(${label}\\)`),
      );
    }
  }, 30_000);

  // SPEC §10.3 (C10/C11): the identity escalation surface is role ATTRIBUTES ∪ predefined-role
  // MEMBERSHIP. PostgreSQL predefined roles (pg_execute_server_program ⇒ COPY … FROM PROGRAM OS
  // command execution, pg_write_all_data, pg_read_all_data, server-file read/write, pg_monitor,
  // pg_maintain) carry NONE of the five elevated role attributes, so the attribute allowlist alone
  // lets that membership pass unflagged (round-17 B1). The predefined-role allowlist closes it.
  it('refuses runtime logins and assumable roles that are members of a predefined role', async () => {
    for (const predefinedRole of [
      'pg_execute_server_program',
      'pg_write_all_data',
      'pg_read_all_data',
      'pg_read_server_files',
      'pg_write_server_files',
      'pg_monitor',
    ] as const) {
      const runtimeDataDir = mkdtempSync(
        join(tmpdir(), `kovo-postgres-runtime-predefined-login-${predefinedRole}-`),
      );
      roots.push(runtimeDataDir);
      await expect(
        migratePostgresAppDb({
          dataDir: runtimeDataDir,
          driver: 'pglite',
          migrations: [
            {
              id: '001_runtime_login_schema',
              sql: [
                'CREATE ROLE predefined_runtime_login LOGIN',
                `GRANT ${predefinedRole} TO predefined_runtime_login`,
                runtimeSchemaMigrationSql,
              ].join('; '),
            },
          ],
          runtimeDatabaseUrl: 'postgres://predefined_runtime_login@127.0.0.1:5432/kovo',
          schema,
        }),
      ).rejects.toThrow(
        new RegExp(`KV433_RUNTIME_ROLE[\\s\\S]*PostgreSQL predefined role ${predefinedRole}`),
      );

      // Transitive membership: login → mid role → predefined role must surface in the MEMBER closure.
      const assumableDataDir = mkdtempSync(
        join(tmpdir(), `kovo-postgres-runtime-predefined-assumable-${predefinedRole}-`),
      );
      roots.push(assumableDataDir);
      await expect(
        migratePostgresAppDb({
          dataDir: assumableDataDir,
          driver: 'pglite',
          migrations: [
            {
              id: '001_runtime_login_schema',
              sql: [
                'CREATE ROLE predefined_provider_login LOGIN',
                'CREATE ROLE predefined_mid_role',
                `GRANT ${predefinedRole} TO predefined_mid_role`,
                'GRANT predefined_mid_role TO predefined_provider_login',
                runtimeSchemaMigrationSql,
              ].join('; '),
            },
          ],
          runtimeDatabaseUrl: 'postgres://predefined_provider_login@127.0.0.1:5432/kovo',
          schema,
        }),
      ).rejects.toThrow(
        new RegExp(`KV433_RUNTIME_ROLE[\\s\\S]*PostgreSQL predefined role ${predefinedRole}`),
      );
    }
  }, 30_000);

  // SPEC §10.3 (C10/C11): membership in only the framework's own roles must not over-block; the
  // predefined-role allowlist targets `pg_*` predefined roles, not the framework reader/writer/etc.
  it('passes a runtime login that is a member of only framework roles', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-predefined-ok-'));
    roots.push(dataDir);
    await execPglite(dataDir, 'CREATE ROLE "provider_reader"; CREATE ROLE "provider_writer";');
    await withPostgresRoleEnv(
      { reader: 'provider_reader', writer: 'provider_writer' },
      async () => {
        const report = await migratePostgresAppDb({
          dataDir,
          driver: 'pglite',
          migrations: [
            {
              id: '001_runtime_login_schema',
              sql: ['CREATE ROLE provider_runtime_login LOGIN', runtimeSchemaMigrationSql].join(
                '; ',
              ),
            },
          ],
          runtimeDatabaseUrl: 'postgres://provider_runtime_login@127.0.0.1:5432/kovo',
          schema,
        });
        expect(report.posture.ok).toBe(true);
        expect(
          report.posture.issues.some((issue) =>
            issue.detail.includes('member of PostgreSQL predefined role'),
          ),
        ).toBe(false);
      },
    );
  });

  it('refuses runtime logins that hold ADMIN OPTION on an assumable role', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-admin-option-'));
    roots.push(dataDir);
    await execPglite(
      dataDir,
      [
        'CREATE ROLE provider_runtime_login LOGIN',
        'CREATE ROLE provider_reader',
        'CREATE ROLE provider_writer',
        'GRANT provider_reader TO provider_runtime_login WITH ADMIN OPTION',
      ].join('; '),
    );

    await withPostgresRoleEnv(
      { reader: 'provider_reader', writer: 'provider_writer' },
      async () => {
        await expect(
          migratePostgresAppDb({
            dataDir,
            driver: 'pglite',
            migrations: [{ id: '001_runtime_login_schema', sql: runtimeSchemaMigrationSql }],
            runtimeDatabaseUrl: 'postgres://provider_runtime_login@127.0.0.1:5432/kovo',
            schema,
          }),
        ).rejects.toThrow(
          /KV433_RUNTIME_ROLE[\s\S]*provider_runtime_login[\s\S]*holds ADMIN OPTION on provider_reader/,
        );
      },
    );
  });

  it('refuses SECURITY DEFINER routines executable by the runtime login', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-login-routine-'));
    roots.push(dataDir);
    const report = await migratePostgresAppDb({
      dataDir,
      driver: 'pglite',
      migrations: [
        {
          id: '001_runtime_login_schema',
          sql: ['CREATE ROLE provider_runtime_login LOGIN', runtimeSchemaMigrationSql].join('; '),
        },
      ],
      runtimeDatabaseUrl: 'postgres://provider_runtime_login@127.0.0.1:5432/kovo',
      schema,
    });
    expect(report.posture.ok).toBe(true);

    await execPglite(
      dataDir,
      [
        "CREATE FUNCTION kovo_runtime_login_leak() RETURNS text LANGUAGE SQL SECURITY DEFINER AS $$ SELECT 'leak' $$",
        'REVOKE ALL ON FUNCTION kovo_runtime_login_leak() FROM PUBLIC',
        'GRANT EXECUTE ON FUNCTION kovo_runtime_login_leak() TO provider_runtime_login',
      ].join('; '),
    );

    const drifted = await checkPostgresAppDbPosture({
      dataDir,
      databaseUrl: 'postgres://provider_runtime_login@127.0.0.1:5432/kovo',
      driver: 'pglite',
      schema,
    });
    expect(drifted.ok).toBe(false);
    expect(drifted.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV433_REACHABLE_ROUTINE',
        detail: expect.stringContaining(
          'kovo_runtime_login_leak is a SECURITY DEFINER routine executable by provider_runtime_login',
        ),
      }),
    );
  });

  it('refuses relations granted directly to the runtime login', async () => {
    // SPEC §10.3 C10: relation reachability is the complete runtime-login plus assumable-role
    // closure, not only the four configured framework roles. A managed-provider login can carry a
    // direct legacy grant even while its role attributes and framework memberships are minimal.
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-login-relation-'));
    roots.push(dataDir);
    const report = await migratePostgresAppDb({
      dataDir,
      driver: 'pglite',
      migrations: [
        {
          id: '001_runtime_login_schema',
          sql: ['CREATE ROLE provider_runtime_login LOGIN', runtimeSchemaMigrationSql].join('; '),
        },
      ],
      runtimeDatabaseUrl: 'postgres://provider_runtime_login@127.0.0.1:5432/kovo',
      schema,
    });
    expect(report.posture.ok).toBe(true);

    await execPglite(
      dataDir,
      [
        'CREATE TABLE runtime_login_secret (id text PRIMARY KEY, secret text NOT NULL)',
        "INSERT INTO runtime_login_secret VALUES ('victim', 'runtime-login-secret')",
        'REVOKE ALL ON TABLE runtime_login_secret FROM PUBLIC',
        'GRANT SELECT ON TABLE runtime_login_secret TO provider_runtime_login',
      ].join('; '),
    );

    const drifted = await checkPostgresAppDbPosture({
      dataDir,
      databaseUrl: 'postgres://provider_runtime_login@127.0.0.1:5432/kovo',
      driver: 'pglite',
      schema,
    });
    expect(drifted.ok).toBe(false);
    expect(drifted.issues).toContainEqual(
      expect.objectContaining({
        code: 'KV433_REACHABLE_TABLE',
        detail: expect.stringContaining(
          'runtime_login_secret is reachable by an app role but is not a Kovo-protected table',
        ),
      }),
    );
  });

  it('refuses runtime logins that are the configured admin or system role', async () => {
    for (const [purpose, role] of [
      ['admin', 'kovo_admin'],
      ['system', 'kovo_system'],
    ] as const) {
      const dataDir = mkdtempSync(join(tmpdir(), `kovo-postgres-runtime-${purpose}-login-`));
      roots.push(dataDir);

      await expect(
        migratePostgresAppDb({
          dataDir,
          driver: 'pglite',
          migrations: [{ id: '001_runtime_login_schema', sql: runtimeSchemaMigrationSql }],
          runtimeDatabaseUrl: `postgres://${role}@127.0.0.1:5432/kovo`,
          schema,
        }),
      ).rejects.toThrow(new RegExp(`KV433_RUNTIME_ROLE[\\s\\S]*privileged framework role ${role}`));
    }
  });

  it('preflights adopted admin and system roles before applying DDL', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-adopt-admin-system-'));
    roots.push(dataDir);
    await execPglite(
      dataDir,
      [
        'CREATE ROLE "provider_reader"',
        'CREATE ROLE "provider_writer"',
        'CREATE ROLE "provider_admin"',
      ].join('; '),
    );

    await withPostgresRoleEnv(
      {
        admin: 'provider_admin',
        reader: 'provider_reader',
        system: 'missing_provider_system',
        writer: 'provider_writer',
      },
      async () => {
        await expect(
          migratePostgresAppDb({
            dataDir,
            driver: 'pglite',
            migrations: [{ id: '001_create_notes', sql: runtimeSchemaMigrationSql }],
            schema,
          }),
        ).rejects.toThrow(/KV433_ROLE_TOPOLOGY[\s\S]*systemRole=missing_provider_system/);

        const leakedObjects = await queryPglite<{ relname: string }>(
          dataDir,
          "SELECT relname FROM pg_class WHERE relname = 'kovo_runtime_notes'",
        );
        expect(leakedObjects.rows).toEqual([]);
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
      const writer = usePostgresAppRuntimeDb(runtime, request);
      const readDb = managedDb(writer, 'read');
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

  it('keeps audited crossOwnerRead parameters bound under a one-shot array iterator poison', async () => {
    drainCrossOwnerReadAuditFacts();
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-cross-owner-params-'));
    roots.push(dataDir);
    const runtime = createPostgresAppRuntimeDb({
      crossOwnerReadTables: ['kovo_runtime_notes'],
      dataDir,
      driver: 'pglite',
      schema: { notes },
      seedSql: [
        'INSERT INTO kovo_runtime_notes (id, "ownerId", "secretNote", title) VALUES ' +
          "('n1', 'u1', 's1', 'One'), ('n2', 'u2', 's2', 'Two')",
      ],
    });
    const nativeIterator = Array.prototype[Symbol.iterator];
    let triggered = 0;
    try {
      await runtime.ready;
      const request = { session: { user: { id: 'admin-user', roles: ['admin'] } } };
      const readDb = managedDb(usePostgresAppRuntimeDb(runtime, request), 'read');
      expect(await guards.role<typeof request>('admin')(request)).toBe(true);
      Array.prototype[Symbol.iterator] = function* (this: unknown[]) {
        if (this.length === 1 && this[0] === 'u1') {
          triggered += 1;
          Array.prototype[Symbol.iterator] = nativeIterator;
          yield 'u2';
          return;
        }
        yield* Reflect.apply(nativeIterator, this, []);
      } as (typeof Array.prototype)[Symbol.iterator];

      const result = await readDb.crossOwnerRead<{ id: string }>(
        sql`SELECT id FROM ${notes} WHERE ${notes.ownerId} = ${'u1'} ORDER BY id`,
        {
          reads: ['kovo_runtime_notes'],
          reason: 'verify reviewed parameter binding',
          role: 'admin',
        },
      );
      expect(triggered).toBe(0);
      expect(rowsOf(result)).toEqual([{ id: 'n1' }]);
      expect(drainCrossOwnerReadAuditFacts()).toEqual([
        expect.objectContaining({
          declaredReads: ['public.kovo_runtime_notes'],
          observedRead: 'public.kovo_runtime_notes',
          reason: 'verify reviewed parameter binding',
        }),
      ]);
    } finally {
      Array.prototype[Symbol.iterator] = nativeIterator;
      await runtime.close();
    }
  });

  it('refuses a same-named admin policy broadened to PUBLIC', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-admin-policy-shape-'));
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
    } finally {
      await runtime.close();
    }

    await execPglite(
      dataDir,
      [
        'DROP POLICY kovo_admin_scope ON public.kovo_runtime_notes',
        [
          'CREATE POLICY kovo_admin_scope ON public.kovo_runtime_notes',
          'FOR SELECT TO PUBLIC USING (true)',
        ].join(' '),
      ].join('; '),
    );
    await usingPgliteRole(dataDir, 'kovo_reader', async (client) => {
      await client.exec("SET LOCAL kovo.principal = 'u1'");
      await expect(
        client.query('SELECT id FROM public.kovo_runtime_notes ORDER BY id'),
      ).resolves.toMatchObject({ rows: [{ id: 'n1' }, { id: 'n2' }] });
    });

    const report = await checkPostgresAppDbPosture({
      crossOwnerReadTables: ['kovo_runtime_notes'],
      dataDir,
      driver: 'pglite',
      schema,
    });
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'KV433_ADMIN_POLICY' }));
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
      const systemCapability = runtime.systemDb({
        operation: 'write',
        reason: 'repair every note in engine-role proof',
        surface: 'postgres-runtime.test',
      });
      // SPEC §10.3: the system DB capability is intentionally not a raw app DB value.
      // @ts-expect-error opaque system capability must not be assignable to the raw DB surface.
      const _rawDb: KovoPostgresRuntimeDb = systemCapability;
      void _rawDb;
      const systemDb = usePostgresSystemDb(systemCapability, (db) => db);
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

  it('does not dispatch a late Promise.catch replacement while rolling back a failed transaction', async () => {
    const log: string[] = [];
    const client = {
      async query(statement: string) {
        log.push(statement);
        return { rows: [] };
      },
      release() {
        log.push('release');
      },
    };
    const pool = {
      async connect() {
        return client;
      },
      async end() {},
    };
    const runtimeClient = __testPostgresRuntimeInternals.createNodePostgresRuntimeClient(
      pool as never,
    );
    const nativeCatch = Promise.prototype.catch;
    let catchHits = 0;
    try {
      await expect(
        runtimeClient.transaction(async () => {
          Promise.prototype.catch = function poisonedCatch(onRejected) {
            catchHits += 1;
            return Reflect.apply(nativeCatch, this, [onRejected]);
          } as typeof Promise.prototype.catch;
          throw new Error('primary transaction failure');
        }),
      ).rejects.toThrow('primary transaction failure');
    } finally {
      Promise.prototype.catch = nativeCatch;
    }

    expect(catchHits).toBe(0);
    expect(log).toEqual(['BEGIN', 'ROLLBACK', 'DISCARD ALL', 'release']);
  });

  it('does not dispatch a late Pool.query method that forges PostgreSQL posture rows', async () => {
    const pool = new Pool({
      connectionString: 'postgres://127.0.0.1:1/kovo_primordial_probe',
      connectionTimeoutMillis: 50,
    });
    const runtimeClient = __testPostgresRuntimeInternals.createNodePostgresRuntimeClient(pool);
    const nativeQuery = Pool.prototype.query;
    const nativeEnd = Pool.prototype.end;
    let triggered = 0;
    let endTriggered = 0;
    Pool.prototype.query = function () {
      triggered += 1;
      Pool.prototype.query = nativeQuery;
      return Promise.resolve({
        rows: [{ relforcerowsecurity: true, relrowsecurity: true }],
      });
    } as typeof Pool.prototype.query;
    Pool.prototype.end = function () {
      endTriggered += 1;
      Pool.prototype.end = nativeEnd;
      return Promise.resolve();
    } as typeof Pool.prototype.end;
    try {
      await expect(
        runtimeClient.query('SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE false'),
      ).rejects.toThrow();
      expect(triggered).toBe(0);
      await pool.end();
      expect(endTriggered).toBe(0);
    } finally {
      Pool.prototype.query = nativeQuery;
      Pool.prototype.end = nativeEnd;
    }
  });

  it('does not dispatch a late Pool.connect method that substitutes a forged transaction client', async () => {
    const pool = new Pool({
      connectionString: 'postgres://127.0.0.1:1/kovo_primordial_connect_probe',
      connectionTimeoutMillis: 50,
    });
    const runtimeClient = __testPostgresRuntimeInternals.createNodePostgresRuntimeClient(pool);
    const nativeConnect = Pool.prototype.connect;
    let connectTriggered = 0;
    let queryTriggered = 0;
    let releaseTriggered = 0;
    Pool.prototype.connect = function () {
      connectTriggered += 1;
      Pool.prototype.connect = nativeConnect;
      return Promise.resolve({
        query() {
          queryTriggered += 1;
          return Promise.resolve({ rows: [{ forged: true }] });
        },
        release() {
          releaseTriggered += 1;
        },
      });
    } as typeof Pool.prototype.connect;
    try {
      await expect(runtimeClient.transaction(async () => undefined)).rejects.toThrow();
      expect(connectTriggered).toBe(0);
      expect(queryTriggered).toBe(0);
      expect(releaseTriggered).toBe(0);
    } finally {
      Pool.prototype.connect = nativeConnect;
      await pool.end();
    }
  });

  it('pins fresh pooled Client query/release controls and rejects accessor release carriers', async () => {
    const client = new Client() as Client & {
      _ending: boolean;
      release(error?: Error | boolean): void;
    };
    client._ending = true;
    let released = 0;
    Object.defineProperty(client, 'release', {
      configurable: true,
      enumerable: false,
      value: () => {
        released += 1;
      },
      writable: true,
    });
    const pinned = __testPostgresRuntimeInternals.pinNodePostgresPoolClient(client as never);
    const nativeQuery = Client.prototype.query;
    let queryTriggered = 0;
    Client.prototype.query = function () {
      queryTriggered += 1;
      Client.prototype.query = nativeQuery;
      return Promise.resolve({ rows: [{ forged: true }] });
    } as typeof Client.prototype.query;
    try {
      await expect(pinned.query('SELECT 1')).rejects.toThrow();
      expect(queryTriggered).toBe(0);
      let forgedRelease = 0;
      pinned.release = () => {
        forgedRelease += 1;
      };
      __testPostgresRuntimeInternals.releasePinnedNodePostgresPoolClient(pinned);
      expect(released).toBe(1);
      expect(forgedRelease).toBe(0);
    } finally {
      Client.prototype.query = nativeQuery;
    }

    const accessorClient = new Client() as Client & { release(): void };
    Object.defineProperty(accessorClient, 'release', {
      configurable: true,
      get: () => () => undefined,
    });
    expect(() =>
      __testPostgresRuntimeInternals.pinNodePostgresPoolClient(accessorClient as never),
    ).toThrow(/fresh own-data method/);
  });

  it('rejects transitive Pool.newClient and Client queue prototype substitution', async () => {
    const pool = new Pool({
      connectionString: 'postgres://127.0.0.1:1/kovo_internal_driver_probe',
      connectionTimeoutMillis: 50,
    });
    __testPostgresRuntimeInternals.createNodePostgresRuntimeClient(pool);
    const client = new Client({
      connectionString: 'postgres://127.0.0.1:1/kovo_internal_driver_probe',
    }) as Client & { release(error?: Error | boolean): void };
    Object.defineProperty(client, 'release', {
      configurable: true,
      enumerable: false,
      value: () => undefined,
      writable: true,
    });
    type InternalPoolPrototype = {
      newClient(pending: {
        callback(error?: Error, client?: Client, release?: () => void): void;
      }): void;
    };
    type InternalClientPrototype = {
      _pulseQueryQueue(): void;
    };
    const poolPrototype = Pool.prototype as unknown as InternalPoolPrototype;
    const clientPrototype = Client.prototype as unknown as InternalClientPrototype;
    const nativeNewClient = poolPrototype.newClient;
    const nativePulseQueryQueue = clientPrototype._pulseQueryQueue;
    let poolHookCalls = 0;
    let clientHookCalls = 0;
    poolPrototype.newClient = (pending) => {
      poolHookCalls += 1;
      pending.callback(undefined, client, client.release);
    };
    clientPrototype._pulseQueryQueue = () => {
      clientHookCalls += 1;
    };
    try {
      expect(() =>
        (pool as unknown as InternalPoolPrototype).newClient({
          callback: () => undefined,
        }),
      ).toThrow(/Client\._pulseQueryQueue changed after framework bootstrap/);
      expect(poolHookCalls).toBe(0);
      expect(clientHookCalls).toBe(0);
    } finally {
      poolPrototype.newClient = nativeNewClient;
      clientPrototype._pulseQueryQueue = nativePulseQueryQueue;
      await pool.end();
    }
  });

  it('keeps nested rollback ownership distinct under late clock and RNG replacement', async () => {
    const db = new PGlite();
    const originalNow = Date.now;
    const originalRandom = Math.random;
    try {
      await db.exec('create table nested_rollback_events (value text not null)');
      const query = async (queryInput: string | { text: string }, values?: unknown[]) => {
        const text = typeof queryInput === 'string' ? queryInput : queryInput.text;
        if (text === 'DISCARD ALL') return { rowCount: 0, rows: [] };
        const result = await db.query(text, values);
        return { rowCount: result.affectedRows ?? result.rows.length, rows: result.rows };
      };
      const client = { query, release() {} };
      const runtimeClient = __testPostgresRuntimeInternals.createNodePostgresRuntimeClient({
        connect: async () => client,
        end: async () => undefined,
        query,
      } as never);

      Date.now = () => 1;
      Math.random = () => 0.5;

      await runtimeClient.transaction(async (transaction) => {
        try {
          await transaction.transaction(async (outer) => {
            await outer.exec("insert into nested_rollback_events values ('outer')");
            try {
              await outer.transaction(async (inner) => {
                await inner.exec("insert into nested_rollback_events values ('inner')");
                throw new Error('inner failure');
              });
            } catch {}
            await outer.exec("insert into nested_rollback_events values ('after-inner')");
            throw new Error('outer failure');
          });
        } catch {}
      });

      await expect(db.query('select value from nested_rollback_events')).resolves.toMatchObject({
        rows: [],
      });
    } finally {
      Date.now = originalNow;
      Math.random = originalRandom;
      await db.close();
    }
  });

  it('requires separate external Postgres URLs for framework admin and system roles', async () => {
    const baseConfig = __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
      crossOwnerReadTables: ['kovo_runtime_notes'],
      databaseUrl: 'postgres://app-runtime@127.0.0.1:5432/kovo',
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
      adminDatabaseUrl: 'postgres://framework-admin@127.0.0.1:5432/kovo',
      crossOwnerReadTables: ['kovo_runtime_notes'],
      databaseUrl: 'postgres://app-runtime@127.0.0.1:5432/kovo',
      driver: 'node-postgres',
      postureCheck: {
        justification: 'unit test constructs handles without connecting',
        onBoot: false,
      },
      provisionOnBoot: false,
      schema,
      systemDatabaseUrl: 'postgres://framework-system@127.0.0.1:5432/kovo',
    });
    const privilegedClient = __testPostgresRuntimeInternals.createRuntimeClient(privilegedConfig);
    try {
      expect(() => privilegedClient.drizzleReadonlyDb('u1', 'kovo_reader', 'admin')).not.toThrow();
      expect(() => privilegedClient.drizzleRequestDb(undefined, 'system')).not.toThrow();
    } finally {
      await privilegedClient.close();
    }
  });

  it('does not dispatch a late Promise.all replacement while closing external role pools', async () => {
    const config = __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig({
      adminDatabaseUrl: 'postgres://framework-admin@127.0.0.1:5432/kovo',
      databaseUrl: 'postgres://app-runtime@127.0.0.1:5432/kovo',
      driver: 'node-postgres',
      postureCheck: {
        justification: 'unit test constructs handles without connecting',
        onBoot: false,
      },
      provisionOnBoot: false,
      schema,
      systemDatabaseUrl: 'postgres://framework-system@127.0.0.1:5432/kovo',
    });
    const runtimeClient = __testPostgresRuntimeInternals.createRuntimeClient(config);
    const nativeAll = Promise.all;
    let allHits = 0;
    Promise.all = function poisonedAll(values: Iterable<unknown>) {
      allHits += 1;
      return Reflect.apply(nativeAll, Promise, [values]);
    } as typeof Promise.all;
    let closing: Promise<void>;
    try {
      closing = runtimeClient.close();
    } finally {
      Promise.all = nativeAll;
    }

    await closing;
    expect(allHits).toBe(0);
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
      const u1Db = usePostgresAppRuntimeDb(runtime, {
        principalPosture: actAsRuntimePrincipal('u1'),
      });
      const u2Db = usePostgresAppRuntimeDb(runtime, {
        principalPosture: actAsRuntimePrincipal('u2'),
      });

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

  it('refuses string-form authzPolicy before Postgres can grant predicate-free access', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-runtime-authz-assertion-'));
    roots.push(dataDir);

    expect(() =>
      createPostgresAppRuntimeDb({
        dataDir,
        driver: 'pglite',
        schema: { guardAssertionNotes },
      }),
    ).toThrow(/KV433_AUTHZ_POLICY_UNSUPPORTED.*string guard assertion.*RLS/u);
  });
});

function assertOpaquePostgresProviderTypes(runtime: KovoPostgresAppRuntimeDb): void {
  if (false) {
    // @ts-expect-error SPEC §10.3: the app provider is an opaque token, not a raw callback.
    runtime.db({});
    runtime.systemDb({
      // @ts-expect-error SPEC §10.3 C9: public system capabilities are write-only.
      operation: 'read',
      reason: 'compile-time negative proof',
      surface: 'postgres-runtime.test',
    });
  }
}

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

function quoteTestIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function rowsOf<Row>(result: Row[] | { rows?: Row[] }): Row[] {
  return Array.isArray(result) ? result : (result.rows ?? []);
}
