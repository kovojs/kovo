import { join } from 'node:path';

import { describe, it, vi } from 'vitest';

import {
  createStarterApp,
  runStarterAppHttpTest,
  runStarterTypecheck,
} from './index.test-support.js';

vi.setConfig({ testTimeout: process.env.CI ? 600_000 : 420_000 });

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

  it('runs the generated public inferred harness against a verified build graph', () => {
    const app = createStarterApp({
      name: 'Vitest Proof',
      retention: 'retained-24h',
      tempPrefix: 'create-kovo-vitest-',
    });

    try {
      runStarterAppHttpTest(app.root);
    } finally {
      app.cleanup();
    }
  });
});
