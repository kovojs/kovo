import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
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
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';
import {
  attributeValue,
  buildReusableProductionArtifact,
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

      buildReusableProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          NODE_ENV: 'test',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;
      const jar = new Map<string, string>();

      await fetchTextWhenReady(`${origin}/login`, output);
      const anonymousHome = await fetch(`${origin}/`, { redirect: 'manual' });
      expect([302, 303, 307]).toContain(anonymousHome.status);
      expect(anonymousHome.headers.get('location')).toBe('/login?next=%2F');

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
            'Kovo-Current-Url': `${origin}/`,
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

  it('serves generated SQLite add-contact mutations from the production build artifact', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-sqlite-add-contact-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { dialect: 'sqlite', name: 'Prod SQLite Add Contact Proof' });
      linkStarterBuildDependencies(root);

      buildReusableProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          NODE_ENV: 'test',
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
      const email = `sqlite-${Date.now()}@example.com`;

      const addContact = await fetch(`${origin}/_m/mutations/add-contact`, {
        body: new URLSearchParams({
          company: 'SQLite Lab',
          csrf: fieldValue(addForm, 'csrf'),
          email,
          'Kovo-Idem': fieldValue(addForm, 'Kovo-Idem'),
          name: 'SQLite Ada',
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
      await addContact.text();
      expect(addContact.status).toBe(303);

      const updatedHome = await fetch(`${origin}/`, {
        headers: { cookie: cookieHeader(jar) },
      });
      const updatedHtml = await updatedHome.text();
      expect(updatedHtml).toContain('SQLite Ada');
      expect(updatedHtml).toContain(email);
      expect(updatedHtml).toContain('4 contacts');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('refreshes later query-backed components from multi-component modules in production artifacts', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-multi-live-target-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod Multi Live Target Proof' });
      linkStarterBuildDependencies(root);
      addMultiComponentLiveTargetProof(root);

      buildReusableProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          NODE_ENV: 'test',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;
      const jar = new Map<string, string>();

      await signInDemoUser(root, origin, jar, output);
      const homeHtml = await (
        await fetch(`${origin}/`, {
          headers: { cookie: cookieHeader(jar) },
        })
      ).text();
      expect(homeHtml).toContain('Live stats: 3');

      const addForm = formHtmlByAction(homeHtml, '/_m/mutations/add-contact');
      const contactRegion = elementOpeningTagByAttribute(
        homeHtml,
        'kovo-fragment-target',
        'contacts-region',
      );
      const statsRegion = elementOpeningTagByAttribute(
        homeHtml,
        'data-live-proof',
        'contact-stats',
      );
      const contactDescriptor = liveTargetDescriptor(contactRegion);
      const statsDescriptor = liveTargetDescriptor(statsRegion);
      expect(contactDescriptor.target).toBe('contacts-region');
      expect(statsDescriptor.target).toBe('contact-stats-region');
      expect(statsDescriptor.component).toBe('components/interaction-lab/contact-stats-region');

      const email = `multi-live-${Date.now()}@example.com`;
      const idem = fieldValue(addForm, 'Kovo-Idem');
      const addContact = await fetch(`${origin}/_m/mutations/add-contact`, {
        body: new URLSearchParams({
          company: 'Compiler Lab',
          csrf: fieldValue(addForm, 'csrf'),
          email,
          'Kovo-Idem': idem,
          name: 'Multi Live Ada',
        }),
        headers: {
          accept: 'text/vnd.kovo.fragment+html',
          'content-type': 'application/x-www-form-urlencoded',
          cookie: cookieHeader(jar),
          'Kovo-Current-Url': `${origin}/`,
          'Kovo-Form-Target': contactDescriptor.target,
          'Kovo-Fragment': 'true',
          'Kovo-Idem': idem,
          'Kovo-Live-Targets': [
            formatLiveTargetDescriptor(contactDescriptor),
            formatLiveTargetDescriptor(statsDescriptor),
          ].join('; '),
          'Kovo-Targets': [
            `${contactDescriptor.target}=${contactDescriptor.deps}`,
            `${statsDescriptor.target}=${statsDescriptor.deps}`,
          ].join('; '),
          origin,
        },
        method: 'POST',
      });
      const body = await addContact.text();
      expect(addContact.status).toBe(200);
      expect(body).toContain('<kovo-fragment target="contacts-region"');
      expect(body).toContain('<kovo-fragment target="contact-stats-region"');
      expect(body).toContain('Multi Live Ada');
      expect(body).toContain('Live stats: 4');
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

      buildReusableProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          NODE_ENV: 'test',
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

interface LiveTargetDescriptor {
  component: string;
  deps: string;
  props: string;
  target: string;
  token: string;
}

function addMultiComponentLiveTargetProof(root: string): void {
  mkdirSync(join(root, 'src/components'), { recursive: true });
  writeFileSync(
    join(root, 'src/components/interaction-lab.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      '',
      "import { contactsQuery, type ContactListResult } from '../queries.js';",
      '',
      'export const TriageIsland = component({',
      '  state: () => ({ open: true }),',
      '  render: (_queries, state) => <triage-island>{state.open ? "Open" : "Closed"}</triage-island>,',
      '});',
      '',
      'export const ContactStatsRegion = component({',
      '  queries: { contacts: contactsQuery },',
      '  render: ({ contacts }: { contacts: ContactListResult }) => {',
      '    const items = contacts.items;',
      '    return <section data-live-proof="contact-stats">Live stats: {items.length}</section>;',
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const appSource = readFileSync(appPath, 'utf8')
    .replace(
      "import { ContactsRegion } from './components/contacts.js';",
      [
        "import { ContactsRegion } from './components/contacts.js';",
        "import { ContactStatsRegion } from './components/interaction-lab.js';",
      ].join('\n'),
    )
    .replace('      <ContactsRegion />', '      <ContactStatsRegion />\n      <ContactsRegion />');
  writeFileSync(appPath, appSource, 'utf8');

  const configPath = join(root, 'kovo.config.ts');
  writeFileSync(
    configPath,
    readFileSync(configPath, 'utf8').replace(
      'preset: node(),',
      [
        'preset: node({',
        '  retention: {',
        '    hours: 24,',
        "    immutableClientModules: 'retained',",
        "    priorTokenQueryReads: 'retained',",
        '  },',
        '}),',
      ].join('\n'),
    ),
    'utf8',
  );
}

function liveTargetDescriptor(openingTag: string): LiveTargetDescriptor {
  return {
    component: requiredAttribute(openingTag, 'kovo-live-component'),
    deps: requiredAttribute(openingTag, 'kovo-deps'),
    props: attributeValue(openingTag, 'kovo-props') ?? '{}',
    target: requiredAttribute(openingTag, 'kovo-fragment-target'),
    token: requiredAttribute(openingTag, 'kovo-live-token'),
  };
}

function formatLiveTargetDescriptor(descriptor: LiveTargetDescriptor): string {
  return `${descriptor.target}#${descriptor.component}@${descriptor.token}:${descriptor.props}`;
}

function requiredAttribute(openingTag: string, name: string): string {
  const value = attributeValue(openingTag, name);
  expect(value).toBeTruthy();
  return value ?? '';
}
