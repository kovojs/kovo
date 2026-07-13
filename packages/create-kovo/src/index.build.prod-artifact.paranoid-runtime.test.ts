import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { demoPasswordEnvVar, writeKovoProject } from './index.js';
import {
  addPostgresParanoidFollowup8Shapes,
  addDemoUserProvisioningFlow,
  addParanoidPhase5AuthorizationProof,
  addParanoidPhase5WriteBoundaryProof,
  addPostgresParanoidPhase5DogfoodProof,
  addSqliteRuntimeSecretProvenanceProof,
  addStarterMutationDbScopeProof,
  attributeValue,
  buildParanoidProductionArtifact,
  fieldValue,
  formHtmlByAction,
  pruneParanoidPhase5SqliteReadSet,
  provisionDemoUser,
  signInDemoUser,
} from './index.build.test-support.js';
import {
  collectOutput,
  cookieHeader,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  reservePort,
  resolveDependencyRoot,
  resolveStarterBin,
  stopProcess,
  withRepoBinOnPath,
  withStarterBinOnPath,
} from './index.test-support.js';

const blockedReadCases = [
  'sqlite-secret-alias-egress',
  'sqlite-secret-view-egress',
  'sqlite-secret-derivation-egress',
  'sqlite-secret-computed-egress',
  'sqlite-secret-join-alias-egress',
  'sqlite-secret-cte-egress',
  'sqlite-secret-subquery-egress',
  'sqlite-secret-union-egress',
  'sqlite-secret-aggregate-egress',
] as const;

const allowedReadCases = [
  { key: 'sqlite-secret-nonsecret-projection', leaksSecret: false, witness: 'public label' },
  { key: 'sqlite-secret-computed-public', leaksSecret: false, witness: 'PUBLIC LABEL' },
  { key: 'sqlite-secret-reveal', leaksSecret: true, witness: 'runtime-secret-value:revealed' },
] as const;

const blockedWriteCases = [
  'starter-db-scope/auth-user-table-write',
  'starter-db-scope/auth-session-table-write',
  'starter-db-scope/raw-auth-table-write',
  'phase5-write-boundary/ddl-write',
  'phase5-write-boundary/boxed-secret-builder',
  'phase5-write-boundary/boxed-secret-raw',
  'phase5-write-boundary/governed-mass-assignment',
] as const;

const POSTGRES_BINARIES = ['initdb', 'postgres'] as const;
const postgresToolchain = localPostgresToolchain();
const describeIfPostgres = postgresToolchain.available ? describe : describe.skip;
const itIfPostgres = postgresToolchain.available ? it : it.skip;
const require = createRequire(import.meta.url);
const { Pool } = require(resolveDependencyRoot('pg')) as {
  Pool: new (options: { connectionString: string; max: number }) => PgPool;
};

describe('create-kovo starter (build integration: paranoid runtime chokes)', () => {
  // @kovo-security-certifies KV435 phase-5-postgres-paranoid-dogfood-read-acceptance
  // @kovo-security-certifies KV406 phase-5-postgres-paranoid-dogfood-write-acceptance
  itIfPostgres(
    'runs the Phase 5 Postgres paranoid dogfood harness from the production artifact',
    async () => {
      const tempParent = tmpdir();
      mkdirSync(tempParent, { recursive: true });
      const root = mkdtempSync(join(tempParent, 'create-kovo-phase5-postgres-paranoid-'));
      const clusterRoot = mkdtempSync(join(tempParent, 'create-kovo-phase5-postgres-cluster-'));
      const port = await reservePort();
      const jar = new Map<string, string>();
      let cluster: LocalPostgresCluster | undefined;
      let server: ChildProcessWithoutNullStreams | undefined;

      try {
        writeKovoProject(root, {
          dialect: 'postgres',
          name: 'Phase 5 Postgres Paranoid Dogfood Proof',
        });
        linkStarterBuildDependencies(root);
        addPostgresParanoidPhase5DogfoodProof(root);
        addPostgresParanoidFollowup8Shapes(root);
        disableRuntimeSeedSql(root);

        buildParanoidProductionArtifact(root);
        cluster = await startLocalPostgres(clusterRoot);
        const database = `kovo_phase5_pg_${Date.now()}`;
        const adminRole = `kovo_phase5_pg_admin_${Date.now()}`;
        const runtimeRole = `kovo_phase5_pg_runtime_${Date.now()}`;
        await createExternalDatabase(cluster, { adminRole, database, runtimeRole });
        const adminUrl = cluster.url(database, adminRole);
        const runtimeUrl = cluster.url(database, runtimeRole);
        const systemUrl = cluster.url(database, 'kovo_system');

        const generateOutput = execKovo(root, [
          'db',
          'generate',
          '--schema',
          'src/schema.ts',
          '--migrations',
          'migrations',
          '--admin-database-url',
          adminUrl,
          '--database-url',
          runtimeUrl,
        ]);
        expect(generateOutput).toMatch(/STATUS (generated|empty)/u);

        const provisionOutput = execKovo(root, [
          'db',
          'provision',
          '--schema',
          'src/schema.ts',
          '--migrations',
          'migrations',
          '--admin-database-url',
          adminUrl,
          '--database-url',
          runtimeUrl,
        ]);
        expect(provisionOutput).toContain('STATUS ok');
        await grantRuntimeDataRoles(cluster.url(database, 'postgres'), runtimeRole);
        await installPhase5PostgresParanoidFixtures(
          cluster.url(database, 'postgres'),
          demoPasswordFromRoot(root),
        );
        await expectSystemAuthFixtureVisible(systemUrl);

        server = spawn(process.execPath, ['dist/server/server.mjs'], {
          cwd: root,
          detached: process.platform !== 'win32',
          env: {
            ...withRepoBinOnPath(),
            BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
            HOST: '127.0.0.1',
            KOVO_DATABASE_URL: runtimeUrl,
            KOVO_DB_SYSTEM_URL: systemUrl,
            KOVO_PARANOID: '1',
            NODE_ENV: 'production',
            PORT: String(port),
          },
        });
        const output = collectOutput(server);
        const origin = `http://127.0.0.1:${port}`;
        const marker = `phase5-pg-${Date.now()}-${Math.random().toString(16).slice(2)}`;

        await signInDemoUser(root, origin, jar, output);
        await expectPostgresEndpoint(origin, output);
        await expectPostgresReferenceMemberships(origin);
        await expectPostgresReadonlyStatus(origin, marker);
        await expectPostgresWriteBoundary(origin, jar);
        await expectPostgresTaskAndWebhook(origin, jar, marker, output);

        expect(output()).not.toContain('Kovo SQLite starter is experimental');
        expect(output()).not.toContain('phase5-pg-secret');
        expect(output()).not.toContain('cross-owner-write');
      } finally {
        await stopProcess(server);
        await cluster?.stop();
        rmSync(root, { force: true, recursive: true });
        rmSync(clusterRoot, { force: true, recursive: true });
      }
    },
    240_000,
  );

  // @kovo-security-certifies KV435 phase-5-1-full-paranoid-dogfood-read-acceptance
  // @kovo-security-certifies KV406 phase-5-1-full-paranoid-dogfood-write-acceptance
  it('runs the Phase 5.1 full-paranoid dogfood acceptance across read and write shapes', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-phase5-paranoid-dogfood-'));
    const port = await reservePort();
    const jar = new Map<string, string>();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, {
        dialect: 'sqlite',
        name: 'Phase 5.1 Full Paranoid Dogfood Proof',
      });
      linkStarterBuildDependencies(root);
      addSqliteRuntimeSecretProvenanceProof(root);
      pruneParanoidPhase5SqliteReadSet(root);
      addStarterMutationDbScopeProof(root);
      addParanoidPhase5WriteBoundaryProof(root);
      addParanoidPhase5AuthorizationProof(root);
      addDemoUserProvisioningFlow(root);

      buildParanoidProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          KOVO_PARANOID: '1',
          NODE_ENV: 'production',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;
      const marker = `phase5-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const contactEmail = `${marker}-contact@example.com`;

      await provisionDemoUser(root, origin, output);
      await signInDemoUser(root, origin, jar, output);
      await expectAuthorizationQueryShapes(origin, jar);
      await expectBlockedReadShapes(origin, jar);
      await expectAllowedReadShapes(origin, jar);
      await expectNonSecretAggregateEndpoint(origin);
      await expectSafeBuilderExpressionEndpoint(origin);
      await expectHiddenBuilderExpressionEndpoint(origin);
      await expectDeclaredRawReadEndpoint(origin);
      await expectUnderdeclaredRawReadEndpoint(origin);
      await expectStarterInScopeWrite(origin, jar, output, contactEmail);
      await expectAuthorizationEndpoint(origin);
      await expectAuthorizationStatus(origin);
      await expectBlockedWrites(origin, jar, marker, output);
      await expectWriteStatus(origin, marker, contactEmail, output);

      expect(output()).toContain('Kovo SQLite starter is experimental and single-principal only');
      expect(output()).toContain('KV435');
      expect(output()).toContain('KV406');
      expect(output()).toContain('KV438');
      expect(output()).not.toContain('runtime-secret-value');
      expect(output()).not.toContain('phase5-builder-secret');
      expect(output()).not.toContain('phase5-raw-secret');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 240_000);
});

describeIfPostgres(
  'create-kovo starter (build integration: paranoid runtime external Postgres followup 8)',
  () => {
    const roots: string[] = [];
    const clusters: LocalPostgresCluster[] = [];

    afterAll(async () => {
      await Promise.allSettled(clusters.splice(0).map((cluster) => cluster.stop()));
      for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
    });

    it('runs provision -> check -> boot for the paranoid served artifact without manual runtime grants', async () => {
      const tempParent = tmpdir();
      mkdirSync(tempParent, { recursive: true });
      const root = mkdtempSync(join(tempParent, 'create-kovo-authz-paranoid-external-'));
      const clusterRoot = mkdtempSync(join(tempParent, 'create-kovo-authz-paranoid-cluster-'));
      roots.push(root, clusterRoot);
      const cluster = await startLocalPostgres(clusterRoot);
      clusters.push(cluster);
      const port = await reservePort();
      let server: ChildProcessWithoutNullStreams | undefined;

      const database = `kovo_authz_paranoid_${Date.now()}`;
      const adminRole = `kovo_authz_admin_${Date.now()}`;
      const runtimeRole = `kovo_authz_runtime_${Date.now()}`;

      try {
        writeKovoProject(root, { dialect: 'postgres', name: 'Authz Paranoid External Proof' });
        linkStarterBuildDependencies(root);
        writeProductionEquivalentSchemaModule(root);
        writeStarterPostgresMigration(root);
        buildParanoidProductionArtifact(root);

        await createExternalDatabase(cluster, { adminRole, database, runtimeRole });
        const adminUrl = cluster.url(database, adminRole);
        const runtimeUrl = cluster.url(database, runtimeRole);
        const systemUrl = cluster.url(database, 'kovo_system');

        const provisionOutput = execKovo(root, [
          'db',
          'provision',
          '--schema',
          '.kovo/external-postgres-schema.mjs',
          '--migrations',
          'migrations',
          '--admin-database-url',
          adminUrl,
          '--database-url',
          runtimeUrl,
        ]);
        expect(provisionOutput).toContain('STATUS ok');

        const runtimeCheckOutput = execKovo(root, [
          'db',
          'check',
          '--schema',
          '.kovo/external-postgres-schema.mjs',
          '--database-url',
          runtimeUrl,
        ]);
        expect(runtimeCheckOutput).toContain('STATUS ok');

        server = spawn(process.execPath, ['dist/server/server.mjs'], {
          cwd: root,
          detached: process.platform !== 'win32',
          env: {
            ...withRepoBinOnPath(),
            BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
            HOST: '127.0.0.1',
            KOVO_DATABASE_URL: runtimeUrl,
            KOVO_DB_SYSTEM_URL: systemUrl,
            KOVO_PARANOID: '1',
            NODE_ENV: 'production',
            PORT: String(port),
          },
        });
        const output = collectOutput(server);
        const loginHtml = await fetchTextWhenReady(`http://127.0.0.1:${port}/login`, output);
        expect(loginHtml).toContain('Sign in');
      } finally {
        await stopProcess(server);
      }
    }, 240_000);

    it('refuses a materialized-view leak and a PUBLIC-granted leak in the paranoid external Postgres check', async () => {
      const tempParent = tmpdir();
      mkdirSync(tempParent, { recursive: true });
      const root = mkdtempSync(join(tempParent, 'create-kovo-authz-refusal-external-'));
      const clusterRoot = mkdtempSync(join(tempParent, 'create-kovo-authz-refusal-cluster-'));
      roots.push(root, clusterRoot);
      const cluster = await startLocalPostgres(clusterRoot);
      clusters.push(cluster);

      const database = `kovo_authz_refusal_${Date.now()}`;
      const adminRole = `kovo_authz_refusal_admin_${Date.now()}`;
      const runtimeRole = `kovo_authz_refusal_runtime_${Date.now()}`;

      writeKovoProject(root, { dialect: 'postgres', name: 'Authz Paranoid Refusal Proof' });
      linkStarterBuildDependencies(root);
      writeProductionEquivalentSchemaModule(root);
      writeStarterPostgresMigration(root);
      buildParanoidProductionArtifact(root);

      await createExternalDatabase(cluster, { adminRole, database, runtimeRole });
      const adminUrl = cluster.url(database, adminRole);
      const runtimeUrl = cluster.url(database, runtimeRole);
      const postgresUrl = cluster.url(database, 'postgres');

      const provisionOutput = execKovo(root, [
        'db',
        'provision',
        '--schema',
        '.kovo/external-postgres-schema.mjs',
        '--migrations',
        'migrations',
        '--admin-database-url',
        adminUrl,
        '--database-url',
        runtimeUrl,
      ]);
      expect(provisionOutput).toContain('STATUS ok');
      await installFixtureUsers(postgresUrl);
      await createUnsafeReachableObjects(adminUrl);
      const createdForeignLeak = await createUnsafeForeignTable(postgresUrl);

      const failure = execKovoFailure(root, [
        'db',
        'check',
        '--schema',
        '.kovo/external-postgres-schema.mjs',
        '--database-url',
        runtimeUrl,
      ]);
      expect(failure).toMatch(/kovo_paranoid_user_mv/u);
      expect(failure).toMatch(/kovo_public_leak/u);
      if (createdForeignLeak) expect(failure).toMatch(/kovo_foreign_leak/u);
    }, 240_000);
  },
);

async function expectPostgresEndpoint(origin: string, output: () => string): Promise<void> {
  const response = await fetch(`${origin}/api/phase5-pg-endpoint`);
  const body = await response.text();
  expect(response.status, `${body}\n${output()}`).toBe(200);
  const result = JSON.parse(body) as {
    aliasRows: { id: string; label: string }[];
    childRows: { id: string; label: string }[];
    dbQueryRows: { id: string; label: string }[];
    rawRows: { id: string; label: string }[];
    rows: { id: string; label: string }[];
    subqueryRows: { id: string; label: string }[];
    unionRows: { id: string; label: string }[];
    viewRows: { id: string; label: string }[];
  };

  expect(result.rows).toEqual([{ id: 'phase5-pg-demo', label: 'owner-visible' }]);
  expect(result.aliasRows).toEqual(result.rows);
  expect(result.dbQueryRows).toEqual(result.rows);
  expect(result.rawRows).toEqual(result.rows);
  expect(result.subqueryRows).toEqual(result.rows);
  expect(result.unionRows).toEqual(result.rows);
  expect(result.viewRows).toEqual(result.rows);
  expect(result.childRows).toEqual([{ id: 'phase5-pg-item-demo', label: 'owner-item' }]);
  expect(body).not.toContain('cross-owner-hidden');
  expect(body).not.toContain('other-item');
  expect(body).not.toContain('phase5-pg-secret');
}

async function expectPostgresReferenceMemberships(origin: string): Promise<void> {
  const response = await fetch(`${origin}/api/phase5-pg-reference-memberships`);
  const body = await response.text();
  expect(response.status, body).toBe(200);
  const result = JSON.parse(body) as {
    rows: { id: string; label: string; teamId: string; userId: string }[];
  };

  expect(result.rows).toEqual([
    {
      id: 'phase5-pg-membership-demo',
      label: 'owner-membership',
      teamId: 'team-demo',
      userId: 'demo-user',
    },
  ]);
}

async function expectPostgresReadonlyStatus(origin: string, marker: string): Promise<void> {
  const response = await fetch(`${origin}/api/phase5-pg-status?marker=${marker}`);
  const body = await response.text();
  expect(response.status, body).toBe(200);
  const status = JSON.parse(body) as {
    builderSecretReadBlocked: boolean;
    events: { id: string; label: string }[];
    readonlyRows: { id: string; label: string }[];
    secretReadBlocked: boolean;
    verificationDenied: boolean;
  };

  expect(status.readonlyRows).toEqual([]);
  expect(status.events).toEqual([]);
  expect(status.builderSecretReadBlocked).toBe(true);
  expect(status.secretReadBlocked).toBe(true);
  expect(status.verificationDenied).toBe(true);
}

async function expectPostgresWriteBoundary(
  origin: string,
  jar: Map<string, string>,
): Promise<void> {
  const csrf = await fetchMutationCsrf(origin, jar, 'phase5-pg/cross-owner-order-write');
  const crossOwnerWrite = await fetch(`${origin}/_m/phase5-pg/cross-owner-order-write`, {
    body: new URLSearchParams({ csrf, marker: 'phase5-pg-cross' }),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(jar),
      origin,
    },
    method: 'POST',
    redirect: 'manual',
  });
  const crossOwnerBody = await crossOwnerWrite.text();
  expect([303, 500], crossOwnerBody).toContain(crossOwnerWrite.status);
  expect(crossOwnerBody).not.toContain('cross-owner-write');

  const response = await fetch(`${origin}/api/phase5-pg-write-boundary`);
  const body = await response.text();
  expect(response.status, body).toBe(200);
  expect(JSON.parse(body)).toEqual({
    crossOwnerDenied: true,
    verificationDenied: true,
  });
}

async function expectPostgresTaskAndWebhook(
  origin: string,
  jar: Map<string, string>,
  marker: string,
  output: () => string,
): Promise<void> {
  const csrf = await fetchMutationCsrf(origin, jar, 'phase5-pg/schedule-task');
  const taskResponse = await fetch(`${origin}/_m/phase5-pg/schedule-task`, {
    body: new URLSearchParams({ csrf, marker }),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(jar),
      origin,
    },
    method: 'POST',
    redirect: 'manual',
  });
  const taskBody = await taskResponse.text();
  expect(taskResponse.status, `${taskBody}\n${output()}`).toBe(303);

  const webhookId = `${marker}-webhook`;
  const webhookResponse = await fetch(`${origin}/webhooks/phase5-pg-read`, {
    body: JSON.stringify({ id: webhookId }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const webhookBody = await webhookResponse.text();
  expect(webhookResponse.status, webhookBody).toBe(200);

  await expectEventuallyPostgresEvent(origin, marker);
}

async function fetchMutationCsrf(
  origin: string,
  jar: Map<string, string>,
  mutation: string,
): Promise<string> {
  const response = await fetch(`${origin}/`, {
    headers: { cookie: cookieHeader(jar) },
  });
  const body = await response.text();
  expect(response.status, body).toBe(200);
  const form = formHtmlByAction(body, `/_m/${mutation}`);
  const csrf = fieldValue(form, 'csrf');
  expect(csrf).toBeTruthy();
  return csrf;
}

async function expectEventuallyPostgresEvent(origin: string, marker: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastBody = '';
  while (Date.now() < deadline) {
    const response = await fetch(`${origin}/api/phase5-pg-status?marker=${marker}`);
    lastBody = await response.text();
    expect(response.status, lastBody).toBe(200);
    const status = JSON.parse(lastBody) as { events: { id: string; label: string }[] };
    if (status.events.some((event) => event.label === 'owner-visible')) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for phase5-pg-task-event: ${lastBody}`);
}

async function expectAuthorizationQueryShapes(
  origin: string,
  jar: Map<string, string>,
): Promise<void> {
  const cases = [
    {
      key: 'phase5-authz-builder',
      allowed: 'owner-visible',
      visibleCrossOwner: 'cross-owner-hidden',
      status: 200,
    },
    {
      key: 'phase5-authz-alias',
      allowed: 'owner-visible',
      visibleCrossOwner: 'cross-owner-hidden',
      status: 200,
    },
    {
      key: 'phase5-authz-view',
      allowed: 'owner-visible',
      visibleCrossOwner: 'cross-owner-hidden',
      status: 200,
    },
    {
      key: 'phase5-authz-compound',
      allowed: undefined,
      visibleCrossOwner: undefined,
      status: 500,
    },
    {
      key: 'phase5-authz-owner-via',
      allowed: 'owner-item',
      visibleCrossOwner: 'other-item',
      status: 200,
    },
  ] as const;

  for (const testCase of cases) {
    const response = await fetch(`${origin}/_q/${testCase.key}`, {
      headers: { cookie: cookieHeader(jar) },
    });
    const body = await response.text();

    expect(response.status, `${testCase.key}: ${body}`).toBe(testCase.status);
    if (testCase.allowed !== undefined) expect(body).toContain(testCase.allowed);
    if (testCase.visibleCrossOwner !== undefined) {
      expect(body).toContain(testCase.visibleCrossOwner);
    }
    expect(body).not.toContain('phase5-authz-secret');
  }
}

async function expectAuthorizationEndpoint(origin: string): Promise<void> {
  const response = await fetch(`${origin}/api/phase5-authz-endpoint`);
  const body = await response.text();

  expect(response.status, body).toBe(200);
  const result = JSON.parse(body) as {
    childRows: { id: string; label: string }[];
    rows: { id: string; label: string }[];
  };
  expect(result.rows).toEqual(
    expect.arrayContaining([
      { id: 'phase5-authz-owned', label: 'owner-visible' },
      { id: 'phase5-authz-other', label: 'cross-owner-hidden' },
    ]),
  );
  expect(result.childRows).toEqual(
    expect.arrayContaining([
      { id: 'phase5-authz-item-owned', label: 'owner-item' },
      { id: 'phase5-authz-item-other', label: 'other-item' },
    ]),
  );
}

async function expectAuthorizationStatus(origin: string): Promise<void> {
  const response = await fetch(`${origin}/api/phase5-authz-status`);
  const body = await response.text();
  expect(response.status, body).toBe(200);
  const status = JSON.parse(body) as {
    rows: { id: string; label: string; userId: string }[];
    secretReadBlocked: boolean;
  };

  expect(status.secretReadBlocked).toBe(true);
  expect(status.rows).toEqual(
    expect.arrayContaining([
      {
        id: 'phase5-authz-owned',
        label: 'owner-visible',
        userId: 'demo-user',
      },
      {
        id: 'phase5-authz-other',
        label: 'cross-owner-hidden',
        userId: 'other-user',
      },
    ]),
  );
  expect(
    status.rows.some(
      (row) => row.id === 'phase5-authz-owned-session' && row.label === 'owner-visible',
    ),
  ).toBe(true);
}

async function expectBlockedReadShapes(origin: string, jar: Map<string, string>): Promise<void> {
  for (const key of blockedReadCases) {
    const response = await fetch(`${origin}/_q/${key}`, {
      headers: { cookie: cookieHeader(jar) },
    });
    const body = await response.text();

    expect(response.status, `${key}: ${body}`).toBe(500);
    expect(body).toMatch(/^\{"code":"(?:KV410|SERVER_ERROR)","payload":\{\}\}$/u);
    expect(body).not.toContain('runtime-secret-value');
  }
}

async function expectAllowedReadShapes(origin: string, jar: Map<string, string>): Promise<void> {
  for (const testCase of allowedReadCases) {
    const response = await fetch(`${origin}/_q/${testCase.key}`, {
      headers: { cookie: cookieHeader(jar) },
    });
    const body = await response.text();

    expect(response.status, `${testCase.key}: ${body}`).toBe(200);
    expect(body).toContain(`<kovo-query name="${testCase.key}"`);
    expect(body).toContain(testCase.witness);
    if (!testCase.leaksSecret) expect(body).not.toContain('runtime-secret-value');
  }
}

async function expectNonSecretAggregateEndpoint(origin: string): Promise<void> {
  const response = await fetch(`${origin}/api/sqlite-secret-nonsecret-aggregate`);
  const body = await response.text();

  expect(response.status, body).toBe(200);
  expect(body).toContain('"total":1');
  expect(body).not.toContain('runtime-secret-value');
}

async function expectSafeBuilderExpressionEndpoint(origin: string): Promise<void> {
  const response = await fetch(`${origin}/api/sqlite-secret-safe-builder-expression`);
  const body = await response.text();

  expect(response.status, body).toBe(200);
  expect(body).toContain('ADA LOVELACE');
  expect(body).not.toContain('runtime-secret-value');
}

async function expectHiddenBuilderExpressionEndpoint(origin: string): Promise<void> {
  const response = await fetch(`${origin}/api/sqlite-secret-hidden-builder-expression`);
  const body = await response.text();

  expect(response.status, body).toBe(500);
  expect(body).not.toContain('runtime-secret-value');
}

async function expectDeclaredRawReadEndpoint(origin: string): Promise<void> {
  const response = await fetch(`${origin}/api/sqlite-raw-read-declared`);
  const body = await response.text();

  expect(response.status, body).toBe(200);
  expect(body).toContain('Ada Lovelace');
  expect(body).not.toContain('runtime-secret-value');
}

async function expectUnderdeclaredRawReadEndpoint(origin: string): Promise<void> {
  const response = await fetch(`${origin}/api/sqlite-raw-read-underdeclared`);
  const body = await response.text();

  expect(response.status, body).toBe(500);
  expect(body).not.toContain('runtime-secret-value');
  expect(body).not.toContain('join public label');
}

async function expectStarterInScopeWrite(
  origin: string,
  jar: Map<string, string>,
  output: () => string,
  contactEmail: string,
): Promise<void> {
  const homeHtml = await fetchTextWhenReady(`${origin}/`, output, {
    headers: { cookie: cookieHeader(jar) },
  });
  const addForm = formHtmlByAction(homeHtml, '/_m/mutations/add-contact');
  const action = attributeValue(addForm, 'action');
  expect(action).toBe('/_m/mutations/add-contact');

  const addContact = await fetch(`${origin}${action}`, {
    body: new URLSearchParams({
      company: 'Phase 5.1 Scope Proof',
      csrf: fieldValue(addForm, 'csrf'),
      email: contactEmail,
      'Kovo-Idem': fieldValue(addForm, 'Kovo-Idem'),
      name: 'Phase 5.1 In Scope',
    }),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(jar),
      origin,
    },
    method: 'POST',
    redirect: 'manual',
  });
  await addContact.text();
  expect(addContact.status).toBe(303);
}

async function expectBlockedWrites(
  origin: string,
  jar: Map<string, string>,
  marker: string,
  output: () => string,
): Promise<void> {
  for (const key of blockedWriteCases) {
    const csrf = await fetchMutationCsrf(origin, jar, key);
    const response = await fetch(`${origin}/_m/${key}`, {
      body: new URLSearchParams({ csrf, marker }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader(jar),
        origin,
      },
      method: 'POST',
      redirect: 'manual',
    });
    const body = await response.text();

    expect(response.status, `${key}: ${body}\n${output()}`).toBe(500);
    expect(body).not.toContain(marker);
    expect(body).not.toContain('runtime-secret-value');
    expect(body).not.toContain('phase5-builder-secret');
    expect(body).not.toContain('phase5-raw-secret');
  }
}

function execKovo(root: string, args: readonly string[]): string {
  const bin = resolveStarterBin(root, 'kovo');
  const command = bin.endsWith('.ts') ? process.execPath : bin;
  const commandArgs = bin.endsWith('.ts')
    ? ['--disable-warning=ExperimentalWarning', '--experimental-transform-types', bin, ...args]
    : [...args];
  return execFileSync(command, commandArgs, {
    cwd: root,
    env: withStarterBinOnPath(root),
    encoding: 'utf8',
    stdio: 'pipe',
  }) as string;
}

function execKovoFailure(root: string, args: readonly string[]): string {
  try {
    execKovo(root, args);
  } catch (error) {
    const stdout =
      typeof error === 'object' && error !== null && 'stdout' in error
        ? String((error as { stdout?: string }).stdout ?? '')
        : '';
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String((error as { stderr?: string }).stderr ?? '')
        : '';
    return `${stdout}\n${stderr}`.trim();
  }
  throw new Error(`Expected kovo command to fail: ${args.join(' ')}`);
}

function disableRuntimeSeedSql(root: string): void {
  const runtimeDbPath = join(root, 'src/_kovo/app-runtime-db.ts');
  const runtimeDb = readFileSync(runtimeDbPath, 'utf8').replace(
    '  seedSql: [SEED_CONTACTS, ...PHASE5_PG_PARANOID_SEED],',
    '  seedSql: [],',
  );
  writeFileSync(runtimeDbPath, runtimeDb, 'utf8');
}

function writeProductionEquivalentSchemaModule(root: string): void {
  mkdirSync(join(root, '.kovo'), { recursive: true });
  writeFileSync(
    join(root, '.kovo/external-postgres-schema.mjs'),
    [
      "import { kovo } from '@kovojs/drizzle';",
      "import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';",
      '',
      "export const contacts = pgTable('contacts', {",
      "  id: text('id').primaryKey(),",
      "  name: text('name').notNull(),",
      "  email: text('email').notNull(),",
      "  company: text('company').notNull().default(''),",
      "}, kovo({ authzPolicy: 'signed-in users share the starter contact book through query/mutation guards', domain: 'model/contact', key: (table) => table.id }));",
      '',
      "export const user = pgTable('user', {",
      "  id: text('id').primaryKey(),",
      "  name: text('name').notNull(),",
      "  email: text('email').notNull().unique(),",
      "  emailVerified: boolean('emailVerified').notNull().default(false),",
      "  image: text('image'),",
      "  createdAt: timestamp('createdAt').notNull().defaultNow(),",
      "  updatedAt: timestamp('updatedAt').notNull().defaultNow(),",
      '}, kovo({ domain: "auth", key: "id", owner: (table) => table.id }));',
      '',
      "export const session = pgTable('session', {",
      "  id: text('id').primaryKey(),",
      "  expiresAt: timestamp('expiresAt').notNull(),",
      "  token: text('token').notNull().unique(),",
      "  createdAt: timestamp('createdAt').notNull().defaultNow(),",
      "  updatedAt: timestamp('updatedAt').notNull().defaultNow(),",
      "  ipAddress: text('ipAddress'),",
      "  userAgent: text('userAgent'),",
      "  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),",
      '}, kovo({ domain: "auth", key: "userId", owner: "userId", secret: ["token"] }));',
      '',
      "export const account = pgTable('account', {",
      "  id: text('id').primaryKey(),",
      "  accountId: text('accountId').notNull(),",
      "  providerId: text('providerId').notNull(),",
      "  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),",
      "  accessToken: text('accessToken'),",
      "  refreshToken: text('refreshToken'),",
      "  idToken: text('idToken'),",
      "  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),",
      "  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),",
      "  scope: text('scope'),",
      "  password: text('password'),",
      "  createdAt: timestamp('createdAt').notNull().defaultNow(),",
      "  updatedAt: timestamp('updatedAt').notNull().defaultNow(),",
      '}, kovo({ domain: "auth", key: "userId", owner: "userId", secret: ["password", "accessToken", "refreshToken", "idToken"] }));',
      '',
      "export const verification = pgTable('verification', {",
      "  id: text('id').primaryKey(),",
      "  identifier: text('identifier').notNull(),",
      "  value: text('value').notNull(),",
      "  expiresAt: timestamp('expiresAt').notNull(),",
      "  createdAt: timestamp('createdAt').notNull().defaultNow(),",
      "  updatedAt: timestamp('updatedAt').notNull().defaultNow(),",
      '});',
      '',
      'export const authSchema = { user, session, account, verification };',
      '',
    ].join('\n'),
    'utf8',
  );
}

function writeStarterPostgresMigration(root: string): void {
  mkdirSync(join(root, 'migrations'), { recursive: true });
  writeFileSync(
    join(root, 'migrations', '001-create-starter-schema.sql'),
    [
      'CREATE TABLE "user" (',
      '  id text PRIMARY KEY,',
      '  name text NOT NULL,',
      '  email text NOT NULL UNIQUE,',
      '  "emailVerified" boolean NOT NULL DEFAULT false,',
      '  image text,',
      '  "createdAt" timestamp NOT NULL DEFAULT now(),',
      '  "updatedAt" timestamp NOT NULL DEFAULT now()',
      ');',
      '',
      'CREATE TABLE contacts (',
      '  id text PRIMARY KEY,',
      '  name text NOT NULL,',
      '  email text NOT NULL,',
      "  company text NOT NULL DEFAULT ''",
      ');',
      '',
      'CREATE TABLE session (',
      '  id text PRIMARY KEY,',
      '  "expiresAt" timestamp NOT NULL,',
      '  token text NOT NULL UNIQUE,',
      '  "createdAt" timestamp NOT NULL DEFAULT now(),',
      '  "updatedAt" timestamp NOT NULL DEFAULT now(),',
      '  "ipAddress" text,',
      '  "userAgent" text,',
      '  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE cascade',
      ');',
      '',
      'CREATE TABLE account (',
      '  id text PRIMARY KEY,',
      '  "accountId" text NOT NULL,',
      '  "providerId" text NOT NULL,',
      '  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE cascade,',
      '  "accessToken" text,',
      '  "refreshToken" text,',
      '  "idToken" text,',
      '  "accessTokenExpiresAt" timestamp,',
      '  "refreshTokenExpiresAt" timestamp,',
      '  scope text,',
      '  password text,',
      '  "createdAt" timestamp NOT NULL DEFAULT now(),',
      '  "updatedAt" timestamp NOT NULL DEFAULT now()',
      ');',
      '',
      'CREATE TABLE verification (',
      '  id text PRIMARY KEY,',
      '  identifier text NOT NULL,',
      '  value text NOT NULL,',
      '  "expiresAt" timestamp NOT NULL,',
      '  "createdAt" timestamp NOT NULL DEFAULT now(),',
      '  "updatedAt" timestamp NOT NULL DEFAULT now()',
      ');',
      '',
    ].join('\n'),
    'utf8',
  );
}

async function installFixtureUsers(databaseUrl: string): Promise<void> {
  await withPool(databaseUrl, async (pool) => {
    await pool.query(
      [
        'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES',
        "('demo-user', 'Demo User', 'demo@example.com', false, now(), now()),",
        "('other-user', 'Other User', 'other@example.com', false, now(), now())",
        'ON CONFLICT (id) DO NOTHING',
      ].join(' '),
    );
  });
}

function demoPasswordFromRoot(root: string): string {
  return (
    new RegExp(`^${demoPasswordEnvVar}=(.+)$`, 'm').exec(
      readFileSync(join(root, '.env'), 'utf8'),
    )?.[1] ?? ''
  );
}

async function installPhase5PostgresParanoidFixtures(
  databaseUrl: string,
  password: string,
): Promise<void> {
  const passwordHash = await betterAuthPasswordHash(password);
  await withPool(databaseUrl, async (pool) => {
    await pool.query(
      [
        'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")',
        "VALUES ('demo-user', 'Demo User', 'demo@example.com', false, now(), now()),",
        "('other-user', 'Other User', 'other@example.com', false, now(), now())",
        'ON CONFLICT (id) DO NOTHING',
      ].join(' '),
    );
    await pool.query(
      [
        'INSERT INTO account',
        '(id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")',
        "VALUES ('demo-account', 'demo-user', 'credential', 'demo-user', $1, now(), now())",
        'ON CONFLICT (id) DO UPDATE SET password = excluded.password, "updatedAt" = now()',
      ].join(' '),
      [passwordHash],
    );
    await pool.query(
      [
        'INSERT INTO phase5_pg_orders (id, user_id, label, classified) VALUES',
        "('phase5-pg-demo', 'demo-user', 'owner-visible', 'phase5-pg-secret-demo'),",
        "('phase5-pg-other', 'other-user', 'cross-owner-hidden', 'phase5-pg-secret-other')",
        'ON CONFLICT (id) DO NOTHING',
      ].join(' '),
    );
    await pool.query(
      [
        'INSERT INTO phase5_pg_items (id, order_id, label) VALUES',
        "('phase5-pg-item-demo', 'phase5-pg-demo', 'owner-item'),",
        "('phase5-pg-item-other', 'phase5-pg-other', 'other-item')",
        'ON CONFLICT (id) DO NOTHING',
      ].join(' '),
    );
    await pool.query(
      [
        'INSERT INTO phase5_pg_reference_memberships (id, team_id, user_id, label) VALUES',
        "('phase5-pg-membership-demo', 'team-demo', 'demo-user', 'owner-membership'),",
        "('phase5-pg-membership-other', 'team-other', 'other-user', 'cross-tenant-membership')",
        'ON CONFLICT (id) DO NOTHING',
      ].join(' '),
    );
    await pool.query('DROP VIEW IF EXISTS phase5_pg_order_view');
    await pool.query(
      'CREATE VIEW phase5_pg_order_view WITH (security_invoker=true) AS SELECT id, user_id, label FROM phase5_pg_orders',
    );
    await pool.query('GRANT SELECT ON phase5_pg_order_view TO kovo_reader');
  });
}

async function expectSystemAuthFixtureVisible(databaseUrl: string): Promise<void> {
  await withPool(databaseUrl, async (pool) => {
    const result = await pool.query<{
      account_rows: number;
      credential_rows: number;
      user_rows: number;
    }>(
      [
        'SELECT',
        '(SELECT count(*)::int FROM "user" WHERE email = $1) AS user_rows,',
        '(SELECT count(*)::int FROM account WHERE "userId" = $2) AS account_rows,',
        '(',
        '  SELECT count(*)::int FROM account',
        '  WHERE "userId" = $2 AND "providerId" = $3 AND password IS NOT NULL',
        ') AS credential_rows',
      ].join(' '),
      ['demo@example.com', 'demo-user', 'credential'],
    );
    expect(result.rows[0]).toEqual({
      account_rows: 1,
      credential_rows: 1,
      user_rows: 1,
    });
  });
}

async function betterAuthPasswordHash(password: string): Promise<string> {
  const passwordModule = await import(
    pathToFileURL(join(resolveDependencyRoot('@better-auth/utils'), 'dist/password.mjs')).href
  );
  return (passwordModule as { hashPassword: (password: string) => Promise<string> }).hashPassword(
    password,
  );
}

async function createExternalDatabase(
  cluster: LocalPostgresCluster,
  names: { adminRole: string; database: string; runtimeRole: string },
): Promise<void> {
  await withPool(cluster.url('postgres', 'postgres'), async (pool) => {
    await pool.query(`CREATE ROLE ${quoteIdent(names.adminRole)} LOGIN CREATEROLE NOBYPASSRLS`);
    await pool.query(
      `CREATE ROLE ${quoteIdent(names.runtimeRole)} LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS`,
    );
    await pool.query('CREATE ROLE kovo_system LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS');
    await pool.query(
      `CREATE DATABASE ${quoteIdent(names.database)} OWNER ${quoteIdent(names.adminRole)}`,
    );
  });
}

async function grantRuntimeDataRoles(databaseUrl: string, runtimeRole: string): Promise<void> {
  await withPool(databaseUrl, async (pool) => {
    await pool.query(`GRANT kovo_reader TO ${quoteIdent(runtimeRole)}`);
    await pool.query(`GRANT kovo_writer TO ${quoteIdent(runtimeRole)}`);
    await pool.query(`GRANT SELECT ON TABLE kovo_schema_state TO ${quoteIdent(runtimeRole)}`);
  });
}

async function createUnsafeReachableObjects(databaseUrl: string): Promise<void> {
  await withPool(databaseUrl, async (pool) => {
    await pool.query('DROP MATERIALIZED VIEW IF EXISTS kovo_paranoid_user_mv');
    await pool.query('DROP TABLE IF EXISTS kovo_public_leak');
    await pool.query(
      'CREATE MATERIALIZED VIEW kovo_paranoid_user_mv AS SELECT id, email FROM "user"',
    );
    await pool.query('GRANT SELECT ON kovo_paranoid_user_mv TO kovo_reader');
    await pool.query('CREATE TABLE kovo_public_leak AS SELECT id, email FROM "user" WITH NO DATA');
    await pool.query('GRANT SELECT ON kovo_public_leak TO PUBLIC');
  });
}

async function createUnsafeForeignTable(databaseUrl: string): Promise<boolean> {
  return await withPool(databaseUrl, async (pool) => {
    const available = await pool.query<{ available: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'file_fdw') AS available",
    );
    if (available.rows[0]?.available !== true) return false;

    await pool.query('CREATE EXTENSION IF NOT EXISTS file_fdw');
    await pool.query('DROP FOREIGN TABLE IF EXISTS kovo_foreign_leak');
    await pool.query('DROP SERVER IF EXISTS kovo_file_fdw CASCADE');
    await pool.query('CREATE SERVER kovo_file_fdw FOREIGN DATA WRAPPER file_fdw');
    await pool.query(
      "CREATE FOREIGN TABLE kovo_foreign_leak (id text, secret text) SERVER kovo_file_fdw OPTIONS (filename '/tmp/kovo-missing.csv', format 'csv')",
    );
    await pool.query('GRANT SELECT ON TABLE kovo_foreign_leak TO kovo_reader');
    return true;
  });
}

async function withPool<Result>(
  connectionString: string,
  callback: (pool: PgPool) => Promise<Result>,
): Promise<Result> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
}

interface LocalPostgresCluster {
  port: number;
  stop(): Promise<void>;
  url(database: string, user: string): string;
}

interface PgPool {
  end(): Promise<void>;
  query<Row = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
}

async function startLocalPostgres(root: string): Promise<LocalPostgresCluster> {
  const dataDir = join(root, 'data');
  execFileSync('initdb', ['-D', dataDir, '-A', 'trust', '-U', 'postgres'], {
    stdio: 'ignore',
  });
  const port = await reservePort();
  const process = spawn(
    'postgres',
    ['-D', dataDir, '-h', '127.0.0.1', '-k', '/tmp', '-p', String(port)],
    {
      stdio: 'pipe',
    },
  );
  const stderr: string[] = [];
  process.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')));
  const cluster: LocalPostgresCluster = {
    port,
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
      await withPool(cluster.url('postgres', 'postgres'), async (pool) => {
        await pool.query('SELECT 1');
      });
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

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function onceExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
}

void postgresToolchain;

async function expectWriteStatus(
  origin: string,
  marker: string,
  contactEmail: string,
  output: () => string,
): Promise<void> {
  const writeStatusResponse = await fetch(
    `${origin}/api/phase5-write-boundary-proof?marker=${encodeURIComponent(
      marker,
    )}&contactEmail=${encodeURIComponent(contactEmail)}`,
  );
  const writeStatusBody = await writeStatusResponse.text();
  expect(writeStatusResponse.status, `${writeStatusBody}\n${output()}`).toBe(200);
  const writeStatus = JSON.parse(writeStatusBody) as {
    blockedBuilderSecretRows: number;
    blockedDdlTables: number;
    blockedGovernedMassAssignmentRows: number;
    blockedRawSecretRows: number;
    contactRows: number;
  };

  expect(writeStatus).toEqual({
    blockedBuilderSecretRows: 0,
    blockedDdlTables: 0,
    blockedGovernedMassAssignmentRows: 0,
    blockedRawSecretRows: 0,
    contactRows: 1,
  });
}
