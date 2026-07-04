import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { kovo } from '@kovojs/drizzle';
import { pgTable, serial, text } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';

import { checkPostgresAppDbPosture, createPostgresAppRuntimeDb } from './postgres-runtime.js';

// SPEC §10.3: the Postgres closure audit must retain every app-role-reachable
// object unless engine posture proves it safe at the finest effective privilege
// granularity. This fuzzer compares the real audit to PGlite role execution.

const APP_SCHEMA = 'public';
const NON_APP_SCHEMA = 'kovo_fuzzer_extra';
const MEMBER_ROLE = 'kovo_fuzzer_member';

const fuzzerNotes = pgTable(
  'kovo_fuzzer_notes',
  {
    id: text('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    secretNote: text('secretNote').notNull(),
    title: text('title').notNull(),
  },
  kovo({
    domain: 'fuzzer-notes',
    key: 'id',
    owner: 'ownerId',
    secret: ['secretNote'],
  }),
);

const fuzzerSerialNotes = pgTable(
  'kovo_fuzzer_serial_notes',
  {
    id: serial('id').primaryKey(),
    ownerId: text('ownerId').notNull(),
    title: text('title').notNull(),
  },
  kovo({
    domain: 'fuzzer-serial-notes',
    key: 'id',
    owner: 'ownerId',
  }),
);

const fuzzerSchema = { fuzzerNotes, fuzzerSerialNotes };
const fuzzerSeedSql = [
  [
    'INSERT INTO kovo_fuzzer_notes (id, "ownerId", "secretNote", title) VALUES',
    "('n1', 'u1', 's1', 'One'), ('n2', 'u2', 's2', 'Two')",
  ].join(' '),
];

type GrantTarget = 'admin' | 'member' | 'public' | 'reader' | 'writer';
type ObjectClass = 'definer-function' | 'foreign-table' | 'matview' | 'sequence' | 'table' | 'view';
type ProbeKind = 'function' | 'privilege' | 'relation' | 'sequence';
type RlsState = 'force-rls-policy' | 'no-rls' | 'rls-no-force';
type SchemaKind = 'app' | 'non-app';

interface GrantShapeCase {
  readonly grantTarget: GrantTarget;
  readonly granularity: 'column' | 'object' | 'table';
  readonly name: string;
  readonly objectClass: ObjectClass;
  readonly probeKind: ProbeKind;
  readonly rlsState: RlsState;
  readonly schemaKind: SchemaKind;
  readonly shouldLeak: boolean;
  materialize(ctx: CaseContext): Promise<CaseProbe>;
}

interface CaseContext {
  readonly client: PGlite;
  readonly index: number;
}

interface CaseProbe {
  readonly cleanupSql: readonly string[];
  readonly probeRole: string;
  readonly safeReachability?: boolean;
  readonly sql: string;
  readonly unsafePrivilege?: string;
}

interface ProbeRows {
  [key: string]: unknown;
  owner_id?: string;
  ownerId?: string;
  secret?: string;
  secretNote?: string;
  value?: string;
}

const roots: string[] = [];

describe('Postgres grant-shape closure fuzzer', () => {
  afterAll(() => {
    for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
  });

  it('matches audit refusal to engine-reachable leak shapes across grants and object classes', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-postgres-grant-fuzzer-'));
    roots.push(dataDir);

    const runtime = createPostgresAppRuntimeDb({
      dataDir,
      driver: 'pglite',
      schema: fuzzerSchema,
      seedSql: fuzzerSeedSql,
    });
    try {
      await runtime.ready;
    } finally {
      await runtime.close();
    }

    await withPglite(dataDir, async (client) => {
      await installFuzzerRoleFixtures(client);
    });

    const cases = grantShapeCases();
    const mismatches: string[] = [];

    for (const [index, testCase] of cases.entries()) {
      let probe: CaseProbe | undefined;
      let leak = false;
      try {
        await withPglite(dataDir, async (client) => {
          probe = await testCase.materialize({ client, index });
          leak = await probeLeak(client, testCase.probeKind, probe);
        });
        const report = await checkPostgresAppDbPosture({
          dataDir,
          driver: 'pglite',
          schema: fuzzerSchema,
        });
        const refused = !report.ok;
        if (leak !== testCase.shouldLeak || refused !== leak) {
          mismatches.push(
            [
              testCase.name,
              `expectedLeak=${testCase.shouldLeak}`,
              `actualLeak=${leak}`,
              `auditRefused=${refused}`,
              `issues=${report.issues.map((issue) => issue.code).join(',')}`,
            ].join(' '),
          );
        }
      } finally {
        if (probe !== undefined) {
          await withPglite(dataDir, async (client) => {
            await cleanupCase(client, probe.cleanupSql);
          });
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});

async function withPglite<Result>(
  dataDir: string,
  callback: (client: PGlite) => Promise<Result>,
): Promise<Result> {
  const client = new PGlite(dataDir);
  try {
    return await callback(client);
  } finally {
    await client.close();
  }
}

function grantShapeCases(): readonly GrantShapeCase[] {
  const cases: GrantShapeCase[] = [];
  const grantTargets: readonly GrantTarget[] = ['reader', 'writer', 'admin', 'public', 'member'];
  const schemaKinds: readonly SchemaKind[] = ['app', 'non-app'];

  for (const grantTarget of grantTargets) {
    for (const schemaKind of schemaKinds) {
      cases.push(tableLeakCase({ granularity: 'table', grantTarget, schemaKind }));
      cases.push(tableLeakCase({ granularity: 'column', grantTarget, schemaKind }));
    }
  }

  for (const grantTarget of ['reader', 'writer', 'admin'] as const) {
    cases.push(rlsOwnerBypassCase(grantTarget));
  }

  cases.push(protectedOwnerTableCase());
  for (const schemaKind of schemaKinds) cases.push(securityInvokerViewCase(schemaKind));

  for (const grantTarget of ['reader', 'public', 'member'] as const) {
    cases.push(definerViewCase(grantTarget, 'app'));
  }

  for (const grantTarget of ['reader', 'writer', 'public'] as const) {
    for (const schemaKind of schemaKinds) cases.push(materializedViewCase(grantTarget, schemaKind));
  }

  for (const grantTarget of grantTargets) {
    for (const schemaKind of schemaKinds) cases.push(sequenceLeakCase(grantTarget, schemaKind));
  }
  cases.push(protectedSerialSequenceCase());

  for (const grantTarget of grantTargets) {
    for (const schemaKind of schemaKinds) cases.push(definerFunctionCase(grantTarget, schemaKind));
  }

  for (const grantTarget of ['reader', 'public'] as const) {
    cases.push(foreignTableCase(grantTarget));
  }

  return cases;
}

function tableLeakCase(input: {
  grantTarget: GrantTarget;
  granularity: 'column' | 'table';
  schemaKind: SchemaKind;
}): GrantShapeCase {
  return {
    grantTarget: input.grantTarget,
    granularity: input.granularity,
    name: ['table', input.granularity, input.schemaKind, input.grantTarget, 'no-rls'].join(':'),
    objectClass: 'table',
    probeKind: 'relation',
    rlsState: 'no-rls',
    schemaKind: input.schemaKind,
    shouldLeak: true,
    async materialize(ctx) {
      const object = caseObject(input.schemaKind, ctx.index, 'table');
      await execMany(ctx.client, [
        createSchemaSql(input.schemaKind),
        createLeakTableSql(object.qualified),
        grantSchemaUsageSql(input.schemaKind, input.grantTarget),
        input.granularity === 'column'
          ? `GRANT SELECT (secret) ON TABLE ${object.qualified} TO ${grantGrantee(input.grantTarget)}`
          : `GRANT SELECT ON TABLE ${object.qualified} TO ${grantGrantee(input.grantTarget)}`,
      ]);
      return {
        cleanupSql: [`DROP TABLE IF EXISTS ${object.qualified} CASCADE`],
        probeRole: probeRole(input.grantTarget),
        sql:
          input.granularity === 'column'
            ? `SELECT secret FROM ${object.qualified}`
            : `SELECT secret FROM ${object.qualified} ORDER BY id`,
      };
    },
  };
}

function rlsOwnerBypassCase(grantTarget: 'admin' | 'reader' | 'writer'): GrantShapeCase {
  return {
    grantTarget,
    granularity: 'table',
    name: ['table', 'rls-no-force-owner-bypass', grantTarget].join(':'),
    objectClass: 'table',
    probeKind: 'relation',
    rlsState: 'rls-no-force',
    schemaKind: 'app',
    shouldLeak: true,
    async materialize(ctx) {
      const object = caseObject('app', ctx.index, 'rls_bypass');
      const role = grantGrantee(grantTarget);
      await execMany(ctx.client, [
        createLeakTableSql(object.qualified),
        `ALTER TABLE ${object.qualified} ENABLE ROW LEVEL SECURITY`,
        `CREATE POLICY kovo_owner_scope ON ${object.qualified} FOR SELECT TO ${role} USING (owner_id = current_setting('kovo.principal', true))`,
        `ALTER TABLE ${object.qualified} OWNER TO ${role}`,
        `GRANT SELECT ON TABLE ${object.qualified} TO ${role}`,
      ]);
      return {
        cleanupSql: [`DROP TABLE IF EXISTS ${object.qualified} CASCADE`],
        probeRole: probeRole(grantTarget),
        sql: `SELECT owner_id, secret FROM ${object.qualified} ORDER BY id`,
      };
    },
  };
}

function protectedOwnerTableCase(): GrantShapeCase {
  return {
    grantTarget: 'reader',
    granularity: 'column',
    name: 'table:force-rls-policy:protected-owner-reader',
    objectClass: 'table',
    probeKind: 'relation',
    rlsState: 'force-rls-policy',
    schemaKind: 'app',
    shouldLeak: false,
    async materialize() {
      return {
        cleanupSql: [],
        probeRole: 'kovo_reader',
        sql: 'SELECT "ownerId", title FROM kovo_fuzzer_notes ORDER BY id',
      };
    },
  };
}

function securityInvokerViewCase(schemaKind: SchemaKind): GrantShapeCase {
  return {
    grantTarget: 'reader',
    granularity: 'object',
    name: ['view', 'security-invoker', schemaKind, 'reader'].join(':'),
    objectClass: 'view',
    probeKind: 'relation',
    rlsState: 'force-rls-policy',
    schemaKind,
    shouldLeak: false,
    async materialize(ctx) {
      const object = caseObject(schemaKind, ctx.index, 'safe_view');
      await execMany(ctx.client, [
        createSchemaSql(schemaKind),
        `CREATE VIEW ${object.qualified} WITH (security_invoker=true) AS SELECT id, "ownerId", title FROM kovo_fuzzer_notes`,
        grantSchemaUsageSql(schemaKind, 'reader'),
        `GRANT SELECT ON TABLE ${object.qualified} TO kovo_reader`,
      ]);
      return {
        cleanupSql: [`DROP VIEW IF EXISTS ${object.qualified} CASCADE`],
        probeRole: 'kovo_reader',
        sql: `SELECT "ownerId", title FROM ${object.qualified} ORDER BY id`,
      };
    },
  };
}

function definerViewCase(grantTarget: GrantTarget, schemaKind: SchemaKind): GrantShapeCase {
  return {
    grantTarget,
    granularity: 'object',
    name: ['view', 'definer', schemaKind, grantTarget].join(':'),
    objectClass: 'view',
    probeKind: 'relation',
    rlsState: 'force-rls-policy',
    schemaKind,
    shouldLeak: true,
    async materialize(ctx) {
      const object = caseObject(schemaKind, ctx.index, 'definer_view');
      await execMany(ctx.client, [
        createSchemaSql(schemaKind),
        `CREATE VIEW ${object.qualified} AS SELECT id, "ownerId", "secretNote" AS secret FROM kovo_fuzzer_notes`,
        grantSchemaUsageSql(schemaKind, grantTarget),
        `GRANT SELECT ON TABLE ${object.qualified} TO ${grantGrantee(grantTarget)}`,
      ]);
      return {
        cleanupSql: [`DROP VIEW IF EXISTS ${object.qualified} CASCADE`],
        probeRole: probeRole(grantTarget),
        sql: `SELECT owner_id, secret FROM (SELECT "ownerId" AS owner_id, secret FROM ${object.qualified}) AS leaked ORDER BY owner_id`,
      };
    },
  };
}

function materializedViewCase(grantTarget: GrantTarget, schemaKind: SchemaKind): GrantShapeCase {
  return {
    grantTarget,
    granularity: 'object',
    name: ['matview', schemaKind, grantTarget].join(':'),
    objectClass: 'matview',
    probeKind: 'relation',
    rlsState: 'force-rls-policy',
    schemaKind,
    shouldLeak: true,
    async materialize(ctx) {
      const object = caseObject(schemaKind, ctx.index, 'matview');
      await execMany(ctx.client, [
        createSchemaSql(schemaKind),
        `CREATE MATERIALIZED VIEW ${object.qualified} AS SELECT id, "ownerId" AS owner_id, "secretNote" AS secret FROM kovo_fuzzer_notes`,
        grantSchemaUsageSql(schemaKind, grantTarget),
        `GRANT SELECT ON TABLE ${object.qualified} TO ${grantGrantee(grantTarget)}`,
      ]);
      return {
        cleanupSql: [`DROP MATERIALIZED VIEW IF EXISTS ${object.qualified} CASCADE`],
        probeRole: probeRole(grantTarget),
        sql: `SELECT owner_id, secret FROM ${object.qualified} ORDER BY id`,
      };
    },
  };
}

function sequenceLeakCase(grantTarget: GrantTarget, schemaKind: SchemaKind): GrantShapeCase {
  return {
    grantTarget,
    granularity: 'object',
    name: ['sequence', schemaKind, grantTarget].join(':'),
    objectClass: 'sequence',
    probeKind: 'sequence',
    rlsState: 'no-rls',
    schemaKind,
    shouldLeak: true,
    async materialize(ctx) {
      const object = caseObject(schemaKind, ctx.index, 'seq');
      await execMany(ctx.client, [
        createSchemaSql(schemaKind),
        `CREATE SEQUENCE ${object.qualified}`,
        grantSchemaUsageSql(schemaKind, grantTarget),
        `GRANT USAGE ON SEQUENCE ${object.qualified} TO ${grantGrantee(grantTarget)}`,
      ]);
      return {
        cleanupSql: [`DROP SEQUENCE IF EXISTS ${object.qualified} CASCADE`],
        probeRole: probeRole(grantTarget),
        sql: `SELECT nextval('${object.schema}.${object.name}') AS value`,
      };
    },
  };
}

function protectedSerialSequenceCase(): GrantShapeCase {
  return {
    grantTarget: 'writer',
    granularity: 'object',
    name: 'sequence:protected-serial-writer',
    objectClass: 'sequence',
    probeKind: 'sequence',
    rlsState: 'force-rls-policy',
    schemaKind: 'app',
    shouldLeak: false,
    async materialize() {
      return {
        cleanupSql: [],
        probeRole: 'kovo_writer',
        safeReachability: true,
        sql: "INSERT INTO kovo_fuzzer_serial_notes (\"ownerId\", title) VALUES ('u1', 'own') RETURNING id",
      };
    },
  };
}

function definerFunctionCase(grantTarget: GrantTarget, schemaKind: SchemaKind): GrantShapeCase {
  return {
    grantTarget,
    granularity: 'object',
    name: ['definer-function', schemaKind, grantTarget].join(':'),
    objectClass: 'definer-function',
    probeKind: 'function',
    rlsState: 'force-rls-policy',
    schemaKind,
    shouldLeak: true,
    async materialize(ctx) {
      const object = caseObject(schemaKind, ctx.index, 'fn');
      await execMany(ctx.client, [
        createSchemaSql(schemaKind),
        [
          `CREATE FUNCTION ${object.qualified}() RETURNS TABLE(owner_id text, secret text)`,
          'LANGUAGE SQL SECURITY DEFINER',
          'AS $$ SELECT "ownerId", "secretNote" FROM kovo_fuzzer_notes ORDER BY id $$',
        ].join(' '),
        grantSchemaUsageSql(schemaKind, grantTarget),
        `GRANT EXECUTE ON FUNCTION ${object.qualified}() TO ${grantGrantee(grantTarget)}`,
      ]);
      return {
        cleanupSql: [`DROP FUNCTION IF EXISTS ${object.qualified}() CASCADE`],
        probeRole: probeRole(grantTarget),
        sql: `SELECT owner_id, secret FROM ${object.qualified}() ORDER BY owner_id`,
      };
    },
  };
}

function foreignTableCase(grantTarget: GrantTarget): GrantShapeCase {
  return {
    grantTarget,
    granularity: 'object',
    name: ['foreign-table', 'non-app', grantTarget].join(':'),
    objectClass: 'foreign-table',
    probeKind: 'privilege',
    rlsState: 'no-rls',
    schemaKind: 'non-app',
    shouldLeak: true,
    async materialize(ctx) {
      const object = caseObject('non-app', ctx.index, 'foreign_table');
      const fdwName = `kovo_fuzzer_fdw_${ctx.index}`;
      const serverName = `kovo_fuzzer_server_${ctx.index}`;
      await execMany(ctx.client, [
        createSchemaSql('non-app'),
        `CREATE FOREIGN DATA WRAPPER ${quoteIdent(fdwName)}`,
        `CREATE SERVER ${quoteIdent(serverName)} FOREIGN DATA WRAPPER ${quoteIdent(fdwName)}`,
        `CREATE FOREIGN TABLE ${object.qualified} (id text, secret text) SERVER ${quoteIdent(serverName)}`,
        grantSchemaUsageSql('non-app', grantTarget),
        `GRANT SELECT ON TABLE ${object.qualified} TO ${grantGrantee(grantTarget)}`,
      ]);
      return {
        cleanupSql: [
          `DROP FOREIGN TABLE IF EXISTS ${object.qualified} CASCADE`,
          `DROP SERVER IF EXISTS ${quoteIdent(serverName)} CASCADE`,
          `DROP FOREIGN DATA WRAPPER IF EXISTS ${quoteIdent(fdwName)} CASCADE`,
        ],
        probeRole: probeRole(grantTarget),
        sql: `SELECT has_table_privilege(current_user, '${object.schema}.${object.name}', 'SELECT') AS unsafe`,
        unsafePrivilege: 'unsafe',
      };
    },
  };
}

async function installFuzzerRoleFixtures(client: PGlite): Promise<void> {
  await ensureRole(client, 'kovo_admin');
  await ensureRole(client, MEMBER_ROLE);
  await execMany(client, [
    `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(NON_APP_SCHEMA)}`,
    `GRANT ${quoteIdent(MEMBER_ROLE)} TO kovo_reader`,
  ]);
}

async function ensureRole(client: PGlite, role: string): Promise<void> {
  const existing = await client.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists',
    [role],
  );
  if (existing.rows[0]?.exists === true) return;
  await client.exec(`CREATE ROLE ${quoteIdent(role)}`);
}

async function probeLeak(client: PGlite, kind: ProbeKind, probe: CaseProbe): Promise<boolean> {
  await client.exec('BEGIN');
  try {
    await client.exec(`SET LOCAL ROLE ${quoteIdent(probe.probeRole)}`);
    await client.exec("SET LOCAL kovo.principal = 'u1'");
    const result = await client.query<ProbeRows>(probe.sql);
    await client.exec('COMMIT');
    if (kind === 'privilege') {
      return result.rows.some((row) => row[probe.unsafePrivilege ?? 'unsafe'] === true);
    }
    if (kind === 'sequence') return probe.safeReachability !== true && result.rows.length > 0;
    return result.rows.some(
      (row) =>
        row.owner_id === 'u2' ||
        row.ownerId === 'u2' ||
        row.secret === 's2' ||
        row.secretNote === 's2',
    );
  } catch {
    await client.exec('ROLLBACK').catch(() => undefined);
    return false;
  }
}

async function cleanupCase(client: PGlite, cleanupSql: readonly string[]): Promise<void> {
  for (const statement of cleanupSql) {
    await client.exec(statement).catch(() => undefined);
  }
}

async function execMany(client: PGlite, statements: readonly string[]): Promise<void> {
  for (const statement of statements) {
    if (statement.trim() !== '') await client.exec(statement);
  }
}

function createLeakTableSql(qualifiedName: string): string {
  return [
    `CREATE TABLE ${qualifiedName} (id text PRIMARY KEY, owner_id text NOT NULL, secret text NOT NULL)`,
    `INSERT INTO ${qualifiedName} (id, owner_id, secret) VALUES ('n1', 'u1', 's1'), ('n2', 'u2', 's2')`,
  ].join('; ');
}

function createSchemaSql(schemaKind: SchemaKind): string {
  return schemaKind === 'non-app'
    ? `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(NON_APP_SCHEMA)}`
    : '';
}

function grantSchemaUsageSql(schemaKind: SchemaKind, target: GrantTarget): string {
  return schemaKind === 'non-app'
    ? `GRANT USAGE ON SCHEMA ${quoteIdent(NON_APP_SCHEMA)} TO ${grantGrantee(target)}`
    : '';
}

function grantGrantee(target: GrantTarget): string {
  switch (target) {
    case 'admin':
      return 'kovo_admin';
    case 'member':
      return quoteIdent(MEMBER_ROLE);
    case 'public':
      return 'PUBLIC';
    case 'reader':
      return 'kovo_reader';
    case 'writer':
      return 'kovo_writer';
  }
}

function probeRole(target: GrantTarget): string {
  return target === 'member' || target === 'public' ? 'kovo_reader' : grantGrantee(target);
}

function caseObject(schemaKind: SchemaKind, index: number, prefix: string) {
  const schema = schemaKind === 'app' ? APP_SCHEMA : NON_APP_SCHEMA;
  const name = `kovo_fuzzer_${prefix}_${index}`;
  return {
    name,
    qualified: `${quoteIdent(schema)}.${quoteIdent(name)}`,
    schema,
  };
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
