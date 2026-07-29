import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildReusableProductionArtifact } from './index.build.test-support.js';
import { expectPackedKovoPackageShape } from './index.build.scaffold-support.js';
import {
  collectOutput,
  createStarterApp,
  fetchTextWhenReady,
  reservePort,
  stopProcess,
  withStarterBinOnPath,
} from './index.test-support.js';

describe('create-kovo starter (build integration: packed runtime scaffold)', () => {
  it('runs the source quick check and production artifact from a packed starter install', async () => {
    const app = createStarterApp({
      install: 'packed',
      name: 'Packed Build Run Proof',
      scaffold: 'packed-bin',
      tempPrefix: 'create-kovo-packed-build-run-',
    });
    const port = await reservePort();
    const origin = `http://127.0.0.1:${port}`;
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      expectPackedKovoPackageShape(app.root);
      // The generated dev-server HTTP suite has its own starter-typecheck shard. Keep this packed
      // acceptance path focused on the published source-proof and production-artifact commands:
      // repeating the full PGlite/Vite dev bootstrap would consume the real build's bounded budget.
      const sourceCheck = execFileSync('pnpm', ['run', 'check'], {
        cwd: app.root,
        encoding: 'utf8',
        env: withStarterBinOnPath(app.root),
        maxBuffer: 128 * 1024 * 1024,
      });
      expect(sourceCheck).toContain('source-proof');
      expect(sourceCheck).toContain('kovo-check/v1');
      expect(existsSync(join(app.root, 'dist'))).toBe(false);

      buildReusableProductionArtifact(app.root);
      expect(readFileSync(join(app.root, 'dist/server/server/handler.mjs'), 'utf8')).not.toMatch(
        /from\s+['"]\.\/assets\//,
      );

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: app.root,
        detached: process.platform !== 'win32',
        env: {
          ...withStarterBinOnPath(app.root),
          BETTER_AUTH_URL: origin,
          HOST: '127.0.0.1',
          NODE_ENV: 'test',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const login = await fetchTextWhenReady(`${origin}/login`, output);
      const stylesheetHref = /\/assets\/styles\.css/.exec(login)?.[0] ?? '';

      expect(login).toContain('Sign in');
      expect(login).toContain('--kovo-theme');
      expect(stylesheetHref).toBe('/assets/styles.css');

      // The packed CLI must derive the closed aggregate to attach build CSS without crossing a
      // second @kovojs/server module identity. Fetching the emitted asset keeps this regression
      // test on that derivation path instead of merely proving that the server process boots.
      const stylesheet = await fetch(`${origin}${stylesheetHref}`);
      expect(stylesheet.status).toBe(200);
      expect(await stylesheet.text()).toContain('--kovo-theme');
    } finally {
      await stopProcess(server);
      app.cleanup();
    }
  }, 240_000);
});
