import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';
import { buildReusableProductionArtifact, waitForTcpPort } from './index.build.test-support.js';

describe('create-kovo starter (build integration: runtime and dev server)', () => {
  it('does not seed the generated local demo credential when a production artifact boots', async () => {
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

      prodServer = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          NODE_ENV: 'production',
          PORT: String(port),
        },
      });
      const output = collectOutput(prodServer);
      await waitForTcpPort('127.0.0.1', port, output);

      const origin = `http://127.0.0.1:${port}`;
      const jar = new Map<string, string>();
      const login = await fetch(`${origin}/login`);
      mergeCookies(jar, login.headers.getSetCookie());
      const loginHtml = await login.text();
      const csrf = /name="csrf"\s+value="([^"]+)"/.exec(loginHtml)?.[1] ?? '';
      const loginCookies = login.headers.getSetCookie().join('\n');

      expect(login.status, `${loginHtml}\n${output()}`).toBe(200);
      expect(csrf).toBeTruthy();
      // SPEC §6.6/§9.1.1: a production anonymous credential response must be
      // uncacheable and the browser binding must carry every session-cookie floor.
      expect(login.headers.get('cache-control')).toBe('private, no-store');
      expect(login.headers.get('vary')?.split(',').map((value) => value.trim())).toContain('Cookie');
      expect(loginCookies).toContain('__Host-kovo_csrf=');
      expect(loginCookies).toContain('Path=/');
      expect(loginCookies).toContain('HttpOnly');
      expect(loginCookies).toContain('Secure');
      expect(loginCookies).toContain('SameSite=Lax');

      const signIn = await fetch(`${origin}/_m/auth/sign-in`, {
        body: new URLSearchParams({
          csrf,
          email: 'demo@example.com',
          next: '/',
          password: generatedDemoPassword,
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
      const signInBody = await signIn.text();

      // SPEC §2/§6.6: a generated development credential must not become a production
      // authentication path merely because the deployment copied the gitignored .env file.
      expect(signIn.status, `${signInBody}\n${output()}`).toBe(422);
      expect(signIn.headers.getSetCookie().join('\n')).not.toContain('better-auth.session_token');

      const home = await fetch(`${origin}/`, {
        headers: { cookie: cookieHeader(jar) },
        redirect: 'manual',
      });
      expect(home.status).toBe(303);
      expect(home.headers.get('location')).toBe('/login?next=%2F');
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

      prodServer = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          NODE_ENV: 'test',
          PORT: String(port),
        },
      });
      const output = collectOutput(prodServer);
      await waitForTcpPort('127.0.0.1', port, output);

      const origin = `http://127.0.0.1:${port}`;
      const loginResponse = await fetch(`${origin}/login`);
      const loginHtml = await loginResponse.text();
      expect(loginResponse.status, `${loginHtml}\n${output()}`).toBe(200);
      const stylesheetHref = /\/assets\/styles\.css/.exec(loginHtml)?.[0] ?? '';

      expect(stylesheetHref).toBe('/assets/styles.css');

      const stylesheetResponse = await fetch(`${origin}${stylesheetHref}`);
      expect(stylesheetResponse.status).toBe(200);
      expect(stylesheetResponse.headers.get('cache-control')).toBe(
        'public, max-age=0, must-revalidate',
      );
      expect(stylesheetResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');
      expect(await stylesheetResponse.text()).toContain('--kovo-theme');

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

      const idem = `anonymous-sign-in-${Date.now()}`;
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

      expect(firstSignIn.status).toBe(200);
      expect(duplicateSignIn.status).toBe(200);
      expect(firstSignIn.headers.get('Kovo-Idem')).toBe(idem);
      expect(duplicateSignIn.headers.get('Kovo-Idem')).toBe(idem);
      expect(firstSignIn.headers.getSetCookie().length).toBeGreaterThan(0);
      expect(duplicateSignIn.headers.getSetCookie()).toEqual(firstSignIn.headers.getSetCookie());
      expect(duplicateSignInBody).toBe(firstSignInBody);
    } finally {
      await stopProcess(prodServer);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('boots Postgres starter DDL with serial columns, reordered foreign keys, and additive drift', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-pg-ddl-'));

    const runDdlProof = (query = ''): void => {
      writeFileSync(
        join(root, 'src/ddl-proof.test.ts'),
        [
          "import { describe, expect, it } from 'vitest';",
          "import { sql } from 'drizzle-orm';",
          "import { appRuntimeDbProvider, appRuntimeDbReady } from './_kovo/app-runtime-db.js';",
          '',
          "describe('starter DDL proof', () => {",
          "  it('boots and exposes the expected schema', async () => {",
          '    await appRuntimeDbReady;',
          query === ''
            ? '    expect(true).toBe(true);'
            : `    await appRuntimeDbProvider({ session: { user: { id: 'ddl-proof' } } }).execute(sql\`${query}\`);`,
          '  });',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );
      execFileSync(resolveBin('vitest'), ['--run', 'src/ddl-proof.test.ts'], {
        cwd: root,
        env: { ...withRepoBinOnPath(), KOVO_DATA_DIR: '.kovo/pglite' },
        stdio: 'pipe',
      });
    };

    try {
      writeKovoProject(root, { name: 'Postgres Ddl Proof' });
      linkStarterBuildDependencies(root);

      const schemaPath = join(root, 'src/schema.ts');
      const originalSchema = readFileSync(schemaPath, 'utf8');

      runDdlProof();

      const schemaWithDrift = originalSchema.replace(
        "    company: text('company').notNull().default(''),",
        "    company: text('company').notNull().default(''),\n    nickname: text('nickname'),",
      );
      writeFileSync(schemaPath, schemaWithDrift, 'utf8');
      runDdlProof('select nickname from contacts limit 1');

      const schemaWithSerialAndOwnerFk = originalSchema
        .replace(
          "import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';",
          "import { boolean, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';",
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
      runDdlProof();
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
          "import { appRuntimeDbOptions } from './_kovo/app-runtime-db.js';",
          "import * as schema from './schema.js';",
          '',
          "describe('generated Postgres schema namespace', () => {",
          "  it('normalizes Vite live bindings into one immutable own-data snapshot', () => {",
          "    expect(typeof Object.getOwnPropertyDescriptor(schema, 'contacts')?.get).toBe('function');",
          '    expect(Object.isFrozen(appRuntimeDbOptions.schema)).toBe(true);',
          '    expect(Object.getPrototypeOf(appRuntimeDbOptions.schema)).toBe(null);',
          "    expect(Object.getOwnPropertyDescriptor(appRuntimeDbOptions.schema, 'contacts')).toMatchObject({ value: schema.contacts });",
          "    expect(Object.getOwnPropertyDescriptor(appRuntimeDbOptions.schema, 'authSchema')).toMatchObject({ value: schema.authSchema });",
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

      devServer = spawn(
        join(root, 'node_modules/.bin/kovo'),
        ['dev', './src/app.tsx', '--host', '127.0.0.1', '--port', String(port), '--strict-port'],
        { cwd: root, detached: process.platform !== 'win32', env: withRepoBinOnPath() },
      );
      const output = collectOutput(devServer);
      const origin = `http://127.0.0.1:${port}`;

      const login = await fetchTextWhenReady(`${origin}/login`, output);
      expect(login).toContain('Sign in');
      // The themed stylesheet pipeline ran: critical theme vars are inlined.
      expect(login).toContain('--kovo-theme');

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
      const csrf = /name="csrf"\s+value="([^"]+)"/.exec(await loginResponse.text())?.[1];
      expect(csrf).toBeTruthy();
      const demoPassword =
        new RegExp(`^${demoPasswordEnvVar}=(.+)$`, 'm').exec(
          readFileSync(join(root, '.env'), 'utf8'),
        )?.[1] ?? '';
      expect(demoPassword).toBeTruthy();

      const form = new URLSearchParams({
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
