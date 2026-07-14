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
  }, 30_000);

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
const arrayIteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]());
const mapIteratorPrototype = Object.getPrototypeOf(new Map().entries());
const matchAllIteratorPrototype = Object.getPrototypeOf('safe'.matchAll(/./g));
export const attempts = [
  Reflect.set(globalThis, 'Response', class AttackerResponse {}),
  Reflect.set(globalThis, 'fetch', async () => new Response('attacker')),
  Reflect.set(globalThis, 'setTimeout', () => 0),
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
];
function join(left, right) { return this.prefix + left + right; }
const formData = new FormData();
formData.append('field', 'form-safe');
export const behavior = {
  array: [...['array-safe']][0],
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
        attempts: [false, false, false, false, false, false, false, false, false, false],
        behavior: {
          array: 'array-safe',
          bound: 'bin',
          called: 'cal',
          formData: 'form-safe',
          map: 'map-safe',
          matchAll: 'match',
        },
        exact: [true, true, true],
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
