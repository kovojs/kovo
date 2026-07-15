import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const requireFromServerTest = createRequire(import.meta.url);
const viteEntryUrl = pathToFileURL(requireFromServerTest.resolve('vite')).href;

describe('custom runtime bootstrap entries', () => {
  it('shares framework singleton state across the real packed entries', () => {
    const serverRoot = fileURLToPath(new URL('..', import.meta.url));
    const packed = spawnSync('pnpm', ['run', 'build:dist'], {
      cwd: serverRoot,
      encoding: 'utf8',
    });
    expect(packed.status, `${packed.stdout}\n${packed.stderr}`).toBe(0);

    const packedBetterAuth = spawnSync(
      'pnpm',
      ['--filter', '@kovojs/better-auth', 'run', 'build:dist'],
      { cwd: serverRoot, encoding: 'utf8' },
    );
    expect(packedBetterAuth.status, `${packedBetterAuth.stdout}\n${packedBetterAuth.stderr}`).toBe(
      0,
    );
    const betterAuthDistRoot = fileURLToPath(new URL('../../better-auth/dist', import.meta.url));

    const distRoot = join(serverRoot, 'dist');
    const omission = runPackedServerChild(distRoot, false);
    expect(omission.status, omission.stderr).toBe(0);
    expect(JSON.parse(omission.stdout)).toEqual({
      refusal: expect.stringContaining('refuses an unbootstrapped custom runner'),
    });

    const bootstrapped = runPackedServerChild(distRoot, true);
    expect(bootstrapped.status, bootstrapped.stderr).toBe(0);
    expect(JSON.parse(bootstrapped.stdout)).toEqual({ callable: 'function' });

    const presetRegistry = runPackedPresetRegistryChild(serverRoot, distRoot);
    expect(presetRegistry.status, presetRegistry.stderr).toBe(0);
    expect(JSON.parse(presetRegistry.stdout)).toEqual({
      engineEmit: 'function',
      engineName: 'node',
      forgedAccepted: false,
      tokenFrozen: true,
      tokenStringKeys: [],
      tokenSymbolKeys: 1,
    });

    const environmentRoot = mkdtempSync(join(tmpdir(), 'kovo-packed-runtime-environment-'));
    try {
      writeFileSync(
        join(environmentRoot, '.env'),
        'PACKED_KOVO_ENV_PROOF=loaded-before-bootstrap\n',
      );
      const environmentProof = runPackedEnvironmentChild(distRoot, environmentRoot);
      expect(environmentProof.status, environmentProof.stderr).toBe(0);
      expect(JSON.parse(environmentProof.stdout)).toEqual({
        afterMutation: 'loaded-before-bootstrap',
        beforeMutation: 'loaded-before-bootstrap',
      });
    } finally {
      rmSync(environmentRoot, { force: true, recursive: true });
    }

    const sqliteBoundary = runPackedSqliteBoundaryChild(
      distRoot,
      join(betterAuthDistRoot, 'index.mjs'),
    );
    expect(sqliteBoundary.status, sqliteBoundary.stderr).toBe(0);
    expect(JSON.parse(sqliteBoundary.stdout)).toEqual({
      bindingKeys: ['seedDemoUser', 'sessionProvider', 'signIn', 'signOut'],
      bindingsFrozen: true,
      csrfSecretOwnKeys: 0,
      csrfSessionBinding: 'packed-session',
      csrfTokenMinted: true,
      providerOwnKeys: 0,
      queryBodyIncludesSeed: true,
      queryStatus: 200,
    });

    const postgresBoundary = runPackedPostgresBoundaryChild(
      distRoot,
      fileURLToPath(new URL('../../better-auth/dist/index.mjs', import.meta.url)),
    );
    expect(postgresBoundary.status, postgresBoundary.stderr).toBe(0);
    expect(JSON.parse(postgresBoundary.stdout)).toEqual({
      bindingKeys: ['seedDemoUser', 'sessionProvider', 'signIn', 'signOut'],
      bindingsFrozen: true,
      forgedRejected: true,
      providerOwnKeys: 0,
    });

    const preloadedBetterAuthInternal = runPackedBetterAuthPreloadChild(
      distRoot,
      betterAuthDistRoot,
      'internal',
      'buffer',
    );
    expect(preloadedBetterAuthInternal.status, preloadedBetterAuthInternal.stderr).toBe(0);
    expect(JSON.parse(preloadedBetterAuthInternal.stdout)).toMatchObject({
      csrfCreated: false,
      preloadRefusal: expect.stringContaining(
        'refuses evaluation before the request-safe runtime realm lock',
      ),
      secretCaptured: false,
    });

    const preloadedBetterAuthRoot = runPackedBetterAuthPreloadChild(
      distRoot,
      betterAuthDistRoot,
      'root',
      'descriptor',
    );
    expect(preloadedBetterAuthRoot.status, preloadedBetterAuthRoot.stderr).toBe(0);
    expect(JSON.parse(preloadedBetterAuthRoot.stdout)).toMatchObject({
      csrfCreated: false,
      preloadRefusal: expect.stringContaining(
        'refuses evaluation before the request-safe runtime realm lock',
      ),
      secretCaptured: false,
    });
  }, 60_000);

  it('refuses the public request-handler chokepoint when bootstrap is absent', () => {
    const appPath = fileURLToPath(new URL('./app.ts', import.meta.url));
    const handlerPath = fileURLToPath(new URL('./request-handler.ts', import.meta.url));
    const source = `
import { createServer } from ${JSON.stringify(viteEntryUrl)};
const output = process.stdout;
const server = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true } });
const appModule = await server.ssrLoadModule(${JSON.stringify(appPath)});
const handlerModule = await server.ssrLoadModule(${JSON.stringify(handlerPath)});
const app = appModule.createApp({});
let refusal = '';
try { handlerModule.createRequestHandler(app); } catch (error) { refusal = String(error?.message ?? error); }
output.write(JSON.stringify({ refusal }));
process.exit(0);
`;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      refusal: expect.stringContaining('refuses an unbootstrapped custom runner'),
    });
  });

  it('accepts the public chokepoint after a first-import bootstrap and duplicate relock', () => {
    const appPath = fileURLToPath(new URL('./app.ts', import.meta.url));
    const handlerPath = fileURLToPath(new URL('./request-handler.ts', import.meta.url));
    const bootstrapPath = fileURLToPath(new URL('./runtime-bootstrap.ts', import.meta.url));
    const source = `
import { createServer } from ${JSON.stringify(viteEntryUrl)};
const output = process.stdout;
const server = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true } });
await server.ssrLoadModule(${JSON.stringify(bootstrapPath)});
await server.ssrLoadModule(${JSON.stringify(`${bootstrapPath}?duplicate-copy`)});
const appModule = await server.ssrLoadModule(${JSON.stringify(appPath)});
const handlerModule = await server.ssrLoadModule(${JSON.stringify(handlerPath)});
const handler = handlerModule.createRequestHandler(appModule.createApp({}));
output.write(JSON.stringify({ callable: typeof handler }));
process.exit(0);
`;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ callable: 'function' });
  });

  it('refuses public static export and renderTree callback dispatch when bootstrap is absent', () => {
    const serverPath = fileURLToPath(new URL('./index.ts', import.meta.url));
    const corePath = requireFromServerTest.resolve('@kovojs/core');
    const source = `
import { createServer } from ${JSON.stringify(viteEntryUrl)};
const output = process.stdout;
const server = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true }, ssr: { noExternal: [/^@kovojs\\//] } });
const api = await server.ssrLoadModule(${JSON.stringify(serverPath)});
const core = await server.ssrLoadModule(${JSON.stringify(corePath)});
let exportHits = 0;
let renderHits = 0;
const app = api.createApp({ routes: [api.route('/', { page: () => { exportHits += 1; return api.trustedHtml('<main>unsafe</main>', 'test'); } })] });
const Component = core.component({ render: () => { renderHits += 1; return api.trustedHtml('<span>unsafe</span>', 'test'); } });
const registry = api.renderRegistry({ 'kovo-proof': Component });
let exportRefusal = '';
let renderRefusal = '';
try { await api.exportStaticApp(app); } catch (error) { exportRefusal = String(error?.message ?? error); }
try { await api.renderTree(registry, api.parseComponentXml('<kovo-proof/>')); } catch (error) { renderRefusal = String(error?.message ?? error); }
output.write(JSON.stringify({ exportHits, exportRefusal, renderHits, renderRefusal }));
process.exit(0);
`;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      exportHits: 0,
      exportRefusal: expect.stringContaining('exportStaticApp() refuses'),
      renderHits: 0,
      renderRefusal: expect.stringContaining('renderTree() refuses'),
    });
  });

  it('runs public static export and renderTree behind bootstrap without mutable JSON dispatch', () => {
    const serverPath = fileURLToPath(new URL('./index.ts', import.meta.url));
    const bootstrapPath = fileURLToPath(new URL('./runtime-bootstrap.ts', import.meta.url));
    const corePath = requireFromServerTest.resolve('@kovojs/core');
    const source = `
import { createServer } from ${JSON.stringify(viteEntryUrl)};
const output = process.stdout;
const server = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true }, ssr: { noExternal: [/^@kovojs\\//] } });
await server.ssrLoadModule(${JSON.stringify(bootstrapPath)});
const api = await server.ssrLoadModule(${JSON.stringify(serverPath)});
const core = await server.ssrLoadModule(${JSON.stringify(corePath)});
let exportHits = 0;
let renderHits = 0;
const poisonAttempts = [];
const app = api.createApp({ routes: [api.route('/', { page: () => { exportHits += 1; poisonAttempts.push(Reflect.set(JSON, 'stringify', () => 'poison')); return api.trustedHtml('<main>safe</main>', 'test'); } })] });
const Component = core.component({ render: () => { renderHits += 1; poisonAttempts.push(Reflect.set(JSON, 'stringify', () => 'poison')); return api.trustedHtml('<span>safe</span>', 'test'); } });
const registry = api.renderRegistry({ 'kovo-proof': Component });
const exported = await api.exportStaticApp(app);
const rendered = await api.renderTree(registry, api.parseComponentXml('<kovo-proof/>'));
output.write(JSON.stringify({ exportHits, exported: exported.artifacts.length, poisonAttempts, renderHits, rendered }));
process.exit(0);
`;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      exportHits: 1,
      exported: 1,
      poisonAttempts: [false, false],
      renderHits: 1,
    });
  });

  it('locks globals, callable dispatch, and hidden protocols before the next dependency', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-runtime-bootstrap-'));
    try {
      const poisonPath = join(root, 'poison.mjs');
      writeFileSync(
        poisonPath,
        `const NativeResponse = globalThis.Response;
const nativeFetch = globalThis.fetch;
const nativeSetTimeout = setTimeout;
const nativeAtob = globalThis.atob;
const nativeBtoa = globalThis.btoa;
const NativeSubtleCrypto = globalThis.SubtleCrypto;
const NativeTextEncoder = globalThis.TextEncoder;
const nativeSubtleImportKey = globalThis.crypto.subtle.importKey;
const nativeSubtleSign = globalThis.crypto.subtle.sign;
const nativeTextEncoderEncode = globalThis.TextEncoder.prototype.encode;
const nativeStringNormalize = globalThis.String.prototype.normalize;
const subtlePrototype = Object.getPrototypeOf(globalThis.crypto.subtle);
const arrayIteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]());
const mapIteratorPrototype = Object.getPrototypeOf(new Map().entries());
const matchAllIteratorPrototype = Object.getPrototypeOf('safe'.matchAll(/./g));
export const attempts = [
  Reflect.set(globalThis, 'Response', class AttackerResponse {}),
  Reflect.set(globalThis, 'fetch', async () => new Response('attacker')),
  Reflect.set(globalThis, 'setTimeout', () => 0),
  Reflect.set(globalThis, 'atob', () => 'attacker-atob'),
  Reflect.set(globalThis, 'btoa', () => 'attacker-btoa'),
  Reflect.set(globalThis, 'SubtleCrypto', class AttackerSubtleCrypto {}),
  Reflect.set(globalThis, 'TextEncoder', class AttackerTextEncoder {}),
  Reflect.set(subtlePrototype, 'importKey', async () => 'attacker-key'),
  Reflect.set(subtlePrototype, 'sign', async () => new ArrayBuffer(0)),
  Reflect.set(globalThis.crypto.subtle, 'importKey', async () => 'attacker-own-key'),
  Reflect.set(globalThis.TextEncoder.prototype, 'encode', () => new Uint8Array()),
  Reflect.set(globalThis.String.prototype, 'normalize', () => 'attacker-normalize'),
  Reflect.set(Function.prototype, 'call', () => 'attacker-call'),
  Reflect.set(Function.prototype, 'apply', () => 'attacker-apply'),
  Reflect.set(Function.prototype, 'bind', () => () => 'attacker-bind'),
  Reflect.defineProperty(Array.from, 'call', {
    configurable: true,
    value: () => ['attacker-static-call'],
    writable: true,
  }),
  Reflect.set(arrayIteratorPrototype, 'next', () => ({ done: true })),
  Reflect.set(mapIteratorPrototype, 'next', () => ({ done: true })),
  Reflect.set(matchAllIteratorPrototype, 'next', () => ({ done: true })),
];
export const exact = [
  globalThis.Response === NativeResponse,
  globalThis.fetch === nativeFetch,
  setTimeout === nativeSetTimeout,
  globalThis.atob === nativeAtob,
  globalThis.btoa === nativeBtoa,
  globalThis.SubtleCrypto === NativeSubtleCrypto,
  globalThis.TextEncoder === NativeTextEncoder,
  globalThis.crypto.subtle.importKey === nativeSubtleImportKey,
  globalThis.crypto.subtle.sign === nativeSubtleSign,
  globalThis.TextEncoder.prototype.encode === nativeTextEncoderEncode,
  globalThis.String.prototype.normalize === nativeStringNormalize,
];
function join(left, right) { return this.prefix + left + right; }
const formData = new FormData();
formData.append('field', 'form-safe');
export const behavior = {
  array: [...['array-safe']][0],
  base64: atob(btoa('base64-safe')),
  bound: join.bind({ prefix: 'b' }, 'i')('n'),
  called: join.call({ prefix: 'c' }, 'a', 'l'),
  formData: [...formData.entries()][0][1],
  map: [...new Map([['field', 'map-safe']]).values()][0],
  matchAll: [...'match-safe'.matchAll(/match/g)][0][0],
};\n`,
      );
      const result = runStaticBootstrapProof(
        fileURLToPath(new URL('./runtime-bootstrap.ts', import.meta.url)),
        poisonPath,
      );
      expect(result).toEqual({
        attempts: Array.from({ length: 19 }, () => false),
        behavior: {
          array: 'array-safe',
          base64: 'base64-safe',
          bound: 'bin',
          called: 'cal',
          formData: 'form-safe',
          map: 'map-safe',
          matchAll: 'match',
        },
        exact: Array.from({ length: 11 }, () => true),
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails closed on a detected late poison without treating that probe as ordering proof', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-late-runtime-bootstrap-'));
    try {
      const poisonPath = join(root, 'poison.mjs');
      writeFileSync(
        poisonPath,
        `export class AuthoredResponse extends Response {}
if (!Reflect.set(globalThis, 'Response', AuthoredResponse)) {
  throw new Error('late-bootstrap boundary setup could not replace Response');
}\n`,
      );
      const bootstrapPath = fileURLToPath(new URL('./runtime-bootstrap.ts', import.meta.url));
      const source = `
import { createServer } from ${JSON.stringify(viteEntryUrl)};
const server = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true } });
await import(${JSON.stringify(pathToFileURL(poisonPath).href)});
await server.ssrLoadModule(${JSON.stringify(bootstrapPath)});
`;
      const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
        encoding: 'utf8',
      });
      // This concrete poison is detected by a framework control health assertion. The contract
      // still rests on literal first-import order: a finite assertion cannot prove realm history.
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('response security getter body is unavailable');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

function runStaticBootstrapProof(bootstrapPath: string, poisonPath: string): unknown {
  const source = `
import { createServer } from ${JSON.stringify(viteEntryUrl)};
const output = process.stdout;
const server = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true } });
await server.ssrLoadModule(${JSON.stringify(bootstrapPath)});
const { attempts, behavior, exact } = await import(${JSON.stringify(pathToFileURL(poisonPath).href)});
output.write(JSON.stringify({ attempts, behavior, exact }));
process.exit(0);
`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as unknown;
}

function runPackedServerChild(distRoot: string, withBootstrap: boolean) {
  const rootEntry = pathToFileURL(join(distRoot, 'index.mjs')).href;
  const bootstrapEntry = pathToFileURL(join(distRoot, 'runtime-bootstrap.mjs')).href;
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
${withBootstrap ? `await import(${JSON.stringify(bootstrapEntry)});` : ''}
const api = await import(${JSON.stringify(rootEntry)});
if (${JSON.stringify(withBootstrap)}) {
  const handler = api.createRequestHandler(api.createApp({ egress: { allowInternal: [] } }));
  process.stdout.write(JSON.stringify({ callable: typeof handler }));
} else {
  let refusal = '';
  try { api.createRequestHandler({}); } catch (error) { refusal = String(error?.message ?? error); }
  process.stdout.write(JSON.stringify({ refusal }));
}
`;
  return spawnSync(
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
}

function runPackedPresetRegistryChild(serverRoot: string, distRoot: string) {
  const root = mkdtempSync(join(serverRoot, '.tmp-packed-preset-registry-'));
  try {
    const packageJson = JSON.parse(readFileSync(join(serverRoot, 'package.json'), 'utf8')) as {
      publishConfig: { exports: Record<string, unknown> };
    };
    cpSync(distRoot, join(root, 'dist'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify({
        exports: packageJson.publishConfig.exports,
        name: '@kovojs/server',
        type: 'module',
      })}\n`,
      'utf8',
    );
    writeFileSync(
      join(root, 'proof.mjs'),
      `import { existsSync } from 'node:fs';
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
const { node } = await import('@kovojs/server/build');
const { resolveKovoBuildPreset } = await import('@kovojs/server/internal/build-preset');
const token = node({ dockerfile: false });
const engine = resolveKovoBuildPreset(token);
const forged = resolveKovoBuildPreset({ name: 'node', emit() {} });
process.stdout.write(JSON.stringify({
  engineEmit: typeof engine?.emit,
  engineName: engine?.name,
  forgedAccepted: forged !== undefined,
  tokenFrozen: Object.isFrozen(token),
  tokenStringKeys: Object.getOwnPropertyNames(token),
  tokenSymbolKeys: Object.getOwnPropertySymbols(token).length,
}));
`,
      'utf8',
    );
    return spawnSync(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', '--experimental-transform-types', 'proof.mjs'],
      { cwd: root, encoding: 'utf8' },
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function runPackedEnvironmentChild(distRoot: string, cwd: string) {
  const bootstrapEntry = pathToFileURL(join(distRoot, 'runtime-bootstrap.mjs')).href;
  const environmentEntry = pathToFileURL(join(distRoot, 'internal/runtime-environment.mjs')).href;
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
await import(${JSON.stringify(bootstrapEntry)});
const environment = await import(${JSON.stringify(environmentEntry)});
const beforeMutation = environment.runtimeEnvironmentValue('PACKED_KOVO_ENV_PROOF');
process.env.PACKED_KOVO_ENV_PROOF = 'late-authored-mutation';
const afterMutation = environment.runtimeEnvironmentValue('PACKED_KOVO_ENV_PROOF');
process.stdout.write(JSON.stringify({ afterMutation, beforeMutation }));
`;
  const environment = { ...process.env };
  delete environment.PACKED_KOVO_ENV_PROOF;
  return spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      '--input-type=module',
      '--eval',
      source,
    ],
    { cwd, encoding: 'utf8', env: environment },
  );
}

function runPackedSqliteBoundaryChild(distRoot: string, betterAuthEntry: string) {
  const entries = {
    'drizzle-orm/sqlite-core': pathToFileURL(
      requireFromServerTest.resolve('drizzle-orm/sqlite-core'),
    ).href,
    '@kovojs/server': pathToFileURL(join(distRoot, 'index.mjs')).href,
    '@kovojs/server/internal/csrf': pathToFileURL(join(distRoot, 'internal/csrf.mjs')).href,
    '@kovojs/server/internal/execution': pathToFileURL(join(distRoot, 'internal/execution.mjs'))
      .href,
    '@kovojs/server/internal/runtime-environment': pathToFileURL(
      join(distRoot, 'internal/runtime-environment.mjs'),
    ).href,
    '@kovojs/server/internal/keyring': pathToFileURL(join(distRoot, 'internal/keyring.mjs')).href,
    '@kovojs/server/internal/sqlite': pathToFileURL(join(distRoot, 'internal/sqlite.mjs')).href,
    '@kovojs/server/internal/sqlite-capability': pathToFileURL(
      join(distRoot, 'internal/sqlite-capability.mjs'),
    ).href,
    '@kovojs/server/sqlite': pathToFileURL(join(distRoot, 'sqlite.mjs')).href,
  };
  const bootstrapEntry = pathToFileURL(join(distRoot, 'runtime-bootstrap.mjs')).href;
  const betterAuthUrl = pathToFileURL(betterAuthEntry).href;
  const source = `
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    const mapped = ${JSON.stringify(entries)}[specifier];
    if (mapped) return nextResolve(mapped, context);
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});
await import(${JSON.stringify(bootstrapEntry)});
const server = await import(${JSON.stringify(entries['@kovojs/server'])});
const execution = await import(${JSON.stringify(entries['@kovojs/server/internal/execution'])});
const sqlite = await import(${JSON.stringify(entries['@kovojs/server/sqlite'])});
const betterAuth = await import(${JSON.stringify(betterAuthUrl)});
const { sqliteTable, text } = await import('drizzle-orm/sqlite-core');
const proof = sqliteTable('kovo_packed_provider_proof', {
  id: text('id').primaryKey(),
  value: text('value').notNull(),
});
const runtime = sqlite.createSqliteAppRuntime({
  seed: [{ rows: [{ id: 'p1', value: 'packed-seed-visible' }], table: proof }],
  tables: [proof],
});
try {
  const appCsrf = betterAuth.betterAuthCsrfFromEnvironment({ field: 'csrf' });
  const csrfRequest = await execution.resolveLifecycleRequest({}, {
    sessionProvider: () => ({ id: 'packed-session' }),
  });
  const packedCsrfToken = server.csrfToken(csrfRequest, appCsrf, { audience: 'auth/sign-in' });
  const bindings = betterAuth.createBetterAuthSqliteBindings({
    baseURL: 'http://localhost:5173',
    csrf: { secret: 'packed-csrf-secret-0123456789abcdef', sessionId: () => undefined },
    mapSession: ({ session, user }) => ({ id: session.id, user: { id: user.id } }),
    schema: { proof },
    secret: betterAuth.betterAuthSqliteSecret('packed-auth-secret-0123456789abcdef'),
    signInAccess: server.publicAccess('packed Better Auth sign-in proof'),
    signOutAccess: server.publicAccess('packed Better Auth sign-out proof'),
    systemDb: runtime.systemDb({
      operation: 'write',
      reason: 'Packed Better Auth adapter construction proof',
      surface: 'runtime-bootstrap.test#packed-sqlite-auth',
    }),
  });
  const packedQuery = server.query('packed-provider-proof', {
    access: server.publicAccess('packed managed provider query proof'),
    load: async (_input, context) => ({
      items: await context.db.select({ id: proof.id, value: proof.value }).from(proof).all(),
    }),
    reads: [],
  });
  const app = server.createApp({
    db: runtime.db,
    egress: { enabled: false, justification: 'isolated packed provider proof' },
    queries: [packedQuery],
  });
  const handler = server.createRequestHandler(app);
  const response = await handler(new Request('http://localhost/_q/packed-provider-proof'));
  const body = await response.text();
  process.stdout.write(JSON.stringify({
    bindingKeys: Object.keys(bindings).sort(),
    bindingsFrozen: Object.isFrozen(bindings),
    csrfSecretOwnKeys: Reflect.ownKeys(appCsrf.secret).length,
    csrfSessionBinding: appCsrf.sessionId(csrfRequest),
    csrfTokenMinted: /^v1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(packedCsrfToken),
    providerOwnKeys: Reflect.ownKeys(runtime.db).length,
    queryBodyIncludesSeed: body.includes('packed-seed-visible'),
    queryStatus: response.status,
  }));
} finally {
  runtime.close();
}

`;
  return spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      '--input-type=module',
      '--eval',
      source,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        BETTER_AUTH_SECRET: 'packed-auth-secret-0123456789abcdef0123456789',
        NODE_ENV: 'development',
      },
    },
  );
}

function runPackedBetterAuthPreloadChild(
  distRoot: string,
  betterAuthDistRoot: string,
  entry: 'internal' | 'root',
  poison: 'buffer' | 'descriptor',
) {
  const secret = 'SUBPATH-WITNESS-SECRET-0123456789abcdef-RAW';
  const entries = {
    '@kovojs/server': pathToFileURL(join(distRoot, 'index.mjs')).href,
    '@kovojs/server/internal/csrf': pathToFileURL(join(distRoot, 'internal/csrf.mjs')).href,
    '@kovojs/server/internal/execution': pathToFileURL(join(distRoot, 'internal/execution.mjs'))
      .href,
    '@kovojs/server/internal/keyring': pathToFileURL(join(distRoot, 'internal/keyring.mjs')).href,
    '@kovojs/server/internal/postgres-capability': pathToFileURL(
      join(distRoot, 'internal/postgres-capability.mjs'),
    ).href,
    '@kovojs/server/internal/runtime-environment': pathToFileURL(
      join(distRoot, 'internal/runtime-environment.mjs'),
    ).href,
    '@kovojs/server/internal/sqlite': pathToFileURL(join(distRoot, 'internal/sqlite.mjs')).href,
    '@kovojs/server/internal/sqlite-capability': pathToFileURL(
      join(distRoot, 'internal/sqlite-capability.mjs'),
    ).href,
    '@kovojs/server/internal/wire': pathToFileURL(join(distRoot, 'internal/wire.mjs')).href,
  };
  const bootstrapEntry = pathToFileURL(join(distRoot, 'runtime-bootstrap.mjs')).href;
  const betterAuthInternalEntry = pathToFileURL(join(betterAuthDistRoot, 'internal.mjs')).href;
  const betterAuthRootEntry = pathToFileURL(join(betterAuthDistRoot, 'index.mjs')).href;
  const preloadEntry = entry === 'internal' ? betterAuthInternalEntry : betterAuthRootEntry;
  const poisonInstall =
    poison === 'buffer'
      ? `const nativeControl = Buffer.from;
Reflect.set(Buffer, 'from', function hostileBufferFrom(value, ...rest) {
  if (typeof value === 'string') captures.push(value);
  return Reflect.apply(nativeControl, Buffer, [value, ...rest]);
});`
      : `const nativeControl = Object.getOwnPropertyDescriptor;
Reflect.set(Object, 'getOwnPropertyDescriptor', function hostileDescriptor(target, key) {
  const descriptor = Reflect.apply(nativeControl, Object, [target, key]);
  if (descriptor && typeof descriptor.value === 'string') captures.push(descriptor.value);
  return descriptor;
});`;
  const poisonRestore =
    poison === 'buffer'
      ? `Reflect.set(Buffer, 'from', nativeControl);`
      : `Reflect.set(Object, 'getOwnPropertyDescriptor', nativeControl);`;
  const source = `
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    const mapped = ${JSON.stringify(entries)}[specifier];
    if (mapped) return nextResolve(mapped, context);
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});
const secret = ${JSON.stringify(secret)};
const captures = [];
${poisonInstall}
let preloadRefusal = '';
try { await import(${JSON.stringify(preloadEntry)}); }
catch (error) { preloadRefusal = String(error?.message ?? error); }
${poisonRestore}
let bootstrapRefusal = '';
try { await import(${JSON.stringify(bootstrapEntry)}); }
catch (error) { bootstrapRefusal = String(error?.message ?? error); }
let csrfCreated = false;
let lateRefusal = '';
try {
  const api = await import(${JSON.stringify(betterAuthRootEntry)});
  api.betterAuthCsrfFromEnvironment({ field: 'csrf' });
  csrfCreated = true;
} catch (error) {
  lateRefusal = String(error?.message ?? error);
}
process.stdout.write(JSON.stringify({
  bootstrapRefusal,
  csrfCreated,
  lateRefusal,
  preloadRefusal,
  secretCaptured: captures.some((value) => value.includes(secret)),
}));
`;
  return spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      '--input-type=module',
      '--eval',
      source,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, BETTER_AUTH_SECRET: secret, NODE_ENV: 'development' },
    },
  );
}

function runPackedPostgresBoundaryChild(distRoot: string, betterAuthEntry: string) {
  const entries = {
    'drizzle-orm/pg-core': pathToFileURL(requireFromServerTest.resolve('drizzle-orm/pg-core')).href,
    '@kovojs/server': pathToFileURL(join(distRoot, 'index.mjs')).href,
    '@kovojs/server/internal/csrf': pathToFileURL(join(distRoot, 'internal/csrf.mjs')).href,
    '@kovojs/server/internal/keyring': pathToFileURL(join(distRoot, 'internal/keyring.mjs')).href,
    '@kovojs/server/internal/postgres-capability': pathToFileURL(
      join(distRoot, 'internal/postgres-capability.mjs'),
    ).href,
    '@kovojs/server/internal/runtime-environment': pathToFileURL(
      join(distRoot, 'internal/runtime-environment.mjs'),
    ).href,
  };
  const bootstrapEntry = pathToFileURL(join(distRoot, 'runtime-bootstrap.mjs')).href;
  const betterAuthUrl = pathToFileURL(betterAuthEntry).href;
  const source = `
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
registerHooks({
  resolve(specifier, context, nextResolve) {
    const mapped = ${JSON.stringify(entries)}[specifier];
    if (mapped) return nextResolve(mapped, context);
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});
await import(${JSON.stringify(bootstrapEntry)});
const server = await import(${JSON.stringify(entries['@kovojs/server'])});
const betterAuth = await import(${JSON.stringify(betterAuthUrl)});
const { pgTable, text } = await import('drizzle-orm/pg-core');
const proof = pgTable('kovo_packed_postgres_capability_proof', {
  id: text('id').primaryKey(),
});
const dataDir = mkdtempSync(join(tmpdir(), 'kovo-packed-postgres-capability-'));
const runtime = server.createPostgresAppRuntimeDb({ dataDir, driver: 'pglite', schema: { proof } });
const bindingOptions = (systemDb) => ({
  baseURL: 'http://localhost:5173',
  csrf: { field: 'csrf', secret: 'packed-csrf-secret-0123456789abcdef', sessionId: () => undefined },
  mapSession: ({ session, user }) => ({ id: session.id, user: { id: user.id } }),
  schema: { proof },
  secret: betterAuth.betterAuthPostgresSecret('packed-auth-secret-0123456789abcdef'),
  signInAccess: server.publicAccess('packed Better Auth sign-in proof'),
  signOutAccess: server.publicAccess('packed Better Auth sign-out proof'),
  systemDb,
});
try {
  await runtime.ready;
  const bindings = betterAuth.createBetterAuthPostgresBindings(bindingOptions(runtime.systemDb({
    operation: 'write',
    reason: 'Packed Better Auth adapter construction proof',
    surface: 'runtime-bootstrap.test#packed-postgres-auth',
  })));
  let forgedRejected = false;
  try {
    betterAuth.createBetterAuthPostgresBindings(bindingOptions({}));
  } catch (error) {
    forgedRejected = String(error?.message ?? error).includes('KV414');
  }
  process.stdout.write(JSON.stringify({
    bindingKeys: Object.keys(bindings).sort(),
    bindingsFrozen: Object.isFrozen(bindings),
    forgedRejected,
    providerOwnKeys: Reflect.ownKeys(runtime.db).length,
  }));
} finally {
  await runtime.close();
  rmSync(dataDir, { force: true, recursive: true });
}
`;
  return spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      '--input-type=module',
      '--eval',
      source,
    ],
    { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'development' } },
  );
}
