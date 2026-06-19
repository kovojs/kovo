import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

import { createKovoVitePlugin } from './vite.ts';
import type { KovoVitePlugin, KovoVitePluginOptions } from './vite.ts';

const compileModuleUrl = new URL('./compile.ts', import.meta.url).href;
let sourceResolutionHooksRegistered = false;

/**
 * Config-safe Kovo Vite plugin entry. It keeps compiler internals out of Vite config startup and
 * loads the TS compiler graph lazily when component transforms actually run.
 */
export function kovoVitePlugin(options: KovoVitePluginOptions = {}): KovoVitePlugin {
  const plugin = createKovoVitePlugin(async (compileOptions) => {
    registerSourceResolutionHooks();
    const compiler = await import(compileModuleUrl);
    if (typeof compiler.compileComponentModule !== 'function') {
      throw new Error('Kovo compiler module must export compileComponentModule.');
    }

    return compiler.compileComponentModule(compileOptions) as ReturnType<
      NonNullable<Parameters<typeof createKovoVitePlugin>[0]>
    >;
  }, options);

  return plugin;
}

function registerSourceResolutionHooks(): void {
  if (sourceResolutionHooksRegistered) return;
  sourceResolutionHooksRegistered = true;

  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
        const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
        if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
      }

      return nextResolve(specifier, context);
    },
  });
}
