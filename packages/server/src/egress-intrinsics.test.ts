import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { egressArraySome, egressRegExpTest, egressStringStartsWith } from './egress-intrinsics.js';

const moduleUrl = new URL('./egress-intrinsics.ts', import.meta.url).href;

describe('egress intrinsic membrane', () => {
  it('keeps scalar and collection decisions pinned after app-realm prototype poisoning', () => {
    const originalSome = Array.prototype.some;
    const originalStartsWith = String.prototype.startsWith;
    const originalExec = RegExp.prototype.exec;
    const originalReplace = RegExp.prototype[Symbol.replace];
    try {
      Array.prototype.some = () => true;
      String.prototype.startsWith = () => true;
      RegExp.prototype.exec = () => null;
      RegExp.prototype[Symbol.replace] = () => '8.8.8.8';

      expect(egressArraySome([], () => true)).toBe(false);
      expect(egressStringStartsWith('127.0.0.1', '[')).toBe(false);
      expect(egressRegExpTest(/^127\./u, '127.0.0.1')).toBe(true);
      expect(egressRegExpTest(/^8\./u, '127.0.0.1')).toBe(false);
    } finally {
      Array.prototype.some = originalSome;
      String.prototype.startsWith = originalStartsWith;
      RegExp.prototype.exec = originalExec;
      RegExp.prototype[Symbol.replace] = originalReplace;
    }
  });

  it('fails closed when security controls were poisoned before framework import', () => {
    const script = `
      Array.prototype.some = () => true;
      const intrinsics = await import(${JSON.stringify(`${moduleUrl}?poisoned-egress-probe`)});
      try {
        intrinsics.assertEgressIntrinsics();
      } catch (error) {
        if (String(error).includes('intrinsics were modified')) process.exit(0);
      }
      process.exit(3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
