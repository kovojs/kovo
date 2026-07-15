import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import {
  assertProdArtifactSinkCensus,
  readProductionGraph,
} from './index.build.prod-artifact.sink-census.js';
import {
  collectOutput,
  cookieHeader,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  mergeCookies,
  reservePort,
  resolveDependencyRoot,
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';
import {
  addAuthSecretLeakProof,
  addEscapedAttackerTextProof,
  addInternalHtmlImportProof,
  addNoJsFailureProof,
  addRuntimeSecretBoundaryProof,
  addSecretViewEgressProof,
  addSqliteRuntimeSecretProvenanceProof,
  addStarterMutationDbScopeProof,
  addStorageMutationWriteProof,
  addStorageQueryWriteProof,
  addTrustedOutputProvenanceBuildProof,
  addTrustedUrlAttributeTypeGateProof,
  attributeValue,
  buildParanoidProductionArtifact,
  buildProductionArtifact,
  buildReusableProductionArtifact,
  execFileSyncErrorOutput,
  fieldValue,
  firstFormHtml,
  formHtmlByAction,
  signInDemoUser,
} from './index.build.test-support.js';

const starterDbScopeContactEmail = 'starter-scope-proof-contact@example.com';
const starterDbScopeMarker = 'starter-scope-proof-marker';

function captureBuildFailure(build: () => void): string {
  try {
    build();
  } catch (error) {
    return execFileSyncErrorOutput(error);
  }
  throw new Error('Expected production build to fail, but it succeeded.');
}

describe('create-kovo starter (build integration: production security artifacts)', () => {
  it('fails the production build for a request-reachable no-row side-effect mutation with no access guard', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-prod-missing-access-'));

    try {
      writeKovoProject(root, { name: 'Prod Missing Access Proof' });
      linkStarterBuildDependencies(root);
      addNoAccessProvisionMutation(root);

      const output = captureBuildFailure(() => buildProductionArtifact(root));
      expect(output).toContain('KV436');
      expect(output).toContain('mutations/provision-account');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 240_000);

  // @kovo-security-certifies KV435 local-helper-credential-laundering
  // @kovo-security-certifies KV435 direct-secret-projection-to-query-wire
  // @kovo-security-certifies KV435 transformed-query-loader-return-laundering
  // @kovo-security-certifies KV435 render-value-flow-laundering
  // @kovo-security-certifies KV435 value-flow-sibling-laundering
  it('blocks local-helper credential-shaped secret laundering from the production build artifact', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const unsafeRoot = mkdtempSync(join(tempParent, 'create-kovo-prod-auth-secret-unsafe-'));
    const safeRoot = mkdtempSync(join(tempParent, 'create-kovo-prod-auth-secret-safe-'));

    try {
      writeKovoProject(unsafeRoot, { name: 'Prod Auth Secret Proof' });
      linkStarterBuildDependencies(unsafeRoot);
      addAuthSecretLeakProof(unsafeRoot);

      const output = captureBuildFailure(() => buildProductionArtifact(unsafeRoot));
      expect(output).toContain('KV435');
      expect(output).toContain('Secret query value reaches the client wire');
      expect(output).toMatch(
        /queries\/auth-secret-direct-leak-query\.accessToken|query="secrets0" path="secrets0\.accessToken"/u,
      );
      expect(output).toMatch(
        /queries\/auth-secret-transformed-leak-query\.password|query="secrets1" path="secrets1\.password"/u,
      );
      expect(output).toMatch(
        /queries\/auth-secret-render-leak-query\.renderPassword|query="secrets2" path="secrets2\.renderPassword"/u,
      );
      writeKovoProject(safeRoot, { name: 'Prod Auth Secret Safe Sibling' });
      linkStarterBuildDependencies(safeRoot);
      addAuthSecretLeakProof(safeRoot, { leakToWire: false });
      buildReusableProductionArtifact(safeRoot);
    } finally {
      rmSync(unsafeRoot, { force: true, recursive: true });
      rmSync(safeRoot, { force: true, recursive: true });
    }
  }, 240_000);

  it('blocks request-authored runtime DB imports from the production build artifact', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-prod-runtime-db-import-'));

    try {
      writeKovoProject(root, { name: 'Prod Runtime Db Import Proof' });
      linkStarterBuildDependencies(root);
      addRuntimeDbImportEndpointProof(root);

      const output = captureBuildFailure(() => buildProductionArtifact(root));
      expect(output).toContain('KV414');
      expect(output).toContain('src/_kovo/app-runtime-db');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 240_000);

  // @kovo-security-certifies KV435 runtime-secret-view-egress
  it('refuses a runtime Secret read through a Drizzle view at query-wire egress in paranoid mode', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-secret-view-egress-'));
    const port = await reservePort();
    const jar = new Map<string, string>();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod Secret View Egress Proof' });
      linkStarterBuildDependencies(root);
      addSecretViewEgressProof(root);

      buildParanoidProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          KOVO_PARANOID: '1',
          NODE_ENV: 'test',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;

      await signInDemoUser(root, origin, jar, output);
      const response = await fetch(`${origin}/_q/secret-view-egress`, {
        headers: { cookie: cookieHeader(jar) },
      });
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(body).toBe('{"code":"SERVER_ERROR","payload":{}}');
      expect(body).not.toContain('demo@example.com');
      expect(output()).toMatch(/KV422|KV435|permission denied for (?:table|view)/u);
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 240_000);

  // @kovo-security-certifies KV435 runtime-secret-db-read-boundary
  // @kovo-security-certifies KV435 runtime-secret-raw-sql-read-boundary
  // @kovo-security-certifies KV435 runtime-secret-computed-read-boundary
  // @kovo-security-certifies KV435 runtime-secret-audited-reveal-egress
  // @kovo-security-certifies KV435 runtime-secret-reader-raw-sql-refusal
  // @kovo-security-certifies KV435 runtime-secret-declared-read-capability
  it('boxes schema-declared secret reads, raw SQL aliases, and computed values before query-wire egress in paranoid mode while allowing audited reveals', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-runtime-secret-boundary-'));
    const port = await reservePort();
    const jar = new Map<string, string>();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod Runtime Secret Boundary Proof' });
      linkStarterBuildDependencies(root);
      addRuntimeSecretBoundaryProof(root);
      const proofQueries = readFileSync(join(root, 'src/queries.ts'), 'utf8');
      const generatedRuntimeDb = readFileSync(join(root, 'src/_kovo/app-runtime-db.ts'), 'utf8');
      expect(proofQueries).toContain(
        "import { declareSecretReadCapability, query, s, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';",
      );
      expect(proofQueries).not.toContain("from './_kovo/app-runtime-db.js'");
      expect(generatedRuntimeDb).not.toContain('declareSecretReadCapability');
      expect(proofQueries).toContain('classified: runtimeSecretProof.classified');
      expect(proofQueries).toContain('leaked: runtimeSecretFunctionProof.functionClassified');
      expect(proofQueries).toContain('runtimeSecretWholeProof.label');
      expect(proofQueries).toContain('classified as leaked from "runtime_secret_proof"');
      expect(proofQueries).toContain('opaque raw SQL parse-fail secret boundary proof');
      expect(proofQueries).toContain('runtimeSecretDefaultRawRefusalQuery');
      expect(proofQueries).toContain('default reader raw secret-column refusal proof');
      expect(proofQueries).toContain('runtimeSecretDirectRawRefusalQuery');
      expect(proofQueries).toContain('default reader direct raw secret-column refusal proof');
      expect(proofQueries).toContain('runtimeSecretViewRawRefusalQuery');
      expect(proofQueries).toContain('security-invoker view secret-column refusal proof');
      expect(proofQueries).toContain('runtimeSecretReaderRoleProofQuery');
      expect(proofQueries).toContain('PGlite non-superuser reader role assumption proof');
      expect(proofQueries).toContain('runtimeSecretDefaultRawPublicQuery');
      expect(proofQueries).toContain('default reader raw public-column proof');
      expect(proofQueries).toContain('runtimeSecretDeclaredRawEgressQuery');
      expect(proofQueries).toContain('declareSecretReadCapability(');
      expect(proofQueries).toContain('runtimeSecretDeclaredRawRevealQuery');
      expect(proofQueries).toContain('audited declared raw secret-read reveal acceptance proof');
      expect(proofQueries).toContain('runtimeSecretComputedEgressQuery');
      expect(proofQueries).toContain('leaked: row.classified');
      expect(proofQueries).toContain(
        'trustedReveal(row as unknown as Secret<{ classified: string; id: string }>',
      );
      expect(proofQueries).toContain('audited runtime query-wire reveal acceptance proof');

      buildParanoidProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          KOVO_PARANOID: '1',
          NODE_ENV: 'test',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;

      await signInDemoUser(root, origin, jar, output);
      for (const key of [
        'runtime-secret-column-egress',
        'runtime-secret-function-egress',
        'runtime-secret-raw-egress',
        'runtime-secret-declared-raw-egress',
        'runtime-secret-opaque-raw-egress',
        'runtime-secret-computed-egress',
        'runtime-secret-whole-table-egress',
      ]) {
        const response = await fetch(`${origin}/_q/${key}`, {
          headers: { cookie: cookieHeader(jar) },
        });
        const body = await response.text();

        expect(response.status, `${key}: ${body}`).toBe(500);
        expect(body).toMatch(/^\{"code":"(?:KV410|SERVER_ERROR)","payload":\{\}\}$/u);
        expect(body).not.toContain('runtime-secret-value');
        expect(body).not.toContain('runtime-function-secret-value');
        expect(body).not.toContain('runtime-whole-secret-value');
      }
      expect(output()).toContain('KV435');
      expect(output()).toContain('Secret runtime value cannot cross');

      const refusalResponse = await fetch(`${origin}/_q/runtime-secret-default-raw-refusal`, {
        headers: { cookie: cookieHeader(jar) },
      });
      const refusalBody = await refusalResponse.text();

      expect(refusalResponse.status, refusalBody).toBe(200);
      expect(refusalBody).toContain('default-reader-raw-secret-refusal');
      expect(refusalBody).toContain('blocked');
      expect(refusalBody).toContain('KV433');
      expect(refusalBody).not.toContain('runtime-secret-value');

      const directRefusalResponse = await fetch(`${origin}/_q/runtime-secret-direct-raw-refusal`, {
        headers: { cookie: cookieHeader(jar) },
      });
      const directRefusalBody = await directRefusalResponse.text();

      expect(directRefusalResponse.status, directRefusalBody).toBe(200);
      expect(directRefusalBody).toContain('default-reader-direct-raw-secret-refusal');
      expect(directRefusalBody).toContain('blocked');
      expect(directRefusalBody).toContain('KV433');
      expect(directRefusalBody).not.toContain('runtime-secret-value');

      const viewRefusalResponse = await fetch(`${origin}/_q/runtime-secret-view-raw-refusal`, {
        headers: { cookie: cookieHeader(jar) },
      });
      const viewRefusalBody = await viewRefusalResponse.text();

      expect(viewRefusalResponse.status, viewRefusalBody).toBe(200);
      expect(viewRefusalBody).toContain('default-reader-view-secret-refusal');
      expect(viewRefusalBody).toContain('blocked');
      expect(viewRefusalBody).toContain('KV433');
      expect(viewRefusalBody).not.toContain('runtime-secret-value');

      const readerRoleResponse = await fetch(`${origin}/_q/runtime-secret-reader-role-proof`, {
        headers: { cookie: cookieHeader(jar) },
      });
      const readerRoleBody = await readerRoleResponse.text();

      expect(readerRoleResponse.status, readerRoleBody).toBe(200);
      expect(readerRoleBody).toContain('reader-role');
      expect(readerRoleBody).toContain('kovo_reader');

      const publicRawResponse = await fetch(`${origin}/_q/runtime-secret-default-raw-public`, {
        headers: { cookie: cookieHeader(jar) },
      });
      const publicRawBody = await publicRawResponse.text();

      expect(publicRawResponse.status, publicRawBody).toBe(200);
      expect(publicRawBody).toContain('<kovo-query name="runtime-secret-default-raw-public"');
      expect(publicRawBody).toContain('public label');
      expect(publicRawBody).not.toContain('runtime-secret-value');

      const revealResponse = await fetch(`${origin}/_q/runtime-secret-reveal-egress`, {
        headers: { cookie: cookieHeader(jar) },
      });
      const revealBody = await revealResponse.text();

      expect(revealResponse.status, revealBody).toBe(200);
      expect(revealBody).toContain('<kovo-query name="runtime-secret-reveal-egress"');
      expect(revealBody).toContain('runtime-secret-value');
      expect(revealBody).toContain('runtime-secret-value:computed');

      const declaredRevealResponse = await fetch(
        `${origin}/_q/runtime-secret-declared-raw-reveal`,
        {
          headers: { cookie: cookieHeader(jar) },
        },
      );
      const declaredRevealBody = await declaredRevealResponse.text();

      expect(declaredRevealResponse.status, declaredRevealBody).toBe(200);
      expect(declaredRevealBody).toContain('<kovo-query name="runtime-secret-declared-raw-reveal"');
      expect(declaredRevealBody).toContain('runtime-secret-value');
      expect(declaredRevealBody).toContain('runtime-secret-value:declared');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 240_000);

  // @kovo-security-certifies KV414 starter-auth-table-scope-static-gate
  it('rejects statically visible starter DB scope drift before artifact emission', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-prod-starter-db-scope-static-'));

    try {
      writeKovoProject(root, { name: 'Prod Starter Static DB Scope Proof' });
      linkStarterBuildDependencies(root);
      addStarterMutationDbScopeProof(root, { mode: 'static-structured' });

      const output = captureBuildFailure(() => buildProductionArtifact(root));
      expect(output).toContain('KV414 WRITE starterAuthUserTableWrite');
      expect(output).toContain('KV414 WRITE starterAuthSessionTableWrite');
      expect(output).toContain(
        'KV402 starter-mutation-db-scope-proof/starter-auth-user-table-write-proof',
      );
      expect(output).not.toContain('KV424');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 240_000);

  // @kovo-security-certifies KV406 starter-mutation-db-scope-prod-artifact
  it('enforces starter mutation DB table scope in paranoid production artifacts', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-starter-db-scope-'));
    const port = await reservePort();
    const jar = new Map<string, string>();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod Starter DB Scope Proof' });
      linkStarterBuildDependencies(root);
      addStarterMutationDbScopeProof(root, { mode: 'runtime-table-choke' });

      buildParanoidProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          KOVO_PARANOID: '1',
          NODE_ENV: 'test',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;

      await signInDemoUser(root, origin, jar, output);

      const homeHtml = await fetchTextWhenReady(`${origin}/`, output, {
        headers: { cookie: cookieHeader(jar) },
      });
      const addForm = formHtmlByAction(homeHtml, '/_m/mutations/add-contact');
      const addContact = await fetch(`${origin}/_m/mutations/add-contact`, {
        body: new URLSearchParams({
          company: 'Scope Proof',
          csrf: fieldValue(addForm, 'csrf'),
          email: starterDbScopeContactEmail,
          'Kovo-Idem': fieldValue(addForm, 'Kovo-Idem'),
          name: 'Starter Scope Proof',
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

      const blockedMutations = [
        'starter-mutation-db-scope-proof/starter-absent-tables-contact-write-proof',
        'starter-mutation-db-scope-proof/starter-raw-auth-table-write-proof',
      ] as const;
      for (const key of blockedMutations) {
        const proofForm = formHtmlByAction(homeHtml, `/_m/${key}`);
        const response = await fetch(`${origin}/_m/${key}`, {
          body: new URLSearchParams({
            csrf: fieldValue(proofForm, 'csrf'),
            'Kovo-Idem': fieldValue(proofForm, 'Kovo-Idem'),
            marker: starterDbScopeMarker,
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
        expect(response.status, `${key}: ${body}`).toBe(500);
        expect(body).not.toContain(starterDbScopeMarker);
      }

      const statusResponse = await fetch(`${origin}/api/starter-db-scope-proof`);
      const statusBody = await statusResponse.text();
      expect(statusResponse.status, statusBody).toBe(200);
      const status = JSON.parse(statusBody) as {
        absentContactRows: number;
        contactRows: number;
      };

      expect(status).toEqual({
        absentContactRows: 0,
        contactRows: 1,
      });
      expect(output()).toContain('KV406');
      expect(output()).toContain('declared mutation registry tables');

      await stopProcess(server);
      server = undefined;
      const pgliteModule = (await import(
        pathToFileURL(join(resolveDependencyRoot('@electric-sql/pglite'), 'dist/index.js')).href
      )) as {
        PGlite: new (dataDir: string) => {
          close(): Promise<void>;
          query(statement: string): Promise<{ rows: Array<{ id: string }> }>;
          waitReady: Promise<void>;
        };
      };
      const raw = new pgliteModule.PGlite(join(root, '.kovo/pglite'));
      try {
        await raw.waitReady;
        const authUsers = await raw.query(
          `select id from "user" where id = 'starter-scope-proof-raw-auth-user'`,
        );
        const absentContacts = await raw.query(
          `select id from contacts where id = 'starter-scope-proof-absent-contact'`,
        );
        expect(authUsers.rows).toEqual([]);
        expect(absentContacts.rows).toEqual([]);
      } finally {
        await raw.close();
      }
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 240_000);

  // @kovo-security-certifies KV435 sqlite-runtime-secret-source-provenance
  // @kovo-security-certifies KV435 sqlite-runtime-secret-expression-provenance
  it('boxes SQLite secret reads by source provenance while serving proven non-secret projections in paranoid mode', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-sqlite-secret-provenance-'));
    const port = await reservePort();
    const jar = new Map<string, string>();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, {
        dialect: 'sqlite',
        name: 'Prod SQLite Runtime Secret Provenance Proof',
      });
      linkStarterBuildDependencies(root);
      addSqliteRuntimeSecretProvenanceProof(root);
      const proofQueries = readFileSync(join(root, 'src/queries.ts'), 'utf8');
      expect(proofQueries).toContain('company: proof.classified');
      // The hardened SQLite starter accepts only declarative tables and structured seed data.
      // Actual view egress remains covered by the `runtime-secret-view-egress` Postgres artifact
      // proof above; do not replace that engine view with a seeded table in this fixture.
      expect(proofQueries).toContain('substr(classified, 1, 7) as leaked');
      expect(proofQueries).toContain('classified as leaked from secret_cte');
      expect(proofQueries).toContain('(select classified from runtime_secret_proof) as leaked');
      expect(proofQueries).toContain('drizzleSql<string>`upper(${contacts.name})');
      expect(proofQueries).toContain('label: proof.label');

      buildParanoidProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          KOVO_PARANOID: '1',
          NODE_ENV: 'test',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;

      await signInDemoUser(root, origin, jar, output);
      for (const key of [
        'queries/sqlite-secret-alias-query',
        'queries/sqlite-secret-derivation-query',
        'queries/sqlite-secret-join-alias-query',
        'queries/sqlite-secret-cte-query',
        'queries/sqlite-secret-mixed-chunk-query',
        'queries/sqlite-secret-mixed-chunk-builder-query',
      ]) {
        const response = await fetch(`${origin}/_q/${key}`, {
          headers: { cookie: cookieHeader(jar) },
        });
        const body = await response.text();

        expect(response.status, `${key}: ${body}`).toBe(500);
        expect(body).toMatch(/^\{"code":"(?:KV410|SERVER_ERROR)","payload":\{\}\}$/u);
        expect(body).not.toContain('runtime-secret-value');
      }
      const publicProjectionKey = 'queries/sqlite-secret-non-secret-projection-query';
      const publicProjectionResponse = await fetch(`${origin}/_q/${publicProjectionKey}`, {
        headers: { cookie: cookieHeader(jar) },
      });
      const publicProjectionBody = await publicProjectionResponse.text();

      expect(publicProjectionResponse.status, publicProjectionBody).toBe(200);
      expect(publicProjectionBody).toContain(`<kovo-query name="${publicProjectionKey}"`);
      expect(publicProjectionBody).toContain('public label');
      expect(publicProjectionBody).not.toContain('runtime-secret-value');

      const revealKey = 'queries/sqlite-secret-reveal-query';
      const revealResponse = await fetch(`${origin}/_q/${revealKey}`, {
        headers: { cookie: cookieHeader(jar) },
      });
      const revealBody = await revealResponse.text();

      expect(revealResponse.status, revealBody).toBe(200);
      expect(revealBody).toContain(`<kovo-query name="${revealKey}"`);
      expect(revealBody).toContain('runtime-secret-value:revealed');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 240_000);

  // @kovo-security-certifies KV235 internal-raw-html-import
  it('blocks internal raw-HTML helper imports from authored .ts modules in production build', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-internal-html-import-'));

    try {
      writeKovoProject(root, { name: 'Prod Internal HTML Import Proof' });
      linkStarterBuildDependencies(root);
      addInternalHtmlImportProof(root);

      const output = captureBuildFailure(() => buildProductionArtifact(root));
      expect(output).toContain('KV235');
      expect(output).toContain('App source imports a non-public Kovo subpath');
      expect(output).toContain('raw-helper.ts');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  // @kovo-security-certifies KV433 storage-query-write-prod-artifact
  // Exact put/delete/upload authorities reach KV433; the opaque file-store sibling is covered
  // separately by the M1 adversarial KV424 fixture.
  it('blocks storage writes from query loaders in the production build artifact', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-storage-query-write-'));

    try {
      writeKovoProject(root, { name: 'Prod Storage Query Write Proof' });
      linkStarterBuildDependencies(root);
      addStorageQueryWriteProof(root);

      const output = captureBuildFailure(() => buildProductionArtifact(root));
      expect(output).toContain('KV433');
      expect(output).toContain('storage-put-write-query');
      expect(output).toContain('storage-delete-write-query');
      expect(output).toContain('storage-upload-write-query');
      expect(output).toContain('operation=put');
      expect(output).toContain('operation=delete');
      expect(output).toContain('operation=upload');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('serves declared mutation storage writes through the production artifact', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-storage-mutation-write-'));
    const port = await reservePort();
    const jar = new Map<string, string>();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod Storage Mutation Write Proof' });
      linkStarterBuildDependencies(root);
      addStorageMutationWriteProof(root);

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

      await fetchTextWhenReady(`${origin}/storage-mutation-proof`, output);
      const initialResponse = await fetch(`${origin}/storage-mutation-proof`);
      mergeCookies(jar, initialResponse.headers.getSetCookie());
      const initial = await initialResponse.text();
      expect(initial).toContain('<p id="storage-put">missing</p>');
      expect(initial).toContain('<p id="storage-delete">present</p>');
      const putForm = formHtmlByAction(
        initial,
        '/_m/storage-mutation-proof/storage-mutation-write',
      );

      const put = await fetch(`${origin}/_m/storage-mutation-proof/storage-mutation-write`, {
        body: new URLSearchParams({
          csrf: fieldValue(putForm, 'csrf'),
          'Kovo-Idem': fieldValue(putForm, 'Kovo-Idem'),
          mode: 'put',
        }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: cookieHeader(jar),
          'Kovo-Fragment': 'true',
          origin,
        },
        method: 'POST',
      });
      await put.text();
      expect(put.status).toBe(200);
      const afterPut = await fetch(`${origin}/storage-mutation-proof`, {
        headers: { cookie: cookieHeader(jar) },
      });
      const afterPutHtml = await afterPut.text();
      expect(afterPutHtml).toContain('<p id="storage-put">present</p>');
      const deleteForm = formHtmlByAction(
        afterPutHtml,
        '/_m/storage-mutation-proof/storage-mutation-write',
      );

      const deleteResponse = await fetch(
        `${origin}/_m/storage-mutation-proof/storage-mutation-write`,
        {
          body: new URLSearchParams({
            csrf: fieldValue(deleteForm, 'csrf'),
            'Kovo-Idem': fieldValue(deleteForm, 'Kovo-Idem'),
            mode: 'delete',
          }),
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            cookie: cookieHeader(jar),
            'Kovo-Fragment': 'true',
            origin,
          },
          method: 'POST',
        },
      );
      await deleteResponse.text();
      expect(deleteResponse.status).toBe(200);
      const afterDelete = await fetch(`${origin}/storage-mutation-proof`, {
        headers: { cookie: cookieHeader(jar) },
      });
      await expect(afterDelete.text()).resolves.toContain('<p id="storage-delete">missing</p>');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);

  // @kovo-security-certifies KV426 trusted-output-prod-artifact
  it('blocks trusted output provenance leaks through the production build artifact', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const unsafeRoot = mkdtempSync(join(tempParent, 'create-kovo-prod-trusted-output-unsafe-'));
    const safeRoot = mkdtempSync(join(tempParent, 'create-kovo-prod-trusted-output-safe-'));

    try {
      writeKovoProject(unsafeRoot, { name: 'Prod Trusted Output Proof' });
      linkStarterBuildDependencies(unsafeRoot);
      addTrustedOutputProvenanceBuildProof(unsafeRoot);
      const proofSource = readFileSync(join(unsafeRoot, 'src/app.tsx'), 'utf8');
      expect(proofSource).toContain(
        'href={trustedUrl(data.contacts.items.map((contact) => contact.email).join(""))}',
      );
      expect(proofSource).toContain('{trustedHtml(slots.request?.headers.get("x-proof") ?? "")}');

      const output = captureBuildFailure(() => buildProductionArtifact(unsafeRoot));
      expect(output).toContain('KV426');
      expect(output).toContain('trustedUrl() sends query-derived data');
      expect(output).toContain('trustedHtml() sends request-derived data');

      writeKovoProject(safeRoot, { name: 'Prod Trusted Output Safe Sibling' });
      linkStarterBuildDependencies(safeRoot);
      addTrustedOutputProvenanceBuildProof(safeRoot, { unsafe: false });
      buildReusableProductionArtifact(safeRoot);
    } finally {
      rmSync(unsafeRoot, { force: true, recursive: true });
      rmSync(safeRoot, { force: true, recursive: true });
    }
  }, 240_000);

  // @kovo-security-certifies KV426 trusted-url-attribute-type-gate
  it('blocks TrustedUrl values in non-URL JSX attributes during production build', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-trusted-url-attribute-'));

    try {
      writeKovoProject(root, { name: 'Prod TrustedUrl Attribute Proof' });
      linkStarterBuildDependencies(root);
      addTrustedUrlAttributeTypeGateProof(root);

      const output = captureBuildFailure(() => buildProductionArtifact(root));
      expect(output).toContain('TrustedUrl');
      expect(output).toContain('AttributeValue');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('serves escaped runtime security wires from shared production artifacts', async () => {
    for (const dialect of ['postgres', 'sqlite'] as const) {
      const tempParent = tmpdir();
      mkdirSync(tempParent, { recursive: true });
      const root = mkdtempSync(join(tempParent, `create-kovo-prod-runtime-security-${dialect}-`));
      const port = await reservePort();
      let server: ChildProcessWithoutNullStreams | undefined;

      try {
        writeKovoProject(root, { dialect, name: `Prod Runtime Security Proof ${dialect}` });
        linkStarterBuildDependencies(root);
        addEscapedAttackerTextProof(root);
        addQueryWireProof(root);
        addEnhancedMutationWireProof(root);

        buildReusableProductionArtifact(root);
        assertEscapedAttackerTextCensus(root);
        assertEnhancedMutationWireCensus(root);
        assertQueryWireCensus(root);

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

        await assertEscapedAttackerTextServed(origin, output);
        await assertEnhancedMutationWireServed(origin, dialect, output);
        await assertQueryWireServed(origin, output);
      } finally {
        await stopProcess(server);
        rmSync(root, { force: true, recursive: true });
      }
    }
  }, 240_000);

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

      const errorPageResponse = await fetch(`${origin}/no-js-error-proof`, {
        headers: { cookie: cookieHeader(jar) },
      });
      mergeCookies(jar, errorPageResponse.headers.getSetCookie());
      const errorPageHtml = await errorPageResponse.text();
      const errorForm = firstFormHtml(errorPageHtml);
      const errorAction = attributeValue(errorForm, 'action');
      expect(errorAction).toBeTruthy();

      const errorResponse = await fetch(`${origin}${errorAction}`, {
        body: new URLSearchParams({
          csrf: fieldValue(errorForm, 'csrf'),
          'Kovo-Idem': fieldValue(errorForm, 'Kovo-Idem'),
          title: 'boom',
        }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: cookieHeader(jar),
          origin,
        },
        method: 'POST',
        redirect: 'manual',
      });
      const errorBody = await errorResponse.text();

      expect(errorResponse.status, errorBody).toBe(500);
      expect(errorResponse.headers.get('cache-control')).toBe('private, no-store');
      expect(errorResponse.headers.get('content-security-policy')).toContain("default-src 'self'");
      expect(errorResponse.headers.get('vary')).toContain('Cookie');
      expect(errorResponse.headers.get('x-content-type-options')).toBe('nosniff');
      expect(errorResponse.headers.get('x-frame-options')).toBe('DENY');
      expect(errorBody).toBe('Internal Server Error');
      expect(errorBody).not.toContain('private no-JS mutation detail');
      expect(errorBody).not.toContain('<script>boom</script>');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  // @kovo-security-certifies M3 dynamic-jsx-spread-control-provenance
  // @kovo-security-certifies M6 enhanced-mutation-session-transition
  it('serves only compiler-declared controls and session-transition reload hints from the production artifact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-prod-control-provenance-'));
    const port = await reservePort();
    const jar = new Map<string, string>();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { dialect: 'sqlite', name: 'Prod Control Provenance Proof' });
      linkStarterBuildDependencies(root);
      addControlProvenanceProof(root);
      buildProductionArtifact(root);

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

      const pageHtml = await fetchTextWhenReady(`${origin}/control-provenance-proof`, output);
      const proofRoot = rootElementWithAttribute(pageHtml, 'data-proof', 'dynamic-spread');
      expect(proofRoot).toContain('aria-label="Public profile"');
      expect(proofRoot).toContain('data-profile-id="public-profile"');
      expect(proofRoot).not.toMatch(
        /on:load|kovo-param-types|data-p-account-id|data-bind|data-kovo-/iu,
      );
      expect(pageHtml).not.toContain('/c/attacker-selected.client.js');

      const declaredHandler = /on:click="([^"#]+)#([^"]+)"/u.exec(pageHtml);
      expect(declaredHandler).not.toBeNull();
      const declaredModuleUrl = declaredHandler?.[1] ?? '';
      expect(pageHtml).toContain(`data-kovo-module-allowlist="${declaredModuleUrl}"`);
      const declaredModule = await fetch(`${origin}${declaredModuleUrl}`);
      expect(declaredModule.status).toBe(200);
      await expect(declaredModule.text()).resolves.toContain(declaredHandler?.[2] ?? 'missing');

      for (const proof of ['auth-domain', 'same-principal-cookie'] as const) {
        const form = formHtmlByDataProof(pageHtml, proof);
        const response = await fetch(`${origin}${requiredAttribute(form, 'action')}`, {
          body: new URLSearchParams({}),
          headers: {
            accept: 'text/vnd.kovo.fragment+html',
            'content-type': 'application/x-www-form-urlencoded',
            'Kovo-Fragment': 'true',
            origin,
          },
          method: 'POST',
        });
        await response.text();
        expect(response.status).toBe(200);
        expect(response.headers.get('kovo-session-transition')).toBe('reload');
        if (proof === 'auth-domain') expect(response.headers.get('kovo-changes')).toContain('auth');
        else expect(response.headers.getSetCookie().join('\n')).toContain('proof_refresh=rotated');
      }

      await signInDemoUser(root, origin, jar, output);
      const homeHtml = await fetchTextWhenReady(`${origin}/`, output, {
        headers: { cookie: cookieHeader(jar) },
      });
      const signOutForm = formHtmlByAction(homeHtml, '/_m/auth/sign-out');
      const signOut = await fetch(`${origin}/_m/auth/sign-out`, {
        body: new URLSearchParams({
          csrf: fieldValue(signOutForm, 'csrf'),
          'Kovo-Idem': fieldValue(signOutForm, 'Kovo-Idem'),
        }),
        headers: {
          accept: 'text/vnd.kovo.fragment+html',
          'content-type': 'application/x-www-form-urlencoded',
          cookie: cookieHeader(jar),
          'Kovo-Fragment': 'true',
          origin,
        },
        method: 'POST',
        redirect: 'manual',
      });
      await signOut.text();
      expect(signOut.status).toBe(200);
      expect(signOut.headers.get('clear-site-data')).toContain('cookies');
      expect(signOut.headers.getSetCookie().length).toBeGreaterThan(0);
      expect(signOut.headers.get('kovo-session-transition')).toBe('reload');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 240_000);
});

function assertEscapedAttackerTextCensus(root: string): void {
  const census = assertProdArtifactSinkCensus(root, [
    {
      proof: {
        evidence:
          'packages/create-kovo/src/index.build.prod-artifact.security.test.ts observes escaped SSR route text from the production server artifact',
        kind: 'proof',
      },
      sink: 'SSR document HTML route text',
      witnesses: ['xss-escape-proof', 'escapeTextWithRenderedHtml'],
    },
    {
      proof: {
        evidence:
          'packages/create-kovo/src/index.build.prod-artifact.security.test.ts builds the production artifact only through framework-owned escaped/trusted HTML boundaries',
        kind: 'proof',
      },
      sink: 'SSR raw/trusted HTML boundary',
      witnesses: ['trustedHtml', 'escapeTextWithRenderedHtml'],
    },
  ]);
  expect(census.entries).toHaveLength(2);
}

function assertEnhancedMutationWireCensus(root: string): void {
  const census = assertProdArtifactSinkCensus(root, [
    {
      proof: {
        evidence:
          'packages/create-kovo/src/index.build.prod-artifact.security.test.ts observes escaped enhanced mutation fragment HTML from the production server artifact',
        kind: 'proof',
      },
      sink: 'enhanced mutation fragment body',
      witnesses: [
        'enhanced-mutation-wire-proof',
        'renderFragmentWireHtml',
        'escapeTextWithRenderedHtml',
      ],
    },
    {
      proof: {
        evidence:
          'packages/create-kovo/src/index.build.prod-artifact.security.test.ts observes escaped mutation-triggered query refresh wire from the production server artifact',
        kind: 'proof',
      },
      sink: 'mutation-triggered query refresh wire',
      witnesses: ['enhanced-mutation-wire-proof', 'renderQueryWireHtml', 'escapeHtml'],
    },
  ]);
  expect(census.entries).toHaveLength(2);
  expect(JSON.stringify(readProductionGraph(root))).toContain('enhanced-mutation-wire-proof');
}

function assertQueryWireCensus(root: string): void {
  const census = assertProdArtifactSinkCensus(root, [
    {
      proof: {
        evidence:
          'packages/create-kovo/src/index.build.prod-artifact.security.test.ts observes escaped /_q body wire from the production server artifact',
        kind: 'proof',
      },
      sink: '/_q query response body',
      witnesses: ['renderQueryWireHtml', 'escapeHtml', 'q-response-proof'],
    },
    {
      proof: {
        evidence:
          'packages/create-kovo/src/index.build.prod-artifact.security.test.ts observes /_q private cache headers from the production server artifact',
        kind: 'proof',
      },
      sink: '/_q query response headers',
      witnesses: ['querySuccessCacheHeaders', 'private, no-store', 'Vary'],
    },
  ]);
  expect(census.entries).toHaveLength(2);
  expect(JSON.stringify(readProductionGraph(root))).toContain(queryWireProofKey);
}

async function assertEscapedAttackerTextServed(
  origin: string,
  output: () => string,
): Promise<void> {
  const html = await fetchTextWhenReady(`${origin}/xss-escape-proof`, output);
  expect(html).toContain('data-proof="xss-escape"');
  expect(html).toContain('&lt;img src=x onerror="alert(1)"&gt;');
  expect(html).toContain('&lt;b id="xss-probe"&gt;RAW&lt;/b&gt;');
  expect(html).not.toContain('<img src=x onerror="alert(1)">');
  expect(html).not.toContain('<b id="xss-probe">RAW</b>');
}

async function assertEnhancedMutationWireServed(
  origin: string,
  dialect: 'postgres' | 'sqlite',
  output: () => string,
): Promise<void> {
  await fetchTextWhenReady(`${origin}/enhanced-mutation-wire-proof`, output);
  const jar = new Map<string, string>();
  const pageResponse = await fetch(`${origin}/enhanced-mutation-wire-proof`);
  mergeCookies(jar, pageResponse.headers.getSetCookie());
  const pageHtml = await pageResponse.text();
  const form = firstFormHtml(pageHtml);
  const action = attributeValue(form, 'action');
  if (!action) throw new Error('Expected enhanced mutation proof form action.');
  const proofRoot = rootElementWithAttribute(pageHtml, 'data-proof', 'enhanced-wire');
  const target = requiredAttribute(proofRoot, 'kovo-fragment-target');
  const deps = requiredAttribute(proofRoot, 'kovo-deps');
  const component = requiredAttribute(proofRoot, 'kovo-live-component');
  const liveToken = requiredAttribute(proofRoot, 'kovo-live-token');
  const props = attributeValue(proofRoot, 'kovo-props') ?? '{}';

  expect(pageHtml).toContain('&lt;img src=x onerror="alert(1)"&gt;');
  expect(pageHtml).not.toContain('<img src=x onerror="alert(1)">');

  const response = await fetch(`${origin}${action}`, {
    body: new URLSearchParams({
      'Kovo-Idem': `enhanced-wire-${Date.now()}-${dialect}`,
      csrf: fieldValue(form, 'csrf'),
      note: '<img src=x onerror="alert(1)"><script>alert(1)</script>',
    }),
    headers: {
      accept: 'text/vnd.kovo.fragment+html',
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(jar),
      'Kovo-Current-Url': `${origin}/enhanced-mutation-wire-proof`,
      'Kovo-Form-Target': target,
      'Kovo-Fragment': 'true',
      'Kovo-Live-Targets': `${target}#${component}@${liveToken}:${props}`,
      'Kovo-Targets': `${target}=${deps}`,
      origin,
    },
    method: 'POST',
  });
  const body = await response.text();

  expect(response.status, body).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/vnd.kovo.fragment+html');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('kovo-changes')).toContain('enhanced-mutation-wire-proof');
  expect(body).toContain('<kovo-query');
  expect(body).toContain('<kovo-fragment');
  expect(body).toContain('&lt;img src=x onerror=\\"alert(1)\\"&gt;');
  expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(body).toContain('&lt;img src=x onerror="alert(1)"&gt;');
  expect(body).not.toContain('<img src=x onerror="alert(1)">');
  expect(body).not.toContain('<script>alert(1)</script>');
}

async function assertQueryWireServed(origin: string, output: () => string): Promise<void> {
  await fetchTextWhenReady(`${origin}/_q/${encodeURIComponent(queryWireProofKey)}`, output);
  const response = await fetch(`${origin}/_q/${encodeURIComponent(queryWireProofKey)}`);
  const body = await response.text();

  expect(response.status, body).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('vary')).toContain('Cookie');
  expect(body).toContain(`<kovo-query name="${queryWireProofKey}">`);
  expect(body).toContain('&lt;img src=x onerror=\\"alert(1)\\"&gt;');
  expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(body).not.toContain('<img src=x onerror="alert(1)">');
  expect(body).not.toContain('<script>alert(1)</script>');
}

const queryWireProofKey = 'queries/q-response-proof-query';

function addRuntimeDbImportEndpointProof(root: string): void {
  writeFileSync(
    join(root, 'src/dogfood-runtime-db.endpoint.ts'),
    [
      "import { endpoint, publicAccess } from '@kovojs/server';",
      "import { appRuntimeDbProvider } from './_kovo/app-runtime-db.js';",
      '',
      'void appRuntimeDbProvider;',
      '',
      "export const dogfoodReadAuthToken = endpoint('/api/dogfood-runtime-db', {",
      "  access: publicAccess('runtime DB import proof'),",
      "  auth: { justification: 'runtime DB import proof', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'runtime DB import proof',",
      "  method: 'GET',",
      "  reason: 'runtime DB import proof',",
      "  response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },",
      '  handler() {',
      "    return new Response('runtime DB value import blocked');",
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  app = replaceRequired(
    app,
    "import { appTheme } from './theme.js';",
    [
      "import { appTheme } from './theme.js';",
      "import { dogfoodReadAuthToken } from './dogfood-runtime-db.endpoint.js';",
    ].join('\n'),
    'runtime DB import proof app import',
  );
  app = replaceRequired(
    app,
    'endpoints: [healthEndpoint],',
    'endpoints: [healthEndpoint, dogfoodReadAuthToken],',
    'runtime DB import proof endpoint enrollment',
  );
  writeFileSync(appPath, app, 'utf8');
}

function addQueryWireProof(root: string): void {
  const queriesPath = join(root, 'src/queries.ts');
  const queries = replaceRequired(
    readFileSync(queriesPath, 'utf8'),
    "import { query, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';",
    "import { publicAccess, query, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';",
    '/_q wire proof query import',
  );
  writeFileSync(
    queriesPath,
    `${queries}

export const qResponseProofQuery = query({
  access: publicAccess('public /_q output escaping proof'),
  load: () => ({
    attacker: '<img src=x onerror="alert(1)"><script>alert(1)</script>',
  }),
  read: { cacheControl: 'public, max-age=600' },
  reads: [],
});
`,
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const appWithQueryImport = replaceRequired(
    readFileSync(appPath, 'utf8'),
    "import { contactsQuery } from './queries.js';",
    "import { contactsQuery, qResponseProofQuery } from './queries.js';",
    '/_q wire proof app import',
  );
  const app = replaceRequired(
    appWithQueryImport,
    '  queries: [contactsQuery],',
    '  queries: [contactsQuery, qResponseProofQuery],',
    '/_q wire proof query registration',
  );
  writeFileSync(appPath, app, 'utf8');
}

function addEnhancedMutationWireProof(root: string): void {
  writeFileSync(
    join(root, 'src/enhanced-mutation-wire-proof.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      "import { domain, mutation, mutationFormAttributes, publicAccess, query, s } from '@kovojs/server';",
      '',
      "const proofAccess = publicAccess('public enhanced mutation output escaping proof');",
      "const proofDomain = domain('enhanced-mutation-wire-proof');",
      'const latestNote = \'<img src=x onerror="alert(1)"><script>alert(1)</script>\';',
      '',
      'export const enhancedMutationWireProofQuery = query({',
      '  access: proofAccess,',
      '  load: () => ({',
      '    note: latestNote,',
      '  }),',
      '  output: s.object({ note: s.string() }),',
      '  reads: [proofDomain],',
      '});',
      '',
      'export const refreshEnhancedMutationWireProof = mutation({',
      '  access: proofAccess,',
      '  input: s.object({ note: s.string() }),',
      '  registry: {',
      '    queries: [enhancedMutationWireProofQuery],',
      '    touches: [proofDomain],',
      '  },',
      '  optimistic: { [enhancedMutationWireProofQuery.key]: "await-fragment" },',
      '  handler(input, _request, context) {',
      '    context.invalidate(proofDomain);',
      '    return input;',
      '  },',
      '});',
      '',
      'export const EnhancedMutationWireProof = component({',
      '  mutations: { refreshEnhancedMutationWireProof },',
      '  queries: { proof: enhancedMutationWireProofQuery },',
      '  render: ({ proof }) => (',
      '    <main data-proof="enhanced-wire">',
      '      <p data-proof-note>{proof.note}</p>',
      '      <form {...mutationFormAttributes(refreshEnhancedMutationWireProof)}>',
      '        <input name="note" value="safe static submit value" />',
      '        <button type="submit">Refresh</button>',
      '      </form>',
      '    </main>',
      '  ),',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const appWithProofImport = replaceRequired(
    readFileSync(appPath, 'utf8'),
    "import { ContactsRegion } from './components/contacts.js';",
    [
      "import { ContactsRegion } from './components/contacts.js';",
      'import {',
      '  EnhancedMutationWireProof,',
      '  enhancedMutationWireProofQuery,',
      '  refreshEnhancedMutationWireProof,',
      "} from './enhanced-mutation-wire-proof.js';",
    ].join('\n'),
    'enhanced mutation wire proof app import',
  );
  const appWithMutation = replaceRequired(
    appWithProofImport,
    '  mutations: [addContact, appSignIn, appSignOut],',
    '  mutations: [addContact, refreshEnhancedMutationWireProof, appSignIn, appSignOut],',
    'enhanced mutation wire proof mutation registration',
  );
  const appWithQuery = replaceRequired(
    appWithMutation,
    '  queries: [contactsQuery, qResponseProofQuery],',
    '  queries: [contactsQuery, qResponseProofQuery, enhancedMutationWireProofQuery],',
    'enhanced mutation wire proof query registration',
  );
  const app = replaceRequired(
    appWithQuery,
    "    route('/', {",
    [
      "    route('/enhanced-mutation-wire-proof', {",
      "      access: publicAccess('public enhanced mutation output escaping proof'),",
      "      meta: { title: 'Enhanced mutation wire proof' },",
      '      layout: AppLayout,',
      '      stylesheets,',
      '      page() {',
      '        return <EnhancedMutationWireProof />;',
      '      },',
      '    }),',
      "    route('/', {",
    ].join('\n'),
    'enhanced mutation wire proof route',
  );
  writeFileSync(appPath, app, 'utf8');
}

function addNoAccessProvisionMutation(root: string): void {
  const mutationsPath = join(root, 'src/mutations.ts');
  const mutations = replaceRequired(
    readFileSync(mutationsPath, 'utf8'),
    'export const appMutations = [addContact];',
    [
      'export const provisionAccount = mutation({',
      '  csrf: false,',
      "  csrfJustification: 'negative access fixture uses no ambient browser authority',",
      '  input: s.object({ marker: s.string() }),',
      '  registry: { touches: [contact] },',
      '  handler(',
      '    _input: { marker: string },',
      '    _request: AppRequest,',
      '    context: MutationContext<Record<never, never>>,',
      '  ) {',
      '    context.invalidate(contact);',
      '    return { ok: true };',
      '  },',
      '});',
      '',
      'export const appMutations = [addContact, provisionAccount];',
    ].join('\n'),
    'missing-access provision mutation',
  );
  writeFileSync(mutationsPath, mutations, 'utf8');

  const appPath = join(root, 'src/app.tsx');
  const appWithMutationImport = replaceRequired(
    readFileSync(appPath, 'utf8'),
    "import { addContact } from './mutations.js';",
    "import { addContact, provisionAccount } from './mutations.js';",
    'missing-access provision mutation app import',
  );
  const app = replaceRequired(
    appWithMutationImport,
    '  mutations: [addContact, appSignIn, appSignOut],',
    '  mutations: [addContact, provisionAccount, appSignIn, appSignOut],',
    'missing-access provision mutation registration',
  );
  writeFileSync(appPath, app, 'utf8');
}

function addControlProvenanceProof(root: string): void {
  const configPath = join(root, 'kovo.config.ts');
  writeFileSync(
    configPath,
    replaceRequired(
      readFileSync(configPath, 'utf8'),
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
      'control provenance deploy-skew retention proof',
    ),
    'utf8',
  );

  writeFileSync(
    join(root, 'src/control-provenance-proof.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      "import { domain, mutation, mutationFormAttributes, publicAccess, s } from '@kovojs/server';",
      '',
      "const proofAccess = publicAccess('public dynamic spread and session transition proof');",
      "const authDomain = domain('auth');",
      'const attackerAttributes: Record<string, string | boolean> = {',
      "  'ON:LOAD': '/c/attacker-selected.client.js#run',",
      "  'aria-label': 'Public profile',",
      "  'data-kovo-module-allowlist': true,",
      "  'data-p-account-id': 'victim',",
      "  'data-profile-id': 'public-profile',",
      "  'kovo-param-types': 'accountId:string',",
      '};',
      '',
      'function CallerOwnedShell({ attributes }: { attributes: Record<string, string | boolean> }): string {',
      '  return <main data-proof="dynamic-spread" {...{ ...attributes, noop() {} }}>Caller-owned profile</main>;',
      '}',
      '',
      'export const authDomainTransition = mutation({',
      '  access: proofAccess,',
      '  csrf: false,',
      "  csrfJustification: 'public proof only invalidates cache metadata',",
      '  input: s.object({}),',
      '  handler(_input, _request, context) {',
      '    context.invalidate(authDomain);',
      "    return 'auth-domain-transition';",
      '  },',
      '});',
      '',
      'export const samePrincipalCookieRefresh = mutation({',
      '  access: proofAccess,',
      '  csrf: false,',
      "  csrfJustification: 'public proof rotates only an inert fixture cookie',",
      '  input: s.object({}),',
      '  handler(_input, _request, context) {',
      "    context.setCookie?.('proof_refresh', 'rotated', { httpOnly: true, path: '/', sameSite: 'lax' });",
      "    return 'same-principal-cookie-refresh';",
      '  },',
      '});',
      '',
      'interface ProofState { clicks: number }',
      'export const ControlProvenanceProof = component({',
      '  mutations: { authDomainTransition, samePrincipalCookieRefresh },',
      '  state: (): ProofState => ({ clicks: 0 }),',
      '  render: (_queries: Record<string, never>, state: ProofState) => (',
      '    <section>',
      '      <CallerOwnedShell attributes={attackerAttributes} />',
      '      <button onClick={() => { state.clicks += 1; }}>Declared handler</button>',
      '      <output>{state.clicks}</output>',
      '      <form data-proof="auth-domain" {...mutationFormAttributes(authDomainTransition)}>',
      '        <button type="submit">Auth domain transition</button>',
      '      </form>',
      '      <form data-proof="same-principal-cookie" {...mutationFormAttributes(samePrincipalCookieRefresh)}>',
      '        <button type="submit">Refresh cookie</button>',
      '      </form>',
      '    </section>',
      '  ),',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  app = replaceRequired(
    app,
    "import { ContactsRegion } from './components/contacts.js';",
    [
      "import { ContactsRegion } from './components/contacts.js';",
      "import { authDomainTransition, ControlProvenanceProof, samePrincipalCookieRefresh } from './control-provenance-proof.js';",
    ].join('\n'),
    'control provenance proof import',
  );
  app = replaceRequired(
    app,
    '  mutations: [addContact, appSignIn, appSignOut],',
    '  mutations: [addContact, authDomainTransition, samePrincipalCookieRefresh, appSignIn, appSignOut],',
    'control provenance mutations',
  );
  app = replaceRequired(
    app,
    "    route('/', {",
    [
      "    route('/control-provenance-proof', {",
      "      access: publicAccess('public dynamic spread and session transition proof'),",
      "      meta: { title: 'Control provenance proof' },",
      '      layout: AppLayout,',
      '      stylesheets,',
      '      page() {',
      '        return <ControlProvenanceProof />;',
      '      },',
      '    }),',
      "    route('/', {",
    ].join('\n'),
    'control provenance route',
  );
  writeFileSync(appPath, app, 'utf8');
}

function formHtmlByDataProof(html: string, value: string): string {
  const pattern = new RegExp(
    `<form\\b[^>]*data-proof="${escapeRegExp(value)}"[^>]*>[\\s\\S]*?<\\/form>`,
    'u',
  );
  const match = pattern.exec(html);
  if (!match) throw new Error(`Missing form with data-proof="${value}".`);
  return match[0];
}

function rootElementWithAttribute(html: string, name: string, value: string): string {
  const pattern = new RegExp(
    `<[A-Za-z][^>]*\\b${escapeRegExp(name)}="${escapeRegExp(value)}"[^>]*>`,
  );
  const match = pattern.exec(html);
  if (!match) throw new Error(`Missing element with ${name}="${value}" in built artifact.`);
  return match[0];
}

function requiredAttribute(tag: string, name: string): string {
  const value = attributeValue(tag, name);
  if (value === undefined) throw new Error(`Missing ${name} in ${tag}`);
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceRequired(
  source: string,
  search: string,
  replacement: string,
  label: string,
): string {
  if (!source.includes(search)) throw new Error(`Expected scaffold anchor for ${label}.`);
  return source.replace(search, replacement);
}
