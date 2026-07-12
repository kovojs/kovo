import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  createFileSystemMap,
  fileSystemArrayIncludesExact,
  fileSystemArraySome,
  fileSystemMapGet,
  fileSystemMapSet,
  fileSystemStringSplit,
  fileSystemStringStartsWith,
} from './filesystem-intrinsics.js';

const moduleUrl = new URL('./filesystem-intrinsics.ts', import.meta.url).href;

describe('filesystem intrinsic membrane', () => {
  it('keeps containment and object-identity decisions pinned after late poisoning', () => {
    const originalSome = Array.prototype.some;
    const originalIncludes = Array.prototype.includes;
    const originalMapGet = Map.prototype.get;
    const originalStartsWith = String.prototype.startsWith;
    const originalSplit = String.prototype.split;
    try {
      Array.prototype.some = () => false;
      Array.prototype.includes = () => false;
      Map.prototype.get = () => 'forged';
      String.prototype.startsWith = () => false;
      String.prototype.split = () => ['forged'];

      expect(fileSystemArraySome(['..', 'escape.txt'], (part) => part === '..')).toBe(true);
      expect(fileSystemArrayIncludesExact(['safe', '..'], '..')).toBe(true);
      expect(fileSystemStringStartsWith('../escape.txt', '../')).toBe(true);
      expect(fileSystemStringSplit('safe/file.txt', '/')).toEqual(['safe', 'file.txt']);

      const values = createFileSystemMap<string, string>();
      fileSystemMapSet(values, 'safe', 'value');
      expect(fileSystemMapGet(values, 'safe')).toBe('value');
      expect(fileSystemMapGet(values, 'other')).toBeUndefined();
    } finally {
      Array.prototype.some = originalSome;
      Array.prototype.includes = originalIncludes;
      Map.prototype.get = originalMapGet;
      String.prototype.startsWith = originalStartsWith;
      String.prototype.split = originalSplit;
    }
  });

  it('fails closed when containment controls were poisoned before framework import', () => {
    const script = `
      Array.prototype.some = () => false;
      const intrinsics = await import(${JSON.stringify(`${moduleUrl}?poisoned-filesystem-probe`)});
      try {
        intrinsics.assertFileSystemIntrinsics();
      } catch (error) {
        if (String(error).includes('intrinsics were modified')) process.exit(0);
      }
      process.exit(3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
