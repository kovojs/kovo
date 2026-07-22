import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
  type KovoCertificateV1,
  verifyCertificateDirectory,
} from './index.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('filesystem certificate artifacts', () => {
  it('verifies an exact unpacked package dist tree', async () => {
    const fixture = createDirectoryFixture({
      '@kovojs/server/dist/index.mjs': "export { value } from './value.mjs';",
      '@kovojs/server/dist/value.mjs': 'export const value = 1;',
    });
    const policy = policyBytes(fixture.sources, fixture.root);
    await expect(
      verifyCertificateDirectory(
        certificate(fixture.sources, policy, [
          ['@kovojs/server/dist/index.mjs', '@kovojs/server/dist/value.mjs'],
        ]),
        policy,
        fixture.root,
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it('fails closed on an unlisted module or symlink in a certified package dist', async () => {
    const fixture = createDirectoryFixture({
      '@kovojs/server/dist/index.mjs': 'export {};',
    });
    const policy = policyBytes(fixture.sources, fixture.root);
    const manifest = certificate(fixture.sources, policy);
    writeFileSync(path.join(fixture.root, '@kovojs/server/dist/unlisted.mjs'), 'export {};');
    await expect(verifyCertificateDirectory(manifest, policy, fixture.root)).resolves.toMatchObject(
      {
        findings: expect.arrayContaining([expect.objectContaining({ code: 'artifact-unlisted' })]),
        ok: false,
      },
    );

    rmSync(path.join(fixture.root, '@kovojs/server/dist/unlisted.mjs'));
    symlinkSync(
      path.join(fixture.root, '@kovojs/server/dist/index.mjs'),
      path.join(fixture.root, '@kovojs/server/dist/linked.mjs'),
    );
    await expect(verifyCertificateDirectory(manifest, policy, fixture.root)).resolves.toMatchObject(
      {
        findings: expect.arrayContaining([expect.objectContaining({ code: 'artifact-list' })]),
        ok: false,
      },
    );
  });

  it('rejects an installed first-party package omitted from reviewer-controlled enumeration', async () => {
    const fixture = createDirectoryFixture({
      '@kovojs/browser/dist/hidden.mjs': "import 'node:child_process';",
      '@kovojs/server/dist/index.mjs': 'export {};',
    });
    const serverSources = {
      '@kovojs/server/dist/index.mjs': fixture.sources['@kovojs/server/dist/index.mjs']!,
    };
    const serverPolicy = policyBytes(serverSources, fixture.root);
    const serverOnlyCertificate = certificate(serverSources, serverPolicy);

    await expect(
      verifyCertificateDirectory(serverOnlyCertificate, serverPolicy, fixture.root),
    ).resolves.toMatchObject({
      findings: expect.arrayContaining([expect.objectContaining({ code: 'package-unlisted' })]),
      ok: false,
    });
  });

  it('independently resolves non-conventional package export targets from the unpacked manifest', async () => {
    const fixture = createDirectoryFixture({
      '@kovojs/drizzle/dist/runtime-metadata-internal.mjs': 'export const metadata = true;',
      '@kovojs/server/dist/index.mjs':
        "import { metadata } from '@kovojs/drizzle/internal/runtime-metadata'; export { metadata };",
    });
    writeFileSync(
      path.join(fixture.root, '@kovojs/drizzle/package.json'),
      JSON.stringify({
        name: '@kovojs/drizzle',
        exports: {
          './internal/runtime-metadata': {
            default: './dist/runtime-metadata-internal.mjs',
            types: './dist/runtime-metadata-internal.d.mts',
          },
        },
      }),
    );
    const policy = policyBytes(fixture.sources, fixture.root);
    const result = await verifyCertificateDirectory(
      certificate(fixture.sources, policy, [
        ['@kovojs/server/dist/index.mjs', '@kovojs/drizzle/dist/runtime-metadata-internal.mjs'],
      ]),
      policy,
      fixture.root,
    );
    expect(result, JSON.stringify(result.findings, null, 2)).toMatchObject({ ok: true });
  });

  it('rejects unlisted executable formats and extensionless manifest targets', async () => {
    const fixture = createDirectoryFixture({
      '@kovojs/server/dist/index.mjs': 'export {};',
    });
    const policy = policyBytes(fixture.sources, fixture.root);
    const manifest = certificate(fixture.sources, policy);
    writeFileSync(
      path.join(fixture.root, '@kovojs/server/dist/backdoor.cjs'),
      'module.exports = 1;',
    );
    await expect(verifyCertificateDirectory(manifest, policy, fixture.root)).resolves.toMatchObject(
      {
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'unsupported-executable-artifact' }),
        ]),
        ok: false,
      },
    );

    rmSync(path.join(fixture.root, '@kovojs/server/dist/backdoor.cjs'));
    writeFileSync(path.join(fixture.root, '@kovojs/server/dist/runner'), '#!/bin/sh\n');
    writeFileSync(
      path.join(fixture.root, '@kovojs/server/package.json'),
      JSON.stringify({
        bin: { kovo: './dist/runner' },
        exports: { '.': './dist/index.mjs' },
        name: '@kovojs/server',
      }),
    );
    await expect(verifyCertificateDirectory(manifest, policy, fixture.root)).resolves.toMatchObject(
      {
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'manifest-invalid' }),
          expect.objectContaining({ code: 'unsupported-executable-artifact' }),
        ]),
        ok: false,
      },
    );
  });

  it('rejects insertion-ordered conditional exports that can select another listed module', async () => {
    const fixture = createDirectoryFixture({
      '@kovojs/server/dist/index.mjs': 'export const safe = true;',
      '@kovojs/server/dist/worker.mjs': "import 'node:child_process';",
    });
    const policy = policyBytes(fixture.sources, fixture.root);
    const manifest = certificate(fixture.sources, policy);
    writeFileSync(
      path.join(fixture.root, '@kovojs/server/package.json'),
      JSON.stringify({
        exports: {
          '.': { node: './dist/worker.mjs', import: './dist/index.mjs' },
        },
        name: '@kovojs/server',
      }),
    );

    await expect(verifyCertificateDirectory(manifest, policy, fixture.root)).resolves.toMatchObject(
      {
        findings: expect.arrayContaining([expect.objectContaining({ code: 'manifest-invalid' })]),
        ok: false,
      },
    );
  });

  it('rejects publishConfig resolver shadowing in an installed manifest', async () => {
    const fixture = createDirectoryFixture({
      '@kovojs/server/dist/index.mjs': 'export const safe = true;',
      '@kovojs/server/dist/worker.mjs': "import 'node:child_process';",
    });
    const policy = policyBytes(fixture.sources, fixture.root);
    const manifest = certificate(fixture.sources, policy);
    writeFileSync(
      path.join(fixture.root, '@kovojs/server/package.json'),
      JSON.stringify({
        exports: { '.': './dist/worker.mjs' },
        name: '@kovojs/server',
        publishConfig: { exports: { '.': './dist/index.mjs' } },
      }),
    );

    await expect(verifyCertificateDirectory(manifest, policy, fixture.root)).resolves.toMatchObject(
      {
        findings: expect.arrayContaining([expect.objectContaining({ code: 'manifest-invalid' })]),
        ok: false,
      },
    );
  });
});

function createDirectoryFixture(sources: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-verify-artifacts-'));
  roots.push(root);
  for (const [relativePath, source] of Object.entries(sources)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source, 'utf8');
  }
  const packageNames = [
    ...new Set(Object.keys(sources).map((entry) => entry.split('/').slice(0, 2).join('/'))),
  ].sort();
  for (const packageName of packageNames) {
    const firstModule = Object.keys(sources)
      .filter((entry) => entry.startsWith(`${packageName}/`))
      .sort()[0]!;
    writeFileSync(
      path.join(root, packageName, 'package.json'),
      JSON.stringify({
        exports: { '.': `./${firstModule.slice(`${packageName}/`.length)}` },
        name: packageName,
      }),
      'utf8',
    );
  }
  return { root, sources };
}

function certificate(
  sources: Record<string, string>,
  policy: Uint8Array,
  edges: readonly (readonly [string, string])[] = [],
): KovoCertificateV1 {
  const paths = Object.keys(sources).sort();
  return {
    artifacts: paths,
    cap: Object.fromEntries(paths.map((artifactPath) => [artifactPath, []])),
    domain: KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
    doors: [],
    edges,
    opaque: [],
    policySha512: integrity(policy),
    roots: [],
    schema: 'kovo.certificate/v1',
  };
}

function policyBytes(sources: Record<string, string>, root: string): Buffer {
  const artifactPaths = Object.keys(sources).sort();
  const packageNames = [
    ...new Set(artifactPaths.map((entry) => entry.split('/').slice(0, 2).join('/'))),
  ].sort();
  const packages = packageNames.map((name) => ({
    manifest: JSON.parse(readFileSync(path.join(root, name, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >,
    name,
  }));
  return Buffer.from(
    `${JSON.stringify(
      {
        artifacts: artifactPaths.map((artifactPath) => ({
          path: artifactPath,
          sha512: integrity(Buffer.from(sources[artifactPath]!)),
        })),
        doors: [],
        opaque: [],
        packages,
        roots: [],
        schema: 'kovo.certificate-policy/v1',
      },
      null,
      2,
    )}\n`,
  );
}

function integrity(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}
