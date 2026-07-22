import { describe, expect, it, vi } from 'vitest';

import { checkPublish } from './check-publish.mjs';

describe('publish readiness orchestration', () => {
  it('builds once before packing and inspecting the final exact tarballs', () => {
    const exec = vi.fn();

    checkPublish({ exec });

    expect(exec).toHaveBeenCalledTimes(3);
    expect(exec.mock.calls.slice(0, 2).map((call) => call[1][0])).toEqual([
      expect.stringMatching(/scripts\/build-publish\.mjs$/u),
      expect.stringMatching(/scripts\/pack-public-packages\.mjs$/u),
    ]);
    expect(exec.mock.calls[2][1]).toEqual([
      expect.stringMatching(/scripts\/egress-floor\.mjs$/u),
      '--policy',
      'install',
      '--',
      process.execPath,
      expect.stringMatching(/scripts\/check-packed-cli-consumer\.mjs$/u),
    ]);
  });
});
