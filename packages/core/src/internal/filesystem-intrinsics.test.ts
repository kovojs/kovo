import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  createFileSystemMap,
  fileSystemArrayIncludesExact,
  fileSystemArraySome,
  fileSystemJsonParse,
  fileSystemJsonStringify,
  fileSystemMapGet,
  fileSystemMapSet,
  fileSystemStringSplit,
  fileSystemStringStartsWith,
  fileSystemUtf8Decode,
  fileSystemUtf8Encode,
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

  it('keeps storage UTF-8 and sidecar JSON controls pinned after late poisoning', () => {
    const originalEncode = TextEncoder.prototype.encode;
    const originalDecode = TextDecoder.prototype.decode;
    const originalParse = JSON.parse;
    const originalStringify = JSON.stringify;
    try {
      TextEncoder.prototype.encode = () => new Uint8Array();
      TextDecoder.prototype.decode = () => 'forged';
      JSON.parse = () => ({ logicalKey: 'forged' });
      JSON.stringify = () => '{"logicalKey":"forged"}';

      expect([...fileSystemUtf8Encode('Kovo')]).toEqual([75, 111, 118, 111]);
      expect(fileSystemUtf8Decode(new Uint8Array([75, 111, 118, 111]))).toBe('Kovo');
      expect(fileSystemJsonParse('{"logicalKey":"safe"}')).toEqual({ logicalKey: 'safe' });
      expect(fileSystemJsonStringify({ logicalKey: 'safe' })).toBe(
        '{"logicalKey":"safe"}',
      );
    } finally {
      TextEncoder.prototype.encode = originalEncode;
      TextDecoder.prototype.decode = originalDecode;
      JSON.parse = originalParse;
      JSON.stringify = originalStringify;
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

  it('fails closed when storage codec controls were poisoned before framework import', () => {
    const script = `
      TextEncoder.prototype.encode = () => new Uint8Array();
      const intrinsics = await import(${JSON.stringify(`${moduleUrl}?poisoned-storage-codec-probe`)});
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
