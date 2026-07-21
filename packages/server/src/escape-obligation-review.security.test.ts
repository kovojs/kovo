// @kovo-security-certifies C13 structured-escape-review-signature
import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createRuntimeAttestationCryptoHandle,
  createRuntimeAttestationVerificationHandle,
} from './crypto-authority.js';
import {
  createEscapeObligationReviewEnvelope,
  escapeObligationReviewPayload,
  verifyEscapeObligationReviewEnvelope,
} from './escape-obligation-review.js';
import * as internalExecution from './internal/execution.js';

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
        siteIdentity: 'src/mutations.ts:44:99',
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
      { ...envelope.subject, siteIdentity: 'src/mutations.ts:45:99' },
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
      { artifactSubject, obligation, siteIdentity: 'src/mutations.ts:44:99' },
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
          trustAnchorFingerprint: replacement.trustAnchorFingerprint as `sha256:${string}`,
        },
        options,
      ),
    ).toBe(false);
    expect(
      verifyEscapeObligationReviewEnvelope(
        { ...envelope, keyId: `${envelope.keyId}-forged` },
        options,
      ),
    ).toBe(false);
    expect(
      verifyEscapeObligationReviewEnvelope(
        {
          ...envelope,
          signature: `${envelope.signature[0] === 'A' ? 'B' : 'A'}${envelope.signature.slice(1)}`,
        },
        options,
      ),
    ).toBe(false);
  });

  it('rejects a 64-byte RSA-512 signature instead of labeling it Ed25519', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 512 });
    const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
    const publicKeySpki = publicKeyDer.toString('base64url');
    const trustAnchorFingerprint = `sha256:${createHash('sha256').update(publicKeyDer).digest('hex')}`;
    const keyId = 'rsa-512-negative-control';
    const authority = createRuntimeAttestationCryptoHandle(
      'escape-review-test-secret-0123456789abcdef0123456789abcdef',
      'deployment:test',
    );
    const legitimate = createEscapeObligationReviewEnvelope(
      { artifactSubject, obligation, siteIdentity: 'src/mutations.ts:44:99' },
      authority,
    );
    const signature = sign(
      null,
      Buffer.from(escapeObligationReviewPayload(legitimate.subject, keyId), 'utf8'),
      privateKey,
    );

    expect(signature).toHaveLength(64);
    expect(
      verifyEscapeObligationReviewEnvelope(
        {
          keyId,
          publicKeySpki,
          signature: signature.toString('base64url'),
          subject: legitimate.subject,
          trustAnchorFingerprint,
        },
        {
          artifactSubject,
          trustAnchorFingerprint,
          verification: createRuntimeAttestationVerificationHandle(),
        },
      ),
    ).toBe(false);
  });

  it('rejects ambiguous fields and accessors without invoking them', () => {
    const authority = createRuntimeAttestationCryptoHandle(
      'escape-review-test-secret-0123456789abcdef0123456789abcdef',
      'deployment:test',
    );
    const envelope = createEscapeObligationReviewEnvelope(
      {
        artifactSubject,
        obligation,
        siteIdentity: 'src/routes/[tenant id]/mutations.ts:44:99',
      },
      authority,
    );
    const options = {
      artifactSubject,
      trustAnchorFingerprint: authority.trustAnchorFingerprint,
      verification: createRuntimeAttestationVerificationHandle(),
    };

    expect(
      verifyEscapeObligationReviewEnvelope(
        { ...envelope, unsignedNote: 'looks reviewed' },
        options,
      ),
    ).toBe(false);
    expect(
      verifyEscapeObligationReviewEnvelope(
        { ...envelope, subject: { ...envelope.subject, reason: 'looks reviewed' } },
        options,
      ),
    ).toBe(false);

    let getterCalls = 0;
    const accessorEnvelope = { ...envelope } as Record<string, unknown>;
    Object.defineProperty(accessorEnvelope, 'signature', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return envelope.signature;
      },
    });
    expect(verifyEscapeObligationReviewEnvelope(accessorEnvelope, options)).toBe(false);
    expect(getterCalls).toBe(0);
  });

  it('keeps the signing capability off the exported build/execution surface', () => {
    expect('createEscapeObligationReviewEnvelope' in internalExecution).toBe(false);
    expect('createRuntimeAttestationCryptoHandle' in internalExecution).toBe(false);
    expect('verifyEscapeObligationReviewEnvelope' in internalExecution).toBe(true);
  });
});
