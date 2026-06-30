import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
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
        stdio: 'inherit',
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
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-build-prod-'));

    try {
      writeKovoProject(root, { name: 'Build Prod Proof' });
      linkStarterBuildDependencies(root);

      buildProductionArtifact(root);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('rebuilds production artifacts from current source when cache is warm', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-build-source-proof-'));

    try {
      writeKovoProject(root, { name: 'Build Source Proof' });
      linkStarterBuildDependencies(root);

      buildProductionArtifact(root);
      const firstHandler = readFileSync(join(root, 'dist/server/server/handler.mjs'), 'utf8');
      expect(firstHandler).toContain('Contacts');

      const contactsPath = join(root, 'src/components/contacts.tsx');
      writeFileSync(
        contactsPath,
        readFileSync(contactsPath, 'utf8').replace('Contacts</h1>', 'Current Source Contacts</h1>'),
        'utf8',
      );

      buildProductionArtifact(root);
      const secondHandler = readFileSync(join(root, 'dist/server/server/handler.mjs'), 'utf8');
      expect(secondHandler).toContain('Current Source Contacts');
      expect(secondHandler).not.toBe(firstHandler);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('serves non-empty enhanced add-contact truth from the production build artifact', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-add-contact-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod Add Contact Proof' });
      linkStarterBuildDependencies(root);

      buildProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          NODE_ENV: 'production',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;
      const jar = new Map<string, string>();

      await fetchTextWhenReady(`${origin}/login`, output);
      const loginResponse = await fetch(`${origin}/login`);
      mergeCookies(jar, loginResponse.headers.getSetCookie());
      const loginHtml = await loginResponse.text();
      expect(loginHtml).toContain('Sign in');
      const loginCsrf = fieldValue(loginHtml, 'csrf');
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
      expect(signIn.status).toBe(303);

      const homeResponse = await fetchTextWhenReady(`${origin}/`, output, {
        headers: { cookie: cookieHeader(jar) },
      });
      expect(homeResponse).toContain('3 contacts');
      const addForm = formHtmlByAction(homeResponse, '/_m/mutations/add-contact');
      const contactRegion = elementOpeningTagByAttribute(
        homeResponse,
        'kovo-fragment-target',
        'contacts-region',
      );
      const target = attributeValue(contactRegion, 'kovo-fragment-target');
      const deps = attributeValue(contactRegion, 'kovo-deps');
      const component = attributeValue(contactRegion, 'kovo-live-component');
      const liveToken = attributeValue(contactRegion, 'kovo-live-token');
      const props = attributeValue(contactRegion, 'kovo-props') ?? '{}';
      expect(target).toBe('contacts-region');
      expect(deps).toBeTruthy();
      expect(component).toBe('components/contacts/contacts-region');
      expect(liveToken).toBeTruthy();

      const email = `grace-${Date.now()}@example.com`;
      const idem = fieldValue(addForm, 'Kovo-Idem');
      const addContactRequest = (): Promise<Response> =>
        fetch(`${origin}/_m/mutations/add-contact`, {
          body: new URLSearchParams({
            company: 'Navy',
            csrf: fieldValue(addForm, 'csrf'),
            email,
            'Kovo-Idem': idem,
            name: 'Grace Hopper',
          }),
          headers: {
            accept: 'text/vnd.kovo.fragment+html',
            'content-type': 'application/x-www-form-urlencoded',
            cookie: cookieHeader(jar),
            'Kovo-Form-Target': target,
            'Kovo-Fragment': 'true',
            'Kovo-Idem': idem,
            'Kovo-Live-Targets': `${target}#${component}@${liveToken}:${props}`,
            'Kovo-Targets': `${target}=${deps}`,
            origin,
          },
          method: 'POST',
        });
      const [firstAddContact, duplicateAddContact] = await Promise.all([
        addContactRequest(),
        addContactRequest(),
      ]);
      const [firstBody, duplicateBody] = await Promise.all([
        firstAddContact.text(),
        duplicateAddContact.text(),
      ]);

      for (const response of [firstAddContact, duplicateAddContact]) {
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/vnd.kovo.fragment+html');
        expect(response.headers.get('kovo-changes')).toBe('[{"domain":"model/contact"}]');
      }
      expect(duplicateBody).toBe(firstBody);
      expect(firstBody).toContain('<kovo-query');
      expect(firstBody).toContain('<kovo-fragment target="contacts-region"');
      expect(firstBody).toContain('Grace Hopper');
      expect(firstBody).toContain(email);
      expect(firstBody).toContain('4 contacts');

      const updatedHome = await fetch(`${origin}/`, {
        headers: { cookie: cookieHeader(jar) },
      });
      const updatedHtml = await updatedHome.text();
      expect(updatedHtml).toContain('Grace Hopper');
      expect(updatedHtml).toContain('4 contacts');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('rejects no-JS add-contact idempotency token collisions from the production artifact', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-nojs-idem-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod NoJS Idem Proof' });
      linkStarterBuildDependencies(root);

      buildProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          NODE_ENV: 'production',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;
      const jar = new Map<string, string>();

      await signInDemoUser(root, origin, jar, output);
      const homeResponse = await fetch(`${origin}/`, {
        headers: { cookie: cookieHeader(jar) },
      });
      const homeHtml = await homeResponse.text();
      const addForm = formHtmlByAction(homeHtml, '/_m/mutations/add-contact');
      const csrf = fieldValue(addForm, 'csrf');
      const idem = fieldValue(addForm, 'Kovo-Idem');
      expect(csrf).toBeTruthy();
      expect(idem).toBeTruthy();

      const submitNoJs = (name: string, email: string): Promise<Response> =>
        fetch(`${origin}/_m/mutations/add-contact`, {
          body: new URLSearchParams({
            company: 'Integrity Lab',
            csrf,
            email,
            'Kovo-Idem': idem,
            name,
          }),
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            cookie: cookieHeader(jar),
            origin,
          },
          method: 'POST',
          redirect: 'manual',
        });

      const first = await submitNoJs('First Idem Contact', 'first-idem@example.com');
      const second = await submitNoJs('Second Idem Contact', 'second-idem@example.com');
      const secondBody = await second.text();

      expect(first.status).toBe(303);
      expect(second.status).toBe(422);
      expect(secondBody).toContain('data-error-code="IDEMPOTENCY_CONFLICT"');

      const updatedHome = await fetch(`${origin}/`, {
        headers: { cookie: cookieHeader(jar) },
      });
      const updatedHtml = await updatedHome.text();
      expect(updatedHtml).toContain('First Idem Contact');
      expect(updatedHtml).not.toContain('Second Idem Contact');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('blocks starter Better Auth credential projections from the production build artifact', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-auth-secret-'));

    try {
      writeKovoProject(root, { name: 'Prod Auth Secret Proof' });
      linkStarterBuildDependencies(root);
      addAuthSecretLeakProof(root);

      try {
        buildProductionArtifact(root);
        throw new Error('Expected kovo build --no-cache to fail with KV435.');
      } catch (error) {
        const output = execFileSyncErrorOutput(error);
        expect(output).toContain('KV435');
        expect(output).toContain('Secret query value reaches the client wire');
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('serves component-scoped FormError as a real no-JS 422 output from the production artifact', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-form-error-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod FormError Proof' });
      linkStarterBuildDependencies(root);
      addNoJsFailureProof(root);

      buildProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          NODE_ENV: 'production',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;
      const jar = new Map<string, string>();

      const page = await fetchTextWhenReady(`${origin}/no-js-failure-proof`, output);
      const pageResponse = await fetch(`${origin}/no-js-failure-proof`);
      mergeCookies(jar, pageResponse.headers.getSetCookie());
      const pageHtml = await pageResponse.text();
      expect(page).toContain('Blocked title proof');
      const form = firstFormHtml(pageHtml);
      const action = attributeValue(form, 'action');
      expect(action).toBeTruthy();

      const response = await fetch(`${origin}${action}`, {
        body: new URLSearchParams({
          csrf: fieldValue(form, 'csrf'),
          'Kovo-Idem': fieldValue(form, 'Kovo-Idem'),
          title: '<output>helper</output>',
        }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: cookieHeader(jar),
          origin,
        },
        method: 'POST',
        redirect: 'manual',
      });
      const body = await response.text();

      expect(response.status).toBe(422);
      expect(body).toContain(
        '<output role="alert" data-error-code="BLOCKED_TITLE">{"title":"&lt;output&gt;helper&lt;/output&gt;"}</output>',
      );
      expect(body).not.toContain('&lt;output role=&quot;alert&quot;');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('fingerprints the starter stylesheet URL before serving it as immutable', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-build-prod-cache-'));
    const port = await reservePort();
    let prodServer: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Build Prod Cache Proof' });
      linkStarterBuildDependencies(root);

      buildProductionArtifact(root);

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
          "import { appDb, appDbReady } from './db.js';",
          '',
          "describe('starter DDL proof', () => {",
          "  it('boots and exposes the expected schema', async () => {",
          '    await appDbReady;',
          query === ''
            ? '    expect(true).toBe(true);'
            : `    await appDb.execute(sql\`${query}\`);`,
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
      const output = collectOutput(devServer);
      await waitForTcpPort('127.0.0.1', port, output);
    } finally {
      await stopProcess(devServer);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});

function addNoJsFailureProof(root: string): void {
  writeFileSync(
    join(root, 'src/no-js-failure-proof.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component, FormError, type ComponentRenderSlots } from '@kovojs/core';",
      "import { mutation, mutationFormAttributes, publicAccess, s, type MutationContext } from '@kovojs/server';",
      '',
      "import { appCsrf } from './auth.js';",
      '',
      'const blockedTitle = s.object({ title: s.string() });',
      '',
      'export const blockTitle = mutation({',
      "  access: publicAccess('public production FormError regression proof'),",
      '  csrf: appCsrf,',
      '  errors: { BLOCKED_TITLE: blockedTitle },',
      '  input: s.object({ title: s.string() }),',
      '  handler(',
      '    input: { title: string },',
      '    _request: unknown,',
      '    context: MutationContext<{ BLOCKED_TITLE: typeof blockedTitle }>,',
      '  ) {',
      "    return context.fail('BLOCKED_TITLE', { title: input.title });",
      '  },',
      '});',
      '',
      'type BlockTitleSlots = ComponentRenderSlots<{ blockTitle: typeof blockTitle }>;',
      'interface BlockedTitleFailure {',
      "  code: 'BLOCKED_TITLE';",
      '  payload: { title: string };',
      '}',
      'const defaultSlots: BlockTitleSlots = { forms: { blockTitle: { failure: null } } };',
      '',
      'export const NoJsFailureProof = component({',
      '  mutations: { blockTitle },',
      '  render: (_queries, _state, slots: BlockTitleSlots = defaultSlots) => {',
      '    const submitted = slots.forms.blockTitle.submitted ?? {};',
      "    const submittedTitle = typeof submitted.title === 'string' ? submitted.title : '';",
      '    return (',
      '      <main>',
      '        <h1>Blocked title proof</h1>',
      '        <form {...mutationFormAttributes(blockTitle)}>',
      '          <input name="title" value={submittedTitle} />',
      '          <FormError',
      '            code="BLOCKED_TITLE"',
      '            failure={slots.forms.blockTitle.failure}',
      '            message={(failure: BlockedTitleFailure) =>',
      '              `Blocked title: ${failure.payload.title}`',
      '            }',
      '          />',
      '          <button type="submit">Save</button>',
      '        </form>',
      '      </main>',
      '    );',
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8')
    .replace(
      "import { addContact } from './mutations.js';",
      [
        "import { addContact } from './mutations.js';",
        "import { blockTitle, NoJsFailureProof } from './no-js-failure-proof.js';",
      ].join('\n'),
    )
    .replace(
      '  mutations: [addContact, appSignIn, appSignOut],',
      '  mutations: [addContact, blockTitle, appSignIn, appSignOut],',
    )
    .replace(
      "  routes: [\n    route('/', {",
      [
        '  routes: [',
        "    route('/no-js-failure-proof', {",
        "      access: publicAccess('public production FormError regression proof'),",
        "      meta: { title: 'FormError proof' },",
        '      layout: AppLayout,',
        '      stylesheets,',
        '      page() {',
        '        return <NoJsFailureProof />;',
        '      },',
        '    }),',
        "    route('/', {",
      ].join('\n'),
    );
  writeFileSync(appPath, app, 'utf8');
}

function buildProductionArtifact(root: string): void {
  // CI restores **/.kovo/cache, so this prod-artifact gate must prove current source, not cache.
  rmSync(join(root, '.kovo/cache'), { force: true, recursive: true });
  execFileSync(join(root, 'node_modules/.bin/kovo'), ['build', './src/app.tsx', '--no-cache'], {
    cwd: root,
    env: withRepoBinOnPath(),
    stdio: 'pipe',
  });
}

function addAuthSecretLeakProof(root: string): void {
  const queriesPath = join(root, 'src/queries.ts');
  const queries = readFileSync(queriesPath, 'utf8')
    .replace(
      "import { query, type QueryLoadContext, type Reader } from '@kovojs/server';",
      [
        "import { domain, query, type QueryLoadContext, type Reader } from '@kovojs/server';",
        "import { eq } from 'drizzle-orm';",
      ].join('\n'),
    )
    .replace(
      "import { contacts } from './schema.js';",
      "import { account, contacts } from './schema.js';",
    )
    .replace(
      'export interface ContactListResult {\n  items: ContactRow[];\n}',
      [
        'export interface ContactListResult {',
        '  items: ContactRow[];',
        '}',
        '',
        'export interface AuthSecretLeakResult {',
        '  items: { accessToken: string | null; password: string | null }[];',
        '}',
      ].join('\n'),
    )
    .replace(
      '// SPEC §9.4 (MARQUEE): the framework provides `context.db` as the read-only managed handle.',
      [
        'export const authSecretLeakQuery = query({',
        '  guard: appAuthed,',
        "  reads: [domain('auth')],",
        '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<AuthSecretLeakResult> {',
        '    const db = requireDb(context);',
        "    const userId = context?.request.session?.user.id ?? '';",
        '    const items = await db',
        '      .select({',
        '        accessToken: account.accessToken,',
        '        password: account.password,',
        '      })',
        '      .from(account)',
        '      .where(eq(account.userId, userId))',
        '      .limit(1);',
        '    return { items };',
        '  },',
        '});',
        '',
        '// SPEC §9.4 (MARQUEE): the framework provides `context.db` as the read-only managed handle.',
      ].join('\n'),
    );
  writeFileSync(queriesPath, queries, 'utf8');

  writeFileSync(
    join(root, 'src/app.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      "import { createApp, createRequestHandler, domain, mutation, publicAccess, route, s, type RequestHandler } from '@kovojs/server';",
      '',
      "import { appSessionProvider } from './auth.js';",
      "import { appDb, appDbReady } from './db.js';",
      "import { authSecretLeakQuery } from './queries.js';",
      '',
      'await appDbReady;',
      "const authDomain = domain('auth');",
      'const touchAuth = mutation({',
      "  access: publicAccess('build-only auth touch graph proof'),",
      '  csrf: false,',
      '  input: s.object({}),',
      "  optimistic: { [authSecretLeakQuery.key]: 'await-fragment' },",
      '  registry: { touches: [authDomain] },',
      '  handler() {',
      "    return { status: 'ok' };",
      '  },',
      '});',
      "touchAuth.key = 'auth/secret-touch';",
      '',
      'export const AuthSecretLeakProof = component({',
      '  queries: { secrets: authSecretLeakQuery },',
      '  render(_props: { secrets: { accessToken: string | null; password: string | null }[] }) {',
      '    return <main>credential projection proof</main>;',
      '  },',
      '});',
      '',
      'const app = createApp({',
      '  db: () => appDb,',
      '  mutations: [touchAuth],',
      '  queries: [authSecretLeakQuery],',
      '  sessionProvider: appSessionProvider,',
      '  routes: [',
      "    route('/', {",
      "      access: publicAccess('public auth secret build proof'),",
      '      page: () => <AuthSecretLeakProof />,',
      '    }),',
      '  ],',
      '});',
      '',
      'export const requestHandler: RequestHandler = createRequestHandler(app);',
      'export default app;',
      '',
    ].join('\n'),
    'utf8',
  );
}

async function signInDemoUser(
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
  expect(signIn.status).toBe(303);
}

function execFileSyncErrorOutput(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const maybeOutput = error as { message?: unknown; stderr?: unknown; stdout?: unknown };
  return [maybeOutput.stdout, maybeOutput.stderr, maybeOutput.message]
    .map((value) => (Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '')))
    .join('\n');
}

async function waitForTcpPort(host: string, port: number, output: () => string): Promise<void> {
  const deadline = Date.now() + 60_000;
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
  throw new Error(
    `Timed out waiting for ${host}:${port} to accept TCP connections: ${cause}\n${output()}`,
  );
}

function formHtmlByAction(html: string, action: string): string {
  const escaped = escapeRegExp(action);
  const match = new RegExp(`<form\\b(?=[^>]*\\baction="${escaped}")[\\s\\S]*?</form>`, 'i').exec(
    html,
  );
  if (!match?.[0]) throw new Error(`Expected form action ${action}.`);
  return match[0];
}

function firstFormHtml(html: string): string {
  const match = /<form\b[\s\S]*?<\/form>/i.exec(html);
  if (!match?.[0]) throw new Error('Expected a form.');
  return match[0];
}

function elementOpeningTagByAttribute(html: string, name: string, value: string): string {
  const escapedName = escapeRegExp(name);
  const escapedValue = escapeRegExp(value);
  const match = new RegExp(
    `<[A-Za-z][A-Za-z0-9:-]*\\b(?=[^>]*\\b${escapedName}="${escapedValue}")[^>]*>`,
    'i',
  ).exec(html);
  if (!match?.[0]) throw new Error(`Expected element with ${name}=${value}.`);
  return match[0];
}

function fieldValue(html: string, name: string): string {
  const value = attributeValue(elementOpeningTagByAttribute(html, 'name', name), 'value');
  if (value === undefined) throw new Error(`Expected field value for ${name}.`);
  return value;
}

function attributeValue(html: string, name: string): string | undefined {
  const escaped = escapeRegExp(name);
  const match = new RegExp(`\\b${escaped}="([^"]*)"`).exec(html);
  return match?.[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
