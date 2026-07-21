import { canonicalJsonStringify } from '@kovojs/core/internal/json';

import { snapshotAuditText } from './audit-justification.js';
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

/** @internal Detached review schema for one exact Metric E escape root. */
export const KOVO_ESCAPE_CENSUS_REVIEW_SCHEMA = 'kovo.escape-census-review/v1' as const;

/** @internal Closed Metric E door vocabulary (plans/10x-better-security-3.md section 4.1). */
export const KOVO_ESCAPE_CENSUS_REVIEW_DOORS = witnessFreeze([
  'allowControlChars',
  'csrf:false',
  'ctx.fetch',
  'kovoAnalyzerSummary',
  'trustedHtml',
  'trustedSql',
] as const);

export type EscapeCensusReviewDoor = (typeof KOVO_ESCAPE_CENSUS_REVIEW_DOORS)[number];

/** Exact authored producer site within one analyzed app source snapshot. */
export interface EscapeCensusReviewSite {
  readonly encoding: 'utf16le';
  readonly file: string;
  readonly sliceHash: `sha256:${string}`;
  readonly sourceHash: `sha256:${string}`;
  readonly sourceLength: number;
  readonly span: {
    readonly end: number;
    readonly start: number;
  };
}

/**
 * Exact artifact-bound subject reviewed outside the app/build environment.
 *
 * `sites` contains every producer site collapsed into this one counted app/root/door identity, so
 * the detached signature cannot bless a convenient duplicate while leaving another producer row
 * outside review.
 *
 * @internal
 */
export interface EscapeCensusReviewSubject {
  readonly artifactSubject: `sha256:${string}`;
  readonly door: EscapeCensusReviewDoor;
  readonly root: string;
  readonly schema: typeof KOVO_ESCAPE_CENSUS_REVIEW_SCHEMA;
  readonly sites: readonly EscapeCensusReviewSite[];
}

/** @internal Detached Ed25519 envelope verified under the runtime-posture trust anchor. */
export interface EscapeCensusReviewEnvelope {
  readonly keyId: string;
  readonly publicKeySpki: string;
  readonly signature: string;
  readonly subject: Readonly<EscapeCensusReviewSubject>;
  readonly trustAnchorFingerprint: `sha256:${string}`;
}

/** @internal Exact verified identities returned to Metric E; signatures remain detached evidence. */
export interface EscapeCensusReviewVerification {
  readonly count: number;
  readonly roots: readonly {
    readonly artifactSubject: `sha256:${string}`;
    readonly door: EscapeCensusReviewDoor;
    readonly root: string;
  }[];
}

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/u;
const MAX_ESCAPE_CENSUS_REVIEW_ROOTS = 4_096;
const MAX_ESCAPE_CENSUS_REVIEW_SITES = 4_096;

/** @internal Canonical domain-separated bytes signed by the existing deployment anchor. */
export function escapeCensusReviewPayload(
  subject: EscapeCensusReviewSubject,
  keyId: string,
): string {
  return canonicalJsonStringify({ keyId, subject });
}

/**
 * Mint one review envelope from the existing runtime-attestation authority.
 *
 * @internal This factory belongs only in an out-of-band reviewer service or test harness. Build,
 * execution, and app-facing modules expose unsigned subjects and verification, never this signer.
 */
export function createEscapeCensusReviewEnvelope(
  source: Omit<EscapeCensusReviewSubject, 'schema'>,
  authority: RuntimeAttestationCryptoHandle,
): Readonly<EscapeCensusReviewEnvelope> {
  const subject = snapshotEscapeCensusReviewSubject({
    artifactSubject: source.artifactSubject,
    door: source.door,
    root: source.root,
    schema: KOVO_ESCAPE_CENSUS_REVIEW_SCHEMA,
    sites: source.sites,
  });
  const signed = authority.sign(escapeCensusReviewPayload(subject, authority.currentKeyId));
  if (signed.keyId !== authority.currentKeyId) {
    throw new TypeError('Escape-census review authority changed keys mid-signature.');
  }
  if (!securityRegExpTest(SHA256_PATTERN, authority.trustAnchorFingerprint)) {
    throw new TypeError('Escape-census review authority has an invalid trust anchor.');
  }
  return witnessFreeze({
    keyId: signed.keyId,
    publicKeySpki: authority.publicKeySpki,
    signature: signed.signature,
    subject,
    trustAnchorFingerprint: authority.trustAnchorFingerprint as `sha256:${string}`,
  });
}

/** @internal Verify a detached review without accepting signing key material. */
export function verifyEscapeCensusReviewEnvelope(
  envelope: unknown,
  options: {
    readonly artifactSubject: `sha256:${string}`;
    readonly trustAnchorFingerprint: string;
    readonly verification: RuntimeAttestationVerificationHandle;
  },
): boolean {
  try {
    const record = exactReviewRecord(envelope, 'escape-census review envelope', [
      'keyId',
      'publicKeySpki',
      'signature',
      'subject',
      'trustAnchorFingerprint',
    ]);
    const keyId = reviewOwnValue(record, 'keyId', 'escape-census review envelope');
    const publicKeySpki = reviewOwnValue(record, 'publicKeySpki', 'escape-census review envelope');
    const signature = reviewOwnValue(record, 'signature', 'escape-census review envelope');
    const trustAnchorFingerprint = reviewOwnValue(
      record,
      'trustAnchorFingerprint',
      'escape-census review envelope',
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
    const subject = snapshotEscapeCensusReviewSubject(
      reviewOwnValue(record, 'subject', 'escape-census review envelope'),
    );
    if (subject.artifactSubject !== options.artifactSubject) return false;
    return options.verification.verifySignedPayload(
      escapeCensusReviewPayload(subject, keyId),
      publicKeySpki,
      signature,
    );
  } catch {
    return false;
  }
}

/**
 * Require one and only one valid detached envelope for every counted subject.
 *
 * @internal Missing, duplicate, surplus, wrong-anchor, stale-artifact, and invalid-signature rows
 * all fail rather than silently reducing the unsigned count.
 */
export function verifyEscapeCensusReviewSet(
  expectedSubjects: unknown,
  envelopes: unknown,
  options: {
    readonly trustAnchorFingerprint: string;
    readonly verification: RuntimeAttestationVerificationHandle;
  },
): Readonly<EscapeCensusReviewVerification> {
  if (!witnessIsArray(expectedSubjects) || !witnessIsArray(envelopes)) {
    throw new TypeError('Escape-census review subjects and envelopes must be arrays.');
  }
  if (
    expectedSubjects.length > MAX_ESCAPE_CENSUS_REVIEW_ROOTS ||
    envelopes.length > MAX_ESCAPE_CENSUS_REVIEW_ROOTS
  ) {
    throw new TypeError('Escape-census review set exceeds 4096 roots.');
  }
  if (expectedSubjects.length !== envelopes.length) {
    throw new TypeError(
      `Escape-census review count mismatch expected=${expectedSubjects.length} actual=${envelopes.length}.`,
    );
  }
  const subjects = expectedSubjects.map(snapshotEscapeCensusReviewSubject);
  const subjectKeys = subjects.map((subject) => canonicalJsonStringify(subject));
  const rootIdentityKeys = subjects.map((subject) =>
    canonicalJsonStringify({
      artifactSubject: subject.artifactSubject,
      door: subject.door,
      root: subject.root,
    }),
  );
  if (new Set(rootIdentityKeys).size !== rootIdentityKeys.length) {
    throw new TypeError('Escape-census review subjects contain a duplicate root identity.');
  }
  const expectedKeys = new Set(subjectKeys);
  const envelopesBySubject = new Map<string, unknown>();
  for (let envelopeIndex = 0; envelopeIndex < envelopes.length; envelopeIndex += 1) {
    const envelope = exactReviewRecord(
      envelopes[envelopeIndex],
      `escape-census review envelope[${envelopeIndex}]`,
      ['keyId', 'publicKeySpki', 'signature', 'subject', 'trustAnchorFingerprint'],
    );
    const envelopeSubject = snapshotEscapeCensusReviewSubject(
      reviewOwnValue(envelope, 'subject', `escape-census review envelope[${envelopeIndex}]`),
    );
    const key = canonicalJsonStringify(envelopeSubject);
    if (!expectedKeys.has(key) || envelopesBySubject.has(key)) {
      throw new TypeError('Escape-census review set contains a surplus or duplicated subject.');
    }
    envelopesBySubject.set(key, envelopes[envelopeIndex]);
  }
  for (let subjectIndex = 0; subjectIndex < subjects.length; subjectIndex += 1) {
    const subject = subjects[subjectIndex]!;
    const key = subjectKeys[subjectIndex]!;
    const envelope = envelopesBySubject.get(key);
    if (envelope === undefined) {
      throw new TypeError(
        `Escape-census review is missing or duplicated for ${subject.door}/${subject.root}.`,
      );
    }
    if (
      !verifyEscapeCensusReviewEnvelope(envelope, {
        artifactSubject: subject.artifactSubject,
        trustAnchorFingerprint: options.trustAnchorFingerprint,
        verification: options.verification,
      })
    ) {
      throw new TypeError(
        `Escape-census review signature is invalid for ${subject.door}/${subject.root}.`,
      );
    }
  }
  return witnessFreeze({
    count: subjects.length,
    roots: witnessFreeze(
      subjects.map((subject) =>
        witnessFreeze({
          artifactSubject: subject.artifactSubject,
          door: subject.door,
          root: subject.root,
        }),
      ),
    ),
  });
}

/** @internal Fail-closed snapshot used by build emission and signature verification. */
export function snapshotEscapeCensusReviewSubject(value: unknown): EscapeCensusReviewSubject {
  const record = exactReviewRecord(value, 'escape-census review subject', [
    'artifactSubject',
    'door',
    'root',
    'schema',
    'sites',
  ]);
  const schema = reviewOwnValue(record, 'schema', 'escape-census review subject');
  const artifactSubject = reviewOwnValue(record, 'artifactSubject', 'escape-census review subject');
  const door = reviewOwnValue(record, 'door', 'escape-census review subject');
  const root = reviewOwnValue(record, 'root', 'escape-census review subject');
  const sites = reviewOwnValue(record, 'sites', 'escape-census review subject');
  if (
    schema !== KOVO_ESCAPE_CENSUS_REVIEW_SCHEMA ||
    typeof artifactSubject !== 'string' ||
    !securityRegExpTest(SHA256_PATTERN, artifactSubject) ||
    !escapeCensusReviewDoor(door) ||
    typeof root !== 'string' ||
    !witnessIsArray(sites) ||
    sites.length === 0 ||
    sites.length > MAX_ESCAPE_CENSUS_REVIEW_SITES
  ) {
    throw new TypeError('Escape-census review subject has an invalid schema or identity.');
  }
  const stableRoot = snapshotAuditText(root, 'escape-census review subject.root');
  const stableSites: EscapeCensusReviewSite[] = [];
  const stableSiteKeys: string[] = [];
  for (let index = 0; index < sites.length; index += 1) {
    const site = snapshotEscapeCensusReviewSite(
      sites[index],
      `escape-census review subject.sites[${index}]`,
    );
    const siteKey = canonicalJsonStringify(site);
    if (stableSiteKeys.includes(siteKey)) {
      throw new TypeError('Escape-census review subject sites must be unique.');
    }
    if (index > 0 && stableSiteKeys[index - 1]! >= siteKey) {
      throw new TypeError('Escape-census review subject sites must be canonically sorted.');
    }
    stableSites.push(site);
    stableSiteKeys.push(siteKey);
  }
  if (door !== 'csrf:false' && door !== 'ctx.fetch') {
    const site = stableSites[0]!;
    if (
      stableSites.length !== 1 ||
      stableRoot !== `${site.file}:${site.span.start}:${site.span.end}`
    ) {
      throw new TypeError(
        'Escape-census source-root review must bind exactly one matching authored site.',
      );
    }
  }
  return witnessFreeze({
    artifactSubject: artifactSubject as `sha256:${string}`,
    door,
    root: stableRoot,
    schema: KOVO_ESCAPE_CENSUS_REVIEW_SCHEMA,
    sites: witnessFreeze(stableSites),
  });
}

function snapshotEscapeCensusReviewSite(value: unknown, label: string): EscapeCensusReviewSite {
  const record = exactReviewRecord(value, label, [
    'encoding',
    'file',
    'sliceHash',
    'sourceHash',
    'sourceLength',
    'span',
  ]);
  const encoding = reviewOwnValue(record, 'encoding', label);
  const file = reviewOwnValue(record, 'file', label);
  const sliceHash = reviewOwnValue(record, 'sliceHash', label);
  const sourceHash = reviewOwnValue(record, 'sourceHash', label);
  const sourceLength = reviewOwnValue(record, 'sourceLength', label);
  const spanRecord = exactReviewRecord(reviewOwnValue(record, 'span', label), `${label}.span`, [
    'end',
    'start',
  ]);
  const start = reviewOwnValue(spanRecord, 'start', `${label}.span`);
  const end = reviewOwnValue(spanRecord, 'end', `${label}.span`);
  if (
    encoding !== 'utf16le' ||
    typeof file !== 'string' ||
    !exactRelativeSourcePath(file) ||
    typeof sliceHash !== 'string' ||
    !securityRegExpTest(SHA256_PATTERN, sliceHash) ||
    typeof sourceHash !== 'string' ||
    !securityRegExpTest(SHA256_PATTERN, sourceHash) ||
    !Number.isSafeInteger(sourceLength) ||
    (sourceLength as number) < 0 ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    (start as number) < 0 ||
    (end as number) <= (start as number) ||
    (end as number) > (sourceLength as number)
  ) {
    throw new TypeError(`${label} has an invalid analyzed-source identity.`);
  }
  return witnessFreeze({
    encoding: 'utf16le',
    file,
    sliceHash: sliceHash as `sha256:${string}`,
    sourceHash: sourceHash as `sha256:${string}`,
    sourceLength: sourceLength as number,
    span: witnessFreeze({ end: end as number, start: start as number }),
  });
}

function exactRelativeSourcePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 4_096 ||
    value.trim() !== value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes(':')
  ) {
    return false;
  }
  const parts = value.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff
    ) {
      return false;
    }
  }
  return true;
}

function escapeCensusReviewDoor(value: unknown): value is EscapeCensusReviewDoor {
  for (let index = 0; index < KOVO_ESCAPE_CENSUS_REVIEW_DOORS.length; index += 1) {
    if (KOVO_ESCAPE_CENSUS_REVIEW_DOORS[index] === value) return true;
  }
  return false;
}

function exactReviewRecord(value: unknown, label: string, expectedKeys: readonly string[]): object {
  if (typeof value !== 'object' || value === null || witnessIsArray(value)) {
    throw new TypeError(`${label} must be an exact record.`);
  }
  const keys = witnessOwnKeys(value);
  if (keys.length !== expectedKeys.length) throw new TypeError(`${label} has unsupported fields.`);
  for (let index = 0; index < keys.length; index += 1) {
    const candidate = keys[index];
    if (typeof candidate !== 'string' || !expectedKeys.includes(candidate)) {
      throw new TypeError(`${label} has unsupported fields.`);
    }
  }
  return value;
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
