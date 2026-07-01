import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildProductionArtifact } from './index.build.test-support.js';
import {
  addSqliteDurableTaskRegistration,
  execFileFailureOutput,
} from './index.build.scaffold-support.js';
import { createStarterApp, runStarterVpCheck } from './index.test-support.js';

describe('create-kovo starter (build integration: scaffold SQLite)', () => {
  it('runs vp check in the generated SQLite app', () => {
    const app = createStarterApp({
      dialect: 'sqlite',
      install: 'link-local',
      name: 'Sqlite Check Proof',
      tempParent: join(process.cwd(), 'node_modules/.tmp'),
      tempPrefix: 'create-kovo-sqlite-check-',
    });

    try {
      runStarterVpCheck(app.root);
    } finally {
      app.cleanup();
    }
  }, 90_000);

  it('fails production build when a SQLite app registers durable tasks', () => {
    const app = createStarterApp({
      dialect: 'sqlite',
      name: 'Sqlite Durable Task Proof',
      tempPrefix: 'create-kovo-sqlite-durable-task-build-',
    });

    try {
      addSqliteDurableTaskRegistration(app.root);
      let output = '';
      try {
        buildProductionArtifact(app.root);
      } catch (error) {
        output = execFileFailureOutput(error);
      }

      expect(output).toContain('ERROR KV446');
      expect(output).toContain('Postgres _kovo_jobs store');
      expect(output).toContain('SQLite/better-sqlite3');
      expect(output).toContain('SPEC §9.6');
    } finally {
      app.cleanup();
    }
  }, 120_000);
});
