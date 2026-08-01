import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  allowedPublishedSourceFiles,
  assertSnapshotMatches,
  collectFirstPartyScopes,
  collectManifestTargets,
  inspectValidatedPackedEntries,
  normalizePackedPath,
  parsePackJson,
  validateBetterAuthMountAuthorityPack,
  validateFirstPartyScopeRegistryPolicy,
  validatePackedPackage,
  validateSelfContainedVerifierPack,
} from './check-pack-security.mjs';
import { uiVendoredHelperSourcePaths } from './build-publish.mjs';

function validateFixture(files, overrides = {}) {
  const bytes = new Map(
    files.map((file) => [
      file.path,
      Buffer.isBuffer(file.bytes)
        ? file.bytes
        : Buffer.from(typeof file.text === 'string' ? file.text : ''),
    ]),
  );
  return validatePackedPackage({
    files: files.map((file) => ({
      bytes: bytes.get(file.path),
      path: file.path,
      size: file.size ?? bytes.get(file.path).byteLength,
    })),
    manifest: overrides.manifest ?? {
      exports: { '.': { default: './dist/index.mjs', types: './dist/index.d.mts' } },
    },
    packageName: overrides.packageName ?? '@kovojs/example',
    readFileBytes: (rel) => bytes.get(rel),
    readTextFile: (rel) => bytes.get(rel)?.toString('utf8'),
    allowedSourceFiles: overrides.allowedSourceFiles ?? [],
    targetFiles: overrides.targetFiles ?? ['dist/index.d.mts', 'dist/index.mjs'],
  });
}

function createExampleAssetManifest(entries = {}) {
  return {
    examples: Object.fromEntries(
      ['commerce', 'crm'].map((exampleName) => [
        exampleName,
        {
          files: (entries[exampleName] ?? []).map(({ path, source }) => {
            const bytes = Buffer.from(source);
            return {
              bytes: bytes.byteLength,
              path,
              sha256: createHash('sha256').update(bytes).digest('hex'),
            };
          }),
        },
      ]),
    ),
    schema: 'create-kovo-example-assets/v1',
  };
}

function createKovoFixture(entries = {}) {
  const manifest = createExampleAssetManifest(entries);
  return [
    { path: 'package.json', text: '{}' },
    { path: 'dist/index.mjs', text: 'export {};' },
    { path: 'dist/index.d.mts', text: 'export {};' },
    { path: 'dist/examples/manifest.json', text: JSON.stringify(manifest) },
    ...Object.entries(entries).flatMap(([exampleName, files]) =>
      files.map(({ path, source }) => ({
        path: `dist/examples/${exampleName}/${path}`,
        text: source,
      })),
    ),
  ];
}

describe('pack-security gate', () => {
  it('inspects the validated in-memory entry bytes without a system extractor view', () => {
    const packageJson = {
      exports: { '.': './src/index.ts' },
      name: '@kovojs/example',
    };
    const packedManifest = {
      exports: {
        '.': { default: './dist/index.mjs', types: './dist/index.d.mts' },
      },
      name: '@kovojs/example',
      version: '1.2.3',
    };
    const inspected = inspectValidatedPackedEntries({
      entries: [
        { data: Buffer.from(JSON.stringify(packedManifest)), name: 'package/package.json' },
        { data: Buffer.from('export {};'), name: 'package/dist/index.mjs' },
        { data: Buffer.from('export {};'), name: 'package/dist/index.d.mts' },
      ],
      packageJson,
      packageName: packageJson.name,
    });

    expect(inspected.findings).toEqual([]);
    expect(inspected.files.map((file) => file.path)).toEqual([
      'dist/index.d.mts',
      'dist/index.mjs',
      'package.json',
    ]);
    expect(inspected.manifest).toEqual(packedManifest);
  });

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

  it('keeps the standalone verifier parser inside reviewer-authenticated dist bytes', () => {
    expect(
      validateSelfContainedVerifierPack({
        files: [{ path: 'NOTICE' }, { path: 'dist/index.mjs' }],
        manifest: { devDependencies: { acorn: '8.17.0', vitest: '4.1.10' } },
        readTextFile: () => 'export const verify = true;',
      }),
    ).toEqual([]);
    expect(
      validateSelfContainedVerifierPack({
        files: [{ path: 'dist/index.mjs' }, { path: 'dist/dynamic.mjs' }],
        manifest: {
          dependencies: { acorn: '8.17.0' },
          optionalDependencies: { parser: '1.0.0' },
          peerDependencies: { parserHost: '1.0.0' },
        },
        readTextFile: (file) =>
          file === 'dist/index.mjs' ? 'import { parse } from "acorn";' : 'import("acorn");',
      }),
    ).toEqual([
      '@kovojs/verify: packed dependencies must be empty; parser bytes belong in dist',
      '@kovojs/verify: packed optionalDependencies must be empty; parser bytes belong in dist',
      '@kovojs/verify: packed peerDependencies must be empty; parser bytes belong in dist',
      '@kovojs/verify: packed NOTICE must retain the bundled parser license',
      '@kovojs/verify: dist/index.mjs resolves acorn outside reviewer-authenticated dist bytes',
      '@kovojs/verify: dist/dynamic.mjs resolves acorn outside reviewer-authenticated dist bytes',
    ]);
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
        ...createKovoFixture(),
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

  it('allows only create-kovo example sources declared by its exact byte manifest', () => {
    const findings = validateFixture(
      createKovoFixture({
        commerce: [{ path: 'src/app.tsx', source: 'export const App = () => <main />;\n' }],
        crm: [
          { path: 'src/app-shell.ts', source: 'export const shell = true;\n' },
          { path: 'src/styles.css', source: 'main { display: block; }\n' },
        ],
      }),
      { packageName: 'create-kovo' },
    );

    expect(findings).toEqual([]);
  });

  it('fails closed when create-kovo example assets lack a valid exact manifest', () => {
    const missing = validateFixture(
      [
        { path: 'package.json', text: '{}' },
        { path: 'dist/index.mjs', text: 'export {};' },
        { path: 'dist/index.d.mts', text: 'export {};' },
        { path: 'dist/examples/crm/src/model.ts', text: 'export const model = true;\n' },
      ],
      { packageName: 'create-kovo' },
    );
    expect(missing).toEqual(
      expect.arrayContaining([
        'create-kovo: packed example asset manifest is missing',
        expect.stringContaining('unexpected source file dist/examples/crm/src/model.ts'),
      ]),
    );

    const malformedFiles = createKovoFixture({
      crm: [{ path: 'src/model.ts', source: 'export const model = true;\n' }],
    });
    const malformedManifest = malformedFiles.find(
      (file) => file.path === 'dist/examples/manifest.json',
    );
    malformedManifest.text = '{"schema":';
    expect(
      validateFixture(malformedFiles, {
        packageName: 'create-kovo',
      }),
    ).toEqual(
      expect.arrayContaining([
        'create-kovo: packed example asset manifest is malformed JSON',
        expect.stringContaining('unexpected source file dist/examples/crm/src/model.ts'),
      ]),
    );
  });

  it('rejects unexpected example names, unsafe paths, and duplicate declarations', () => {
    const files = createKovoFixture({
      crm: [{ path: 'src/model.ts', source: 'export const model = true;\n' }],
    });
    const manifestFile = files.find((file) => file.path === 'dist/examples/manifest.json');
    const wrongNames = JSON.parse(manifestFile.text);
    wrongNames.examples.admin = { files: [] };
    manifestFile.text = JSON.stringify(wrongNames);
    expect(validateFixture(files, { packageName: 'create-kovo' })).toContain(
      'create-kovo: packed example asset manifest must contain exactly commerce, crm',
    );

    const unsafeFiles = createKovoFixture();
    const unsafeManifestFile = unsafeFiles.find(
      (file) => file.path === 'dist/examples/manifest.json',
    );
    const unsafeManifest = JSON.parse(unsafeManifestFile.text);
    unsafeManifest.examples.crm.files = [
      {
        bytes: 1,
        path: '../secret.ts',
        sha256: 'a'.repeat(64),
      },
    ];
    unsafeManifestFile.text = JSON.stringify(unsafeManifest);
    expect(validateFixture(unsafeFiles, { packageName: 'create-kovo' })).toContain(
      'create-kovo: packed example asset manifest contains unsafe path at crm.files[0]: ../secret.ts',
    );

    const duplicateFiles = createKovoFixture({
      crm: [{ path: 'src/model.ts', source: 'export const model = true;\n' }],
    });
    const duplicateManifestFile = duplicateFiles.find(
      (file) => file.path === 'dist/examples/manifest.json',
    );
    const duplicateManifest = JSON.parse(duplicateManifestFile.text);
    duplicateManifest.examples.crm.files.push(duplicateManifest.examples.crm.files[0]);
    duplicateManifestFile.text = JSON.stringify(duplicateManifest);
    expect(validateFixture(duplicateFiles, { packageName: 'create-kovo' })).toContain(
      'create-kovo: packed example asset manifest duplicates crm/src/model.ts',
    );
  });

  it('rejects duplicate, unlisted, missing, resized, and digest-mutated example assets', () => {
    const source = 'export const model = true;\n';
    const duplicatePackedFiles = createKovoFixture({
      crm: [{ path: 'src/model.ts', source }],
    });
    duplicatePackedFiles.push({
      path: 'dist/examples/crm/src/model.ts',
      text: source,
    });
    expect(validateFixture(duplicatePackedFiles, { packageName: 'create-kovo' })).toContain(
      'create-kovo: packed example asset appears more than once: dist/examples/crm/src/model.ts',
    );

    const unlistedFiles = createKovoFixture({
      crm: [{ path: 'src/model.ts', source }],
    });
    unlistedFiles.push({
      path: 'dist/examples/crm/src/unlisted.json',
      text: '{"not":"declared"}',
    });
    expect(validateFixture(unlistedFiles, { packageName: 'create-kovo' })).toContain(
      'create-kovo: unlisted packed example asset dist/examples/crm/src/unlisted.json',
    );

    const missingFiles = createKovoFixture({
      crm: [{ path: 'src/model.ts', source }],
    }).filter((file) => file.path !== 'dist/examples/crm/src/model.ts');
    expect(validateFixture(missingFiles, { packageName: 'create-kovo' })).toContain(
      'create-kovo: declared packed example asset is missing: dist/examples/crm/src/model.ts',
    );

    const resizedFiles = createKovoFixture({
      crm: [{ path: 'src/model.ts', source }],
    });
    const resizedAsset = resizedFiles.find(
      (file) => file.path === 'dist/examples/crm/src/model.ts',
    );
    resizedAsset.text = `${source} `;
    expect(validateFixture(resizedFiles, { packageName: 'create-kovo' })).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'packed example asset size mismatch for dist/examples/crm/src/model.ts',
        ),
        'create-kovo: packed example asset SHA-256 mismatch for dist/examples/crm/src/model.ts',
      ]),
    );

    const digestFiles = createKovoFixture({
      crm: [{ path: 'src/model.ts', source }],
    });
    const digestManifestFile = digestFiles.find(
      (file) => file.path === 'dist/examples/manifest.json',
    );
    const digestManifest = JSON.parse(digestManifestFile.text);
    digestManifest.examples.crm.files[0].sha256 = '0'.repeat(64);
    digestManifestFile.text = JSON.stringify(digestManifest);
    expect(validateFixture(digestFiles, { packageName: 'create-kovo' })).toContain(
      'create-kovo: packed example asset SHA-256 mismatch for dist/examples/crm/src/model.ts',
    );
  });

  it('still secret-scans create-kovo sources that the asset manifest declares', () => {
    const findings = validateFixture(
      createKovoFixture({
        crm: [
          {
            path: 'src/model.ts',
            source: `export const token = "npm_${'a'.repeat(36)}";\n`,
          },
        ],
      }),
      { packageName: 'create-kovo' },
    );

    expect(findings).toContain(
      'create-kovo: dist/examples/crm/src/model.ts matches npm token secret pattern',
    );
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

  it('derives the exact UI helper allowance from the publish authority', () => {
    const allowed = allowedPublishedSourceFiles({
      exports: {
        '.': './src/index.ts',
        './button': './src/button.tsx',
      },
      name: '@kovojs/ui',
    });

    expect(allowed).toEqual(
      ['catalog.json', 'registry.json', 'src/button.tsx', ...uiVendoredHelperSourcePaths].sort(),
    );
    expect(allowed).not.toContain('src/navigation-types.ts');
  });

  it('allows package-owned UI and icon catalog metadata only when explicitly modeled', () => {
    expect(
      validateFixture(
        [
          { path: 'package.json', text: '{}' },
          { path: 'dist/index.mjs', text: 'export {};' },
          { path: 'dist/index.d.mts', text: 'export {};' },
          { path: 'catalog.json', text: '{"schema":"kovo-component-catalog/v1"}' },
          { path: 'registry.json', text: '{"components":[]}' },
        ],
        {
          allowedSourceFiles: ['catalog.json', 'registry.json'],
          packageName: '@kovojs/ui',
        },
      ),
    ).toEqual([]);
    expect(
      validateFixture(
        [
          { path: 'package.json', text: '{}' },
          { path: 'dist/index.mjs', text: 'export {};' },
          { path: 'dist/index.d.mts', text: 'export {};' },
          { path: 'catalog.json', text: '{"schema":"kovo-component-catalog/v1"}' },
        ],
        {
          allowedSourceFiles: ['catalog.json'],
          packageName: '@kovojs/icons',
        },
      ),
    ).toEqual([]);
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
