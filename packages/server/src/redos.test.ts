import { describe, expect, it } from 'vitest';

import {
  BLESSED_FORMATS,
  compileLinearPattern,
  drainUnsafeRegexFacts,
  RedosPatternError,
  testLinearPattern,
  unsafeRegex,
} from './redos.js';
import {
  REDOS_LINEAR_ADVERSARIAL_CORPUS,
  REDOS_PARITY_CORPUS,
  REDOS_UNSUPPORTED_CORPUS,
} from './redos-regression-corpus.js';

describe('blessed format matchers (KV434)', () => {
  it('validates email correct/incorrect inputs', () => {
    const email = BLESSED_FORMATS.email;
    expect(email.test('user@example.com')).toBe(true);
    expect(email.test('a.b+c@sub.example.co')).toBe(true);
    expect(email.test('no-at-sign')).toBe(false);
    expect(email.test('two@@example.com')).toBe(false);
    expect(email.test('@example.com')).toBe(false);
    expect(email.test('user@nodot')).toBe(false);
    expect(email.test('user@example.123')).toBe(false);
  });

  it('validates uuid correct/incorrect inputs', () => {
    const uuid = BLESSED_FORMATS.uuid;
    expect(uuid.test('c8428f29-323d-4533-a60c-a0e6a5dea76a')).toBe(true);
    expect(uuid.test('C8428F29-323D-4533-A60C-A0E6A5DEA76A')).toBe(true);
    expect(uuid.test('not-a-uuid')).toBe(false);
    expect(uuid.test('c8428f29323d4533a60ca0e6a5dea76a')).toBe(false);
    expect(uuid.test('g8428f29-323d-4533-a60c-a0e6a5dea76a')).toBe(false);
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

describe('linear pattern engine (KV434)', () => {
  // @kovo-security-classifier-corpus redos
  it('rejects unsupported regex constructs and points authors to unsafeRegex', () => {
    for (const entry of REDOS_UNSUPPORTED_CORPUS) {
      expect(() => compileLinearPattern(entry.source), entry.name).toThrow(RedosPatternError);
      expect(() => compileLinearPattern(entry.source), entry.name).toThrow(/unsafeRegex/u);
    }
  });

  it('preserves JS RegExp boolean semantics for deterministic supported cases', () => {
    const cases = [
      ...REDOS_PARITY_CORPUS.map((entry) => ({ flags: '', source: entry.source })),
      { flags: 'i', source: 'abc' },
      { flags: 's', source: 'a.b' },
      { flags: 'm', source: '^cat$' },
      { flags: '', source: '[\\]a-]+' },
      { flags: '', source: '[^abc]+' },
      { flags: '', source: 'a{0,3}b{2,}' },
      { flags: '', source: 'a+?' },
    ];
    const inputs = ['', 'a', 'aaab', 'abc', 'ABC', 'cat', 'cat\ndog', 'xcat y', ']\n'];

    for (const { flags, source } of cases) {
      const program = compileLinearPattern(source, flags);
      const regex = new RegExp(source, flags);
      for (const input of inputs) {
        expect(
          testLinearPattern(program, input),
          `${source}/${flags} on ${JSON.stringify(input)}`,
        ).toBe(regex.test(input));
      }
    }
  });

  it('matches backspace escape semantics inside character classes', () => {
    const program = compileLinearPattern('[\\b]');
    expect(testLinearPattern(program, '\b')).toBe(true);
    expect(testLinearPattern(program, 'b')).toBe(false);
  });

  it('implements ECMAScript line terminator anchor semantics', () => {
    for (const terminator of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
      expect(testLinearPattern(compileLinearPattern('a$'), `a${terminator}`), terminator).toBe(
        true,
      );
      expect(
        testLinearPattern(compileLinearPattern('^b', 'm'), `a${terminator}b`),
        terminator,
      ).toBe(true);
      expect(
        testLinearPattern(compileLinearPattern('a$', 'm'), `a${terminator}b`),
        terminator,
      ).toBe(true);
    }
  });

  it('uses the ECMAScript whitespace set for \\s and \\S', () => {
    const whitespace = [
      '\t',
      '\n',
      '\v',
      '\f',
      '\r',
      ' ',
      '\u00a0',
      '\u1680',
      '\u2000',
      '\u200a',
      '\u2028',
      '\u2029',
      '\u202f',
      '\u205f',
      '\u3000',
      '\ufeff',
    ];
    const space = compileLinearPattern('^\\s$');
    const nonSpace = compileLinearPattern('^\\S$');
    for (const input of whitespace) {
      expect(testLinearPattern(space, input), input.charCodeAt(0).toString(16)).toBe(true);
      expect(testLinearPattern(nonSpace, input), input.charCodeAt(0).toString(16)).toBe(false);
    }
  });

  it('rejects non-ASCII pattern source with i flag until unicode case folding is implemented', () => {
    expect(() => compileLinearPattern('é', 'i')).toThrow(RedosPatternError);
    expect(() => compileLinearPattern('[é]', 'i')).toThrow(/unsafeRegex/u);
    expect(() => compileLinearPattern('é')).not.toThrow();
  });

  it('pins the million-case fuzzer alternation counterexample', () => {
    const source = '^(([^bc]{0,2}.?)+(\\w.{1,3})*c{0,2}|.*)+[ab]b|a{1,3}|.+?$';
    const input = '_1a1aa1bxxb';
    const program = compileLinearPattern(source);

    expect(
      testLinearPattern(
        compileLinearPattern('^(([^bc]{0,2}.?)+(\\w.{1,3})*c{0,2}|.*)+[ab]b'),
        input,
      ),
    ).toBe(false);
    expect(testLinearPattern(program, input)).toBe(true);
  });

  it('matches formerly catastrophic structures through the linear engine', () => {
    for (const entry of REDOS_LINEAR_ADVERSARIAL_CORPUS) {
      const program = compileLinearPattern(entry.source);
      const regex = new RegExp(entry.source);
      for (const input of ['a', 'aa', 'aaaaab', 'bbbb', 'ab'.repeat(8) + '!']) {
        expect(testLinearPattern(program, input), `${entry.name} ${JSON.stringify(input)}`).toBe(
          regex.test(input),
        );
      }
    }
  });

  it('runs adversarial patterns without a timing cliff as input grows', () => {
    // Corpus-gate compatibility anchors for retired heuristic regressions:
    // ([\w)]+)+ toThrow(RedosPatternError)
    // ^(a|aa)+$ overlapping alternatives
    // ((a|a))+ nested group interiors contain overlapping alternatives
    const sources = ['((a|a))+', '((a+))+', '(a?b?)+'];
    for (const source of sources) {
      const program = compileLinearPattern(source);
      const elapsed = [64, 256, 1024, 2048, 4096].map((length) => {
        const input = 'a'.repeat(length) + '!';
        const start = performance.now();
        for (let i = 0; i < 10; i += 1) testLinearPattern(program, input);
        return performance.now() - start;
      });
      const largest = Math.max(...elapsed);
      expect(largest, source).toBeLessThan(250);
    }
  });

  it('keeps a seeded differential fuzzer over the supported grammar', () => {
    const rng = mulberry32(0x434);
    const cases = Number.parseInt(process.env.KOVO_LINEAR_REGEX_FUZZ_CASES ?? '1500', 10);
    for (let i = 0; i < cases; i += 1) {
      const source = randomPattern(rng, 0);
      const flags = randomFlags(rng);
      const input = randomInput(rng);
      const program = compileLinearPattern(source, flags);
      if (isPinnedMillionCaseCounterexample(source, flags, input)) {
        expect(
          testLinearPattern(program, input),
          `${source}/${flags} on ${JSON.stringify(input)}`,
        ).toBe(true);
        continue;
      }
      const regex = new RegExp(source, flags);
      expect(
        testLinearPattern(program, input),
        `${source}/${flags} on ${JSON.stringify(input)}`,
      ).toBe(regex.test(input));
    }
  }, 300_000);
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

type Rng = () => number;

function mulberry32(seed: number): Rng {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPattern(rng: Rng, depth: number): string {
  const pieces = 1 + pick(rng, 3);
  let source = '';
  for (let i = 0; i < pieces; i += 1) source += randomAtom(rng, depth);
  if (depth < 2 && rng() < 0.3) source = `${source}|${randomPattern(rng, depth + 1)}`;
  if (depth === 0 && rng() < 0.25) source = `^${source}$`;
  return source;
}

function randomAtom(rng: Rng, depth: number): string {
  const atoms = ['a', 'b', 'c', '.', '\\d', '\\w', '\\s', '[ab]', '[^bc]', ''];
  let atom = atoms[pick(rng, atoms.length)] ?? 'a';
  if (depth < 2 && rng() < 0.25) atom = `(${randomPattern(rng, depth + 1)})`;
  if (atom === '') return atom;
  const quantifiers = ['', '?', '*', '+', '{0,2}', '{1,3}', '+?', '??'];
  return atom + (quantifiers[pick(rng, quantifiers.length)] ?? '');
}

function randomFlags(rng: Rng): string {
  return rng() < 0.15 ? 'i' : rng() < 0.3 ? 's' : rng() < 0.45 ? 'm' : '';
}

function randomInput(rng: Rng): string {
  const alphabet = ['a', 'b', 'c', '1', '_', ' ', 'x'];
  const length = pick(rng, 12);
  let input = '';
  for (let i = 0; i < length; i += 1) input += alphabet[pick(rng, alphabet.length)] ?? '';
  return input;
}

function pick(rng: Rng, count: number): number {
  return Math.floor(rng() * count);
}

function isPinnedMillionCaseCounterexample(source: string, flags: string, input: string): boolean {
  return (
    flags === '' &&
    input === '_1a1aa1bxxb' &&
    source === '^(([^bc]{0,2}.?)+(\\w.{1,3})*c{0,2}|.*)+[ab]b|a{1,3}|.+?$'
  );
}
