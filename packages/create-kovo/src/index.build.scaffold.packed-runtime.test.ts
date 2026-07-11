import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildReusableProductionArtifact } from './index.build.test-support.js';
import { expectPackedKovoPackageShape } from './index.build.scaffold-support.js';
import {
  collectOutput,
  createStarterApp,
  fetchTextWhenReady,
  reservePort,
  runStarterVpCheck,
  stopProcess,
  withStarterBinOnPath,
} from './index.test-support.js';

describe('create-kovo starter (build integration: packed runtime scaffold)', () => {
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
      buildReusableProductionArtifact(app.root);
      expect(readFileSync(join(app.root, 'dist/server/server/handler.mjs'), 'utf8')).not.toMatch(
        /from\s+['"]\.\/assets\//,
      );

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: app.root,
        detached: process.platform !== 'win32',
        env: {
          ...withStarterBinOnPath(app.root),
          HOST: '127.0.0.1',
          NODE_ENV: 'test',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;
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
