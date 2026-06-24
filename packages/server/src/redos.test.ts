import { describe, expect, it } from 'vitest';

import {
  assertLinearSafePattern,
  BLESSED_FORMATS,
  drainUnsafeRegexFacts,
  RedosPatternError,
  unsafeRegex,
} from './redos.js';

// KV434 (SPEC §6.6/§9.5): blessed backtracking-free matchers + static ReDoS reject + audited escape.
describe('blessed format matchers (KV434)', () => {
  it('validates email correct/incorrect inputs', () => {
    const email = BLESSED_FORMATS.email;
    expect(email.test('user@example.com')).toBe(true);
    expect(email.test('a.b+c@sub.example.co')).toBe(true);
    expect(email.test('no-at-sign')).toBe(false);
    expect(email.test('two@@example.com')).toBe(false);
    expect(email.test('@example.com')).toBe(false);
    expect(email.test('user@nodot')).toBe(false);
    expect(email.test('user@example.123')).toBe(false); // numeric TLD.
  });

  it('validates uuid correct/incorrect inputs', () => {
    const uuid = BLESSED_FORMATS.uuid;
    expect(uuid.test('c8428f29-323d-4533-a60c-a0e6a5dea76a')).toBe(true);
    expect(uuid.test('C8428F29-323D-4533-A60C-A0E6A5DEA76A')).toBe(true);
    expect(uuid.test('not-a-uuid')).toBe(false);
    expect(uuid.test('c8428f29323d4533a60ca0e6a5dea76a')).toBe(false); // no hyphens.
    expect(uuid.test('g8428f29-323d-4533-a60c-a0e6a5dea76a')).toBe(false); // non-hex.
  });

  it('validates slug and url', () => {
    expect(BLESSED_FORMATS.slug.test('my-post-2')).toBe(true);
    expect(BLESSED_FORMATS.slug.test('-leading')).toBe(false);
    expect(BLESSED_FORMATS.slug.test('double--hyphen')).toBe(false);
    expect(BLESSED_FORMATS.slug.test('Upper')).toBe(false);

    expect(BLESSED_FORMATS.url.test('https://example.com/path?q=1')).toBe(true);
    expect(BLESSED_FORMATS.url.test('http://localhost:3000')).toBe(true);
    expect(BLESSED_FORMATS.url.test('ftp://example.com')).toBe(false);
    expect(BLESSED_FORMATS.url.test('https://')).toBe(false);
  });
});

describe('static ReDoS pattern analysis (KV434)', () => {
  it('rejects nested-quantifier catastrophic structure', () => {
    expect(() => assertLinearSafePattern('(a+)+')).toThrow(RedosPatternError);
    expect(() => assertLinearSafePattern('(a*)*')).toThrow(/KV434/u);
    expect(() => assertLinearSafePattern('(a|b+)+')).toThrow(RedosPatternError);
    expect(() => assertLinearSafePattern('([a-z]+)*$')).toThrow(RedosPatternError);
  });

  it('rejects overlapping adjacent quantifiers', () => {
    expect(() => assertLinearSafePattern('\\d+\\d+')).toThrow(RedosPatternError);
    expect(() => assertLinearSafePattern('a*a*')).toThrow(RedosPatternError);
  });

  it('accepts a linear-safe literal', () => {
    expect(() => assertLinearSafePattern('^[a-z0-9]+$')).not.toThrow();
    expect(() => assertLinearSafePattern('\\d{4}-\\d{2}-\\d{2}')).not.toThrow();
    expect(() => assertLinearSafePattern('hello')).not.toThrow();
  });
});

describe('unsafeRegex escape (KV434)', () => {
  it('records a capability fact and requires a justification', () => {
    drainUnsafeRegexFacts();
    const brand = unsafeRegex(/(a+)+$/u, 'legacy validator, input length capped upstream');
    expect(brand).toMatchObject({ unsafe: true });
    expect(brand.regex.source).toBe('(a+)+$');

    const facts = drainUnsafeRegexFacts();
    expect(facts).toEqual([
      { justification: 'legacy validator, input length capped upstream', source: '(a+)+$' },
    ]);
    expect(drainUnsafeRegexFacts()).toEqual([]);

    expect(() => unsafeRegex(/x/u, '')).toThrow(/justification/u);
  });
});
