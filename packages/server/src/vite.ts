import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VersionedClientModuleInput } from './client-modules.js';
import { createRequestHandler, type JisoApp, type RequestHandler } from './app.js';
import type { PageHintOptions } from './hints.js';
import { toNodeHandler } from './node.js';

export interface JisoAppShellVitePlugin {
  configureServer(server: JisoAppShellViteDevServer): void;
  name: 'jiso-app-shell';
}

export interface JisoAppShellViteDevServer {
  middlewares: {
    use(handler: JisoAppShellViteMiddleware): void;
  };
}

export type JisoAppShellViteMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

export type JisoAppShellViteInput = JisoApp | RequestHandler;

export interface JisoAppShellViteManifestChunk {
  css?: readonly string[];
  file?: string;
  imports?: readonly string[];
  isEntry?: boolean;
  src?: string;
}

export type JisoAppShellViteManifest = Record<string, JisoAppShellViteManifestChunk>;

export interface JisoAppShellViteManifestHintOptions {
  base?: string;
}

export interface JisoAppShellRouteBuildEntry {
  entries: readonly string[];
  routePath: string;
}

export interface JisoAppShellCompiledClientModule extends Omit<
  VersionedClientModuleInput,
  'version'
> {
  version?: string;
}

export interface JisoAppShellBuildOptions {
  app: JisoApp;
  base?: string;
  clientModules?: readonly JisoAppShellCompiledClientModule[];
  manifest?: JisoAppShellViteManifest;
  routeEntries?: readonly JisoAppShellRouteBuildEntry[];
}

export interface JisoAppShellBuiltClientModule {
  contentType?: string;
  file: string;
  href: string;
  path: string;
  source: string;
  version: string;
}

export interface JisoAppShellBuildAsset {
  file: string;
  href: string;
  path: string;
}

export interface JisoAppShellRouteBuildHints {
  hints: PageHintOptions;
  routePath: string;
}

export interface JisoAppShellBuild {
  app: JisoApp;
  assets: readonly JisoAppShellBuildAsset[];
  clientModules: readonly JisoAppShellBuiltClientModule[];
  routeHints: readonly JisoAppShellRouteBuildHints[];
}

export function jisoAppShellVitePlugin(input: JisoAppShellViteInput): JisoAppShellVitePlugin {
  const requestHandler = typeof input === 'function' ? input : createRequestHandler(input);
  const nodeHandler = toNodeHandler(requestHandler);

  return {
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        Promise.resolve(nodeHandler(request, response)).catch(next);
      });
    },
    name: 'jiso-app-shell',
  };
}

export function jisoAppShellViteManifestHints(
  manifest: JisoAppShellViteManifest,
  entries: readonly string[],
  options: JisoAppShellViteManifestHintOptions = {},
): PageHintOptions {
  const modulepreloads: string[] = [];
  const stylesheets: string[] = [];
  const visited = new Set<string>();

  for (const entry of entries) {
    collectManifestHints(manifest, entry, options, visited, modulepreloads, stylesheets);
  }

  const hints: PageHintOptions = {};
  if (modulepreloads.length > 0) hints.modulepreloads = modulepreloads;
  if (stylesheets.length > 0) hints.stylesheets = stylesheets;
  return hints;
}

export function createJisoAppShellBuild(options: JisoAppShellBuildOptions): JisoAppShellBuild {
  const manifestOptions = viteManifestOptions(options.base);
  const routeHints = buildRouteHints(options.manifest, options.routeEntries, manifestOptions);
  const app =
    routeHints.length === 0
      ? options.app
      : {
          ...options.app,
          routes: options.app.routes.map((route) => {
            const built = routeHints.find((entry) => entry.routePath === route.path);
            return built ? { ...route, ...mergePageHints(route, built.hints) } : route;
          }),
        };
  const clientModules = registerCompiledClientModules(options.app, options.clientModules ?? []);
  const assets = options.manifest
    ? jisoAppShellViteManifestAssets(options.manifest, manifestOptions)
    : [];

  return { app, assets, clientModules, routeHints };
}

export function jisoAppShellViteManifestAssets(
  manifest: JisoAppShellViteManifest,
  options: JisoAppShellViteManifestHintOptions = {},
): JisoAppShellBuildAsset[] {
  const assets = new Map<string, JisoAppShellBuildAsset>();

  for (const chunk of Object.values(manifest)) {
    addManifestBuildAsset(assets, chunk.file, options);
    for (const stylesheet of chunk.css ?? []) addManifestBuildAsset(assets, stylesheet, options);
  }

  return [...assets.values()].sort((left, right) => left.file.localeCompare(right.file));
}

function buildRouteHints(
  manifest: JisoAppShellViteManifest | undefined,
  routeEntries: readonly JisoAppShellRouteBuildEntry[] | undefined,
  options: JisoAppShellViteManifestHintOptions,
): JisoAppShellRouteBuildHints[] {
  if (!manifest || !routeEntries || routeEntries.length === 0) return [];

  return routeEntries.map((entry) => ({
    hints: jisoAppShellViteManifestHints(manifest, entry.entries, options),
    routePath: entry.routePath,
  }));
}

function registerCompiledClientModules(
  app: JisoApp,
  modules: readonly JisoAppShellCompiledClientModule[],
): JisoAppShellBuiltClientModule[] {
  return modules.map((module) => {
    // SPEC §6.6: production client module URLs are immutable and versioned.
    const version = module.version ?? sourceVersion(module.source);
    const href = app.clientModules.put({
      ...module,
      version,
    });
    const url = new URL(href, 'https://jiso.local');

    const built: JisoAppShellBuiltClientModule = {
      file: normalizedDistFile(url.pathname),
      href,
      path: url.pathname,
      source: module.source,
      version,
    };
    if (module.contentType !== undefined) return { ...built, contentType: module.contentType };

    return built;
  });
}

function viteManifestOptions(base: string | undefined): JisoAppShellViteManifestHintOptions {
  return base === undefined ? {} : { base };
}

function addManifestBuildAsset(
  assets: Map<string, JisoAppShellBuildAsset>,
  file: string | undefined,
  options: JisoAppShellViteManifestHintOptions,
): void {
  if (!file || isExternalAssetHref(file)) return;

  const normalizedFile = normalizedDistFile(file);
  if (assets.has(normalizedFile)) return;

  const href = manifestAssetHref(normalizedFile, options.base);
  const url = new URL(href, 'https://jiso.local');

  assets.set(normalizedFile, {
    file: normalizedFile,
    href,
    path: url.pathname,
  });
}

function collectManifestHints(
  manifest: JisoAppShellViteManifest,
  entry: string,
  options: JisoAppShellViteManifestHintOptions,
  visited: Set<string>,
  modulepreloads: string[],
  stylesheets: string[],
): void {
  const resolved = resolveManifestChunk(manifest, entry);
  if (!resolved || visited.has(resolved.key)) return;
  visited.add(resolved.key);

  const chunk = resolved.chunk;
  if (chunk.file) addUnique(modulepreloads, manifestAssetHref(chunk.file, options.base));
  for (const stylesheet of chunk.css ?? []) {
    addUnique(stylesheets, manifestAssetHref(stylesheet, options.base));
  }
  for (const imported of chunk.imports ?? []) {
    collectManifestHints(manifest, imported, options, visited, modulepreloads, stylesheets);
  }
}

function resolveManifestChunk(
  manifest: JisoAppShellViteManifest,
  entry: string,
): { chunk: JisoAppShellViteManifestChunk; key: string } | undefined {
  const direct = manifest[entry];
  if (direct) return { chunk: direct, key: entry };

  for (const [key, chunk] of Object.entries(manifest)) {
    if (chunk.src === entry || chunk.file === entry) return { chunk, key };
  }

  return undefined;
}

function manifestAssetHref(file: string, base = '/'): string {
  if (isExternalAssetHref(file)) {
    return file;
  }

  return `${base.replace(/\/?$/, '/')}${file.replace(/^\/+/, '')}`;
}

function isExternalAssetHref(file: string): boolean {
  return file.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(file);
}

function normalizedDistFile(file: string): string {
  const pathname = file.replace(/[?#].*$/, '').replace(/^\/+/, '');
  const segments = pathname.split('/');

  if (segments.length === 0 || segments.some((segment) => !isSafeDistFileSegment(segment))) {
    throw new Error(`App shell build asset must stay within the Vite output directory: ${file}`);
  }

  return segments.join('/');
}

function isSafeDistFileSegment(segment: string): boolean {
  if (!segment) return false;

  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return false;
  }

  return decoded !== '.' && decoded !== '..' && !decoded.includes('/') && !decoded.includes('\\');
}

function mergePageHints(base: PageHintOptions, extra: PageHintOptions): PageHintOptions {
  const merged: PageHintOptions = { ...base };
  const modulepreloads = [...(base.modulepreloads ?? []), ...(extra.modulepreloads ?? [])];
  const stylesheets = [...(base.stylesheets ?? []), ...(extra.stylesheets ?? [])];

  if (modulepreloads.length > 0) merged.modulepreloads = modulepreloads;
  if (stylesheets.length > 0) merged.stylesheets = stylesheets;

  if (extra.bootstrapScript !== undefined) merged.bootstrapScript = extra.bootstrapScript;
  if (extra.i18n !== undefined) merged.i18n = extra.i18n;
  if (extra.meta !== undefined) merged.meta = extra.meta;
  if (extra.prefetch !== undefined) merged.prefetch = extra.prefetch;
  if (extra.prerenderUrls !== undefined) merged.prerenderUrls = extra.prerenderUrls;

  return merged;
}

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function sourceVersion(source: string): string {
  return createHash('sha256').update(source).digest('hex').slice(0, 12);
}
