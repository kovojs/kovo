import { describe, expect, it } from 'vitest';

import { expectPackedKovoPackageShape } from './index.build.scaffold-support.js';
import { createStarterApp, runStarterTypecheck } from './index.test-support.js';

describe('create-kovo starter (build integration: packed SQLite scaffold)', () => {
  it('installs the packed sqlite starter from published-shape tarballs', () => {
    const app = createStarterApp({
      dialect: 'sqlite',
      install: 'packed',
      name: 'Packed sqlite Shape Proof',
      scaffold: 'packed-bin',
      tempPrefix: 'create-kovo-packed-sqlite-',
    });

    try {
      expect(app.install.mode).toBe('packed');
      expect(app.install.tarballDir).toBeTruthy();
      expectPackedKovoPackageShape(app.root);
      runStarterTypecheck(app.root);
    } finally {
      app.cleanup();
    }
  }, 240_000);
});
