import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { discoverGraphInputPath, inputErrorMessage, readGraphInput } from './graph-input.js';

describe('graph input reading', () => {
  it('discovers the nearest built graph artifact from the current directory', () => {
    const previousCwd = process.cwd();
    const root = mkdtemp('kovo-graph-input-');
    const nested = join(root, 'src', 'routes');
    const distKovo = join(nested, 'dist', '.kovo');

    mkdirSync(distKovo, { recursive: true });
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(distKovo, 'graph.json'), '{"queries":[]}');

    try {
      process.chdir(nested);
      expect(realpathSync(discoverGraphInputPath() ?? '')).toBe(
        realpathSync(join(nested, 'dist', '.kovo', 'graph.json')),
      );
      expect(readGraphInput(undefined)).toEqual({ ok: true, value: { queries: [] } });
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('keeps stable validation messages for invalid graph JSON fields', () => {
    const root = mkdtemp('kovo-graph-input-invalid-');
    const graphPath = join(root, 'graph.json');

    try {
      writeFileSync(graphPath, '{"touchGraph":[]}');
      const result = readGraphInput(graphPath);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(inputErrorMessage(result.error)).toBe(
          `kovo: input JSON field touchGraph must be an object: ${graphPath}`,
        );
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

function mkdtemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
