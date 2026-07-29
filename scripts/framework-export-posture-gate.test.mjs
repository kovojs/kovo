import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  capabilityManifestFingerprint,
  computeFrameworkRuntimeSurface,
  expandFrameworkExportPostureLedger,
  productionPackedTreeSha256,
  productionSourceTreeSha256,
  readFrameworkExportPostureLedger,
  renderFrameworkExportPostureGenerated,
  validateFrameworkExportPosture,
} from './framework-export-posture-gate.mjs';
import { expectedPackedManifest, releasePackages } from './release-packages.mjs';

const ledger = readFrameworkExportPostureLedger();
const actual = computeFrameworkRuntimeSurface();

const securityRoleContracts = [
  ['@kovojs/better-auth', '.', 'authed', 'security-control'],
  ['@kovojs/better-auth', '.', 'betterAuthCsrfFromEnvironment', 'security-control'],
  ['@kovojs/better-auth', '.', 'betterAuthPasswordResetMailDoor', 'security-control'],
  ['@kovojs/better-auth', '.', 'betterAuthPostgresSecret', 'secret-flow'],
  ['@kovojs/better-auth', '.', 'betterAuthSqliteSecret', 'secret-flow'],
  ['@kovojs/better-auth', '.', 'role', 'security-control'],
  ['@kovojs/core', '.', 'DeclassifyPolicy', 'request-closed'],
  ['@kovojs/core', '.', 'hmacSignature', 'security-control'],
  ['@kovojs/core', '.', 'href', 'sink-adapter'],
  ['@kovojs/core', '.', 'isRedacted', 'secret-flow'],
  ['@kovojs/core', '.', 'isSecret', 'secret-flow'],
  ['@kovojs/core', '.', 'isUntrusted', 'secret-flow'],
  ['@kovojs/core', '.', 'revealSecret', 'request-closed'],
  ['@kovojs/core', '.', 'revealUntrusted', 'request-closed'],
  ['@kovojs/core', '.', 'standardWebhooks', 'security-control'],
  ['@kovojs/core', '.', 'trustedReveal', 'request-closed'],
  ['@kovojs/drizzle', '.', 'kovoAnalyzerSummary', 'trust-escape'],
  ['@kovojs/drizzle', '.', 'sql', 'security-control'],
  ['@kovojs/drizzle', '.', 'staticSql', 'security-control'],
  ['@kovojs/server', '.', 'cmd', 'security-control'],
  ['@kovojs/server', '.', 'commandAllowlist', 'security-control'],
  ['@kovojs/server', '.', 'createMemoryMutationReplayStore', 'security-control'],
  ['@kovojs/server', '.', 'createMemoryVersionedClientModuleRegistry', 'security-control'],
  ['@kovojs/server', '.', 'createMemoryWebhookReplayStore', 'security-control'],
  ['@kovojs/server', '.', 'declarePublicRead', 'capability-escape'],
  ['@kovojs/server', '.', 'erasePrincipal', 'framework-door'],
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
  ['@kovojs/server', '.', 'PrincipalErasureIncompleteError', 'security-control'],
  ['@kovojs/server', '.', 'publicAccess', 'capability-escape'],
  ['@kovojs/server', '.', 'readonlyDb', 'security-control'],
  ['@kovojs/server', '.', 'replayMutationWireBody', 'security-control'],
  ['@kovojs/server', '.', 's', 'security-control'],
  ['@kovojs/server', '.', 'standardWebhooks', 'security-control'],
  ['@kovojs/server', '.', 'verifiedAccess', 'security-control'],
  ['@kovojs/server', '.', 'verifyPrincipalErasureReceipt', 'security-control'],
  ['@kovojs/server', '.', 'webhookReplayIdentity', 'security-control'],
];

const rootContracts = [
  ['@kovojs/better-auth', '.', 'mount', 'endpoint'],
  ['@kovojs/browser', '.', 'handler', 'serialized-browser-handler'],
  ['@kovojs/server', '.', 'createApp', 'application'],
  ['@kovojs/server', '.', 'createRequestHandler', 'endpoint'],
  ['@kovojs/server', '.', 'createStorageDownloadEndpoint', 'endpoint'],
  ['@kovojs/server', '.', 'endpoint', 'endpoint'],
  ['@kovojs/server', '.', 'layout', 'layout'],
  ['@kovojs/server', '.', 'mutation', 'mutation'],
  ['@kovojs/server', '.', 'query', 'query'],
  ['@kovojs/server', '.', 'route', 'route'],
  ['@kovojs/server', '.', 'task', 'durable-task'],
  ['@kovojs/server', '.', 'toNodeHandler', 'endpoint'],
  ['@kovojs/server', '.', 'tool', 'agent-tool-callback'],
  ['@kovojs/server', '.', 'webhook', 'webhook'],
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
  it('reviews the exact source-derived packed manifest and keeps dependency mutants closed', () => {
    const packages = releasePackages();
    const releaseVersions = new Map(packages.map((pkg) => [pkg.name, pkg.version]));
    const server = packages.find((pkg) => pkg.name === '@kovojs/server');
    expect(server).toBeDefined();
    const packed = expectedPackedManifest(server.manifest, releaseVersions);
    const reviewedFingerprints = packageRow(actual, '@kovojs/server').manifestVariants.map(
      (variant) => variant.fingerprint,
    );
    expect(reviewedFingerprints).toContain(capabilityManifestFingerprint(packed));

    const mismatched = structuredClone(packed);
    mismatched.dependencies['@kovojs/core'] = '9.9.9';
    expect(reviewedFingerprints).not.toContain(capabilityManifestFingerprint(mismatched));
  });

  it('binds every manifest-public runtime value and module initializer to reviewed posture', () => {
    expect(validateFrameworkExportPosture({ actual, ledger })).toEqual([]);
    const rows = expandFrameworkExportPostureLedger(ledger);
    expect(rows.filter((row) => row.name !== '<module>')).toHaveLength(2_347);
    expect(rows.filter((row) => row.name === '<module>')).toHaveLength(1_839);
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

  it('kills stale implementation, manifest-target, review-evidence, and invalid-root mutants', () => {
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

    const invalidRoot = clone(ledger);
    groupWithMember(invalidRoot, '@kovojs/server', '.', 'route').rootKind = 'unregistered-root';
    expect(validateFrameworkExportPosture({ actual, ledger: invalidRoot }).join('\n')).toContain(
      'rootKind must explicitly name a supported root kind or none',
    );
  });

  it('digests every regular non-compiler production source asset', () => {
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
      const generatedBaseline = productionSourceTreeSha256(generatedRoot);
      writeFileSync(generatedSource, 'export const generated = 2;\n');
      expect(productionSourceTreeSha256(generatedRoot)).not.toBe(generatedBaseline);
      const afterGeneratedMutation = productionSourceTreeSha256(generatedRoot);
      writeFileSync(runtimeAsset, '{"template":2}\n');
      expect(productionSourceTreeSha256(generatedRoot)).not.toBe(afterGeneratedMutation);
      const afterAssetMutation = productionSourceTreeSha256(generatedRoot);
      writeFileSync(testSource, 'export const testOnly = 2;\n');
      expect(productionSourceTreeSha256(generatedRoot)).not.toBe(afterAssetMutation);
      symlinkSync(generatedSource, path.join(sourceRoot, 'runtime-link.ts'));
      expect(() => productionSourceTreeSha256(generatedRoot)).toThrow('contains non-file entry');
    } finally {
      rmSync(generatedRoot, { force: true, recursive: true });
    }

    const linkedRoot = mkdtempSync(path.join(tmpdir(), 'kovo-posture-source-root-link-'));
    const linkedTarget = mkdtempSync(path.join(tmpdir(), 'kovo-posture-source-root-target-'));
    try {
      mkdirSync(path.join(linkedTarget, 'src'));
      writeFileSync(path.join(linkedTarget, 'src/index.ts'), 'export const value = 1;\n');
      symlinkSync(path.join(linkedTarget, 'src'), path.join(linkedRoot, 'src'), 'dir');
      expect(() => productionSourceTreeSha256(linkedRoot)).toThrow('root is not a directory');
    } finally {
      rmSync(linkedRoot, { force: true, recursive: true });
      rmSync(linkedTarget, { force: true, recursive: true });
    }
  });

  it('digests every non-compiler packed byte and rejects embedded digest identities', () => {
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

      const baseline = productionPackedTreeSha256(packageRoot);
      for (const [fileName, source] of files) {
        writeFileSync(path.join(distRoot, fileName), `${source}// mutant\n`);
        expect(productionPackedTreeSha256(packageRoot), fileName).not.toBe(baseline);
        writeFileSync(path.join(distRoot, fileName), source);
      }

      for (const prefix of ['kovo-source-tree-sha256:', 'kovo-packed-tree-sha256:']) {
        writeFileSync(path.join(distRoot, 'chunk-A.mjs'), `${prefix}${'a'.repeat(64)}`);
        expect(() => productionPackedTreeSha256(packageRoot)).toThrow(
          'framework implementation digest marker is embedded in packed implementation',
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
      expect(() => productionPackedTreeSha256(linkedRoot)).toThrow('root is not a directory');
    } finally {
      rmSync(linkedRoot, { force: true, recursive: true });
      rmSync(linkedTarget, { force: true, recursive: true });
    }
  });

  it('keeps security-bearing roles and root factories explicit', () => {
    for (const [packageName, subpath, name, role] of securityRoleContracts) {
      expect(groupWithMember(ledger, packageName, subpath, name).securityRole).toBe(role);
    }
    expect(
      expandFrameworkExportPostureLedger(ledger)
        .filter((row) => row.rootKind !== 'none')
        .map((row) => [row.packageName, row.subpath, row.name, row.rootKind]),
    ).toEqual(rootContracts);
  });

  it('rejects removed aggregate check-digits instead of accepting decorative SHA fields', () => {
    for (const field of ['classificationSha256', 'postureMemberSha256', 'runtimeSurfaceSha256']) {
      const surplus = clone(ledger);
      surplus[field] = '0'.repeat(64);
      expect(validateFrameworkExportPosture({ actual, ledger: surplus }).join('\n')).toContain(
        'ledger keys must be exactly',
      );
    }
  });

  it('keeps zero-public first-party posture and security-bearing roles explicit', () => {
    expect(ledger.emptyPublicPackages.map((row) => row.packageName).sort()).toEqual([
      '@kovojs/compiler',
      'create-kovo',
    ]);
    expect(
      ledger.emptyPublicPackages.find((row) => row.packageName === '@kovojs/compiler'),
    ).toEqual({
      disposition: 'request-closed',
      packageName: '@kovojs/compiler',
      reason: expect.stringContaining('no app-facing public runtime subpaths'),
    });
    expect(actual.emptyPackages.find((row) => row.packageName === '@kovojs/compiler')).toEqual({
      packageName: '@kovojs/compiler',
      unconditionalRequestClosure: true,
    });
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
    for (const name of ['DeclassifyPolicy', 'revealSecret', 'revealUntrusted', 'trustedReveal']) {
      expect(groupWithMember(ledger, '@kovojs/core', '.', name)).toMatchObject({
        capabilities: [],
        disposition: 'request-closed',
        rootKind: 'none',
        securityRole: 'request-closed',
      });
    }
    expect(groupWithMember(ledger, '@kovojs/server', '.', 'erasePrincipal')).toMatchObject({
      capabilities: ['crypto-acquisition', 'database-driver', 'digest', 'filesystem', 'network'],
      disposition: 'framework-door',
      rootKind: 'none',
      securityRole: 'framework-door',
    });
    expect(
      groupWithMember(ledger, '@kovojs/server', '.', 'verifyPrincipalErasureReceipt'),
    ).toMatchObject({
      capabilities: ['crypto-acquisition'],
      disposition: 'framework-door',
      rootKind: 'none',
      securityRole: 'security-control',
    });
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
    ).toHaveLength(14);
  });

  it('cuts exact implementation dependencies only for wholly request-closed packages', () => {
    const generated = renderFrameworkExportPostureGenerated(ledger, actual);
    const packageBlock = (packageName) => {
      const start = generated.indexOf(`  [${JSON.stringify(packageName)},`);
      const end = generated.indexOf('\n  ["@kovojs/', start + 1);
      expect(start, `generated package row for ${packageName}`).toBeGreaterThanOrEqual(0);
      return generated.slice(start, end < 0 ? generated.length : end);
    };

    const cli = packageBlock('@kovojs/cli');
    expect(cli).toContain('"unconditional-request-closure"');
    expect(cli).not.toContain('kovo-source-tree-sha256:');
    expect(cli).not.toContain('kovo-packed-tree-sha256:');

    expect(generated).toContain(
      "frameworkZeroPublicRequestClosedPackages: readonly string[] = ['@kovojs/compiler']",
    );
    expect(generated).not.toContain('["@kovojs/compiler", "0.2.0"');

    const server = packageBlock('@kovojs/server');
    expect(server).toContain('"exact-implementation"');
    expect(server).toContain('kovo-source-tree-sha256:');

    const widenedCliLedger = clone(ledger);
    const diagnosticGroup = packageRow(widenedCliLedger, '@kovojs/cli').postureGroups.find(
      (group) => group.members['.']?.includes('KOVO_DIAGNOSTIC_VERSION'),
    );
    diagnosticGroup.disposition = 'authority-free';
    const widenedGenerated = renderFrameworkExportPostureGenerated(widenedCliLedger, actual);
    const widenedStart = widenedGenerated.indexOf('  ["@kovojs/cli",');
    const widenedEnd = widenedGenerated.indexOf('\n  ["@kovojs/', widenedStart + 1);
    const widenedCli = widenedGenerated.slice(widenedStart, widenedEnd);
    expect(widenedCli).toContain('"exact-implementation"');
    expect(widenedCli).toContain('kovo-source-tree-sha256:');
  });
});
