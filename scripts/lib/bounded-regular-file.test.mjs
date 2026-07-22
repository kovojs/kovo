import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readBoundedRegularFile } from './bounded-regular-file.mjs';

describe('bounded regular-file snapshots', () => {
  it('returns owned bytes for an exact regular file', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-bounded-file-'));
    const file = path.join(root, 'subject.bin');
    writeFileSync(file, 'reviewed bytes');
    try {
      const bytes = readBoundedRegularFile(file, 64, 'subject');
      writeFileSync(file, 'changed later');
      expect(bytes.toString('utf8')).toBe('reviewed bytes');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects a sparse limit-plus-one file before allocating from its size', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-bounded-file-'));
    const file = path.join(root, 'oversized.tgz');
    writeFileSync(file, '');
    truncateSync(file, 16 * 1024 * 1024 + 1);
    try {
      expect(() => readBoundedRegularFile(file, 16 * 1024 * 1024, 'tarball')).toThrow(
        'must be a regular non-symlink file no larger than 16777216',
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
