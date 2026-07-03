import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import {
  addParanoidPhase5AuthorizationProof,
  addParanoidPhase5WriteBoundaryProof,
  addSqliteRuntimeSecretProvenanceProof,
  addStarterMutationDbScopeProof,
  attributeValue,
  buildParanoidProductionArtifact,
  fieldValue,
  formHtmlByAction,
  pruneParanoidPhase5SqliteReadSet,
  signInDemoUser,
} from './index.build.test-support.js';
import {
  collectOutput,
  cookieHeader,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  reservePort,
  stopProcess,
  withRepoBinOnPath,
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
  'starter-db-scope/absent-tables-contact-write',
  'phase5-write-boundary/ddl-write',
  'phase5-write-boundary/boxed-secret-builder',
  'phase5-write-boundary/boxed-secret-raw',
  'phase5-write-boundary/governed-mass-assignment',
] as const;

describe('create-kovo starter (build integration: paranoid runtime chokes)', () => {
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
      await expectBlockedWrites(origin, marker);
      await expectWriteStatus(origin, marker, contactEmail);

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

async function expectBlockedWrites(origin: string, marker: string): Promise<void> {
  for (const key of blockedWriteCases) {
    const response = await fetch(`${origin}/_m/${key}`, {
      body: new URLSearchParams({ marker }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin,
      },
      method: 'POST',
      redirect: 'manual',
    });
    const body = await response.text();

    expect(response.status, `${key}: ${body}`).toBe(500);
    expect(body).not.toContain(marker);
    expect(body).not.toContain('runtime-secret-value');
    expect(body).not.toContain('phase5-builder-secret');
    expect(body).not.toContain('phase5-raw-secret');
  }
}

async function expectWriteStatus(
  origin: string,
  marker: string,
  contactEmail: string,
): Promise<void> {
  const scopeStatusResponse = await fetch(
    `${origin}/api/starter-db-scope-proof?marker=${encodeURIComponent(
      marker,
    )}&contactEmail=${encodeURIComponent(contactEmail)}`,
  );
  const scopeStatusBody = await scopeStatusResponse.text();
  expect(scopeStatusResponse.status, scopeStatusBody).toBe(200);
  const scopeStatus = JSON.parse(scopeStatusBody) as {
    absentContactRows: number;
    authSessionRows: number;
    authUserRows: number;
    contactRows: number;
    rawAuthUserRows: number;
  };

  expect(scopeStatus).toEqual({
    absentContactRows: 0,
    authSessionRows: 0,
    authUserRows: 0,
    contactRows: 1,
    rawAuthUserRows: 0,
  });

  const writeStatusResponse = await fetch(
    `${origin}/api/phase5-write-boundary-proof?marker=${encodeURIComponent(marker)}`,
  );
  const writeStatusBody = await writeStatusResponse.text();
  expect(writeStatusResponse.status, writeStatusBody).toBe(200);
  const writeStatus = JSON.parse(writeStatusBody) as {
    blockedBuilderSecretRows: number;
    blockedDdlTables: number;
    blockedGovernedMassAssignmentRows: number;
    blockedRawSecretRows: number;
  };

  expect(writeStatus).toEqual({
    blockedBuilderSecretRows: 0,
    blockedDdlTables: 0,
    blockedGovernedMassAssignmentRows: 0,
    blockedRawSecretRows: 0,
  });
}
