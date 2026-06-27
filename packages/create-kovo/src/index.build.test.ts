import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
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

describe('create-kovo starter (build integration)', () => {
  it('typechecks the generated app with starter dependencies', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-tsc-'));

    try {
      writeKovoProject(root, { name: 'Tsc Proof' });
      linkStarterBuildDependencies(root);

      execFileSync(
        resolveBin('tsc'),
        [
          '--ignoreConfig',
          '--noEmit',
          '--jsx',
          'react-jsx',
          '--jsxImportSource',
          '@kovojs/server',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          '--target',
          'ES2024',
          '--strict',
          '--skipLibCheck',
          '--exactOptionalPropertyTypes',
          '--noUncheckedIndexedAccess',
          '--types',
          'node',
          'src/schema.ts',
          'src/db.ts',
          'src/auth.ts',
          'src/queries.ts',
          'src/mutations.ts',
          'src/components/contacts.tsx',
          'src/components/auth-forms.tsx',
          'src/app.tsx',
        ],
        { cwd: root, stdio: 'pipe' },
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('typechecks the generated SQLite app variant', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-sqlite-tsc-'));

    try {
      writeKovoProject(root, { dialect: 'sqlite', name: 'Sqlite Tsc Proof' });
      linkStarterBuildDependencies(root);

      execFileSync(
        resolveBin('tsc'),
        [
          '--ignoreConfig',
          '--noEmit',
          '--jsx',
          'react-jsx',
          '--jsxImportSource',
          '@kovojs/server',
          '--module',
          'NodeNext',
          '--moduleResolution',
          'NodeNext',
          '--target',
          'ES2024',
          '--strict',
          '--skipLibCheck',
          '--exactOptionalPropertyTypes',
          '--noUncheckedIndexedAccess',
          '--types',
          'node',
          'src/schema.ts',
          'src/db.ts',
          'src/auth.ts',
          'src/queries.ts',
          'src/mutations.ts',
          'src/components/contacts.tsx',
          'src/components/auth-forms.tsx',
          'src/app.tsx',
        ],
        { cwd: root, stdio: 'pipe' },
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('runs vp check in the generated SQLite app', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-sqlite-check-'));

    try {
      writeKovoProject(root, { dialect: 'sqlite', name: 'Sqlite Check Proof' });
      execFileSync(process.execPath, ['scripts/link-local-kovo.mjs', root, process.cwd()], {
        cwd: process.cwd(),
        stdio: 'pipe',
      });
      execFileSync('pnpm', ['install', '--ignore-workspace'], {
        cwd: root,
        stdio: 'pipe',
      });

      execFileSync(resolveBin('vp'), ['check'], {
        cwd: root,
        stdio: 'pipe',
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 90_000);

  it('runs the generated in-app tests (data layer + request shell)', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-vitest-'));

    try {
      writeKovoProject(root, { name: 'Vitest Proof' });
      linkStarterBuildDependencies(root);

      execFileSync(resolveBin('vitest'), ['--run', 'src/app.test.ts'], {
        cwd: root,
        stdio: 'pipe',
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 90_000);

  it('runs the generated production build graph gate', () => {
    const tempParent = join(process.cwd(), 'node_modules/.tmp');
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-build-prod-'));

    try {
      writeKovoProject(root, { name: 'Build Prod Proof' });
      linkStarterBuildDependencies(root);

      execFileSync('pnpm', ['run', 'build:prod'], {
        cwd: root,
        env: withRepoBinOnPath(),
        stdio: 'pipe',
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

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
      await waitForTcpPort('127.0.0.1', port);
    } finally {
      await stopProcess(devServer);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});

async function waitForTcpPort(host: string, port: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection({ host, port });
        socket.once('connect', () => {
          socket.end();
          resolve();
        });
        socket.once('error', reject);
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const cause = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Timed out waiting for ${host}:${port} to accept TCP connections: ${cause}`);
}
