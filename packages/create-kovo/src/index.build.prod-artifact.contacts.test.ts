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
  attributeValue,
  buildProductionArtifact,
  elementOpeningTagByAttribute,
  fieldValue,
  formHtmlByAction,
  signInDemoUser,
} from './index.build.test-support.js';

describe('create-kovo starter (build integration: production contact artifacts)', () => {
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
});
