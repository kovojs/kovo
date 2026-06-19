import { fileURLToPath } from 'node:url';

import { createKovoVitePlugin } from './vite.ts';
import type {
  KovoViteDevServer,
  KovoVitePlugin,
  KovoVitePluginOptions,
  KovoViteHotUpdateContext,
} from './vite.ts';

const compileModuleId = fileURLToPath(new URL('./compile.ts', import.meta.url));

/**
 * Config-safe Kovo Vite plugin entry. It keeps compiler internals out of Vite config startup and
 * asks Vite's module runner to load the TS compiler graph when component transforms actually run.
 */
export function kovoVitePlugin(options: KovoVitePluginOptions = {}): KovoVitePlugin {
  let loadModule: KovoViteDevServer['ssrLoadModule'] | undefined;

  const plugin = createKovoVitePlugin(async (compileOptions) => {
    if (!loadModule) {
      throw new Error(
        'kovoVitePlugin() requires Vite dev/test module loading before transforming components.',
      );
    }

    const compiler = await loadModule(compileModuleId);
    if (typeof compiler.compileComponentModule !== 'function') {
      throw new Error('Kovo compiler module must export compileComponentModule.');
    }

    return compiler.compileComponentModule(compileOptions) as ReturnType<
      NonNullable<Parameters<typeof createKovoVitePlugin>[0]>
    >;
  }, options);

  return {
    ...plugin,
    configureServer(server) {
      loadModule = server.ssrLoadModule?.bind(server);
      return plugin.configureServer?.(server);
    },
    async handleHotUpdate(context: KovoViteHotUpdateContext) {
      loadModule = context.server.ssrLoadModule?.bind(context.server) ?? loadModule;
      return plugin.handleHotUpdate?.(context) ?? [];
    },
  };
}
