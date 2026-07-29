import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createStarterApp, resolveStarterBin, withStarterBinOnPath } from './index.test-support.js';

describe('create-kovo examples (packed consumer)', () => {
  for (const example of ['crm', 'commerce'] as const) {
    it(
      `installs, typechecks, and tests the ${example} clone from packed Kovo packages`,
      () => {
        const app = createStarterApp({
          example,
          install: 'packed',
          name: `packed-${example}`,
          scaffold: 'packed-bin',
          tempPrefix: `create-kovo-packed-${example}-`,
        });
        try {
          const manifest = JSON.parse(readFileSync(join(app.root, 'package.json'), 'utf8')) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
            name?: string;
          };
          expect(manifest.name).toBe(`packed-${example}`);
          expect(Object.values(manifest.dependencies ?? {})).not.toContain('workspace:*');
          expect(Object.values(manifest.devDependencies ?? {})).not.toContain('workspace:*');
          const env = withStarterBinOnPath(app.root);
          execFileSync(resolveStarterBin(app.root, 'tsc'), ['--noEmit'], {
            cwd: app.root,
            env,
            stdio: 'pipe',
          });
          execFileSync(
            resolveStarterBin(app.root, 'vitest'),
            ['--run', '--config', 'vitest.config.ts'],
            {
              cwd: app.root,
              env,
              maxBuffer: 128 * 1024 * 1024,
              stdio: 'pipe',
            },
          );
        } finally {
          app.cleanup();
        }
      },
      10 * 60_000,
    );
  }
});
