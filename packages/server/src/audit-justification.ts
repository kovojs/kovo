import { securityStringCharCodeAt, securityStringTrim } from './response-security-intrinsics.js';

const MAX_AUDIT_TEXT_LENGTH = 4_096;

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
  if (
    typeof value !== 'string' ||
    value.length > MAX_AUDIT_TEXT_LENGTH ||
    securityStringTrim(value) === ''
  ) {
    throw new TypeError(
      `${label} requires a non-empty ${field}; it must be printable and at most ${MAX_AUDIT_TEXT_LENGTH} characters.`,
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
