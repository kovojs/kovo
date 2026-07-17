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
  addOpaqueStorageQueryWriteProof,
  addOpaqueAuthSecretLeakProof,
  addOpaqueTrustedOutputAuthorityProof,
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
  cookieHeader,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  mergeCookies,
  reservePort,
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';

const BUGZ31_GLOBAL_MEMBER_CARRIER_PROOFS = [
  'ordinary-carriers',
  'projection-carriers',
  'array-result-carriers',
  'iterable-binding-carriers',
  'assignment-targets',
  'loop-and-exhaustion-targets',
] as const;

type Bugz31GlobalMemberCarrierProof = (typeof BUGZ31_GLOBAL_MEMBER_CARRIER_PROOFS)[number];

describe('create-kovo starter (build integration: adversarial production artifact sweep)', () => {
  const multiBuildProofTimeout = 480_000;
  const dialectIndependentCompilerGateCases = [['postgres', undefined]] as const;
  const dialectSpecificRuntimeCases = [
    ['postgres', undefined],
    ['sqlite', 'sqlite'],
  ] as const;

  it('fails the diagnostic assertion when an unchanged production build succeeds', () => {
    withProject('create-kovo-m1-build-failure-helper-green-', undefined, (root) => {
      expect(() => expectBuildFailure(root, ['KV999_SENTINEL_MUST_NOT_SELF_SATISFY'])).toThrowError(
        'Expected production build to fail, but it succeeded.',
      );
    });
  }, 240_000);

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
    multiBuildProofTimeout,
  );

  it.each([...dialectIndependentCompilerGateCases])(
    'M1:storage-write keeps opaque storage authority on the %s KV424 path',
    (_label: string, dialect: CreateKovoDialect | undefined) => {
      withProject(`create-kovo-m1-storage-${_label}-opaque-`, dialect, (root) => {
        addOpaqueStorageQueryWriteProof(root);
        const output = expectBuildFailure(root, [
          'KV424',
          'source=opaqueStorageWriteProbe.put.bind',
          'source=storage[method]!',
          'source=opaqueUploadStorageWriteProbe.upload',
        ]);
        expect(output).not.toContain('source=createMemoryStorage');
        expect(output).not.toContain('source=s.file().store');
        expect(output).not.toContain('source=schema.parseAsync');
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
          'trustedHtml() sends request-derived data',
        ]);
      });
    },
    multiBuildProofTimeout,
  );

  it.each([...dialectIndependentCompilerGateCases])(
    'M1:raw-html keeps opaque trusted output authority on the %s KV424 path',
    (_label: string, dialect: CreateKovoDialect | undefined) => {
      withProject(`create-kovo-m1-trusted-output-${_label}-opaque-`, dialect, (root) => {
        addOpaqueTrustedOutputAuthorityProof(root);
        expectBuildFailure(root, [
          'KV424',
          'source=browserTrust[dynamicTrustedUrlKey]',
          'source=browserTrust[dynamicTrustedHtmlKey]',
          'source=<unresolved-mutable-factory-provenance>',
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
          'query="secrets0" path="secrets0.accessToken"',
          'query="secrets0" path="secrets0.password"',
          'query="secrets1" path="secrets1.accessToken"',
          'query="secrets1" path="secrets1.password"',
          'query="secrets2" path="secrets2.renderPassword"',
        ]);
      });

      withProject(`create-kovo-m1-secret-value-flow-${_label}-green-`, dialect, (root) => {
        addAuthSecretLeakProof(root, { leakToWire: false });
        buildProductionArtifact(root);
      });
    },
    multiBuildProofTimeout,
  );

  it.each([...dialectIndependentCompilerGateCases])(
    'M1:secret-wire keeps opaque credential laundering on the %s KV424 path',
    (_label: string, dialect: CreateKovoDialect | undefined) => {
      withProject(`create-kovo-m1-secret-value-flow-${_label}-opaque-`, dialect, (root) => {
        addOpaqueAuthSecretLeakProof(root);
        expectBuildFailure(root, [
          'KV424',
          'source=<property-setter:touchAuth>',
          'source=createRequestHandler',
          'source=secretById.set',
          'sink=client-wire.request.opaque-value',
        ]);
      });
    },
    240_000,
  );

  it('M1:secret-wire fixture fails closed when the scaffold query helper anchor drifts', () => {
    withProject('create-kovo-m1-secret-value-flow-drift-', undefined, (root) => {
      const queriesPath = join(root, 'src/queries.ts');
      const queries = readFileSync(queriesPath, 'utf8').replace(
        'function requireAppQueryDb(context?: AppQueryLoadContext): Reader<AppDb> {',
        'function renamedAppQueryDb(context?: AppQueryLoadContext): Reader<AppDb> {',
      );
      writeFileSync(queriesPath, queries, 'utf8');

      expect(() => addAuthSecretLeakProof(root)).toThrowError(
        'Expected scaffold anchor for auth secret proof query insertion.',
      );
    });
  });

  it('M1:output-wire fixtures use canonical safe authored shapes', () => {
    withProject('create-kovo-m1-output-wire-authored-shapes-', undefined, (root) => {
      addRuntimeContractProofs(root);
      addM1HeaderRedirectCapabilityProof(root);
      assertM1OutputWireFixtureUsesSafeAuthoredShapes(root);
    });
  });

  it.each([...dialectSpecificRuntimeCases])(
    'M1:raw-sql covers raw SQL owner-write unsafe and trusted %s production siblings',
    (_label: string, dialect: CreateKovoDialect | undefined) => {
      withProject(`create-kovo-m1-raw-sql-${_label}-red-`, dialect, (root) => {
        addRawSqlOwnerWriteProof(root, { staticStatement: true });
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
          'bugz25-sql-carrier-proof.ts',
          'bugz25-sql-wrapper-proof.ts',
          'KV429',
          'concurrency annotation is dynamic or statically unresolved',
          'table=contacts',
          'column=company',
        ]);
      });
    },
    300_000,
  );

  // @kovo-security-certifies KV424 exact-global-array-carrier-family-prod-artifact
  // @kovo-security-certifies KV424 exact-global-iterable-binding-family-prod-artifact
  it.each([...BUGZ31_GLOBAL_MEMBER_CARRIER_PROOFS])(
    'bugz-31: exact global member %s fail closed in a production artifact',
    (proof: Bugz31GlobalMemberCarrierProof) => {
      withProject(`create-kovo-bugz31-${proof}-red-`, undefined, (root) => {
        addBugz31GlobalMemberCarrierProof(root, proof);
        expectBuildFailure(root, [
          'KV424',
          'source=Promise.resolve',
          'source=Response.json',
          'source=Array.isArray',
          'source=JSON.stringify',
        ]);
      });
    },
    300_000,
  );

  // @kovo-security-certifies KV424 helper-assimilation-prod-artifact
  it('bugz-31: helper, container, reflection, and Promise callback assimilation fail the production build', () => {
    withProject('create-kovo-bugz31-assimilation-red-', undefined, (root) => {
      addBugz31AssimilationProof(root);
      expectBuildFailure(root, [
        'KV424',
        'sink=request-handler.opaque-protocol',
        'source=<class-thenable:reveal()>',
        'source=<class-thenable:identity(Bugz31AssimilationDeferred)>',
        'source=<class-thenable:Reflect.get',
        'source=<class-thenable:revealDefault()>',
        'source=<class-thenable:InheritedDeferred.value>',
        'bugz31-assimilation-proof.ts',
      ]);
    });
  }, 300_000);

  // @kovo-security-certifies KV424 trusted-input-provenance-prod-artifact
  // @kovo-security-certifies KV424 call-derived-reference-alias-prod-artifact
  it('bugz-31: trusted input mutation and authored result laundering fail the production build', () => {
    withProject('create-kovo-bugz31-root-provenance-red-', undefined, (root) => {
      addBugz31TrustedInputProvenanceProof(root);
      expectBuildFailure(root, [
        'KV424',
        'sink=request-handler.opaque-protocol',
        'source=<Object.defineProperty-target:input>',
        'source=<Object.defineProperty-target:alias>',
        'source=<class-thenable:input.values.concat',
        'source=<class-thenable:input.values.map',
        'source=<class-thenable:input.value.replace',
        'bugz31-root-provenance-proof.ts',
      ]);
    });
  }, 300_000);

  // @kovo-security-certifies KV424 exact-global-namespace-member-lockdown-prod-artifact
  it.each([...dialectIndependentCompilerGateCases])(
    'bugz-31: exact global namespace-member replacements fail the %s production build',
    (_label: string, dialect: CreateKovoDialect | undefined) => {
      withProject(`create-kovo-bugz31-intrinsic-member-${_label}-red-`, dialect, (root) => {
        addBugz31GlobalMemberLockdownProof(root);
        expectBuildFailure(root, [
          'KV424',
          'source=Promise.resolve',
          'source=Response.json',
          'source=Array.isArray',
          'source=JSON.stringify',
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
          assertM1OutputWireFixtureUsesSafeAuthoredShapes(root);
          configureNodeRetention(root);
          // This single synthetic graph combines every M1 output sink with both
          // generated auth schemas. Give its no-cache proof a bounded verifier
          // heap above Node's ~4 GiB default; production app builds remain unchanged.
          buildProductionArtifact(root, { maxOldSpaceSizeMb: 6_144 });
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
          const runtimeJar = new Map<string, string>();
          mergeCookies(runtimeJar, page.headers.getSetCookie());
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
                cookie: cookieHeader(runtimeJar),
                'Kovo-Current-Url': `${origin}/runtime-contracts-proof`,
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
          // Request-derived error detail is now omitted at the shell boundary;
          // retaining it merely HTML-escaped would still expose attacker-selected
          // content in a privileged framework error document.
          expect(shellBody).not.toContain('owned()');
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

          const headerCookieJar = new Map<string, string>();
          const cookieForm = await fetch(`${origin}/m1/header-cookie-form`);
          mergeCookies(headerCookieJar, cookieForm.headers.getSetCookie());
          const cookieFormHtml = await cookieForm.text();
          const headerCookieCsrf = /name="csrf"\s+value="([^"]+)"/.exec(cookieFormHtml)?.[1];
          const headerCookieAction = attributeValue(cookieFormHtml, 'action');
          expect(cookieForm.status, cookieFormHtml).toBe(200);
          expect(headerCookieCsrf).toBeTruthy();
          expect(headerCookieAction).toBeTruthy();
          if (!headerCookieAction) throw new Error('Expected M1 header cookie form action.');

          const cookie = await fetch(`${origin}${headerCookieAction}`, {
            body: new URLSearchParams({
              'Kovo-Idem': `m1-cookie-${Date.now()}`,
              csrf: headerCookieCsrf ?? '',
              mode: 'safe',
            }),
            headers: {
              'Kovo-Fragment': 'true',
              'content-type': 'application/x-www-form-urlencoded',
              cookie: cookieHeader(headerCookieJar),
              origin,
            },
            method: 'POST',
          });
          await cookie.text();
          expect(cookie.status).toBe(200);
          expect(cookie.headers.getSetCookie()).toEqual([
            expect.stringContaining('m1_cookie=safe'),
          ]);

          const unsafeCookie = await fetch(`${origin}${headerCookieAction}`, {
            body: new URLSearchParams({
              'Kovo-Idem': `m1-unsafe-cookie-${Date.now()}`,
              csrf: headerCookieCsrf ?? '',
              mode: 'unsafe',
            }),
            headers: {
              'Kovo-Fragment': 'true',
              'content-type': 'application/x-www-form-urlencoded',
              cookie: cookieHeader(headerCookieJar),
              origin,
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

function expectBuildFailure(root: string, expectedOutput: readonly string[]): string {
  let output: string | undefined;
  try {
    buildProductionArtifact(root);
  } catch (error) {
    output = execFileSyncErrorOutput(error);
  }
  if (output === undefined) {
    throw new Error('Expected production build to fail, but it succeeded.');
  }
  for (const expected of expectedOutput) {
    expect(output).toContain(expected);
  }
  return output;
}

function expectStorageWriteBuildFailure(root: string): void {
  expectBuildFailure(root, [
    'KV433',
    'storage-put-write-query',
    'storage-delete-write-query',
    'storage-upload-write-query',
    'operation=put',
    'operation=delete',
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

  writeFileSync(
    join(root, 'src/bugz25-sql-carrier-proof.ts'),
    [
      "import { sql } from '@kovojs/drizzle';",
      '',
      "import type { AppDb } from './db.js';",
      "import { contacts } from './schema.js';",
      '',
      'export async function bugz25SqlCarrierProof(input: { sort: string }, db: AppDb) {',
      '  const holder = { nested: { dangerous: sql.raw } };',
      '  const { nested: { dangerous } } = holder;',
      '  return db.select().from(contacts).orderBy(dangerous(input.sort));',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    join(root, 'src/bugz25-sql-wrapper-proof.ts'),
    [
      "import { sql } from '@kovojs/drizzle';",
      '',
      "import type { AppDb } from './db.js';",
      "import { contacts } from './schema.js';",
      '',
      'const carry = <T,>(value: T): T => value;',
      '',
      'export async function bugz25SqlWrapperProof(input: { sort: string }, db: AppDb) {',
      '  const dangerous = carry(sql.raw);',
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

function addBugz31GlobalMemberLockdownProof(root: string): void {
  writeFileSync(
    join(root, 'src/bugz31-intrinsic-alias.ts'),
    'export const promiseNamespace = Promise;\n',
    'utf8',
  );
  writeFileSync(
    join(root, 'src/bugz31-intrinsic-barrel.ts'),
    "export { promiseNamespace as runtimePromise } from './bugz31-intrinsic-alias.js';\n",
    'utf8',
  );
  writeFileSync(
    join(root, 'src/bugz31-intrinsic-poison.ts'),
    [
      "import { runtimePromise } from './bugz31-intrinsic-barrel.js';",
      '',
      'export class Bugz31Deferred {',
      '  static then(resolve: (value: { ok: true }) => void): void {',
      '    resolve({ ok: true });',
      "    queueMicrotask(() => { void fetch('https://example.test/late'); });",
      '  }',
      '}',
      '',
      'const promiseAlias = runtimePromise;',
      "Object.defineProperty(promiseAlias, 'resolve', { value: () => Bugz31Deferred });",
      "Object.defineProperty(Response, 'json', { value: () => Bugz31Deferred });",
      "Object.defineProperty(Array, 'isArray', { value: () => Bugz31Deferred });",
      "Object.defineProperty(JSON, 'stringify', { value: () => Bugz31Deferred });",
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(root, 'src/bugz31-intrinsic-member-proof.ts'),
    [
      "import { s, task } from '@kovojs/server';",
      "import './bugz31-intrinsic-poison.js';",
      '',
      "task('bugz31-promise-resolve', {",
      '  input: s.object({}),',
      '  async run() { return Promise.resolve(); },',
      '});',
      "task('bugz31-response-json', {",
      '  input: s.object({}),',
      '  async run() { return Response.json({ ok: true }); },',
      '});',
      "task('bugz31-array-is-array', {",
      '  input: s.object({}),',
      '  async run() { return Array.isArray([]); },',
      '});',
      "task('bugz31-json-stringify', {",
      '  input: s.object({}),',
      '  async run() { return JSON.stringify({ ok: true }); },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8');
  const anchor = "import { appTheme } from './theme.js';";
  if (!app.includes(anchor)) {
    throw new Error('Expected scaffold app import anchor for bugz-31 intrinsic proof.');
  }
  writeFileSync(
    appPath,
    app.replace(anchor, `${anchor}\nimport './bugz31-intrinsic-member-proof.js';`),
    'utf8',
  );
}

function addBugz31AssimilationProof(root: string): void {
  writeFileSync(
    join(root, 'src/bugz31-assimilation-proof.ts'),
    [
      "import { s, task } from '@kovojs/server';",
      '',
      'class Bugz31AssimilationDeferred {',
      '  static then(resolve: (value: { ok: true }) => void): void {',
      '    resolve({ ok: true });',
      "    queueMicrotask(() => { void fetch('https://example.test/late'); });",
      '  }',
      '}',
      '',
      "task('bugz31-assimilation-helper', {",
      '  input: s.object({}),',
      '  run() {',
      '    const reveal = () => Bugz31AssimilationDeferred;',
      '    return reveal();',
      '  },',
      '});',
      '',
      "task('bugz31-assimilation-default', {",
      '  input: s.object({}),',
      '  run() {',
      '    function revealDefault(value = Bugz31AssimilationDeferred) { return value; }',
      '    return revealDefault();',
      '  },',
      '});',
      '',
      "task('bugz31-assimilation-inherited-projection', {",
      '  input: s.object({}),',
      '  run() {',
      '    class AssimilationBase {',
      '      static get value() { return Bugz31AssimilationDeferred; }',
      '    }',
      '    class InheritedDeferred extends AssimilationBase {}',
      '    return InheritedDeferred.value;',
      '  },',
      '});',
      '',
      "task('bugz31-assimilation-identity', {",
      '  input: s.object({}),',
      '  run() {',
      '    function identity<T>(value: T): T { return value; }',
      '    return identity(Bugz31AssimilationDeferred);',
      '  },',
      '});',
      '',
      "task('bugz31-assimilation-reflect', {",
      '  input: s.object({}),',
      '  run() {',
      "    return Reflect.get({ value: Bugz31AssimilationDeferred }, 'value');",
      '  },',
      '});',
      '',
      "task('bugz31-assimilation-promise-callback', {",
      '  input: s.object({}),',
      '  run() {',
      '    return Promise.resolve(1).then(() => [',
      '      Bugz31AssimilationDeferred as unknown as { ok: true },',
      '    ].at(0));',
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8');
  const anchor = "import { appTheme } from './theme.js';";
  if (!app.includes(anchor)) {
    throw new Error('Expected scaffold app import anchor for bugz-31 assimilation proof.');
  }
  writeFileSync(
    appPath,
    app.replace(anchor, `${anchor}\nimport './bugz31-assimilation-proof.js';`),
    'utf8',
  );
}

function addBugz31TrustedInputProvenanceProof(root: string): void {
  writeFileSync(
    join(root, 'src/bugz31-root-provenance-proof.ts'),
    [
      "import { s, task } from '@kovojs/server';",
      '',
      'class Bugz31InputDeferred {',
      '  static then(resolve: (value: { ok: true }) => void): void {',
      '    resolve({ ok: true });',
      "    queueMicrotask(() => { void fetch('https://example.test/late'); });",
      '  }',
      '}',
      '',
      "task('bugz31-root-mutation', {",
      '  input: s.object({ value: s.string() }),',
      '  run(input) {',
      "    Object.defineProperty(input, 'value', { value: Bugz31InputDeferred });",
      '    return input.value;',
      '  },',
      '});',
      '',
      "task('bugz31-root-map-output', {",
      '  input: s.object({ values: s.array(s.string()) }),',
      '  run(input) {',
      '    return input.values.map(() => Bugz31InputDeferred as unknown as string)[0];',
      '  },',
      '});',
      '',
      "task('bugz31-root-call-alias', {",
      '  input: s.object({ items: s.array(s.object({ value: s.string() })) }),',
      '  run(input) {',
      '    const alias = input.items.findLast(() => true)!;',
      "    Object.defineProperty(alias, 'value', { value: Bugz31InputDeferred });",
      '    return input.items[0]!.value;',
      '  },',
      '});',
      '',
      "task('bugz31-root-concat-output', {",
      '  input: s.object({ values: s.array(s.string()) }),',
      '  run(input) {',
      '    return input.values.concat([Bugz31InputDeferred as unknown as string])[0];',
      '  },',
      '});',
      '',
      "task('bugz31-root-protocol-output', {",
      '  input: s.object({ value: s.string() }),',
      '  run(input) {',
      '    const protocol = {',
      '      [Symbol.replace]() { return Bugz31InputDeferred as unknown as string; },',
      '    };',
      "    return input.value.replace(protocol as unknown as RegExp, 'safe');",
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8');
  const anchor = "import { appTheme } from './theme.js';";
  if (!app.includes(anchor)) {
    throw new Error('Expected scaffold app import anchor for bugz-31 root provenance proof.');
  }
  writeFileSync(
    appPath,
    app.replace(anchor, `${anchor}\nimport './bugz31-root-provenance-proof.js';`),
    'utf8',
  );
}

function addBugz31GlobalMemberCarrierProof(
  root: string,
  proof: Bugz31GlobalMemberCarrierProof,
): void {
  const deferredClass = [
    'export class Bugz31Deferred {',
    '  static then(resolve: (value: { ok: true }) => void): void {',
    '    resolve({ ok: true });',
    "    queueMicrotask(() => { void fetch('https://example.test/late'); });",
    '  }',
    '}',
  ];
  let poison: string[];
  let promisePrelude = '';
  let arrayPrelude = '';
  switch (proof) {
    case 'ordinary-carriers':
      poison = [
        ...deferredClass,
        'const promiseHolder: { value?: PromiseConstructor } = {};',
        'promiseHolder.value = Promise;',
        "Object.defineProperty(promiseHolder.value!, 'resolve', { value: () => Bugz31Deferred });",
        'const responseHolder: { value?: typeof Response } = {};',
        "Object.defineProperty(responseHolder, 'value', { get: () => Response });",
        "Object.defineProperty(responseHolder.value!, 'json', { value: () => Bugz31Deferred });",
        'const arrayHolder: { value?: ArrayConstructor } = {};',
        'Object.assign(arrayHolder, { value: Array });',
        "Reflect.set(arrayHolder.value!, 'isArray', () => Bugz31Deferred);",
        'const jsonHolder: { value?: JSON } = {};',
        'Reflect.setPrototypeOf(jsonHolder, { value: JSON });',
        "Object.defineProperty(jsonHolder.value!, 'stringify', { value: () => Bugz31Deferred });",
      ];
      break;
    case 'projection-carriers':
      poison = [
        ...deferredClass,
        'const promiseHolder = { value: Promise };',
        "const namespaceKey: keyof typeof promiseHolder = 'value';",
        "const memberKey: keyof typeof Promise = 'resolve';",
        'promiseHolder[namespaceKey][memberKey] =',
        '  (() => Bugz31Deferred) as unknown as typeof Promise.resolve;',
        'const { value: responseNamespace } = { value: Response };',
        'const { defineProperty: replaceMember } = Object;',
        "replaceMember(responseNamespace, 'json', { value: () => Bugz31Deferred });",
        'const arrayCarrier = [[Array]];',
        'arrayCarrier[0]![0]!.isArray =',
        '  (() => Bugz31Deferred) as unknown as typeof Array.isArray;',
        '({ stringify: JSON.stringify } = {',
        '  stringify: (() => Bugz31Deferred) as unknown as typeof JSON.stringify,',
        '});',
      ];
      break;
    case 'array-result-carriers':
      poison = [
        ...deferredClass,
        "Object.defineProperty([Promise].filter(() => true)[0]!, 'resolve', {",
        '  value: () => Bugz31Deferred,',
        '});',
        "Object.defineProperty([Response, Response].reduce((_accumulator, value) => value), 'json', {",
        '  value: () => Bugz31Deferred,',
        '});',
        "Object.defineProperty([Array, Array].reduceRight((_accumulator, value) => value), 'isArray', {",
        '  value: () => Bugz31Deferred,',
        '});',
        "Object.defineProperty([JSON].findLast(() => true)!, 'stringify', {",
        '  value: () => Bugz31Deferred,',
        '});',
      ];
      break;
    case 'iterable-binding-carriers':
      poison = [
        ...deferredClass,
        "Object.defineProperty(Array.of(Promise)[0]!, 'resolve', {",
        '  value: () => Bugz31Deferred,',
        '});',
        'const [responseNamespace] = new Set([Response]);',
        "Object.defineProperty(responseNamespace!, 'json', { value: () => Bugz31Deferred });",
        'function replaceArray(...targets: [ArrayConstructor]): void {',
        "  Object.defineProperty(targets[0], 'isArray', { value: () => Bugz31Deferred });",
        '}',
        'replaceArray(Array);',
        'function replaceJson({ target: alias }: { target: JSON }): void {',
        "  Object.defineProperty(alias, 'stringify', { value: () => Bugz31Deferred });",
        '}',
        'replaceJson({ target: JSON });',
      ];
      break;
    case 'assignment-targets':
      poison = [
        ...deferredClass,
        '[Promise.resolve] = [',
        '  (() => Bugz31Deferred) as unknown as typeof Promise.resolve,',
        '];',
        '({ nested: { json: Response.json } } = {',
        '  nested: {',
        '    json: (() => Bugz31Deferred) as unknown as typeof Response.json,',
        '  },',
        '});',
        'for (Array.isArray of [',
        '  (() => Bugz31Deferred) as unknown as typeof Array.isArray,',
        ']) { break; }',
        'for ((JSON.stringify as any) in { poisoned: true }) { break; }',
      ];
      break;
    case 'loop-and-exhaustion-targets': {
      const aliases = Array.from(
        { length: 40 },
        (_value, index) => `const jsonAlias${index + 1} = jsonAlias${index};`,
      );
      poison = [
        ...deferredClass,
        'for ({ nested: { json: Response.json } } of [{',
        '  nested: {',
        '    json: (() => Bugz31Deferred) as unknown as typeof Response.json,',
        '  },',
        '}]) { break; }',
        'const jsonAlias0 = JSON;',
        ...aliases,
        "Object.defineProperty(jsonAlias40, 'stringify', { value: () => Bugz31Deferred });",
      ];
      promisePrelude =
        'for await (Promise.resolve of [(() => Bugz31Deferred) as unknown as typeof Promise.resolve]) { break; }';
      arrayPrelude =
        'for await ([Array.isArray] of [[(() => Bugz31Deferred) as unknown as typeof Array.isArray] as [typeof Array.isArray]]) { break; }';
      break;
    }
  }

  writeFileSync(
    join(root, 'src/bugz31-member-carrier-poison.ts'),
    `${poison.join('\n')}\n`,
    'utf8',
  );
  writeFileSync(
    join(root, 'src/bugz31-member-carrier-proof.ts'),
    [
      "import { s, task } from '@kovojs/server';",
      "import { Bugz31Deferred } from './bugz31-member-carrier-poison.js';",
      '',
      "task('bugz31-carrier-promise-resolve', {",
      '  input: s.object({}),',
      `  async run() { ${promisePrelude} return Promise.resolve(); },`,
      '});',
      "task('bugz31-carrier-response-json', {",
      '  input: s.object({}),',
      '  async run() { return Response.json({ ok: true }); },',
      '});',
      "task('bugz31-carrier-array-is-array', {",
      '  input: s.object({}),',
      `  async run() { ${arrayPrelude} return Array.isArray([]); },`,
      '});',
      "task('bugz31-carrier-json-stringify', {",
      '  input: s.object({}),',
      '  async run() { return JSON.stringify({ ok: true }); },',
      '});',
      '',
      'void Bugz31Deferred;',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8');
  const anchor = "import { appTheme } from './theme.js';";
  if (!app.includes(anchor)) {
    throw new Error('Expected scaffold app import anchor for bugz-31 carrier proof.');
  }
  writeFileSync(
    appPath,
    app.replace(anchor, `${anchor}\nimport './bugz31-member-carrier-proof.js';`),
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
    .replace('  createApp,', '  createApp,\n  Defer,')
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
      '  input: s.object({ mode: s.string() }),',
      '  handler(input, _request, context) {',
      "    const value = input.mode === 'unsafe' ? 'bad\\r\\nSet-Cookie: m1=owned' : 'safe';",
      "    context.setCookie?.('m1_cookie', value, { class: 'app-data', path: '/', sameSite: 'lax' });",
      '    return { ok: true };',
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8')
    .replace(
      '  createApp,',
      [
        '  createApp,',
        '  createMemoryStorage,',
        '  createSigningKeyRing,',
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
      'const mutationReplayStore = appRuntimeMutationReplayStore;',
      [
        'const mutationReplayStore = appRuntimeMutationReplayStore;',
        'const m1CapabilitySigningKeys = createSigningKeyRing({',
        '  keys: [',
        '    {',
        "      id: 'm1-capability',",
        "      secret: 'm1-capability-test-signing-material-2026',",
        "      state: 'active',",
        '    },',
        '  ],',
        '});',
        'const m1CapabilityStorage = createMemoryStorage();',
        "await m1CapabilityStorage.put('receipts/m1.txt', 'm1 capability secret\\n', {",
        "  contentType: 'text/plain',",
        "  metadata: { filename: 'm1.txt' },",
        '});',
        'const m1CapabilityEndpoint = createStorageDownloadEndpoint({',
        "  basePath: '/m1-capability-download',",
        '  secret: m1CapabilitySigningKeys,',
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
        "    route('/m1/header-cookie-form', {",
        "      access: publicAccess('public M1 Set-Cookie proof form'),",
        '      page() {',
        '        return <form mutation={m1HeaderCookieProof}><input name="mode" value="safe" /><button type="submit">Submit</button></form>;',
        '      },',
        '    }),',
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

function assertM1OutputWireFixtureUsesSafeAuthoredShapes(root: string): void {
  const app = readFileSync(join(root, 'src/app.tsx'), 'utf8');
  const headerProof = readFileSync(join(root, 'src/m1-header-proof.tsx'), 'utf8');
  const runtimeProofs = readFileSync(join(root, 'src/runtime-contract-proofs.tsx'), 'utf8');

  expect(app).toMatch(
    /import \{[\s\S]*?createMemoryStorage,[\s\S]*?createSigningKeyRing,[\s\S]*?createStorageDownloadEndpoint,[\s\S]*?\} from '@kovojs\/server';/u,
  );
  expect(app).toContain('const m1CapabilitySigningKeys = createSigningKeyRing({');
  expect(app).toContain('secret: m1CapabilitySigningKeys,');
  expect(app).not.toContain('secret: appCsrf.secret,');
  expect(headerProof).toContain('export const m1HeaderCookieProof = mutation({');
  expect(headerProof).not.toContain('m1HeaderCookieProof.key =');
  expect(headerProof).not.toContain("'m1/header-cookie-proof'");
  expect(runtimeProofs).toContain('rows: [0, 1, 2, 3].map((id) => ({ id, label: `item-${id}` })),');
  expect(runtimeProofs).toContain('    } catch {');
  expect(runtimeProofs).not.toContain('error instanceof Error');
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
