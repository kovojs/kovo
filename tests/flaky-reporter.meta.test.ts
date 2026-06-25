import { afterEach, describe, expect, it, vi } from 'vitest';

import FlakyReporter from './integration/flaky-reporter.ts';

describe('integration flaky reporter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.KOVO_FAIL_ON_FLAKY;
  });

  it('exits non-zero when CI enables the hard flake gate', () => {
    process.env.KOVO_FAIL_ON_FLAKY = '1';
    const reporter = new FlakyReporter();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit(1)');
    }) as never);

    reporter.onTestEnd(
      {
        location: { file: 'tests/integration/specs/flaky.spec.ts' },
        outcome: () => 'flaky',
        titlePath: () => ['fixture', 'eventually passes'],
      } as never,
      { retry: 1 } as never,
    );

    expect(() => reporter.onEnd({} as never)).toThrow('process.exit(1)');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
