import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

import { createFrameworkKovoVitePlugin } from './vite.ts';
import type { KovoVitePlugin, KovoVitePluginOptions } from './vite.ts';

const compileModuleUrl = new URL(
  import.meta.url.endsWith('/dist/vite-config.mjs') ? './compile.mjs' : './compile.ts',
  import.meta.url,
).href;
const compilerInternalModuleUrl = new URL(
  import.meta.url.endsWith('/dist/vite-config.mjs') ? './internal.mjs' : './internal.ts',
  import.meta.url,
).href;
type ConfigViteCompile = Parameters<typeof createFrameworkKovoVitePlugin>[0];
type ConfigViteCompileOptions = Parameters<ConfigViteCompile>[0];
type ConfigViteCompileResult = Awaited<ReturnType<ConfigViteCompile>>;
let sourceResolutionHooksRegistered = false;

/**
 * Config-safe Kovo Vite plugin entry. It keeps compiler internals out of Vite config startup and
 * loads the TS compiler graph lazily when component transforms actually run.
 */
export function kovoVitePlugin(options: KovoVitePluginOptions = {}): KovoVitePlugin {
  const plugin = createFrameworkKovoVitePlugin(
    (compileOptions) => compileWithCacheAuthority(compileOptions),
    (compileOptions) => compileWithoutCacheAuthority(compileOptions),
    options,
  );

  return plugin;
}

async function compileWithCacheAuthority(
  compileOptions: ConfigViteCompileOptions,
): Promise<ConfigViteCompileResult> {
  return loadCompilerFunction(
    compilerInternalModuleUrl,
    'compileComponentModuleCached',
    compileOptions,
  );
}

async function compileWithoutCacheAuthority(
  compileOptions: ConfigViteCompileOptions,
): Promise<ConfigViteCompileResult> {
  return loadCompilerFunction(compileModuleUrl, 'compileComponentModule', compileOptions);
}

async function loadCompilerFunction(
  moduleUrl: string,
  name: 'compileComponentModule' | 'compileComponentModuleCached',
  compileOptions: ConfigViteCompileOptions,
): Promise<ConfigViteCompileResult> {
  registerSourceResolutionHooks();
  const compiler = await import(moduleUrl);
  const compile = compiler[name];
  if (typeof compile !== 'function') {
    throw new Error(`Kovo compiler module must export ${name}.`);
  }
  return compile(compileOptions) as ConfigViteCompileResult;
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
