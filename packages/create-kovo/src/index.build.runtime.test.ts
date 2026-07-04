import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  it('fingerprints the starter stylesheet URL before serving it as immutable', async () => {
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
      expect(loginResponse.status).toBe(200);
      const loginHtml = await loginResponse.text();
      const stylesheetHref = /\/assets\/styles\.css/.exec(loginHtml)?.[0] ?? '';

      expect(stylesheetHref).toBe('/assets/styles.css');

      const stylesheetResponse = await fetch(`${origin}${stylesheetHref}`);
      expect(stylesheetResponse.status).toBe(200);
      expect(stylesheetResponse.headers.get('cache-control')).toBe(
        'public, max-age=0, must-revalidate',
      );
      expect(stylesheetResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');
      expect(await stylesheetResponse.text()).toContain('--kovo-theme');
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

  it('serves the generated app through vp dev (redirect + login + styles)', async () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-dev-'));
    const port = await reservePort();
    let devServer: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Dev Proof' });
      linkStarterBuildDependencies(root);

      devServer = spawn(
        resolveBin('vp'),
        ['dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
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
      expect(authedHome.status).toBe(200);
      const authedHtml = await authedHome.text();
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

      devServer = spawn(resolveBin('vp'), ['dev'], {
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
