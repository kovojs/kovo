import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import type { StylesheetAsset } from './hints.js';

/** Options for the public Kovo Vite plugin (SPEC.md §9.5). */
export interface KovoVitePluginOptions {
  /** Authored app module id to load in Vite dev; it must default-export a KovoApp. */
  app: string;
}

/** Minimal Vite dev-server surface used by the Kovo plugin adapter. */
interface KovoViteDevServer {
  config?: {
    root?: string;
  };
  /** Connect-compatible middleware stack owned by Vite. */
  middlewares: {
    use(handler: KovoViteMiddleware): void;
  };
  /** Load an SSR module through Vite's transform pipeline. */
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

/** Connect-compatible middleware installed by the Kovo Vite plugin. */
type KovoViteMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

/** Optional post-configuration hook returned by a Vite plugin. */
type KovoVitePostHook = () => void | Promise<void>;

/** Vite plugin object returned by {@link kovo}; placed in a `vite.config.ts` plugins array. */
export interface KovoVitePlugin {
  configResolved?(config: KovoViteResolvedConfig): void | Promise<void>;
  /** Stable plugin name used by Vite diagnostics. */
  name: 'kovo';
  resolveId?(source: string, importer?: string): null | Promise<null | string> | string;
  load?(id: string): null | Promise<null | string> | string;
  transform?(
    source: string,
    id: string,
  ): null | Promise<null | { code: string; map: null }> | { code: string; map: null };
  handleHotUpdate?(context: KovoViteHotUpdateContext): Promise<readonly unknown[]>;
}

interface KovoViteResolvedConfig {
  root?: string;
}

interface KovoViteHotUpdateContext {
  file: string;
  modules?: readonly unknown[];
  read(): Promise<string>;
  server: KovoViteDevServer;
}

interface KovoCompilerVitePlugin {
  configResolved?(config: KovoViteResolvedConfig): void | Promise<void>;
  configureServer?(server: KovoViteDevServer): void | Promise<void>;
  getCssAssetManifest?(options?: CssAssetManifestOptions): CssAssetManifest;
  handleHotUpdate?(context: KovoViteHotUpdateContext): Promise<readonly unknown[]>;
  load?(id: string): null | Promise<null | string> | string;
  resolveId?(source: string, importer?: string): null | Promise<null | string> | string;
  transform?(
    source: string,
    id: string,
  ): null | Promise<null | { code: string; map: null }> | { code: string; map: null };
}

interface KovoAppShellViteDevIntegration {
  onModuleDiagnostics(report: unknown): void;
  plugin: KovoAppShellDevPlugin;
}

interface KovoAppShellDevPlugin {
  configureServer(server: KovoViteDevServer): void | KovoVitePostHook;
  handleHotUpdate?(context: KovoViteHotUpdateContext): Promise<readonly unknown[]>;
}

interface CssAssetManifestOptions {
  split?: {
    routes: readonly CssRouteSplitTarget[];
  };
}

interface CssAssetManifest {
  chunks?: CssSplitChunks;
}

interface CssRouteSplitTarget {
  fragmentTargets?: readonly string[];
  route: string;
  sourceFileNames: readonly string[];
}

interface CssSplitChunk {
  criticalCss?: string;
  href: string;
}

interface CssSplitChunks {
  base: readonly CssSplitChunk[];
  fragments: Readonly<Record<string, readonly CssSplitChunk[]>>;
  routes: Readonly<Record<string, readonly CssSplitChunk[]>>;
}

/**
 * Public Vite integration for authored Kovo apps (SPEC.md §9.5). The app entry
 * must default-export a KovoApp; generated route artifacts stay compiler-owned.
 */
export function kovo(options: KovoVitePluginOptions): KovoVitePlugin {
  const app = authoredAppEntry(options.app);
  let root = process.cwd();
  let compilerPluginPromise: Promise<KovoCompilerVitePlugin> | undefined;
  let appShellPlugin: KovoAppShellDevPlugin | undefined;
  let onModuleDiagnostics: ((report: unknown) => void) | undefined;

  const compilerPlugin = () => {
    compilerPluginPromise ??= importKovoCompilerViteModule().then((module) => {
      if (typeof module.kovoVitePlugin !== 'function') {
        throw new Error('@kovojs/compiler/vite must export kovoVitePlugin.');
      }

      return module.kovoVitePlugin({
        onModuleDiagnostics(report: unknown) {
          onModuleDiagnostics?.(report);
        },
      }) as KovoCompilerVitePlugin;
    });

    return compilerPluginPromise;
  };

  const routeTargets = async () => {
    const module = await importKovoCompilerPackageStylesModule();
    if (typeof module.extractAppRouteCssTargets !== 'function') {
      throw new Error('@kovojs/compiler/package-styles must export extractAppRouteCssTargets.');
    }

    const fileName = appEntryFileName(app, root);
    const result = module.extractAppRouteCssTargets({
      fileName,
      packagePrefixDiscoveryRoot: root,
      source: existsSync(fileName) ? readFileSync(fileName, 'utf8') : '',
    });

    return rootRelativeRouteTargets(
      result.routeTargets as readonly CssRouteSplitTarget[],
      dirname(fileName),
      root,
    );
  };

  return {
    async configResolved(config) {
      root = config.root ?? root;
      const compiler = await compilerPlugin();
      await compiler.configResolved?.(config);
    },
    async configureServer(server: KovoViteDevServer) {
      root = server.config?.root ?? root;
      const compiler = await compilerPlugin();
      await compiler.configureServer?.(server);
      const appRouteTargets = await routeTargets();
      const serverModule = await server.ssrLoadModule('@kovojs/server/internal/app-shell-vite');
      const createDevIntegration = serverModule.createKovoAppShellViteDevIntegration;
      if (typeof createDevIntegration !== 'function') {
        throw new Error(
          '@kovojs/server/internal/app-shell-vite must export createKovoAppShellViteDevIntegration.',
        );
      }

      const integration = createDevIntegration({
        moduleId: app,
        stylesheetAssets: () =>
          stylesheetAssetsFromCssSplitChunks(
            compiler.getCssAssetManifest?.(
              appRouteTargets.length === 0 ? undefined : { split: { routes: appRouteTargets } },
            ).chunks,
          ),
      }) as KovoAppShellViteDevIntegration;

      onModuleDiagnostics =
        typeof integration.onModuleDiagnostics === 'function'
          ? integration.onModuleDiagnostics.bind(integration)
          : undefined;
      appShellPlugin = integration.plugin;

      return integration.plugin.configureServer(server);
    },
    async resolveId(source, importer) {
      return (await compilerPlugin()).resolveId?.(source, importer) ?? null;
    },
    async load(id) {
      return (await compilerPlugin()).load?.(id) ?? null;
    },
    async transform(source, id) {
      return (await compilerPlugin()).transform?.(source, id) ?? null;
    },
    async handleHotUpdate(context) {
      const appShellResult = await appShellPlugin?.handleHotUpdate?.(context);
      if (appShellResult !== undefined) return appShellResult;

      return (await compilerPlugin()).handleHotUpdate?.(context) ?? context.modules ?? [];
    },
    name: 'kovo',
  } as KovoVitePlugin;
}

function authoredAppEntry(app: string): string {
  if (typeof app !== 'string' || app.trim() === '') {
    throw new TypeError('kovo({ app }) requires an authored app entry module.');
  }
  const normalized = app.trim().split('?')[0]?.replaceAll('\\', '/') ?? '';
  if (normalized.includes('/generated/')) {
    throw new TypeError(
      'kovo({ app }) must point at an authored app entry, not an app-local generated artifact (SPEC.md §9.5).',
    );
  }
  return app.trim();
}

function appEntryFileName(app: string, root: string): string {
  const clean = app.split(/[?#]/, 1)[0] ?? app;
  if (isAbsolute(clean)) return resolve(root, clean.slice(1));
  return resolve(root, clean);
}

function rootRelativeRouteTargets(
  targets: readonly CssRouteSplitTarget[],
  appDir: string,
  root: string,
): readonly CssRouteSplitTarget[] {
  const prefix = slashPath(relative(root, appDir));
  if (!prefix || prefix.startsWith('..')) return targets;

  return targets.map((target) => ({
    ...target,
    sourceFileNames: target.sourceFileNames.map((fileName) => `${prefix}/${fileName}`),
  }));
}

function stylesheetAssetsFromCssSplitChunks(
  chunks: CssSplitChunks | undefined,
):
  | {
      app: readonly StylesheetAsset[];
      fragments: Readonly<Record<string, readonly StylesheetAsset[]>>;
      routes: Readonly<Record<string, readonly StylesheetAsset[]>>;
    }
  | undefined {
  if (!chunks) return undefined;

  return {
    app: stylesheetAssetsFromCssSplitChunkList(chunks.base),
    fragments: Object.fromEntries(
      Object.entries(chunks.fragments).map(([fragment, assets]) => [
        fragment,
        stylesheetAssetsFromCssSplitChunkList(assets),
      ]),
    ),
    routes: Object.fromEntries(
      Object.entries(chunks.routes).map(([route, assets]) => [
        route,
        stylesheetAssetsFromCssSplitChunkList(assets),
      ]),
    ),
  };
}

function stylesheetAssetsFromCssSplitChunkList(
  chunks: readonly CssSplitChunk[],
): readonly StylesheetAsset[] {
  return chunks.flatMap((chunk) =>
    chunk.criticalCss ? [{ criticalCss: chunk.criticalCss, href: chunk.href }] : [],
  );
}

function slashPath(value: string): string {
  return value.replaceAll('\\', '/');
}

async function importKovoCompilerViteModule(): Promise<Record<string, unknown>> {
  try {
    return await importOptionalModule('@kovojs/compiler/vite');
  } catch (error) {
    const workspaceSource = new URL('../../compiler/src/vite-config.ts', import.meta.url);
    if (existsSync(workspaceSource)) return await importOptionalModule(workspaceSource.href);
    throw missingCompilerError(error);
  }
}

async function importKovoCompilerPackageStylesModule(): Promise<Record<string, unknown>> {
  try {
    return await importOptionalModule('@kovojs/compiler/package-styles');
  } catch (error) {
    const workspaceSource = new URL('../../compiler/src/package-styles.ts', import.meta.url);
    if (existsSync(workspaceSource)) return await importOptionalModule(workspaceSource.href);
    throw missingCompilerError(error);
  }
}

async function importOptionalModule(specifier: string): Promise<Record<string, unknown>> {
  return (await import(specifier)) as Record<string, unknown>;
}

function missingCompilerError(cause: unknown): Error {
  return new Error(
    'kovo({ app }) requires @kovojs/compiler to be installed so Vite can lower components and collect route CSS.',
    { cause },
  );
}
