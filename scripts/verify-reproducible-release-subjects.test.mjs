import { describe, expect, it } from 'vitest';

import {
  reproduciblePackAttestationClaim,
  reproduciblePackAttestationExclusions,
  reproduciblePackAttestationSchema,
} from './reproducible-pack.mjs';
import { verifyReproducibleReleaseSubjects } from './verify-reproducible-release-subjects.mjs';

const source = '0123456789abcdef0123456789abcdef01234567';
const reviewedSha512 = `sha512-${'A'.repeat(86)}==`;
const swappedSha512 = `sha512-${'B'.repeat(86)}==`;

function packedManifest(sha512 = reviewedSha512) {
  return {
    deterministicInputs: { ordering: 'bytewise-path', sourceDateEpoch: 499162500 },
    packages: [
      {
        files: ['package/dist/index.mjs', 'package/package.json'],
        manifest: { name: '@kovojs/example', version: '1.2.3' },
        name: '@kovojs/example',
        sha512,
        tarball: '.release/tarballs/example-1.2.3.tgz',
        version: '1.2.3',
      },
    ],
    schema: 'kovo.packed-public-packages/v2',
  };
}

function expectedPackages() {
  return [
    {
      manifest: { name: '@kovojs/example', publishConfig: {}, version: '1.2.3' },
      name: '@kovojs/example',
      version: '1.2.3',
    },
  ];
}

function attestation(sha512 = reviewedSha512) {
  return {
    buildEnvironments: [{ id: 'clean-checkout-a' }, { id: 'clean-checkout-b' }],
    claim: reproduciblePackAttestationClaim,
    deterministicInputs: packedManifest().deterministicInputs,
    excludes: reproduciblePackAttestationExclusions,
    schema: reproduciblePackAttestationSchema,
    source,
    subjects: [{ name: '@kovojs/example@1.2.3', sha512 }],
  };
}

describe('reproducible release subject verification', () => {
  it('joins every packed tarball to the exact two-clean-checkout CI subject', () => {
    expect(
      verifyReproducibleReleaseSubjects({
        attestation: JSON.parse(JSON.stringify(attestation())),
        expectedPackages: expectedPackages(),
        expectedSource: source,
        packedManifest: packedManifest(),
      }),
    ).toHaveLength(1);
  });

  it('rejects a coherent post-verification tarball and self-attestation swap', () => {
    expect(() =>
      verifyReproducibleReleaseSubjects({
        attestation: attestation(),
        expectedPackages: expectedPackages(),
        expectedSource: source,
        packedManifest: packedManifest(swappedSha512),
      }),
    ).toThrow('@kovojs/example@1.2.3 does not match its two-build reproducible sha512 subject');
  });

  it('rejects source, package-set, and attestation-shape drift', () => {
    expect(() =>
      verifyReproducibleReleaseSubjects({
        attestation: { ...attestation(), source: 'f'.repeat(40) },
        expectedPackages: expectedPackages(),
        expectedSource: source,
        packedManifest: packedManifest(),
      }),
    ).toThrow('posture does not match');
    expect(() =>
      verifyReproducibleReleaseSubjects({
        attestation: { ...attestation(), subjects: [] },
        expectedPackages: expectedPackages(),
        expectedSource: source,
        packedManifest: packedManifest(),
      }),
    ).toThrow('package count does not match');
    expect(() =>
      verifyReproducibleReleaseSubjects({
        attestation: { ...attestation(), extra: true },
        expectedPackages: expectedPackages(),
        expectedSource: source,
        packedManifest: packedManifest(),
      }),
    ).toThrow('invalid shape');
  });
});
