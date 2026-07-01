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
  addStorageMutationWriteProof,
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
        expect(output).toContain('queries/auth-secret-direct-leak-query.accessToken');
        expect(output).toContain('queries/auth-secret-transformed-leak-query.password');
        expect(output).toContain('queries/auth-secret-render-leak-query.renderPassword');
        expect(output).toContain('queries/auth-secret-leak-query.accessToken');
      }

      writeKovoProject(safeRoot, { name: 'Prod Auth Secret Safe Sibling' });
      linkStarterBuildDependencies(safeRoot);
      addAuthSecretLeakProof(safeRoot, { leakToWire: false });
      buildProductionArtifact(safeRoot);
    } finally {
      rmSync(unsafeRoot, { force: true, recursive: true });
      rmSync(safeRoot, { force: true, recursive: true });
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
      buildProductionArtifact(safeRoot);
    } finally {
      rmSync(unsafeRoot, { force: true, recursive: true });
      rmSync(safeRoot, { force: true, recursive: true });
    }
  }, 240_000);

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

  it('serves enhanced mutation fragments and query refreshes escaped from production artifacts', async () => {
    for (const dialect of ['postgres', 'sqlite'] as const) {
      const tempParent = tmpdir();
      mkdirSync(tempParent, { recursive: true });
      const root = mkdtempSync(join(tempParent, `create-kovo-prod-enhanced-wire-${dialect}-`));
      const port = await reservePort();
      let server: ChildProcessWithoutNullStreams | undefined;

      try {
        writeKovoProject(root, { dialect, name: `Prod Enhanced Wire Proof ${dialect}` });
        linkStarterBuildDependencies(root);
        addEnhancedMutationWireProof(root);

        buildProductionArtifact(root);
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
      } finally {
        await stopProcess(server);
        rmSync(root, { force: true, recursive: true });
      }
    }
  }, 240_000);

  it('serves /_q query wire bodies escaped and private from production artifacts', async () => {
    for (const dialect of ['postgres', 'sqlite'] as const) {
      const tempParent = tmpdir();
      mkdirSync(tempParent, { recursive: true });
      const root = mkdtempSync(join(tempParent, `create-kovo-prod-query-wire-${dialect}-`));
      const port = await reservePort();
      let server: ChildProcessWithoutNullStreams | undefined;

      try {
        writeKovoProject(root, { dialect, name: `Prod Query Wire Proof ${dialect}` });
        linkStarterBuildDependencies(root);
        addQueryWireProof(root);

        buildProductionArtifact(root);
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
        const queryKey = 'queries/q-response-proof-query';
        expect(JSON.stringify(readProductionGraph(root))).toContain(queryKey);

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

        await fetchTextWhenReady(`${origin}/_q/${encodeURIComponent(queryKey)}`, output);
        const response = await fetch(`${origin}/_q/${encodeURIComponent(queryKey)}`);
        const body = await response.text();

        expect(response.status, body).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('vary')).toContain('Cookie');
        expect(body).toContain(`<kovo-query name="${queryKey}">`);
        expect(body).toContain('&lt;img src=x onerror=\\"alert(1)\\"&gt;');
        expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(body).not.toContain('<img src=x onerror="alert(1)">');
        expect(body).not.toContain('<script>alert(1)</script>');
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
    '  queries: [contactsQuery],',
    '  queries: [contactsQuery, enhancedMutationWireProofQuery],',
    'enhanced mutation wire proof query registration',
  );
  const app = replaceRequired(
    appWithQuery,
    "  routes: [\n    route('/', {",
    [
      '  routes: [',
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
