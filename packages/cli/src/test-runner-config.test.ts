import { describe, expect, it } from 'vitest';

import { withKovoTestRuntime } from './test-runner-config.js';

describe('Kovo test runner config', () => {
  it('keeps Kovo packages in the mocked Vitest realm while preserving app test config', () => {
    const authoredInline = /authored-dependency/u;
    const config = withKovoTestRuntime({
      test: {
        server: {
          deps: {
            external: ['undici'],
            fallbackCJS: true,
            inline: [authoredInline],
          },
        },
        setupFiles: ['./authored-test-setup.ts'],
      },
    });

    const inline = config.test?.server?.deps?.inline;
    expect(inline).not.toBe(true);
    expect(inline).toEqual([/@kovojs(?:[/\\+])/u, authoredInline]);
    expect(inline?.[0]).toBeInstanceOf(RegExp);
    expect((inline?.[0] as RegExp).test('@kovojs/better-auth')).toBe(true);
    expect(
      (inline?.[0] as RegExp).test('/node_modules/.pnpm/@kovojs+better-auth@0.2.0/node_modules'),
    ).toBe(true);
    expect(config.test?.server?.deps).toMatchObject({
      external: ['undici'],
      fallbackCJS: true,
    });
    expect(config.test?.setupFiles).toEqual([
      expect.stringMatching(/packages[/\\]cli[/\\]src[/\\]test-runtime-bootstrap\.ts$/u),
      './authored-test-setup.ts',
    ]);
  });

  it('preserves an authored inline-all posture', () => {
    const config = withKovoTestRuntime({
      test: {
        server: {
          deps: {
            inline: true,
          },
        },
      },
    });

    expect(config.test?.server?.deps?.inline).toBe(true);
  });
});
