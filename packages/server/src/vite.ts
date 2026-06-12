import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnosticDefinitions } from '@jiso/core';
import type { VersionedClientModuleInput } from './client-modules.js';
import { createRequestHandler, type JisoApp, type RequestHandler } from './app.js';
import { renderDiagnosticDocument, type DiagnosticDocumentDiagnostic } from './document.js';
import type { PageHintOptions } from './hints.js';
import { toNodeHandler, writeWebResponseToNode } from './node.js';
import { readHeader, routeResponseToWebResponse, type RoutePageResponse } from './response.js';
import { matchShellDispatch } from './shell.js';
import {
  exportStaticApp,
  type StaticExportAssetInput,
  type StaticExportOptions,
  type StaticExportResult,
} from './static-export.js';
import { renderFragmentWireHtml } from './wire-html.js';

export interface JisoAppShellVitePlugin {
  configureServer(server: JisoAppShellViteDevServer): void;
  name: 'jiso-app-shell';
  writeBundle?(
    options: JisoAppShellViteOutputOptions,
    bundle: JisoAppShellViteOutputBundle,
  ): Promise<void>;
}

export interface JisoAppShellViteDevServer {
  middlewares: {
    use(handler: JisoAppShellViteMiddleware): void;
  };
}

export interface JisoAppShellViteSsrDevServer extends JisoAppShellViteDevServer {
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

export type JisoAppShellViteMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

export type JisoAppShellViteInput = JisoApp | RequestHandler;

export interface JisoAppShellVitePluginOptions {
  build?: JisoAppShellVitePluginBuildOptions;
  devDiagnostics?: JisoAppShellDevDiagnosticLedger;
}

export interface JisoAppShellViteSsrDevPlugin {
  configureServer(server: JisoAppShellViteSsrDevServer): void | (() => void);
  name: string;
}

export interface JisoAppShellViteSsrDevPluginOptions {
  appExportName?: string;
  moduleId?: string;
  name?: string;
  nodeHandlerExportName?: string;
  order?: 'pre' | 'post';
  shouldHandleRequest?: (request: IncomingMessage, app: JisoApp) => boolean;
}

export interface JisoAppShellDevModuleDiagnostics {
  diagnostics: readonly DiagnosticDocumentDiagnostic[];
  fileName: string;
  moduleHrefs?: readonly string[];
  source?: string;
}

export interface JisoAppShellDevDiagnosticRecord {
  diagnostics: readonly DiagnosticDocumentDiagnostic[];
  fileName: string;
  moduleHrefs?: readonly string[];
  source?: string;
}

export interface JisoAppShellDevDiagnosticLedger {
  diagnosticsForModuleHref(href: string): JisoAppShellDevDiagnosticRecord | undefined;
  recordModuleDiagnostics(record: JisoAppShellDevModuleDiagnostics): void;
}

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

export interface JisoAppShellViteOutputAsset {
  fileName: string;
  source: string | Uint8Array;
  type: 'asset';
}

export interface JisoAppShellViteOutputChunk {
  fileName: string;
  type: 'chunk';
}

export type JisoAppShellViteOutputBundle = Readonly<
  Record<string, JisoAppShellViteOutputAsset | JisoAppShellViteOutputChunk>
>;

export interface JisoAppShellViteOutputOptions {
  dir?: string;
  file?: string;
}

export interface JisoAppShellRouteBuildEntry {
  entries: readonly string[];
  routePath: string;
}

export type JisoAppShellRouteEntryMap = Readonly<Record<string, string | readonly string[]>>;

export interface JisoAppShellViteRouteEntryOptions {
  manifest?: JisoAppShellViteManifest;
  routes?: readonly { path: string }[];
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

export interface JisoAppShellViteBuildOptions extends Omit<
  JisoAppShellBuildOptions,
  'routeEntries'
> {
  routeEntries?: never;
  routeEntryMap?: JisoAppShellRouteEntryMap;
}

export interface JisoAppShellViteBundleBuildOptions extends Omit<
  JisoAppShellViteBuildOptions,
  'manifest'
> {
  bundle: JisoAppShellViteOutputBundle;
  manifest?: never;
}

export interface JisoAppShellVitePluginBuildOptions extends Omit<
  JisoAppShellViteBundleBuildOptions,
  'app' | 'bundle' | 'manifest'
> {
  onBuild?(build: JisoAppShellBuild, output: JisoAppShellViteBuildOutput): void | Promise<void>;
  outDir?: string | URL;
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

export interface JisoAppShellViteStaticExportAssetOptions {
  distDir: string | URL;
}

export interface JisoAppShellViteBuildOutputOptions {
  outDir: string | URL;
}

export interface JisoAppShellViteBuildOutput {
  clientModules: readonly JisoAppShellBuiltClientModule[];
  staticExportAssets: readonly StaticExportAssetInput[];
}

export interface JisoAppShellViteBuildStaticExportOptions extends Omit<
  StaticExportOptions,
  'assets'
> {
  assets?: readonly StaticExportAssetInput[];
  distDir: string | URL;
}

export function createJisoAppShellDevDiagnosticLedger(): JisoAppShellDevDiagnosticLedger {
  const moduleRecords = new Map<string, JisoAppShellDevDiagnosticRecord>();
  const hrefToFileName = new Map<string, string>();

  return {
    diagnosticsForModuleHref(href) {
      const fileName = hrefToFileName.get(normalizedModuleHref(href));
      return fileName === undefined ? undefined : moduleRecords.get(fileName);
    },
    recordModuleDiagnostics(record) {
      const fileName = slashPath(record.fileName);
      clearModuleRecord(fileName, moduleRecords, hrefToFileName);

      if (!record.diagnostics.some(isErrorDiagnostic)) return;

      const nextRecord: JisoAppShellDevDiagnosticRecord = {
        diagnostics: record.diagnostics,
        fileName,
        ...(record.moduleHrefs === undefined ? {} : { moduleHrefs: record.moduleHrefs }),
        ...(record.source === undefined ? {} : { source: record.source }),
      };
      moduleRecords.set(fileName, nextRecord);

      for (const href of moduleDiagnosticHrefs(nextRecord)) {
        hrefToFileName.set(normalizedModuleHref(href), fileName);
      }
    },
  };
}

export function jisoAppShellVitePlugin(
  input: JisoAppShellViteInput,
  options: JisoAppShellVitePluginOptions = {},
): JisoAppShellVitePlugin {
  const requestHandler = typeof input === 'function' ? input : createRequestHandler(input);
  const nodeHandler = toNodeHandler(requestHandler);
  const app = typeof input === 'function' ? undefined : input;

  return {
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const diagnosticResponse = app
          ? devDiagnosticResponse(app, request, options.devDiagnostics)
          : undefined;
        if (diagnosticResponse) {
          Promise.resolve(
            writeWebResponseToNode(
              routeResponseToWebResponse(diagnosticResponse, { method: request.method ?? 'GET' }),
              response,
              request.method ?? 'GET',
            ),
          ).catch(next);
          return;
        }

        Promise.resolve(nodeHandler(request, response)).catch(next);
      });
    },
    name: 'jiso-app-shell',
    ...(app && options.build
      ? {
          async writeBundle(outputOptions, bundle) {
            const build = createJisoAppShellViteBuildFromBundle({
              app,
              bundle,
              ...(options.build?.base === undefined ? {} : { base: options.build.base }),
              ...(options.build?.clientModules === undefined
                ? {}
                : { clientModules: options.build.clientModules }),
              ...(options.build?.routeEntryMap === undefined
                ? {}
                : { routeEntryMap: options.build.routeEntryMap }),
            });
            const output = await writeJisoAppShellViteBuildOutput(build, {
              outDir: options.build?.outDir ?? viteOutputDir(outputOptions),
            });
            await options.build?.onBuild?.(build, output);
          },
        }
      : {}),
  };
}

export function jisoAppShellViteSsrDevPlugin(
  options: JisoAppShellViteSsrDevPluginOptions = {},
): JisoAppShellViteSsrDevPlugin {
  const moduleId = options.moduleId ?? '/src/app-shell.ts';
  const appExportName = options.appExportName ?? 'default';
  const nodeHandlerExportName = options.nodeHandlerExportName ?? 'nodeHandler';

  const install = (server: JisoAppShellViteSsrDevServer) => {
    server.middlewares.use((request, response, next) => {
      Promise.resolve(server.ssrLoadModule(moduleId))
        .then((module) => {
          const app = readJisoAppShellViteSsrApp(module, appExportName, moduleId);
          const shouldHandle =
            options.shouldHandleRequest?.(request, app) ??
            shouldHandleJisoAppShellViteSsrRequest(request, app);
          if (!shouldHandle) {
            next();
            return;
          }

          return readJisoAppShellViteSsrNodeHandler(module, nodeHandlerExportName, moduleId)(
            request,
            response,
            next,
          );
        })
        .catch(next);
    });
  };

  return {
    configureServer(server) {
      if (options.order === 'post') return () => install(server);
      install(server);
    },
    name: options.name ?? 'jiso-app-shell-ssr-dev',
  };
}

export function shouldHandleJisoAppShellViteSsrRequest(
  request: IncomingMessage,
  app: JisoApp,
): boolean {
  if (!request.url) return false;

  const url = new URL(request.url, 'http://jiso.local');
  const match = matchShellDispatch({
    endpoints: app.endpoints,
    ...(request.method === undefined ? {} : { method: request.method }),
    pathname: url.pathname,
    routes: app.routes,
  });

  if (match.kind === 'not-found') return false;
  if (match.kind === 'route') return match.methodAllowed;

  return true;
}

function devDiagnosticResponse(
  app: JisoApp,
  request: IncomingMessage,
  diagnostics: JisoAppShellDevDiagnosticLedger | undefined,
): RoutePageResponse | undefined {
  if (!diagnostics) return undefined;

  const url = new URL(request.url ?? '/', 'http://jiso.local');
  const match = matchShellDispatch({
    endpoints: app.endpoints,
    ...(request.method === undefined ? {} : { method: request.method }),
    pathname: url.pathname,
    routes: app.routes,
  });
  if (match.kind === 'mutation') {
    const record = diagnostics.diagnosticsForModuleHref(url.pathname);
    if (!record) return undefined;

    const document = renderDiagnosticDocumentForRecord(record);
    if (readHeader(request.headers, 'FW-Fragment')?.toLowerCase() !== 'true') return document;

    return {
      body: renderFragmentWireHtml({
        html: document.body,
        target: firstMutationDiagnosticTarget(request.headers),
      }),
      headers: {
        'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
      },
      status: 500,
    };
  }

  if (match.kind !== 'route' || !match.methodAllowed) return undefined;

  for (const href of match.route.modulepreloads ?? []) {
    const record = diagnostics.diagnosticsForModuleHref(href);
    if (!record) continue;

    // SPEC §11.3: dev page requests depending on a failed module answer with
    // the same server-rendered teaching diagnostic document, never a local policy.
    return renderDiagnosticDocumentForRecord(record);
  }

  return undefined;
}

function renderDiagnosticDocumentForRecord(
  record: JisoAppShellDevDiagnosticRecord,
): RoutePageResponse & { body: string } {
  return renderDiagnosticDocument({
    diagnostics: record.diagnostics,
    ...(record.source === undefined
      ? {}
      : { source: { fileName: record.fileName, source: record.source } }),
  }) as RoutePageResponse & { body: string };
}

function firstMutationDiagnosticTarget(headers: IncomingMessage['headers']): string {
  return (
    (readHeader(headers, 'FW-Targets') ?? '')
      .split(/[;,]/)
      .map((target) => target.trim())
      .map((target) => target.split('=')[0]?.trim() ?? '')
      .find(Boolean) ?? 'error'
  );
}

function clearModuleRecord(
  fileName: string,
  moduleRecords: Map<string, JisoAppShellDevDiagnosticRecord>,
  hrefToFileName: Map<string, string>,
): void {
  const existing = moduleRecords.get(fileName);
  moduleRecords.delete(fileName);
  if (!existing) return;

  for (const href of moduleDiagnosticHrefs(existing)) {
    hrefToFileName.delete(normalizedModuleHref(href));
  }
}

function moduleDiagnosticHrefs(record: JisoAppShellDevDiagnosticRecord): string[] {
  return [
    ...new Set([...clientModuleHrefsForSourceFile(record.fileName), ...(record.moduleHrefs ?? [])]),
  ];
}

function clientModuleHrefsForSourceFile(fileName: string): string[] {
  const normalized = slashPath(fileName).replace(/^\/+/, '');
  const clientModule = normalized.replace(/\.[cm]?[jt]sx?$/, '.client.js');

  return clientModule === normalized ? [] : [`/c/${clientModule}`];
}

function normalizedModuleHref(href: string): string {
  const url = new URL(href, 'http://jiso.local');
  return slashPath(url.pathname);
}

function isErrorDiagnostic(diagnostic: DiagnosticDocumentDiagnostic): boolean {
  return diagnosticDefinitions[diagnostic.code].severity === 'error';
}

function readJisoAppShellViteSsrApp(
  module: Record<string, unknown>,
  exportName: string,
  moduleId: string,
): JisoApp {
  const app = module[exportName];
  if (isJisoApp(app)) return app;

  throw new Error(`${moduleId} must export ${exportName} as a Jiso app for Vite dev.`);
}

function readJisoAppShellViteSsrNodeHandler(
  module: Record<string, unknown>,
  exportName: string,
  moduleId: string,
): JisoAppShellViteMiddleware {
  const handler = module[exportName];
  if (typeof handler === 'function') return handler as JisoAppShellViteMiddleware;

  throw new Error(`${moduleId} must export ${exportName} as a Node app-shell handler.`);
}

function isJisoApp(value: unknown): value is JisoApp {
  return (
    isRecord(value) &&
    Array.isArray(value.endpoints) &&
    Array.isArray(value.mutations) &&
    Array.isArray(value.queries) &&
    Array.isArray(value.routes) &&
    isRecord(value.clientModules)
  );
}

function slashPath(fileName: string): string {
  return fileName.replaceAll('\\', '/');
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

export function jisoAppShellViteRouteEntries(
  routeEntryMap: JisoAppShellRouteEntryMap,
  options: JisoAppShellViteRouteEntryOptions = {},
): JisoAppShellRouteBuildEntry[] {
  const knownRoutes = options.routes
    ? new Set(options.routes.map((route) => route.path))
    : undefined;
  const mapped = new Map<string, string[]>();

  for (const [routePath, rawEntries] of Object.entries(routeEntryMap)) {
    if (!routePath.startsWith('/')) {
      throw new Error(`App shell route build entry must use an absolute route path: ${routePath}`);
    }
    if (knownRoutes && !knownRoutes.has(routePath)) {
      throw new Error(`App shell route build entry does not match an app route: ${routePath}`);
    }

    const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
    if (entries.length === 0) {
      throw new Error(
        `App shell route build entry must include at least one Vite entry: ${routePath}`,
      );
    }

    const normalizedEntries: string[] = [];
    for (const entry of entries) {
      const normalizedEntry = entry.trim();
      if (normalizedEntry.length === 0) {
        throw new Error(
          `App shell route build entry must include a non-empty Vite entry: ${routePath}`,
        );
      }
      if (options.manifest && !resolveManifestChunk(options.manifest, normalizedEntry)) {
        throw new Error(
          `App shell route build entry is missing from the Vite manifest: ${routePath} -> ${normalizedEntry}`,
        );
      }
      addUnique(normalizedEntries, normalizedEntry);
    }

    mapped.set(routePath, normalizedEntries);
  }

  if (options.routes) {
    const ordered: JisoAppShellRouteBuildEntry[] = [];
    const seenRoutePaths = new Set<string>();
    for (const route of options.routes) {
      if (seenRoutePaths.has(route.path)) continue;
      seenRoutePaths.add(route.path);

      const entries = mapped.get(route.path);
      if (entries) ordered.push({ entries, routePath: route.path });
    }
    return ordered;
  }

  return [...mapped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([routePath, entries]) => ({ entries, routePath }));
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

export function createJisoAppShellViteBuild(
  options: JisoAppShellViteBuildOptions,
): JisoAppShellBuild {
  const routeEntries =
    options.routeEntryMap === undefined
      ? undefined
      : jisoAppShellViteRouteEntries(options.routeEntryMap, {
          ...(options.manifest === undefined ? {} : { manifest: options.manifest }),
          routes: options.app.routes,
        });

  return createJisoAppShellBuild({
    app: options.app,
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.clientModules === undefined ? {} : { clientModules: options.clientModules }),
    ...(options.manifest === undefined ? {} : { manifest: options.manifest }),
    ...(routeEntries === undefined ? {} : { routeEntries }),
  });
}

export function createJisoAppShellViteBuildFromBundle(
  options: JisoAppShellViteBundleBuildOptions,
): JisoAppShellBuild {
  return createJisoAppShellViteBuild({
    app: options.app,
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.clientModules === undefined ? {} : { clientModules: options.clientModules }),
    manifest: jisoAppShellViteManifestFromBundle(options.bundle),
    ...(options.routeEntryMap === undefined ? {} : { routeEntryMap: options.routeEntryMap }),
  });
}

export function jisoAppShellViteStaticExportAssets(
  assets: readonly JisoAppShellBuildAsset[],
  options: JisoAppShellViteStaticExportAssetOptions,
): StaticExportAssetInput[] {
  return assets.map((asset) => {
    const contentType = viteAssetContentType(asset.file);

    return {
      ...(contentType === undefined ? {} : { contentType }),
      path: asset.path,
      source: viteDistSourcePath(options.distDir, asset.file),
    };
  });
}

export async function exportJisoAppShellViteBuild(
  build: JisoAppShellBuild,
  options: JisoAppShellViteBuildStaticExportOptions,
): Promise<StaticExportResult> {
  const { assets = [], distDir, ...exportOptions } = options;

  return exportStaticApp(build.app, {
    ...exportOptions,
    // SPEC §9.5: static export replays the built app shell, then copies the
    // immutable asset files referenced by the Vite manifest.
    assets: [...jisoAppShellViteStaticExportAssets(build.assets, { distDir }), ...assets],
  });
}

export async function writeJisoAppShellViteBuildOutput(
  build: Pick<JisoAppShellBuild, 'clientModules'> & Partial<Pick<JisoAppShellBuild, 'assets'>>,
  options: JisoAppShellViteBuildOutputOptions,
): Promise<JisoAppShellViteBuildOutput> {
  const root = resolvedFileSystemPath(options.outDir);

  for (const module of build.clientModules) {
    // SPEC §9.5: production app-shell builds publish immutable /c/ client modules
    // as files a static host can retain by versioned URL.
    const targetPath = viteDistSourcePath(root, module.file);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, module.source, 'utf8');
  }

  return {
    clientModules: build.clientModules,
    staticExportAssets: jisoAppShellViteStaticExportAssets(build.assets ?? [], { distDir: root }),
  };
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

export function jisoAppShellViteManifestFromBundle(
  bundle: JisoAppShellViteOutputBundle,
): JisoAppShellViteManifest {
  const manifestAsset = Object.values(bundle).find(
    (asset): asset is JisoAppShellViteOutputAsset =>
      asset.type === 'asset' && asset.fileName.replaceAll('\\', '/') === '.vite/manifest.json',
  );
  if (!manifestAsset) throw new Error('App shell Vite build requires .vite/manifest.json.');

  const source =
    typeof manifestAsset.source === 'string'
      ? manifestAsset.source
      : Buffer.from(manifestAsset.source).toString('utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `App shell Vite build manifest must be valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return jisoAppShellViteManifestFromUnknown(parsed);
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

function viteDistSourcePath(distDir: string | URL, file: string): string {
  const root = resolvedFileSystemPath(distDir);
  const targetPath = path.resolve(root, normalizedDistFile(file));
  if (targetPath === root || targetPath.startsWith(`${root}${path.sep}`)) return targetPath;

  throw new Error(`App shell build asset must stay within the Vite output directory: ${file}`);
}

function viteOutputDir(options: JisoAppShellViteOutputOptions): string {
  if (options.dir) return options.dir;
  if (options.file) return path.dirname(options.file);

  throw new Error('App shell Vite build output requires output.dir or output.file.');
}

function resolvedFileSystemPath(value: string | URL): string {
  return path.resolve(value instanceof URL ? fileURLToPath(value) : value);
}

function viteAssetContentType(file: string): string | undefined {
  const extension = path.extname(file).toLowerCase();

  switch (extension) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return undefined;
  }
}

function jisoAppShellViteManifestFromUnknown(value: unknown): JisoAppShellViteManifest {
  if (!isRecord(value)) {
    throw new Error('App shell Vite build manifest must be a JSON object.');
  }

  const manifest: JisoAppShellViteManifest = {};
  for (const [entry, rawChunk] of Object.entries(value)) {
    if (!isRecord(rawChunk)) {
      throw new Error(`App shell Vite build manifest entry '${entry}' must be a JSON object.`);
    }

    const chunk: JisoAppShellViteManifestChunk = {};
    const file = optionalManifestString(rawChunk, entry, 'file');
    const src = optionalManifestString(rawChunk, entry, 'src');
    const css = optionalManifestStringArray(rawChunk, entry, 'css');
    const imports = optionalManifestStringArray(rawChunk, entry, 'imports');
    const isEntry = optionalManifestBoolean(rawChunk, entry, 'isEntry');

    if (file !== undefined) chunk.file = file;
    if (src !== undefined) chunk.src = src;
    if (css !== undefined) chunk.css = css;
    if (imports !== undefined) chunk.imports = imports;
    if (isEntry !== undefined) chunk.isEntry = isEntry;
    manifest[entry] = chunk;
  }

  return manifest;
}

function optionalManifestString(
  chunk: Record<string, unknown>,
  entry: string,
  field: string,
): string | undefined {
  const value = chunk[field];
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;

  throw new Error(
    `App shell Vite build manifest entry '${entry}' field '${field}' must be a string.`,
  );
}

function optionalManifestStringArray(
  chunk: Record<string, unknown>,
  entry: string,
  field: string,
): readonly string[] | undefined {
  const value = chunk[field];
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;

  throw new Error(
    `App shell Vite build manifest entry '${entry}' field '${field}' must be an array of strings.`,
  );
}

function optionalManifestBoolean(
  chunk: Record<string, unknown>,
  entry: string,
  field: string,
): boolean | undefined {
  const value = chunk[field];
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;

  throw new Error(
    `App shell Vite build manifest entry '${entry}' field '${field}' must be a boolean.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
