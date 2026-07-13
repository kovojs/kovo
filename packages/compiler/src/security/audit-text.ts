import { compilerStringCharCodeAt, compilerStringTrim } from '../compiler-security-intrinsics.js';

/** Maximum author-controlled audit text retained in compiler facts (SPEC §6.6). */
export const COMPILER_AUDIT_TEXT_MAX_LENGTH = 4_096;

/**
 * Whether a compiler-extracted author reason is bounded, non-empty, and printable.
 *
 * Audit reasons are security-relevant facts: control, bidi, and invisible format
 * characters can make the source spelling disagree with `kovo explain`, CI logs,
 * or review tooling. Invalid text never discharges a compiler security gate.
 */
export function isCompilerAuditText(value: string): boolean {
  if (value.length > COMPILER_AUDIT_TEXT_MAX_LENGTH || compilerStringTrim(value).length === 0) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = compilerStringCharCodeAt(value, index);
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
