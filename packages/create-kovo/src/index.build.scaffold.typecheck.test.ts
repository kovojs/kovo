import { join } from 'node:path';

import { describe, it } from 'vitest';

import {
  createStarterApp,
  generatedStarterTestTimeout,
  runStarterAppHttpTest,
  runStarterTypecheck,
} from './index.test-support.js';

describe('create-kovo starter (build integration: scaffold typecheck)', () => {
  it(
    'typechecks the generated app with starter dependencies',
    async () => {
      const app = await createStarterApp({
        name: 'Tsc Proof',
        tempParent: join(process.cwd(), 'node_modules/.tmp'),
        tempPrefix: 'create-kovo-tsc-',
      });

      try {
        await runStarterTypecheck(app.root);
      } finally {
        app.cleanup();
      }
    },
    generatedStarterTestTimeout({ cliProcessCount: 1 }),
  );

  it(
    'typechecks the generated SQLite app variant',
    async () => {
      const app = await createStarterApp({
        dialect: 'sqlite',
        name: 'Sqlite Tsc Proof',
        tempParent: join(process.cwd(), 'node_modules/.tmp'),
        tempPrefix: 'create-kovo-sqlite-tsc-',
      });

      try {
        await runStarterTypecheck(app.root);
      } finally {
        app.cleanup();
      }
    },
    generatedStarterTestTimeout({ cliProcessCount: 1 }),
  );

  it(
    'runs the generated public inferred harness against a verified build graph',
    async () => {
      const app = await createStarterApp({
        name: 'Vitest Proof',
        retention: 'retained-24h',
        tempPrefix: 'create-kovo-vitest-',
      });

      try {
        await runStarterAppHttpTest(app.root);
      } finally {
        app.cleanup();
      }
    },
    generatedStarterTestTimeout({ cliProcessCount: 2 }),
  );
});
