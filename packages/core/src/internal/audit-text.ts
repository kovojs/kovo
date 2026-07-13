import { securityStringCharCodeAt, securityStringTrim } from '#security-witness-intrinsics';

const MAX_AUDIT_TEXT_LENGTH = 4_096;

/** @internal Snapshot human-reviewed text before it reaches an audit, diagnostic, or log sink. */
export function snapshotAuditText(value: unknown, label: string, allowEmpty = false): string {
  if (
    typeof value !== 'string' ||
    value.length > MAX_AUDIT_TEXT_LENGTH ||
    (!allowEmpty && securityStringTrim(value) === '')
  ) {
    throw new TypeError(
      `${label} requires bounded printable text of at most ${MAX_AUDIT_TEXT_LENGTH} characters.`,
    );
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (isAuditTextControl(code)) {
      throw new TypeError(`${label} requires printable text without control characters.`);
    }
  }
  return value;
}

function isAuditTextControl(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x061c ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff
  );
}
