import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildProductionArtifactWithInfrastructureDeadline } from './index.build.test-support.js';
import {
  addSqliteDurableTaskRegistration,
  execFileFailureOutput,
} from './index.build.scaffold-support.js';
import {
  createStarterApp,
  generatedStarterTestTimeout,
  runStarterCheck,
} from './index.test-support.js';

describe('create-kovo starter (build integration: scaffold SQLite)', () => {
  it(
    'runs kovo check in the generated SQLite app',
    async () => {
      const app = await createStarterApp({
        dialect: 'sqlite',
        install: 'link-local',
        name: 'Sqlite Check Proof',
        tempParent: join(process.cwd(), 'node_modules/.tmp'),
        tempPrefix: 'create-kovo-sqlite-check-',
      });

      try {
        await runStarterCheck(app.root);
      } finally {
        app.cleanup();
      }
    },
    generatedStarterTestTimeout({ cliProcessCount: 1 }),
  );

  it('declares pgsql-ast-parser in the generated SQLite app package', async () => {
    const app = await createStarterApp({
      dialect: 'sqlite',
      install: 'link-local',
      name: 'Sqlite Parser Dependency Proof',
      tempParent: join(process.cwd(), 'node_modules/.tmp'),
      tempPrefix: 'create-kovo-sqlite-parser-dep-',
    });

    try {
      const packageJson = JSON.parse(readFileSync(join(app.root, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      expect(packageJson.dependencies?.['pgsql-ast-parser']).toBe('12.0.2');
    } finally {
      app.cleanup();
    }
  });

  it(
    'fails production build when a SQLite app registers durable tasks',
    async () => {
      const app = await createStarterApp({
        dialect: 'sqlite',
        name: 'Sqlite Durable Task Proof',
        tempPrefix: 'create-kovo-sqlite-durable-task-build-',
      });

      try {
        addSqliteDurableTaskRegistration(app.root);
        let output = '';
        try {
          await buildProductionArtifactWithInfrastructureDeadline(app.root);
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
    },
    generatedStarterTestTimeout({ cliProcessCount: 1 }),
  );
});
