import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  computeFrameworkRuntimeSurface,
  expandFrameworkExportPostureLedger,
  productionPackedTreeSha256,
  productionSourceTreeSha256,
  readFrameworkExportPostureLedger,
  validateFrameworkExportPosture,
} from './framework-export-posture-gate.mjs';

const ledger = readFrameworkExportPostureLedger();
const actual = computeFrameworkRuntimeSurface();

const securityRoleContracts = [
  ['@kovojs/better-auth', '.', 'authed', 'security-control'],
  ['@kovojs/better-auth', '.', 'betterAuthCsrfFromEnvironment', 'security-control'],
  ['@kovojs/better-auth', '.', 'betterAuthPostgresSecret', 'secret-flow'],
  ['@kovojs/better-auth', '.', 'betterAuthSqliteSecret', 'secret-flow'],
  ['@kovojs/better-auth', '.', 'role', 'security-control'],
  ['@kovojs/core', '.', 'hmacSignature', 'security-control'],
  ['@kovojs/core', '.', 'href', 'sink-adapter'],
  ['@kovojs/core', '.', 'isRedacted', 'secret-flow'],
  ['@kovojs/core', '.', 'isSecret', 'secret-flow'],
  ['@kovojs/core', '.', 'isUntrusted', 'secret-flow'],
  ['@kovojs/core', '.', 'standardWebhooks', 'security-control'],
  ['@kovojs/drizzle', '.', 'kovoAnalyzerSummary', 'trust-escape'],
  ['@kovojs/drizzle', '.', 'sql', 'security-control'],
  ['@kovojs/drizzle', '.', 'staticSql', 'security-control'],
  ['@kovojs/server', '.', 'cmd', 'security-control'],
  ['@kovojs/server', '.', 'commandAllowlist', 'security-control'],
  ['@kovojs/server', '.', 'createMemoryMutationReplayStore', 'security-control'],
  ['@kovojs/server', '.', 'createMemoryVersionedClientModuleRegistry', 'security-control'],
  ['@kovojs/server', '.', 'createMemoryWebhookReplayStore', 'security-control'],
  ['@kovojs/server', '.', 'declarePublicRead', 'capability-escape'],
  ['@kovojs/server', '.', 'guard', 'security-control'],
  ['@kovojs/server', '.', 'guards', 'security-control'],
  ['@kovojs/server', '.', 'hmacSignature', 'security-control'],
  ['@kovojs/server', '.', 'isArgon2idPasswordDigest', 'security-control'],
  ['@kovojs/server', '.', 'mintCsrfField', 'security-control'],
  ['@kovojs/server', '.', 'mintCsrfToken', 'security-control'],
  ['@kovojs/server', '.', 'mutationFormAttributes', 'security-control'],
  ['@kovojs/server', '.', 'PASSWORD_ARGON2ID_DEFAULTS', 'security-control'],
  ['@kovojs/server', '.', 'parseComponentXml', 'sink-adapter'],
  ['@kovojs/server', '.', 'postgresAppRuntimeOptions', 'security-control'],
  ['@kovojs/server', '.', 'postgresSchemaModule', 'security-control'],
  ['@kovojs/server', '.', 'publicAccess', 'capability-escape'],
  ['@kovojs/server', '.', 'readonlyDb', 'security-control'],
  ['@kovojs/server', '.', 'replayMutationWireBody', 'security-control'],
  ['@kovojs/server', '.', 's', 'security-control'],
  ['@kovojs/server', '.', 'standardWebhooks', 'security-control'],
  ['@kovojs/server', '.', 'verifiedAccess', 'security-control'],
  ['@kovojs/server', '.', 'webhookReplayIdentity', 'security-control'],
];

function clone(value) {
  return structuredClone(value);
}

function packageRow(document, packageName) {
  const row = document.packages.find((candidate) => candidate.packageName === packageName);
  if (row === undefined) throw new Error(`missing fixture package ${packageName}`);
  return row;
}

function groupWithMember(document, packageName, subpath, name) {
  const row = packageRow(document, packageName);
  const group = row.postureGroups.find((candidate) => candidate.members?.[subpath]?.includes(name));
  if (group === undefined)
    throw new Error(`missing fixture member ${packageName}/${subpath}#${name}`);
  return group;
}

describe('framework public runtime export posture gate', () => {
  it('binds every manifest-public runtime value and module initializer to reviewed posture', () => {
    expect(validateFrameworkExportPosture({ actual, ledger })).toEqual([]);
    const rows = expandFrameworkExportPostureLedger(ledger);
    expect(rows.filter((row) => row.name !== '<module>')).toHaveLength(2_318);
    expect(rows.filter((row) => row.name === '<module>')).toHaveLength(1_838);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(rows.every((row) => row.rootKind !== undefined)).toBe(true);
    expect(rows.every((row) => row.securityRole !== undefined)).toBe(true);
    expect(rows.every((row) => row.matrix?.cells !== undefined)).toBe(true);
  });

  it('kills omission, duplicate, and newly exported-member mutants', () => {
    const omitted = clone(ledger);
    const omittedGroup = groupWithMember(omitted, '@kovojs/core', '.', 'component');
    omittedGroup.members['.'] = omittedGroup.members['.'].filter((name) => name !== 'component');
    expect(validateFrameworkExportPosture({ actual, ledger: omitted }).join('\n')).toContain(
      'reviewed runtime posture members missing:',
    );

    const duplicate = clone(ledger);
    const duplicatePackage = packageRow(duplicate, '@kovojs/core');
    const duplicateTarget = duplicatePackage.postureGroups.find(
      (group) => group !== groupWithMember(duplicate, '@kovojs/core', '.', 'component'),
    );
    duplicateTarget.members['.'] ??= [];
    duplicateTarget.members['.'].push('component');
    expect(validateFrameworkExportPosture({ actual, ledger: duplicate }).join('\n')).toContain(
      'duplicate reviewed runtime posture member: @kovojs/core\0.\0component',
    );

    const widenedActual = clone(actual);
    packageRow(widenedActual, '@kovojs/core').members['.'].push('newDocumentedRuntimeExport');
    expect(validateFrameworkExportPosture({ actual: widenedActual, ledger }).join('\n')).toContain(
      '@kovojs/core\0.\0newDocumentedRuntimeExport',
    );
  });

  it('kills stale implementation, manifest-target, review-evidence, and root-census mutants', () => {
    const unversioned = clone(ledger);
    unversioned.summaryVersion = 'framework-posture/latest\nexport const injected = true';
    expect(validateFrameworkExportPosture({ actual, ledger: unversioned }).join('\n')).toContain(
      'ledger summaryVersion must be an exact dated framework-posture version',
    );

    const implementation = clone(actual);
    packageRow(implementation, '@kovojs/core').sourceTreeSha256 = 'sha256:mutated-source';
    expect(validateFrameworkExportPosture({ actual: implementation, ledger }).join('\n')).toContain(
      '@kovojs/core: reviewed production source tree digest is stale',
    );

    const manifestTarget = clone(actual);
    packageRow(manifestTarget, '@kovojs/core').manifestVariants[0].exports['.'] =
      './src/mutated-target.ts';
    expect(validateFrameworkExportPosture({ actual: manifestTarget, ledger }).join('\n')).toContain(
      '@kovojs/core: manifest fingerprints, conditional export arms, or exact targets are stale',
    );

    const evidence = clone(ledger);
    groupWithMember(evidence, '@kovojs/core', '.', 'component').review.evidence = [
      'security/deleted-posture-proof.ts',
    ];
    expect(validateFrameworkExportPosture({ actual, ledger: evidence }).join('\n')).toContain(
      'stale or escaping evidence path security/deleted-posture-proof.ts',
    );

    const rootOmission = clone(ledger);
    groupWithMember(rootOmission, '@kovojs/server', '.', 'route').rootKind = 'none';
    expect(validateFrameworkExportPosture({ actual, ledger: rootOmission }).join('\n')).toContain(
      'classificationSha256 is stale for reviewed authority/root/security/matrix posture',
    );

    const applicationRootDeletion = clone(ledger);
    groupWithMember(applicationRootDeletion, '@kovojs/server', '.', 'createApp').rootKind = 'none';
    expect(
      validateFrameworkExportPosture({ actual, ledger: applicationRootDeletion }).join('\n'),
    ).toContain(
      'classificationSha256 is stale for reviewed authority/root/security/matrix posture',
    );
  });

  it('digests every regular production source asset and normalizes only exact compiler self fields', () => {
    const serverRoot = fileURLToPath(new URL('../packages/server', import.meta.url));
    const fixtureSource = path.join(serverRoot, 'src/test-fixtures.ts');
    const baseline = productionSourceTreeSha256(serverRoot, '@kovojs/server');
    const fixtureMutation = productionSourceTreeSha256(serverRoot, '@kovojs/server', (fileName) => {
      const source = readFileSync(fileName);
      return fileName === fixtureSource
        ? Buffer.concat([source, Buffer.from('\n// mutant')])
        : source;
    });
    expect(fixtureMutation).not.toBe(baseline);

    const compilerRoot = fileURLToPath(new URL('../packages/compiler', import.meta.url));
    const selfGenerated = path.join(
      compilerRoot,
      'src/security/framework-public-runtime-export-posture.generated.ts',
    );
    const compilerBaseline = productionSourceTreeSha256(compilerRoot, '@kovojs/compiler');
    for (const prefix of [
      'kovo-compiler-self-source-tree-sha256:',
      'kovo-compiler-self-packed-tree-sha256:',
    ]) {
      const selfMutation = productionSourceTreeSha256(
        compilerRoot,
        '@kovojs/compiler',
        (fileName) => {
          const source = readFileSync(fileName);
          return fileName === selfGenerated
            ? Buffer.from(
                source
                  .toString('utf8')
                  .replace(new RegExp(`${prefix}[a-f0-9]{64}`, 'u'), `${prefix}${'f'.repeat(64)}`),
              )
            : source;
        },
      );
      expect(selfMutation, prefix).toBe(compilerBaseline);
    }

    const permissionMutation = productionSourceTreeSha256(
      compilerRoot,
      '@kovojs/compiler',
      (fileName) => {
        const source = readFileSync(fileName);
        return fileName === selfGenerated
          ? Buffer.concat([source, Buffer.from('\n// changed permission/disposition')])
          : source;
      },
    );
    expect(permissionMutation).not.toBe(compilerBaseline);

    const nonSelfDigestMutation = productionSourceTreeSha256(
      compilerRoot,
      '@kovojs/compiler',
      (fileName) => {
        const source = readFileSync(fileName);
        return fileName === selfGenerated
          ? Buffer.from(
              source
                .toString('utf8')
                .replace(
                  /kovo-source-tree-sha256:[a-f0-9]{64}/u,
                  `kovo-source-tree-sha256:${'e'.repeat(64)}`,
                ),
            )
          : source;
      },
    );
    expect(nonSelfDigestMutation).not.toBe(compilerBaseline);

    const generatedRoot = mkdtempSync(path.join(tmpdir(), 'kovo-posture-source-digest-'));
    try {
      const sourceRoot = path.join(generatedRoot, 'src');
      mkdirSync(sourceRoot);
      const generatedSource = path.join(sourceRoot, 'runtime.generated.ts');
      const testSource = path.join(sourceRoot, 'runtime.test.ts');
      const runtimeAsset = path.join(sourceRoot, 'runtime-template.json');
      writeFileSync(generatedSource, 'export const generated = 1;\n');
      writeFileSync(testSource, 'export const testOnly = 1;\n');
      writeFileSync(runtimeAsset, '{"template":1}\n');
      const generatedBaseline = productionSourceTreeSha256(generatedRoot, '@kovojs/style');
      writeFileSync(generatedSource, 'export const generated = 2;\n');
      expect(productionSourceTreeSha256(generatedRoot, '@kovojs/style')).not.toBe(
        generatedBaseline,
      );
      const afterGeneratedMutation = productionSourceTreeSha256(generatedRoot, '@kovojs/style');
      writeFileSync(runtimeAsset, '{"template":2}\n');
      expect(productionSourceTreeSha256(generatedRoot, '@kovojs/style')).not.toBe(
        afterGeneratedMutation,
      );
      const afterAssetMutation = productionSourceTreeSha256(generatedRoot, '@kovojs/style');
      writeFileSync(testSource, 'export const testOnly = 2;\n');
      expect(productionSourceTreeSha256(generatedRoot, '@kovojs/style')).not.toBe(
        afterAssetMutation,
      );
      symlinkSync(generatedSource, path.join(sourceRoot, 'runtime-link.ts'));
      expect(() => productionSourceTreeSha256(generatedRoot, '@kovojs/style')).toThrow(
        'contains non-file entry',
      );
    } finally {
      rmSync(generatedRoot, { force: true, recursive: true });
    }

    const linkedRoot = mkdtempSync(path.join(tmpdir(), 'kovo-posture-source-root-link-'));
    const linkedTarget = mkdtempSync(path.join(tmpdir(), 'kovo-posture-source-root-target-'));
    try {
      mkdirSync(path.join(linkedTarget, 'src'));
      writeFileSync(path.join(linkedTarget, 'src/index.ts'), 'export const value = 1;\n');
      symlinkSync(path.join(linkedTarget, 'src'), path.join(linkedRoot, 'src'), 'dir');
      expect(() => productionSourceTreeSha256(linkedRoot, '@kovojs/style')).toThrow(
        'root is not a directory',
      );
    } finally {
      rmSync(linkedRoot, { force: true, recursive: true });
      rmSync(linkedTarget, { force: true, recursive: true });
    }
  });

  it('digests every packed byte and scopes self-cycle normalization to the compiler catalog', () => {
    const packageRoot = mkdtempSync(path.join(tmpdir(), 'kovo-posture-packed-digest-'));
    try {
      const distRoot = path.join(packageRoot, 'dist');
      mkdirSync(distRoot);
      const files = [
        ['index.mjs', 'export const entry = 1;\n'],
        ['chunk-A.mjs', 'export const chunk = 1;\n'],
        ['chunk-A.mjs.map', '{"version":3}\n'],
        ['chunk-A.d.mts', 'export declare const chunk: number;\n'],
      ];
      for (const [fileName, source] of files) writeFileSync(path.join(distRoot, fileName), source);

      const baseline = productionPackedTreeSha256(packageRoot, '@kovojs/style');
      for (const [fileName, source] of files) {
        writeFileSync(path.join(distRoot, fileName), `${source}// mutant\n`);
        expect(productionPackedTreeSha256(packageRoot, '@kovojs/style'), fileName).not.toBe(
          baseline,
        );
        writeFileSync(path.join(distRoot, fileName), source);
      }

      for (const prefix of [
        'kovo-source-tree-sha256:',
        'kovo-packed-tree-sha256:',
        'kovo-compiler-self-source-tree-sha256:',
        'kovo-compiler-self-packed-tree-sha256:',
      ]) {
        writeFileSync(path.join(distRoot, 'chunk-A.mjs'), `${prefix}${'a'.repeat(64)}`);
        expect(() => productionPackedTreeSha256(packageRoot, '@kovojs/style')).toThrow(
          "framework implementation digest marker escaped the compiler's exact generated catalog artifact",
        );
      }
    } finally {
      rmSync(packageRoot, { force: true, recursive: true });
    }

    const linkedRoot = mkdtempSync(path.join(tmpdir(), 'kovo-posture-packed-root-link-'));
    const linkedTarget = mkdtempSync(path.join(tmpdir(), 'kovo-posture-packed-root-target-'));
    try {
      mkdirSync(path.join(linkedTarget, 'dist'));
      writeFileSync(path.join(linkedTarget, 'dist/index.mjs'), 'export const value = 1;\n');
      symlinkSync(path.join(linkedTarget, 'dist'), path.join(linkedRoot, 'dist'), 'dir');
      expect(() => productionPackedTreeSha256(linkedRoot, '@kovojs/style')).toThrow(
        'root is not a directory',
      );
    } finally {
      rmSync(linkedRoot, { force: true, recursive: true });
      rmSync(linkedTarget, { force: true, recursive: true });
    }

    const compilerRoot = mkdtempSync(path.join(tmpdir(), 'kovo-compiler-packed-digest-'));
    try {
      const distRoot = path.join(compilerRoot, 'dist');
      mkdirSync(distRoot);
      const selfSourceDigest = (hex) => `kovo-compiler-self-source-tree-sha256:${hex.repeat(64)}`;
      const selfDigest = (hex) => `kovo-compiler-self-packed-tree-sha256:${hex.repeat(64)}`;
      const reviewedDigest = (hex) => `kovo-packed-tree-sha256:${hex.repeat(64)}`;
      const catalogRuntime = path.join(distRoot, 'internal.mjs');
      const catalogMap = path.join(distRoot, 'internal.mjs.map');
      writeFileSync(
        catalogRuntime,
        `source=${selfSourceDigest('a')} catalog=${selfDigest('a')} reviewed=${reviewedDigest('b')}\n`,
      );
      writeFileSync(catalogMap, `source=${selfSourceDigest('a')} sources=${selfDigest('a')}\n`);
      writeFileSync(path.join(distRoot, 'index.mjs'), 'export const ordinary = true;\n');
      const baseline = productionPackedTreeSha256(compilerRoot, '@kovojs/compiler');

      writeFileSync(
        catalogRuntime,
        `source=${selfSourceDigest('c')} catalog=${selfDigest('c')} reviewed=${reviewedDigest('b')}\n`,
      );
      expect(productionPackedTreeSha256(compilerRoot, '@kovojs/compiler')).toBe(baseline);

      writeFileSync(
        catalogRuntime,
        `source=${selfSourceDigest('c')} changed=${selfDigest('c')} reviewed=${reviewedDigest('b')}\n`,
      );
      expect(productionPackedTreeSha256(compilerRoot, '@kovojs/compiler')).not.toBe(baseline);

      writeFileSync(
        catalogRuntime,
        `source=${selfSourceDigest('a')} catalog=${selfDigest('a')} reviewed=${reviewedDigest('d')}\n`,
      );
      expect(productionPackedTreeSha256(compilerRoot, '@kovojs/compiler')).not.toBe(baseline);

      writeFileSync(
        path.join(distRoot, 'extra.mjs'),
        `owner=kovo-framework-public-runtime-export-posture/fixture source=${selfSourceDigest('e')} catalog=${selfDigest('e')}\n`,
      );
      expect(() => productionPackedTreeSha256(compilerRoot, '@kovojs/compiler')).toThrow(
        "framework implementation digest marker escaped the compiler's exact generated catalog artifact",
      );
    } finally {
      rmSync(compilerRoot, { force: true, recursive: true });
    }
  });

  it('kills security-role omission across auth, secret, SQL, authorization, CSRF, and replay exports', () => {
    for (const [packageName, subpath, name, role] of securityRoleContracts) {
      expect(groupWithMember(ledger, packageName, subpath, name).securityRole).toBe(role);
    }

    for (const [packageName, subpath, name] of securityRoleContracts.slice(0, 5)) {
      const omitted = clone(ledger);
      groupWithMember(omitted, packageName, subpath, name).securityRole = 'ordinary-runtime';
      expect(validateFrameworkExportPosture({ actual, ledger: omitted }).join('\n')).toContain(
        'classificationSha256 is stale for reviewed authority/root/security/matrix posture',
      );
    }
  });

  it('keeps zero-public first-party identities and security-bearing roles explicit', () => {
    expect(ledger.emptyPublicPackages.map((row) => row.packageName).sort()).toEqual([
      '@kovojs/compiler',
      'create-kovo',
    ]);
    expect(
      groupWithMember(ledger, '@kovojs/browser', './client', 'defaultEnhancedFetch'),
    ).toMatchObject({
      capabilities: ['network'],
      disposition: 'request-closed',
      securityRole: 'request-closed',
    });
    expect(
      groupWithMember(ledger, '@kovojs/server', './runtime-bootstrap', '<module>'),
    ).toMatchObject({
      capabilities: ['process'],
      disposition: 'framework-door',
      securityRole: 'security-control',
    });
    expect(groupWithMember(ledger, '@kovojs/server', '.', 'trustedHtml').securityRole).toBe(
      'trust-escape',
    );
    expect(groupWithMember(ledger, '@kovojs/core', '.', 'publishToClient').securityRole).toBe(
      'capability-escape',
    );
    expect(
      groupWithMember(ledger, '@kovojs/drizzle', '.', 'kovoAnalyzerSummary').securityRole,
    ).toBe('trust-escape');
    expect(groupWithMember(ledger, '@kovojs/server', '.', 'createApp')).toMatchObject({
      disposition: 'authority-free',
      rootKind: 'application',
      securityRole: 'root-factory',
    });
    expect(
      expandFrameworkExportPostureLedger(ledger).filter((row) => row.rootKind !== 'none'),
    ).toHaveLength(13);
  });
});
