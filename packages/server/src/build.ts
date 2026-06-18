import { copyFile, cp, mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import type { KovoApp } from './app-types.js';
import { resolvedFileSystemPath, viteDistSourcePath } from './vite-build-assets.js';
import {
  createKovoAppShellViteBuild,
  createKovoAppShellViteBuildFromManifestFile,
  type KovoAppShellBuiltClientModule,
  type KovoAppShellCompiledClientModule,
  type KovoAppShellRouteBuildHints,
} from './vite-build.js';
import { writeKovoAppShellViteBuildOutput } from './vite-build-output.js';
import type { KovoAppShellRouteEntryMap } from './vite-manifest.js';

const neutralBuildVersion = 'kovo-neutral-build/v1';

/** Build-time preset descriptor consumed by `kovo build` and deployment tooling. */
export interface KovoPreset {
  /** Emit platform-native output from an already-written neutral build. */
  emit?(build: KovoNeutralBuild, context: PresetContext): Promise<void> | void;
  /** Return target-specific diagnostics before output is emitted. */
  inspect?(build: KovoNeutralBuild): readonly PresetDiagnostic[];
  /** Stable preset name, such as `node`, `vercel`, or `cloudflare`. */
  name: string;
}

/** Context passed to a preset while it transforms the neutral build output. */
export interface PresetContext {
  /** Environment variables the app declares or the build inferred, such as `DATABASE_URL`. */
  declaredEnv: readonly string[];
  /** Build log sink supplied by the CLI or host integration. */
  log(message: string): void;
  /** Platform output directory for the preset. */
  outDir: string;
  /** Read the neutral build facts the preset is transforming. */
  readNeutral(): KovoNeutralBuild;
}

/** A preset validation diagnostic reported before platform output is emitted. */
export interface PresetDiagnostic {
  /** Stable diagnostic code owned by the preset. */
  code: string;
  /** Human-readable diagnostic message. */
  message: string;
  /** Whether the diagnostic blocks the build. */
  severity: 'error' | 'warning';
}

/** Options for the built-in Node/VPS preset. */
export interface NodePresetOptions {
  /** Whether the node preset emits a minimal Dockerfile next to `server.mjs`; defaults to true. */
  dockerfile?: boolean;
}

/** Built-in Node/VPS preset descriptor returned by `node()`. */
export interface NodePreset extends KovoPreset {
  /** Emit a standalone Node output from Kovo's neutral build artifact. */
  emit(build: KovoNeutralBuild, context: PresetContext): Promise<void>;
  /** Return blocking diagnostics when the neutral build lacks a request handler. */
  inspect(build: KovoNeutralBuild): readonly PresetDiagnostic[];
  /** Options captured by `node()`. */
  options: NodePresetOptions;
}

/**
 * Create the built-in Node/VPS preset descriptor.
 *
 * The emitted output wraps the neutral `server/handler.mjs` Request-to-Response
 * contract in a Node `http` server and serves immutable `/c/*` and `/assets/*`
 * client files without Vite at request time.
 */
export function node(options: NodePresetOptions = {}): NodePreset {
  return {
    emit(build, context) {
      return emitNodePreset(build, context, options);
    },
    inspect(build) {
      return build.serverHandlerPath === undefined
        ? [
            {
              code: 'node-missing-handler',
              message: 'The node preset requires a neutral build with server/handler.mjs.',
              severity: 'error',
            },
          ]
        : [];
    },
    name: 'node',
    options,
  };
}

/** Inputs for writing Kovo's platform-neutral deployment artifact. */
export interface WriteKovoNeutralBuildOptions {
  /** App aggregate produced by `createApp()`. */
  app: KovoApp;
  /** Optional public base path used to resolve manifest asset hrefs. */
  base?: string;
  /** Compiler-produced client modules that should be emitted under `client/c/`. */
  clientModules?: readonly KovoAppShellCompiledClientModule[];
  /** Vite manifest file used to derive asset inventory and per-route hints. */
  manifestFile?: string | URL;
  /** Target neutral artifact directory, conventionally `dist/.kovo`. */
  outDir: string | URL;
  /** Route path to Vite entry mapping used for route hints. */
  routeEntryMap?: KovoAppShellRouteEntryMap;
  /** Optional pre-bundled handler source to write to `server/handler.mjs`. */
  serverHandlerSource?: string;
}

/** Facts returned after writing the platform-neutral deployment artifact. */
export interface KovoNeutralBuild {
  /** Absolute path to the neutral client directory. */
  clientDir: string;
  /** Versioned client modules emitted under `client/c/`. */
  clientModules: readonly KovoAppShellBuiltClientModule[];
  /** Absolute path to the neutral manifest JSON file. */
  manifestPath: string;
  /** Absolute path to the neutral meta JSON file. */
  metaPath: string;
  /** Absolute path to the neutral build root. */
  outDir: string;
  /** Per-route Vite hints merged into the built app shell. */
  routeHints: readonly KovoAppShellRouteBuildHints[];
  /** Absolute path to the neutral routes JSON file. */
  routesPath: string;
  /** Absolute path to the neutral server directory. */
  serverDir: string;
  /** Absolute path to `server/handler.mjs` when a handler source was supplied. */
  serverHandlerPath?: string;
  /** Static assets discovered from the Vite manifest. */
  staticAssets: readonly {
    file: string;
    href: string;
    path: string;
  }[];
  /** Neutral artifact schema version. */
  version: typeof neutralBuildVersion;
}

/**
 * Write Kovo's platform-neutral deployment artifact.
 *
 * This Phase 0 API reuses the existing app-shell Vite manifest/client-module pipeline
 * and creates the `dist/.kovo`-style metadata layout. The server bundle step is still
 * supplied by callers as `serverHandlerSource` until `kovo build` owns bundling.
 */
export async function writeKovoNeutralBuild(
  options: WriteKovoNeutralBuildOptions,
): Promise<KovoNeutralBuild> {
  const outDir = resolvedFileSystemPath(options.outDir);
  const clientDir = path.join(outDir, 'client');
  const serverDir = path.join(outDir, 'server');
  const manifestFilePath =
    options.manifestFile === undefined ? undefined : resolvedFileSystemPath(options.manifestFile);
  const manifestDistDir =
    manifestFilePath === undefined ? undefined : path.dirname(path.dirname(manifestFilePath));
  const appShellBuild =
    manifestFilePath === undefined
      ? createKovoAppShellViteBuild({
          app: options.app,
          ...(options.base === undefined ? {} : { base: options.base }),
          ...(options.clientModules === undefined ? {} : { clientModules: options.clientModules }),
          ...(options.routeEntryMap === undefined ? {} : { routeEntryMap: options.routeEntryMap }),
        })
      : await createKovoAppShellViteBuildFromManifestFile({
          app: options.app,
          ...(options.base === undefined ? {} : { base: options.base }),
          ...(options.clientModules === undefined ? {} : { clientModules: options.clientModules }),
          manifestFile: manifestFilePath,
          ...(options.routeEntryMap === undefined ? {} : { routeEntryMap: options.routeEntryMap }),
        });

  await mkdir(clientDir, { recursive: true });
  await writeKovoAppShellViteBuildOutput(appShellBuild, {
    outDir: clientDir,
    staticExport: false,
  });
  const serverHandlerSource = options.serverHandlerSource;
  const serverHandlerPath =
    serverHandlerSource === undefined ? undefined : path.join(serverDir, 'handler.mjs');
  if (serverHandlerSource !== undefined && serverHandlerPath !== undefined) {
    await mkdir(serverDir, { recursive: true });
    await writeFile(serverHandlerPath, serverHandlerSource, 'utf8');
  }
  await copyNeutralStaticAssets(appShellBuild.assets, clientDir, manifestDistDir);

  const manifestPath = path.join(outDir, 'manifest.json');
  const routesPath = path.join(outDir, 'routes.json');
  const metaPath = path.join(outDir, 'meta.json');
  const neutral: KovoNeutralBuild = {
    clientDir,
    clientModules: appShellBuild.clientModules,
    manifestPath,
    metaPath,
    outDir,
    routeHints: appShellBuild.routeHints,
    routesPath,
    serverDir,
    ...(serverHandlerPath === undefined ? {} : { serverHandlerPath }),
    staticAssets: appShellBuild.assets,
    version: neutralBuildVersion,
  };

  await writeJson(manifestPath, {
    assets: appShellBuild.assets,
    clientModules: appShellBuild.clientModules.map(({ source: _source, ...module }) => module),
    routeHints: appShellBuild.routeHints,
    version: neutralBuildVersion,
  });
  await writeJson(routesPath, {
    routes: appShellBuild.app.routes.map((route) => ({ path: route.path })),
    version: neutralBuildVersion,
  });
  await writeJson(metaPath, {
    hasServerHandler: serverHandlerPath !== undefined,
    version: neutralBuildVersion,
  });

  return neutral;
}

async function emitNodePreset(
  build: KovoNeutralBuild,
  context: PresetContext,
  options: NodePresetOptions,
): Promise<void> {
  if (build.serverHandlerPath === undefined) {
    throw new Error('The node preset requires a neutral build with server/handler.mjs.');
  }

  const outDir = resolvedFileSystemPath(context.outDir);
  await mkdir(outDir, { recursive: true });
  await cp(build.clientDir, path.join(outDir, 'client'), { recursive: true });
  await cp(build.serverDir, path.join(outDir, 'server'), { recursive: true });
  await writeFile(path.join(outDir, 'server.mjs'), nodeServerSource(), 'utf8');

  if (options.dockerfile !== false) {
    await writeFile(path.join(outDir, 'Dockerfile'), nodeDockerfileSource(), 'utf8');
  }

  context.log(`Emitted Kovo node preset output to ${outDir}`);
}

async function copyNeutralStaticAssets(
  assets: readonly KovoNeutralBuild['staticAssets'][number][],
  clientDir: string,
  manifestDistDir: string | undefined,
): Promise<void> {
  if (manifestDistDir === undefined) return;

  for (const asset of assets) {
    const outputPath = neutralClientOutputPath(clientDir, asset.path);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await copyFile(viteDistSourcePath(manifestDistDir, asset.file), outputPath);
  }
}

function neutralClientOutputPath(clientDir: string, urlPath: string): string {
  const relativePath = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
  const outputPath = path.resolve(clientDir, relativePath);
  const relativeToClient = path.relative(clientDir, outputPath);

  if (
    relativeToClient === '' ||
    relativeToClient.startsWith('..') ||
    path.isAbsolute(relativeToClient)
  ) {
    throw new Error(`Neutral build asset must stay within the client directory: ${urlPath}`);
  }

  return outputPath;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function nodeServerSource(): string {
  return `import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

import handler from './server/handler.mjs';

const clientRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), 'client');
const immutableCacheControl = 'public, max-age=31536000, immutable';
const bodylessMethods = new Set(['GET', 'HEAD']);

export function createKovoNodeServer(options = {}) {
  return createServer(async (nodeRequest, nodeResponse) => {
    try {
      if (await maybeServeStatic(nodeRequest, nodeResponse)) return;

      const request = nodeRequestToWebRequest(nodeRequest, options);
      const response = await handler(request);
      await writeWebResponseToNode(response, nodeResponse, request.method);
    } catch {
      if (!nodeResponse.headersSent) {
        nodeResponse.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      }
      nodeResponse.end('Internal Server Error');
    }
  });
}

async function maybeServeStatic(nodeRequest, nodeResponse) {
  const method = nodeRequest.method ?? 'GET';
  if (!bodylessMethods.has(method)) return false;

  const pathname = staticPathname(nodeRequest);
  if (pathname === undefined) return false;
  if (!pathname.startsWith('/c/') && !pathname.startsWith('/assets/')) return false;

  const filePath = staticFilePath(pathname);
  if (filePath === undefined) {
    nodeResponse.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    nodeResponse.end('Forbidden');
    return true;
  }

  const fileStat = await stat(filePath).catch(() => undefined);
  if (fileStat === undefined || !fileStat.isFile()) {
    nodeResponse.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    nodeResponse.end('Not Found');
    return true;
  }

  nodeResponse.writeHead(200, {
    'cache-control': immutableCacheControl,
    'content-length': String(fileStat.size),
    'content-type': contentType(filePath),
  });
  if (method === 'HEAD') {
    nodeResponse.end();
    return true;
  }

  await new Promise((resolvePromise, reject) => {
    createReadStream(filePath)
      .once('error', reject)
      .pipe(nodeResponse)
      .once('error', reject)
      .once('finish', resolvePromise);
  });
  return true;
}

function staticPathname(nodeRequest) {
  try {
    return new URL(nodeRequest.url ?? '/', 'http://kovo.local').pathname;
  } catch {
    return undefined;
  }
}

function staticFilePath(pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname.slice(1));
  } catch {
    return undefined;
  }
  if (relativePath.includes('\\0')) return undefined;

  const filePath = resolve(clientRoot, relativePath);
  const relativePathFromRoot = relative(clientRoot, filePath);
  if (
    relativePathFromRoot === '' ||
    relativePathFromRoot.startsWith('..') ||
    isAbsolute(relativePathFromRoot)
  ) {
    return undefined;
  }

  return filePath;
}

function nodeRequestToWebRequest(nodeRequest, options) {
  const method = nodeRequest.method ?? 'GET';
  const init = {
    headers: nodeHeadersToWebHeaders(nodeRequest),
    method,
    ...(bodylessMethods.has(method)
      ? {}
      : {
          body: Readable.toWeb(nodeRequest),
          duplex: 'half',
        }),
  };

  return new Request(nodeRequestUrl(nodeRequest, options), init);
}

function nodeRequestUrl(nodeRequest, options) {
  const rawUrl = nodeRequest.url ?? '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawUrl)) return rawUrl;

  const origin =
    typeof options.origin === 'function'
      ? options.origin(nodeRequest)
      : (options.origin ?? defaultOrigin(nodeRequest));

  return new URL(rawUrl, origin).href;
}

function defaultOrigin(nodeRequest) {
  const host = nodeRequest.headers.host ?? '127.0.0.1';
  const forwardedProto = firstHeaderValue(nodeRequest.headers['x-forwarded-proto']);
  const proto =
    forwardedProto ?? (nodeRequest.socket && nodeRequest.socket.encrypted ? 'https' : 'http');

  return proto + '://' + host;
}

async function writeWebResponseToNode(response, nodeResponse, method = 'GET') {
  const headers = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });

  nodeResponse.writeHead(response.status, response.statusText, headers);
  if (method === 'HEAD' || response.body === null) {
    nodeResponse.end();
    return;
  }

  await new Promise((resolvePromise, reject) => {
    Readable.fromWeb(response.body)
      .once('error', reject)
      .pipe(nodeResponse)
      .once('error', reject)
      .once('finish', resolvePromise);
  });
}

function nodeHeadersToWebHeaders(nodeRequest) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeRequest.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

function contentType(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.wasm':
      return 'application/wasm';
    default:
      return 'application/octet-stream';
  }
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';
  createKovoNodeServer().listen(port, host, () => {
    console.log('Kovo node server listening on http://' + host + ':' + port);
  });
}
`;
}

function nodeDockerfileSource(): string {
  return `FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY . .
EXPOSE 3000
CMD ["node", "server.mjs"]
`;
}
