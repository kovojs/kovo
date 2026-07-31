import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { demoPasswordEnvVar, writeKovoProject } from './index.js';
import {
  collectOutput,
  cookieHeader,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  mergeCookies,
  reservePort,
  resolveBin,
  resolveDependencyRoot,
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';
import {
  buildReusableProductionArtifact,
  fieldValue,
  productionArtifactAttestationEnv,
  waitForTcpPort,
} from './index.build.test-support.js';

describe('create-kovo starter (build integration: runtime and dev server)', () => {
  it('keeps generated credentials out of artifacts and refuses insecure production SQLite boot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-prod-demo-seed-'));
    const port = await reservePort();
    let prodServer: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, {
        dialect: 'sqlite',
        disableGit: true,
        name: 'Production Demo Seed Proof',
      });
      linkStarterBuildDependencies(root);
      buildReusableProductionArtifact(root);

      const generatedEnv = readFileSync(join(root, '.env'), 'utf8');
      const generatedCsrfSecret = /^KOVO_CSRF_SECRET=(.+)$/m.exec(generatedEnv)?.[1] ?? '';
      const generatedDemoPassword =
        new RegExp(`^${demoPasswordEnvVar}=(.+)$`, 'm').exec(generatedEnv)?.[1] ?? '';
      const productionArtifactText = readUtf8Tree(join(root, 'dist'));

      expect(generatedCsrfSecret).toBeTruthy();
      expect(generatedDemoPassword).toBeTruthy();
      expect(productionArtifactText).not.toContain(generatedCsrfSecret);
      expect(productionArtifactText).not.toContain(generatedDemoPassword);
      expect(productionArtifactText).not.toContain('/__kovo/client.js');
      expect(productionArtifactText).not.toContain('Kovo Dataflow Devtool');

      prodServer = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          ...productionArtifactAttestationEnv('sqlite-production-refusal'),
          BETTER_AUTH_URL: 'https://app.example.com',
          HOST: '127.0.0.1',
          KOVO_NODE_ORIGIN: 'https://app.example.com',
          NODE_ENV: 'production',
          PORT: String(port),
        },
      });
      const output = collectOutput(prodServer);
      const exit = await waitForChildExit(prodServer, output);

      // SPEC §6.6/§10.3: the experimental single-principal SQLite runtime has no
      // production engine authorization/confidentiality boundary, so it must fail closed
      // before the later volatile replay-store posture is even evaluated.
      expect(exit.code, output()).not.toBe(0);
      expect(output()).toMatch(
        /KV414.*single-principal SQLite starter must not boot in production/,
      );
    } finally {
      await stopProcess(prodServer);
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);

  it('serves production assets and replays anonymous enhanced sign-in by CSRF cookie', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-build-prod-cache-'));
    const port = await reservePort();
    let prodServer: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Build Prod Cache Proof' });
      linkStarterBuildDependencies(root);

      buildReusableProductionArtifact(root);
      const productionArtifactText = readUtf8Tree(join(root, 'dist'));
      expect(productionArtifactText).not.toContain('/__kovo/client.js');
      expect(productionArtifactText).not.toContain('Kovo Dataflow Devtool');

      const origin = `http://127.0.0.1:${port}`;

      prodServer = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          BETTER_AUTH_URL: origin,
          HOST: '127.0.0.1',
          KOVO_NODE_ORIGIN: origin,
          NODE_ENV: 'test',
          PORT: String(port),
        },
      });
      const output = collectOutput(prodServer);
      await waitForTcpPort('127.0.0.1', port, output);

      const loginResponse = await fetch(`${origin}/login`);
      const loginHtml = await loginResponse.text();
      expect(loginResponse.status, `${loginHtml}\n${output()}`).toBe(200);
      const buildToken = loginResponse.headers.get('Kovo-Build');
      expect(buildToken).toBeTruthy();
      const stylesheetHref = /\/assets\/styles\.css/.exec(loginHtml)?.[0] ?? '';

      expect(stylesheetHref).toBe('/assets/styles.css');

      const stylesheetResponse = await fetch(`${origin}${stylesheetHref}`);
      expect(stylesheetResponse.status).toBe(200);
      expect(stylesheetResponse.headers.get('cache-control')).toBe(
        'public, max-age=0, must-revalidate',
      );
      expect(stylesheetResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');
      expect(await stylesheetResponse.text()).toContain('--kovo-theme');

      const devtoolResponse = await fetch(`${origin}/__kovo`);
      const devtoolBody = await devtoolResponse.text();
      expect(devtoolResponse.status, `${devtoolBody}\n${output()}`).toBe(404);
      expect(devtoolBody).not.toContain('Kovo Dataflow Devtool');

      // SPEC §10.3: a pre-auth enhanced mutation has no session principal, so replay must bind
      // to the framework-owned anonymous CSRF cookie instead of the rotating submitted token.
      // Exercise the generated production artifact to prove the real app wiring preserves the
      // first Better Auth Set-Cookie response byte-for-byte rather than creating a second session.
      const jar = new Map<string, string>();
      mergeCookies(jar, loginResponse.headers.getSetCookie());
      const csrf = /name="csrf"\s+value="([^"]+)"/.exec(loginHtml)?.[1];
      expect(csrf).toBeTruthy();
      const demoPassword =
        new RegExp(`^${demoPasswordEnvVar}=(.+)$`, 'm').exec(
          readFileSync(join(root, '.env'), 'utf8'),
        )?.[1] ?? '';
      expect(demoPassword).toBeTruthy();

      const idem = fieldValue(loginHtml, 'Kovo-Idem');
      const body = new URLSearchParams({
        csrf: csrf ?? '',
        email: 'demo@example.com',
        next: '/',
        password: demoPassword,
      }).toString();
      const submitSignIn = (): Promise<Response> =>
        fetch(`${origin}/_m/auth/sign-in`, {
          body,
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            cookie: cookieHeader(jar),
            'Kovo-Build': buildToken!,
            'Kovo-Fragment': 'true',
            'Kovo-Idem': idem,
            origin,
          },
          method: 'POST',
        });

      const firstSignIn = await submitSignIn();
      const firstSignInBody = await firstSignIn.text();
      const duplicateSignIn = await submitSignIn();
      const duplicateSignInBody = await duplicateSignIn.text();

      expect(firstSignIn.status, `${firstSignInBody}\n${output()}`).toBe(200);
      expect(duplicateSignIn.status, `${duplicateSignInBody}\n${output()}`).toBe(200);
      expect(firstSignIn.headers.get('Kovo-Idem')).toBe(idem);
      expect(duplicateSignIn.headers.get('Kovo-Idem')).toBe(idem);
      expect(firstSignIn.headers.getSetCookie().length).toBeGreaterThan(0);
      expect(duplicateSignIn.headers.getSetCookie()).toEqual(firstSignIn.headers.getSetCookie());
      expect(duplicateSignInBody).toBe(firstSignInBody);
    } finally {
      await stopProcess(prodServer);
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);

  it('boots Postgres starter DDL with serial columns, reordered foreign keys, and additive drift', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-pg-ddl-'));

    const runDdlProof = async (probeNickname = false): Promise<void> => {
      writeFileSync(
        join(root, 'ddl-proof.mjs'),
        [
          "import { createServer } from 'vite';",
          '',
          'const vite = await createServer({',
          "  appType: 'custom',",
          '  configFile: false,',
          "  logLevel: 'silent',",
          '  root: process.cwd(),',
          '  server: { hmr: false, middlewareMode: true, watch: null },',
          '  ssr: { noExternal: [/^@kovojs\\//] },',
          '});',
          '',
          'try {',
          '  // SPEC §6.6 rule 6: lock the isolated SSR realm before authored app modules.',
          "  await vite.ssrLoadModule('@kovojs/server/runtime-bootstrap');",
          '  const { appRuntimeDbReady } = await vite.ssrLoadModule(',
          "    '/src/_kovo/app-runtime-db.ts',",
          '  );',
          '  await appRuntimeDbReady;',
          "  process.stdout.write('starter-ddl-proof/v1 OK\\n');",
          '} finally {',
          '  await vite.close();',
          '}',
          '// The generated runtime intentionally exposes no database shutdown authority.',
          '// This isolated one-shot proof exits after Vite closes, as Vitest did previously.',
          'process.exit(0);',
          '',
        ].join('\n'),
        'utf8',
      );
      const stdout = execFileSync(process.execPath, ['ddl-proof.mjs'], {
        cwd: root,
        env: { ...withRepoBinOnPath(), KOVO_DATA_DIR: '.kovo/pglite' },
        encoding: 'utf8',
      });
      expect(stdout).toBe('starter-ddl-proof/v1 OK\n');

      if (probeNickname) {
        const pgliteModule = (await import(
          pathToFileURL(join(resolveDependencyRoot('@electric-sql/pglite'), 'dist/index.js')).href
        )) as {
          PGlite: new (dataDir: string) => {
            close(): Promise<void>;
            query(statement: string): Promise<{ rows: unknown[] }>;
            waitReady: Promise<void>;
          };
        };
        const raw = new pgliteModule.PGlite(join(root, '.kovo/pglite'));
        try {
          await raw.waitReady;
          // SPEC §10.3/KV433: inspect the persisted test database only after the
          // generated runtime exits; app source receives no raw database handle.
          const rows = await raw.query('select nickname from contacts where false');
          expect(rows.rows).toEqual([]);
        } finally {
          await raw.close();
        }
      }
    };

    try {
      writeKovoProject(root, { name: 'Postgres Ddl Proof' });
      linkStarterBuildDependencies(root);

      const schemaPath = join(root, 'src/schema.ts');
      const originalSchema = readFileSync(schemaPath, 'utf8');

      await runDdlProof();

      const schemaWithDrift = originalSchema.replace(
        "    company: text('company').notNull().default(''),",
        "    company: text('company').notNull().default(''),\n    nickname: text('nickname'),",
      );
      writeFileSync(schemaPath, schemaWithDrift, 'utf8');
      await runDdlProof(true);

      const schemaWithSerialAndOwnerFk = originalSchema
        .replace(
          "import { bigint, boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';",
          "import { bigint, boolean, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';",
        )
        .replace(
          "    company: text('company').notNull().default(''),",
          [
            "    company: text('company').notNull().default(''),",
            "    ownerId: text('ownerId').references(() => user.id),",
          ].join('\n'),
        )
        .replace(
          "  id: text('id').primaryKey(),\n  identifier:",
          "  id: serial('id').primaryKey(),\n  identifier:",
        );
      writeFileSync(schemaPath, schemaWithSerialAndOwnerFk, 'utf8');
      rmSync(join(root, '.kovo/pglite'), { force: true, recursive: true });
      await runDdlProof();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);

  it('pins the generated Postgres ESM schema namespace for production consumers', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-schema-namespace-'));

    try {
      writeKovoProject(root, { name: 'Schema Namespace Proof' });
      linkStarterBuildDependencies(root);
      writeFileSync(
        join(root, 'src/schema-namespace-proof.test.ts'),
        [
          "import { describe, expect, it } from 'vitest';",
          "import '@kovojs/server';",
          "import * as schema from './schema.js';",
          '',
          "describe('generated Postgres schema namespace', () => {",
          "  it('normalizes Vite live bindings with boot-pinned intrinsics', async () => {",
          "    const originalFreeze = Object.getOwnPropertyDescriptor(Object, 'freeze');",
          '    let poisonHits = 0;',
          '    try {',
          "      Object.defineProperty(Object, 'freeze', { configurable: true, value(value: object) {",
          '        poisonHits += 1;',
          "        if (Object.prototype.hasOwnProperty.call(value, 'seedSql')) {",
          "          Object.defineProperty(value, 'seedSql', { value: \"COPY (SELECT current_user) TO PROGRAM 'false'\" });",
          '        }',
          '        return value;',
          '      } });',
          "      const { appRuntimeDbOptions } = await import('./_kovo/app-runtime-db-options.js');",
          "      expect(typeof Object.getOwnPropertyDescriptor(schema, 'contacts')?.get).toBe('function');",
          '      expect(Object.isFrozen(appRuntimeDbOptions)).toBe(true);',
          '      expect(Object.isFrozen(appRuntimeDbOptions.schema)).toBe(true);',
          '      expect(Object.getPrototypeOf(appRuntimeDbOptions.schema)).toBe(null);',
          "      expect(appRuntimeDbOptions.seedSql).toBe(\"INSERT INTO contacts (id, name, email, company) VALUES ('c1', 'Ada Lovelace', 'ada@example.com', 'Analytical Engines'), ('c2', 'Grace Hopper', 'grace@example.com', 'Naval Systems'), ('c3', 'Alan Turing', 'alan@example.com', 'Bletchley Park') ON CONFLICT (id) DO NOTHING;\");",
          "      expect(Object.getOwnPropertyDescriptor(appRuntimeDbOptions.schema, 'contacts')).toMatchObject({ value: schema.contacts });",
          "      expect(Object.getOwnPropertyDescriptor(appRuntimeDbOptions.schema, 'authSchema')).toMatchObject({ value: schema.authSchema });",
          '    } finally {',
          "      if (originalFreeze) Object.defineProperty(Object, 'freeze', originalFreeze);",
          '    }',
          '    expect(poisonHits).toBe(0);',
          '  });',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(root, 'vitest.schema-namespace.config.ts'),
        "export default { test: { environment: 'node' } };\n",
        'utf8',
      );

      execFileSync(
        resolveBin('vitest'),
        [
          '--config',
          'vitest.schema-namespace.config.ts',
          '--run',
          'src/schema-namespace-proof.test.ts',
        ],
        {
          cwd: root,
          env: withRepoBinOnPath(),
          stdio: 'pipe',
        },
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('serves the generated app through kovo dev (redirect + login + styles)', async () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-dev-'));
    const port = await reservePort();
    let devServer: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Dev Proof' });
      linkStarterBuildDependencies(root);
      const origin = `http://127.0.0.1:${port}`;
      const devEnvironment = withRepoBinOnPath();
      delete devEnvironment.BETTER_AUTH_URL;

      devServer = spawn(
        join(root, 'node_modules/.bin/kovo'),
        ['dev', './src/app.tsx', '--host', '127.0.0.1', '--port', String(port), '--strict-port'],
        {
          cwd: root,
          detached: process.platform !== 'win32',
          env: devEnvironment,
        },
      );
      const output = collectOutput(devServer);

      const login = await fetchTextWhenReady(`${origin}/login`, output);
      expect(login).toContain('Sign in');
      // The themed stylesheet pipeline ran: critical theme vars are inlined.
      expect(login).toContain('--kovo-theme');
      // World-class DevEx G10: dev must deliver app-shell and public UI component CSS,
      // not merely emit matching class attributes that render with browser defaults.
      expect(login).toMatch(/\.kv-style-[^{]+\{/);
      expect(login).toMatch(/\.kv-button-[^{]+\{/);

      const home = await fetch(`${origin}/`, { redirect: 'manual' });
      expect([302, 303, 307]).toContain(home.status);
      // The `/` route's KV436 access guard (SPEC §10.2) redirects an unauthenticated
      // visitor to the login route, carrying `next` so sign-in returns them home.
      expect(home.headers.get('location')).toBe('/login?next=%2F');

      // Full real-auth round trip: the seeded demo account signs in (CSRF token +
      // Better Auth over PGlite), and the guarded home page then renders the
      // contact list and add-contact form.
      const jar = new Map<string, string>();
      const loginResponse = await fetch(`${origin}/login`);
      mergeCookies(jar, loginResponse.headers.getSetCookie());
      const loginHtml = await loginResponse.text();
      const csrf = fieldValue(loginHtml, 'csrf');
      expect(csrf).toBeTruthy();
      const demoPassword =
        new RegExp(`^${demoPasswordEnvVar}=(.+)$`, 'm').exec(
          readFileSync(join(root, '.env'), 'utf8'),
        )?.[1] ?? '';
      expect(demoPassword).toBeTruthy();

      const form = new URLSearchParams({
        'Kovo-Idem': fieldValue(loginHtml, 'Kovo-Idem'),
        email: 'demo@example.com',
        password: demoPassword,
        next: '/',
        csrf: csrf ?? '',
      });
      const signIn = await fetch(`${origin}/_m/auth/sign-in`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: cookieHeader(jar),
          origin,
        },
        body: form.toString(),
        redirect: 'manual',
      });
      mergeCookies(jar, signIn.headers.getSetCookie());
      expect(signIn.status).toBe(303);

      const authedHome = await fetch(`${origin}/`, {
        headers: { cookie: cookieHeader(jar) },
        redirect: 'manual',
      });
      const authedHtml = await authedHome.text();
      expect(authedHome.status, `${authedHtml}\n${output()}`).toBe(200);
      expect(authedHtml).toContain('Demo User');
      expect(authedHtml).toContain('Contacts');
      expect(authedHtml).toContain('Ada Lovelace');
      expect(authedHtml).toContain('Add contact');
      expect(authedHtml).toMatch(/\.kv-card-[^{]+\{/);
    } finally {
      await stopProcess(devServer);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('honors HOST and PORT from the generated starter Vite config', async () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-dev-env-'));
    const port = await reservePort();
    let devServer: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Dev Env Proof' });
      linkStarterBuildDependencies(root);

      devServer = spawn(join(root, 'node_modules/.bin/kovo'), ['dev', './src/app.tsx'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          PORT: String(port),
        },
      });
      const output = collectOutput(devServer);
      await waitForTcpPort('127.0.0.1', port, output);
    } finally {
      await stopProcess(devServer);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});

function readUtf8Tree(root: string): string {
  const chunks: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) chunks.push(readUtf8Tree(path));
    else if (entry.isFile()) chunks.push(readFileSync(path, 'utf8'));
  }
  return chunks.join('\n');
}

async function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  output: () => string,
  timeoutMs = 15_000,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      reject(new Error(`Timed out waiting for production artifact to exit.\n${output()}`));
    }, timeoutMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };
    child.once('exit', onExit);
  });
}
