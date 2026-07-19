import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  formatCertificateVerification,
  KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
  type KovoCertificateArtifactSource,
  type KovoCertificateV1,
  verifyCertificate,
} from './index.js';

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

    await expect(verifyCertificate(certificate, artifacts)).resolves.toMatchObject({
      findings: [],
      ok: true,
      stats: { artifacts: 2, edges: 1, roots: 1 },
    });
  });

  it('fails injected child_process bytes without regeneration on coverage only', async () => {
    const original = artifactSource({ [rootModule]: 'export const root = true;' });
    const certificate = certificateFor(original, { cap: { [rootModule]: [] } });
    const injected = artifactSource({
      [rootModule]: "import 'node:child_process';\nexport const root = true;",
    });

    const result = await verifyCertificate(certificate, injected);
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

    const result = await verifyCertificate(certificate, artifacts);
    expect(result.findings.map((finding) => finding.obligation)).toEqual(['coverage']);
    expect(result.findings[0]).toMatchObject({ code: 'edge-missing' });
  });

  it('fails a dropped imported local capability on stability only', async () => {
    const artifacts = artifactSource({
      [rootModule]: "import 'node:child_process';\nexport const root = true;",
    });
    const certificate = certificateFor(artifacts, { cap: { [rootModule]: [] } });

    const result = await verifyCertificate(certificate, artifacts);
    expect(result.findings.map((finding) => finding.obligation)).toEqual(['stability']);
    expect(result.findings[0]).toMatchObject({ code: 'local-capability-missing' });
    expect(result.findings[0]?.message).toContain('process');
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
    const unstableResult = await verifyCertificate(unstable, artifacts);
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
    const unclosedResult = await verifyCertificate(unclosed, artifacts);
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

    await expect(verifyCertificate(certificate, artifacts)).resolves.toMatchObject({ ok: true });
  });

  it('fails exact artifact coverage, computed imports, and unresolved relative imports', async () => {
    const one = artifactSource({ [rootModule]: 'export {};' });
    const extra = artifactSource({
      [rootModule]: 'export {};',
      [workerModule]: 'export {};',
    });
    expect((await verifyCertificate(certificateFor(one), extra)).findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'artifact-unlisted' })]),
    );

    const computed = artifactSource({
      [rootModule]: 'export const load = (name) => import(name);',
    });
    expect((await verifyCertificate(certificateFor(computed), computed)).findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'computed-import' })]),
    );

    const unresolved = artifactSource({ [rootModule]: "import './missing.mjs';" });
    expect((await verifyCertificate(certificateFor(unresolved), unresolved)).findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'edge-unresolved' })]),
    );
  });

  it('rejects schema drift, inherited carriers, non-canonical paths, and duplicate rows', async () => {
    const artifacts = artifactSource({ [rootModule]: 'export {};' });
    const valid = certificateFor(artifacts);
    const inherited = Object.assign(Object.create({ schema: 'kovo.certificate/v1' }), valid);
    delete inherited.schema;

    for (const malformed of [
      { ...valid, extra: true },
      { ...valid, domain: [...KOVO_CERTIFICATE_CAPABILITY_DOMAIN, 'socket'] },
      { ...valid, artifacts: [{ ...valid.artifacts[0]!, path: '../root.mjs' }] },
      { ...valid, artifacts: [valid.artifacts[0]!, valid.artifacts[0]!] },
      inherited,
    ]) {
      const result = await verifyCertificate(malformed, artifacts);
      expect(result.ok).toBe(false);
      expect(result.findings.every((finding) => finding.obligation === 'schema')).toBe(true);
    }
  });

  it('renders one byte-stable report with obligation-tagged failures', async () => {
    const artifacts = artifactSource({ [rootModule]: "import 'node:process';" });
    const result = await verifyCertificate(
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
  const artifactRows = paths.map((path) => ({
    path,
    sha512: sha512(artifacts.readArtifact(path)!),
  }));
  return {
    artifacts: artifactRows,
    cap: Object.fromEntries(paths.map((path) => [path, []])),
    domain: KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
    doors: [],
    edges: [],
    opaque: [],
    roots: [],
    schema: 'kovo.certificate/v1',
    ...overrides,
  };
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
