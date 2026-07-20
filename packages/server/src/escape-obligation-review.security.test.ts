// @kovo-security-certifies C13 structured-escape-review-signature
import { describe, expect, it } from 'vitest';

import {
  createRuntimeAttestationCryptoHandle,
  createRuntimeAttestationVerificationHandle,
} from './crypto-authority.js';
import {
  createEscapeObligationReviewEnvelope,
  verifyEscapeObligationReviewEnvelope,
} from './escape-obligation-review.js';

const artifactSubject = `sha256:${'b'.repeat(64)}` as const;
const obligation = {
  evidence: {
    digest: `sha256:${'a'.repeat(64)}` as const,
    kind: 'test' as const,
    reference: 'tests/authz/admin-role-grant',
  },
  invariant: 'governed-write.authorized-principal' as const,
  why: { guard: 'guards.role:admin', kind: 'guard-chain' as const },
};

describe('escape-obligation review signatures (SPEC §§6.6, 11.2)', () => {
  it('composes with the runtime-attestation trust anchor and binds site, obligation, and artifact', () => {
    const authority = createRuntimeAttestationCryptoHandle(
      'escape-review-test-secret-0123456789abcdef0123456789abcdef',
      'deployment:test',
    );
    const envelope = createEscapeObligationReviewEnvelope(
      {
        artifactSubject,
        obligation,
        siteIdentity: 'src/mutations.ts:44',
      },
      authority,
    );

    expect(envelope.trustAnchorFingerprint).toBe(authority.trustAnchorFingerprint);
    expect(
      verifyEscapeObligationReviewEnvelope(envelope, {
        artifactSubject,
        trustAnchorFingerprint: authority.trustAnchorFingerprint,
        verification: createRuntimeAttestationVerificationHandle(),
      }),
    ).toBe(true);

    for (const subject of [
      { ...envelope.subject, siteIdentity: 'src/mutations.ts:45' },
      { ...envelope.subject, artifactSubject: `sha256:${'c'.repeat(64)}` as const },
      {
        ...envelope.subject,
        obligation: {
          ...obligation,
          evidence: { ...obligation.evidence, reference: 'tests/authz/forged' },
        },
      },
    ]) {
      expect(
        verifyEscapeObligationReviewEnvelope(
          { ...envelope, subject },
          {
            artifactSubject,
            trustAnchorFingerprint: authority.trustAnchorFingerprint,
            verification: createRuntimeAttestationVerificationHandle(),
          },
        ),
      ).toBe(false);
    }
  });

  it('rejects a replacement key, fingerprint, or signature', () => {
    const authority = createRuntimeAttestationCryptoHandle(
      'escape-review-test-secret-0123456789abcdef0123456789abcdef',
      'deployment:test',
    );
    const replacement = createRuntimeAttestationCryptoHandle(
      'replacement-review-secret-0123456789abcdef0123456789abcdef',
      'deployment:test',
    );
    const envelope = createEscapeObligationReviewEnvelope(
      { artifactSubject, obligation, siteIdentity: 'src/mutations.ts:44' },
      authority,
    );
    const options = {
      artifactSubject,
      trustAnchorFingerprint: authority.trustAnchorFingerprint,
      verification: createRuntimeAttestationVerificationHandle(),
    };

    expect(
      verifyEscapeObligationReviewEnvelope(
        {
          ...envelope,
          publicKeySpki: replacement.publicKeySpki,
          trustAnchorFingerprint: replacement.trustAnchorFingerprint,
        },
        options,
      ),
    ).toBe(false);
    expect(
      verifyEscapeObligationReviewEnvelope(
        { ...envelope, signature: `${envelope.signature.slice(0, -1)}A` },
        options,
      ),
    ).toBe(false);
  });
});
