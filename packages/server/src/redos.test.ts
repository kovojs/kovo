import { describe, expect, it } from 'vitest';

import {
  assertLinearSafePattern,
  BLESSED_FORMATS,
  drainUnsafeRegexFacts,
  RedosPatternError,
  unsafeRegex,
} from './redos.js';
import { REDOS_ACCEPT_CORPUS, REDOS_REJECT_CORPUS } from './redos-regression-corpus.js';

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
  // @kovo-security-classifier-corpus redos
  it('keeps every pinned unsafe regression rejected by the runtime classifier', () => {
    for (const entry of REDOS_REJECT_CORPUS) {
      expect(() => assertLinearSafePattern(entry.source), entry.name).toThrow(RedosPatternError);
    }
  });

  it('keeps every pinned safe regression accepted by the runtime classifier', () => {
    for (const entry of REDOS_ACCEPT_CORPUS) {
      expect(() => assertLinearSafePattern(entry.source), entry.name).not.toThrow();
    }
  });

  it('rejects nested-quantifier catastrophic structure', () => {
    expect(() => assertLinearSafePattern('(a+)+')).toThrow(RedosPatternError);
    expect(() => assertLinearSafePattern('(a*)*')).toThrow(/KV434/u);
    expect(() => assertLinearSafePattern('(a|b+)+')).toThrow(RedosPatternError);
    expect(() => assertLinearSafePattern('([a-z]+)*$')).toThrow(RedosPatternError);
  });

  // Regression: H7 — matchGroupClose must track classDepth so a literal ')' inside [...] does
  // not fool the group-close search into mis-locating the group boundary (SPEC §6.6 / KV434).
  // Before the fix, `([\w)]+)+` was accepted because the ')' inside [...] decremented depth
  // early, hiding the outer quantifier nesting.
  it('rejects nested-quantifier groups with ) inside character class (H7 regression)', () => {
    expect(() => assertLinearSafePattern('([)]+)+')).toThrow(RedosPatternError);
    expect(() => assertLinearSafePattern('([\\w)]+)+')).toThrow(RedosPatternError);
    expect(() => assertLinearSafePattern('^([\\w)]+)+$')).toThrow(RedosPatternError);
  });

  it('rejects quantified overlapping alternatives, including the documented pathological case', () => {
    expect(() => assertLinearSafePattern('^(a|a)*$')).toThrow(RedosPatternError);
    expect(() => assertLinearSafePattern('^(a|aa)+$')).toThrow(/overlapping alternatives/u);
    expect(() => assertLinearSafePattern('^([a-z]|a)+$')).toThrow(RedosPatternError);
  });

  it('rejects quantified groups whose nested group interiors contain overlapping alternatives', () => {
    for (const source of ['((a|a))+', '(([ab]|[bc]))+', '(((a|a)))+', '((a|a)){1,}']) {
      expect(() => assertLinearSafePattern(source), source).toThrow(RedosPatternError);
    }

    for (const source of ['((ab))+', '(a|b)+', '(?:ab)+']) {
      expect(() => assertLinearSafePattern(source), source).not.toThrow();
    }
  });

  it('rejects overlapping adjacent quantifiers', () => {
    expect(() => assertLinearSafePattern('\\d+\\d+')).toThrow(RedosPatternError);
    expect(() => assertLinearSafePattern('a*a*')).toThrow(RedosPatternError);
    expect(() => assertLinearSafePattern('[a-z]+[a-z]*')).toThrow(RedosPatternError);
  });

  it('accepts a linear-safe literal', () => {
    expect(() => assertLinearSafePattern('^[a-z0-9]+$')).not.toThrow();
    expect(() => assertLinearSafePattern('\\d{4}-\\d{2}-\\d{2}')).not.toThrow();
    expect(() => assertLinearSafePattern('^(cat|dog|bird)$')).not.toThrow();
    expect(() => assertLinearSafePattern('hello')).not.toThrow();
  });

  // Regression: round-17 F1 (SPEC §6.6 / KV434). The nested-quantifier gate must treat `?` as a
  // quantifier: a quantified group whose body is quantified only with `?` (`(a?b?)+`, `(a?){50}b`,
  // `(a?)+`) catastrophically backtracks. Before the fix `containsQuantifier` recognized only
  // `+ * {` and OMITTED `?` (even though `quantifierAt` already knew `?`), so these compiled into a
  // live RegExp — `(a?b?)+$` ran ~7s on a 53-char input, far under the 4096-char match budget that
  // is explicitly NOT a CPU bound.
  it('rejects optional-quantifier (?) nesting inside a quantified group', () => {
    expect(() => assertLinearSafePattern('(a?b?)+$')).toThrow(RedosPatternError);
    expect(() => assertLinearSafePattern('(a?b?)+$')).toThrow(/KV434/u);
    expect(() => assertLinearSafePattern('(a?){50}b')).toThrow(RedosPatternError);
    expect(() => assertLinearSafePattern('(a?)+')).toThrow(RedosPatternError);
  });

  // Do NOT over-block: `?` is only a nesting risk when the group itself is quantified. A benign
  // group with no outer quantifier, and a flat run of optional atoms, stay linear-safe. Because the
  // quantifier probe walks atoms first, a non-capturing/lookaround group-prefix `?` (`(?:…)`,
  // `(?=…)`) is consumed inside the group and never mistaken for a quantifier.
  it('accepts benign optional quantifiers with no outer-quantified group', () => {
    expect(() => assertLinearSafePattern('(a?b?)')).not.toThrow();
    expect(() => assertLinearSafePattern('a?b?c?')).not.toThrow();
    expect(() => assertLinearSafePattern('^(a?b?)$')).not.toThrow();
    expect(() => assertLinearSafePattern('((?:ab))+')).not.toThrow();
    expect(() => assertLinearSafePattern('(?:ab)+')).not.toThrow();
  });

  // The backtracking-quantifier set is single-sourced: `quantifierAt` recognizes exactly `+ * ? {`,
  // and `containsQuantifier` (which routes through it) must agree for every member. If any member
  // silently dropped out of the shared set — as `?` once did — a group body quantified by that
  // token would slip past the nested-quantifier gate. A non-quantifier body char must NOT trip it.
  it('keeps the nested-quantifier set single-sourced across the full quantifier alphabet', () => {
    for (const quantifier of ['+', '*', '?', '{2}', '{2,}', '{2,4}']) {
      expect(() => assertLinearSafePattern(`(a${quantifier})+`)).toThrow(RedosPatternError);
    }
    // A group body with no quantifier is not nested-quantifier structure (control).
    expect(() => assertLinearSafePattern('(ab)+')).not.toThrow();
  });

  it('rejects quantified groups whose nested group interiors contain quantifiers', () => {
    for (const source of ['((a+))+', '(a(b+))+', '(([a-z]+))+', '((\\d+))*']) {
      expect(() => assertLinearSafePattern(source), source).toThrow(RedosPatternError);
    }

    for (const source of ['(?:ab)+', 'a?b?c?', '((ab))+']) {
      expect(() => assertLinearSafePattern(source), source).not.toThrow();
    }
  });

  it('keeps generated quantified-group nestings rejected or empirically non-superlinear', () => {
    const atoms = ['a', 'ab', '[a-z]', '\\d'];
    const innerQuantifiers = ['', '+', '*', '?', '{2,4}'];
    const wrappers = [
      (atom: string, quantifier: string) => `(${atom}${quantifier})+`,
      (atom: string, quantifier: string) => `((${atom}${quantifier}))+`,
      (atom: string, quantifier: string) => `(?:${atom}${quantifier})+`,
    ];

    for (const atom of atoms) {
      for (const quantifier of innerQuantifiers) {
        for (const wrap of wrappers) {
          const source = wrap(atom, quantifier);
          let rejected = false;
          try {
            assertLinearSafePattern(source);
          } catch (error) {
            expect(error, source).toBeInstanceOf(RedosPatternError);
            rejected = true;
          }
          if (!rejected) expectNonSuperlinear(source);
        }
      }
    }
  });
});

function expectNonSuperlinear(source: string): void {
  const regex = new RegExp(`^(?:${source})$`, 'u');
  const elapsed = [16, 32, 64].map((units) => {
    const input = 'ab'.repeat(units) + '!';
    const start = performance.now();
    for (let i = 0; i < 25; i += 1) regex.test(input);
    return performance.now() - start;
  });
  const [small, medium, large] = elapsed;
  expect(large, source).toBeLessThan(50);
  expect(large / Math.max(medium, small, 0.01), source).toBeLessThan(20);
}

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
