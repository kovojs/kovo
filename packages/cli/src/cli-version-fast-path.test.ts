import { describe, expect, it, vi } from 'vitest';

import { fastCliVersionOutput } from './cli-version-fast-path.mjs';

describe('CLI version fast path', () => {
  it.each(['--version', '-V', 'version'])(
    'emits the authenticated adjacent version for %s',
    (arg) => {
      const readFile = vi.fn(() =>
        JSON.stringify({ name: '@kovojs/cli', version: '1.2.3-next.4' }),
      );

      expect(
        fastCliVersionOutput([arg], new URL('file:///repo/packages/cli/dist/bin.mjs'), readFile),
      ).toBe('kovo 1.2.3-next.4\n');
      expect(readFile).toHaveBeenCalledWith(
        new URL('file:///repo/packages/cli/package.json'),
        'utf8',
      );
    },
  );

  it('leaves every non-exact meta invocation to the schema-owned dispatcher', () => {
    const readFile = vi.fn();
    for (const args of [[], ['--help'], ['build', '--version'], ['--version', 'extra']]) {
      expect(
        fastCliVersionOutput(args, new URL('file:///repo/packages/cli/src/bin.ts'), readFile),
      ).toBeNull();
    }
    expect(readFile).not.toHaveBeenCalled();
  });

  it('fails closed on a displaced package or invalid semantic version', () => {
    expect(() =>
      fastCliVersionOutput(['--version'], import.meta.url, () =>
        JSON.stringify({ name: '@attacker/cli', version: '1.2.3' }),
      ),
    ).toThrow('@kovojs/cli package.json has an invalid package identity');
    expect(() =>
      fastCliVersionOutput(['--version'], import.meta.url, () =>
        JSON.stringify({ name: '@kovojs/cli', version: 'latest' }),
      ),
    ).toThrow('@kovojs/cli package.json has an invalid package identity');
  });
});
