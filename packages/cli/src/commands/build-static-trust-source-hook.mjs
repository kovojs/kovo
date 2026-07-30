import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

// Workspace-only source loader for the isolated static-trust child. Published CLIs execute the
// bundled worker and do not preload this hook. Keeping the authority in its own exact-digest owner
// lets the worker use a static import of the diagnostic-bearing build module.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const sourceUrl = new URL(specifier.replace(/\.js$/u, '.ts'), context.parentURL);
      if (existsSync(sourceUrl)) return nextResolve(sourceUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});
