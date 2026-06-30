import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';
import {
  addAuthSecretLeakProof,
  addEscapedAttackerTextProof,
  addInternalHtmlImportProof,
  addNoJsFailureProof,
  addRawSqlOwnerWriteProof,
  attributeValue,
  buildProductionArtifact,
  elementOpeningTagByAttribute,
  execFileSyncErrorOutput,
  fieldValue,
  firstFormHtml,
  formHtmlByAction,
  signInDemoUser,
} from './index.build.test-support.js';

describe('create-kovo starter (build integration: production artifacts)', () => {
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

  it('blocks internal raw-HTML helper imports from authored .ts modules in production build', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-internal-html-import-'));

    try {
      writeKovoProject(root, { name: 'Prod Internal HTML Import Proof' });
      linkStarterBuildDependencies(root);
      addInternalHtmlImportProof(root);

      try {
        buildProductionArtifact(root);
        throw new Error('Expected kovo build --no-cache to fail with KV235.');
      } catch (error) {
        const output = execFileSyncErrorOutput(error);
        expect(output).toContain('KV235');
        expect(output).toContain('@kovojs/server/internal/html');
        expect(output).toContain('raw-helper.ts');
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('serves attacker-shaped helper text escaped from the production build artifact', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-escaped-helper-text-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod Escaped Helper Text Proof' });
      linkStarterBuildDependencies(root);
      addEscapedAttackerTextProof(root);

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

      const html = await fetchTextWhenReady(`${origin}/xss-escape-proof`, output);
      expect(html).toContain('data-proof="xss-escape"');
      expect(html).toContain('&lt;img src=x onerror="alert(1)"&gt;');
      expect(html).toContain('&lt;b id="xss-probe"&gt;RAW&lt;/b&gt;');
      expect(html).not.toContain('<img src=x onerror="alert(1)">');
      expect(html).not.toContain('<b id="xss-probe">RAW</b>');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('blocks raw owner-table db.execute writes from the production build artifact', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-raw-sql-write-'));

    try {
      writeKovoProject(root, { name: 'Prod Raw SQL Write Proof' });
      linkStarterBuildDependencies(root);
      addRawSqlOwnerWriteProof(root);

      try {
        buildProductionArtifact(root);
        throw new Error('Expected kovo build --no-cache to fail for raw owner-table write.');
      } catch (error) {
        const output = execFileSyncErrorOutput(error);
        expect(output).toContain('KV414');
        expect(output).toContain('KV438');
        expect(output).toContain('WRITE');
        expect(output).toContain('domain=raw-owner');
        expect(output).toContain('via=raw-sql');
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('blocks undeclared raw db.execute writes from the production build artifact', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-raw-sql-undeclared-'));

    try {
      writeKovoProject(root, { name: 'Prod Raw SQL Undeclared Proof' });
      linkStarterBuildDependencies(root);
      addRawSqlOwnerWriteProof(root, { declareTables: false });

      try {
        buildProductionArtifact(root);
        throw new Error('Expected kovo build --no-cache to fail for undeclared raw write.');
      } catch (error) {
        const output = execFileSyncErrorOutput(error);
        expect(output).toContain('KV406');
        expect(output).toContain('mutations.ts');
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('accepts trusted raw owner-table db.execute writes from the production build artifact', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-raw-sql-trusted-'));

    try {
      writeKovoProject(root, { name: 'Prod Raw SQL Trusted Proof' });
      linkStarterBuildDependencies(root);
      addRawSqlOwnerWriteProof(root, { trusted: true });

      buildProductionArtifact(root);
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
});
