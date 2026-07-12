import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  loggingNeutralizeControlCharacters,
  loggingReplaceAllLiteral,
} from './logging-intrinsics.js';

const moduleUrl = new URL('./logging-intrinsics.ts', import.meta.url).href;

describe('logging intrinsic membrane', () => {
  it('keeps redaction and control neutralization pinned after late poisoning', () => {
    const originalCharCodeAt = String.prototype.charCodeAt;
    const originalIndexOf = String.prototype.indexOf;
    const originalSlice = String.prototype.slice;
    try {
      String.prototype.charCodeAt = () => 65;
      String.prototype.indexOf = () => -1;
      String.prototype.slice = () => 'forged';

      expect(loggingReplaceAllLiteral('token=SECRET&again=SECRET', 'SECRET', '[secret]')).toBe(
        'token=[secret]&again=[secret]',
      );
      expect(loggingNeutralizeControlCharacters('safe\r\nforged')).toBe('safe\\u000d\\u000aforged');
    } finally {
      String.prototype.charCodeAt = originalCharCodeAt;
      String.prototype.indexOf = originalIndexOf;
      String.prototype.slice = originalSlice;
    }
  });

  it('fails closed when a redaction control was poisoned before framework import', () => {
    const script = `
      String.prototype.indexOf = () => -1;
      const intrinsics = await import(${JSON.stringify(`${moduleUrl}?poisoned-logging-probe`)});
      try {
        intrinsics.assertLoggingIntrinsics();
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
