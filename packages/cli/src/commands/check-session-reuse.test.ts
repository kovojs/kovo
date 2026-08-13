import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { KovoSourceCheckSessionFactCache } from './check-session-reuse.js';

const roots: string[] = [];
const repoRoot = process.cwd();
const digestOf = (seed: string): string => `sha256:${seed.repeat(64).slice(0, 64)}`;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('authenticated source-check producer facts', () => {
  it('stores only authenticated session strings, bounds entries, and destroys them on close', () => {
    const cache = new KovoSourceCheckSessionFactCache(true);
    expect(cache.consumeProducerFact('stylesheet', digestOf('a'))).toBeUndefined();
    cache.storeProducerFact('stylesheet', digestOf('a'), '{"passed":true}');
    expect(cache.consumeProducerFact('stylesheet', digestOf('a'))).toBe('{"passed":true}');
    expect(cache.consumeProducerFact('stylesheet', digestOf('b'))).toBeUndefined();

    for (let index = 0; index < 40; index += 1) {
      cache.storeProducerFact(
        'config-trust',
        `sha256:${index.toString(16).padStart(64, '0')}`,
        JSON.stringify({ index }),
      );
    }
    expect(cache.snapshot()).toMatchObject({
      closed: false,
      enabled: true,
      entries: 32,
      hits: 1,
      misses: 2,
      typescript: null,
    });
    expect(cache.snapshot().payloadBytes).toBeGreaterThan(0);
    cache.close();
    expect(cache.snapshot()).toMatchObject({
      closed: true,
      entries: 0,
      payloadBytes: 0,
      typescript: null,
    });
    expect(() => cache.consumeProducerFact('stylesheet', digestOf('a'))).toThrow(/closed/u);
  });

  it('keeps --no-cache sessions inert', () => {
    const cache = new KovoSourceCheckSessionFactCache(false);
    cache.storeProducerFact('stylesheet', digestOf('a'), '{"passed":true}');
    expect(cache.consumeProducerFact('stylesheet', digestOf('a'))).toBeUndefined();
    expect(cache.snapshot()).toMatchObject({ enabled: false, entries: 0, hits: 0, misses: 1 });
    cache.close();
  });
});

describe('in-memory TypeScript semantic preflight', () => {
  it('reuses a BuilderProgram without creating on-disk build info', async () => {
    const root = fixtureProject();
    const cache = new KovoSourceCheckSessionFactCache(true);
    const input = {
      appModulePath: join(root, 'src/app.ts'),
      invocationEnv: process.env,
      invocationRoot: root,
    };
    const first = await cache.runTypeScriptPreflight(input);
    expect(first).toMatchObject({ executed: true, reusedAuthenticated: false });
    expect(first?.inputDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(existsSync(join(root, '.kovo'))).toBe(false);

    writeFileSync(join(root, 'src/value.ts'), 'export const value: number = 2;\n', 'utf8');
    const second = await cache.runTypeScriptPreflight(input);
    expect(second).toMatchObject({ executed: true, reusedAuthenticated: true });
    expect(second?.inputDigest).not.toBe(first?.inputDigest);
    expect(cache.snapshot().typescript).toMatchObject({
      inputDigest: second?.inputDigest,
      programFiles: expect.any(Number),
      reusedFiles: expect.any(Number),
    });
    expect(cache.snapshot().typescript!.reusedFiles).toBeGreaterThan(0);
    expect(existsSync(join(root, '.kovo'))).toBe(false);
    cache.close();
  });

  it('fails back to the complete producer for direct and reverse-dependent diagnostics', async () => {
    const root = fixtureProject();
    const cache = new KovoSourceCheckSessionFactCache(true);
    const input = {
      appModulePath: join(root, 'src/app.ts'),
      invocationEnv: process.env,
      invocationRoot: root,
    };
    expect(await cache.runTypeScriptPreflight(input)).toMatchObject({ executed: true });

    // The changed leaf still parses and type-checks itself; only its reverse-dependent importer
    // violates the declared number contract. BuilderProgram affected-file analysis must surface it.
    writeFileSync(join(root, 'src/value.ts'), 'export const value = "text";\n', 'utf8');
    expect(await cache.runTypeScriptPreflight(input)).toBeUndefined();
    expect(existsSync(join(root, '.kovo'))).toBe(false);

    writeFileSync(join(root, 'src/value.ts'), 'export const value: number = 3;\n', 'utf8');
    expect(await cache.runTypeScriptPreflight(input)).toMatchObject({
      executed: true,
      reusedAuthenticated: true,
    });
    cache.close();
  });

  it('binds package bytes and compiler options into the semantic fact identity', async () => {
    const root = fixtureProject();
    const cache = new KovoSourceCheckSessionFactCache(true);
    const input = {
      appModulePath: join(root, 'src/app.ts'),
      invocationEnv: process.env,
      invocationRoot: root,
    };
    const first = await cache.runTypeScriptPreflight(input);
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', private: true, version: '0.0.2' }),
      'utf8',
    );
    const packageChanged = await cache.runTypeScriptPreflight(input);
    expect(packageChanged?.inputDigest).not.toBe(first?.inputDigest);

    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'esnext',
          moduleResolution: 'bundler',
          noUncheckedIndexedAccess: true,
          strict: true,
          target: 'es2022',
        },
        include: ['src'],
      }),
      'utf8',
    );
    const configChanged = await cache.runTypeScriptPreflight(input);
    expect(configChanged).toMatchObject({ executed: true, reusedAuthenticated: false });
    expect(configChanged?.inputDigest).not.toBe(packageChanged?.inputDigest);
    cache.close();
  });

  it('refreshes package export resolution before reusing semantic facts', async () => {
    const root = fixtureProject();
    const dependencyRoot = join(root, 'node_modules/example-dependency');
    mkdirSync(dependencyRoot, { recursive: true });
    writeFileSync(
      join(dependencyRoot, 'package.json'),
      JSON.stringify({
        exports: { '.': './number.d.ts' },
        name: 'example-dependency',
        type: 'module',
        version: '1.0.0',
      }),
      'utf8',
    );
    writeFileSync(join(dependencyRoot, 'number.d.ts'), 'export declare const value: number;\n');
    writeFileSync(join(dependencyRoot, 'string.d.ts'), 'export declare const value: string;\n');
    writeFileSync(
      join(root, 'src/app.ts'),
      "import { value } from 'example-dependency';\nexport const checked: number = value;\n",
      'utf8',
    );
    const cache = new KovoSourceCheckSessionFactCache(true);
    const input = {
      appModulePath: join(root, 'src/app.ts'),
      invocationEnv: process.env,
      invocationRoot: root,
    };
    expect(await cache.runTypeScriptPreflight(input)).toMatchObject({ executed: true });

    // Same importer bytes and same package version, but a new export target. Reusing TypeScript's
    // old module-resolution cache would miss the reverse-dependent number/string failure.
    writeFileSync(
      join(dependencyRoot, 'package.json'),
      JSON.stringify({
        exports: { '.': './string.d.ts' },
        name: 'example-dependency',
        type: 'module',
        version: '1.0.0',
      }),
      'utf8',
    );
    expect(await cache.runTypeScriptPreflight(input)).toBeUndefined();
    cache.close();
  });

  it('reports not-applicable without tsconfig', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-check-session-no-tsconfig-'));
    roots.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/app.ts'), 'export const value = 1;\n', 'utf8');
    const cache = new KovoSourceCheckSessionFactCache(true);
    expect(
      await cache.runTypeScriptPreflight({
        appModulePath: join(root, 'src/app.ts'),
        invocationEnv: process.env,
        invocationRoot: root,
      }),
    ).toEqual({ executed: false, inputDigest: null, reusedAuthenticated: false });
    cache.close();
  });
});

function fixtureProject(): string {
  const root = mkdtempSync(join(repoRoot, '.tmp-check-session-reuse-'));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(
    join(repoRoot, 'packages/cli/node_modules/typescript'),
    join(root, 'node_modules/typescript'),
  );
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, version: '0.0.1' }),
    'utf8',
  );
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n', 'utf8');
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'esnext',
        moduleResolution: 'bundler',
        strict: true,
        target: 'es2022',
      },
      include: ['src'],
    }),
    'utf8',
  );
  writeFileSync(
    join(root, 'src/app.ts'),
    "import { value } from './value.js';\nexport const checked: number = value;\n",
    'utf8',
  );
  writeFileSync(join(root, 'src/value.ts'), 'export const value: number = 1;\n', 'utf8');
  return root;
}
