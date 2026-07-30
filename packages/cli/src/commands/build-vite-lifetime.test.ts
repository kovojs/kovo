import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createRunnableDevEnvironment,
  resolveConfig,
  type EnvironmentModuleGraph,
} from 'vite-plus';
import { describe, expect, it } from 'vitest';

import {
  captureBuildTimeViteRunnableLifetime,
  combineBuildTimeViteFailures,
} from './build-vite-lifetime.js';

interface OwnedEnvironmentModuleGraph extends EnvironmentModuleGraph {
  _hasResolveFailedErrorModules: Set<unknown>;
  _unresolvedUrlToModuleMap: Map<unknown, unknown>;
}

describe('build-time Vite lifetime', () => {
  it('loads the framework profile and app through one transform-capable SSR runner', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-vite-runner-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, 'src/profile.ts'),
      `export const identity = {};\nexport const transformed = '__KOVO_RUNNER_TRANSFORM__';\n`,
      'utf8',
    );
    writeFileSync(
      join(root, 'src/app.ts'),
      `import { identity, transformed } from './profile.js';\nexport { identity, transformed };\n`,
      'utf8',
    );

    const config = await resolveConfig(
      {
        appType: 'custom',
        configFile: false,
        logLevel: 'error',
        plugins: [
          {
            name: 'kovo-runner-test-transform',
            transform(source, id) {
              if (!id.endsWith('/src/profile.ts')) return null;
              return source.replace('__KOVO_RUNNER_TRANSFORM__', 'transformed-by-plugin');
            },
          },
        ],
        root,
        server: { hmr: false },
        ssr: { noExternal: true },
      },
      'serve',
    );
    const environment = createRunnableDevEnvironment('ssr', config, {
      hot: false,
      runnerOptions: { hmr: false, sourcemapInterceptor: false },
    });
    await environment.init();
    const lifetime = captureBuildTimeViteRunnableLifetime(environment);
    const graph = environment.moduleGraph as OwnedEnvironmentModuleGraph;

    try {
      const profile = await lifetime.ssrLoadModule('/src/profile.ts');
      const app = await lifetime.ssrLoadModule('/src/app.ts');

      expect(app.identity).toBe(profile.identity);
      expect(app.transformed).toBe('transformed-by-plugin');
      expect(graph.urlToModuleMap.size).toBeGreaterThan(0);
      expect(lifetime.environment).toBe(environment);
    } finally {
      await lifetime.close();
      expect(graph.urlToModuleMap.size).toBe(0);
      expect(graph.idToModuleMap.size).toBe(0);
      expect(graph.etagToModuleMap.size).toBe(0);
      expect(graph.fileToModulesMap.size).toBe(0);
      expect(graph._unresolvedUrlToModuleMap.size).toBe(0);
      expect(graph._hasResolveFailedErrorModules.size).toBe(0);
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails closed if app evaluation replaces the captured runner import control', async () => {
    const config = await resolveConfig(
      {
        appType: 'custom',
        configFile: false,
        logLevel: 'error',
        root: process.cwd(),
        server: { hmr: false },
      },
      'serve',
    );
    const environment = createRunnableDevEnvironment('ssr', config, {
      hot: false,
      runnerOptions: { hmr: false, sourcemapInterceptor: false },
    });
    await environment.init();
    const lifetime = captureBuildTimeViteRunnableLifetime(environment);
    const runner = environment.runner;
    const ownImport = Object.getOwnPropertyDescriptor(runner, 'import');

    try {
      Object.defineProperty(runner, 'import', {
        configurable: true,
        value: async () => ({ forged: true }),
      });
      expect(() => lifetime.ssrLoadModule('/packages/core/src/index.ts')).toThrow(
        /runner import control changed/,
      );
    } finally {
      if (ownImport === undefined) Reflect.deleteProperty(runner, 'import');
      else Object.defineProperty(runner, 'import', ownImport);
      await lifetime.close();
    }
  });

  it('empties every command-owned graph collection across repeated SSR lifetimes', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-kovo-build-vite-lifetime-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/dependency.ts'), `export const value = 'bounded';\n`, 'utf8');
    writeFileSync(
      join(root, 'src/app.ts'),
      `import { value } from './dependency.js';\nexport default value;\n`,
      'utf8',
    );

    try {
      for (let iteration = 0; iteration < 3; iteration += 1) {
        const config = await resolveConfig(
          {
            appType: 'custom',
            configFile: false,
            logLevel: 'error',
            root,
            server: { hmr: false },
          },
          'serve',
        );
        const environment = createRunnableDevEnvironment('ssr', config, {
          hot: false,
          runnerOptions: { hmr: false, sourcemapInterceptor: false },
        });
        await environment.init();
        const lifetime = captureBuildTimeViteRunnableLifetime(environment);
        const graph = environment.moduleGraph as OwnedEnvironmentModuleGraph;

        await expect(lifetime.ssrLoadModule('/src/app.ts')).resolves.toMatchObject({
          default: 'bounded',
        });
        expect(graph.urlToModuleMap.size).toBeGreaterThan(0);

        await lifetime.close();

        expect(graph.urlToModuleMap.size).toBe(0);
        expect(graph.idToModuleMap.size).toBe(0);
        expect(graph.etagToModuleMap.size).toBe(0);
        expect(graph.fileToModulesMap.size).toBe(0);
        expect(graph._unresolvedUrlToModuleMap.size).toBe(0);
        expect(graph._hasResolveFailedErrorModules.size).toBe(0);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails capture when a Vite Plus upgrade adds an unowned graph field', async () => {
    const config = await resolveConfig(
      {
        appType: 'custom',
        configFile: false,
        logLevel: 'error',
        root: process.cwd(),
        server: { hmr: false },
      },
      'serve',
    );
    const environment = createRunnableDevEnvironment('ssr', config, {
      hot: false,
      runnerOptions: { hmr: false, sourcemapInterceptor: false },
    });
    await environment.init();
    const graph = environment.moduleGraph as EnvironmentModuleGraph & {
      futureCache?: Map<unknown, unknown>;
    };
    graph.futureCache = new Map();

    try {
      expect(() => captureBuildTimeViteRunnableLifetime(environment)).toThrow(
        /rejected changed Vite ssr module graph shape/,
      );
    } finally {
      delete graph.futureCache;
      await environment.close();
    }
  });

  it('preserves the primary diagnostic when teardown also fails', () => {
    const primary = new Error('KV418 primary security diagnostic');
    const teardown = new Error('Vite graph teardown failed');
    const combined = combineBuildTimeViteFailures(primary, teardown);

    expect(combined.message).toBe(primary.message);
    expect(combined.cause).toBe(primary);
    expect(combined.errors).toEqual([primary, teardown]);
  });
});
