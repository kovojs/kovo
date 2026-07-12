import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  InlineConfig,
  PartialEnvironment,
  Plugin,
  PluginOption,
  ResolvedConfig,
  UserConfig,
  ViteDevServer,
} from 'vite-plus';

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
  buildObjectKeys,
  buildOwnDataValue,
  buildSnapshotDenseArray,
} from './build-security-intrinsics.js';

const NativeFunction = globalThis.Function;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativePromise = globalThis.Promise;
const NativeReflect = globalThis.Reflect;
const nativeFunctionHasInstance = NativeFunction.prototype[Symbol.hasInstance];
const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
const nativeObjectFreeze = NativeObject.freeze;
const nativeObjectCreate = NativeObject.create;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativePromiseThen = NativePromise.prototype.then;
const nativeReflectApply = NativeReflect.apply;
const isolatedAuthoredPlugin = Symbol('Kovo isolated authored Vite plugin');

const AUTHORITY_BEARING_AUTHORED_PLUGIN_HOOKS = [
  'buildApp',
  'applyToEnvironment',
  'config',
  'configEnvironment',
  'configResolved',
  'configurePreviewServer',
  'configureServer',
  'handleHotUpdate',
  'hotUpdate',
  'transformIndexHtml',
] as const;
const SUPPORTED_AUTHORED_CLIENT_PLUGIN_HOOKS = ['load', 'resolveId', 'transform'] as const;
const IGNORED_NON_DEV_CONFIG_KEYS = ['build', 'fmt', 'lint', 'run', 'test'] as const;

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
    const createdPlugin = profile.trustedKovoVitePlugin({
      app: viteAppModuleId(options.appModulePath, root),
    });
    if (!isRecord(createdPlugin)) {
      throw new TypeError('@kovojs/server/vite kovo() must return a plugin object.');
    }
    const kovoPlugin = freezeFrameworkPlugin(createdPlugin) as PluginOption;
    const authoredConfig = snapshotSupportedAuthoredDevConfig(
      await loadAuthoredDevConfig(bootstrapServer, configFile, root, options.mode),
    );
    const authoredPlugins = isolateAuthoredDevPluginOptions(authoredConfig.plugins);
    const securityProfile = createDevSecurityProfilePlugins(kovoPlugin);
    const livePlugins = fixedDevPluginArray(
      securityProfile.prePlugin,
      kovoPlugin,
      authoredPlugins,
      securityProfile.postPlugin,
    );
    const liveConfig = trustedLiveDevConfig(root, options, authoredConfig.server, livePlugins);

    liveServer = await createServer(liveConfig);
    lockLiveDevEnvironmentPluginLists(liveServer.config);
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
  trustedKovoVitePlugin(options: { app: string }): Exclude<PluginOption, false | null | undefined>;
}

interface CompilerSecurityBootstrapModule {
  lockCompilerSecurityRealm(): void;
}

interface SupportedAuthoredDevConfig {
  plugins: PluginOption[];
  server: SupportedAuthoredDevServer;
}

interface SupportedAuthoredDevServer {
  host?: boolean | string;
  port?: number;
  strictPort?: boolean;
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
    viteSsrModuleId(requireFromApp.resolve('@kovojs/server/internal/vite-security-profile'), root),
  );
  // The complete trusted graph captures descriptor-based Web/Node controls first. Lock the realm
  // at the last trusted boundary, immediately before constructing the framework plugin and loading
  // the authored config; modules that intentionally capture data descriptors must not observe the
  // lockdown accessors as if they were host-native descriptors.
  (lockCompilerSecurityRealm as CompilerSecurityBootstrapModule['lockCompilerSecurityRealm'])();
  // Vite exposes SSR namespaces through a framework-owned proxy whose descriptors may be freshly
  // materialized per read. The namespace was loaded before authored code, so a direct fixed-name
  // export read is the correct boundary here (caller objects still use descriptor snapshots).
  const trustedKovoVitePlugin = module.trustedKovoVitePlugin;
  if (typeof trustedKovoVitePlugin !== 'function') {
    throw new TypeError(
      '@kovojs/server/internal/vite-security-profile must export trustedKovoVitePlugin.',
    );
  }
  return {
    trustedKovoVitePlugin:
      trustedKovoVitePlugin as DevSecurityProfileModule['trustedKovoVitePlugin'],
  };
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

function snapshotSupportedAuthoredDevConfig(config: UserConfig): SupportedAuthoredDevConfig {
  let plugins: PluginOption[] = [];
  let server: SupportedAuthoredDevServer = {};
  const keys = buildObjectKeys(config);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const value = buildOwnDataValue(config, key, 'Authored Vite config');
    if (key === 'plugins') {
      if (value === undefined) continue;
      if (!buildArrayIsArray(value)) {
        throw new TypeError('Authored Vite config plugins must be a dense array.');
      }
      plugins = buildSnapshotDenseArray(value as PluginOption[], 'Authored Vite plugins');
      continue;
    }
    if (key === 'server') {
      server = snapshotSupportedAuthoredDevServer(value);
      continue;
    }
    if (isIgnoredNonDevConfigKey(key)) continue;
    throw new TypeError(
      `kovo dev rejects authored Vite config key ${key}: the supported secure config surface is limited to client-only plugins and server host/port/strictPort; build/test/lint/fmt/run sections are ignored.`,
    );
  }
  return { plugins, server };
}

function isIgnoredNonDevConfigKey(key: string): boolean {
  for (let index = 0; index < IGNORED_NON_DEV_CONFIG_KEYS.length; index += 1) {
    if (IGNORED_NON_DEV_CONFIG_KEYS[index] === key) return true;
  }
  return false;
}

function snapshotSupportedAuthoredDevServer(value: unknown): SupportedAuthoredDevServer {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new TypeError('Authored Vite config server must be a record.');
  const result: SupportedAuthoredDevServer = {};
  const keys = buildObjectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const entry = buildOwnDataValue(value, key, 'Authored Vite server config');
    if (key === 'host' && (typeof entry === 'boolean' || typeof entry === 'string')) {
      result.host = entry;
      continue;
    }
    if (
      key === 'port' &&
      typeof entry === 'number' &&
      nativeApply(nativeNumberIsSafeInteger, NativeNumber, [entry]) &&
      entry >= 0 &&
      entry <= 65_535
    ) {
      result.port = entry;
      continue;
    }
    if (key === 'strictPort' && typeof entry === 'boolean') {
      result.strictPort = entry;
      continue;
    }
    throw new TypeError(
      `kovo dev rejects authored Vite server key ${key}: only host, port, and strictPort are supported.`,
    );
  }
  return result;
}

/** @internal Descriptor-witnessed client plugin isolation used by the supported dev runner. */
export function isolateAuthoredDevPluginOptions(options: readonly PluginOption[]): PluginOption[] {
  const source = buildSnapshotDenseArray(options, 'Authored Vite plugins');
  const result: PluginOption[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const option = source[index]!;
    if (isDirectKovoPlugin(option)) continue;
    result[result.length] = isolateAuthoredPluginOption(option);
  }
  return freezeFrameworkPlugin(result);
}

function trustedLiveDevConfig(
  root: string,
  options: KovoDevOptions,
  authoredServer: SupportedAuthoredDevServer,
  plugins: PluginOption[],
): InlineConfig {
  const server: NonNullable<InlineConfig['server']> = {};
  if (authoredServer.host !== undefined) server.host = authoredServer.host;
  if (authoredServer.port !== undefined) server.port = authoredServer.port;
  if (authoredServer.strictPort !== undefined) server.strictPort = authoredServer.strictPort;
  if (options.host !== undefined) server.host = options.host;
  if (options.port !== undefined) server.port = options.port;
  if (options.strictPort) server.strictPort = true;

  return {
    appType: 'custom',
    assetsInclude: [],
    configFile: false,
    define: {},
    environments: { ssr: trustedSsrEnvironmentConfig() },
    esbuild: undefined,
    experimental: { bundledDev: false },
    logLevel: 'error',
    mode: options.mode,
    oxc: undefined,
    plugins,
    resolve: trustedRootResolveConfig(),
    root,
    server,
    ssr: trustedSsrConfig(),
  };
}

function trustedRootResolveConfig(): NonNullable<InlineConfig['resolve']> {
  return { alias: [], preserveSymlinks: false, tsconfigPaths: false };
}

function trustedSsrConfig(): NonNullable<InlineConfig['ssr']> {
  return {
    external: [],
    noExternal: [/^@kovojs\//],
    optimizeDeps: trustedSsrOptimizeDeps(),
    target: 'node',
  };
}

function trustedSsrEnvironmentConfig(): NonNullable<
  NonNullable<InlineConfig['environments']>['ssr']
> {
  return {
    consumer: 'server',
    define: {},
    dev: { moduleRunnerTransform: true },
    isBundled: false,
    optimizeDeps: trustedSsrOptimizeDeps(),
    resolve: { external: [], noExternal: [/^@kovojs\//] },
  };
}

function fixedDevPluginArray(
  prePlugin: Plugin,
  kovoPlugin: PluginOption,
  authoredPlugins: readonly PluginOption[],
  postPlugin: Plugin,
): PluginOption[] {
  const source = buildSnapshotDenseArray(authoredPlugins, 'Isolated authored Vite plugins');
  const result: PluginOption[] = [prePlugin, kovoPlugin];
  for (let index = 0; index < source.length; index += 1) {
    result[result.length] = source[index]!;
  }
  result[result.length] = postPlugin;
  return freezeFrameworkPlugin(result);
}

/**
 * Keep caller plugins out of the authority-bearing SSR environment. Client graph transforms remain
 * available, but app-level lifecycle hooks that receive the mutable root config or live server are
 * rejected because those capabilities cannot be narrowed to the client environment.
 */
function isolateAuthoredPluginOption(option: PluginOption): PluginOption {
  if (option === false || option === null || option === undefined) return option;
  if (buildArrayIsArray(option)) {
    const source = buildSnapshotDenseArray(option, 'Nested authored Vite plugin options');
    const nested: PluginOption[] = [];
    for (let index = 0; index < source.length; index += 1) {
      nested[nested.length] = isolateAuthoredPluginOption(source[index]!);
    }
    return freezeFrameworkPlugin(nested);
  }
  if (isNativePromise(option)) {
    return new NativePromise((resolvePromise, rejectPromise) => {
      nativeApply(nativePromiseThen, option, [
        (resolved: PluginOption) => {
          try {
            resolvePromise(isolateAuthoredPluginOption(resolved));
          } catch (error) {
            rejectPromise(error);
          }
        },
        rejectPromise,
      ]);
    });
  }
  if (!isRecord(option)) {
    throw new TypeError('Authored Vite plugin options must be plugins, dense arrays, or promises.');
  }
  if (buildOwnDataValue(option, 'then', 'Authored Vite plugin') !== undefined) {
    throw new TypeError('Authored Vite plugin thenables must be native promises.');
  }
  if (buildOwnDataValue(option, isolatedAuthoredPlugin, 'Authored Vite plugin') === true) {
    return option as Plugin;
  }

  for (let index = 0; index < AUTHORITY_BEARING_AUTHORED_PLUGIN_HOOKS.length; index += 1) {
    const hookName = AUTHORITY_BEARING_AUTHORED_PLUGIN_HOOKS[index]!;
    if (buildOwnDataValue(option, hookName, 'Authored Vite plugin') !== undefined) {
      // These app-level hooks receive the mutable root config or live Vite server, even when the
      // plugin is excluded from the SSR environment. A client plugin could otherwise retain that
      // authority and rewrite the protected SSR graph after the final config hook or on HMR.
      throw new TypeError(
        `kovo dev rejects authored Vite plugin ${hookName}: supported plugins are client-environment transforms and cannot receive the authority-bearing root config or live server.`,
      );
    }
  }

  const wrapper = nativeApply<Record<PropertyKey, unknown>>(nativeObjectCreate, NativeObject, [
    null,
  ]);
  const name = buildOwnDataValue(option, 'name', 'Authored Vite plugin');
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('Authored Vite plugins must have a non-empty own data name.');
  }
  defineFixedData(wrapper, 'name', name, true);

  const enforce = buildOwnDataValue(option, 'enforce', 'Authored Vite plugin');
  if (enforce !== undefined && enforce !== 'pre' && enforce !== 'post') {
    throw new TypeError('Authored Vite plugin enforce must be "pre" or "post".');
  }
  if (enforce !== undefined) defineFixedData(wrapper, 'enforce', enforce, true);

  const keys = buildObjectKeys(option);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (
      key === 'apply' ||
      key === 'applyToEnvironment' ||
      key === 'enforce' ||
      key === 'name' ||
      isAuthorityBearingAuthoredPluginHook(key)
    ) {
      continue;
    }
    if (!isSupportedAuthoredClientPluginHook(key)) {
      throw new TypeError(
        `kovo dev rejects authored Vite plugin property ${key}: supported client hooks are resolveId, load, and transform.`,
      );
    }
    const value = buildOwnDataValue(option, key, 'Authored Vite plugin');
    if (typeof value === 'function') {
      defineFixedData(wrapper, key, value, true);
      continue;
    }
    if (isRecord(value)) {
      defineFixedData(wrapper, key, snapshotClientPluginHook(value, key), true);
      continue;
    }
    throw new TypeError(
      `kovo dev rejects authored Vite plugin property ${key}: client hook values must be functions or fixed { handler, order } records.`,
    );
  }
  const originalCommandApply = buildOwnDataValue(option, 'apply', 'Authored Vite plugin');
  if (typeof originalCommandApply === 'function') {
    // Vite invokes function-valued `apply` before it snapshots/sorts the plugin registry. Giving a
    // caller function that mutable config would let it replace the trusted pre/post plugins before
    // their hooks exist. Static serve/build disposition is exact and sufficient for this runner.
    throw new TypeError(
      'kovo dev requires authored Vite plugin apply to be the static "serve" or "build" disposition, not a config callback.',
    );
  }
  if (
    originalCommandApply !== undefined &&
    originalCommandApply !== 'serve' &&
    originalCommandApply !== 'build'
  ) {
    throw new TypeError('Authored Vite plugin apply must be "serve" or "build".');
  }
  if (originalCommandApply !== undefined) {
    defineFixedData(wrapper, 'apply', originalCommandApply, true);
  }
  defineFixedData(
    wrapper,
    'applyToEnvironment',
    function kovoAuthoredPluginEnvironmentGate(environment: PartialEnvironment) {
      // The server/compiler/data-plane graph is a framework-owned trust root (SPEC §6.6 rule 6).
      // Authored plugins remain available to Vite's client environment only.
      return environment.name === 'client';
    },
    true,
  );
  defineFixedData(wrapper, isolatedAuthoredPlugin, true, false);
  return freezeFrameworkPlugin(wrapper) as Plugin;
}

function isAuthorityBearingAuthoredPluginHook(key: string): boolean {
  for (let index = 0; index < AUTHORITY_BEARING_AUTHORED_PLUGIN_HOOKS.length; index += 1) {
    if (AUTHORITY_BEARING_AUTHORED_PLUGIN_HOOKS[index] === key) return true;
  }
  return false;
}

function isSupportedAuthoredClientPluginHook(key: string): boolean {
  for (let index = 0; index < SUPPORTED_AUTHORED_CLIENT_PLUGIN_HOOKS.length; index += 1) {
    if (SUPPORTED_AUTHORED_CLIENT_PLUGIN_HOOKS[index] === key) return true;
  }
  return false;
}

function snapshotClientPluginHook(value: Record<string, unknown>, hookName: string): object {
  const keys = buildObjectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (key !== 'handler' && key !== 'order') {
      throw new TypeError(
        `kovo dev rejects authored Vite plugin ${hookName}.${key}: hook records support only fixed handler and order fields.`,
      );
    }
  }
  const handler = buildOwnDataValue(value, 'handler', `Authored Vite plugin ${hookName}`);
  if (typeof handler !== 'function') {
    throw new TypeError(`Authored Vite plugin ${hookName}.handler must be a function.`);
  }
  const order = buildOwnDataValue(value, 'order', `Authored Vite plugin ${hookName}`);
  if (order !== undefined && order !== 'pre' && order !== 'post') {
    throw new TypeError(`Authored Vite plugin ${hookName}.order must be "pre" or "post".`);
  }
  const snapshot = nativeApply<Record<PropertyKey, unknown>>(nativeObjectCreate, NativeObject, [
    null,
  ]);
  defineFixedData(snapshot, 'handler', handler, true);
  if (order !== undefined) defineFixedData(snapshot, 'order', order, true);
  return freezeFrameworkPlugin(snapshot);
}

function createDevSecurityProfilePlugins(kovoPlugin: PluginOption): {
  postPlugin: Plugin;
  prePlugin: Plugin;
} {
  const prePlugin = freezeFrameworkPlugin<Plugin>({
    enforce: 'pre',
    name: 'kovo-security-profile-pre',
    configResolved: {
      order: 'pre',
      handler(config) {
        lockResolvedDevSecurityProfile(config);
      },
    },
  });
  const postPlugin: Plugin = {
    enforce: 'post',
    name: 'kovo-security-profile-post',
    config: {
      order: 'post',
      handler(config) {
        // Rebuild every authority-bearing root/SSR option from framework-owned data after the
        // trusted Kovo hook. Authored config is never spread or merged into this graph.
        config.assetsInclude = [];
        config.define = {};
        config.esbuild = undefined;
        config.environments = { ssr: trustedSsrEnvironmentConfig() };
        config.experimental = { bundledDev: false };
        config.resolve = trustedRootResolveConfig();
        config.oxc = undefined;
        config.ssr = trustedSsrConfig();

        const configured = buildOwnDataValue(config, 'plugins', 'Vite config');
        const configuredPlugins = buildArrayIsArray(configured)
          ? buildSnapshotDenseArray(configured, 'Resolved authored Vite plugins')
          : [];
        const isolated: PluginOption[] = [];
        for (let index = 0; index < configuredPlugins.length; index += 1) {
          const candidate = configuredPlugins[index]!;
          if (candidate === kovoPlugin || candidate === prePlugin || candidate === postPlugin) {
            continue;
          }
          isolated[isolated.length] = isolateAuthoredPluginOption(candidate);
        }
        config.plugins = fixedDevPluginArray(prePlugin, kovoPlugin, isolated, postPlugin);
      },
    },
  };
  return { postPlugin: freezeFrameworkPlugin(postPlugin), prePlugin };
}

function trustedSsrOptimizeDeps(): NonNullable<UserConfig['optimizeDeps']> {
  return {
    disabled: true,
    exclude: [],
    include: [],
    noDiscovery: true,
  };
}

function lockResolvedDevSecurityProfile(config: ResolvedConfig): void {
  // Vite resolves environments only after configResolved hooks. Lock the exact plugin registry
  // first so a caller hook cannot push an unwrapped SSR plugin, replace a framework hook, or
  // reorder the trusted pre/post profile between those two phases.
  const pluginCarrier = buildOwnDataValue(config, 'plugins', 'Resolved Vite config');
  if (!buildArrayIsArray(pluginCarrier)) {
    throw new TypeError('Resolved Vite config must expose a plugin array.');
  }
  const resolvedPlugins = buildSnapshotDenseArray(pluginCarrier, 'Resolved Vite plugins');
  for (let index = 0; index < resolvedPlugins.length; index += 1) {
    freezeFrameworkPlugin(resolvedPlugins[index]!);
  }
  freezeFrameworkPlugin(pluginCarrier);
  defineFixedData(config, 'plugins', pluginCarrier, true);
  const getSortedPlugins = buildOwnDataValue(config, 'getSortedPlugins', 'Resolved Vite config');
  const getSortedPluginHooks = buildOwnDataValue(
    config,
    'getSortedPluginHooks',
    'Resolved Vite config',
  );
  if (typeof getSortedPlugins !== 'function' || typeof getSortedPluginHooks !== 'function') {
    throw new TypeError('Resolved Vite config must expose fixed plugin hook selectors.');
  }
  defineFixedData(config, 'getSortedPlugins', getSortedPlugins, true);
  defineFixedData(config, 'getSortedPluginHooks', getSortedPluginHooks, true);

  lockResolvedAliases(config.resolve.alias);
  freezeFrameworkPlugin(config.resolve);
  defineFixedData(config, 'resolve', config.resolve, true);
  freezeFrameworkPlugin(config.ssr.external);
  if (buildArrayIsArray(config.ssr.noExternal)) freezeFrameworkPlugin(config.ssr.noExternal);
  freezeFrameworkPlugin(config.ssr);
  defineFixedData(config, 'ssr', config.ssr, true);

  const environmentNames = buildObjectKeys(config.environments);
  for (let index = 0; index < environmentNames.length; index += 1) {
    const environmentName = environmentNames[index]!;
    const environment = buildOwnDataValue(
      config.environments,
      environmentName,
      'Resolved Vite environments',
    );
    if (!isRecord(environment)) continue;
    const resolveConfig = buildOwnDataValue(
      environment,
      'resolve',
      `Resolved Vite environment ${environmentName}`,
    );
    if (!isRecord(resolveConfig)) continue;
    const alias = buildOwnDataValue(
      resolveConfig,
      'alias',
      `Resolved Vite environment ${environmentName} resolve`,
    );
    if (buildArrayIsArray(alias)) lockResolvedAliases(alias);
    freezeFrameworkPlugin(resolveConfig);
    defineFixedData(environment, 'resolve', resolveConfig, true);
  }
  freezeFrameworkPlugin(config.environments);
  defineFixedData(config, 'environments', config.environments, true);
}

function lockLiveDevEnvironmentPluginLists(config: ResolvedConfig): void {
  const names = buildObjectKeys(config.environments);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const environment = buildOwnDataValue(
      config.environments,
      name,
      'Live resolved Vite environments',
    );
    if (!isRecord(environment)) continue;
    const plugins = buildOwnDataValue(environment, 'plugins', `Live Vite environment ${name}`);
    if (!buildArrayIsArray(plugins)) {
      throw new TypeError(`Live Vite environment ${name} must expose a plugin array.`);
    }
    const pluginSnapshot = buildSnapshotDenseArray(
      plugins,
      `Live Vite environment ${name} plugins`,
    );
    for (let pluginIndex = 0; pluginIndex < pluginSnapshot.length; pluginIndex += 1) {
      const plugin = pluginSnapshot[pluginIndex];
      if (isRecord(plugin)) freezeFrameworkPlugin(plugin);
    }
    freezeFrameworkPlugin(plugins);
    defineFixedData(environment, 'plugins', plugins, true);
  }
}

function lockResolvedAliases(alias: readonly unknown[]): void {
  const entries = buildSnapshotDenseArray(alias, 'Resolved Vite aliases');
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (isRecord(entry)) freezeFrameworkPlugin(entry);
  }
  freezeFrameworkPlugin(alias);
}

function isNativePromise(value: unknown): value is Promise<PluginOption> {
  return nativeApply(nativeFunctionHasInstance, NativePromise, [value]) === true;
}

function defineFixedData(
  target: object,
  key: PropertyKey,
  value: unknown,
  enumerable: boolean,
): void {
  nativeApply(nativeObjectDefineProperty, NativeObject, [
    target,
    key,
    {
      configurable: false,
      enumerable,
      value,
      writable: false,
    },
  ]);
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
  if (configured === undefined) return undefined;
  const resolved = resolve(root, configured);
  if (!existsSync(resolved)) throw new Error(`kovo dev config does not exist: ${resolved}`);
  return resolved;
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
