import { describe, expect, it } from 'vitest';

import {
  lookupPnpmPackageIntegrity,
  parsePnpmPackageIntegrities,
  parsePnpmSnapshotDependencies,
  resolveSnapshotDependencyKeys,
  snapshotKeysForSubject,
} from './pnpm-lock-packages.mjs';

const integrity =
  'sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==';

describe('pnpm lock package parser', () => {
  it('reads canonical scoped and unscoped package integrities from the packages map', () => {
    const parsed = parsePnpmPackageIntegrities(`lockfileVersion: '9.0'

packages:

  typescript@6.0.3:
    resolution: {integrity: ${integrity}}

  '@scope/tool@1.2.3':
    resolution: {integrity: ${integrity}}

snapshots:
  typescript@6.0.3: {}
`);

    expect(parsed.findings).toEqual([]);
    expect(lookupPnpmPackageIntegrity(parsed.packages, 'typescript', '6.0.3')).toBe(integrity);
    expect(lookupPnpmPackageIntegrity(parsed.packages, '@scope/tool', '1.2.3')).toBe(integrity);
  });

  it.each([
    [
      'same package key twice',
      `  typescript@6.0.3:\n    resolution: {integrity: ${integrity}}\n  typescript@6.0.3:\n    resolution: {integrity: ${integrity}}`,
    ],
    [
      'missing integrity',
      '  typescript@6.0.3:\n    resolution: {tarball: https://invalid.example/tool.tgz}',
    ],
    [
      'non-sha512 integrity',
      '  typescript@6.0.3:\n    resolution: {integrity: sha256-not-accepted}',
    ],
    [
      'nested resolution shape',
      `  typescript@6.0.3:\n    resolution:\n      integrity: ${integrity}`,
    ],
  ])('fails closed for %s', (_label, packageRows) => {
    const parsed = parsePnpmPackageIntegrities(
      `lockfileVersion: '9.0'\npackages:\n${packageRows}\nsnapshots:\n`,
    );

    expect(parsed.findings.length).toBeGreaterThan(0);
  });

  it('does not mistake a snapshots row for a packages row', () => {
    const parsed = parsePnpmPackageIntegrities(`lockfileVersion: '9.0'
packages:
  other@1.0.0:
    resolution: {integrity: ${integrity}}
snapshots:
  typescript@6.0.3:
    resolution: {integrity: ${integrity}}
`);

    expect(lookupPnpmPackageIntegrity(parsed.packages, 'typescript', '6.0.3')).toBeUndefined();
  });

  it('parses dependency and optional-dependency snapshot edges including peer contexts', () => {
    const lockfile = `lockfileVersion: '9.0'
snapshots:
  root@1.0.0(peer@2.0.0):
    dependencies:
      plain: 2.0.0
      '@scope/peerful': 3.0.0(peer@2.0.0)
    optionalDependencies:
      optional: 4.0.0
    transitivePeerDependencies:
      - ignored-peer
  plain@2.0.0: {}
  '@scope/peerful@3.0.0(peer@2.0.0)': {}
  optional@4.0.0: {}
`;
    const parsed = parsePnpmSnapshotDependencies(lockfile);

    expect(parsed.findings).toEqual([]);
    expect(parsed.snapshots.get('root@1.0.0(peer@2.0.0)')).toEqual(
      new Map([
        ['plain', '2.0.0'],
        ['@scope/peerful', '3.0.0(peer@2.0.0)'],
        ['optional', '4.0.0'],
      ]),
    );
    expect(snapshotKeysForSubject(parsed.snapshots, 'root', '1.0.0')).toEqual([
      'root@1.0.0(peer@2.0.0)',
    ]);
    expect(
      resolveSnapshotDependencyKeys(parsed.snapshots, '@scope/peerful', '3.0.0(peer@2.0.0)'),
    ).toEqual(['@scope/peerful@3.0.0(peer@2.0.0)']);
  });

  it('rejects missing scalar dependency versions instead of dropping the edge', () => {
    const parsed = parsePnpmSnapshotDependencies(`snapshots:
  root@1.0.0:
    dependencies:
      hidden:
`);

    expect(parsed.findings.join('\n')).toContain(
      'root@1.0.0 dependencies entry must have a scalar version',
    );
  });
});
