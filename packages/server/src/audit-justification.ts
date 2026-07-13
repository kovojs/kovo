import { securityStringCharCodeAt, securityStringTrim } from './response-security-intrinsics.js';

const MAX_AUDIT_JUSTIFICATION_LENGTH = 4_096;

/** @internal Close a human-audited escape reason before it reaches runtime or explain facts. */
export function snapshotAuditJustification(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length > MAX_AUDIT_JUSTIFICATION_LENGTH ||
    securityStringTrim(value) === ''
  ) {
    throw new TypeError(
      `${label} requires a non-empty printable justification of at most ${MAX_AUDIT_JUSTIFICATION_LENGTH} characters.`,
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (code <= 0x1f || code === 0x7f || code === 0x2028 || code === 0x2029) {
      throw new TypeError(
        `${label} requires a non-empty printable justification without control characters.`,
      );
    }
  }
  return value;
}
