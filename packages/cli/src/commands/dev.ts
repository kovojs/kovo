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
  buildStringStartsWith,
} from './build-security-intrinsics.js';

const NativeFunction = globalThis.Function;
const NativeObject = globalThis.Object;
const NativePromise = globalThis.Promise;
const NativeReflect = globalThis.Reflect;
const NativeRegExp = globalThis.RegExp;
const nativeFunctionHasInstance = NativeFunction.prototype[Symbol.hasInstance];
const nativeObjectFreeze = NativeObject.freeze;
const nativeObjectCreate = NativeObject.create;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativePromiseThen = NativePromise.prototype.then;
const nativeReflectApply = NativeReflect.apply;
const isolatedAuthoredPlugin = Symbol('Kovo isolated authored Vite plugin');

const AUTHORITY_BEARING_AUTHORED_PLUGIN_HOOKS = [
  'buildApp',
  'config',
  'configEnvironment',
  'configResolved',
  'configurePreviewServer',
  'configureServer',
  'handleHotUpdate',
  'hotUpdate',
  'transformIndexHtml',
] as const;

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
    const createdPlugin = profile.trustedKovoVitePlugin({
      app: viteAppModuleId(options.appModulePath, root),
    });
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
    const authoredPlugins = authoredVitePlugins(authoredConfig).map(isolateAuthoredPluginOption);
    const [securityProfilePrePlugin, securityProfilePostPlugin] =
      createDevSecurityProfilePlugins(kovoPlugin);
    const liveConfig: InlineConfig = {
      ...authoredConfig,
      configFile: false,
      mode: options.mode,
      plugins: [
        securityProfilePrePlugin,
        kovoPlugin,
        ...authoredPlugins,
        securityProfilePostPlugin,
      ],
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
  trustedKovoVitePlugin(options: { app: string }): Exclude<PluginOption, false | null | undefined>;
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

/**
 * Keep caller plugins out of the authority-bearing SSR environment. Client graph transforms remain
 * available, but app-level lifecycle hooks that receive the mutable root config or live server are
 * rejected because those capabilities cannot be narrowed to the client environment.
 */
function isolateAuthoredPluginOption(option: PluginOption): PluginOption {
  if (option === false || option === null || option === undefined) return option;
  if (buildArrayIsArray(option)) {
    return buildSnapshotDenseArray(option, 'Nested authored Vite plugin options').map(
      isolateAuthoredPluginOption,
    );
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
  const keys = buildObjectKeys(option);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (key === 'apply' || key === 'applyToEnvironment') continue;
    defineFixedData(wrapper, key, buildOwnDataValue(option, key, 'Authored Vite plugin'), true);
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
  const originalApply = buildOwnDataValue(option, 'applyToEnvironment', 'Authored Vite plugin');
  if (originalApply !== undefined && typeof originalApply !== 'function') {
    throw new TypeError('Authored Vite plugin applyToEnvironment must be a function.');
  }
  defineFixedData(
    wrapper,
    'applyToEnvironment',
    function kovoAuthoredPluginEnvironmentGate(this: unknown, environment: PartialEnvironment) {
      // The server/compiler/data-plane graph is a framework-owned trust root (SPEC §6.6 rule 6).
      // Authored plugins remain available to Vite's client environment only.
      if (environment.name !== 'client') return false;
      return typeof originalApply === 'function'
        ? nativeApply(originalApply, this, [environment])
        : true;
    },
    true,
  );
  defineFixedData(wrapper, isolatedAuthoredPlugin, true, false);
  return freezeFrameworkPlugin(wrapper) as Plugin;
}

function createDevSecurityProfilePlugins(kovoPlugin: PluginOption): readonly [Plugin, Plugin] {
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
        // Hook-level ordering is explicit because Vite lets `{ order: 'post' }` override plugin
        // `enforce`. This handler must remain the final config observer even under that spelling.
        assertNoAuthoredKovoAliases(config.resolve?.alias);
        if (config.environments) {
          for (const environmentName of buildObjectKeys(config.environments)) {
            const environment = buildOwnDataValue(
              config.environments,
              environmentName,
              'Authored Vite environments',
            );
            if (!isRecord(environment)) continue;
            const resolveConfig = buildOwnDataValue(
              environment,
              'resolve',
              `Authored Vite environment ${environmentName}`,
            );
            if (isRecord(resolveConfig)) {
              assertNoAuthoredKovoAliases(
                buildOwnDataValue(
                  resolveConfig,
                  'alias',
                  `Authored Vite environment ${environmentName} resolve`,
                ) as UserConfig['resolve'] extends { alias?: infer Alias } ? Alias : never,
              );
            }
          }
        }

        // Reassert the exact SSR graph after Vite has merged the authored top-level config.
        // `external` is cleared because an authored rule can force a second package instance that
        // the trusted preload did not establish; noExternal keeps Kovo in one protected environment.
        config.ssr = {
          ...config.ssr,
          external: [],
          noExternal: [/^@kovojs\//],
        };

        const configuredPlugins = buildArrayIsArray(config.plugins)
          ? buildSnapshotDenseArray(config.plugins, 'Resolved authored Vite plugins')
          : [];
        const isolated: PluginOption[] = [];
        for (let index = 0; index < configuredPlugins.length; index += 1) {
          const candidate = configuredPlugins[index]!;
          if (candidate === kovoPlugin || candidate === prePlugin || candidate === postPlugin) {
            continue;
          }
          isolated[isolated.length] = isolateAuthoredPluginOption(candidate);
        }
        config.plugins = [prePlugin, kovoPlugin, ...isolated, postPlugin];
      },
    },
  };
  return [prePlugin, freezeFrameworkPlugin(postPlugin)];
}

function lockResolvedDevSecurityProfile(config: ResolvedConfig): void {
  // Vite resolves environments only after configResolved hooks. Lock the exact plugin registry
  // first so a caller hook cannot push an unwrapped SSR plugin, replace a framework hook, or
  // reorder the trusted pre/post profile between those two phases.
  for (let index = 0; index < config.plugins.length; index += 1) {
    freezeFrameworkPlugin(config.plugins[index]!);
  }
  freezeFrameworkPlugin(config.plugins);
  defineFixedData(config, 'plugins', config.plugins, true);

  lockResolvedAliases(config.resolve.alias);
  freezeFrameworkPlugin(config.resolve);
  defineFixedData(config, 'resolve', config.resolve, true);
  freezeFrameworkPlugin(config.ssr.external);
  if (buildArrayIsArray(config.ssr.noExternal)) freezeFrameworkPlugin(config.ssr.noExternal);
  freezeFrameworkPlugin(config.ssr);
  defineFixedData(config, 'ssr', config.ssr, true);

  for (const environmentName of buildObjectKeys(config.environments)) {
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

function lockResolvedAliases(alias: readonly unknown[]): void {
  const entries = buildSnapshotDenseArray(alias, 'Resolved Vite aliases');
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (isRecord(entry)) freezeFrameworkPlugin(entry);
  }
  freezeFrameworkPlugin(alias);
}

function assertNoAuthoredKovoAliases(
  alias: UserConfig['resolve'] extends {
    alias?: infer Alias;
  }
    ? Alias
    : never,
): void {
  if (alias === undefined) return;
  if (buildArrayIsArray(alias)) {
    const entries = buildSnapshotDenseArray(alias, 'Authored Vite resolve.alias');
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!isRecord(entry)) {
        throw new TypeError('Authored Vite resolve.alias entries must be records.');
      }
      const find = buildOwnDataValue(entry, 'find', 'Authored Vite resolve.alias entry');
      if (find instanceof NativeRegExp) {
        throw new TypeError(
          'kovo dev rejects RegExp resolve.alias entries because they cannot prove disjointness from the Kovo trust-root graph.',
        );
      }
      if (typeof find !== 'string') {
        throw new TypeError('Authored Vite resolve.alias find values must be strings.');
      }
      assertAliasDoesNotTargetKovo(find);
    }
    return;
  }
  if (!isRecord(alias)) {
    throw new TypeError('Authored Vite resolve.alias must be a record or dense array.');
  }
  const keys = buildObjectKeys(alias);
  for (let index = 0; index < keys.length; index += 1) assertAliasDoesNotTargetKovo(keys[index]!);
}

function assertAliasDoesNotTargetKovo(find: string): void {
  if (find === '@kovojs' || buildStringStartsWith(find, '@kovojs/')) {
    throw new TypeError(
      `kovo dev rejects resolve.alias for ${find}: @kovojs modules belong to the framework trust-root graph.`,
    );
  }
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
