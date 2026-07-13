import { createFrameworkKovoVitePlugin } from './vite.ts';
import type { KovoVitePlugin, KovoVitePluginOptions } from './vite.ts';

/**
 * Config-safe Kovo Vite plugin entry. The genuine compiler authority is a static dependency, so
 * the complete graph links before any authored sibling module can install resolver hooks. Runtime
 * transforms never redispatch through the module loader (SPEC.md §2 / §5.2).
 */
export function kovoVitePlugin(options: KovoVitePluginOptions = {}): KovoVitePlugin {
  const plugin = createFrameworkKovoVitePlugin(options);

  return plugin;
}
