import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  compilerRegExpTest,
  compilerSha256Hex,
  compilerStringReplaceAll,
  compilerStringSplit,
} from './compiler-security-intrinsics.js';

describe('compiler supported-runner security bootstrap', () => {
  it('keeps exact identities after a selective lookalike Hash.update replacement', () => {
    // Importing compiler-security-intrinsics above is the supported runner bootstrap. App/plugin
    // evaluation happens after that point; source-comment likeness is deliberately irrelevant.
    const safe = 'export const safe = true;';
    const target = 'export const adminToken = leak;';
    const safeDigest = compilerSha256Hex(safe);
    const targetDigest = compilerSha256Hex(target);
    expect(targetDigest).not.toBe(safeDigest);

    const probe = createHash('sha256');
    const prototype = Object.getPrototypeOf(probe) as { update: Function };
    const nativeUpdate = prototype.update;
    const nativeApply = Reflect.apply;
    prototype.update = function update(data: unknown, encoding?: unknown) {
      // Deliberately mimics the old source-text allowlist: this[kHandle].update
      return nativeApply(nativeUpdate, this, [data === target ? safe : data, encoding]);
    };
    try {
      expect(compilerSha256Hex(safe)).toBe(safeDigest);
      expect(compilerSha256Hex(target)).toBe(targetDigest);
      expect(compilerSha256Hex(target)).not.toBe(compilerSha256Hex(safe));
    } finally {
      prototype.update = nativeUpdate;
    }
  });

  it('does not dispatch security classification through late RegExp.prototype.exec', () => {
    const nativeExec = RegExp.prototype.exec;
    RegExp.prototype.exec = function poisonedClassifierExec(value: string): RegExpExecArray | null {
      if (value === 'unsafe') {
        return Object.assign(['safe'], { index: 0, input: value }) as RegExpExecArray;
      }
      return null;
    };
    try {
      expect(compilerRegExpTest(/^safe$/u, 'safe')).toBe(true);
      expect(compilerRegExpTest(/^safe$/u, 'unsafe')).toBe(false);
    } finally {
      RegExp.prototype.exec = nativeExec;
    }
  });

  it('does not dispatch literal replace/split through late symbol hooks', () => {
    const replaceDescriptor = Object.getOwnPropertyDescriptor(String.prototype, Symbol.replace);
    const splitDescriptor = Object.getOwnPropertyDescriptor(String.prototype, Symbol.split);
    Object.defineProperty(String.prototype, Symbol.replace, {
      configurable: true,
      value: () => 'attacker-replacement',
    });
    Object.defineProperty(String.prototype, Symbol.split, {
      configurable: true,
      value: () => [],
    });
    try {
      expect(compilerStringReplaceAll('safe-old-old', 'old', 'new')).toBe('safe-new-new');
      expect(compilerStringSplit('safe,reviewed', ',')).toEqual(['safe', 'reviewed']);
    } finally {
      if (replaceDescriptor === undefined) Reflect.deleteProperty(String.prototype, Symbol.replace);
      else Object.defineProperty(String.prototype, Symbol.replace, replaceDescriptor);
      if (splitDescriptor === undefined) Reflect.deleteProperty(String.prototype, Symbol.split);
      else Object.defineProperty(String.prototype, Symbol.split, splitDescriptor);
    }
  });
});
