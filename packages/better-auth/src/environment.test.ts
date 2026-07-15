import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const runtimeBootstrapUrl = pathToFileURL(
  fileURLToPath(new URL('../../server/src/runtime-bootstrap.ts', import.meta.url)),
).href;
const serverExecutionUrl = pathToFileURL(
  fileURLToPath(new URL('../../server/src/internal/execution.ts', import.meta.url)),
).href;

describe('Better Auth boot-pinned environment boundary', () => {
  it('loads local .env before a bootstrap-first Better Auth import and ignores late app mutation', () => {
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
await import(${JSON.stringify(runtimeBootstrapUrl)});
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

  it('refuses environment CSRF before reading untrusted options without runner bootstrap', () => {
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
let optionTrapHits = 0;
let refusal = '';
try {
  await import(${JSON.stringify(indexUrl)});
} catch (error) {
  refusal = String(error?.message ?? error);
}
process.stdout.write(JSON.stringify({ optionTrapHits, refusal }));
`;
    const result = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--experimental-transform-types',
        '--input-type=module',
        '--eval',
        source,
      ],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      optionTrapHits: 0,
      refusal: expect.stringContaining(
        'refuses evaluation before the request-safe runtime realm lock',
      ),
    });
  });

  it('keeps a failed pre-lock package evaluation failed after a late bootstrap', () => {
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
let initialRefusal = '';
try { await import(${JSON.stringify(indexUrl)}); }
catch (error) { initialRefusal = String(error?.message ?? error); }
await import(${JSON.stringify(runtimeBootstrapUrl)});
let lateRefusal = '';
try { await import(${JSON.stringify(indexUrl)}); }
catch (error) { lateRefusal = String(error?.message ?? error); }
process.stdout.write(JSON.stringify({ initialRefusal, lateRefusal }));
`;
    const result = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--experimental-transform-types',
        '--input-type=module',
        '--eval',
        source,
      ],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      initialRefusal: expect.stringContaining(
        'refuses evaluation before the request-safe runtime realm lock',
      ),
      lateRefusal: expect.stringContaining(
        'refuses evaluation before the request-safe runtime realm lock',
      ),
    });
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
await import(${JSON.stringify(runtimeBootstrapUrl)});
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

  it('accepts only the exact framework-pinned request Proxy without weakening Proxy rejection', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-better-auth-framework-csrf-binding-'));
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
await import(${JSON.stringify(runtimeBootstrapUrl)});
const api = await import(${JSON.stringify(indexUrl)});
const execution = await import(${JSON.stringify(serverExecutionUrl)});
const csrf = api.betterAuthCsrfFromEnvironment({ field: 'csrf' });
const providerSession = { id: 'framework-session-1' };
const sessionCarrier = await execution.resolveLifecycleRequest({}, {
  sessionProvider: () => providerSession,
});
providerSession.id = 'late-attacker-session';
const anonymousCarrier = await execution.resolveLifecycleRequest(
  { authCsrfId: 'framework-anonymous-1' },
  { principalPosture: { kind: 'anonymous' } },
);
const rawSessionCarrier = await execution.resolveLifecycleRequest(
  { session: { id: 'raw-session-must-not-cross' } },
  { principalPosture: { kind: 'anonymous' } },
);
let accessorHits = 0;
const accessorRequest = {};
Object.defineProperty(accessorRequest, 'session', {
  enumerable: true,
  get() { accessorHits += 1; return { id: 'accessor-session-must-not-cross' }; },
});
const accessorCarrier = await execution.resolveLifecycleRequest(accessorRequest, {
  principalPosture: { kind: 'anonymous' },
});
let wrapperTrapHits = 0;
let wrapperRejected = false;
try {
  csrf.sessionId(new Proxy(sessionCarrier, {
    getOwnPropertyDescriptor() { wrapperTrapHits += 1; return undefined; },
  }));
} catch (error) {
  wrapperRejected = String(error?.message ?? error).includes('must not be a Proxy');
}
let foreignTrapHits = 0;
let foreignRejected = false;
try {
  csrf.sessionId(new Proxy({}, {
    getOwnPropertyDescriptor() { foreignTrapHits += 1; return undefined; },
  }));
} catch (error) {
  foreignRejected = String(error?.message ?? error).includes('must not be a Proxy');
}
process.stdout.write(JSON.stringify({
  accessorBinding: csrf.sessionId(accessorCarrier) ?? null,
  accessorHits,
  anonymousBinding: csrf.sessionId(anonymousCarrier) ?? null,
  foreignRejected,
  foreignTrapHits,
  rawSessionBinding: csrf.sessionId(rawSessionCarrier) ?? null,
  sessionBinding: csrf.sessionId(sessionCarrier),
  wrapperRejected,
  wrapperTrapHits,
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
      expect(JSON.parse(result.stdout)).toEqual({
        accessorBinding: null,
        accessorHits: 1,
        anonymousBinding: null,
        foreignRejected: true,
        foreignTrapHits: 0,
        rawSessionBinding: null,
        sessionBinding: 'framework-session-1',
        wrapperRejected: true,
        wrapperTrapHits: 0,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('keeps the HTTP localhost default development-only and requires a canonical production HTTPS origin', () => {
    expect(resolveEnvironmentInChild([])).toEqual({
      baseURL: 'http://localhost:5173',
      developmentSeed: false,
      production: false,
    });
    expect(
      resolveEnvironmentInChild([
        'BETTER_AUTH_URL=https://auth.operator.example',
        'KOVO_DEMO_PASSWORD=must-not-seed-in-production',
        'NODE_ENV=production',
      ]),
    ).toEqual({
      baseURL: 'https://auth.operator.example',
      developmentSeed: false,
      production: true,
    });

    expect(resolveEnvironmentInChild(['NODE_ENV=production'])).toEqual({
      error: expect.stringMatching(/BETTER_AUTH_URL is required in production/u),
    });
    expect(
      resolveEnvironmentInChild([
        'BETTER_AUTH_URL=http://auth.operator.example',
        'NODE_ENV=production',
      ]),
    ).toEqual({ error: expect.stringMatching(/must use HTTPS in production/u) });
    for (const malformedUrl of [
      'https://auth.operator.example/',
      'https://user@auth.operator.example',
      'https://auth.operator.example/path',
      'https://auth.operator.example?tenant=one',
      'https://auth.operator.example#fragment',
    ]) {
      expect(
        resolveEnvironmentInChild([`BETTER_AUTH_URL="${malformedUrl}"`, 'NODE_ENV=production']),
      ).toEqual({ error: expect.stringMatching(/canonical absolute HTTP\(S\) origin/u) });
    }
  });

  it('rejects upstream Better Auth secret and trusted-origin environment authorities', () => {
    expect(resolveEnvironmentInChild(['BETTER_AUTH_SECRETS=0:attacker-controlled-secret'])).toEqual(
      {
        error: expect.stringMatching(/BETTER_AUTH_SECRETS is not accepted/u),
      },
    );
    expect(
      resolveEnvironmentInChild(['BETTER_AUTH_TRUSTED_ORIGINS=https://attacker.example']),
    ).toEqual({
      error: expect.stringMatching(/BETTER_AUTH_TRUSTED_ORIGINS is not accepted/u),
    });
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
await import(${JSON.stringify(runtimeBootstrapUrl)});
await import(${JSON.stringify(indexUrl)});
const replacement = Reflect.defineProperty(URL.prototype, 'protocol', {
  configurable: true,
  get() { return 'https:'; },
});
const internal = await import(${JSON.stringify(environmentUrl)});
try {
  const resolved = internal.resolveBetterAuthEnvironment();
  process.stdout.write(JSON.stringify({ admitted: resolved.baseURL, replacement }));
} catch (error) {
  process.stdout.write(JSON.stringify({ rejected: String(error), replacement }));
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
        rejected: 'TypeError: BETTER_AUTH_URL must be a canonical absolute HTTP(S) origin.',
        replacement: false,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

function resolveEnvironmentInChild(lines: readonly string[]): {
  baseURL?: string;
  developmentSeed?: boolean;
  error?: unknown;
  production?: boolean;
} {
  const root = mkdtempSync(join(tmpdir(), 'kovo-better-auth-environment-posture-'));
  try {
    writeFileSync(
      join(root, '.env'),
      ['BETTER_AUTH_SECRET=operator-auth-secret-0123456789abcdef0123456789', ...lines, ''].join(
        '\n',
      ),
    );
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
await import(${JSON.stringify(runtimeBootstrapUrl)});
try {
  const internal = await import(${JSON.stringify(environmentUrl)});
  const resolved = internal.resolveBetterAuthEnvironment();
  process.stdout.write(JSON.stringify({
    baseURL: resolved.baseURL,
    developmentSeed: resolved.developmentSeed !== undefined,
    production: resolved.production,
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: String(error) }));
}
`;
    const environment = { ...process.env };
    for (const name of [
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_SECRETS',
      'BETTER_AUTH_TRUSTED_ORIGINS',
      'BETTER_AUTH_URL',
      'KOVO_CSRF_SECRET',
      'KOVO_DEMO_PASSWORD',
      'NODE_ENV',
    ]) {
      delete environment[name];
    }
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
    return JSON.parse(result.stdout) as {
      baseURL?: string;
      developmentSeed?: boolean;
      error?: unknown;
      production?: boolean;
    };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}
