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
const csrf = api.betterAuthCsrfFromEnvironment({ field: 'csrf' });
process.stdout.write(JSON.stringify({
  baseURL: resolved.baseURL,
  csrfFrozen: Object.isFrozen(csrf),
  csrfHasRawSecret: typeof csrf.secret === 'string',
  csrfSecretFrozen: Object.isFrozen(csrf.secret),
  csrfSecretKeys: Reflect.ownKeys(csrf.secret),
  sessionBinding: csrf.sessionId({ session: { id: 'session-1' }, authCsrfId: 'anonymous-1' }),
  anonymousBinding: csrf.sessionId({ session: null, authCsrfId: 'anonymous-1' }),
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
        csrfSecretFrozen: true,
        csrfSecretKeys: [],
        sessionBinding: 'session-1',
        anonymousBinding: 'anonymous-1',
        demoPassword: 'operator-demo-password',
        production: false,
        secret,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('owns request binding and rejects authored callbacks, malformed sessions, and Proxies', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-better-auth-csrf-binding-'));
    try {
      writeFileSync(
        join(root, '.env'),
        'BETTER_AUTH_SECRET=operator-auth-secret-0123456789abcdef0123456789\n',
      );
      const indexUrl = pathToFileURL(fileURLToPath(new URL('./index.ts', import.meta.url))).href;
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
const csrf = api.betterAuthCsrfFromEnvironment({ field: 'csrf' });
const failures = [];
for (const request of [
  { session: {} },
  { session: { id: null }, authCsrfId: 'downgrade' },
  { session: { id: '' }, authCsrfId: 'downgrade' },
  { session: 'attacker', authCsrfId: 'downgrade' },
  { session: null, authCsrfId: 42 },
  { session: null, authCsrfId: '' },
]) {
  try { csrf.sessionId(request); failures.push('accepted'); }
  catch (error) { failures.push(String(error)); }
}
let requestTrapHits = 0;
let sessionTrapHits = 0;
try {
  csrf.sessionId(new Proxy({}, { getOwnPropertyDescriptor() { requestTrapHits += 1; return undefined; } }));
} catch {}
try {
  csrf.sessionId({ session: new Proxy({}, { getOwnPropertyDescriptor() { sessionTrapHits += 1; return undefined; } }) });
} catch {}
let accessorHits = 0;
const accessorRequest = {};
Object.defineProperty(accessorRequest, 'session', { get() { accessorHits += 1; return { id: 'attacker' }; } });
try { csrf.sessionId(accessorRequest); } catch {}
let callbackRejected = false;
try { api.betterAuthCsrfFromEnvironment({ field: 'csrf', sessionId: () => 'constant' }); }
catch { callbackRejected = true; }
process.stdout.write(JSON.stringify({
  accessorHits,
  callbackRejected,
  failures,
  requestTrapHits,
  sessionTrapHits,
}));
`;
      const environment = { ...process.env };
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
      const output = JSON.parse(result.stdout) as {
        accessorHits: number;
        callbackRejected: boolean;
        failures: string[];
        requestTrapHits: number;
        sessionTrapHits: number;
      };
      expect(output.accessorHits).toBe(0);
      expect(output.callbackRejected).toBe(true);
      expect(output.requestTrapHits).toBe(0);
      expect(output.sessionTrapHits).toBe(0);
      expect(output.failures).toHaveLength(6);
      for (const failure of output.failures) expect(failure).toMatch(/^TypeError:/u);
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
