import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

describe('create-kovo starter (build integration: production security artifacts)', () => {
  // @kovo-security-certifies KV435 local-helper-credential-laundering
  // @kovo-security-certifies KV435 direct-secret-projection-to-query-wire
  // @kovo-security-certifies KV435 transformed-query-loader-return-laundering
  // @kovo-security-certifies KV435 render-value-flow-laundering
  // @kovo-security-certifies KV435 cross-select-laundering
  // @kovo-security-certifies KV435 value-flow-sibling-laundering
  it('blocks local-helper Better Auth credential laundering from the production build artifact', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const unsafeRoot = mkdtempSync(join(tempParent, 'create-kovo-prod-auth-secret-unsafe-'));
    const safeRoot = mkdtempSync(join(tempParent, 'create-kovo-prod-auth-secret-safe-'));

    try {
      writeKovoProject(unsafeRoot, { name: 'Prod Auth Secret Proof' });
      linkStarterBuildDependencies(unsafeRoot);
      addAuthSecretLeakProof(unsafeRoot);

      try {
        buildProductionArtifact(unsafeRoot);
        throw new Error('Expected kovo build --no-cache to fail with KV435.');
      } catch (error) {
        const output = execFileSyncErrorOutput(error);
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
      }

      writeKovoProject(safeRoot, { name: 'Prod Auth Secret Safe Sibling' });
      linkStarterBuildDependencies(safeRoot);
      addAuthSecretLeakProof(safeRoot, { leakToWire: false });
      buildReusableProductionArtifact(safeRoot);
    } finally {
      rmSync(unsafeRoot, { force: true, recursive: true });
      rmSync(safeRoot, { force: true, recursive: true });
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
          NODE_ENV: 'production',
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
      expect(output()).toMatch(/KV435|permission denied for view/u);
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
      expect(proofQueries).toContain('classified: runtimeSecretProof.classified');
      expect(proofQueries).toContain('leaked: runtimeSecretFunctionProof.functionClassified');
      expect(proofQueries).toContain('runtimeSecretWholeProof.label');
      expect(proofQueries).toContain('classified as leaked from "runtime_secret_proof"');
      expect(proofQueries).toContain('opaque raw SQL parse-fail secret boundary proof');
      expect(proofQueries).toContain('runtimeSecretDefaultRawRefusalQuery');
      expect(proofQueries).toContain('default reader raw secret-column refusal proof');
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
          NODE_ENV: 'production',
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
      addStarterMutationDbScopeProof(root);

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
      const marker = `starter-scope-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const contactEmail = `${marker}-contact@example.com`;

      await signInDemoUser(root, origin, jar, output);

      const homeHtml = await fetchTextWhenReady(`${origin}/`, output, {
        headers: { cookie: cookieHeader(jar) },
      });
      const addForm = formHtmlByAction(homeHtml, '/_m/mutations/add-contact');
      const addContact = await fetch(`${origin}/_m/mutations/add-contact`, {
        body: new URLSearchParams({
          company: 'Scope Proof',
          csrf: fieldValue(addForm, 'csrf'),
          email: contactEmail,
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
        'starter-db-scope/auth-user-table-write',
        'starter-db-scope/auth-session-table-write',
        'starter-db-scope/raw-auth-table-write',
        'starter-db-scope/absent-tables-contact-write',
      ] as const;
      for (const key of blockedMutations) {
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
      }

      const statusResponse = await fetch(
        `${origin}/api/starter-db-scope-proof?marker=${encodeURIComponent(
          marker,
        )}&contactEmail=${encodeURIComponent(contactEmail)}`,
      );
      const statusBody = await statusResponse.text();
      expect(statusResponse.status, statusBody).toBe(200);
      const status = JSON.parse(statusBody) as {
        absentContactRows: number;
        authSessionRows: number;
        authUserRows: number;
        contactRows: number;
        rawAuthUserRows: number;
      };

      expect(status).toEqual({
        absentContactRows: 0,
        authSessionRows: 0,
        authUserRows: 0,
        contactRows: 1,
        rawAuthUserRows: 0,
      });
      expect(output()).toContain('KV406');
      expect(output()).toContain('declared mutation registry tables');
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
      expect(proofQueries).toContain('runtimeSecretViewProof.exposed');
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
          NODE_ENV: 'production',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;

      await signInDemoUser(root, origin, jar, output);
      for (const key of [
        'sqlite-secret-alias-egress',
        'sqlite-secret-view-egress',
        'sqlite-secret-derivation-egress',
        'sqlite-secret-join-alias-egress',
        'sqlite-secret-cte-egress',
        'sqlite-secret-mixed-chunk-egress',
        'sqlite-secret-mixed-chunk-builder-egress',
      ]) {
        const response = await fetch(`${origin}/_q/${key}`, {
          headers: { cookie: cookieHeader(jar) },
        });
        const body = await response.text();

        expect(response.status, `${key}: ${body}`).toBe(500);
        expect(body).toMatch(/^\{"code":"(?:KV410|SERVER_ERROR)","payload":\{\}\}$/u);
        expect(body).not.toContain('runtime-secret-value');
      }
      const publicProjectionResponse = await fetch(
        `${origin}/_q/sqlite-secret-nonsecret-projection`,
        {
          headers: { cookie: cookieHeader(jar) },
        },
      );
      const publicProjectionBody = await publicProjectionResponse.text();

      expect(publicProjectionResponse.status, publicProjectionBody).toBe(200);
      expect(publicProjectionBody).toContain(
        '<kovo-query name="sqlite-secret-nonsecret-projection"',
      );
      expect(publicProjectionBody).toContain('public label');
      expect(publicProjectionBody).not.toContain('runtime-secret-value');

      const revealResponse = await fetch(`${origin}/_q/sqlite-secret-reveal`, {
        headers: { cookie: cookieHeader(jar) },
      });
      const revealBody = await revealResponse.text();

      expect(revealResponse.status, revealBody).toBe(200);
      expect(revealBody).toContain('<kovo-query name="sqlite-secret-reveal"');
      expect(revealBody).toContain('runtime-secret-value:revealed');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 240_000);

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

  // @kovo-security-certifies KV433 storage-query-write-prod-artifact
  it('blocks storage writes from query loaders in the production build artifact', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-storage-query-write-'));

    try {
      writeKovoProject(root, { name: 'Prod Storage Query Write Proof' });
      linkStarterBuildDependencies(root);
      addStorageQueryWriteProof(root);

      try {
        buildProductionArtifact(root);
        throw new Error('Expected kovo build --no-cache to fail with KV433.');
      } catch (error) {
        const output = execFileSyncErrorOutput(error);
        expect(output).toContain('KV433');
        expect(output).toContain('storage-put-write-query');
        expect(output).toContain('storage-delete-write-query');
        expect(output).toContain('storage-computed-write-query');
        expect(output).toContain('storage-file-store-write-query');
        expect(output).toContain('storage-upload-write-query');
        expect(output).toContain('operation=put');
        expect(output).toContain('operation=delete');
        expect(output).toContain('operation=store');
        expect(output).toContain('operation=upload');
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('serves declared mutation storage writes through the production artifact', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-storage-mutation-write-'));
    const port = await reservePort();
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
          NODE_ENV: 'production',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;

      const initial = await fetchTextWhenReady(`${origin}/storage-mutation-proof`, output);
      expect(initial).toContain('<p id="storage-put">missing</p>');
      expect(initial).toContain('<p id="storage-delete">present</p>');

      const put = await fetch(`${origin}/_m/storage-mutation-proof/storage-mutation-write`, {
        body: new URLSearchParams({ mode: 'put' }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'Kovo-Fragment': 'true',
        },
        method: 'POST',
      });
      await put.text();
      expect(put.status).toBe(200);
      const afterPut = await fetch(`${origin}/storage-mutation-proof`);
      await expect(afterPut.text()).resolves.toContain('<p id="storage-put">present</p>');

      const deleteResponse = await fetch(
        `${origin}/_m/storage-mutation-proof/storage-mutation-write`,
        {
          body: new URLSearchParams({ mode: 'delete' }),
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'Kovo-Fragment': 'true',
          },
          method: 'POST',
        },
      );
      await deleteResponse.text();
      expect(deleteResponse.status).toBe(200);
      const afterDelete = await fetch(`${origin}/storage-mutation-proof`);
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

      try {
        buildProductionArtifact(unsafeRoot);
        throw new Error('Expected kovo build --no-cache to fail with KV426.');
      } catch (error) {
        const output = execFileSyncErrorOutput(error);
        expect(output).toContain('KV426');
        expect(output).toContain('trustedUrl() sends query-derived data');
        expect(output).toContain('renderedHtml() sends query-derived data');
        expect(output).toContain('trustedHtml() sends request-derived data');
      }

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

      try {
        buildProductionArtifact(root);
        throw new Error('Expected kovo build --no-cache to fail on TrustedUrl attribute typing.');
      } catch (error) {
        const output = execFileSyncErrorOutput(error);
        expect(output).toContain('TrustedUrl');
        expect(output).toContain('AttributeValue');
      }
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
            NODE_ENV: 'production',
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
  const pageHtml = await fetchTextWhenReady(`${origin}/enhanced-mutation-wire-proof`, output);
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
      note: '<img src=x onerror="alert(1)"><script>alert(1)</script>',
    }),
    headers: {
      accept: 'text/vnd.kovo.fragment+html',
      'content-type': 'application/x-www-form-urlencoded',
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

function addQueryWireProof(root: string): void {
  const queriesPath = join(root, 'src/queries.ts');
  const queries = replaceRequired(
    readFileSync(queriesPath, 'utf8'),
    "import { query, type QueryLoadContext, type Reader } from '@kovojs/server';",
    "import { publicAccess, query, type QueryLoadContext, type Reader } from '@kovojs/server';",
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
      '  csrf: false,',
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
