import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isMainEntry } from './cli-entry.mjs';

describe('script CLI entry identity', () => {
  it('stays import-safe when sealed permissions deny ancestor realpath inspection', () => {
    const modulePath = path.resolve('/sealed/scripts/gate.mjs');
    const denyRealpath = () => {
      const error = new Error('denied');
      error.code = 'ERR_ACCESS_DENIED';
      throw error;
    };

    expect(isMainEntry(pathToFileURL(modulePath).href, ['node', modulePath], denyRealpath)).toBe(
      true,
    );
    expect(
      isMainEntry(
        pathToFileURL(modulePath).href,
        ['node', path.resolve('/sealed/scripts/worker.mjs')],
        denyRealpath,
      ),
    ).toBe(false);
  });
});
