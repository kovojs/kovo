import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import type { KovoApp } from './app-types.js';
import { resolvedFileSystemPath } from './vite-build-assets.js';
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
  /** Whether the node preset should emit a Dockerfile once preset emission is implemented. */
  dockerfile?: boolean;
}

/**
 * Create the built-in Node/VPS preset descriptor.
 *
 * The initial Phase 0 implementation exposes the typed preset value used by config and
 * tests; platform-specific emission lands with the node preset phase.
 */
export function node(options: NodePresetOptions = {}): KovoPreset & { options: NodePresetOptions } {
  return {
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
  const appShellBuild =
    options.manifestFile === undefined
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
          manifestFile: options.manifestFile,
          ...(options.routeEntryMap === undefined ? {} : { routeEntryMap: options.routeEntryMap }),
        });

  await mkdir(outDir, { recursive: true });
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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
