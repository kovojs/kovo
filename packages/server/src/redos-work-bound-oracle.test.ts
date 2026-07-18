import { describe, expect, it } from 'vitest';

import {
  LINEAR_REGEX_WORK_BOUND_VERSION,
  linearRegexMatchWithWork,
  linearRegexWorkBound,
} from './internal/linear-regex/index.js';
import { PATTERN_MAX_INPUT_LENGTH, compileLinearPattern, testLinearPattern } from './redos.js';
import { REDOS_LINEAR_ADVERSARIAL_CORPUS } from './redos-regression-corpus.js';
import { s } from './schema.js';

// @kovo-security-property-oracle redos-work-bound
const WORK_ORACLE = Object.freeze({
  seed: 0x4b56_3433,
  version: LINEAR_REGEX_WORK_BOUND_VERSION,
});

const MINIMIZED_WORK_CASES = Object.freeze([
  {
    input: `${'a'.repeat(PATTERN_MAX_INPUT_LENGTH - 1)}!`,
    matched: false,
    name: 'overlapping-prefix-alternative-final-mismatch',
    source: '^(a|aa)+$',
  },
  {
    input: `${'a'.repeat(PATTERN_MAX_INPUT_LENGTH - 1)}!`,
    matched: false,
    name: 'nested-quantifier-final-mismatch',
    source: '^((a+))+$',
  },
  {
    input: `${'a'.repeat(PATTERN_MAX_INPUT_LENGTH - 1)}!`,
    matched: false,
    name: 'adjacent-overlapping-quantifier-final-mismatch',
    source: '^[a-z]+[a-z]*$',
  },
] as const);

describe('versioned deterministic ReDoS work-bound oracle (SPEC §6.6/§9.5; KV434)', () => {
  it('pins minimized formerly-catastrophic cases to the production matcher work model', () => {
    expect(WORK_ORACLE).toEqual({
      seed: 0x4b56_3433,
      version: 'kovo.linear-regex-work/v1',
    });

    for (const entry of MINIMIZED_WORK_CASES) {
      const program = compileLinearPattern(entry.source);
      const report = linearRegexMatchWithWork(program, entry.input);

      expect(report.version, entry.name).toBe(WORK_ORACLE.version);
      expect(report.matched, entry.name).toBe(entry.matched);
      expect(report.operations, entry.name).toBeGreaterThan(entry.input.length);
      expect(report.operations, entry.name).toBeLessThanOrEqual(report.bound);
      expect(report.bound, entry.name).toBe(linearRegexWorkBound(program, entry.input.length));
    }
  });

  it('covers every hostile regression family at the full runtime input ceiling with a fixed seed', () => {
    const random = xorshift32(WORK_ORACLE.seed);
    const alphabet = ['a', 'b', '0', '_', '-', ' '] as const;

    for (const entry of REDOS_LINEAR_ADVERSARIAL_CORPUS) {
      let input = '';
      for (let index = 0; index < PATTERN_MAX_INPUT_LENGTH; index += 1) {
        input += alphabet[random() % alphabet.length];
      }
      const program = compileLinearPattern(entry.source);
      const report = linearRegexMatchWithWork(program, input);

      expect(report.version, entry.name).toBe(WORK_ORACLE.version);
      expect(report.operations, entry.name).toBeLessThanOrEqual(report.bound);
      expect(report.bound, entry.name).toBe(linearRegexWorkBound(program, input.length));
    }
  });

  it('keeps the deterministic work slope bounded as hostile input grows', () => {
    const program = compileLinearPattern('^(a|aa)+$');
    const reports = [64, 256, 1_024, PATTERN_MAX_INPUT_LENGTH].map((length) =>
      linearRegexMatchWithWork(program, `${'a'.repeat(length - 1)}!`),
    );

    for (let index = 1; index < reports.length; index += 1) {
      const previous = reports[index - 1]!;
      const current = reports[index]!;
      const inputRatio =
        [64, 256, 1_024, PATTERN_MAX_INPUT_LENGTH][index]! /
        [64, 256, 1_024, PATTERN_MAX_INPUT_LENGTH][index - 1]!;
      expect(current.operations).toBeLessThanOrEqual(
        Math.ceil(previous.operations * inputRatio) + program.instructions.length * 8,
      );
    }
  });

  it('enforces the same 4,096-code-unit ceiling through the real string-schema door', () => {
    const schema = s.string().pattern('^(a|aa)+$');
    const maximum = 'a'.repeat(PATTERN_MAX_INPUT_LENGTH);

    expect(schema.parse(maximum)).toBe(maximum);
    expect(() => schema.parse(`${maximum}a`)).toThrow(
      `input exceeds the ${PATTERN_MAX_INPUT_LENGTH}-char match budget`,
    );

    const shortCounterexample = 'aaaaaaaaaaaa!';
    expect(testLinearPattern(compileLinearPattern('^(a|aa)+$'), shortCounterexample)).toBe(
      /^(a|aa)+$/u.test(shortCounterexample),
    );
  });
});

function xorshift32(seed: number): () => number {
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
}
