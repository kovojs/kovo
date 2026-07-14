import { describe, expect, it, vi } from 'vitest';

import {
  formatNpmRegistryError,
  parsePublishedIntegrity,
  readNpmPublishedState,
} from './npm-registry-state.mjs';

const integrity = `sha512-${'A'.repeat(86)}==`;

describe('npm-registry-state', () => {
  it('returns published when npm view succeeds', () => {
    const exec = vi.fn(() => `${JSON.stringify(integrity)}\n`);
    const result = readNpmPublishedState('@kovojs/core', '1.2.3', {
      exec,
    });
    expect(result).toEqual({ state: 'published', integrity });
    expect(exec).toHaveBeenCalledWith(
      'vp',
      [
        'exec',
        'npm',
        'view',
        '@kovojs/core@1.2.3',
        'dist.integrity',
        '--json',
        '--registry',
        'https://registry.npmjs.org/',
      ],
      expect.any(Object),
    );
  });

  it('treats npm E404 as missing', () => {
    const result = readNpmPublishedState('@kovojs/core', '1.2.3', {
      exec: () => {
        const error = new Error('Command failed');
        error.stderr = 'npm ERR! code E404\nnpm ERR! 404 No match found for version 1.2.3';
        throw error;
      },
    });
    expect(result).toEqual({ state: 'missing' });
  });

  it('fails closed on non-E404 registry errors', () => {
    const result = readNpmPublishedState('@kovojs/core', '1.2.3', {
      exec: () => {
        const error = new Error('Command failed');
        error.stderr = 'npm ERR! code E401\nnpm ERR! Unable to authenticate';
        throw error;
      },
    });
    expect(result).toEqual({
      state: 'error',
      detail: 'npm ERR! code E401\nnpm ERR! Unable to authenticate\nCommand failed',
    });
  });

  it('formats sparse child-process failures', () => {
    expect(formatNpmRegistryError({ message: 'socket hang up' })).toBe('socket hang up');
  });

  it('fails closed on missing, weak, or malformed published integrity', () => {
    expect(() => parsePublishedIntegrity('{}', '@kovojs/core', '1.2.3')).toThrow(
      'valid sha512 dist.integrity',
    );
    expect(() => parsePublishedIntegrity('"sha1-deadbeef"', '@kovojs/core', '1.2.3')).toThrow(
      'valid sha512 dist.integrity',
    );
    expect(() => parsePublishedIntegrity('not-json', '@kovojs/core', '1.2.3')).toThrow(
      'invalid JSON',
    );
  });
});
