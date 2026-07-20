import { describe, expect, it } from 'vitest';

import {
  generateKovoCertificateFromAnalysis,
  kovoCertificateCapabilityDomain,
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

    const certificate = generateKovoCertificateFromAnalysis({
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
    });

    expect(certificate.cap).toEqual({
      [acquire]: ['crypto-acquisition'],
      [digest]: ['digest'],
    });
  });
});
