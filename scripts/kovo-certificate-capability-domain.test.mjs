import { describe, expect, it } from 'vitest';

import {
  generateKovoCertificateFromAnalysis,
  kovoCertificatePolicyFactsFromAnalysis,
  kovoCertificateCapabilityDomain,
  stableKovoCertificatePolicyJson,
} from './kovo-certificate-format.mjs';

const sha512 = `sha512-${Buffer.alloc(64).toString('base64')}`;

describe('kovo.certificate/v1 cryptographic authority domain', () => {
  it('retains crypto acquisition and digest as distinct post-fixpoint capabilities', () => {
    const acquire = '@kovojs/server/dist/acquire.mjs';
    const digest = '@kovojs/server/dist/digest.mjs';
    expect(kovoCertificateCapabilityDomain).toEqual([
      'crypto-acquisition',
      'database-driver',
      'digest',
      'dynamic-loader',
      'filesystem',
      'network',
      'process',
      'vm',
      'worker',
    ]);

    const analysis = {
      artifacts: [
        { path: acquire, sha512 },
        { path: digest, sha512 },
      ],
      doors: [],
      edges: [],
      localCapabilities: {
        [acquire]: ['crypto-acquisition'],
        [digest]: ['digest'],
      },
      opaque: [],
      roots: [],
      schema: 'kovo.certificate-analysis/v1',
    };
    const certificate = generateKovoCertificateFromAnalysis(
      analysis,
      policyBytesForAnalysis(analysis),
    );

    expect(certificate.cap).toEqual({
      [acquire]: ['crypto-acquisition'],
      [digest]: ['digest'],
    });
  });
});

function policyBytesForAnalysis(analysis) {
  const facts = kovoCertificatePolicyFactsFromAnalysis(analysis);
  const names = [
    ...new Set(facts.artifacts.map((entry) => entry.path.split('/').slice(0, 2).join('/'))),
  ].sort((left, right) => left.localeCompare(right));
  return Buffer.from(
    stableKovoCertificatePolicyJson({
      ...facts,
      packages: names.map((name) => ({ manifest: { name }, name })),
      schema: 'kovo.certificate-policy/v1',
    }),
  );
}
