import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
    await expect(
      verifyCertificateDirectory(
        certificate(fixture.sources, [
          ['@kovojs/server/dist/index.mjs', '@kovojs/server/dist/value.mjs'],
        ]),
        fixture.root,
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it('fails closed on an unlisted module or symlink in a certified package dist', async () => {
    const fixture = createDirectoryFixture({
      '@kovojs/server/dist/index.mjs': 'export {};',
    });
    const manifest = certificate(fixture.sources);
    writeFileSync(path.join(fixture.root, '@kovojs/server/dist/unlisted.mjs'), 'export {};');
    await expect(verifyCertificateDirectory(manifest, fixture.root)).resolves.toMatchObject({
      findings: expect.arrayContaining([expect.objectContaining({ code: 'artifact-unlisted' })]),
      ok: false,
    });

    rmSync(path.join(fixture.root, '@kovojs/server/dist/unlisted.mjs'));
    symlinkSync(
      path.join(fixture.root, '@kovojs/server/dist/index.mjs'),
      path.join(fixture.root, '@kovojs/server/dist/linked.mjs'),
    );
    await expect(verifyCertificateDirectory(manifest, fixture.root)).resolves.toMatchObject({
      findings: expect.arrayContaining([expect.objectContaining({ code: 'artifact-list' })]),
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
        exports: {
          './internal/runtime-metadata': {
            default: './dist/runtime-metadata-internal.mjs',
            types: './dist/runtime-metadata-internal.d.mts',
          },
        },
      }),
    );
    const result = await verifyCertificateDirectory(
      certificate(fixture.sources, [
        ['@kovojs/server/dist/index.mjs', '@kovojs/drizzle/dist/runtime-metadata-internal.mjs'],
      ]),
      fixture.root,
    );
    expect(result, JSON.stringify(result.findings, null, 2)).toMatchObject({ ok: true });
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
  return { root, sources };
}

function certificate(
  sources: Record<string, string>,
  edges: readonly (readonly [string, string])[] = [],
): KovoCertificateV1 {
  const paths = Object.keys(sources).sort();
  return {
    artifacts: paths.map((artifactPath) => ({
      path: artifactPath,
      sha512: `sha512-${createHash('sha512').update(sources[artifactPath]!).digest('base64')}`,
    })),
    cap: Object.fromEntries(paths.map((artifactPath) => [artifactPath, []])),
    domain: KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
    doors: [],
    edges,
    opaque: [],
    roots: [],
    schema: 'kovo.certificate/v1',
  };
}
