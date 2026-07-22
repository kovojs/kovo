import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  formatCertificateVerification,
  KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
  type KovoCertificateArtifactSource,
  type KovoCertificatePolicyV1,
  type KovoCertificateV1,
  verifyCertificate,
} from './index.js';
import { MAX_JAVASCRIPT_MODULE_REFERENCES } from './javascript-ast.js';

const rootModule = '@kovojs/server/dist/root.mjs';
const workerModule = '@kovojs/server/dist/worker.mjs';

describe('standalone kovo.certificate/v1 checker (Plan 3 §2.1 C13 anchor)', () => {
  it('accepts a canonical certificate after independently deriving hashes, edges, and local authority', async () => {
    const artifacts = artifactSource({
      [rootModule]: "export { worker } from './worker.mjs';",
      [workerModule]: 'export const worker = true;',
    });
    const certificate = certificateFor(artifacts, {
      cap: { [rootModule]: [], [workerModule]: [] },
      edges: [[rootModule, workerModule]],
      roots: [{ module: rootModule, rootKind: 'endpoint' }],
    });

    await expect(verifyBound(certificate, artifacts)).resolves.toMatchObject({
      findings: [],
      ok: true,
      stats: { artifacts: 2, edges: 1, roots: 1 },
    });
  });

  it('fails injected child_process bytes without regeneration on coverage only', async () => {
    const original = artifactSource({ [rootModule]: 'export const root = true;' });
    const certificate = certificateFor(original, { cap: { [rootModule]: [] } });
    const injected = artifactSource({
      [rootModule]: "require('node:child_process');\nexport const root = true;",
    });

    const result = await verifyCertificate(
      certificate,
      policyBytesFor(certificate, original),
      injected,
    );
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.obligation)).toEqual(['coverage']);
    expect(result.findings[0]).toMatchObject({ code: 'artifact-hash' });
  });

  it('fails a missing real edge on coverage only', async () => {
    const artifacts = artifactSource({
      [rootModule]: "import './worker.mjs';",
      [workerModule]: 'export {};',
    });
    const certificate = certificateFor(artifacts, {
      cap: { [rootModule]: [], [workerModule]: [] },
      edges: [],
    });

    const result = await verifyBound(certificate, artifacts);
    expect(result.findings.map((finding) => finding.obligation)).toEqual(['coverage']);
    expect(result.findings[0]).toMatchObject({ code: 'edge-missing' });
  });

  it('fails a dropped imported local capability on stability only', async () => {
    const artifacts = artifactSource({
      [rootModule]: "import 'node:child_process';\nexport const root = true;",
    });
    const certificate = certificateFor(artifacts, { cap: { [rootModule]: [] } });

    const result = await verifyBound(certificate, artifacts);
    expect(result.findings.map((finding) => finding.obligation)).toEqual(['stability']);
    expect(result.findings[0]).toMatchObject({ code: 'local-capability-missing' });
    expect(result.findings[0]?.message).toContain('process');
  });

  it('parses the complete near-limit module before deriving a hidden tail capability', async () => {
    // Full parsing happens before the finite reference extraction budget. A long comment keeps the
    // capability at the old 3,900,051-byte regression boundary without manufacturing references.
    const tail = "import 'node:child_process';\nexport const loaded = true;\n";
    const rootSource = `/*${'x'.repeat(3_900_051 - Buffer.byteLength(`/**/\n${tail}`))}*/\n${tail}`;
    expect(Buffer.byteLength(rootSource)).toBe(3_900_051);
    const artifacts = artifactSource({ [rootModule]: rootSource });
    const certificate = certificateFor(artifacts);

    const result = await verifyBound(certificate, artifacts);
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: 'local-capability-missing',
        message: expect.stringContaining('process'),
        obligation: 'stability',
      }),
    ]);
  });

  it('checks the exact per-module reference limit and closes with one sentinel at limit plus one', async () => {
    const safeModule = '@kovojs/server/dist/safe.mjs';
    const safeImport = "import './safe.mjs';\n";
    const capabilityImport = "import 'node:child_process';\n";
    const exactArtifacts = artifactSource({
      [rootModule]: safeImport.repeat(MAX_JAVASCRIPT_MODULE_REFERENCES - 1) + capabilityImport,
      [safeModule]: 'export {};',
    });
    const exactCertificate = certificateFor(exactArtifacts, {
      edges: [[rootModule, safeModule]],
    });
    await expect(verifyBound(exactCertificate, exactArtifacts)).resolves.toMatchObject({
      findings: [expect.objectContaining({ code: 'local-capability-missing' })],
      ok: false,
    });

    const overArtifacts = artifactSource({
      [rootModule]: safeImport.repeat(MAX_JAVASCRIPT_MODULE_REFERENCES) + capabilityImport,
      [safeModule]: 'export {};',
    });
    const overCertificate = certificateFor(overArtifacts, {
      edges: [[rootModule, safeModule]],
    });
    const result = await verifyBound(overCertificate, overArtifacts);
    expect(result.findings).toEqual([
      {
        code: 'artifact-analysis-budget',
        message: 'artifact analysis exceeds the finite module-reference or finding budget',
        obligation: 'coverage',
      },
    ]);
    expect(formatCertificateVerification(result).length).toBeLessThan(256);

    const invalidArtifacts = artifactSource({
      [rootModule]: `${safeImport.repeat(MAX_JAVASCRIPT_MODULE_REFERENCES + 1)}export {`,
      [safeModule]: 'export {};',
    });
    const invalidResult = await verifyBound(certificateFor(invalidArtifacts), invalidArtifacts);
    expect(invalidResult.findings).toEqual([
      expect.objectContaining({ code: 'artifact-parse', obligation: 'coverage' }),
    ]);
  });

  it('closes with one sentinel when individually valid modules exceed the aggregate reference budget', async () => {
    const safeModule = '@kovojs/server/dist/safe.mjs';
    const safeImport = "import './safe.mjs';\n";
    const sources: Record<string, string> = { [safeModule]: 'export {};' };
    const edges: [string, string][] = [];
    for (let index = 0; index < 4; index += 1) {
      const module = `@kovojs/server/dist/budget-${index}.mjs`;
      sources[module] = safeImport.repeat(MAX_JAVASCRIPT_MODULE_REFERENCES);
      edges.push([module, safeModule]);
    }
    const overModule = '@kovojs/server/dist/budget-4.mjs';
    sources[overModule] = safeImport;
    edges.push([overModule, safeModule]);
    const artifacts = artifactSource(sources);
    const result = await verifyBound(certificateFor(artifacts, { edges }), artifacts);

    expect(result.findings).toEqual([
      {
        code: 'artifact-analysis-budget',
        message: 'artifact analysis exceeds the finite module-reference or finding budget',
        obligation: 'coverage',
      },
    ]);
  });

  it('counts imported bindings in the finite module-reference budget', async () => {
    const safeModule = '@kovojs/server/dist/safe.mjs';
    const importWithBindings = (count: number): string =>
      `import {${Array.from({ length: count }, (_, index) => `value as value${index}`).join(',')}} from './safe.mjs';`;
    const exactArtifacts = artifactSource({
      [rootModule]: importWithBindings(MAX_JAVASCRIPT_MODULE_REFERENCES - 1),
      [safeModule]: 'export {};',
    });
    await expect(
      verifyBound(
        certificateFor(exactArtifacts, { edges: [[rootModule, safeModule]] }),
        exactArtifacts,
      ),
    ).resolves.toMatchObject({ findings: [], ok: true });

    const overArtifacts = artifactSource({
      [rootModule]: importWithBindings(MAX_JAVASCRIPT_MODULE_REFERENCES),
      [safeModule]: 'export {};',
    });
    const overResult = await verifyBound(
      certificateFor(overArtifacts, { edges: [[rootModule, safeModule]] }),
      overArtifacts,
    );
    expect(overResult.findings).toEqual([
      {
        code: 'artifact-analysis-budget',
        message: 'artifact analysis exceeds the finite module-reference or finding budget',
        obligation: 'coverage',
      },
    ]);
  });

  it('bounds reference-derived findings and replaces limit plus one with one sentinel', async () => {
    const unsupportedImport = "import 'https://example.invalid/module.js';\n";
    const exactArtifacts = artifactSource({
      [rootModule]: unsupportedImport.repeat(1024),
    });
    const exactResult = await verifyBound(certificateFor(exactArtifacts), exactArtifacts);
    expect(exactResult.findings).toHaveLength(1024);
    expect(exactResult.findings.every((entry) => entry.code === 'unsupported-import')).toBe(true);

    const overArtifacts = artifactSource({
      [rootModule]: unsupportedImport.repeat(1025),
    });
    const overResult = await verifyBound(certificateFor(overArtifacts), overArtifacts);
    expect(overResult.findings).toEqual([
      {
        code: 'artifact-analysis-budget',
        message: 'artifact analysis exceeds the finite module-reference or finding budget',
        obligation: 'coverage',
      },
    ]);
  });

  it('bounds post-fixpoint and closure report fan-out after artifact extraction', async () => {
    const targetSources = Object.fromEntries(
      Array.from({ length: 115 }, (_, index) => [
        `@kovojs/server/dist/target-${String(index).padStart(3, '0')}.mjs`,
        'export {};',
      ]),
    );
    const targetModules = Object.keys(targetSources).sort();
    const stabilityArtifacts = artifactSource({
      [rootModule]: targetModules
        .map((module) => `import './${module.split('/').at(-1)}';`)
        .join('\n'),
      ...targetSources,
    });
    const stabilityPaths = stabilityArtifacts.listArtifactPaths();
    const stabilityCertificate = certificateFor(stabilityArtifacts, {
      cap: Object.fromEntries(
        stabilityPaths.map((module) => [
          module,
          module === rootModule ? [] : KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
        ]),
      ),
      edges: targetModules.map((module) => [rootModule, module]),
    });

    const rootKinds: KovoCertificateV1['roots'][number]['rootKind'][] = [
      'agent-tool-callback',
      'application',
      'durable-task',
      'endpoint',
      'layout',
      'mutation',
      'query',
      'route',
      'scheduled-task',
      'serialized-browser-handler',
      'webhook',
    ];
    const closureSources = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [
        `@kovojs/server/dist/root-${String(index).padStart(2, '0')}.mjs`,
        'export {};',
      ]),
    );
    const closureArtifacts = artifactSource(closureSources);
    const closurePaths = closureArtifacts.listArtifactPaths();
    const roots = closurePaths
      .flatMap((module) => rootKinds.map((rootKind) => ({ module, rootKind })))
      .sort((left, right) => {
        const leftKey = `${left.module}\0${left.rootKind}`;
        const rightKey = `${right.module}\0${right.rootKind}`;
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      });
    const closureCertificate = certificateFor(closureArtifacts, {
      cap: Object.fromEntries(
        closurePaths.map((module) => [module, KOVO_CERTIFICATE_CAPABILITY_DOMAIN]),
      ),
      roots,
    });

    for (const [certificate, artifacts] of [
      [stabilityCertificate, stabilityArtifacts],
      [closureCertificate, closureArtifacts],
    ] as const) {
      const result = await verifyBound(certificate, artifacts);
      expect(result.findings).toEqual([
        {
          code: 'finding-budget',
          message: 'certificate verification exceeds the finite finding budget',
          obligation: 'schema',
        },
      ]);
      expect(formatCertificateVerification(result).length).toBeLessThan(256);
    }
  });

  it('checks imported post-fixpoint summaries and root-door closure as separate obligations', async () => {
    const artifacts = artifactSource({
      [rootModule]: "import './worker.mjs';",
      [workerModule]: "import 'node:fs';",
    });
    const unstable = certificateFor(artifacts, {
      cap: { [rootModule]: [], [workerModule]: ['filesystem'] },
      edges: [[rootModule, workerModule]],
    });
    const unstableResult = await verifyBound(unstable, artifacts);
    expect(unstableResult.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'edge-capability-missing', obligation: 'stability' }),
      ]),
    );

    const unclosed = certificateFor(artifacts, {
      cap: { [rootModule]: ['filesystem'], [workerModule]: ['filesystem'] },
      edges: [[rootModule, workerModule]],
      roots: [{ module: rootModule, rootKind: 'endpoint' }],
    });
    const unclosedResult = await verifyBound(unclosed, artifacts);
    expect(unclosedResult.findings).toEqual([
      expect.objectContaining({ code: 'root-capability-unclosed', obligation: 'closure' }),
    ]);
  });

  it('accepts a root only when every summarized capability has a same-module door', async () => {
    const artifacts = artifactSource({
      [rootModule]: "import 'node:child_process';\nimport 'node:fs';",
    });
    const certificate = certificateFor(artifacts, {
      cap: { [rootModule]: ['filesystem', 'process'] },
      doors: [
        { escapeId: 'filesystem', module: rootModule, site: 'framework:file-door' },
        { escapeId: 'process', module: rootModule, site: 'framework:process-door' },
      ],
      roots: [{ module: rootModule, rootKind: 'endpoint' }],
    });

    await expect(verifyBound(certificate, artifacts)).resolves.toMatchObject({ ok: true });
  });

  it('rejects an authority-bearing certificate that omits every real root', async () => {
    const artifacts = artifactSource({
      [rootModule]: "import 'node:child_process';",
    });
    const certificate = certificateFor(artifacts, {
      cap: { [rootModule]: ['process'] },
      roots: [],
    });

    await expect(
      verifyBound(certificate, artifacts, {
        roots: [{ module: rootModule, rootKind: 'application' }],
      }),
    ).resolves.toMatchObject({
      findings: expect.arrayContaining([expect.objectContaining({ obligation: 'closure' })]),
      ok: false,
    });
  });

  it('rejects a certificate-authored door that has no independently reviewed policy binding', async () => {
    const artifacts = artifactSource({
      [rootModule]: "import 'node:child_process';",
    });
    const certificate = certificateFor(artifacts, {
      cap: { [rootModule]: ['process'] },
      doors: [{ escapeId: 'process', module: rootModule, site: 'forged-review' }],
      roots: [{ module: rootModule, rootKind: 'application' }],
    });

    await expect(verifyBound(certificate, artifacts, { doors: [] })).resolves.toMatchObject({
      findings: expect.arrayContaining([expect.objectContaining({ obligation: 'closure' })]),
      ok: false,
    });
  });

  it('rejects a certificate-authored opaque premise absent from independently reviewed policy', async () => {
    const artifacts = artifactSource({
      [rootModule]: "import 'third-party-parser';",
    });
    const certificate = certificateFor(artifacts, {
      opaque: [
        {
          module: rootModule,
          reason:
            'imports external module "third-party-parser" outside the nine-kind lexical capability domain',
        },
      ],
    });

    await expect(verifyBound(certificate, artifacts, { opaque: [] })).resolves.toMatchObject({
      findings: expect.arrayContaining([expect.objectContaining({ code: 'policy-opaque' })]),
      ok: false,
    });
  });

  it('rejects noncanonical or differently bound reviewer policy bytes', async () => {
    const artifacts = artifactSource({ [rootModule]: 'export {};' });
    const certificate = certificateFor(artifacts);
    const canonical = policyBytesFor(certificate, artifacts);
    const noncanonical = Buffer.from(JSON.stringify(JSON.parse(canonical.toString('utf8'))));
    await expect(verifyCertificate(certificate, noncanonical, artifacts)).resolves.toMatchObject({
      findings: expect.arrayContaining([expect.objectContaining({ code: 'policy-noncanonical' })]),
      ok: false,
    });
    const different = policyBytesFor(certificate, artifacts, {
      roots: [{ module: rootModule, rootKind: 'application' }],
    });
    await expect(verifyCertificate(certificate, different, artifacts)).resolves.toMatchObject({
      findings: expect.arrayContaining([expect.objectContaining({ code: 'policy-hash' })]),
      ok: false,
    });
  });

  it('fails exact artifact coverage, computed imports, and unresolved relative imports', async () => {
    const one = artifactSource({ [rootModule]: 'export {};' });
    const extra = artifactSource({
      [rootModule]: 'export {};',
      [workerModule]: 'export {};',
    });
    expect((await verifyBound(certificateFor(one), extra)).findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'artifact-unlisted' })]),
    );

    const computed = artifactSource({
      [rootModule]: 'export const load = (name) => import(name);',
    });
    expect((await verifyBound(certificateFor(computed), computed)).findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'computed-import' })]),
    );

    const unresolved = artifactSource({ [rootModule]: "import './missing.mjs';" });
    expect((await verifyBound(certificateFor(unresolved), unresolved)).findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'edge-unresolved' })]),
    );

    for (const source of [
      "import './worker.mjs?query';",
      "import 'data:text/javascript,export default true';",
      "import '/absolute.mjs';",
    ]) {
      const unsupported = artifactSource({ [rootModule]: source });
      expect((await verifyBound(certificateFor(unsupported), unsupported)).findings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'unsupported-import' })]),
      );
    }
  });

  it('derives first-party package edges from reviewer policy instead of filename conventions', async () => {
    const helperEvil = '@kovojs/helper/dist/evil.mjs';
    const helperIndex = '@kovojs/helper/dist/index.mjs';
    const artifacts = artifactSource({
      [helperEvil]: "import 'node:child_process';",
      [helperIndex]: 'export const harmless = true;',
      [rootModule]: "import '@kovojs/helper';",
    });
    const certificate = certificateFor(artifacts, {
      cap: {
        [helperEvil]: ['process'],
        [helperIndex]: [],
        [rootModule]: [],
      },
      edges: [[rootModule, helperIndex]],
    });

    const result = await verifyBound(certificate, artifacts, {
      packages: [
        {
          manifest: { exports: { '.': './dist/evil.mjs' }, name: '@kovojs/helper' },
          name: '@kovojs/helper',
        },
        {
          manifest: { exports: { '.': './dist/root.mjs' }, name: '@kovojs/server' },
          name: '@kovojs/server',
        },
      ],
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'edge-missing',
          message: expect.stringContaining(helperEvil),
        }),
        expect.objectContaining({
          code: 'edge-extra',
          message: expect.stringContaining(helperIndex),
        }),
      ]),
    );
    expect(result.ok).toBe(false);
  });

  it.each(['@KOVOJS/server/hidden', '@kovojs/server./hidden', '@kovojs/ſerver/hidden'])(
    'rejects noncanonical portable first-party import alias %j before opaque classification',
    async (aliasedSpecifier) => {
      // SPEC §6.6 requires closure over the exact packed first-party graph. A case-insensitive
      // filesystem can resolve these spellings to the reviewed lowercase package without creating
      // a second artifact path for the portable-path collision census to observe.
      const hiddenModule = '@kovojs/server/dist/hidden.mjs';
      const artifacts = artifactSource({
        [hiddenModule]: "import 'node:child_process';",
        [rootModule]: `import ${JSON.stringify(aliasedSpecifier)};`,
      });
      const opaqueReason = `imports external module ${JSON.stringify(aliasedSpecifier)} outside the nine-kind lexical capability domain`;
      const certificate = certificateFor(artifacts, {
        cap: { [hiddenModule]: ['process'], [rootModule]: [] },
        opaque: [{ module: rootModule, reason: opaqueReason }],
        roots: [{ module: rootModule, rootKind: 'application' }],
      });

      const result = await verifyBound(certificate, artifacts, {
        packages: [
          {
            manifest: {
              exports: {
                '.': './dist/root.mjs',
                './hidden': './dist/hidden.mjs',
              },
              name: '@kovojs/server',
            },
            name: '@kovojs/server',
          },
        ],
      });

      expect(result).toMatchObject({
        findings: expect.arrayContaining([
          expect.objectContaining({
            code: 'noncanonical-first-party-import',
            obligation: 'coverage',
          }),
        ]),
        ok: false,
      });
    },
  );

  it('bounds generic artifact lists and byte carriers before iterable-sensitive copies', async () => {
    const ordinary = artifactSource({ [rootModule]: 'export {};' });
    const certificate = certificateFor(ordinary);
    const policy = policyBytesFor(certificate, ordinary);
    const tooManyPaths = Array.from(
      { length: 4_097 },
      (_, index) => `@kovojs/server/dist/list-${String(index).padStart(4, '0')}.mjs`,
    );
    await expect(
      verifyCertificate(certificate, policy, {
        listArtifactPaths: () => tooManyPaths,
        readArtifact: ordinary.readArtifact,
      }),
    ).resolves.toMatchObject({
      findings: expect.arrayContaining([expect.objectContaining({ code: 'artifact-list-size' })]),
      ok: false,
    });

    let accessorRead = false;
    const accessorPaths = [rootModule];
    Object.defineProperty(accessorPaths, '0', {
      get() {
        accessorRead = true;
        return rootModule;
      },
    });
    await expect(
      verifyCertificate(certificate, policy, {
        listArtifactPaths: () => accessorPaths,
        readArtifact: ordinary.readArtifact,
      }),
    ).resolves.toMatchObject({
      findings: expect.arrayContaining([expect.objectContaining({ code: 'artifact-list' })]),
      ok: false,
    });
    expect(accessorRead).toBe(false);

    const oversizedBytes = Buffer.alloc(4 * 1024 * 1024 + 1, 0x20);
    const oversized = {
      listArtifactPaths: () => [rootModule],
      readArtifact: () => oversizedBytes,
    } satisfies KovoCertificateArtifactSource;
    await expect(verifyBound(certificateFor(oversized), oversized)).resolves.toMatchObject({
      findings: expect.arrayContaining([expect.objectContaining({ code: 'artifact-size' })]),
      ok: false,
    });

    const sharedFourMiB = Buffer.alloc(4 * 1024 * 1024, 0x20);
    const aggregatePaths = Array.from(
      { length: 9 },
      (_, index) => `@kovojs/server/dist/aggregate-${index}.mjs`,
    );
    const aggregate = {
      listArtifactPaths: () => aggregatePaths,
      readArtifact: () => sharedFourMiB,
    } satisfies KovoCertificateArtifactSource;
    await expect(verifyBound(certificateFor(aggregate), aggregate)).resolves.toMatchObject({
      findings: expect.arrayContaining([expect.objectContaining({ code: 'artifact-total-size' })]),
      ok: false,
    });
  });

  it('copies policy and artifact bytes without consulting caller-owned iterators', async () => {
    const bytes = Buffer.from('export {};');
    Object.defineProperty(bytes, Symbol.iterator, {
      value() {
        throw new Error('artifact iterator must not run');
      },
    });
    const artifacts = {
      listArtifactPaths: () => [rootModule],
      readArtifact: () => bytes,
    } satisfies KovoCertificateArtifactSource;
    const certificate = certificateFor(artifacts);
    const policy = policyBytesFor(certificate, artifacts);
    Object.defineProperty(policy, Symbol.iterator, {
      value() {
        throw new Error('policy iterator must not run');
      },
    });

    await expect(verifyCertificate(certificate, policy, artifacts)).resolves.toMatchObject({
      findings: [],
      ok: true,
    });
  });

  it('requires an exact opaque row for every external import outside the nine-kind domain', async () => {
    const artifacts = artifactSource({
      [rootModule]: "import 'third-party-parser'; export const root = true;",
    });
    const reason =
      'imports external module "third-party-parser" outside the nine-kind lexical capability domain';
    expect((await verifyBound(certificateFor(artifacts), artifacts)).findings).toEqual([
      expect.objectContaining({ code: 'opaque-missing', obligation: 'coverage' }),
    ]);
    await expect(
      verifyBound(
        certificateFor(artifacts, { opaque: [{ module: rootModule, reason }] }),
        artifacts,
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it('never downgrades no-substitution template imports into an opaque premise', async () => {
    const reason =
      'contains computed dynamic import; runtime-selected dependency loads require §4.6 lexical authority coverage';
    for (const specifier of [
      'node:child_process',
      'node:crypto',
      './worker.mjs',
      'data:text/javascript,export default true',
      '/absolute.mjs',
    ]) {
      const artifacts = artifactSource({
        [rootModule]: `export const loaded = import(\`${specifier}\`);`,
        ...(specifier === './worker.mjs' ? { [workerModule]: 'export const worker = true;' } : {}),
      });
      const certificate = certificateFor(artifacts, {
        opaque: [{ module: rootModule, reason }],
      });
      const result = await verifyBound(certificate, artifacts);
      expect(result.findings, specifier).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'unsupported-template-import', obligation: 'coverage' }),
        ]),
      );
    }
  });

  it('independently classifies every member of the frozen capability domain', async () => {
    const specimens = new Map<string, (typeof KOVO_CERTIFICATE_CAPABILITY_DOMAIN)[number]>([
      ['pg', 'database-driver'],
      ['node:module', 'dynamic-loader'],
      ['node:fs', 'filesystem'],
      ['node:net', 'network'],
      ['node:child_process', 'process'],
      ['node:vm', 'vm'],
      ['node:worker_threads', 'worker'],
    ]);
    for (const [specifier, capability] of specimens) {
      const artifacts = artifactSource({ [rootModule]: `import ${JSON.stringify(specifier)};` });
      const certificate = certificateFor(artifacts, {
        ...(specifier === 'node:module'
          ? {
              opaque: [
                {
                  module: rootModule,
                  reason:
                    'imports Node module-loader authority; runtime-selected dependency loads require lexical authority coverage',
                },
              ],
            }
          : {}),
      });
      const result = await verifyBound(certificate, artifacts);
      expect(result.findings, specifier).toEqual([
        expect.objectContaining({
          code: 'local-capability-missing',
          message: expect.stringContaining(capability),
          obligation: 'stability',
        }),
      ]);
    }
  });

  it('retains digest-only crypto imports and conservatively closes every broader acquisition', async () => {
    expect(KOVO_CERTIFICATE_CAPABILITY_DOMAIN).toEqual([
      'crypto-acquisition',
      'database-driver',
      'digest',
      'dynamic-loader',
      'filesystem',
      'network',
      'process',
      'vm',
      'worker',
    ]);
    const specimens = [
      {
        capability: 'digest',
        source: "import { createHash as hashBytes } from 'node:crypto';",
      },
      {
        capability: 'digest',
        source: "import { hash } from 'crypto';",
      },
      {
        capability: 'crypto-acquisition',
        source: "import * as crypto from 'node:crypto';",
      },
      {
        capability: 'crypto-acquisition',
        source: "import { createHash, randomBytes } from 'node:crypto';",
      },
      {
        capability: 'crypto-acquisition',
        source: "import argon2 from '@node-rs/argon2';",
      },
    ] as const;

    for (const { capability, source } of specimens) {
      const artifacts = artifactSource({ [rootModule]: source });
      const result = await verifyBound(certificateFor(artifacts), artifacts);
      expect(result.findings, source).toEqual([
        expect.objectContaining({
          code: 'local-capability-missing',
          message: expect.stringContaining(capability),
          obligation: 'stability',
        }),
      ]);
    }
  });

  it('rejects schema drift, inherited carriers, non-canonical paths, and duplicate rows', async () => {
    const artifacts = artifactSource({ [rootModule]: 'export {};' });
    const valid = certificateFor(artifacts);
    const inherited = Object.assign(Object.create({ schema: 'kovo.certificate/v1' }), valid);
    delete inherited.schema;
    const symbolProperty = { ...valid };
    Object.defineProperty(symbolProperty, Symbol('hidden'), { value: true });
    const nonenumerableArrayProperty = [...valid.artifacts];
    Object.defineProperty(nonenumerableArrayProperty, 'hidden', { value: true });
    const noncanonicalArrayIndex = [...valid.artifacts];
    Object.defineProperty(noncanonicalArrayIndex, '00', {
      enumerable: true,
      value: valid.artifacts[0],
    });

    for (const malformed of [
      { ...valid, extra: true },
      { ...valid, domain: [...KOVO_CERTIFICATE_CAPABILITY_DOMAIN, 'socket'] },
      { ...valid, artifacts: ['../root.mjs'] },
      { ...valid, artifacts: ['@kovojs/server/private/dist/root.mjs'] },
      { ...valid, artifacts: [valid.artifacts[0]!, valid.artifacts[0]!] },
      { ...valid, artifacts: nonenumerableArrayProperty },
      { ...valid, artifacts: noncanonicalArrayIndex },
      inherited,
      symbolProperty,
    ]) {
      const result = await verifyBound(malformed, artifacts);
      expect(result.ok).toBe(false);
      expect(result.findings.every((finding) => finding.obligation === 'schema')).toBe(true);
    }
  });

  it('rejects portable artifact aliases before they can overwrite a reviewed root', async () => {
    const collidingModule = '@kovojs/server/dist/ROOT.mjs';
    const artifacts = artifactSource({
      [collidingModule]: "import 'node:child_process';",
      [rootModule]: 'export const safe = true;',
    });
    const certificate = certificateFor(artifacts, {
      cap: { [collidingModule]: ['process'], [rootModule]: [] },
      roots: [{ module: rootModule, rootKind: 'application' }],
    });

    await expect(verifyBound(certificate, artifacts)).resolves.toMatchObject({
      findings: expect.arrayContaining([
        expect.objectContaining({ code: 'artifact-path-collision', obligation: 'schema' }),
      ]),
      ok: false,
    });

    for (const unsafePath of [
      '@kovojs/server/dist/scope./root.mjs',
      '@kovojs/server/dist/CON.mjs',
    ]) {
      const unsafeArtifacts = artifactSource({ [unsafePath]: 'export {};' });
      await expect(
        verifyBound(certificateFor(unsafeArtifacts), unsafeArtifacts),
      ).resolves.toMatchObject({
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'artifact-path', obligation: 'schema' }),
        ]),
        ok: false,
      });
    }
  });

  it('rejects package bin names that select different code through one portable shim', async () => {
    const evilModule = '@kovojs/server/dist/evil.mjs';
    const artifacts = artifactSource({
      [evilModule]: "import 'node:child_process';",
      [rootModule]: 'export const safe = true;',
    });
    const certificate = certificateFor(artifacts, {
      cap: { [evilModule]: ['process'], [rootModule]: [] },
      roots: [{ module: rootModule, rootKind: 'application' }],
    });

    await expect(
      verifyBound(certificate, artifacts, {
        packages: [
          {
            manifest: {
              bin: { KOVO: './dist/root.mjs', kovo: './dist/evil.mjs' },
              name: '@kovojs/server',
            },
            name: '@kovojs/server',
          },
        ],
      }),
    ).resolves.toMatchObject({
      findings: expect.arrayContaining([
        expect.objectContaining({ code: 'policy-manifest-entrypoint', obligation: 'schema' }),
      ]),
      ok: false,
    });

    await expect(
      verifyBound(certificate, artifacts, {
        packages: [
          {
            manifest: {
              bin: { kovo: './dist/root.mjs', 'kovo.cmd': './dist/evil.mjs' },
              name: '@kovojs/server',
            },
            name: '@kovojs/server',
          },
        ],
      }),
    ).resolves.toMatchObject({
      findings: expect.arrayContaining([
        expect.objectContaining({ code: 'policy-manifest-entrypoint', obligation: 'schema' }),
      ]),
      ok: false,
    });
  });

  it('rejects package leaves reserved by supported filesystems', async () => {
    const reservedModule = '@kovojs/con/dist/root.mjs';
    const artifacts = artifactSource({ [reservedModule]: 'export const root = true;' });

    await expect(verifyBound(certificateFor(artifacts), artifacts)).resolves.toMatchObject({
      findings: expect.arrayContaining([
        expect.objectContaining({ code: 'artifact-path', obligation: 'schema' }),
        expect.objectContaining({ code: 'policy-package', obligation: 'schema' }),
      ]),
      ok: false,
    });
  });

  it('bounds recursive certificate and policy JSON before canonicalization', async () => {
    const artifacts = artifactSource({ [rootModule]: 'export {};' });
    const valid = certificateFor(artifacts);
    const cap: Record<string, readonly []> = {};
    for (let index = 0; index < 131_072; index += 1) {
      cap[`@kovojs/server/dist/budget-${index}.mjs`] = [];
    }
    await expect(verifyBound({ ...valid, cap }, artifacts)).resolves.toMatchObject({
      findings: expect.arrayContaining([expect.objectContaining({ code: 'json-nodes' })]),
      ok: false,
    });

    let nested: unknown = 'leaf';
    for (let depth = 0; depth < 66; depth += 1) nested = { a: nested };
    const policy = policyBytesFor(valid, artifacts, {
      packages: [
        {
          manifest: { a: nested, name: '@kovojs/server' },
          name: '@kovojs/server',
        },
      ],
    });
    await expect(verifyCertificate(valid, policy, artifacts)).resolves.toMatchObject({
      findings: expect.arrayContaining([expect.objectContaining({ code: 'json-depth' })]),
      ok: false,
    });
  });

  it('renders one byte-stable report with obligation-tagged failures', async () => {
    const artifacts = artifactSource({ [rootModule]: "import 'node:process';" });
    const result = await verifyBound(
      certificateFor(artifacts, { cap: { [rootModule]: [] } }),
      artifacts,
    );
    expect(formatCertificateVerification(result)).toBe(
      [
        'kovo-verify/v1 FAIL artifacts=1 edges=0 roots=0 doors=0 opaque=0 capabilities=0 findings=1',
        'STABILITY local-capability-missing @kovojs/server/dist/root.mjs imports raw capability process absent from cap summary',
        '',
      ].join('\n'),
    );
  });
});

function certificateFor(
  artifacts: KovoCertificateArtifactSource,
  overrides: Partial<KovoCertificateV1> = {},
): KovoCertificateV1 {
  const paths = [...artifacts.listArtifactPaths()].sort();
  const certificate = {
    artifacts: paths,
    cap: Object.fromEntries(paths.map((path) => [path, []])),
    domain: KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
    doors: [],
    edges: [],
    opaque: [],
    policySha512: sha512(Buffer.alloc(0)),
    roots: [],
    schema: 'kovo.certificate/v1',
    ...overrides,
  };
  const policyBytes = policyBytesFor(certificate, artifacts);
  return { ...certificate, policySha512: sha512(policyBytes) };
}

async function verifyBound(
  certificate: KovoCertificateV1,
  artifacts: KovoCertificateArtifactSource,
  policyOverrides: Partial<KovoCertificatePolicyV1> = {},
) {
  const policyBytes = policyBytesFor(certificate, artifacts, policyOverrides);
  const bound =
    Object.keys(policyOverrides).length === 0
      ? certificate
      : { ...certificate, policySha512: sha512(policyBytes) };
  return await verifyCertificate(bound, policyBytes, artifacts);
}

function policyBytesFor(
  certificate: Pick<KovoCertificateV1, 'artifacts' | 'doors' | 'opaque' | 'roots'>,
  artifactSource: KovoCertificateArtifactSource,
  overrides: Partial<KovoCertificatePolicyV1> = {},
): Buffer {
  const artifactPaths = certificate.artifacts;
  const packageNames = [
    ...new Set(artifactPaths.map((entry) => entry.split('/').slice(0, 2).join('/'))),
  ].sort();
  const policy: KovoCertificatePolicyV1 = {
    artifacts: artifactPaths.map((path) => ({
      path,
      sha512: sha512(artifactSource.readArtifact(path) ?? Buffer.alloc(0)),
    })),
    doors: certificate.doors,
    opaque: certificate.opaque,
    packages: packageNames.map((name) => ({
      manifest: { name },
      name,
    })),
    roots: certificate.roots,
    schema: 'kovo.certificate-policy/v1',
    ...overrides,
  };
  return Buffer.from(`${JSON.stringify(policy, null, 2)}\n`, 'utf8');
}

function artifactSource(sources: Record<string, string>): KovoCertificateArtifactSource {
  const bytes = new Map(
    Object.entries(sources).map(([path, source]) => [path, Buffer.from(source, 'utf8')]),
  );
  return {
    listArtifactPaths: () => [...bytes.keys()].sort(),
    readArtifact: (path) => bytes.get(path),
  };
}

function sha512(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}
