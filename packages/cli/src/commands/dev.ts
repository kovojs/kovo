import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { InlineConfig, PluginOption, UserConfig, ViteDevServer } from 'vite-plus';

import {
  DEV_ARGV_SPEC,
  DEV_USAGE,
  commandArgvError,
  parseCommandArgv,
  parsedBooleanOption,
  parsedStringOption,
  requireSinglePositional,
} from '../commands-manifest.js';
import type { CliCommandResult } from '../shared.js';
import {
  buildArrayIsArray,
  buildOwnDataValue,
  buildSnapshotDenseArray,
} from './build-security-intrinsics.js';

const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const nativeObjectFreeze = NativeObject.freeze;
const nativeReflectApply = NativeReflect.apply;

const DEFAULT_VITE_CONFIG_FILES = [
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cts',
  'vite.config.cjs',
] as const;

/** @internal Parsed options for the supported `kovo dev` runner. */
export interface KovoDevOptions {
  appModulePath: string;
  configFile?: string;
  host?: string;
  mode: string;
  port?: number;
  root: string;
  strictPort: boolean;
}

/** @internal A live supported dev server plus its complete two-graph cleanup. */
export interface KovoDevServerHandle {
  close(): Promise<void>;
  server: ViteDevServer;
}

type DevArgParseResult = { ok: true; options: KovoDevOptions } | { message: string; ok: false };

/** @internal Parse `kovo dev` without delegating security-sensitive setup to Vite's CLI. */
export function parseDevArgs(args: readonly string[]): DevArgParseResult {
  const parsed = parseCommandArgv(args, DEV_ARGV_SPEC);
  if (!parsed.ok) return commandArgvError('dev', parsed, DEV_USAGE);
  const app = requireSinglePositional(parsed.value, {
    label: 'app module path',
    name: 'dev',
    usage: DEV_USAGE,
  });
  if (!app.ok) return app;

  const root = resolve(parsedStringOption(parsed.value, '--root') ?? process.cwd());
  const portValue = parsedStringOption(parsed.value, '--port');
  let port: number | undefined;
  if (portValue !== undefined) {
    port = Number.parseInt(portValue, 10);
    if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
      return {
        message: `kovo: dev --port must be an integer from 0 through 65535.\n${DEV_USAGE}`,
        ok: false,
      };
    }
  }

  return {
    ok: true,
    options: {
      appModulePath: resolve(root, app.value),
      ...(parsedStringOption(parsed.value, '--config') === undefined
        ? {}
        : { configFile: resolve(root, parsedStringOption(parsed.value, '--config')!) }),
      ...(parsedStringOption(parsed.value, '--host') === undefined
        ? {}
        : { host: parsedStringOption(parsed.value, '--host')! }),
      mode: parsedStringOption(parsed.value, '--mode') ?? 'development',
      ...(port === undefined ? {} : { port }),
      root,
      strictPort: parsedBooleanOption(parsed.value, '--strict-port'),
    },
  };
}

/** @internal Start the official bootstrap-first development runner (SPEC §5.2/§6.6/§9.5). */
export async function startKovoDevServer(options: KovoDevOptions): Promise<KovoDevServerHandle> {
  const { createServer } = await import('vite-plus');
  const root = resolve(options.root);
  const configFile = resolveDevConfigFile(root, options.configFile);
  const bootstrapServer = await createServer({
    appType: 'custom',
    configFile: false,
    logLevel: 'error',
    root,
    server: { hmr: false },
    ssr: { noExternal: [/^@kovojs\//] },
  });

  let liveServer: ViteDevServer | undefined;
  try {
    const profile = await preloadDevSecurityProfile(bootstrapServer, options.appModulePath, root);
    // Construct and freeze the framework plugin before authored config/plugin evaluation. Authored
    // hooks may mutate their own config, but cannot replace the proof plugin or its hook table.
    const createdPlugin = profile.kovo({ app: viteAppModuleId(options.appModulePath, root) });
    if (!isRecord(createdPlugin)) {
      throw new TypeError('@kovojs/server/vite kovo() must return a plugin object.');
    }
    const kovoPlugin = freezeFrameworkPlugin(createdPlugin) as PluginOption;
    const authoredConfig = await loadAuthoredDevConfig(
      bootstrapServer,
      configFile,
      root,
      options.mode,
    );
    const authoredPlugins = authoredVitePlugins(authoredConfig);
    const liveConfig: InlineConfig = {
      ...authoredConfig,
      configFile: false,
      mode: options.mode,
      plugins: [kovoPlugin, ...authoredPlugins],
      root,
      server: {
        ...authoredConfig.server,
        ...(options.host === undefined ? {} : { host: options.host }),
        ...(options.port === undefined ? {} : { port: options.port }),
        ...(options.strictPort ? { strictPort: true } : {}),
      },
      ssr: {
        ...authoredConfig.ssr,
        // The live app graph is distinct from the config-evaluation graph. Keep all Kovo modules
        // together so the plugin's configureServer preload and the app share exact identities.
        noExternal: [/^@kovojs\//],
      },
    };

    liveServer = await createServer(liveConfig);
    await liveServer.listen();
    liveServer.printUrls();

    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      try {
        await liveServer!.close();
      } finally {
        await bootstrapServer.close();
      }
    };
    const onSignal = (): void => {
      void close();
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    liveServer.httpServer?.once('close', () => {
      if (!closed) void close();
    });

    return { close, server: liveServer };
  } catch (error) {
    try {
      await liveServer?.close();
    } finally {
      await bootstrapServer.close();
    }
    throw error;
  }
}

/** @internal CLI result adapter; the live HTTP/watcher handles intentionally keep the bin alive. */
export async function runDevCommand(options: KovoDevOptions): Promise<CliCommandResult> {
  try {
    await startKovoDevServer(options);
    return { exitCode: 0, output: '' };
  } catch (error) {
    return {
      error: `kovo dev failed: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    };
  }
}

interface DevSecurityProfileModule {
  kovo(options: { app: string }): Exclude<PluginOption, false | null | undefined>;
}

interface CompilerSecurityBootstrapModule {
  lockCompilerSecurityRealm(): void;
}

async function preloadDevSecurityProfile(
  server: Pick<ViteDevServer, 'ssrLoadModule'>,
  appModulePath: string,
  root: string,
): Promise<DevSecurityProfileModule> {
  const requireFromApp = createRequire(pathToFileURL(appModulePath));
  const serverRootPath = requireFromApp.resolve('@kovojs/server');
  const requireFromServer = createRequire(pathToFileURL(serverRootPath));

  // C73/C74: all three loads happen in this exact noExternal graph, in a fixed sequence, before
  // the authored config module or any of its imported plugins can execute.
  const compilerBootstrap = await server.ssrLoadModule(
    viteSsrModuleId(
      requireFromServer.resolve('@kovojs/compiler/internal/security-bootstrap'),
      root,
    ),
  );
  const lockCompilerSecurityRealm = compilerBootstrap.lockCompilerSecurityRealm;
  if (typeof lockCompilerSecurityRealm !== 'function') {
    throw new TypeError(
      '@kovojs/compiler/internal/security-bootstrap must export lockCompilerSecurityRealm.',
    );
  }
  await server.ssrLoadModule(viteSsrModuleId(requireFromServer.resolve('@kovojs/compiler'), root));
  await server.ssrLoadModule(
    viteSsrModuleId(
      requireFromApp.resolve('@kovojs/server/internal/data-plane-static-analysis'),
      root,
    ),
  );
  await server.ssrLoadModule(viteSsrModuleId(serverRootPath, root));
  const module = await server.ssrLoadModule(
    viteSsrModuleId(requireFromApp.resolve('@kovojs/server/vite'), root),
  );
  // The complete trusted graph captures descriptor-based Web/Node controls first. Lock the realm
  // at the last trusted boundary, immediately before constructing the framework plugin and loading
  // the authored config; modules that intentionally capture data descriptors must not observe the
  // lockdown accessors as if they were host-native descriptors.
  (lockCompilerSecurityRealm as CompilerSecurityBootstrapModule['lockCompilerSecurityRealm'])();
  // Vite exposes SSR namespaces through a framework-owned proxy whose descriptors may be freshly
  // materialized per read. The namespace was loaded before authored code, so a direct fixed-name
  // export read is the correct boundary here (caller objects still use descriptor snapshots).
  const kovo = module.kovo;
  if (typeof kovo !== 'function') throw new TypeError('@kovojs/server/vite must export kovo.');
  return { kovo: kovo as DevSecurityProfileModule['kovo'] };
}

async function loadAuthoredDevConfig(
  server: Pick<ViteDevServer, 'ssrLoadModule'>,
  configFile: string | undefined,
  root: string,
  mode: string,
): Promise<UserConfig> {
  if (configFile === undefined) return {};
  const module = await server.ssrLoadModule(viteSsrModuleId(configFile, root));
  const exported = module.default;
  const value =
    typeof exported === 'function'
      ? await nativeApply(exported, undefined, [{ command: 'serve', isPreview: false, mode }])
      : await exported;
  if (!isRecord(value)) {
    throw new TypeError(`Authored Vite config ${configFile} must default-export a config object.`);
  }
  return value as UserConfig;
}

function authoredVitePlugins(config: UserConfig): PluginOption[] {
  const value = buildOwnDataValue(config, 'plugins', 'Authored Vite config');
  if (value === undefined) return [];
  if (!buildArrayIsArray(value)) {
    throw new TypeError('Authored Vite config plugins must be a dense array.');
  }
  const plugins = buildSnapshotDenseArray(value, 'Authored Vite plugins');
  const result: PluginOption[] = [];
  for (let index = 0; index < plugins.length; index += 1) {
    const plugin = plugins[index] as PluginOption;
    if (isDirectKovoPlugin(plugin)) continue;
    result[result.length] = plugin;
  }
  return result;
}

function isDirectKovoPlugin(value: PluginOption): boolean {
  if (!isRecord(value) || buildArrayIsArray(value)) return false;
  return buildOwnDataValue(value, 'name', 'Authored Vite plugin') === 'kovo';
}

function freezeFrameworkPlugin<Value extends object>(value: Value): Value {
  return nativeApply(nativeObjectFreeze, NativeObject, [value]) as Value;
}

function nativeApply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !buildArrayIsArray(value);
}

function resolveDevConfigFile(root: string, configured: string | undefined): string | undefined {
  if (configured !== undefined) {
    const resolved = resolve(configured);
    if (!existsSync(resolved)) throw new Error(`kovo dev config does not exist: ${resolved}`);
    return resolved;
  }
  for (const fileName of DEFAULT_VITE_CONFIG_FILES) {
    const candidate = resolve(root, fileName);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function viteAppModuleId(appModulePath: string, root: string): string {
  const relativePath = relative(root, resolve(appModulePath));
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('kovo dev app module must stay within --root.');
  }
  return `/${relativePath.split(/[\\/]/u).join('/')}`;
}

function viteSsrModuleId(filePath: string, root: string): string {
  const relativePath = relative(root, filePath);
  if (
    relativePath !== '' &&
    !relativePath.startsWith('..') &&
    !relativePath.startsWith('/') &&
    !/^[A-Za-z]:/u.test(relativePath)
  ) {
    return `/${relativePath.split(/[\\/]/u).join('/')}`;
  }
  return pathToFileURL(filePath).href;
}
