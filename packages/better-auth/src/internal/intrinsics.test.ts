import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  betterAuthIndexOf,
  betterAuthRegExpExec,
  betterAuthSplit,
  betterAuthTrim,
} from './intrinsics.js';

const moduleUrl = new URL('./intrinsics.ts', import.meta.url).href;

describe('Better Auth intrinsic membrane', () => {
  it('keeps scalar and RegExp decisions pinned after late poisoning', () => {
    const originalIndexOf = String.prototype.indexOf;
    const originalSplit = String.prototype.split;
    const originalTrim = String.prototype.trim;
    const originalExec = RegExp.prototype.exec;
    try {
      String.prototype.indexOf = () => -1;
      String.prototype.split = () => [];
      String.prototype.trim = () => '';
      RegExp.prototype.exec = () => null;

      expect(betterAuthIndexOf('sid=value', '=')).toBe(3);
      expect(betterAuthSplit('sid=value; Path=/', ';')).toEqual(['sid=value', ' Path=/']);
      expect(betterAuthTrim(' safe ')).toBe('safe');
      expect(betterAuthRegExpExec(/^safe$/u, 'safe')?.[0]).toBe('safe');
    } finally {
      String.prototype.indexOf = originalIndexOf;
      String.prototype.split = originalSplit;
      String.prototype.trim = originalTrim;
      RegExp.prototype.exec = originalExec;
    }
  });

  it('fails closed when a classifier control was poisoned before framework import', () => {
    const script = `
      RegExp.prototype.exec = () => null;
      const intrinsics = await import(${JSON.stringify(`${moduleUrl}?poisoned-better-auth-probe`)});
      try {
        intrinsics.assertBetterAuthIntrinsics();
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
