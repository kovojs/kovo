import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject, type CreateKovoDialect } from './index.js';
import {
  addAuthSecretLeakProof,
  addEscapedAttackerTextProof,
  addRuntimeContractProofs,
  addRawSqlOwnerWriteProof,
  addStorageQueryWriteProof,
  addTrustedOutputProvenanceBuildProof,
  attributeValue,
  buildProductionArtifact,
  execFileSyncErrorOutput,
} from './index.build.test-support.js';
import { assertProdArtifactSinkCensus } from './index.build.prod-artifact.sink-census.js';
import {
  collectOutput,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  reservePort,
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';

describe('create-kovo starter (build integration: adversarial production artifact sweep)', () => {
  const dialectIndependentCompilerGateCases = [['postgres', undefined]] as const;
  const dialectSpecificRuntimeCases = [
    ['postgres', undefined],
    ['sqlite', 'sqlite'],
  ] as const;

  it.each([...dialectIndependentCompilerGateCases])(
    'M1:storage-write tracks storage write gates from current %s production source, not stale cache',
    (_label: string, dialect: CreateKovoDialect | undefined) => {
      withProject(`create-kovo-m1-storage-${_label}-red-`, dialect, (root) => {
        addStorageQueryWriteProof(root);
        expectStorageWriteBuildFailure(root);
      });

      withProject(`create-kovo-m1-storage-${_label}-flip-`, dialect, (root) => {
        buildProductionArtifact(root);
        addStorageQueryWriteProof(root);
        expectStorageWriteBuildFailure(root);
      });
    },
    240_000,
  );

  it.each([...dialectIndependentCompilerGateCases])(
    'M1:raw-html tracks trusted output provenance gates from current %s production source, not stale cache',
    (_label: string, dialect: CreateKovoDialect | undefined) => {
      withProject(`create-kovo-m1-trusted-output-${_label}-red-`, dialect, (root) => {
        addTrustedOutputProvenanceBuildProof(root);
        expectBuildFailure(root, [
          'KV426',
          'trustedUrl() sends query-derived data',
          'renderedHtml() sends query-derived data',
          'trustedHtml() sends request-derived data',
        ]);
      });

      withProject(`create-kovo-m1-trusted-output-${_label}-green-`, dialect, (root) => {
        addEscapedAttackerTextProof(root);
        buildProductionArtifact(root);
      });

      withProject(`create-kovo-m1-trusted-output-${_label}-flip-`, dialect, (root) => {
        buildProductionArtifact(root);
        addTrustedOutputProvenanceBuildProof(root);
        expectBuildFailure(root, [
          'KV426',
          'trustedUrl() sends query-derived data',
          'renderedHtml() sends query-derived data',
          'trustedHtml() sends request-derived data',
        ]);
      });
    },
    240_000,
  );

  it.each([...dialectIndependentCompilerGateCases])(
    'M1:secret-wire blocks secret-column-to-wire value-flow in the %s production artifact',
    (_label: string, dialect: CreateKovoDialect | undefined) => {
      withProject(`create-kovo-m1-secret-value-flow-${_label}-red-`, dialect, (root) => {
        addAuthSecretLeakProof(root);
        expectBuildFailure(root, [
          'KV435',
          'Secret query value reaches the client wire',
          'queries/auth-secret-direct-leak-query.accessToken',
          'queries/auth-secret-direct-leak-query.password',
          'queries/auth-secret-transformed-leak-query.accessToken',
          'queries/auth-secret-transformed-leak-query.password',
          'queries/auth-secret-render-leak-query.renderPassword',
          'queries/auth-secret-leak-query.accessToken',
          'queries/auth-secret-leak-query.password',
        ]);
      });

      withProject(`create-kovo-m1-secret-value-flow-${_label}-green-`, dialect, (root) => {
        addAuthSecretLeakProof(root, { leakToWire: false });
        buildProductionArtifact(root);
      });
    },
    240_000,
  );

  it.each([...dialectSpecificRuntimeCases])(
    'M1:raw-sql covers raw SQL owner-write unsafe and trusted %s production siblings',
    (_label: string, dialect: CreateKovoDialect | undefined) => {
      withProject(`create-kovo-m1-raw-sql-${_label}-red-`, dialect, (root) => {
        addRawSqlOwnerWriteProof(root);
        expectBuildFailure(root, ['KV414', 'WRITE', 'domain=raw-owner']);
      });

      withProject(`create-kovo-m1-raw-sql-${_label}-green-`, dialect, (root) => {
        addRawSqlOwnerWriteProof(root, { trusted: true });
        buildProductionArtifact(root);
      });
    },
    240_000,
  );

  it.each([...dialectIndependentCompilerGateCases])(
    'bugz-25: detached SQL helpers and composed KV429 provenance fail the %s production build',
    (_label: string, dialect: CreateKovoDialect | undefined) => {
      withProject(`create-kovo-bugz25-drizzle-${_label}-red-`, dialect, (root) => {
        addBugz25SqlAliasProof(root);
        addBugz25ToctouProof(root);
        expectBuildFailure(root, [
          'KV422',
          'sql.raw(...) receives request-derived text',
          'bugz25-sql-alias-proof.ts',
          'KV429',
          'concurrency annotation is dynamic or statically unresolved',
          'table=contacts',
          'column=company',
        ]);
      });
    },
    300_000,
  );

  it.each([...dialectSpecificRuntimeCases])(
    'M1:output-wire tracks output-wire sinks after a warmed %s prod build',
    async (_label: string, dialect: CreateKovoDialect | undefined) => {
      await withRunningProject(
        `create-kovo-m1-output-wire-${_label}-flip-`,
        dialect,
        (root) => {
          buildProductionArtifact(root);
          addRuntimeContractProofs(root);
          addEscapedAttackerTextProof(root);
          addM1DeferAndShellProof(root);
          addM1HeaderRedirectCapabilityProof(root);
          addM1ClientDeriveProof(root);
          configureNodeRetention(root);
          buildProductionArtifact(root);
          const census = assertProdArtifactSinkCensus(root, [
            {
              proof: { evidence: 'M1 adversarial no-cache Defer source flip', kind: 'proof' },
              sink: 'streaming/<Defer> chunks',
              witnesses: ['m1-defer-region', 'renderDeferredStreamingResponse', '<kovo-defer'],
            },
            {
              proof: { evidence: 'M1 adversarial no-cache error shell source flip', kind: 'proof' },
              sink: 'error shells / 500 bodies',
              witnesses: ['data-shell="m1"', 'Set-Cookie: m1=owned'],
            },
            {
              proof: {
                evidence: 'M1 adversarial no-cache response header source flip',
                kind: 'proof',
              },
              sink: 'response headers (incl. Set-Cookie, redirects)',
              witnesses: ['m1-header-unsafe', 'm1_cookie', 'redirectLocationHeaderValue'],
            },
            {
              proof: {
                evidence: 'M1 adversarial no-cache capability URL source flip',
                kind: 'proof',
              },
              sink: 'capability URLs / signed payloads',
              witnesses: ['m1-capability-download', 'verifyCapability', 'deriveDownloadKey'],
            },
            {
              proof: {
                evidence: 'M1 adversarial no-cache client derive source flip',
                kind: 'proof',
              },
              sink: 'client-derive bodies',
              witnesses: ['M1ClientDeriveProof', 'state.count', 'state.items[0]', 'state.extra'],
            },
          ]);
          expect(census.entries).toHaveLength(5);
          const clientSources = clientArtifactSources(root).join('\n');
          expect(clientSources).not.toMatch(/\b(?:countAlias|firstItem|computedValue)\b/u);
        },
        async ({ origin, output }) => {
          const html = await fetchTextWhenReady(`${origin}/xss-escape-proof`, output);
          expect(html).toContain('data-proof="xss-escape"');
          expect(html).toContain('&lt;img src=x onerror="alert(1)"&gt;');
          expect(html).not.toContain('<img src=x onerror="alert(1)">');

          const queryRead = await fetch(`${origin}/_q/runtime-contract-proofs/warning-items-query`);
          const queryBody = await queryRead.text();
          expect(queryRead.status).toBe(200);
          expect(queryRead.headers.get('cache-control')).toContain('private');
          expect(queryRead.headers.get('kovo-warn')).toBe('QUERY_LIST_LIMIT $.rows;limit=2');
          expect(queryBody).toContain(
            '<kovo-query name="runtime-contract-proofs/warning-items-query">',
          );
          expect(queryBody).toContain('"label":"item-1"');
          expect(queryBody).not.toContain('"label":"item-2"');

          await fetchTextWhenReady(`${origin}/runtime-contracts-proof`, output);
          const page = await fetch(`${origin}/runtime-contracts-proof`);
          const pageHtml = await page.text();
          expect(page.status, pageHtml).toBe(200);
          expect(pageHtml).toContain('data-proof="runtime-contracts"');
          const proofRoot = rootElementWithAttribute(pageHtml, 'data-proof', 'runtime-contracts');
          const liveTarget = requiredAttribute(proofRoot, 'kovo-fragment-target');
          const liveComponent = requiredAttribute(proofRoot, 'kovo-live-component');
          const liveToken = requiredAttribute(proofRoot, 'kovo-live-token');
          const liveDeps = requiredAttribute(proofRoot, 'kovo-deps');
          const liveProps = attributeValue(proofRoot, 'kovo-props') ?? '{}';
          const mutationRefresh = await fetch(
            `${origin}/_m/runtime-contract-proofs/refresh-warning-items`,
            {
              body: new URLSearchParams({ reason: 'm1-output-wire' }),
              headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'Kovo-Fragment': 'true',
                'Kovo-Live-Targets': `${liveTarget}#${liveComponent}@${liveToken}:${liveProps}`,
                'Kovo-Targets': `${liveTarget}=${liveDeps}`,
              },
              method: 'POST',
            },
          );
          const mutationBody = await mutationRefresh.text();
          expect(mutationRefresh.status).toBe(200);
          expect(mutationRefresh.headers.get('content-type')).toContain(
            'text/vnd.kovo.fragment+html',
          );
          expect(mutationBody).toContain('<kovo-query');
          expect(mutationBody).toContain('<kovo-fragment');
          expect(mutationBody).toContain('item-0,item-1');
          expect(mutationBody).not.toContain('item-2');

          await fetchTextWhenReady(`${origin}/m1/defer`, output);
          const defer = await fetch(`${origin}/m1/defer`);
          const deferBody = await defer.text();
          expect(defer.status, deferBody).toBe(200);
          expect(deferBody).toContain(
            '<kovo-defer target="m1-defer-region" state="pending" data-kovo-region-priority="after-paint"><section>Loading &lt;img src=x onerror=alert(1)&gt;</section></kovo-defer>',
          );
          expect(deferBody).toContain(
            '<kovo-defer target="m1-defer-region" state="error" data-kovo-region-priority="after-paint"><section>Loading &lt;img src=x onerror=alert(1)&gt;</section></kovo-defer>',
          );
          expect(deferBody).not.toContain('<img src=x onerror=alert(1)>');
          expect(deferBody).not.toContain('private m1 defer detail');

          const shell = await fetch(
            `${origin}/m1/error-shell?payload=${encodeURIComponent('<script>owned()</script>')}`,
          );
          const shellBody = await shell.text();
          expect(shell.status, shellBody).toBe(500);
          expect(shellBody).toContain('&lt;main data-shell="m1"&gt;');
          expect(shellBody).toContain('&lt;script&gt;owned()&lt;/script&gt;');
          expect(shellBody).not.toContain('<script>owned()</script>');
          expect(shellBody).not.toContain('private m1 route detail');

          await fetchTextWhenReady(`${origin}/m1/header-safe.txt`, output);
          const safe = await fetch(`${origin}/m1/header-safe.txt`);
          await expect(safe.text()).resolves.toBe('m1 safe\n');
          expect(safe.headers.get('x-m1-proof')).toBe('safe');

          const unsafe = await fetch(`${origin}/m1/header-unsafe.txt`);
          const unsafeBody = await unsafe.text();
          expect(unsafe.status, unsafeBody).toBe(500);
          expect(unsafe.headers.get('x-m1-proof')).toBeNull();
          expect(unsafe.headers.getSetCookie()).toEqual([]);

          const cookie = await fetch(`${origin}/_m/m1/header-cookie-proof`, {
            body: new URLSearchParams({ 'Kovo-Idem': `m1-cookie-${Date.now()}`, mode: 'safe' }),
            headers: {
              'Kovo-Fragment': 'true',
              'content-type': 'application/x-www-form-urlencoded',
            },
            method: 'POST',
          });
          await cookie.text();
          expect(cookie.status).toBe(200);
          expect(cookie.headers.getSetCookie()).toEqual([
            expect.stringContaining('m1_cookie=safe'),
          ]);

          const unsafeCookie = await fetch(`${origin}/_m/m1/header-cookie-proof`, {
            body: new URLSearchParams({
              'Kovo-Idem': `m1-unsafe-cookie-${Date.now()}`,
              mode: 'unsafe',
            }),
            headers: {
              'Kovo-Fragment': 'true',
              'content-type': 'application/x-www-form-urlencoded',
            },
            method: 'POST',
          });
          await unsafeCookie.text();
          expect(unsafeCookie.status).toBe(500);
          expect(unsafeCookie.headers.getSetCookie()).toEqual([]);

          const redirect = await fetch(`${origin}/m1/redirect`, { redirect: 'manual' });
          expect(redirect.status).toBe(303);
          expect(redirect.headers.get('location')).toBe('/');
          expect(redirect.headers.getSetCookie()).toEqual([]);

          const capabilityPage = await fetch(`${origin}/m1/capability-url`);
          const href = (await capabilityPage.text()).match(
            /<a\b[^>]*id="m1-capability-link"[^>]*href="([^"]+)"/,
          )?.[1];
          expect(href).toMatch(/^\/m1-capability-download\/receipts\/m1\.txt\?kovo-cap=/u);
          if (!href) throw new Error('Expected M1 capability href.');
          const download = await fetch(`${origin}${href}`);
          await expect(download.text()).resolves.toBe('m1 capability secret\n');
          expect(download.status).toBe(200);
          const tampered = await fetch(
            `${origin}${href.replace('/receipts/m1.txt?', '/receipts/not-m1.txt?')}`,
          );
          await expect(tampered.text()).resolves.toBe('Not Found');
          expect(tampered.status).toBe(404);
        },
      );
    },
    300_000,
  );
});

function withProject(
  prefix: string,
  dialect: CreateKovoDialect | undefined,
  run: (root: string) => void,
): void {
  const tempParent = tmpdir();
  mkdirSync(tempParent, { recursive: true });
  const root = mkdtempSync(join(tempParent, prefix));

  try {
    writeKovoProject(root, {
      ...(dialect === undefined ? {} : { dialect }),
      name: 'M1 Adversarial Production Artifact Proof',
    });
    linkStarterBuildDependencies(root);
    run(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function expectBuildFailure(root: string, expectedOutput: readonly string[]): void {
  try {
    buildProductionArtifact(root);
    throw new Error(`Expected production build to fail with ${expectedOutput.join(', ')}.`);
  } catch (error) {
    const output = execFileSyncErrorOutput(error);
    for (const expected of expectedOutput) {
      expect(output).toContain(expected);
    }
  }
}

function expectStorageWriteBuildFailure(root: string): void {
  expectBuildFailure(root, [
    'KV433',
    'storage-put-write-query',
    'storage-delete-write-query',
    'storage-computed-write-query',
    'storage-file-store-write-query',
    'storage-upload-write-query',
    'operation=put',
    'operation=delete',
    'operation=store',
    'operation=upload',
  ]);
}

function addBugz25SqlAliasProof(root: string): void {
  writeFileSync(
    join(root, 'src/bugz25-sql-alias-proof.ts'),
    [
      "import { sql } from '@kovojs/drizzle';",
      '',
      "import type { AppDb } from './db.js';",
      "import { contacts } from './schema.js';",
      '',
      'export async function bugz25SqlAliasProof(input: { sort: string }, db: AppDb) {',
      '  let dangerous: typeof sql.raw;',
      '  ({ raw: dangerous } = sql);',
      '  return db.select().from(contacts).orderBy(dangerous(input.sort));',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
}

function addBugz25ToctouProof(root: string): void {
  const schemaPath = join(root, 'src/schema.ts');
  const schema = readFileSync(schemaPath, 'utf8')
    .replace(
      "import { contact } from './model.js';",
      [
        "import { contact } from './model.js';",
        '',
        'const contactAtomic = (table: Record<string, unknown>) => table.company;',
        'const contactConcurrency = { atomic: contactAtomic } as const;',
        "const mutableConcurrency: { atomic: 'stock' | 'price' } = { atomic: 'stock' };",
        "mutableConcurrency.atomic = 'price';",
      ].join('\n'),
    )
    .replace(
      '    key: (table) => table.id,',
      ['    key: (table) => table.id,', '    ...contactConcurrency,'].join('\n'),
    );
  const mutableTable = [
    '',
    'export const bugz25MutableConcurrency = pgTable(',
    "  'bugz25_mutable_concurrency',",
    '  { id: text("id").primaryKey(), stock: text("stock"), price: text("price") },',
    '  kovo({ domain: "bugz25-mutable", key: "id", ...mutableConcurrency }),',
    ');',
    '',
  ].join('\n');
  writeFileSync(schemaPath, `${schema}${mutableTable}`, 'utf8');

  writeFileSync(
    join(root, 'src/bugz25-toctou-proof.ts'),
    [
      "import { eq } from 'drizzle-orm';",
      '',
      "import type { AppDb } from './db.js';",
      "import { contacts } from './schema.js';",
      '',
      'export async function bugz25ToctouProof(',
      '  input: { id: string; suffix: string },',
      '  db: AppDb,',
      ') {',
      '  let row: { company: string } | undefined;',
      '  [row] = await db',
      '    .select({ company: contacts.company })',
      '    .from(contacts)',
      '    .where(eq(contacts.id, input.id));',
      '  if (!row) return;',
      '  let observed = "";',
      '  ({ company: observed } = row);',
      '  const nextCompany = observed + input.suffix;',
      '  await db',
      '    .update(contacts)',
      '    .set({ company: nextCompany })',
      '    .where(eq(contacts.id, input.id));',
      '}',
      '',
      'export async function bugz25MemberToctouProof(',
      '  input: { id: string; suffix: string },',
      '  db: AppDb,',
      ') {',
      '  const [row] = await db',
      '    .select({ company: contacts.company })',
      '    .from(contacts)',
      '    .where(eq(contacts.id, input.id));',
      '  if (!row) return;',
      '  const state = { next: "" };',
      '  state.next = row.company + input.suffix;',
      '  await db.update(contacts).set({ company: state.next }).where(eq(contacts.id, input.id));',
      '}',
      '',
      'export async function bugz25CompoundToctouProof(',
      '  input: { id: string; suffix: string },',
      '  db: AppDb,',
      ') {',
      '  const [row] = await db',
      '    .select({ company: contacts.company })',
      '    .from(contacts)',
      '    .where(eq(contacts.id, input.id));',
      '  if (!row) return;',
      '  let nextCompany = "";',
      '  nextCompany += row.company + input.suffix;',
      '  await db.update(contacts).set({ company: nextCompany }).where(eq(contacts.id, input.id));',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
}

async function withRunningProject(
  prefix: string,
  dialect: CreateKovoDialect | undefined,
  prepare: (root: string) => void,
  run: (context: { origin: string; output: () => string; root: string }) => Promise<void>,
): Promise<void> {
  const tempParent = tmpdir();
  mkdirSync(tempParent, { recursive: true });
  const root = mkdtempSync(join(tempParent, prefix));
  const port = await reservePort();
  let server: ChildProcessWithoutNullStreams | undefined;

  try {
    writeKovoProject(root, {
      ...(dialect === undefined ? {} : { dialect }),
      name: 'M1 Adversarial Output Wire Proof',
    });
    linkStarterBuildDependencies(root);
    prepare(root);
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
    await run({ origin: `http://127.0.0.1:${port}`, output, root });
  } finally {
    await stopProcess(server);
    rmSync(root, { force: true, recursive: true });
  }
}

function addM1DeferAndShellProof(root: string): void {
  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8')
    .replace('  createRequestHandler,', '  createRequestHandler,\n  Defer,')
    .replace(
      '  endpoints: [healthEndpoint],',
      [
        '  endpoints: [healthEndpoint],',
        '  errorShells: {',
        '    serverError({ request, status }) {',
        '      const payload = new URL(request.url).searchParams.get("payload") ?? "";',
        '      return {',
        '        body: `<main data-shell="m1">${payload} Set-Cookie: m1=owned</main>`,',
        '        headers: { "Content-Type": "text/html; charset=utf-8" },',
        '        status,',
        '      };',
        '    },',
        '  },',
      ].join('\n'),
    )
    .replace(
      "    route('/', {",
      [
        "    route('/m1/defer', {",
        "      access: publicAccess('public M1 Defer sink proof'),",
        '      layout: AppLayout,',
        '      stylesheets,',
        '      page() {',
        "        const unsafe = '<img src=x onerror=alert(1)>';",
        '        return (',
        '          <main>',
        '            <Defer',
        '              fallback={<section>Loading {unsafe}</section>}',
        '              priority="after-paint"',
        '              render={async () => {',
        '                throw new Error(`private m1 defer detail ${unsafe}`);',
        '              }}',
        '              target="m1-defer-region"',
        '            />',
        '          </main>',
        '        );',
        '      },',
        '    }),',
        "    route('/m1/error-shell', {",
        "      access: publicAccess('public M1 error shell proof'),",
        '      layout: AppLayout,',
        '      page() {',
        "        throw new Error('private m1 route detail <script>boom</script>');",
        '      },',
        '    }),',
        "    route('/', {",
      ].join('\n'),
    );
  writeFileSync(appPath, app, 'utf8');
}

function addM1HeaderRedirectCapabilityProof(root: string): void {
  writeFileSync(
    join(root, 'src/m1-header-proof.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { mutation, publicAccess, s } from '@kovojs/server';",
      '',
      'export const m1HeaderCookieProof = mutation({',
      "  access: publicAccess('public M1 Set-Cookie proof'),",
      '  csrf: false,',
      '  input: s.object({ mode: s.string() }),',
      '  handler(input, _request, context) {',
      "    const value = input.mode === 'unsafe' ? 'bad\\r\\nSet-Cookie: m1=owned' : 'safe';",
      "    context.setCookie?.('m1_cookie', value, { class: 'app-data', path: '/', sameSite: 'lax' });",
      '    return { ok: true };',
      '  },',
      '});',
      "m1HeaderCookieProof.key = 'm1/header-cookie-proof';",
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8')
    .replace(
      '  createApp,\n  createMemoryMutationReplayStore,\n  createMemoryVersionedClientModuleRegistry,',
      [
        '  createApp,',
        '  createMemoryMutationReplayStore,',
        '  createMemoryStorage,',
        '  createMemoryVersionedClientModuleRegistry,',
        '  createStorageDownloadEndpoint,',
      ].join('\n'),
    )
    .replace('  redirect,\n  route,', '  redirect,\n  respond,\n  route,')
    .replace(
      "import { addContact } from './mutations.js';",
      [
        "import { addContact } from './mutations.js';",
        "import { m1HeaderCookieProof } from './m1-header-proof.js';",
      ].join('\n'),
    )
    .replace(
      'const mutationReplayStore = createMemoryMutationReplayStore();',
      [
        'const mutationReplayStore = createMemoryMutationReplayStore();',
        'const m1CapabilityStorage = createMemoryStorage();',
        "await m1CapabilityStorage.put('receipts/m1.txt', 'm1 capability secret\\n', {",
        "  contentType: 'text/plain',",
        "  metadata: { filename: 'm1.txt' },",
        '});',
        'const m1CapabilityEndpoint = createStorageDownloadEndpoint({',
        "  basePath: '/m1-capability-download',",
        '  secret: appCsrf.secret,',
        '  storage: m1CapabilityStorage,',
        '});',
      ].join('\n'),
    )
    .replace(
      '  endpoints: [healthEndpoint],',
      '  endpoints: [healthEndpoint, m1CapabilityEndpoint],',
    )
    .replace('  mutations: [addContact,', '  mutations: [addContact, m1HeaderCookieProof,')
    .replace(
      "    route('/', {",
      [
        "    route('/m1/header-safe.txt', {",
        "      access: publicAccess('public M1 header sink proof'),",
        '      page() {',
        "        return respond.file('m1 safe\\n', { contentType: 'text/plain', headers: { 'X-M1-Proof': 'safe' } });",
        '      },',
        '    }),',
        "    route('/m1/header-unsafe.txt', {",
        "      access: publicAccess('public M1 header sink proof'),",
        '      page() {',
        "        return respond.file('m1 unsafe\\n', { contentType: 'text/plain', headers: { 'X-M1-Proof': 'm1-header-unsafe\\r\\nSet-Cookie: m1=owned' } });",
        '      },',
        '    }),',
        "    route('/m1/redirect', {",
        "      access: publicAccess('public M1 redirect sink proof'),",
        '      page() {',
        "        return { location: 'https://evil.example/m1\\r\\nSet-Cookie: m1=owned', status: 303 };",
        '      },',
        '    }),',
        "    route('/m1/capability-url', {",
        "      access: publicAccess('public M1 capability URL proof'),",
        '      async page(context) {',
        "        if (!context.signUrl) throw new Error('missing M1 signUrl');",
        "        const signed = await context.signUrl({ key: 'receipts/m1.txt', expiresIn: 60_000 });",
        '        return <main><a id="m1-capability-link" href={signed.url}>M1 capability</a></main>;',
        '      },',
        '    }),',
        "    route('/', {",
      ].join('\n'),
    );
  writeFileSync(appPath, app, 'utf8');
}

function addM1ClientDeriveProof(root: string): void {
  writeFileSync(
    join(root, 'src/m1-client-derive-proof.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      '',
      'export const M1ClientDeriveProof = component({',
      "  state: () => ({ count: 1, extra: { key: 'value' }, items: ['first'] }),",
      '  render: (_queries, state) => {',
      '    const { count: countAlias } = state;',
      '    const [firstItem] = state.items;',
      '    const { extra: { ["key"]: computedValue } } = state;',
      '    return (',
      '      <m1-client-derive-proof>',
      '        <output>{countAlias}</output>',
      '        <output>{firstItem}</output>',
      '        <output>{computedValue}</output>',
      '      </m1-client-derive-proof>',
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
        "import { M1ClientDeriveProof } from './m1-client-derive-proof.js';",
      ].join('\n'),
    )
    .replace(
      "    route('/', {",
      [
        "    route('/m1/client-derive', {",
        "      access: publicAccess('public M1 client derive proof'),",
        '      layout: AppLayout,',
        '      stylesheets,',
        '      page() {',
        '        return <M1ClientDeriveProof />;',
        '      },',
        '    }),',
        "    route('/', {",
      ].join('\n'),
    );
  writeFileSync(appPath, app, 'utf8');
}

function clientArtifactSources(root: string): readonly string[] {
  const clientRoot = join(root, 'dist/client');
  if (!existsSync(clientRoot)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        visit(path);
        continue;
      }
      if (entry.endsWith('.js')) files.push(readFileSync(path, 'utf8'));
    }
  };
  visit(clientRoot);
  return files;
}

function configureNodeRetention(root: string): void {
  const configPath = join(root, 'kovo.config.ts');
  const source = readFileSync(configPath, 'utf8');
  if (!source.includes('preset: node(),')) {
    throw new Error('Expected node preset anchor for M1 client derive retention proof.');
  }
  writeFileSync(
    configPath,
    source.replace(
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
