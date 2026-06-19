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
import {
  CompileCache,
  compileComponentCacheKeyInput,
  type ComponentCssAsset,
  type CompileResult,
} from '@kovojs/compiler/internal';
import type { Plugin } from 'vite';

const virtualCssManifestId = 'virtual:kovo-fixture-css-manifest';
const resolvedVirtualCssManifestId = `\0${virtualCssManifestId}`;

interface FixtureCssAsset extends ComponentCssAsset {
  source: string;
}

export function kovoFixtureCompilerPlugin(
  compile: (options: Parameters<typeof compileComponentModule>[0]) => CompileResult =
    compileComponentModule,
): Plugin {
  let root = process.cwd();
  const cssAssets = new Map<string, FixtureCssAsset>();
  const compileCache = new CompileCache<CompileResult>();

  return {
    name: 'kovo-fixture-compiler',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = decodeURIComponent(
          new URL(req.url ?? '/', 'http://fixture.local').pathname,
        );
        const asset = cssAssets.get(pathname);
        if (!asset) {
          next();
          return;
        }

        res.writeHead(200, {
          'cache-control': 'public, max-age=31536000, immutable',
          'content-type': 'text/css; charset=utf-8',
        });
        res.end(asset.source);
      });
    },
    resolveId(id) {
      return id === virtualCssManifestId ? resolvedVirtualCssManifestId : null;
    },
    load(id) {
      if (id !== resolvedVirtualCssManifestId) return null;

      return `
const key = '__kovoFixtureCssAssets';
function assets() {
  return globalThis[key] ?? [];
}
function dedupe(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!value.href || seen.has(value.href)) continue;
    seen.add(value.href);
    out.push(value);
  }
  return out;
}
export function kovoFixtureStylesheetManifest() {
  return dedupe(assets());
}
export function kovoFixtureStylesheetsForTargets(targets) {
  if (!targets) return kovoFixtureStylesheetManifest();
  const wanted = new Set(targets);
  return dedupe(
    assets().filter((asset) => asset.fragmentTargets?.some((target) => wanted.has(target))),
  );
}
`;
    },
    async transform(source, id) {
      // Same claim rule as kovoVitePlugin: a `.tsx`/`.ts` module that declares a
      // Kovo component. (The plugin matches the component-call token as source
      // text, so non-component modules must keep it out of comments.)
      if (!/\.[cm]?tsx?$/.test(id) || !source.includes('component(')) return null;

      const fileName = fixtureComponentFileName(id, root);
      const compileOptions = {
        fileName,
        packagePrefixDiscoveryRoot: root,
        source,
      };
      const result = await compileCache.getOrCreate(
        compileComponentCacheKeyInput(compileOptions),
        () => compile(compileOptions),
      );

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

      for (const asset of result.cssAssets) {
        const cssFile = result.files.find(
          (file) => file.kind === 'css' && file.fileName === asset.sourceFileName,
        );
        cssAssets.set(asset.href, { ...asset, source: cssFile?.source ?? asset.criticalCss ?? '' });
      }

      const code = result.loweredSource;
      if (typeof code !== 'string') return null;
      return { code: `${code}\n${cssRuntimeRegistration(result.cssAssets)}`, map: null };
    },
  };
}

function fixtureComponentFileName(id: string, root: string): string {
  const path = id.split('?')[0]!.replaceAll('\\', '/');
  const normalizedRoot = root.replaceAll('\\', '/').replace(/\/$/, '');
  return path.startsWith(`${normalizedRoot}/`) ? path.slice(normalizedRoot.length + 1) : path;
}

function cssRuntimeRegistration(assets: readonly ComponentCssAsset[]): string {
  if (assets.length === 0) return '';

  const publicAssets = assets.map((asset) => {
    const publicAsset: Partial<ComponentCssAsset> = { ...asset };
    delete publicAsset.criticalCss;
    return publicAsset;
  });

  return `
{
  const key = '__kovoFixtureCssAssets';
  const list = globalThis[key] ?? (globalThis[key] = []);
  for (const asset of ${JSON.stringify(publicAssets)}) {
    if (!list.some((item) => item.href === asset.href)) list.push(asset);
  }
}`;
}
