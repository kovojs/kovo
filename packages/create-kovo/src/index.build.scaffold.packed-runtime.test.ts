import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

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
