import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { mainAsync } from './index.js';

describe('kovo compile', () => {
  it('writes and checks component artifacts without app-authored compiler imports', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-compile-component-'));
    const sourcePath = join(root, 'cart-badge.tsx');
    const outPath = join(root, 'generated/cart-badge.tsx');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(root, { recursive: true });
      writeFileSync(
        sourcePath,
        `
import { component } from '@kovojs/core';

export const CartBadge = component({
  render: () => <span>Cart</span>,
});
`,
        'utf8',
      );

      await expect(
        mainAsync([
          'compile',
          'component',
          sourcePath,
          '--out',
          outPath,
          '--file-name',
          'src/components/cart-badge.tsx',
          '--fixpoint',
          '--render-equivalence',
        ]),
      ).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      expect(readFileSync(outPath, 'utf8')).toContain('export const CartBadge = component({');
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo-compile/v1\n');
      expect(output).toContain(`WRITE component path=${JSON.stringify(outPath)}`);

      stdout.mockClear();
      await expect(
        mainAsync([
          'compile',
          'component',
          sourcePath,
          '--out',
          outPath,
          '--file-name',
          'src/components/cart-badge.tsx',
          '--check',
        ]),
      ).resolves.toBe(0);
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        `CHECK component path=${JSON.stringify(outPath)} status=current`,
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('emits a graph artifact through the CLI facade', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-compile-graph-'));
    const inputPath = join(root, 'graph-input.json');
    const outPath = join(root, 'graph.json');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(
        inputPath,
        JSON.stringify({
          graph: {
            components: [{ component: 'CartBadge', queries: [], target: 'CartBadge' }],
          },
        }),
        'utf8',
      );

      await expect(
        mainAsync(['compile', 'graph', inputPath, '--out', outPath]),
      ).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      expect(JSON.parse(readFileSync(outPath, 'utf8'))).toEqual({
        components: [{ component: 'CartBadge', queries: [], target: 'CartBadge' }],
      });
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        `WRITE graph path=${JSON.stringify(outPath)}`,
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
