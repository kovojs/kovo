import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { assertCapabilityIntrinsics } from './capability-intrinsics.js';

const moduleUrl = new URL('./capability-intrinsics.ts', import.meta.url).href;

describe('capability intrinsic membrane', () => {
  it('is available under ordinary server initialization', () => {
    expect(() => assertCapabilityIntrinsics()).not.toThrow();
  });

  it('fails closed when canonical UTF-8 encoding was poisoned before framework import', () => {
    const script = `
      TextEncoder.prototype.encode = () => new Uint8Array();
      const intrinsics = await import(${JSON.stringify(`${moduleUrl}?poisoned-capability-probe`)});
      try {
        intrinsics.assertCapabilityIntrinsics();
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
