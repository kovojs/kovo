// @kovo-security-classifier-corpus runtime-posture-attestation
import { createPublicKey, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createRuntimeAttestationCryptoHandle,
  createSecurityEventCryptoHandle,
} from './crypto-authority.js';
import {
  createSecurityEventJournal,
  type SecurityEventRecord,
} from './security-event.js';
import {
  createRuntimePostureAttestor,
  runtimeAttestationPayloadSource,
} from './runtime-attestation.js';

const SECRET = 'runtime-attestation-test-secret-0123456789abcdef0123456789abcdef';

describe('security event journal and runtime posture attestation (SPEC §§6.6, 11.2)', () => {
  it('keeps a bounded purpose-separated HMAC chain whose head detects record tampering', () => {
    let now = 1_720_000_000_000;
    const crypto = createSecurityEventCryptoHandle(SECRET, 'deployment:test');
    const journal = createSecurityEventJournal({
      capacity: 2,
      crypto,
      now: () => now++,
    });

    journal.record({ reason: 'policy', type: 'egress-denied' });
    journal.record({ reason: 'invalid-token', type: 'csrf-rejected' });
    journal.record({ reason: 'request-body', type: 'budget-exhausted' });

    const records = journal.snapshot();
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.type)).toEqual([
      'csrf-rejected',
      'budget-exhausted',
    ]);
    expect(journal.head()).toMatchObject({ dropped: 1, sequence: 3 });
    expect(records.every((record) => record.schema === 'kovo-security-event/v1')).toBe(true);
    expect(Object.isFrozen(records[0])).toBe(true);

    const tampered = { ...records[1], reason: 'allow' } as SecurityEventRecord;
    expect(journal.verify(records[1]!)).toBe(true);
    expect(journal.verify(tampered)).toBe(false);
  });

  it('signs a fresh caller nonce and closes stale or replayed challenges', () => {
    let now = 1_720_000_000_000;
    const crypto = createRuntimeAttestationCryptoHandle(SECRET, 'deployment:test');
    const attestor = createRuntimePostureAttestor({
      crypto,
      deploymentId: 'deployment:test',
      eventChainHead: () => ({ dropped: 0, keyId: 'current', mac: 'head', sequence: 7 }),
      instanceIdentity: 'instance:test',
      now: () => now,
      posture: {
        artifactSubject: `sha256:${'a'.repeat(64)}`,
        facts: { endpointAuth: [], egressAllowlist: [], irVersions: ['kovo-security-operation-ir/v1'], trustEscapes: [] },
        postureDigest: `sha256:${'b'.repeat(64)}`,
        schema: 'kovo-runtime-posture/v1',
      },
    });
    const nonce = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const envelope = attestor.challenge(nonce);

    expect(envelope.payload).toMatchObject({
      artifactSubject: `sha256:${'a'.repeat(64)}`,
      deploymentId: 'deployment:test',
      nonce,
      postureDigest: `sha256:${'b'.repeat(64)}`,
      schema: 'kovo-runtime-posture-attestation/v1',
    });
    expect(envelope.trustAnchorFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(
      verify(
        null,
        Buffer.from(runtimeAttestationPayloadSource(envelope.payload)),
        createPublicKey({
          format: 'der',
          key: Buffer.from(envelope.publicKeySpki, 'base64url'),
          type: 'spki',
        }),
        Buffer.from(envelope.signature, 'base64url'),
      ),
    ).toBe(true);

    expect(() => attestor.challenge(nonce)).toThrow(/replayed nonce/u);
    now += 61_000;
    expect(() => attestor.challenge('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB')).not.toThrow();
    expect(attestor.challenge('CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC').payload.expiresAt).toBe(
      now + 60_000,
    );
  });
});
