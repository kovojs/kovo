import { describe, expect, it, vi } from 'vitest';

import { checkPublish } from './check-publish.mjs';

describe('publish readiness orchestration', () => {
  it('builds once before packing and inspecting the final exact tarballs', () => {
    const exec = vi.fn();

    checkPublish({ exec });

    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls.map((call) => call[1][0])).toEqual([
      expect.stringMatching(/scripts\/build-publish\.mjs$/u),
      expect.stringMatching(/scripts\/pack-public-packages\.mjs$/u),
    ]);
  });
});
