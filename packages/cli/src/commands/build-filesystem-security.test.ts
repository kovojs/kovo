import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runBuildCommand, runExportCommandStructured } from './build-export.js';

describe('build filesystem authority', () => {
  it('rejects build path accessors without invoking them', async () => {
    let reads = 0;
    const result = await runBuildCommand({
      cache: false,
      check: true,
      get appModulePath() {
        reads += 1;
        return './app.mjs';
      },
      outDir: './dist',
    });

    expect(result.exitCode).toBe(1);
    expect(reads).toBe(0);
  });

  it('rejects export path accessors without invoking them', async () => {
    let reads = 0;
    const result = await runExportCommandStructured({
      get appModulePath() {
        reads += 1;
        return './app.mjs';
      },
      outDir: './dist',
    });

    expect(result.exitCode).toBe(1);
    expect(reads).toBe(0);
  });

  it('does not dispatch export snapshots through inherited option setters', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'vite');
    let poisonHits = 0;
    try {
      Object.defineProperty(Object.prototype, 'vite', {
        configurable: true,
        set() {
          poisonHits += 1;
        },
      });
      const result = await runExportCommandStructured({
        appModulePath: './missing-app.mjs',
        outDir: './dist',
        vite: false,
      });
      expect(result.exitCode).toBe(1);
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, 'vite');
      else Object.defineProperty(Object.prototype, 'vite', descriptor);
    }
    expect(poisonHits).toBe(0);
  });

  it('does not write TypeScript build info through a project .kovo symlink', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-tsc-cache-link-'));
    const outside = mkdtempSync(join(tmpdir(), 'kovo-tsc-cache-link-outside-'));
    try {
      writeFileSync(join(root, 'app.mjs'), 'export default {};\n', 'utf8');
      writeFileSync(join(root, 'checked.ts'), 'export const checked: number = 1;\n', 'utf8');
      writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true }, files: ['checked.ts'] }),
        'utf8',
      );
      mkdirSync(join(outside, 'cache'), { recursive: true });
      symlinkSync(outside, join(root, '.kovo'), 'dir');

      const result = await runBuildCommand(
        {
          appModulePath: './app.mjs',
          cache: false,
          check: true,
          outDir: './dist',
        },
        {
          invocationCwd: root,
          invocationEnv: { ...process.env },
          paranoidStaticAdvisory: false,
        },
      );

      expect(result.exitCode).toBe(1);
      expect(existsSync(join(outside, 'cache/tsc-preflight.tsbuildinfo'))).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  }, 30_000);
});
