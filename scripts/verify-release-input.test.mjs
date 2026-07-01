import { describe, expect, it, vi } from 'vitest';

import { validateReleaseInput } from './verify-release-input.mjs';

describe('verify-release-input', () => {
  it('reports already-published packages while allowing missing ones', () => {
    const log = vi.fn();
    validateReleaseInput('1.2.3', {
      env: {},
      log,
      releasePackagesFn: () => [
        { name: '@kovojs/a', version: '1.2.3' },
        { name: '@kovojs/b', version: '1.2.3' },
      ],
      npmPublishedState: (name) =>
        name === '@kovojs/a' ? { state: 'published' } : { state: 'missing' },
    });

    expect(log).toHaveBeenCalledWith(
      'Release 1.2.3 is partially published; these packages will be skipped on publish:\n  @kovojs/a@1.2.3',
    );
    expect(log).toHaveBeenCalledWith('Release input 1.2.3 is valid for 2 public packages.');
  });

  it('fails closed on npm registry errors', () => {
    expect(() =>
      validateReleaseInput('1.2.3', {
        env: {},
        releasePackagesFn: () => [{ name: '@kovojs/a', version: '1.2.3' }],
        npmPublishedState: () => ({ state: 'error', detail: 'npm ERR! code E401' }),
      }),
    ).toThrowError(
      'Failed to verify npm published state for release 1.2.3:\n  @kovojs/a@1.2.3: npm ERR! code E401',
    );
  });
});
