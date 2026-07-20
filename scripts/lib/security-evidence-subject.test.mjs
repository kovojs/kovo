import { describe, expect, it } from 'vitest';

import {
  parseExactCliArguments,
  SECURITY_EVIDENCE_SUBJECT_PROTOCOL,
  validateCodeSubjectSha,
} from './security-evidence-subject.mjs';

describe('security evidence code-subject protocol', () => {
  it('requires a full immutable code SHA and explicitly excludes the self-referential evidence SHA', () => {
    expect(validateCodeSubjectSha('0123456789abcdef0123456789abcdef01234567')).toBe(
      '0123456789abcdef0123456789abcdef01234567',
    );
    expect(SECURITY_EVIDENCE_SUBJECT_PROTOCOL).toEqual({
      schema: 'kovo.security-evidence-subject/v1',
      codeSubject: expect.stringContaining('before this evidence artifact is written'),
      evidenceCommit: expect.stringContaining('self-referential'),
    });
    expect(() => validateCodeSubjectSha('HEAD')).toThrow('full lowercase Git commit SHA');
  });

  it('accepts each writer argument once and rejects missing, duplicate, unknown, or valueless flags', () => {
    const options = {
      command: '--write',
      optionalFlags: ['--historical-subject'],
      valueFlags: ['--subject-sha', '--reason'],
    };
    expect(
      parseExactCliArguments(
        [
          '--write',
          '--subject-sha',
          '0123456789abcdef0123456789abcdef01234567',
          '--reason',
          'reviewed refresh',
          '--historical-subject',
        ],
        options,
      ),
    ).toEqual({
      write: true,
      'subject-sha': '0123456789abcdef0123456789abcdef01234567',
      reason: 'reviewed refresh',
      'historical-subject': true,
    });
    for (const args of [
      ['--write', '--subject-sha', 'a'.repeat(40)],
      ['--write', '--write', '--subject-sha', 'a'.repeat(40), '--reason', 'x'],
      ['--write', '--subject-sha', '--reason', 'x'],
      ['--write', '--subject-sha', 'a'.repeat(40), '--reason', 'x', '--unknown'],
    ]) {
      expect(() => parseExactCliArguments(args, options)).toThrow();
    }
  });
});
