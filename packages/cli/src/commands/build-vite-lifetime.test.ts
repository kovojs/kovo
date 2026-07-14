import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createServer, type EnvironmentModuleGraph } from 'vite-plus';
import { describe, expect, it } from 'vitest';

import {
  captureBuildTimeViteServerLifetime,
  combineBuildTimeViteFailures,
} from './build-vite-lifetime.js';

interface OwnedEnvironmentModuleGraph extends EnvironmentModuleGraph {
  _hasResolveFailedErrorModules: Set<unknown>;
  _unresolvedUrlToModuleMap: Map<unknown, unknown>;
}

describe('build-time Vite lifetime', () => {
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
        const server = await createServer({
          appType: 'custom',
          configFile: false,
          logLevel: 'error',
          root,
          server: { hmr: false },
        });
        const lifetime = captureBuildTimeViteServerLifetime(server);
        const graphs = [
          server.environments.client.moduleGraph as OwnedEnvironmentModuleGraph,
          server.environments.ssr.moduleGraph as OwnedEnvironmentModuleGraph,
        ];

        await expect(server.ssrLoadModule('/src/app.ts')).resolves.toMatchObject({
          default: 'bounded',
        });
        expect(server.environments.ssr.moduleGraph.urlToModuleMap.size).toBeGreaterThan(0);

        await lifetime.close();

        for (const graph of graphs) {
          expect(graph.urlToModuleMap.size).toBe(0);
          expect(graph.idToModuleMap.size).toBe(0);
          expect(graph.etagToModuleMap.size).toBe(0);
          expect(graph.fileToModulesMap.size).toBe(0);
          expect(graph._unresolvedUrlToModuleMap.size).toBe(0);
          expect(graph._hasResolveFailedErrorModules.size).toBe(0);
        }
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails capture when a Vite Plus upgrade adds an unowned graph field', async () => {
    const server = await createServer({
      appType: 'custom',
      configFile: false,
      logLevel: 'error',
      root: process.cwd(),
      server: { hmr: false },
    });
    const graph = server.environments.ssr.moduleGraph as EnvironmentModuleGraph & {
      futureCache?: Map<unknown, unknown>;
    };
    graph.futureCache = new Map();

    try {
      expect(() => captureBuildTimeViteServerLifetime(server)).toThrow(
        /rejected changed Vite ssr module graph shape/,
      );
    } finally {
      delete graph.futureCache;
      await server.close();
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
