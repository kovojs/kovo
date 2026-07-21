// @kovo-security-certifies C13 metric-e-escape-review-signature
import { describe, expect, it } from 'vitest';

import {
  createRuntimeAttestationCryptoHandle,
  createRuntimeAttestationVerificationHandle,
} from './crypto-authority.js';
import {
  createEscapeCensusReviewEnvelope,
  snapshotEscapeCensusReviewSubject,
  verifyEscapeCensusReviewEnvelope,
  verifyEscapeCensusReviewSet,
} from './escape-census-review.js';
import * as internalExecution from './internal/execution.js';

const artifactSubject = `sha256:${'b'.repeat(64)}` as const;

function site(file: string, start: number, end: number, digestDigit: string, sourceLength = 256) {
  return {
    encoding: 'utf16le' as const,
    file,
    sliceHash: `sha256:${digestDigit.repeat(64)}` as const,
    sourceHash: `sha256:${digestDigit.repeat(64)}` as const,
    sourceLength,
    span: { end, start },
  };
}

describe('Metric E escape-root review signatures (SPEC sections 6.6 and 11.2)', () => {
  it('binds the exact door, root, complete producer-site set, artifact, and existing anchor', () => {
    const authority = createRuntimeAttestationCryptoHandle(
      'escape-census-review-test-secret-0123456789abcdef0123456789abcdef',
      'deployment:test',
    );
    const envelope = createEscapeCensusReviewEnvelope(
      {
        artifactSubject,
        door: 'ctx.fetch',
        root: 'route:account/export',
        sites: [site('src/export-a.tsx', 120, 144, 'a'), site('src/export-b.tsx', 90, 110, 'c')],
      },
      authority,
    );

    expect(envelope.subject.sites).toEqual([
      site('src/export-a.tsx', 120, 144, 'a'),
      site('src/export-b.tsx', 90, 110, 'c'),
    ]);
    const options = {
      artifactSubject,
      trustAnchorFingerprint: authority.trustAnchorFingerprint,
      verification: createRuntimeAttestationVerificationHandle(),
    };
    expect(verifyEscapeCensusReviewEnvelope(envelope, options)).toBe(true);

    for (const subject of [
      { ...envelope.subject, door: 'trustedSql' },
      { ...envelope.subject, root: 'route:account/other' },
      { ...envelope.subject, sites: [site('src/export-a.tsx', 120, 144, 'a')] },
      { ...envelope.subject, artifactSubject: `sha256:${'c'.repeat(64)}` },
    ]) {
      expect(verifyEscapeCensusReviewEnvelope({ ...envelope, subject }, options)).toBe(false);
    }
  });

  it('rejects replacement keys, malformed fields, accessors, and unsupported doors', () => {
    const authority = createRuntimeAttestationCryptoHandle(
      'escape-census-review-test-secret-0123456789abcdef0123456789abcdef',
      'deployment:test',
    );
    const replacement = createRuntimeAttestationCryptoHandle(
      'replacement-census-review-secret-0123456789abcdef0123456789abcdef',
      'deployment:test',
    );
    const envelope = createEscapeCensusReviewEnvelope(
      {
        artifactSubject,
        door: 'ctx.fetch',
        root: 'task:sync/run',
        sites: [site('src/task-sync.ts', 10, 40, 'a')],
      },
      authority,
    );
    const options = {
      artifactSubject,
      trustAnchorFingerprint: authority.trustAnchorFingerprint,
      verification: createRuntimeAttestationVerificationHandle(),
    };

    expect(
      verifyEscapeCensusReviewEnvelope(
        {
          ...envelope,
          publicKeySpki: replacement.publicKeySpki,
          trustAnchorFingerprint: replacement.trustAnchorFingerprint,
        },
        options,
      ),
    ).toBe(false);
    expect(
      verifyEscapeCensusReviewEnvelope(
        { ...envelope, subject: { ...envelope.subject, door: 'rawEndpoint' } },
        options,
      ),
    ).toBe(false);
    expect(
      verifyEscapeCensusReviewEnvelope({ ...envelope, unsignedNote: 'reviewed' }, options),
    ).toBe(false);

    let getterCalls = 0;
    const accessor = { ...envelope } as Record<string, unknown>;
    Object.defineProperty(accessor, 'signature', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return envelope.signature;
      },
    });
    expect(verifyEscapeCensusReviewEnvelope(accessor, options)).toBe(false);
    expect(getterCalls).toBe(0);
  });

  it('keeps the signer off build and execution surfaces', () => {
    expect('createEscapeCensusReviewEnvelope' in internalExecution).toBe(false);
    expect('createRuntimeAttestationCryptoHandle' in internalExecution).toBe(false);
    expect('snapshotEscapeCensusReviewSubject' in internalExecution).toBe(true);
    expect('verifyEscapeCensusReviewEnvelope' in internalExecution).toBe(true);
  });

  it('requires an exact one-to-one set before returning reviewed Metric E roots', () => {
    const authority = createRuntimeAttestationCryptoHandle(
      'escape-census-review-test-secret-0123456789abcdef0123456789abcdef',
      'deployment:test',
    );
    const verification = createRuntimeAttestationVerificationHandle();
    const subjects = [
      {
        artifactSubject,
        door: 'csrf:false' as const,
        root: 'mutation:admin/delete',
        schema: 'kovo.escape-census-review/v1' as const,
        sites: [site('src/admin.tsx', 20, 40, 'a')],
      },
      {
        artifactSubject,
        door: 'ctx.fetch' as const,
        root: 'task:sync/run',
        schema: 'kovo.escape-census-review/v1' as const,
        sites: [site('src/sync-panel.tsx', 10, 100, 'c')],
      },
    ];
    const envelopes = subjects.map(({ schema: _schema, ...subject }) =>
      createEscapeCensusReviewEnvelope(subject, authority),
    );
    const options = {
      trustAnchorFingerprint: authority.trustAnchorFingerprint,
      verification,
    };
    expect(verifyEscapeCensusReviewSet(subjects, envelopes, options)).toEqual({
      count: 2,
      roots: [
        { artifactSubject, door: 'csrf:false', root: 'mutation:admin/delete' },
        { artifactSubject, door: 'ctx.fetch', root: 'task:sync/run' },
      ],
    });

    expect(() => verifyEscapeCensusReviewSet(subjects, envelopes.slice(0, 1), options)).toThrow(
      'count mismatch',
    );
    expect(() =>
      verifyEscapeCensusReviewSet(subjects, [envelopes[0], envelopes[0]], options),
    ).toThrow('surplus or duplicated subject');
    expect(() =>
      verifyEscapeCensusReviewSet(
        [subjects[0], { ...subjects[0], sites: [site('src/admin.tsx', 41, 60, 'd')] }],
        envelopes,
        options,
      ),
    ).toThrow('duplicate root identity');
    expect(() =>
      verifyEscapeCensusReviewSet(
        subjects,
        [envelopes[0], { ...envelopes[1], signature: `${envelopes[1]!.signature}x` }],
        options,
      ),
    ).toThrow('signature is invalid');
  });

  it('bounds each exact producer-site set before indexing review evidence', () => {
    expect(() =>
      snapshotEscapeCensusReviewSubject({
        artifactSubject,
        door: 'trustedHtml',
        root: 'route:bounded',
        schema: 'kovo.escape-census-review/v1',
        sites: Array.from({ length: 4_097 }, () => site('src/bounded.ts', 1, 2, 'a')),
      }),
    ).toThrow('invalid schema or identity');
  });
});
