import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import {
  kovoDeferredRuntimeModulePath,
  kovoDeferredRuntimeModuleVersion,
} from '@kovojs/browser/internal/inline-loader';

import { resolvedFileSystemPath } from './vite-build-assets.js';
import type { KovoNeutralBuild } from './neutral-build.js';

const immutableCacheControl = 'public, max-age=31536000, immutable';

/**
 * Build-time preset descriptor consumed by `kovo build` and deployment tooling.
 *
 * @experimental
 */
export interface KovoPreset {
  /** Emit platform-native output from an already-written neutral build. */
  emit?(build: KovoNeutralBuild, context: PresetContext): Promise<void> | void;
  /** Return target-specific diagnostics before output is emitted. */
  inspect?(
    build: KovoNeutralBuild,
    context: PresetInspectContext,
  ): Promise<readonly PresetDiagnostic[]> | readonly PresetDiagnostic[];
  /** Stable preset name, such as `node`, `vercel`, or `cloudflare`. */
  name: string;
}

/**
 * Context passed to a preset while it validates target-specific constraints.
 *
 * @experimental
 */
export interface PresetInspectContext {
  /** Environment variables the app declares or the build inferred, such as `DATABASE_URL`. */
  declaredEnv: readonly string[];
  /** Read the bundled request handler source when a preset needs target-specific inspection. */
  readServerHandlerSource?(): Promise<string | undefined> | string | undefined;
}

/**
 * Context passed to a preset while it transforms the neutral build output.
 *
 * @experimental
 */
export interface PresetContext extends PresetInspectContext {
  /** Build log sink supplied by the CLI or host integration. */
  log(message: string): void;
  /** Platform output directory for the preset. */
  outDir: string;
  /** Read the neutral build facts the preset is transforming. */
  readNeutral(): KovoNeutralBuild;
}

/**
 * A preset validation diagnostic reported before platform output is emitted.
 *
 * @experimental
 */
export interface PresetDiagnostic {
  /** Stable diagnostic code owned by the preset. */
  code: string;
  /** Human-readable diagnostic message. */
  message: string;
  /** Whether the diagnostic blocks the build. */
  severity: 'error' | 'warning';
}

/**
 * Options for the built-in Node/VPS preset.
 *
 * @experimental
 */
export interface NodePresetOptions {
  /** Whether the node preset emits a minimal Dockerfile next to `server.mjs`; defaults to true. */
  dockerfile?: boolean;
}

/**
 * Options for the built-in Vercel preset.
 *
 * @experimental
 */
export interface VercelPresetOptions {
  /** Maximum Vercel Function duration in seconds. */
  maxDuration?: number;
  /** Vercel Function memory in MB. */
  memory?: number;
  /** Vercel regions for the Node function. */
  regions?: readonly string[];
}

/**
 * Options for the built-in Cloudflare Workers preset.
 *
 * @experimental
 */
export interface CloudflarePresetOptions {
  /** Worker compatibility date; defaults to the first date that supports `nodejs_compat` v2. */
  compatibilityDate?: string;
  /** Generated Worker name in `wrangler.toml`; defaults to `kovo-app`. */
  name?: string;
}

/**
 * Build-time project configuration loaded from `kovo.config.ts`.
 *
 * @experimental
 */
export interface KovoConfig {
  /** Platform preset used by `kovo build` when CLI/env overrides are absent. */
  preset?: KovoPreset;
}

/**
 * Type helper for authoring `kovo.config.ts` without changing runtime behavior.
 *
 * @experimental
 */
export function defineConfig(config: KovoConfig): KovoConfig {
  return config;
}

/**
 * Create the built-in Node/VPS preset descriptor.
 *
 * The emitted output wraps the neutral `server/handler.mjs` Request-to-Response
 * contract in a Node `http` server and serves immutable `/c/*` and `/assets/*`
 * client files without Vite at request time.
 *
 * @experimental
 */
export function node(options: NodePresetOptions = {}): KovoPreset {
  return {
    emit(build, context) {
      return emitNodePreset(build, context, options);
    },
    inspect(build, _context) {
      const diagnostics = clientModuleRetentionDiagnostics(build, 'node');
      if (build.serverHandlerPath === undefined && build.staticOutput === undefined) {
        diagnostics.push({
          code: 'node-missing-handler',
          message: 'The node preset requires a neutral build with server/handler.mjs.',
          severity: 'error',
        });
      }
      return diagnostics;
    },
    name: 'node',
  };
}

/**
 * Create the built-in Vercel preset descriptor.
 *
 * The emitted output follows Vercel Build Output API v3: static client files
 * land under `.vercel/output/static`, and the request handler is wrapped as a
 * Node.js Vercel Function under `.vercel/output/functions/kovo.func`.
 *
 * @experimental
 */
export function vercel(options: VercelPresetOptions = {}): KovoPreset {
  return {
    emit(build, context) {
      return emitVercelPreset(build, context, options);
    },
    inspect(build, _context) {
      const diagnostics = clientModuleRetentionDiagnostics(build, 'vercel');
      if (build.serverHandlerPath === undefined && build.staticOutput === undefined) {
        diagnostics.push({
          code: 'vercel-missing-handler',
          message: 'The vercel preset requires a neutral build with server/handler.mjs.',
          severity: 'error',
        });
      }
      return diagnostics;
    },
    name: 'vercel',
  };
}

/**
 * Create the built-in Cloudflare Workers preset descriptor.
 *
 * The emitted output is a Wrangler project with a module Worker, static assets
 * binding, and `nodejs_compat` enabled for the current Node-first request path.
 *
 * @experimental
 */
export function cloudflare(options: CloudflarePresetOptions = {}): KovoPreset {
  return {
    emit(build, context) {
      return emitCloudflarePreset(build, context, options);
    },
    async inspect(build, context) {
      const diagnostics = clientModuleRetentionDiagnostics(build, 'cloudflare');
      if (build.serverHandlerPath === undefined && build.staticOutput === undefined) {
        diagnostics.push({
          code: 'cloudflare-missing-handler',
          message: 'The cloudflare preset requires a neutral build with server/handler.mjs.',
          severity: 'error',
        });
      }
      if (build.serverHandlerPath === undefined) return diagnostics;

      diagnostics.push(...(await cloudflareRuntimeDiagnostics(build, context)));
      return diagnostics;
    },
    name: 'cloudflare',
  };
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
  if (build.staticOutput !== undefined) {
    await cp(build.staticOutput.dir, path.join(outDir, 'static'), { recursive: true });
  }
  await cp(build.serverDir, path.join(outDir, 'server'), { recursive: true });
  await writeFile(path.join(outDir, 'server.mjs'), nodeServerSource(), 'utf8');

  if (options.dockerfile !== false) {
    await writeFile(path.join(outDir, 'Dockerfile'), nodeDockerfileSource(), 'utf8');
  }

  context.log(`Emitted Kovo node preset output to ${outDir}`);
}

async function emitVercelPreset(
  build: KovoNeutralBuild,
  context: PresetContext,
  options: VercelPresetOptions,
): Promise<void> {
  if (build.staticOnly && build.staticOutput !== undefined) {
    const outDir = resolvedFileSystemPath(context.outDir);
    await mkdir(outDir, { recursive: true });
    await cp(build.staticOutput.dir, path.join(outDir, 'static'), { recursive: true });
    await writeJson(path.join(outDir, 'config.json'), vercelStaticBuildOutputConfig());
    context.log(`Emitted Kovo vercel static preset output to ${outDir}`);
    return;
  }

  if (build.serverHandlerPath === undefined) {
    throw new Error('The vercel preset requires a neutral build with server/handler.mjs.');
  }

  const outDir = resolvedFileSystemPath(context.outDir);
  const functionDir = path.join(outDir, 'functions/kovo.func');
  await mkdir(outDir, { recursive: true });
  await copyPresetStaticFiles(build, path.join(outDir, 'static'));
  await mkdir(functionDir, { recursive: true });
  await copyFile(build.serverHandlerPath, path.join(functionDir, 'handler.mjs'));
  await writeFile(path.join(functionDir, 'index.cjs'), vercelFunctionSource(), 'utf8');
  await writeJson(path.join(functionDir, '.vc-config.json'), {
    handler: 'index.cjs',
    launcherType: 'Nodejs',
    ...(options.maxDuration === undefined ? {} : { maxDuration: options.maxDuration }),
    ...(options.memory === undefined ? {} : { memory: options.memory }),
    ...(options.regions === undefined ? {} : { regions: options.regions }),
    runtime: 'nodejs22.x',
    shouldAddHelpers: true,
  });
  await writeJson(path.join(outDir, 'config.json'), vercelBuildOutputConfig());

  context.log(`Emitted Kovo vercel preset output to ${outDir}`);
}

async function emitCloudflarePreset(
  build: KovoNeutralBuild,
  context: PresetContext,
  options: CloudflarePresetOptions,
): Promise<void> {
  if (build.staticOnly && build.staticOutput !== undefined) {
    const outDir = resolvedFileSystemPath(context.outDir);
    await mkdir(outDir, { recursive: true });
    await cp(build.staticOutput.dir, path.join(outDir, 'client'), { recursive: true });
    await writeFile(path.join(outDir, 'wrangler.toml'), wranglerTomlSource(options), 'utf8');
    context.log(`Emitted Kovo cloudflare static preset output to ${outDir}`);
    return;
  }

  if (build.serverHandlerPath === undefined) {
    throw new Error('The cloudflare preset requires a neutral build with server/handler.mjs.');
  }

  const outDir = resolvedFileSystemPath(context.outDir);
  await mkdir(outDir, { recursive: true });
  await copyPresetStaticFiles(build, path.join(outDir, 'client'));
  await mkdir(path.join(outDir, 'server'), { recursive: true });
  await copyFile(build.serverHandlerPath, path.join(outDir, 'server/handler.mjs'));
  await writeFile(path.join(outDir, 'worker.mjs'), cloudflareWorkerSource(), 'utf8');
  await writeFile(path.join(outDir, 'wrangler.toml'), wranglerTomlSource(options), 'utf8');

  context.log(`Emitted Kovo cloudflare preset output to ${outDir}`);
}

async function copyPresetStaticFiles(build: KovoNeutralBuild, outDir: string): Promise<void> {
  if (build.staticOutput !== undefined) {
    await cp(build.staticOutput.dir, outDir, { recursive: true });
  }
  await cp(build.clientDir, outDir, { recursive: true });
}

function clientModuleRetentionDiagnostics(
  build: KovoNeutralBuild,
  presetName: string,
): PresetDiagnostic[] {
  const retainedClientModules = build.clientModules.filter(
    (module) => !isFrameworkRuntimeClientModule(module),
  );
  if (retainedClientModules.length === 0) return [];

  return [
    {
      code: 'KV417',
      message: `The ${presetName} preset cannot prove the SPEC §14 deploy-skew retention floor for immutable /c/__v/... modules and prior-token /_q reads. Configure a serving layer that retains prior build artifacts and query-read support for at least 24 hours, or use a preset/adapter that declares that support.`,
      severity: 'error',
    },
  ];
}

function isFrameworkRuntimeClientModule(
  module: KovoNeutralBuild['clientModules'][number],
): boolean {
  return (
    module.path.endsWith(kovoDeferredRuntimeModulePath.replace(/^\/c\//, '/')) &&
    module.version === kovoDeferredRuntimeModuleVersion
  );
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function vercelBuildOutputConfig(): unknown {
  return {
    routes: [
      {
        continue: true,
        headers: immutableStaticHeaders(),
        src: '/(?:assets|c)/(.*)',
      },
      {
        continue: true,
        headers: documentStaticHeaders(),
        src: '/(.*)',
      },
      { handle: 'filesystem' },
      { dest: '/kovo', src: '/(.*)' },
    ],
    version: 3,
  };
}

function vercelStaticBuildOutputConfig(): unknown {
  return {
    routes: [
      {
        continue: true,
        headers: immutableStaticHeaders(),
        src: '/(?:assets|c)/(.*)',
      },
      {
        continue: true,
        headers: documentStaticHeaders(),
        src: '/(.*)',
      },
      { handle: 'filesystem' },
    ],
    version: 3,
  };
}

function immutableStaticHeaders(): Record<string, string> {
  return {
    'cache-control': immutableCacheControl,
    'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
  };
}

// SPEC §6.6 / bugz M4: Vercel/Cloudflare `config.json` route headers carry the full
// security-header floor for every document path, matching the floor that dynamic dispatch
// emits. These headers are host-config complements to the per-document `_headers` sidecar
// (which Netlify/Cloudflare Pages read) and share the same invariants: no CSP nonce (static
// exports do not use nonce-based CSP), clickjacking denied, cross-origin isolation, no
// microphone/camera/payment/geolocation delegation, strict referrer.
function documentStaticHeaders(): Record<string, string> {
  return {
    'cross-origin-opener-policy': 'same-origin-allow-popups',
    'permissions-policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  };
}

function vercelFunctionSource(): string {
  return `const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

let handlerPromise;

module.exports = async function kovoVercelFunction(nodeRequest, nodeResponse) {
  try {
    const handler = await loadHandler();
    const request = nodeRequestToWebRequest(nodeRequest, {}, nodeResponse);
    const response = await handler(request);
    await writeWebResponseToNode(response, nodeResponse, request.method);
  } catch {
    if (nodeResponse.headersSent) {
      nodeResponse.destroy();
    } else {
      nodeResponse.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      nodeResponse.end('Internal Server Error');
    }
  }
};

async function loadHandler() {
  handlerPromise ||= import('./handler.mjs').then((module) => module.default);
  return handlerPromise;
}

function nodeRequestToWebRequest(nodeRequest, options = {}, nodeResponse) {
  const method = nodeRequest.method ?? 'GET';
  const headers = nodeHeadersToWebHeaders(nodeRequest);
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  const socket = nodeRequest.socket;
  nodeRequest.once('aborted', abort);
  nodeRequest.once('close', abort);
  socket?.once('close', abort);
  if (nodeResponse) {
    const cleanup = () => {
      nodeRequest.off('aborted', abort);
      nodeRequest.off('close', abort);
      socket?.off('close', abort);
    };
    nodeResponse.once('close', cleanup);
  }
  const init = {
    headers,
    method,
    signal: controller.signal,
    ...(method === 'GET' || method === 'HEAD'
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
  const origin = options.origin ?? defaultOrigin(nodeRequest);
  if (/^[a-z][a-z0-9+.-]*:/i.test(rawUrl)) {
    const absolute = new URL(rawUrl);
    return new URL(absolute.pathname + absolute.search + absolute.hash, origin).href;
  }

  const pathOnly = rawUrl.startsWith('//') ? '/' + rawUrl.replace(/^\\/+/, '') : rawUrl;
  return new URL(pathOnly, origin).href;
}

function defaultOrigin(nodeRequest) {
  const pseudoHeaders = nodeRequest.headers;
  const host = nodeRequest.headers.host ?? firstHeaderValue(pseudoHeaders[':authority']) ?? '127.0.0.1';
  return 'https://' + host;
}

async function writeWebResponseToNode(response, nodeResponse, method = 'GET') {
  const headers = responseHeadersToNodeHeaders(response.headers);

  nodeResponse.writeHead(response.status, response.statusText, headers);
  if (method === 'HEAD' || response.body === null) {
    nodeResponse.end();
    return;
  }

  await pipeline(Readable.fromWeb(response.body), nodeResponse);
}

function nodeHeadersToWebHeaders(nodeRequest) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeRequest.headers)) {
    if (value === undefined) continue;
    if (name.startsWith(':')) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

function responseHeadersToNodeHeaders(headers) {
  const nodeHeaders = {};
  const setCookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  if (setCookies.length > 0) nodeHeaders['set-cookie'] = setCookies;
  headers.forEach((value, name) => {
    if (name === 'set-cookie') return;
    nodeHeaders[name] = value;
  });
  return nodeHeaders;
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}
`;
}

function cloudflareWorkerSource(): string {
  return `import handler from './server/handler.mjs';

const immutableStaticHeaders = ${JSON.stringify(immutableStaticHeaders())};
const documentStaticHeaders = ${JSON.stringify(documentStaticHeaders())};
const staticErrorHeaders = {
  'cache-control': 'no-store',
  'cross-origin-resource-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
};
const bodylessMethods = new Set(['GET', 'HEAD']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (bodylessMethods.has(request.method) && env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) {
        const headers = new Headers(assetResponse.headers);
        if (assetResponse.status >= 400) {
          applyHeaders(headers, staticErrorHeaders);
        } else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/c/')) {
          applyHeaders(headers, immutableStaticHeaders);
        } else {
          applyHeaders(headers, documentStaticHeaders);
        }
        return new Response(assetResponse.body, {
          headers,
          status: assetResponse.status,
          statusText: assetResponse.statusText,
        });
      }
    }

    return handler(request);
  },
};

function applyHeaders(headers, policy) {
  for (const [name, value] of Object.entries(policy)) {
    headers.set(name, value);
  }
}
`;
}

async function cloudflareRuntimeDiagnostics(
  build: KovoNeutralBuild,
  context: PresetInspectContext,
): Promise<readonly PresetDiagnostic[]> {
  const source = await serverHandlerSourceForInspection(build, context);
  if (source === undefined) return [];

  const diagnostics: PresetDiagnostic[] = [];
  if (context.declaredEnv.includes('DATABASE_URL') || source.includes('DATABASE_URL')) {
    diagnostics.push({
      code: 'cloudflare-tcp-database',
      message:
        'The cloudflare preset emits a Worker with nodejs_compat. TCP database drivers behind DATABASE_URL need Hyperdrive, Cloudflare Containers, or an HTTP database driver before deploy.',
      severity: 'warning',
    });
  }

  for (const moduleName of cloudflareBlockedNodeModules) {
    if (serverHandlerImportsModule(source, moduleName)) {
      diagnostics.push({
        code: 'cloudflare-unsupported-node-api',
        message: `The cloudflare preset cannot run ${moduleName}; Cloudflare exposes this Node API as a non-functional compatibility stub. Move that code off the request path or deploy with the node preset/Containers.`,
        severity: 'error',
      });
    }
  }

  return diagnostics;
}

const cloudflareBlockedNodeModules = [
  'child_process',
  'cluster',
  'dgram',
  'node:child_process',
  'node:cluster',
  'node:dgram',
] as const;

async function serverHandlerSourceForInspection(
  build: KovoNeutralBuild,
  context: PresetInspectContext,
): Promise<string | undefined> {
  const contextSource = await context.readServerHandlerSource?.();
  if (contextSource !== undefined) return contextSource;
  if (build.serverHandlerPath === undefined) return undefined;
  return readFile(build.serverHandlerPath, 'utf8');
}

function serverHandlerImportsModule(source: string, moduleName: string): boolean {
  const quotedModule = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const modulePattern = new RegExp(
    [
      `\\bfrom\\s*['"]${quotedModule}['"]`,
      `\\bimport\\s*\\(\\s*['"]${quotedModule}['"]\\s*\\)`,
      `\\brequire\\s*\\(\\s*['"]${quotedModule}['"]\\s*\\)`,
    ].join('|'),
  );
  return modulePattern.test(source);
}

function wranglerTomlSource(options: CloudflarePresetOptions): string {
  const name = options.name ?? 'kovo-app';
  const compatibilityDate = options.compatibilityDate ?? '2024-09-23';
  return [
    `name = ${tomlString(name)}`,
    'main = "./worker.mjs"',
    `compatibility_date = ${tomlString(compatibilityDate)}`,
    'compatibility_flags = ["nodejs_compat"]',
    '',
    '[assets]',
    'directory = "./client"',
    'binding = "ASSETS"',
    'run_worker_first = true',
    '',
  ].join('\n');
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function nodeServerSource(): string {
  return `import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import handler from './server/handler.mjs';

const clientRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), 'client');
const staticRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), 'static');
const immutableStaticHeaders = ${JSON.stringify(immutableStaticHeaders())};
const documentStaticHeaders = ${JSON.stringify(documentStaticHeaders())};
const bodylessMethods = new Set(['GET', 'HEAD']);

export function createKovoNodeServer(options = {}) {
  return createServer(async (nodeRequest, nodeResponse) => {
    try {
      if (await maybeServeStatic(nodeRequest, nodeResponse)) return;

      const request = nodeRequestToWebRequest(nodeRequest, options, nodeResponse);
      const response = await handler(request);
      await writeWebResponseToNode(response, nodeResponse, request.method);
    } catch {
      if (nodeResponse.headersSent) {
        nodeResponse.destroy();
      } else {
        nodeResponse.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        nodeResponse.end('Internal Server Error');
      }
    }
  });
}

async function maybeServeStatic(nodeRequest, nodeResponse) {
  const method = nodeRequest.method ?? 'GET';
  if (!bodylessMethods.has(method)) return false;

  const pathname = staticPathname(nodeRequest);
  if (pathname === undefined) return false;
  const immutableAsset = pathname.startsWith('/c/') || pathname.startsWith('/assets/');
  const filePath = immutableAsset ? staticFilePath(clientRoot, pathname) : routeDocumentPath(pathname);

  if (filePath === undefined) {
    if (!immutableAsset) return false;
    nodeResponse.writeHead(403, staticErrorHeaders());
    nodeResponse.end('Forbidden');
    return true;
  }

  const fileStat = await stat(filePath).catch(() => undefined);
  if (fileStat === undefined || !fileStat.isFile()) {
    if (!immutableAsset) return false;
    nodeResponse.writeHead(404, staticErrorHeaders());
    nodeResponse.end('Not Found');
    return true;
  }

  nodeResponse.writeHead(200, {
    ...(immutableAsset ? immutableStaticHeaders : documentStaticHeaders),
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

function routeDocumentPath(pathname) {
  const cleanPathname = pathname.endsWith('/') ? pathname : pathname + '/';
  return staticFilePath(staticRoot, cleanPathname + 'index.html');
}

function staticFilePath(root, pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname.slice(1));
  } catch {
    return undefined;
  }
  if (relativePath.includes('\\0')) return undefined;

  const filePath = resolve(root, relativePath);
  const relativePathFromRoot = relative(root, filePath);
  if (
    relativePathFromRoot === '' ||
    relativePathFromRoot.startsWith('..') ||
    isAbsolute(relativePathFromRoot)
  ) {
    return undefined;
  }

  return filePath;
}

function nodeRequestToWebRequest(nodeRequest, options = {}, nodeResponse) {
  const method = nodeRequest.method ?? 'GET';
  const headers = nodeHeadersToWebHeaders(nodeRequest);
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  const socket = nodeRequest.socket;
  nodeRequest.once('aborted', abort);
  nodeRequest.once('close', abort);
  socket?.once('close', abort);
  if (nodeResponse) {
    const cleanup = () => {
      nodeRequest.off('aborted', abort);
      nodeRequest.off('close', abort);
      socket?.off('close', abort);
    };
    nodeResponse.once('close', cleanup);
  }
  const init = {
    headers,
    method,
    signal: controller.signal,
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
  const origin =
    typeof options.origin === 'function'
      ? options.origin(nodeRequest)
      : (options.origin ?? defaultOrigin(nodeRequest, options));

  if (/^[a-z][a-z0-9+.-]*:/i.test(rawUrl)) {
    const absolute = new URL(rawUrl);
    return new URL(absolute.pathname + absolute.search + absolute.hash, origin).href;
  }

  const pathOnly = rawUrl.startsWith('//') ? '/' + rawUrl.replace(/^\\/+/, '') : rawUrl;
  return new URL(pathOnly, origin).href;
}

function defaultOrigin(nodeRequest, options) {
  const pseudoHeaders = nodeRequest.headers;
  const host = nodeRequest.headers.host ?? firstHeaderValue(pseudoHeaders[':authority']) ?? '127.0.0.1';
  const forwardedProto = options.trustedProxy
    ? firstHeaderValue(nodeRequest.headers['x-forwarded-proto'])
    : undefined;
  const pseudoScheme = firstHeaderValue(pseudoHeaders[':scheme']);
  const proto =
    forwardedProto ??
    pseudoScheme ??
    (nodeRequest.socket && nodeRequest.socket.encrypted ? 'https' : 'http');

  return proto + '://' + host;
}

async function writeWebResponseToNode(response, nodeResponse, method = 'GET') {
  const headers = responseHeadersToNodeHeaders(response.headers);

  nodeResponse.writeHead(response.status, response.statusText, headers);
  if (method === 'HEAD' || response.body === null) {
    nodeResponse.end();
    return;
  }

  await pipeline(Readable.fromWeb(response.body), nodeResponse);
}

function nodeHeadersToWebHeaders(nodeRequest) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeRequest.headers)) {
    if (value === undefined) continue;
    if (name.startsWith(':')) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

function responseHeadersToNodeHeaders(headers) {
  const nodeHeaders = {};
  const setCookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  if (setCookies.length > 0) nodeHeaders['set-cookie'] = setCookies;
  headers.forEach((value, name) => {
    if (name === 'set-cookie') return;
    nodeHeaders[name] = value;
  });
  return nodeHeaders;
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
    case '.html':
      return 'text/html; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.wasm':
      return 'application/wasm';
    default:
      return 'application/octet-stream';
  }
}

function staticErrorHeaders() {
  return {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
  };
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
