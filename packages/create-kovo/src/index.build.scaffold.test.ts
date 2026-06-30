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
