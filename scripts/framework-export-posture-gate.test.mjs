import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  computeFrameworkRuntimeSurface,
  expandFrameworkExportPostureLedger,
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
    expect(rows.filter((row) => row.name !== '<module>')).toHaveLength(2_315);
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

  it('digests fixture-named and generated production sources while excluding only tests and itself', () => {
    const serverRoot = fileURLToPath(new URL('../packages/server', import.meta.url));
    const fixtureSource = path.join(serverRoot, 'src/test-fixtures.ts');
    const baseline = productionSourceTreeSha256(serverRoot);
    const fixtureMutation = productionSourceTreeSha256(serverRoot, (fileName) => {
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
    const compilerBaseline = productionSourceTreeSha256(compilerRoot);
    const selfMutation = productionSourceTreeSha256(compilerRoot, (fileName) => {
      const source = readFileSync(fileName);
      return fileName === selfGenerated
        ? Buffer.concat([source, Buffer.from('\n// mutant')])
        : source;
    });
    expect(selfMutation).toBe(compilerBaseline);

    const generatedRoot = mkdtempSync(path.join(tmpdir(), 'kovo-posture-source-digest-'));
    try {
      const sourceRoot = path.join(generatedRoot, 'src');
      mkdirSync(sourceRoot);
      const generatedSource = path.join(sourceRoot, 'runtime.generated.ts');
      const testSource = path.join(sourceRoot, 'runtime.test.ts');
      writeFileSync(generatedSource, 'export const generated = 1;\n');
      writeFileSync(testSource, 'export const testOnly = 1;\n');
      const generatedBaseline = productionSourceTreeSha256(generatedRoot);
      writeFileSync(generatedSource, 'export const generated = 2;\n');
      expect(productionSourceTreeSha256(generatedRoot)).not.toBe(generatedBaseline);
      const afterGeneratedMutation = productionSourceTreeSha256(generatedRoot);
      writeFileSync(testSource, 'export const testOnly = 2;\n');
      expect(productionSourceTreeSha256(generatedRoot)).toBe(afterGeneratedMutation);
    } finally {
      rmSync(generatedRoot, { force: true, recursive: true });
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
