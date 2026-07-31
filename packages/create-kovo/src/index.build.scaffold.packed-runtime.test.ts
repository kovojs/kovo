import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildReusableProductionArtifactWithInfrastructureDeadline } from './index.build.test-support.js';
import { expectPackedKovoPackageShape } from './index.build.scaffold-support.js';
import {
  collectOutput,
  createStarterApp,
  fetchTextWhenReady,
  generatedStarterTestTimeout,
  reservePort,
  runGeneratedStarterCommand,
  stopProcess,
  withStarterBinOnPath,
} from './index.test-support.js';

describe('create-kovo starter (build integration: packed runtime scaffold)', () => {
  it(
    'runs the source quick check from a packed starter install',
    async () => {
      const app = await createStarterApp({
        install: 'packed',
        name: 'Packed Source Check Proof',
        scaffold: 'packed-bin',
        tempPrefix: 'create-kovo-packed-source-check-',
      });

      try {
        expectPackedKovoPackageShape(app.root);
        // The generated dev-server HTTP suite has its own starter-typecheck shard. Keep this packed
        // acceptance path focused on the published source check and production-artifact commands:
        // repeating the full PGlite/Vite dev bootstrap would consume the real build's bounded budget.
        const { stdout: sourceCheck } = await runGeneratedStarterCommand('pnpm', ['run', 'check'], {
          cwd: app.root,
          env: withStarterBinOnPath(app.root),
        });
        expect(sourceCheck).toContain('kovo-check/v1');
        expect(sourceCheck).toContain(
          'COVERAGE component=ContactsRegion query=contacts.items position="expression" status=fragment',
        );
        expect(existsSync(join(app.root, 'dist'))).toBe(false);
      } finally {
        app.cleanup();
      }
    },
    generatedStarterTestTimeout({ cliProcessCount: 1 }),
  );

  it(
    'runs and serves the production artifact from a packed starter install',
    async () => {
      const app = await createStarterApp({
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
        await buildReusableProductionArtifactWithInfrastructureDeadline(app.root);
        const handler = readFileSync(
          join(app.root, 'dist/server/server/handler.mjs'),
          'utf8',
        );
        expect(handler).not.toMatch(/from\s+['"]\.\/assets\//);
        expect(handler).toContain('button.tsx');
        expect(handler).not.toContain('runtimeUiStyleIdentityForCallSite');
        expect(handler).not.toContain('/node_modules/@kovojs/ui/dist/');

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
        const stylesheetText = await stylesheet.text();
        expect(stylesheetText).toContain('--kovo-theme');

        const renderedButtonClasses = [...login.matchAll(/\sclass=(?:"([^"]*)"|'([^']*)')/gu)]
          .flatMap((match) => (match[1] ?? match[2] ?? '').split(/\s+/u))
          .filter((className) => /^kv-button-/u.test(className));
        const uniqueButtonClasses = [...new Set(renderedButtonClasses)].sort((left, right) =>
          left.localeCompare(right),
        );

        expect(uniqueButtonClasses.length).toBeGreaterThanOrEqual(3);
        for (const className of uniqueButtonClasses) {
          expect(stylesheetText, `missing selector for rendered ${className}`).toContain(
            `.${className}`,
          );
        }
      } finally {
        await stopProcess(server);
        app.cleanup();
      }
    },
    generatedStarterTestTimeout({ cliProcessCount: 1, serverProcessCount: 1 }),
  );
});
