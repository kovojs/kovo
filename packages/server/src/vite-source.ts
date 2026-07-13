import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

import type { KovoVitePlugin, KovoVitePluginOptions } from './vite.ts';
export type { KovoVitePlugin, KovoVitePluginOptions } from './vite.ts';

// Workspace-only source loader. Published packages point at the built vite.mjs entry and do not
// need this resolver. Keep the static graph limited to Node controls until the hook is installed:
// app Vite configs statically link @kovojs/server/vite before any sibling compiler adapter can run,
// while the source tree intentionally writes ESM-relative imports with their emitted .js suffixes.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const relativeJavaScript =
      specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL !== undefined;
    const absoluteJavaScript = specifier.startsWith('file:') && specifier.endsWith('.js');
    if (relativeJavaScript || absoluteJavaScript) {
      const typeScriptUrl = new URL(
        specifier.replace(/\.js$/u, '.ts'),
        context.parentURL ?? import.meta.url,
      );
      if (existsSync(typeScriptUrl)) return nextResolve(typeScriptUrl.href, context);
    }

    return nextResolve(specifier, context);
  },
});

const sourceEntryUrl = new URL('./vite.ts', import.meta.url).href;
const sourceEntry = await import(sourceEntryUrl);

/** Workspace source-mode adapter; production consumers use the published vite.mjs entry. */
export function kovo(options: KovoVitePluginOptions): KovoVitePlugin {
  return sourceEntry.kovo(options);
}
