import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { hashPassword as kovoHashPassword } from '@kovojs/server';
import { afterAll, describe, expect, it } from 'vitest';

import { demoPasswordEnvVar, writeKovoProject } from './index.js';
import {
  collectOutput,
  cookieHeader,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  mergeCookies,
  reservePort,
  resolveDependencyRoot,
  resolveStarterBin,
  stopProcess,
  withRepoBinOnPath,
  withStarterBinOnPath,
} from './index.test-support.js';
import {
  buildReusableProductionArtifact,
  fieldValue,
  formHtmlByAction,
} from './index.build.test-support.js';

const POSTGRES_BINARIES = ['initdb', 'postgres'] as const;
const postgresToolchain = localPostgresToolchain();
const describeIfPostgres = postgresToolchain.available ? describe : describe.skip;
const runId = `kovo_ck_ext_${process.pid}_${Date.now()}`.replace(/[^A-Za-z0-9_]/g, '_');
const require = createRequire(import.meta.url);
const { Pool } = require(resolveDependencyRoot('pg')) as {
  Pool: new (options: { connectionString: string; max: number }) => PgPool;
};

describe('create-kovo starter (build integration: production Postgres driver floor)', () => {
  it('refuses a production artifact that resolves to in-process PGlite', async () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-prod-pglite-refusal-'));
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { dialect: 'postgres', name: 'Production PGlite Refusal Proof' });
      linkStarterBuildDependencies(root);
      buildReusableProductionArtifact(root);

      const env = {
        ...withRepoBinOnPath(),
        HOST: '127.0.0.1',
        NODE_ENV: 'production',
        PORT: String(await reservePort()),
      };
      delete env.KOVO_DATABASE_URL;
      delete env.KOVO_DB_ADMIN_URL;
      delete env.KOVO_DB_SYSTEM_URL;
      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env,
      });
      const output = collectOutput(server);

      await onceExit(server, 15_000);

      expect(server.exitCode).not.toBe(0);
      expect(output()).toContain(
        'KV433: production requires a least-privilege external Postgres via KOVO_DATABASE_URL; ' +
          'PGlite is dev/test-only and runs in-process as superuser (SPEC §10.3).',
      );
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 300_000);
});

describeIfPostgres(
  'create-kovo starter (build integration: external Postgres production artifact)',
  () => {
    const roots: string[] = [];
    const clusters: LocalPostgresCluster[] = [];

    afterAll(async () => {
      await Promise.allSettled(clusters.splice(0).map((cluster) => cluster.stop()));
      for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
    });

    it('deploys the generated Postgres starter against admin-provisioned external Postgres with a least-privilege runtime URL', async () => {
      const tempParent = tmpdir();
      mkdirSync(tempParent, { recursive: true });
      const root = mkdtempSync(join(tempParent, 'create-kovo-prod-external-postgres-'));
      const clusterRoot = mkdtempSync(join(tempParent, 'create-kovo-postgres-cluster-'));
      roots.push(root, clusterRoot);
      const cluster = await startLocalPostgres(clusterRoot);
      clusters.push(cluster);
      const port = await reservePort();
      let server: ChildProcessWithoutNullStreams | undefined;

      const database = `${runId}_app`;
      const adminRole = `${runId}_admin`;
      const runtimeRole = `${runId}_runtime`;

      try {
        writeKovoProject(root, { dialect: 'postgres', name: 'External Postgres Proof' });
        linkStarterBuildDependencies(root);
        writeProductionEquivalentSchemaModule(root);
        writeStarterPostgresMigration(root);
        allowExternalPostgresEgress(root, cluster.port);
        buildReusableProductionArtifact(root);

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
        await grantRuntimeDataRoles(cluster.url(database, 'postgres'), runtimeRole);
        const runtimeCheckOutput = execKovo(root, [
          'db',
          'check',
          '--schema',
          '.kovo/external-postgres-schema.mjs',
          '--database-url',
          runtimeUrl,
        ]);
        expect(runtimeCheckOutput).toContain('STATUS ok');
        await seedDemoUser(cluster.url(database, 'postgres'), demoPassword(root));
        await expectPermissionDenied(runtimeUrl, `CREATE ROLE ${quoteIdent(`${runId}_blocked`)}`);
        await expectPermissionDenied(runtimeUrl, 'ALTER TABLE contacts FORCE ROW LEVEL SECURITY');

        server = spawn(process.execPath, ['dist/server/server.mjs'], {
          cwd: root,
          detached: process.platform !== 'win32',
          env: {
            ...withRepoBinOnPath(),
            BETTER_AUTH_URL: `https://127.0.0.1:${port}`,
            HOST: '127.0.0.1',
            KOVO_DATABASE_URL: runtimeUrl,
            KOVO_DB_SYSTEM_URL: systemUrl,
            NODE_ENV: 'production',
            PORT: String(port),
          },
        });
        const output = collectOutput(server);
        const origin = `http://127.0.0.1:${port}`;
        const jar = new Map<string, string>();

        await signInDemoUserWithDiagnostics(root, origin, jar, output);
        const homeResponse = await fetchTextWhenReady(`${origin}/`, output, {
          headers: { cookie: cookieHeader(jar) },
        });
        expect(homeResponse).toContain('Demo User');
        expect(homeResponse).toContain('3 contacts');
        expect(homeResponse).toContain('Ada Lovelace');

        const addForm = formHtmlByAction(homeResponse, '/_m/mutations/add-contact');
        const email = `external-${Date.now()}@example.com`;
        const addContact = await fetch(`${origin}/_m/mutations/add-contact`, {
          body: new URLSearchParams({
            company: 'External Postgres',
            csrf: fieldValue(addForm, 'csrf'),
            email,
            'Kovo-Idem': fieldValue(addForm, 'Kovo-Idem'),
            name: 'External Pat',
          }),
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            cookie: cookieHeader(jar),
            origin,
          },
          method: 'POST',
          redirect: 'manual',
        });
        mergeCookies(jar, addContact.headers.getSetCookie());
        const addContactBody = await addContact.text();
        if (addContact.status !== 303) {
          throw new Error(
            `Expected add-contact redirect, got ${addContact.status}:\n${addContactBody}\n${output()}`,
          );
        }

        const updatedHome = await fetch(`${origin}/`, {
          headers: { cookie: cookieHeader(jar) },
        });
        const updatedHtml = await updatedHome.text();
        expect(updatedHtml).toContain('External Pat');
        expect(updatedHtml).toContain(email);
        expect(updatedHtml).toContain('4 contacts');

        await withPool(runtimeUrl, async (pool) => {
          const contacts = await pool.query<{ email: string; name: string }>(
            'SELECT email, name FROM contacts WHERE email = $1',
            [email],
          );
          expect(contacts.rows).toEqual([{ email, name: 'External Pat' }]);
        });
      } finally {
        await stopProcess(server);
      }
    }, 180_000);
  },
);

async function signInDemoUserWithDiagnostics(
  root: string,
  origin: string,
  jar: Map<string, string>,
  output: () => string,
): Promise<void> {
  await fetchTextWhenReady(`${origin}/login`, output);
  const loginResponse = await fetch(`${origin}/login`);
  mergeCookies(jar, loginResponse.headers.getSetCookie());
  const loginHtml = await loginResponse.text();
  const loginCsrf = fieldValue(loginHtml, 'csrf');
  const loginIdem = fieldValue(loginHtml, 'Kovo-Idem');
  const demoPassword =
    new RegExp(`^${demoPasswordEnvVar}=(.+)$`, 'm').exec(
      readFileSync(join(root, '.env'), 'utf8'),
    )?.[1] ?? '';
  expect(loginCsrf).toBeTruthy();
  expect(demoPassword).toBeTruthy();

  const signIn = await fetch(`${origin}/_m/auth/sign-in`, {
    body: new URLSearchParams({
      csrf: loginCsrf,
      email: 'demo@example.com',
      'Kovo-Idem': loginIdem,
      next: '/',
      password: demoPassword,
    }),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(jar),
      origin,
    },
    method: 'POST',
    redirect: 'manual',
  });
  mergeCookies(jar, signIn.headers.getSetCookie());
  const body = await signIn.text();
  if (signIn.status !== 303) {
    throw new Error(`Expected demo sign-in redirect, got ${signIn.status}:\n${body}\n${output()}`);
  }
}

function demoPassword(root: string): string {
  const password =
    new RegExp(`^${demoPasswordEnvVar}=(.+)$`, 'm').exec(
      readFileSync(join(root, '.env'), 'utf8'),
    )?.[1] ?? '';
  if (!password) throw new Error(`Expected ${demoPasswordEnvVar} in generated .env.`);
  return password;
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

function allowExternalPostgresEgress(root: string, postgresPort: number): void {
  const postgresDestinationLiteral = JSON.stringify(`127.0.0.1:${postgresPort}`);
  const appPath = join(root, 'src/app.tsx');
  const source = readFileSync(appPath, 'utf8').replace(
    '  db: appRuntimeDbProvider,\n',
    [
      '  db: appRuntimeDbProvider,',
      '  egress: {',
      `    allowInternal: [${postgresDestinationLiteral}],`,
      '  },',
    ].join('\n') + '\n',
  );
  writeFileSync(appPath, source, 'utf8');
}

function writeProductionEquivalentSchemaModule(root: string): void {
  mkdirSync(join(root, '.kovo'), { recursive: true });
  writeFileSync(
    join(root, '.kovo/external-postgres-schema.mjs'),
    [
      "import { kovo } from '@kovojs/drizzle';",
      "import { sql } from 'drizzle-orm';",
      "import { bigint, boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';",
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
      "}, kovo({ domain: 'auth', key: 'userId', owner: 'userId', secret: ['token'] }));",
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
      "}, kovo({ domain: 'auth', key: 'userId', owner: 'userId', secret: ['password', 'accessToken', 'refreshToken', 'idToken'] }));",
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
      "export const rateLimit = pgTable('rateLimit', {",
      "  id: text('id').primaryKey(),",
      "  key: text('key').notNull().unique(),",
      "  count: integer('count').notNull(),",
      "  lastRequest: bigint('lastRequest', { mode: 'number' }).notNull(),",
      "}, kovo({ authzPolicy: sql`false`, domain: 'auth-rate-limit', key: 'id', secret: true }));",
      '',
      'export const authSchema = { user, session, account, verification, rateLimit };',
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
      'CREATE TABLE "rateLimit" (',
      '  id text PRIMARY KEY,',
      '  key text NOT NULL UNIQUE,',
      '  count integer NOT NULL,',
      '  "lastRequest" bigint NOT NULL',
      ');',
      '',
    ].join('\n'),
    'utf8',
  );
}

async function seedDemoUser(databaseUrl: string, password: string): Promise<void> {
  const userId = 'demo-user';
  const accountId = 'demo-account';
  const passwordHash = await betterAuthPasswordHash(password);
  await withPool(databaseUrl, async (pool) => {
    await pool.query(
      [
        'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")',
        "VALUES ($1, 'Demo User', 'demo@example.com', false, now(), now())",
        'ON CONFLICT (id) DO NOTHING',
      ].join(' '),
      [userId],
    );
    await pool.query(
      [
        'INSERT INTO account',
        '(id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")',
        "VALUES ($1, $2, 'credential', $3, $4, now(), now())",
        'ON CONFLICT (id) DO UPDATE SET password = excluded.password, "updatedAt" = now()',
      ].join(' '),
      [accountId, userId, userId, passwordHash],
    );
    await pool.query(
      [
        'INSERT INTO contacts (id, name, email, company) VALUES',
        "('c1', 'Ada Lovelace', 'ada@example.com', 'Analytical Engines'),",
        "('c2', 'Grace Hopper', 'grace@example.com', 'Naval Systems'),",
        "('c3', 'Alan Turing', 'alan@example.com', 'Bletchley Park')",
        'ON CONFLICT (id) DO NOTHING',
      ].join(' '),
    );
  });
}

async function betterAuthPasswordHash(password: string): Promise<string> {
  return kovoHashPassword(password);
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

async function expectPermissionDenied(databaseUrl: string, statement: string): Promise<void> {
  await withPool(databaseUrl, async (pool) => {
    await expect(pool.query(statement)).rejects.toMatchObject({
      code: expect.stringMatching(/^(42501|0LP01)$/),
    });
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

async function onceExit(child: ChildProcessWithoutNullStreams, timeoutMs?: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    let timeout: NodeJS.Timeout | undefined;
    const onExit = (): void => {
      if (timeout !== undefined) clearTimeout(timeout);
      resolve();
    };
    child.once('exit', onExit);
    if (timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        child.off('exit', onExit);
        reject(new Error(`Timed out waiting ${timeoutMs}ms for child process to exit.`));
      }, timeoutMs);
    }
  });
}

void postgresToolchain;
