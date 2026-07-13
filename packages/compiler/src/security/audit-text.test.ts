import { describe, expect, it } from 'vitest';

import { COMPILER_AUDIT_TEXT_MAX_LENGTH, isCompilerAuditText } from './audit-text.js';

describe('compiler audit text (SPEC §6.6)', () => {
  it('accepts bounded printable author reasons', () => {
    expect(isCompilerAuditText('signed machine request from inventory gateway')).toBe(true);
    expect(isCompilerAuditText('x'.repeat(COMPILER_AUDIT_TEXT_MAX_LENGTH))).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', ' \t '],
    ['C0', 'reviewed\u0000reason'],
    ['DEL', 'reviewed\u007freason'],
    ['C1', 'reviewed\u0085reason'],
    ['Arabic letter mark', 'reviewed\u061creason'],
    ['zero-width', 'reviewed\u200breason'],
    ['line separator', 'reviewed\u2028reason'],
    ['bidi override', 'reviewed\u202ereason'],
    ['word joiner', 'reviewed\u2060reason'],
    ['bidi isolate', 'reviewed\u2066reason'],
    ['BOM', 'reviewed\ufeffreason'],
  ])('rejects %s audit text', (_label, value) => {
    expect(isCompilerAuditText(value)).toBe(false);
  });

  it('rejects unbounded author reasons', () => {
    expect(isCompilerAuditText('x'.repeat(COMPILER_AUDIT_TEXT_MAX_LENGTH + 1))).toBe(false);
  });
});
