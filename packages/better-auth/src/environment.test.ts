import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('Better Auth boot-pinned environment boundary', () => {
  it('loads local .env before a Better Auth-first import and ignores late app mutation', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-better-auth-environment-'));
    try {
      const secret = 'operator-auth-secret-0123456789abcdef0123456789';
      writeFileSync(
        join(root, '.env'),
        [
          'BETTER_AUTH_URL=https://auth.operator.example',
          `BETTER_AUTH_SECRET=${secret}`,
          'KOVO_DEMO_PASSWORD=operator-demo-password',
          'NODE_ENV=development',
          '',
        ].join('\n'),
      );
      const indexUrl = pathToFileURL(fileURLToPath(new URL('./index.ts', import.meta.url))).href;
      const environmentUrl = pathToFileURL(
        fileURLToPath(new URL('./environment.ts', import.meta.url)),
      ).href;
      const source = `
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});
const api = await import(${JSON.stringify(indexUrl)});
process.env.BETTER_AUTH_URL = 'javascript:late-app-mutation';
process.env.BETTER_AUTH_SECRET = 'short';
process.env.KOVO_DEMO_PASSWORD = 'late-app-password';
process.env.NODE_ENV = 'production';
const internal = await import(${JSON.stringify(environmentUrl)});
const resolved = internal.resolveBetterAuthEnvironment();
const csrf = api.betterAuthCsrfFromEnvironment({ field: 'csrf', sessionId: () => undefined });
process.stdout.write(JSON.stringify({
  baseURL: resolved.baseURL,
  csrfFrozen: Object.isFrozen(csrf),
  csrfHasRawSecret: typeof csrf.secret === 'string',
  demoPassword: resolved.developmentSeed?.password,
  production: resolved.production,
  secret: resolved.secret,
}));
`;
      const environment = { ...process.env };
      delete environment.BETTER_AUTH_URL;
      delete environment.BETTER_AUTH_SECRET;
      delete environment.KOVO_CSRF_SECRET;
      delete environment.KOVO_DEMO_PASSWORD;
      delete environment.NODE_ENV;
      const result = spawnSync(
        process.execPath,
        [
          '--disable-warning=ExperimentalWarning',
          '--experimental-transform-types',
          '--input-type=module',
          '--eval',
          source,
        ],
        { cwd: root, encoding: 'utf8', env: environment },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        baseURL: 'https://auth.operator.example',
        csrfFrozen: true,
        csrfHasRawSecret: false,
        demoPassword: 'operator-demo-password',
        production: false,
        secret,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects a javascript URL after a late URL.protocol getter replacement', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-better-auth-url-protocol-'));
    try {
      writeFileSync(
        join(root, '.env'),
        [
          'BETTER_AUTH_URL=javascript:alert(1)',
          'BETTER_AUTH_SECRET=operator-auth-secret-0123456789abcdef0123456789',
          '',
        ].join('\n'),
      );
      const indexUrl = pathToFileURL(fileURLToPath(new URL('./index.ts', import.meta.url))).href;
      const environmentUrl = pathToFileURL(
        fileURLToPath(new URL('./environment.ts', import.meta.url)),
      ).href;
      const source = `
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});
await import(${JSON.stringify(indexUrl)});
Object.defineProperty(URL.prototype, 'protocol', {
  configurable: true,
  get() { return 'https:'; },
});
const internal = await import(${JSON.stringify(environmentUrl)});
try {
  const resolved = internal.resolveBetterAuthEnvironment();
  process.stdout.write(JSON.stringify({ admitted: resolved.baseURL }));
} catch (error) {
  process.stdout.write(JSON.stringify({ rejected: String(error) }));
}
`;
      const environment = { ...process.env };
      delete environment.BETTER_AUTH_URL;
      delete environment.BETTER_AUTH_SECRET;
      delete environment.KOVO_CSRF_SECRET;
      const result = spawnSync(
        process.execPath,
        [
          '--disable-warning=ExperimentalWarning',
          '--experimental-transform-types',
          '--input-type=module',
          '--eval',
          source,
        ],
        { cwd: root, encoding: 'utf8', env: environment },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        rejected: 'TypeError: BETTER_AUTH_URL must be an absolute HTTP(S) URL.',
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
