import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { compilerSha256Hex } from './compiler-security-intrinsics.js';

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
});
