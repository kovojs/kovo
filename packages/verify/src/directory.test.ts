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
  // @kovo-security-classifier-corpus certificate-verifier
  it('verifies an exact unpacked package dist tree', async () => {
    const fixture = createDirectoryFixture({
      '@kovojs/server/dist/index.mjs': "export { value } from './value.mjs';",
      '@kovojs/server/dist/value.mjs': 'export const value = 1;',
    });
    const policy = policyBytes(fixture.sources, fixture.root);
    writeFileSync(path.join(fixture.root, '@kovojs/server/README.md'), '# Server\n');
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

  it('rejects an executable added after the initial package-tree census', async () => {
    const fixture = createDirectoryFixture({
      '@kovojs/server/dist/index.mjs': 'export {};',
    });
    const policy = policyBytes(fixture.sources, fixture.root);
    const manifest = certificate(fixture.sources, policy);
    queueMicrotask(() => {
      writeFileSync(
        path.join(fixture.root, '@kovojs/server/postinstall.js'),
        "require('node:child_process');",
      );
    });

    await expect(verifyCertificateDirectory(manifest, policy, fixture.root)).resolves.toMatchObject(
      {
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'artifact-tree-mutated' }),
          expect.objectContaining({ code: 'unsupported-executable-artifact' }),
        ]),
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
      path.join(fixture.root, '@kovojs/server/postinstall.js'),
      "require('node:child_process');",
    );
    await expect(verifyCertificateDirectory(manifest, policy, fixture.root)).resolves.toMatchObject(
      {
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'unsupported-executable-artifact' }),
        ]),
        ok: false,
      },
    );
    rmSync(path.join(fixture.root, '@kovojs/server/postinstall.js'));

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

  it('bounds directory-only trees and rejects nested node_modules scopes', async () => {
    const fixture = createDirectoryFixture({
      '@kovojs/server/dist/index.mjs': 'export const safe = true;',
    });
    const policy = policyBytes(fixture.sources, fixture.root);
    const manifest = certificate(fixture.sources, policy);
    const nestedModules = path.join(fixture.root, '@kovojs/server/dist/node_modules');
    mkdirSync(nestedModules);
    await expect(verifyCertificateDirectory(manifest, policy, fixture.root)).resolves.toMatchObject(
      {
        findings: expect.arrayContaining([expect.objectContaining({ code: 'artifact-list' })]),
        ok: false,
      },
    );
    rmSync(nestedModules, { recursive: true });

    const emptyRoot = path.join(fixture.root, '@kovojs/server/dist/empty');
    mkdirSync(emptyRoot);
    for (let index = 0; index < 4_094; index += 1) {
      mkdirSync(path.join(emptyRoot, String(index)));
    }
    await expect(verifyCertificateDirectory(manifest, policy, fixture.root)).resolves.toMatchObject(
      {
        findings: expect.arrayContaining([expect.objectContaining({ code: 'artifact-list' })]),
        ok: false,
      },
    );
  });

  it('rejects case-folded node_modules scopes before cross-platform package resolution', async () => {
    const rootModule = '@kovojs/server/dist/root.mjs';
    const hiddenModule = '@kovojs/server/dist/NODE_MODULES/evil/index.mjs';
    const fixture = createDirectoryFixture({
      [hiddenModule]: "import 'node:child_process';",
      [rootModule]: "import 'evil/index.mjs';",
    });
    writeFileSync(
      path.join(fixture.root, '@kovojs/server/package.json'),
      JSON.stringify({ exports: { '.': './dist/root.mjs' }, name: '@kovojs/server' }),
    );
    const policy = policyBytes(fixture.sources, fixture.root);
    const base = certificate(fixture.sources, policy);
    const manifest: KovoCertificateV1 = {
      ...base,
      cap: { ...base.cap, [hiddenModule]: ['process'] },
      opaque: [
        {
          module: rootModule,
          reason:
            'imports external module "evil/index.mjs" outside the nine-kind lexical capability domain',
        },
      ],
    };
    const boundPolicy = policyBytesForCertificate(fixture.sources, fixture.root, manifest);
    const boundManifest = { ...manifest, policySha512: integrity(boundPolicy) };

    await expect(
      verifyCertificateDirectory(boundManifest, boundPolicy, fixture.root),
    ).resolves.toMatchObject({
      findings: expect.arrayContaining([expect.objectContaining({ code: 'artifact-list' })]),
      ok: false,
    });
  });

  it('rejects Windows trailing-dot node_modules aliases before package resolution', async () => {
    const rootModule = '@kovojs/server/dist/root.mjs';
    const hiddenModule = '@kovojs/server/dist/node_modules./evil/index.mjs';
    const fixture = createDirectoryFixture({
      [hiddenModule]: "import 'node:child_process';",
      [rootModule]: "import 'evil/index.mjs';",
    });
    writeFileSync(
      path.join(fixture.root, '@kovojs/server/package.json'),
      JSON.stringify({ exports: { '.': './dist/root.mjs' }, name: '@kovojs/server' }),
    );
    const policy = policyBytes(fixture.sources, fixture.root);
    const base = certificate(fixture.sources, policy);
    const manifest: KovoCertificateV1 = {
      ...base,
      cap: { ...base.cap, [hiddenModule]: ['process'] },
      opaque: [
        {
          module: rootModule,
          reason:
            'imports external module "evil/index.mjs" outside the nine-kind lexical capability domain',
        },
      ],
      roots: [{ module: rootModule, rootKind: 'application' }],
    };
    const boundPolicy = policyBytesForCertificate(fixture.sources, fixture.root, manifest);
    const boundManifest = { ...manifest, policySha512: integrity(boundPolicy) };

    await expect(
      verifyCertificateDirectory(boundManifest, boundPolicy, fixture.root),
    ).resolves.toMatchObject({
      findings: expect.arrayContaining([expect.objectContaining({ code: 'artifact-path' })]),
      ok: false,
    });
  });

  it.each(['NoDe_MoDuLeS...', 'node_modules ', 'node_moduleſ', 'ｎｏｄｅ＿ｍｏｄｕｌｅｓ'])(
    'rejects the portable filesystem-equivalent resolver scope %j',
    async (resolverScope) => {
      const fixture = createDirectoryFixture({
        '@kovojs/server/dist/index.mjs': 'export const safe = true;',
      });
      const policy = policyBytes(fixture.sources, fixture.root);
      const manifest = certificate(fixture.sources, policy);
      mkdirSync(path.join(fixture.root, '@kovojs/server/dist', resolverScope));

      await expect(
        verifyCertificateDirectory(manifest, policy, fixture.root),
      ).resolves.toMatchObject({
        findings: expect.arrayContaining([expect.objectContaining({ code: 'artifact-list' })]),
        ok: false,
      });
    },
  );

  it('rejects portable aliases discovered by the real package-tree census', async () => {
    const fixture = createDirectoryFixture({
      '@kovojs/server/dist/index.mjs': 'export const safe = true;',
    });
    const policy = policyBytes(fixture.sources, fixture.root);
    const manifest = certificate(fixture.sources, policy);
    mkdirSync(path.join(fixture.root, '@kovojs/server/dist/scope'));
    mkdirSync(path.join(fixture.root, '@kovojs/server/dist/ＳＣＯＰＥ'));

    await expect(verifyCertificateDirectory(manifest, policy, fixture.root)).resolves.toMatchObject(
      {
        findings: expect.arrayContaining([expect.objectContaining({ code: 'artifact-list' })]),
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

    writeFileSync(
      path.join(fixture.root, '@kovojs/server/package.json'),
      JSON.stringify({
        exports: { '.': { import: './dist/index.mjs', default: null } },
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

  it('rejects executable targets hidden behind type-oriented export conditions', async () => {
    const safeModule = '@kovojs/server/dist/safe.mjs';
    const runtimeModule = '@kovojs/server/dist/types-evil.mjs';
    const fixture = createDirectoryFixture({
      [safeModule]: 'export const safe = true;',
      [runtimeModule]: "import 'node:child_process';",
    });
    writeFileSync(
      path.join(fixture.root, '@kovojs/server/package.json'),
      JSON.stringify({
        exports: { '.': { types: './dist/types-evil.mjs', default: './dist/safe.mjs' } },
        name: '@kovojs/server',
      }),
    );
    const policy = policyBytes(fixture.sources, fixture.root);
    const base = certificate(fixture.sources, policy);
    const manifest: KovoCertificateV1 = {
      ...base,
      cap: { ...base.cap, [runtimeModule]: ['process'] },
    };

    await expect(verifyCertificateDirectory(manifest, policy, fixture.root)).resolves.toMatchObject(
      {
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'policy-manifest-entrypoint' }),
        ]),
        ok: false,
      },
    );
  });

  it('rejects executable targets hidden behind versioned type import conditions', async () => {
    const rootModule = '@kovojs/server/dist/index.mjs';
    const safeModule = '@kovojs/server/dist/safe.mjs';
    const runtimeModule = '@kovojs/server/dist/types-evil.mjs';
    const fixture = createDirectoryFixture({
      [rootModule]: "import '#target';",
      [safeModule]: 'export const safe = true;',
      [runtimeModule]: "import 'node:child_process';",
    });
    writeFileSync(
      path.join(fixture.root, '@kovojs/server/package.json'),
      JSON.stringify({
        exports: { '.': './dist/index.mjs' },
        imports: {
          '#target': { 'types@>=5.0': './dist/types-evil.mjs', default: './dist/safe.mjs' },
        },
        name: '@kovojs/server',
      }),
    );
    const policy = policyBytes(fixture.sources, fixture.root);
    const base = certificate(fixture.sources, policy, [[rootModule, safeModule]]);
    const manifest: KovoCertificateV1 = {
      ...base,
      cap: { ...base.cap, [runtimeModule]: ['process'] },
    };

    await expect(verifyCertificateDirectory(manifest, policy, fixture.root)).resolves.toMatchObject(
      {
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'policy-manifest-entrypoint' }),
        ]),
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

  it('models exact package imports while rejecting browser remaps', async () => {
    const fixture = createDirectoryFixture({
      '@kovojs/server/dist/index.mjs': "export { worker } from '#worker';",
      '@kovojs/server/dist/worker.mjs': 'export const worker = true;',
    });
    writeFileSync(
      path.join(fixture.root, '@kovojs/server/package.json'),
      JSON.stringify({
        exports: { '.': './dist/index.mjs' },
        imports: { '#worker': './dist/worker.mjs' },
        name: '@kovojs/server',
      }),
    );
    const policy = policyBytes(fixture.sources, fixture.root);
    await expect(
      verifyCertificateDirectory(
        certificate(fixture.sources, policy, [
          ['@kovojs/server/dist/index.mjs', '@kovojs/server/dist/worker.mjs'],
        ]),
        policy,
        fixture.root,
      ),
    ).resolves.toMatchObject({ ok: true });

    writeFileSync(
      path.join(fixture.root, '@kovojs/server/package.json'),
      JSON.stringify({
        browser: { './dist/index.mjs': './dist/worker.mjs' },
        exports: { '.': './dist/index.mjs' },
        name: '@kovojs/server',
      }),
    );
    const browserPolicy = policyBytes(fixture.sources, fixture.root);
    await expect(
      verifyCertificateDirectory(
        certificate(fixture.sources, browserPolicy),
        browserPolicy,
        fixture.root,
      ),
    ).resolves.toMatchObject({
      findings: expect.arrayContaining([
        expect.objectContaining({ code: 'policy-manifest-entrypoint' }),
      ]),
      ok: false,
    });
  });

  it('rejects URL-encoded artifact aliases that Node resolves to different bytes', async () => {
    const rootModule = '@kovojs/server/dist/a/index.mjs';
    const encodedModule = '@kovojs/server/dist/a/%2e%2e/evil.mjs';
    const runtimeModule = '@kovojs/server/dist/evil.mjs';
    const fixture = createDirectoryFixture({
      [encodedModule]: 'export const harmless = true;',
      [rootModule]: "import './%2e%2e/evil.mjs';",
      [runtimeModule]: "import 'node:child_process';",
    });
    writeFileSync(
      path.join(fixture.root, '@kovojs/server/package.json'),
      JSON.stringify({
        exports: { '.': './dist/a/index.mjs' },
        name: '@kovojs/server',
      }),
    );
    const policy = policyBytes(fixture.sources, fixture.root);
    const base = certificate(fixture.sources, policy, [[rootModule, encodedModule]]);
    const manifest: KovoCertificateV1 = {
      ...base,
      cap: { ...base.cap, [runtimeModule]: ['process'] },
    };

    await expect(verifyCertificateDirectory(manifest, policy, fixture.root)).resolves.toMatchObject(
      {
        findings: expect.arrayContaining([expect.objectContaining({ code: 'policy-artifact' })]),
        ok: false,
      },
    );
  });

  it('rejects percent-encoded package-import targets even when the alias is unused', async () => {
    const fixture = createDirectoryFixture({
      '@kovojs/server/dist/index.mjs': 'export const safe = true;',
    });
    writeFileSync(
      path.join(fixture.root, '@kovojs/server/package.json'),
      JSON.stringify({
        exports: { '.': './dist/index.mjs' },
        imports: { '#hidden': './dist/s%61fe.mjs' },
        name: '@kovojs/server',
      }),
    );
    const policy = policyBytes(fixture.sources, fixture.root);

    await expect(
      verifyCertificateDirectory(certificate(fixture.sources, policy), policy, fixture.root),
    ).resolves.toMatchObject({
      findings: expect.arrayContaining([
        expect.objectContaining({ code: 'policy-manifest-entrypoint' }),
      ]),
      ok: false,
    });
  });

  it('rejects nested scopes that shadow package imports and self-references', async () => {
    const rootModule = '@kovojs/server/dist/a/index.mjs';
    const safeModule = '@kovojs/server/dist/a/safe.mjs';
    const runtimeModule = '@kovojs/server/dist/a/evil.mjs';
    const fixture = createDirectoryFixture({
      [rootModule]: "import '#target'; import '@kovojs/server/target';",
      [runtimeModule]: "import 'node:child_process';",
      [safeModule]: 'export const safe = true;',
    });
    writeFileSync(
      path.join(fixture.root, '@kovojs/server/package.json'),
      JSON.stringify({
        exports: { '.': './dist/a/index.mjs', './target': './dist/a/safe.mjs' },
        imports: { '#target': './dist/a/safe.mjs' },
        name: '@kovojs/server',
      }),
    );
    writeFileSync(
      path.join(fixture.root, '@kovojs/server/dist/a/package.json'),
      JSON.stringify({
        exports: { './target': './evil.mjs' },
        imports: { '#target': './evil.mjs' },
        name: '@kovojs/server',
      }),
    );
    const policy = policyBytes(fixture.sources, fixture.root);
    const base = certificate(fixture.sources, policy, [[rootModule, safeModule]]);
    const manifest: KovoCertificateV1 = {
      ...base,
      cap: { ...base.cap, [runtimeModule]: ['process'] },
    };

    await expect(verifyCertificateDirectory(manifest, policy, fixture.root)).resolves.toMatchObject(
      {
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'unsupported-executable-artifact' }),
        ]),
        ok: false,
      },
    );
  });

  it('rejects automatic package lifecycle scripts even when reviewer policy repeats them', async () => {
    const fixture = createDirectoryFixture({
      '@kovojs/server/dist/index.mjs': 'export const safe = true;',
    });
    writeFileSync(
      path.join(fixture.root, '@kovojs/server/package.json'),
      JSON.stringify({
        exports: { '.': './dist/index.mjs' },
        name: '@kovojs/server',
        scripts: { postinstall: 'node ./dist/index.mjs' },
      }),
    );
    const policy = policyBytes(fixture.sources, fixture.root);
    await expect(
      verifyCertificateDirectory(certificate(fixture.sources, policy), policy, fixture.root),
    ).resolves.toMatchObject({
      findings: expect.arrayContaining([
        expect.objectContaining({ code: 'policy-manifest-entrypoint' }),
      ]),
      ok: false,
    });
  });

  it('rejects publish and postpublish lifecycle authority', async () => {
    for (const lifecycle of ['publish', 'postpublish']) {
      const fixture = createDirectoryFixture({
        '@kovojs/server/dist/index.mjs': 'export const safe = true;',
      });
      writeFileSync(
        path.join(fixture.root, '@kovojs/server/package.json'),
        JSON.stringify({
          exports: { '.': './dist/index.mjs' },
          name: '@kovojs/server',
          scripts: { [lifecycle]: 'node ./dist/index.mjs' },
        }),
      );
      const policy = policyBytes(fixture.sources, fixture.root);
      await expect(
        verifyCertificateDirectory(certificate(fixture.sources, policy), policy, fixture.root),
      ).resolves.toMatchObject({
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'policy-manifest-entrypoint' }),
        ]),
        ok: false,
      });
    }
  });

  it('binds the complete installed dependency and lifecycle manifest surface', async () => {
    const fixture = createDirectoryFixture({
      '@kovojs/server/dist/index.mjs': 'export const safe = true;',
    });
    const policy = policyBytes(fixture.sources, fixture.root);
    const manifest = certificate(fixture.sources, policy);
    writeFileSync(
      path.join(fixture.root, '@kovojs/server/package.json'),
      JSON.stringify({
        dependencies: { attacker: '1.0.0' },
        exports: { '.': './dist/index.mjs' },
        name: '@kovojs/server',
        scripts: { postinstall: 'node ./dist/index.mjs' },
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
  return policyBytesForCertificate(sources, root, {
    doors: [],
    opaque: [],
    roots: [],
  });
}

function policyBytesForCertificate(
  sources: Record<string, string>,
  root: string,
  certificate: Pick<KovoCertificateV1, 'doors' | 'opaque' | 'roots'>,
): Buffer {
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
      sortJsonValue({
        artifacts: artifactPaths.map((artifactPath) => ({
          path: artifactPath,
          sha512: integrity(Buffer.from(sources[artifactPath]!)),
        })),
        doors: certificate.doors,
        opaque: certificate.opaque,
        packages,
        roots: certificate.roots,
        schema: 'kovo.certificate-policy/v1',
      }),
      null,
      2,
    )}\n`,
  );
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortJsonValue(entry));
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortJsonValue(record[key])]),
    );
  }
  return value;
}

function integrity(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}
