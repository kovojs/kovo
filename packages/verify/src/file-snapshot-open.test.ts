import type { BigIntStats } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('regular-file snapshot open', () => {
  afterEach(() => {
    vi.doUnmock('node:fs');
    vi.resetModules();
  });

  it('uses nonblocking no-follow open before descriptor identity validation', async () => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const pathStat = {
      dev: 1n,
      ino: 2n,
      isFile: () => true,
      isSymbolicLink: () => false,
      size: 0n,
    } as BigIntStats;
    let observedFlags: number | undefined;

    vi.doMock('node:fs', () => ({
      ...actual,
      lstatSync: () => pathStat,
      openSync: (_path: string, flags: number) => {
        observedFlags = flags;
        throw new Error('stop after observing race-safe open flags');
      },
    }));

    const { readBoundedRegularFileSnapshot } = await import('./file-snapshot.js');
    expect(() => readBoundedRegularFileSnapshot('/race/evidence.json', 16, 'evidence')).toThrow(
      /stop after observing race-safe open flags/u,
    );
    expect(observedFlags).toBeDefined();
    expect(observedFlags! & actual.constants.O_NONBLOCK).toBe(actual.constants.O_NONBLOCK);
    if (actual.constants.O_NOFOLLOW !== undefined) {
      expect(observedFlags! & actual.constants.O_NOFOLLOW).toBe(actual.constants.O_NOFOLLOW);
    }
  });
});
