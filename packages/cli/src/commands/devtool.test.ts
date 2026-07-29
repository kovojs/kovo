import type { ViteDevServer } from 'vite-plus';
import { describe, expect, it, vi } from 'vitest';

import {
  inspectKovoDevDatabasePosture,
  type KovoDevtoolPluginOptions,
} from './devtool.js';

const OPTIONS = Object.freeze<KovoDevtoolPluginOptions>({
  appModuleId: 'app',
  appModulePath: '/workspace/src/app.tsx',
  appShellModuleId: 'app-shell',
  debug: false,
  securityProfileModuleId: 'profile',
  serverModuleId: 'server-root',
});

describe('inspectKovoDevDatabasePosture', () => {
  it('loads the app inside the generated live-target registry scope', async () => {
    const app = Object.freeze({ kind: 'test-app' });
    const loads: string[] = [];
    let liveTargetRegistryActive = false;
    const server = {
      ssrLoadModule: vi.fn(async (id: string) => {
        loads.push(id);
        if (id === OPTIONS.serverModuleId) {
          return { isKovoApp: (value: unknown) => value === app };
        }
        if (id === OPTIONS.appShellModuleId) {
          return {
            runWithGeneratedLiveTargetRegistry: async (load: () => Promise<unknown>) => {
              liveTargetRegistryActive = true;
              try {
                return await load();
              } finally {
                liveTargetRegistryActive = false;
              }
            },
          };
        }
        if (id === OPTIONS.appModuleId) {
          if (!liveTargetRegistryActive) {
            throw new Error('app loaded outside its generated live-target registry');
          }
          return { default: app };
        }
        if (id === OPTIONS.securityProfileModuleId) {
          return {
            kovoDevDatabasePosture: (value: unknown) =>
              value === app ? 'none configured' : '',
          };
        }
        throw new Error(`unexpected SSR module ${id}`);
      }),
    } satisfies Pick<ViteDevServer, 'ssrLoadModule'>;

    await expect(inspectKovoDevDatabasePosture(server, OPTIONS)).resolves.toBe(
      'none configured',
    );
    expect(loads).toEqual(['server-root', 'app-shell', 'app', 'profile']);
  });

  it('fails closed when the app-shell registry control is unavailable', async () => {
    const server = {
      ssrLoadModule: vi.fn(async (id: string) => {
        if (id === OPTIONS.serverModuleId) return { isKovoApp: () => true };
        if (id === OPTIONS.appShellModuleId) {
          return { runWithGeneratedLiveTargetRegistry: 'not callable' };
        }
        throw new Error(`unexpected SSR module ${id}`);
      }),
    } satisfies Pick<ViteDevServer, 'ssrLoadModule'>;

    await expect(inspectKovoDevDatabasePosture(server, OPTIONS)).rejects.toThrow(
      '@kovojs/server/internal/app-shell-vite must export runWithGeneratedLiveTargetRegistry.',
    );
    expect(server.ssrLoadModule).toHaveBeenCalledTimes(2);
  });
});
