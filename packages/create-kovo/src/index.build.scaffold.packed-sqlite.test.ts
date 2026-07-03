import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { expectPackedKovoPackageShape } from './index.build.scaffold-support.js';
import {
  createStarterApp,
  installedPackageJson,
  runStarterTypecheck,
} from './index.test-support.js';

describe('create-kovo starter (build integration: packed SQLite scaffold)', () => {
  it('installs the packed sqlite starter from published-shape tarballs', () => {
    const app = createStarterApp({
      dialect: 'sqlite',
      experimentalSqlite: true,
      install: 'packed',
      name: 'Packed sqlite Shape Proof',
      scaffold: 'packed-bin',
      tempPrefix: 'create-kovo-packed-sqlite-',
    });

    try {
      expect(app.install.mode).toBe('packed');
      expect(app.install.tarballDir).toBeTruthy();
      const packageJson = JSON.parse(readFileSync(join(app.root, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      expect(packageJson.dependencies?.['pgsql-ast-parser']).toBe('^12.0.2');
      expectPackedKovoPackageShape(app.root);
      expect(installedPackageJson(app.root, 'pgsql-ast-parser')).toMatchObject({
        name: 'pgsql-ast-parser',
      });
      runStarterTypecheck(app.root);
    } finally {
      app.cleanup();
    }
  }, 240_000);
});
