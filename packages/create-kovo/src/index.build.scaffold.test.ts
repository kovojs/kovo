import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectOutput,
  createStarterApp,
  fetchTextWhenReady,
  installedPackageJson,
  reservePort,
  resolveStarterBin,
  runStarterTypecheck,
  runStarterVpCheck,
  stopProcess,
  withStarterBinOnPath,
} from './index.test-support.js';
import { buildProductionArtifact } from './index.build.test-support.js';

describe('create-kovo starter (build integration: scaffold)', () => {
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

  it('runs the generated production build graph gate', () => {
    const app = createStarterApp({
      name: 'Build Prod Proof',
      tempPrefix: 'create-kovo-build-prod-',
    });

    try {
      buildProductionArtifact(app.root);
    } finally {
      app.cleanup();
    }
  }, 120_000);

  it('rebuilds production artifacts from current source when cache is warm', () => {
    const app = createStarterApp({
      name: 'Build Source Proof',
      tempPrefix: 'create-kovo-build-source-proof-',
    });

    try {
      buildProductionArtifact(app.root);
      const firstHandler = readFileSync(join(app.root, 'dist/server/server/handler.mjs'), 'utf8');
      expect(firstHandler).toContain('Contacts');

      const contactsPath = join(app.root, 'src/components/contacts.tsx');
      writeFileSync(
        contactsPath,
        readFileSync(contactsPath, 'utf8').replace('Contacts</h1>', 'Current Source Contacts</h1>'),
        'utf8',
      );

      buildProductionArtifact(app.root);
      const secondHandler = readFileSync(join(app.root, 'dist/server/server/handler.mjs'), 'utf8');
      expect(secondHandler).toContain('Current Source Contacts');
      expect(secondHandler).not.toBe(firstHandler);
    } finally {
      app.cleanup();
    }
  }, 120_000);

  it.each(['postgres', 'sqlite'] as const)(
    'installs the packed %s starter from published-shape tarballs',
    (dialect) => {
      const app = createStarterApp({
        dialect,
        install: 'packed',
        name: `Packed ${dialect} Shape Proof`,
        scaffold: 'packed-bin',
        tempPrefix: `create-kovo-packed-${dialect}-`,
      });

      try {
        expect(app.install.mode).toBe('packed');
        expect(app.install.tarballDir).toBeTruthy();
        expectPackedKovoPackageShape(app.root);
        runStarterTypecheck(app.root);
      } finally {
        app.cleanup();
      }
    },
    240_000,
  );

  it('runs vp check and the production artifact from a packed starter install', async () => {
    const app = createStarterApp({
      install: 'packed',
      name: 'Packed Build Run Proof',
      scaffold: 'packed-bin',
      tempPrefix: 'create-kovo-packed-build-run-',
    });
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      expectPackedKovoPackageShape(app.root);
      runStarterVpCheck(app.root);
      buildProductionArtifact(app.root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: app.root,
        detached: process.platform !== 'win32',
        env: {
          ...withStarterBinOnPath(app.root),
          HOST: '127.0.0.1',
          NODE_ENV: 'production',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const login = await fetchTextWhenReady(`http://127.0.0.1:${port}/login`, output);

      expect(login).toContain('Sign in');
      expect(login).toContain('--kovo-theme');
    } finally {
      await stopProcess(server);
      app.cleanup();
    }
  }, 240_000);
});

function expectPackedKovoPackageShape(root: string): void {
  expect(installedPackageJson(root, '@kovojs/core')).toMatchObject({
    exports: {
      '.': {
        default: './dist/index.mjs',
        types: './dist/index.d.mts',
      },
    },
  });
  expect(installedPackageJson(root, '@kovojs/server')).toMatchObject({
    exports: {
      './jsx-runtime': {
        default: './dist/jsx-runtime.mjs',
        types: './dist/jsx-runtime.d.mts',
      },
    },
  });
  expect(installedPackageJson(root, '@kovojs/cli')).toMatchObject({
    bin: {
      kovo: './dist/bin.mjs',
    },
    exports: {
      '.': {
        default: './dist/api.mjs',
        types: './dist/api.d.mts',
      },
    },
  });
}

function addSqliteDurableTaskRegistration(root: string): void {
  writeFileSync(
    join(root, 'src/sqlite-durable-task-proof.ts'),
    [
      "import { s, task } from '@kovojs/server';",
      '',
      "export const sqliteDurableTaskProof = task('sqlite-durable-task-proof', {",
      '  input: s.object({}),',
      '  run() {},',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const appSource = readFileSync(appPath, 'utf8')
    .replace(
      "import { contactsQuery } from './queries.js';",
      [
        "import { contactsQuery } from './queries.js';",
        "import { sqliteDurableTaskProof } from './sqlite-durable-task-proof.js';",
      ].join('\n'),
    )
    .replace('routes: [', 'tasks: [sqliteDurableTaskProof],\n  routes: [');
  writeFileSync(appPath, appSource, 'utf8');
}

function execFileFailureOutput(error: unknown): string {
  if (error && typeof error === 'object') {
    const { stderr, stdout } = error as { stderr?: unknown; stdout?: unknown };
    const chunks = [stdout, stderr]
      .map((chunk) =>
        Buffer.isBuffer(chunk) ? chunk.toString('utf8') : typeof chunk === 'string' ? chunk : '',
      )
      .filter(Boolean);
    if (chunks.length > 0) return chunks.join('\n');
  }
  return error instanceof Error ? error.message : String(error);
}
