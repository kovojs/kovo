import { describe, expect, it } from 'vitest';

import {
  assertPackedDrizzleDeclarations,
  assertPackedDrizzleManifest,
  packedDrizzleConsumerManifest,
  packedDrizzleDeclarationExports,
  packedDrizzlePeerFixtures,
} from './check-packed-drizzle-consumer.mjs';

const rootExports = [
  'CasConflict',
  'CasResult',
  'CasSuccess',
  'DrizzleUpdateResult',
  'KovoAnalyzerFunctionSummary',
  'KovoAnalyzerPrivateScopeKind',
  'KovoColumnRef',
  'KovoConcurrencyColumnAnnotation',
  'KovoConfidentialAtRestColumnAnnotation',
  'KovoDomainRef',
  'KovoDomainTableAnnotation',
  'KovoFanAnnotation',
  'KovoGovernedColumnAnnotation',
  'KovoOwnerViaAnnotation',
  'KovoParameterizedSql',
  'KovoSecretColumnAnnotation',
  'KovoSqlIdentifier',
  'KovoSqlKeyword',
  'KovoStaticSql',
  'KovoTableAnnotation',
  'KovoTableExtraConfig',
  'KovoTrustedSql',
  'KovoViewAnnotation',
  'KovoViewExtraConfig',
  'KovoViewExtraConfigAnnotation',
  'compareAndSet',
  'kovo',
  'kovoAnalyzerSummary',
  'sql',
  'staticSql',
  'trustedSql',
];
const internalRuntimeMetadataExports = [
  'KovoRuntimeAuthorizationClassification',
  'KovoRuntimeDbColumnSource',
  'KovoRuntimeDbMetadata',
  'KovoRuntimeDbTable',
  'KovoRuntimeKeySource',
  'KovoRuntimeOwnerSource',
  'KovoRuntimeOwnerViaSource',
  'KovoRuntimeTableSecurityManifest',
  'KovoRuntimeTableSecurityManifestAuthzPolicy',
  'KovoRuntimeTableSecurityManifestColumn',
  'KovoRuntimeTableSecurityManifestKey',
  'KovoRuntimeTableSecurityManifestOwner',
  'KovoRuntimeTableSecurityManifestOwnerVia',
  'KovoRuntimeTableSecurityManifestTable',
  'extractCompilerBoundKovoRuntimeDbMetadata',
  'extractKovoRuntimeDbMetadata',
  'isKovoRuntimeMetadataCollection',
];

function declaration(names) {
  return `export { ${names.join(', ')} };\n`;
}

function packedManifest() {
  return {
    dependencies: { '@kovojs/core': '0.2.0' },
    devDependencies: { 'drizzle-orm': '1.0.0-rc.4' },
    exports: {
      '.': { default: './dist/runtime.mjs', types: './dist/runtime.d.mts' },
      './internal/derive': {
        default: './dist/derive.mjs',
        types: './dist/derive.d.mts',
      },
      './internal/derive-codegen': {
        default: './dist/derive-codegen.mjs',
        types: './dist/derive-codegen.d.mts',
      },
      './internal/runtime-metadata': {
        default: './dist/runtime-metadata-internal.mjs',
        types: './dist/runtime-metadata-internal.d.mts',
      },
      './internal/static': {
        default: './dist/static.mjs',
        types: './dist/static.d.mts',
      },
    },
    name: '@kovojs/drizzle',
    peerDependencies: { 'drizzle-orm': '>=1.0.0-rc.4 <2' },
    version: '0.2.0',
  };
}

describe('packed Drizzle consumer proof', () => {
  it('pins the reviewed root/internal topology and finite peer fixture', () => {
    const manifest = packedManifest();
    expect(() => assertPackedDrizzleManifest(manifest)).not.toThrow();
    expect(packedDrizzlePeerFixtures(manifest)).toEqual([
      { id: 'minimum-and-development', version: '1.0.0-rc.4' },
    ]);
    expect(() =>
      assertPackedDrizzleDeclarations({
        internalRuntimeMetadata: declaration(internalRuntimeMetadataExports),
        root: declaration(rootExports),
      }),
    ).not.toThrow();
  });

  it('rejects metadata on the human root, unapproved any, and recursive metadata leaks', () => {
    expect(() =>
      assertPackedDrizzleDeclarations({
        internalRuntimeMetadata: declaration(internalRuntimeMetadataExports),
        root: declaration([...rootExports, 'extractKovoRuntimeDbMetadata']),
      }),
    ).toThrow('human root');
    expect(() =>
      assertPackedDrizzleDeclarations({
        internalRuntimeMetadata: declaration(internalRuntimeMetadataExports),
        root: `${declaration(rootExports)}type HiddenAny = any;\n`,
      }),
    ).toThrow('unapproved any');
    expect(() =>
      assertPackedDrizzleDeclarations({
        internalRuntimeMetadata: declaration(internalRuntimeMetadataExports),
        root: `type RootMetadataLeak = KovoRuntimeDbMetadata;\n${declaration(rootExports)}`,
      }),
    ).toThrow('recursively leak internal runtime metadata');
  });

  it('refuses an unratified peer range or fixture', () => {
    const oldFixture = packedManifest();
    oldFixture.devDependencies['drizzle-orm'] = '0.45.2';
    expect(() => packedDrizzlePeerFixtures(oldFixture)).toThrow('peer fixture');

    const widenedRange = packedManifest();
    widenedRange.peerDependencies['drizzle-orm'] = '>=0.45.2 <2';
    expect(() => packedDrizzlePeerFixtures(widenedRange)).toThrow('peer fixture');
  });

  it('installs the packed adapter and exact peer without duplicating Kovo dependencies', () => {
    const result = packedDrizzleConsumerManifest(
      [
        {
          manifest: packedManifest(),
          name: '@kovojs/drizzle',
          tarball: '.release/drizzle.tgz',
        },
        {
          manifest: { name: '@kovojs/core', version: '0.2.0' },
          name: '@kovojs/core',
          tarball: '.release/core.tgz',
        },
      ],
      'pnpm@10.12.1',
      { id: 'minimum-and-development', version: '1.0.0-rc.4' },
    );
    expect(result.dependencies).toEqual({
      '@kovojs/core': expect.stringMatching(/^file:/u),
      '@kovojs/drizzle': expect.stringMatching(/^file:/u),
      'drizzle-orm': '1.0.0-rc.4',
    });
    expect(result.pnpm.overrides).toMatchObject({
      '@kovojs/core': expect.stringMatching(/^file:/u),
      '@kovojs/drizzle': expect.stringMatching(/^file:/u),
    });
  });

  it('collects direct exported declarations as well as rollup export lists', () => {
    expect(
      packedDrizzleDeclarationExports(
        'export interface Alpha {}\nexport const beta = 1;\nexport { beta as gamma };\n',
      ),
    ).toEqual(['Alpha', 'beta', 'gamma']);
  });
});
