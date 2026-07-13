import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

import type { KovoVitePlugin, KovoVitePluginOptions } from './vite.ts';

// Workspace-only source loader. Published packages point at built .mjs files and never need this
// resolver. The repository test config imports this loader before evaluating fixture/app modules so
// its dynamic edge cannot be influenced by authored code (SPEC §2 / §5.2).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
    }

    return nextResolve(specifier, context);
  },
});

const sourceEntryUrl = new URL('./vite-config.ts', import.meta.url).href;
const sourceEntry = await import(sourceEntryUrl);

/** @internal Workspace source-mode adapter; production consumers use `@kovojs/compiler/vite`. */
export function kovoVitePlugin(options: KovoVitePluginOptions = {}): KovoVitePlugin {
  return sourceEntry.kovoVitePlugin(options);
}
