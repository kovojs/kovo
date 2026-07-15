import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const requireFromSecurityTest = createRequire(import.meta.url);
const viteEntryUrl = pathToFileURL(requireFromSecurityTest.resolve('vite')).href;

describe('Better Auth shared-realm intrinsic boundary', () => {
  it('keeps signing secrets and passwords behind the bootstrap-first runtime lock', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kovo-better-auth-intrinsic-pg-'));
    try {
      const bootstrapPath = fileURLToPath(
        new URL('../../server/src/runtime-bootstrap.ts', import.meta.url),
      );
      const fixturePath = fileURLToPath(
        new URL('./intrinsic-boundary.security-fixture.ts', import.meta.url),
      );
      const source = `
import { createServer } from ${JSON.stringify(viteEntryUrl)};
const output = process.stdout;
const server = await createServer({
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true },
  ssr: { noExternal: [/^@kovojs\\//] },
});
await server.ssrLoadModule(${JSON.stringify(bootstrapPath)});
const fixture = await server.ssrLoadModule(${JSON.stringify(fixturePath)});
const result = await fixture.exerciseLockedBetterAuthIntrinsics(${JSON.stringify(dataDir)});
output.write(JSON.stringify(result));
process.exit(0);
`;
      const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
        encoding: 'utf8',
        env: {
          ...process.env,
          BETTER_AUTH_SECRET: 'Kovo-Environment-Intrinsic-Secret-0a1B2c3D4e5F',
          NODE_ENV: 'development',
        },
        timeout: 60_000,
      });

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        attempts: Array.from({ length: 15 }, () => false),
        captures: [],
        environmentCsrfTokenMinted: true,
        postgres: {
          passwordIsArgon2id: true,
          sessionProbe: null,
          signInSucceeded: true,
        },
        sqlite: {
          passwordIsArgon2id: true,
          sessionProbe: null,
          signInSucceeded: true,
        },
      });
    } finally {
      rmSync(dataDir, { force: true, recursive: true });
    }
  }, 60_000);
});
