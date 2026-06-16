// Vite plugin that compiles a fixture's authored Kovo components to their lowered
// IR (fixpoint) form — the same form `emit-components` commits and real apps import.
//
// The stock `kovoVitePlugin` emits the `renderSource()` server module (a zero-arg
// HTML string used for the render-equivalence gate), which drops the authored
// `export const Foo = component(...)`. Fixtures instead need the *lowered* module
// that preserves `component()` so a route page can call `Foo.definition.render(data)`
// with live query results (SPEC §5.2; commerce does exactly this with its
// src/generated/*.tsx artifacts).
import { compileComponentModule } from '@kovojs/compiler';
import type { Plugin } from 'vite';

export function kovoFixtureCompilerPlugin(): Plugin {
  let root = process.cwd();
  return {
    name: 'kovo-fixture-compiler',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
    },
    transform(source, id) {
      // Same claim rule as kovoVitePlugin: a `.tsx`/`.ts` module that declares a
      // Kovo component. (The plugin matches the component-call token as source
      // text, so non-component modules must keep it out of comments.)
      if (!/\.[cm]?tsx?$/.test(id) || !source.includes('component(')) return null;

      const fileName = fixtureComponentFileName(id, root);
      const result = compileComponentModule({
        fileName,
        packagePrefixDiscoveryRoot: root,
        source,
      });

      const errors = (result.diagnostics ?? []).filter(
        (diagnostic) => diagnostic.severity === 'error',
      );
      if (errors.length > 0) {
        throw new Error(
          `Kovo compile error in ${fileName}:\n${errors
            .map((diagnostic) => `  ${diagnostic.code}: ${diagnostic.message}`)
            .join('\n')}`,
        );
      }

      const code = result.loweredSource;
      if (typeof code !== 'string') return null;
      return { code, map: null };
    },
  };
}

function fixtureComponentFileName(id: string, root: string): string {
  const path = id.split('?')[0]!.replaceAll('\\', '/');
  const normalizedRoot = root.replaceAll('\\', '/').replace(/\/$/, '');
  return path.startsWith(`${normalizedRoot}/`) ? path.slice(normalizedRoot.length + 1) : path;
}
