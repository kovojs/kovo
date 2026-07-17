import { describe, expect, it } from 'vitest';

import {
  assertSnapshotMatches,
  collectFirstPartyScopes,
  collectManifestTargets,
  normalizePackedPath,
  parsePackJson,
  validateBetterAuthMountAuthorityPack,
  validateFirstPartyScopeRegistryPolicy,
  validatePackedPackage,
} from './check-pack-security.mjs';

function validateFixture(files, overrides = {}) {
  const text = new Map(
    files.map((file) => [file.path, typeof file.text === 'string' ? file.text : '']),
  );
  return validatePackedPackage({
    files: files.map((file) => ({
      path: file.path,
      size: file.size ?? Buffer.byteLength(file.text ?? ''),
    })),
    manifest: overrides.manifest ?? {
      exports: { '.': { default: './dist/index.mjs', types: './dist/index.d.mts' } },
    },
    packageName: overrides.packageName ?? '@kovojs/example',
    readTextFile: (rel) => text.get(rel),
    allowedSourceFiles: overrides.allowedSourceFiles ?? [],
    targetFiles: overrides.targetFiles ?? ['dist/index.d.mts', 'dist/index.mjs'],
  });
}

describe('pack-security gate', () => {
  it('keeps the Better Auth mount-adapter mint unreachable in the packed exports map', () => {
    const safeManifest = {
      exports: {
        '.': { default: './dist/index.mjs', types: './dist/index.d.mts' },
        './internal/server-mount-adapter': {
          default: './dist/internal/server-mount-adapter.mjs',
          types: './dist/internal/server-mount-adapter.d.mts',
        },
      },
    };
    const safeFiles = new Map([
      [
        'dist/internal/server-mount-adapter.mjs',
        'export { assertBetterAuthMountAdapter, invokeBetterAuthMountAdapter };',
      ],
      [
        'dist/internal/server-mount-adapter.d.mts',
        'export { type BetterAuthMountAdapter, assertBetterAuthMountAdapter, invokeBetterAuthMountAdapter };',
      ],
    ]);

    expect(
      validateBetterAuthMountAuthorityPack({
        manifest: safeManifest,
        readTextFile: (rel) => safeFiles.get(rel),
      }),
    ).toEqual([]);

    const unsafeManifest = {
      exports: {
        ...safeManifest.exports,
        './*': './dist/*.mjs',
        './adapter-authority': './dist/mount-adapter-private.mjs',
        './mount-adapter': './dist/mount-adapter.mjs',
      },
    };
    safeFiles.set(
      'dist/internal/server-mount-adapter.mjs',
      'export { createBetterAuthMountAdapter };',
    );
    const findings = validateBetterAuthMountAuthorityPack({
      manifest: unsafeManifest,
      readTextFile: (rel) => safeFiles.get(rel),
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('must not contain a wildcard'),
        expect.stringContaining('export ./adapter-authority targets the private mount-adapter'),
        expect.stringContaining('forbidden mount-adapter subpath ./mount-adapter'),
        expect.stringContaining('exposes the private adapter mint'),
      ]),
    );
  });

  it('rejects leaked environment files, test fixtures, and unexpected source files', () => {
    const findings = validateFixture([
      { path: 'package.json', text: '{}' },
      { path: 'dist/index.mjs', text: 'export {};' },
      { path: 'dist/index.d.mts', text: 'export {};' },
      { path: '.env', text: 'TOKEN=do-not-ship' },
      { path: 'dist/__fixtures__/payload.json', text: '{}' },
      { path: 'dist/debug.ts', text: 'export const debug = true;' },
    ]);

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('environment file .env'),
        expect.stringContaining('__fixtures__ path dist/__fixtures__/payload.json'),
        expect.stringContaining('unexpected top-level tarball file .env'),
        expect.stringContaining('unexpected source file dist/debug.ts'),
      ]),
    );
  });

  it('allows create-kovo to ship starter template source files', () => {
    const findings = validateFixture(
      [
        { path: 'package.json', text: '{}' },
        { path: 'dist/index.mjs', text: 'export {};' },
        { path: 'dist/index.d.mts', text: 'export {};' },
        {
          path: 'templates/src/app.tsx',
          text: 'export function App() { return <main>Hello</main>; }',
        },
        { path: 'templates/package.json', text: '{"name":"{{name}}"}' },
      ],
      { packageName: 'create-kovo' },
    );

    expect(findings).toEqual([]);
  });

  it('allows explicitly modeled UI copy-in source files but rejects adjacent source leaks', () => {
    const findings = validateFixture(
      [
        { path: 'package.json', text: '{}' },
        { path: 'dist/index.mjs', text: 'export {};' },
        { path: 'dist/index.d.mts', text: 'export {};' },
        { path: 'src/button.tsx', text: 'export const Button = null;' },
        { path: 'src/secret.tsx', text: 'export const secret = true;' },
      ],
      {
        allowedSourceFiles: ['src/button.tsx'],
        packageName: '@kovojs/ui',
      },
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('unexpected top-level tarball file src/secret.tsx'),
        expect.stringContaining('unexpected source file src/secret.tsx'),
      ]),
    );
    expect(findings.some((finding) => finding.includes('src/button.tsx'))).toBe(false);
  });

  it('rejects declaration and source maps that expose absolute local paths', () => {
    const findings = validateFixture([
      { path: 'package.json', text: '{}' },
      { path: 'dist/index.mjs', text: 'export {};' },
      { path: 'dist/index.d.mts', text: 'export {};' },
      {
        path: 'dist/index.d.mts.map',
        text: JSON.stringify({
          version: 3,
          sourceRoot: '/Users/mini/kovo/packages/example',
          sources: ['src/index.ts'],
          mappings: '',
        }),
      },
      {
        path: 'dist/chunk.mjs.map',
        text: JSON.stringify({
          version: 3,
          sources: ['file:///Users/mini/kovo/packages/example/src/chunk.ts'],
          mappings: '',
        }),
      },
    ]);

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('dist/index.d.mts.map sourceRoot contains absolute local path'),
        expect.stringContaining('dist/chunk.mjs.map source contains absolute local path'),
      ]),
    );
  });

  it('rejects known and high-entropy secret-like strings', () => {
    const findings = validateFixture([
      { path: 'package.json', text: '{}' },
      { path: 'dist/index.d.mts', text: 'export {};' },
      {
        path: 'dist/index.mjs',
        text: [
          'const key = "AKIA0123456789ABCDEF";',
          'const clientSecret = "Aa0Bb1Cc2Dd3Ee4Ff5Gg6Hh7Ii8Jj9Kk0Ll1Mm2Nn3Oo4Pp5Qq6";',
        ].join('\n'),
      },
    ]);

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('AWS access key id'),
        expect.stringContaining('high-entropy secret-like'),
      ]),
    );
  });

  it('scans uncommon extensions and NUL-bearing packed files for secrets', () => {
    const findings = validateFixture([
      { path: 'package.json', text: '{}' },
      { path: 'dist/index.d.mts', text: 'export {};' },
      { path: 'dist/index.mjs', text: 'export {};' },
      {
        path: 'dist/leaked.pem',
        text: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----',
      },
      { path: 'dist/leaked.bin', text: '\0AKIA0123456789ABCDEF\0' },
    ]);

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('dist/leaked.pem matches private key block'),
        expect.stringContaining('dist/leaked.bin matches AWS access key id'),
      ]),
    );
  });

  it('rejects oversized generated blobs', () => {
    const findings = validateFixture([
      { path: 'package.json', text: '{}' },
      { path: 'dist/index.mjs', text: 'export {};' },
      { path: 'dist/index.d.mts', text: 'export {};' },
      { path: 'dist/large-generated.mjs', size: 16 * 1024 * 1024 + 1, text: '' },
    ]);

    expect(findings).toEqual([expect.stringContaining('oversized packed file')]);
  });

  it('proves publish targets and packed manifest targets are present', () => {
    const findings = validateFixture(
      [
        { path: 'package.json', text: '{}' },
        { path: 'dist/index.mjs', text: 'export {};' },
      ],
      {
        manifest: {
          exports: { '.': { default: './dist/index.mjs', types: './dist/index.d.mts' } },
          bin: { kovo: './dist/bin.mjs' },
        },
        targetFiles: ['dist/index.d.mts', 'dist/index.mjs'],
      },
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('publish target missing from tarball: dist/index.d.mts'),
        expect.stringContaining('packed manifest target missing from tarball: dist/index.d.mts'),
        expect.stringContaining('packed manifest target missing from tarball: dist/bin.mjs'),
      ]),
    );
  });

  it('treats wildcard manifest targets as present when matching packed files exist', () => {
    const findings = validateFixture(
      [
        { path: 'package.json', text: '{}' },
        { path: 'dist/index.mjs', text: 'export {};' },
        { path: 'dist/index.d.mts', text: 'export {};' },
        { path: 'dist/check.mjs', text: 'export {};' },
        { path: 'dist/check.d.mts', text: 'export {};' },
      ],
      {
        manifest: {
          exports: {
            '.': { default: './dist/index.mjs', types: './dist/index.d.mts' },
            './*': { default: './dist/*.mjs', types: './dist/*.d.mts' },
          },
        },
      },
    );

    expect(findings).toEqual([]);
  });

  it('collects nested export and bin manifest targets', () => {
    expect(
      collectManifestTargets({
        exports: {
          '.': {
            types: './dist/index.d.mts',
            default: './dist/index.mjs',
          },
          './generated': './dist/generated.mjs',
        },
        bin: {
          kovo: './dist/bin.mjs',
        },
      }),
    ).toEqual(['dist/bin.mjs', 'dist/generated.mjs', 'dist/index.d.mts', 'dist/index.mjs']);
  });

  it('normalizes npm tarball paths and parses noisy pnpm pack JSON output', () => {
    expect(normalizePackedPath('package/dist/index.mjs')).toBe('dist/index.mjs');
    expect(parsePackJson('lifecycle output\n{"filename":"pkg.tgz"}\n')).toEqual({
      filename: 'pkg.tgz',
    });
  });

  it('collects unique first-party package scopes from workspace names', () => {
    expect(
      collectFirstPartyScopes([
        '@kovojs/core',
        '@kovojs/server',
        '@other-scope/pkg',
        'create-kovo',
      ]),
    ).toEqual(['@kovojs', '@other-scope']);
  });

  it('rejects missing first-party scope registry pins', () => {
    expect(
      validateFirstPartyScopeRegistryPolicy({
        npmConfigText: 'node-options=--experimental-transform-types\n',
        npmConfigPath: '.npmrc',
        packageNames: ['@kovojs/core', 'create-kovo'],
      }),
    ).toEqual([
      '.npmrc: missing @kovojs:registry pin; first-party scope @kovojs must resolve from https://registry.npmjs.org/',
      '.npmrc: missing registry pin; unscoped first-party package create-kovo must resolve from https://registry.npmjs.org/',
    ]);
  });

  it('rejects misconfigured or non-literal first-party scope registry pins', () => {
    expect(
      validateFirstPartyScopeRegistryPolicy({
        npmConfigText: '@kovojs:registry=https://mirror.example.invalid/\n',
        npmConfigPath: '.npmrc',
        packageNames: ['@kovojs/core'],
      }),
    ).toEqual([
      '.npmrc: @kovojs:registry must resolve to https://registry.npmjs.org/; got https://mirror.example.invalid/',
    ]);

    expect(
      validateFirstPartyScopeRegistryPolicy({
        npmConfigText: '@kovojs:registry=${KOVO_REGISTRY}\n',
        npmConfigPath: '.npmrc',
        packageNames: ['@kovojs/core'],
      }),
    ).toEqual(['.npmrc: @kovojs:registry must be a literal registry URL; got "${KOVO_REGISTRY}"']);
  });

  it('accepts an explicit npmjs pin for first-party scopes', () => {
    expect(
      validateFirstPartyScopeRegistryPolicy({
        npmConfigText: '@kovojs:registry=https://registry.npmjs.org\n',
        npmConfigPath: '.npmrc',
        packageNames: ['@kovojs/core'],
      }),
    ).toEqual([]);
  });

  it('rejects registry drift for unscoped first-party packages', () => {
    expect(
      validateFirstPartyScopeRegistryPolicy({
        npmConfigText:
          'registry=https://mirror.example.invalid/\n@kovojs:registry=https://registry.npmjs.org/\n',
        npmConfigPath: '.npmrc',
        packageNames: ['@kovojs/core', 'create-kovo'],
      }),
    ).toEqual([
      '.npmrc: registry must resolve to https://registry.npmjs.org/; got https://mirror.example.invalid/',
    ]);

    expect(
      validateFirstPartyScopeRegistryPolicy({
        npmConfigText:
          'registry=https://registry.npmjs.org/\n@kovojs:registry=https://registry.npmjs.org/\n',
        npmConfigPath: '.npmrc',
        packageNames: ['@kovojs/core', 'create-kovo'],
      }),
    ).toEqual([]);
  });

  it('fails closed when the tarball file snapshot drifts', () => {
    expect(() =>
      assertSnapshotMatches(
        { packages: { '@kovojs/core': ['package.json', 'dist/index.mjs'] } },
        { packages: { '@kovojs/core': ['package.json'] } },
      ),
    ).toThrow('Pack-security file snapshot drifted');
  });
});
