import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createStarterApp, resolveStarterBin, withStarterBinOnPath } from './index.test-support.js';

describe('create-kovo examples (packed consumer)', () => {
  for (const [example, entry] of [
    ['crm', 'src/scaffold-app.tsx'],
    ['commerce', 'src/scaffold-app.tsx'],
  ] as const) {
    it(
      `installs, typechecks, tests, and builds the ${example} clone from packed Kovo packages`,
      async () => {
        const app = await createStarterApp({
          example,
          install: 'packed',
          name: `packed-${example}`,
          retention: 'retained-24h',
          scaffold: 'packed-bin',
          tempPrefix: `create-kovo-packed-${example}-`,
        });
        try {
          const manifest = JSON.parse(readFileSync(join(app.root, 'package.json'), 'utf8')) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
            kovo?: { soundSubset?: { securitySurface?: string[] } };
            name?: string;
          };
          expect(manifest.name).toBe(`packed-${example}`);
          expect(Object.values(manifest.dependencies ?? {})).not.toContain('workspace:*');
          expect(Object.values(manifest.devDependencies ?? {})).not.toContain('workspace:*');
          expect(manifest.kovo?.soundSubset?.securitySurface).toEqual([
            'src/scaffold-app.test.ts',
            'src/scaffold-app.tsx',
            'src/scaffold-kovo.ts',
            'src/scaffold-mutations.ts',
          ]);
          const configPath = join(app.root, 'kovo.config.ts');
          const retainedConfig = readFileSync(configPath, 'utf8');
          expect(retainedConfig).toContain(`preset: node({
    retention: {
      hours: 24,
      immutableClientModules: 'retained',
      priorTokenQueryReads: 'retained',
    },
  })`);
          for (const file of manifest.kovo?.soundSubset?.securitySurface ?? []) {
            expect(readFileSync(join(app.root, file), 'utf8')).not.toMatch(
              /@electric-sql\/pglite|drizzle-orm\/pglite|\bprocess\.env\b|\bcrypto\.randomUUID\b/u,
            );
          }
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
          if (example === 'crm') {
            writeFileSync(
              configPath,
              [
                "import { defineConfig, node } from '@kovojs/server/build';",
                '',
                'export default defineConfig({',
                '  preset: node(),',
                '});',
                '',
              ].join('\n'),
            );
            let defaultFailure: unknown;
            try {
              execFileSync(resolveStarterBin(app.root, 'kovo'), ['build', `./${entry}`], {
                cwd: app.root,
                env,
                maxBuffer: 128 * 1024 * 1024,
                stdio: 'pipe',
              });
            } catch (error) {
              defaultFailure = error;
            }
            expect(defaultFailure).toBeDefined();
            const output =
              defaultFailure === undefined
                ? ''
                : `${String((defaultFailure as { stderr?: Buffer | string }).stderr ?? '')}\n${String(
                    (defaultFailure as { stdout?: Buffer | string }).stdout ?? '',
                  )}`;
            expect(output).toContain('KV417');
            writeFileSync(configPath, retainedConfig);
          }
          execFileSync(resolveStarterBin(app.root, 'kovo'), ['build', `./${entry}`], {
            cwd: app.root,
            env,
            maxBuffer: 128 * 1024 * 1024,
            stdio: 'pipe',
          });
        } finally {
          app.cleanup();
        }
      },
      10 * 60_000,
    );
  }
});
