import {
  securityRegExpTest,
  securityStringCharCodeAt,
  securityStringTrim,
} from './response-security-intrinsics.js';
import {
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectIs,
  witnessOwnKeys,
} from './security-witness-intrinsics.js';

const MAX_AUDIT_TEXT_LENGTH = 4_096;
const AUDIT_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,255}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

/** The only invariant `trustedAssign` may assert (SPEC §§6.6, 10.3, 11.1). */
export type TrustedAssignInvariant = 'governed-write.authorized-principal';

/** A machine-addressable reason an exceptional governed write remains authorized. */
export type TrustedAssignWhy =
  | {
      /** Exact guard/policy binding reviewed at the call site. */
      readonly guard: string;
      readonly kind: 'guard-chain';
    }
  | {
      readonly kind: 'policy';
      /** Stable external policy identifier, not explanatory prose. */
      readonly policy: string;
    };

/** Digest-bound evidence offered for second-party review of a privileged write. */
export interface TrustedAssignEvidence {
  readonly digest: `sha256:${string}`;
  readonly kind: 'policy-review' | 'test';
  /** Stable test/policy locator, not explanatory prose. */
  readonly reference: string;
}

/**
 * Structured review obligation for the `trustedAssign` KV438 escape.
 *
 * This shape is author-time ergonomics only. The runtime chokepoint and build analyzer both
 * independently validate the exact closed grammar (SPEC §§6.6, 10.3, 11.1).
 */
export interface TrustedAssignObligation {
  readonly evidence: TrustedAssignEvidence;
  readonly invariant: TrustedAssignInvariant;
  readonly why: TrustedAssignWhy;
}

/** @internal Validate and pin one structured privileged-write obligation. */
export function snapshotTrustedAssignObligation(
  value: unknown,
  label: string,
): Readonly<TrustedAssignObligation> {
  const record = exactAuditRecord(value, label, ['evidence', 'invariant', 'why']);
  const invariant = auditOwnValue(record, 'invariant', label);
  if (invariant !== 'governed-write.authorized-principal') {
    throw new TypeError(
      `${label} requires invariant "governed-write.authorized-principal" in its structured obligation.`,
    );
  }
  return witnessFreeze({
    evidence: snapshotTrustedAssignEvidence(auditOwnValue(record, 'evidence', label), label),
    invariant,
    why: snapshotTrustedAssignWhy(auditOwnValue(record, 'why', label), label),
  });
}

/** @internal Close a human-audited escape reason before it reaches runtime or explain facts. */
export function snapshotAuditJustification(value: unknown, label: string): string {
  return snapshotAuditedString(value, label, 'justification');
}

/** @internal Close a human-audited reason before it reaches runtime or explain facts. */
export function snapshotAuditReason(value: unknown, label: string): string {
  return snapshotAuditedString(value, label, 'audit reason');
}

/** @internal Close auxiliary human-audit metadata before it reaches runtime or explain facts. */
export function snapshotAuditText(value: unknown, label: string): string {
  return snapshotAuditedString(value, label, 'audit text');
}

function snapshotAuditedString(
  value: unknown,
  label: string,
  field: 'audit reason' | 'audit text' | 'justification',
): string {
  const trimmed = typeof value === 'string' ? securityStringTrim(value) : undefined;
  if (
    typeof value !== 'string' ||
    value.length > MAX_AUDIT_TEXT_LENGTH ||
    trimmed === '' ||
    trimmed !== value
  ) {
    throw new TypeError(
      `${label} requires a non-empty ${field}; it must have no leading/trailing whitespace, be printable, and be at most ${MAX_AUDIT_TEXT_LENGTH} characters.`,
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff
    ) {
      throw new TypeError(
        `${label} requires a non-empty ${field}; it must be printable without control characters or bidirectional formatting characters.`,
      );
    }
  }
  return value;
}

function snapshotTrustedAssignEvidence(value: unknown, label: string): TrustedAssignEvidence {
  const evidence = exactAuditRecord(value, `${label}.evidence`, ['digest', 'kind', 'reference']);
  const digest = auditOwnValue(evidence, 'digest', `${label}.evidence`);
  const kind = auditOwnValue(evidence, 'kind', `${label}.evidence`);
  const reference = auditOwnValue(evidence, 'reference', `${label}.evidence`);
  if (typeof digest !== 'string' || !securityRegExpTest(SHA256_PATTERN, digest)) {
    throw new TypeError(`${label}.evidence.digest must be an exact sha256 digest.`);
  }
  if (kind !== 'policy-review' && kind !== 'test') {
    throw new TypeError(`${label}.evidence.kind must be "policy-review" or "test".`);
  }
  return witnessFreeze({
    digest: digest as `sha256:${string}`,
    kind,
    reference: auditReference(reference, `${label}.evidence.reference`),
  });
}

function snapshotTrustedAssignWhy(value: unknown, label: string): TrustedAssignWhy {
  if (typeof value !== 'object' || value === null || witnessIsArray(value)) {
    throw new TypeError(`${label}.why must be a structured obligation record.`);
  }
  const kind = auditOwnValue(value, 'kind', `${label}.why`);
  if (kind === 'guard-chain') {
    const why = exactAuditRecord(value, `${label}.why`, ['guard', 'kind']);
    return witnessFreeze({
      guard: auditReference(auditOwnValue(why, 'guard', `${label}.why`), `${label}.why.guard`),
      kind,
    });
  }
  if (kind === 'policy') {
    const why = exactAuditRecord(value, `${label}.why`, ['kind', 'policy']);
    return witnessFreeze({
      kind,
      policy: auditReference(auditOwnValue(why, 'policy', `${label}.why`), `${label}.why.policy`),
    });
  }
  throw new TypeError(`${label}.why.kind must be "guard-chain" or "policy".`);
}

function auditReference(value: unknown, label: string): string {
  if (typeof value !== 'string' || !securityRegExpTest(AUDIT_REFERENCE_PATTERN, value)) {
    throw new TypeError(
      `${label} must be a stable machine-readable identifier of at most 256 characters, not prose.`,
    );
  }
  return value;
}

function exactAuditRecord(value: unknown, label: string, expectedKeys: readonly string[]): object {
  if (typeof value !== 'object' || value === null || witnessIsArray(value)) {
    throw new TypeError(`${label} requires a structured obligation record.`);
  }
  const keys = witnessOwnKeys(value);
  const length = witnessGetOwnPropertyDescriptor(keys, 'length');
  if (length === undefined || !('value' in length) || length.value !== expectedKeys.length) {
    throw new TypeError(`${label} must contain exactly ${expectedKeys.join(', ')}.`);
  }
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const entry = witnessGetOwnPropertyDescriptor(keys, index);
    if (entry === undefined || !('value' in entry) || typeof entry.value !== 'string') {
      throw new TypeError(`${label} must contain only stable string-named fields.`);
    }
    if (!auditExpectedKey(expectedKeys, entry.value)) {
      throw new TypeError(`${label} contains unsupported field ${entry.value}.`);
    }
  }
  return value;
}

function auditExpectedKey(expectedKeys: readonly string[], candidate: string): boolean {
  for (let index = 0; index < expectedKeys.length; index += 1) {
    if (expectedKeys[index] === candidate) return true;
  }
  return false;
}

function auditOwnValue(record: object, key: string, label: string): unknown {
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
