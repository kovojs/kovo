import { canonicalJsonStringify } from '@kovojs/core/internal/json';

import {
  snapshotAuditText,
  snapshotTrustedAssignObligation,
  type TrustedAssignObligation,
} from './audit-justification.js';
import type {
  RuntimeAttestationCryptoHandle,
  RuntimeAttestationVerificationHandle,
} from './crypto-authority.js';
import { securityRegExpTest } from './response-security-intrinsics.js';
import {
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectIs,
  witnessOwnKeys,
} from './security-witness-intrinsics.js';

/** @internal Detached escape-review signature schema. */
export const KOVO_ESCAPE_OBLIGATION_REVIEW_SCHEMA = 'kovo.escape-obligation-review/v1' as const;

/** @internal Exact artifact-bound subject reviewed outside the app/build environment. */
export interface EscapeObligationReviewSubject {
  readonly artifactSubject: `sha256:${string}`;
  readonly obligation: Readonly<TrustedAssignObligation>;
  readonly schema: typeof KOVO_ESCAPE_OBLIGATION_REVIEW_SCHEMA;
  readonly siteIdentity: string;
}

/** @internal Detached Ed25519 envelope verified by the review CLI. */
export interface EscapeObligationReviewEnvelope {
  readonly keyId: string;
  readonly publicKeySpki: string;
  readonly signature: string;
  readonly subject: Readonly<EscapeObligationReviewSubject>;
  readonly trustAnchorFingerprint: `sha256:${string}`;
}

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SITE_IDENTITY_PATTERN = /^.+:[0-9]{1,16}:[0-9]{1,16}$/u;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/u;

/** @internal Canonical, domain-separated bytes signed by the deployment-attestation anchor. */
export function escapeObligationReviewPayload(
  subject: EscapeObligationReviewSubject,
  keyId: string,
): string {
  return canonicalJsonStringify({ keyId, subject });
}

/**
 * Mint a review envelope from the existing runtime-attestation authority.
 *
 * @internal This factory belongs only in an out-of-band reviewer service/test harness. Kovo's
 * build and coding-agent surfaces deliberately expose verification and unsigned subjects only.
 */
export function createEscapeObligationReviewEnvelope(
  source: Omit<EscapeObligationReviewSubject, 'schema'>,
  authority: RuntimeAttestationCryptoHandle,
): Readonly<EscapeObligationReviewEnvelope> {
  const subject = snapshotReviewSubject({
    artifactSubject: source.artifactSubject,
    obligation: source.obligation,
    schema: KOVO_ESCAPE_OBLIGATION_REVIEW_SCHEMA,
    siteIdentity: source.siteIdentity,
  });
  const signed = authority.sign(escapeObligationReviewPayload(subject, authority.currentKeyId));
  if (signed.keyId !== authority.currentKeyId) {
    throw new TypeError('Escape-obligation review authority changed keys mid-signature.');
  }
  if (!securityRegExpTest(SHA256_PATTERN, authority.trustAnchorFingerprint)) {
    throw new TypeError('Escape-obligation review authority has an invalid trust anchor.');
  }
  return witnessFreeze({
    keyId: signed.keyId,
    publicKeySpki: authority.publicKeySpki,
    signature: signed.signature,
    subject,
    trustAnchorFingerprint: authority.trustAnchorFingerprint as `sha256:${string}`,
  });
}

/** @internal Verify an external review without accepting key material or learning the anchor. */
export function verifyEscapeObligationReviewEnvelope(
  envelope: unknown,
  options: {
    readonly artifactSubject: `sha256:${string}`;
    readonly trustAnchorFingerprint: string;
    readonly verification: RuntimeAttestationVerificationHandle;
  },
): boolean {
  try {
    const record = exactReviewRecord(envelope, 'escape-obligation review envelope', [
      'keyId',
      'publicKeySpki',
      'signature',
      'subject',
      'trustAnchorFingerprint',
    ]);
    const keyId = reviewOwnValue(record, 'keyId', 'escape-obligation review envelope');
    const publicKeySpki = reviewOwnValue(
      record,
      'publicKeySpki',
      'escape-obligation review envelope',
    );
    const signature = reviewOwnValue(record, 'signature', 'escape-obligation review envelope');
    const trustAnchorFingerprint = reviewOwnValue(
      record,
      'trustAnchorFingerprint',
      'escape-obligation review envelope',
    );
    if (
      !securityRegExpTest(SHA256_PATTERN, options.artifactSubject) ||
      !securityRegExpTest(SHA256_PATTERN, options.trustAnchorFingerprint) ||
      typeof publicKeySpki !== 'string' ||
      typeof signature !== 'string' ||
      typeof keyId !== 'string' ||
      !securityRegExpTest(KEY_ID_PATTERN, keyId) ||
      trustAnchorFingerprint !== options.trustAnchorFingerprint ||
      options.verification.trustAnchorFingerprint(publicKeySpki) !== options.trustAnchorFingerprint
    ) {
      return false;
    }
    const subject = snapshotReviewSubject(
      reviewOwnValue(record, 'subject', 'escape-obligation review envelope'),
    );
    if (subject.artifactSubject !== options.artifactSubject) return false;
    return options.verification.verifySignedPayload(
      escapeObligationReviewPayload(subject, keyId),
      publicKeySpki,
      signature,
    );
  } catch {
    return false;
  }
}

function snapshotReviewSubject(value: unknown): EscapeObligationReviewSubject {
  const record = exactReviewRecord(value, 'escape-obligation review subject', [
    'artifactSubject',
    'obligation',
    'schema',
    'siteIdentity',
  ]);
  const schema = reviewOwnValue(record, 'schema', 'escape-obligation review subject');
  const artifactSubject = reviewOwnValue(
    record,
    'artifactSubject',
    'escape-obligation review subject',
  );
  const siteIdentity = reviewOwnValue(record, 'siteIdentity', 'escape-obligation review subject');
  if (
    schema !== KOVO_ESCAPE_OBLIGATION_REVIEW_SCHEMA ||
    typeof artifactSubject !== 'string' ||
    !securityRegExpTest(SHA256_PATTERN, artifactSubject) ||
    typeof siteIdentity !== 'string'
  ) {
    throw new TypeError(
      'Escape-obligation review subject has an invalid schema, site, or artifact.',
    );
  }
  const stableSiteIdentity = snapshotAuditText(
    siteIdentity,
    'escape-obligation review subject.siteIdentity',
  );
  if (!securityRegExpTest(SITE_IDENTITY_PATTERN, stableSiteIdentity)) {
    throw new TypeError(
      'Escape-obligation review subject site identity must end in exact scanner offsets.',
    );
  }
  return witnessFreeze({
    artifactSubject: artifactSubject as `sha256:${string}`,
    obligation: snapshotTrustedAssignObligation(
      reviewOwnValue(record, 'obligation', 'escape-obligation review subject'),
      'escape-obligation review subject',
    ),
    schema: KOVO_ESCAPE_OBLIGATION_REVIEW_SCHEMA,
    siteIdentity: stableSiteIdentity,
  });
}

function exactReviewRecord(value: unknown, label: string, expectedKeys: readonly string[]): object {
  if (typeof value !== 'object' || value === null || witnessIsArray(value)) {
    throw new TypeError(`${label} must be an exact record.`);
  }
  const keys = witnessOwnKeys(value);
  if (keys.length !== expectedKeys.length) throw new TypeError(`${label} has unsupported fields.`);
  for (let index = 0; index < keys.length; index += 1) {
    const candidate = keys[index];
    if (typeof candidate !== 'string' || !reviewExpectedKey(expectedKeys, candidate)) {
      throw new TypeError(`${label} has unsupported fields.`);
    }
  }
  return value;
}

function reviewExpectedKey(expectedKeys: readonly string[], candidate: string): boolean {
  for (let index = 0; index < expectedKeys.length; index += 1) {
    if (expectedKeys[index] === candidate) return true;
  }
  return false;
}

function reviewOwnValue(record: object, key: string, label: string): unknown {
  const before = witnessGetOwnPropertyDescriptor(record, key);
  const after = witnessGetOwnPropertyDescriptor(record, key);
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value)
  ) {
    throw new TypeError(`${label}.${key} must be a stable own data property.`);
  }
  return before.value;
}
