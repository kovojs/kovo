import { describe, expect, it } from 'vitest';

import { formatNpmRegistryError, readNpmPublishedState } from './npm-registry-state.mjs';

describe('npm-registry-state', () => {
  it('returns published when npm view succeeds', () => {
    const result = readNpmPublishedState('@kovojs/core', '1.2.3', {
      exec: () => '"1.2.3"\n',
    });
    expect(result).toEqual({ state: 'published' });
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
});
