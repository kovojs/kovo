import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findNearestFile, readJsonRecord } from './tooling.js';

describe('cli tooling helpers', () => {
  it('finds the nearest file without walking above stopDir', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-cli-tooling-'));
    try {
      const workspace = join(root, 'workspace');
      const app = join(workspace, 'app', 'src');
      mkdirSync(app, { recursive: true });
      writeFileSync(join(root, 'package.json'), '{}\n', 'utf8');
      writeFileSync(join(workspace, 'package.json'), '{}\n', 'utf8');

      expect(findNearestFile(app, 'package.json')).toBe(join(workspace, 'package.json'));
      expect(findNearestFile(app, 'package.json', { stopDir: join(workspace, 'app') })).toBe(
        undefined,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('returns structured JSON record read errors', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-cli-json-'));
    try {
      const invalidJson = join(root, 'invalid.json');
      const arrayJson = join(root, 'array.json');
      const objectJson = join(root, 'object.json');
      writeFileSync(invalidJson, '{', 'utf8');
      writeFileSync(arrayJson, '[]\n', 'utf8');
      writeFileSync(objectJson, '{"name":"app"}\n', 'utf8');

      expect(readJsonRecord(join(root, 'missing.json'))).toEqual({
        error: { kind: 'not-found', path: join(root, 'missing.json') },
        ok: false,
      });
      expect(readJsonRecord(invalidJson)).toEqual({
        error: { kind: 'invalid-json', path: invalidJson },
        ok: false,
      });
      expect(readJsonRecord(arrayJson)).toEqual({
        error: { kind: 'invalid-shape', path: arrayJson },
        ok: false,
      });
      expect(readJsonRecord(objectJson)).toEqual({ ok: true, value: { name: 'app' } });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
