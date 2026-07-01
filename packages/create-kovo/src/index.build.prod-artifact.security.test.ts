import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
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
  addStorageQueryWriteProof,
  addTrustedOutputProvenanceBuildProof,
  addTrustedUrlAttributeTypeGateProof,
  attributeValue,
  buildProductionArtifact,
  execFileSyncErrorOutput,
  fieldValue,
  firstFormHtml,
} from './index.build.test-support.js';

describe('create-kovo starter (build integration: production security artifacts)', () => {
  // @kovo-security-certifies KV435 local-helper-credential-laundering
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
      }

      writeKovoProject(safeRoot, { name: 'Prod Auth Secret Safe Sibling' });
      linkStarterBuildDependencies(safeRoot);
      addAuthSecretLeakProof(safeRoot, { leakToWire: false });
      buildProductionArtifact(safeRoot);
    } finally {
      rmSync(unsafeRoot, { force: true, recursive: true });
      rmSync(safeRoot, { force: true, recursive: true });
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
        expect(output).toContain('storage-computed-write-query');
        expect(output).toContain('storage-file-store-write-query');
        expect(output).toContain('storage-upload-write-query');
        expect(output).toContain('operation=put');
        expect(output).toContain('operation=store');
        expect(output).toContain('operation=upload');
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

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
      buildProductionArtifact(safeRoot);
    } finally {
      rmSync(unsafeRoot, { force: true, recursive: true });
      rmSync(safeRoot, { force: true, recursive: true });
    }
  }, 120_000);

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
