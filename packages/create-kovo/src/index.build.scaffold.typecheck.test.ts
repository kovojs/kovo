import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import {
  createStarterApp,
  resolveStarterBin,
  runStarterTypecheck,
  withStarterBinOnPath,
} from './index.test-support.js';

describe('create-kovo starter (build integration: scaffold typecheck)', () => {
  it('typechecks the generated app with starter dependencies', () => {
    const app = createStarterApp({
      name: 'Tsc Proof',
      tempParent: join(process.cwd(), 'node_modules/.tmp'),
      tempPrefix: 'create-kovo-tsc-',
    });

    try {
      runStarterTypecheck(app.root);
    } finally {
      app.cleanup();
    }
  });

  it('typechecks the generated SQLite app variant', () => {
    const app = createStarterApp({
      dialect: 'sqlite',
      name: 'Sqlite Tsc Proof',
      tempParent: join(process.cwd(), 'node_modules/.tmp'),
      tempPrefix: 'create-kovo-sqlite-tsc-',
    });

    try {
      runStarterTypecheck(app.root);
    } finally {
      app.cleanup();
    }
  });

  it('runs the generated in-app tests (data layer + request shell)', () => {
    const app = createStarterApp({
      name: 'Vitest Proof',
      tempParent: join(process.cwd(), 'node_modules/.tmp'),
      tempPrefix: 'create-kovo-vitest-',
    });

    try {
      execFileSync(resolveStarterBin(app.root, 'vitest'), ['--run', 'src/app.test.ts'], {
        cwd: app.root,
        env: withStarterBinOnPath(app.root),
        stdio: 'pipe',
      });
    } finally {
      app.cleanup();
    }
  }, 90_000);
});
