// Vite plugin that compiles a fixture's authored Kovo components to their lowered
// IR (fixpoint) form on demand for integration fixtures.
//
// The stock `kovoVitePlugin` emits the `renderSource()` server module (a zero-arg
// HTML string used for the render-equivalence gate), which drops the authored
// `export const Foo = component(...)`. Fixtures instead need the *lowered* module
// that preserves `component()` so a route page can call `Foo.definition.render(data)`
// with live query results (SPEC §5.2).
import { compileComponentModule } from '@kovojs/compiler';
import {
  type ComponentCssAsset,
  type CompileResult,
  type ProjectMutationRegistryFacts,
} from '@kovojs/compiler/internal';
import type { Plugin } from 'vite';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/* eslint-disable typescript/unbound-method */

import {
  verifierApply,
  verifierArrayJoin,
  verifierArrayPush,
  verifierArraySort,
  verifierDenseArraySnapshot,
  verifierFreeze,
  verifierGetOwnPropertyDescriptor,
  verifierJsonStringify,
  verifierMap,
  verifierMapForEach,
  verifierMapGet,
  verifierMapHas,
  verifierMapSet,
  verifierRegExpExec,
  verifierStringEndsWith,
  verifierStringIncludes,
  verifierStringIndexOf,
  verifierStringReplaceAll,
  verifierStringSlice,
  verifierStringStartsWith,
  verifierUrlPathname,
} from '../verifier-security-intrinsics.js';

const nativePathIsAbsolute = path.isAbsolute;
const nativePathRelative = path.relative;
const nativePathResolve = path.resolve;
const nativePathSeparator = path.sep;
const nativeDecodeURIComponent = globalThis.decodeURIComponent;
const nativeProcessCwd = process.cwd;

const virtualCssManifestId = 'virtual:kovo-fixture-css-manifest';
const resolvedVirtualCssManifestId = `\0${virtualCssManifestId}`;
const virtualGeneratedQueryPlansId = 'virtual:kovo-fixture-generated-query-plans';

interface FixtureCssAsset extends ComponentCssAsset {
  source: string;
}

interface FixtureGeneratedClientModule {
  exportName?: string;
  fileName: string;
  id: string;
  queries: readonly string[];
  source: string;
}

interface FixtureQueryPlanIdentity {
  componentName: string;
  query: string;
}

interface FixtureCompileResultSnapshot {
  cssAssets: readonly ComponentCssAsset[];
  dependencyFootprint: object;
  diagnostics: CompileResult['diagnostics'];
  files: CompileResult['files'];
  loweredSource: string | undefined;
  queryPlanIdentities: readonly FixtureQueryPlanIdentity[];
}

export function kovoFixtureCompilerPlugin(
  compile: (
    options: Parameters<typeof compileComponentModule>[0],
  ) => CompileResult = compileComponentModule,
  projectMutationFacts?: ProjectMutationRegistryFacts,
): Plugin & { readonly fixtureCssRuntimeId: string } {
  const privateCssRegistrationId = `${virtualCssManifestId}:register:${randomUUID()}`;
  const resolvedPrivateCssRegistrationId = `\0${privateCssRegistrationId}`;
  const privateGeneratedQueryPlansId = `${virtualGeneratedQueryPlansId}:aggregate:${randomUUID()}`;
  const resolvedPrivateGeneratedQueryPlansId = `\0${privateGeneratedQueryPlansId}`;
  let root = pathResolve(verifierApply<string>(nativeProcessCwd, process, []));
  let configurationEpoch = 0;
  const cssAssets = verifierMap<string, FixtureCssAsset>();
  const generatedClientModules = verifierMap<string, FixtureGeneratedClientModule>();

  return {
    name: 'kovo-fixture-compiler',
    enforce: 'pre',
    // bootFixture preloads this unguessable module before authored SSR dependencies. Its captured
    // controls therefore remain authoritative even when a fixture later poisons shared prototypes.
    fixtureCssRuntimeId: privateCssRegistrationId,
    configResolved(config) {
      const configuredRoot = ownData(config, 'root', 'fixture Vite config');
      if (typeof configuredRoot !== 'string') {
        throw new TypeError('Fixture Vite config.root must be a stable own string.');
      }
      root = pathResolve(configuredRoot);
      configurationEpoch += 1;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = verifierApply<string>(nativeDecodeURIComponent, undefined, [
          verifierUrlPathname(req.url ?? '/', 'http://fixture.local'),
        ]);
        const asset = verifierMapGet(cssAssets, pathname);
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
      if (id === virtualCssManifestId) return resolvedVirtualCssManifestId;
      if (id === privateCssRegistrationId) return resolvedPrivateCssRegistrationId;
      if (id === virtualGeneratedQueryPlansId) return resolvedPrivateGeneratedQueryPlansId;
      if (verifierMapHas(generatedClientModules, cleanModulePath(id))) {
        return cleanModulePath(id);
      }
      return null;
    },
    load(id) {
      if (id === resolvedVirtualCssManifestId) {
        return `export { kovoFixtureStylesheetManifest, kovoFixtureStylesheetsForTargets } from ${jsonString(privateCssRegistrationId)};`;
      }
      if (id === resolvedPrivateGeneratedQueryPlansId) {
        return generatedQueryPlanAggregateSource(generatedClientModules);
      }
      const generatedClient = verifierMapGet(generatedClientModules, cleanModulePath(id));
      if (generatedClient !== undefined) return generatedClient.source;
      if (id !== resolvedPrivateCssRegistrationId) return null;

      return `
const NativeArray = globalThis.Array;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeTypeError = globalThis.TypeError;
const nativeArrayIsArray = NativeArray.isArray;
const nativeDefineProperty = NativeObject.defineProperty;
const nativeGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeReflectApply = NativeReflect.apply;

function apply(method, receiver, args) {
  return nativeReflectApply(method, receiver, args);
}
function ownData(value, property, label) {
  if (typeof value !== 'object' || value === null) {
    throw new NativeTypeError(label + ' must be an object.');
  }
  const first = apply(nativeGetOwnPropertyDescriptor, NativeObject, [value, property]);
  const second = apply(nativeGetOwnPropertyDescriptor, NativeObject, [value, property]);
  if (
    first === undefined ||
    second === undefined ||
    !('value' in first) ||
    !('value' in second) ||
    first.value !== second.value
  ) {
    throw new NativeTypeError(label + '.' + property + ' must be stable own data.');
  }
  return first.value;
}
function optionalOwnData(value, property, label) {
  if (typeof value !== 'object' || value === null) {
    throw new NativeTypeError(label + ' must be an object.');
  }
  const first = apply(nativeGetOwnPropertyDescriptor, NativeObject, [value, property]);
  const second = apply(nativeGetOwnPropertyDescriptor, NativeObject, [value, property]);
  if (first === undefined && second === undefined) return undefined;
  if (
    first === undefined ||
    second === undefined ||
    !('value' in first) ||
    !('value' in second) ||
    first.value !== second.value
  ) {
    throw new NativeTypeError(label + '.' + property + ' must be stable own data.');
  }
  return first.value;
}
function append(values, value) {
  apply(nativeDefineProperty, NativeObject, [values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  }]);
}
function denseStrings(values, label) {
  if (!apply(nativeArrayIsArray, NativeArray, [values])) {
    throw new NativeTypeError(label + ' must be an array.');
  }
  const out = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = ownData(values, index, label);
    if (typeof value !== 'string') throw new NativeTypeError(label + ' must contain strings.');
    append(out, value);
  }
  return out;
}
let registered = [];
function copyUsages(values) {
  if (values === undefined) return [];
  if (!apply(nativeArrayIsArray, NativeArray, [values])) {
    throw new NativeTypeError('Fixture stylesheet usages must be an array.');
  }
  const out = [];
  for (let index = 0; index < (values ?? []).length; index += 1) {
    const value = ownData(values, index, 'Fixture stylesheet usages');
    append(out, {
      className: ownData(value, 'className', 'Fixture stylesheet usage'),
      moduleFileName: ownData(value, 'moduleFileName', 'Fixture stylesheet usage'),
      source: ownData(value, 'source', 'Fixture stylesheet usage'),
      styleRef: ownData(value, 'styleRef', 'Fixture stylesheet usage'),
    });
  }
  return out;
}
function copyAsset(value) {
  const usages = optionalOwnData(value, 'styleRuleUsages', 'Fixture stylesheet asset');
  return {
    componentName: ownData(value, 'componentName', 'Fixture stylesheet asset'),
    cspHash: optionalOwnData(value, 'cspHash', 'Fixture stylesheet asset'),
    fragmentTargets: denseStrings(
      ownData(value, 'fragmentTargets', 'Fixture stylesheet asset'),
      'Fixture stylesheet fragment targets',
    ),
    href: ownData(value, 'href', 'Fixture stylesheet asset'),
    preload: optionalOwnData(value, 'preload', 'Fixture stylesheet asset'),
    sourceFileName: ownData(value, 'sourceFileName', 'Fixture stylesheet asset'),
    styleRuleUsages: copyUsages(usages),
  };
}

function dedupe(values) {
  const out = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = ownData(values, index, 'Fixture stylesheet candidates');
    if (!value || typeof value.href !== 'string') continue;
    let duplicate = false;
    for (let seenIndex = 0; seenIndex < out.length; seenIndex += 1) {
      if (ownData(out, seenIndex, 'Fixture stylesheet output').href === value.href) duplicate = true;
    }
    if (duplicate) continue;
    append(out, value);
  }
  return out;
}
export function kovoFixtureRegisterStylesheets(values) {
  if (!apply(nativeArrayIsArray, NativeArray, [values])) {
    throw new NativeTypeError('Fixture stylesheet registration must be an array.');
  }
  const combined = [];
  for (let index = 0; index < registered.length; index += 1) {
    append(combined, ownData(registered, index, 'Registered fixture stylesheets'));
  }
  for (let index = 0; index < values.length; index += 1) {
    append(combined, copyAsset(ownData(values, index, 'Fixture stylesheet registration')));
  }
  registered = dedupe(combined);
}
export function kovoFixtureStylesheetManifest() {
  const output = [];
  for (let index = 0; index < registered.length; index += 1) {
    append(output, copyAsset(ownData(registered, index, 'Registered fixture stylesheets')));
  }
  return dedupe(output);
}
export function kovoFixtureStylesheetsForTargets(targets) {
  if (!targets) return kovoFixtureStylesheetManifest();
  const wanted = denseStrings(targets, 'Fixture stylesheet targets');
  const selected = [];
  for (let assetIndex = 0; assetIndex < registered.length; assetIndex += 1) {
    const asset = ownData(registered, assetIndex, 'Registered fixture stylesheets');
    const fragmentTargets = ownData(asset, 'fragmentTargets', 'Registered fixture stylesheet');
    for (let targetIndex = 0; targetIndex < fragmentTargets.length; targetIndex += 1) {
      const target = ownData(fragmentTargets, targetIndex, 'Fixture stylesheet fragment targets');
      for (let wantedIndex = 0; wantedIndex < wanted.length; wantedIndex += 1) {
        if (target === ownData(wanted, wantedIndex, 'Fixture stylesheet targets')) {
          append(selected, copyAsset(asset));
          targetIndex = fragmentTargets.length;
          break;
        }
      }
    }
  }
  return dedupe(selected);
}
`;
    },
    async transform(source, id) {
      // Same claim rule as kovoVitePlugin: a `.tsx`/`.ts` module that declares a
      // Kovo component. (The plugin matches the component-call token as source
      // text, so non-component modules must keep it out of comments.)
      // Framework packages are also compiled through this `ssr.noExternal` graph. They are not
      // fixture-authored source and must never be reclassified by an app compiler pass merely
      // because implementation text contains the claim token.
      if (
        !fixtureAuthoredModule(id, root) ||
        verifierRegExpExec(/\.[cm]?tsx?$/, cleanModulePath(id)) === null ||
        !verifierStringIncludes(source, 'component(')
      ) {
        return null;
      }

      const transformRoot = root;
      const transformConfigurationEpoch = configurationEpoch;
      const fileName = fixtureComponentFileName(id, transformRoot);
      const compileOptions = {
        fileName,
        packagePrefixDiscoveryRoot: transformRoot,
        ...(projectMutationFacts?.mutationBindings.length
          ? { registryFacts: projectMutationFacts }
          : {}),
        source,
      };
      const result = await snapshotCompileResult(compile(compileOptions));
      if (configurationEpoch !== transformConfigurationEpoch || root !== transformRoot) {
        throw new Error('Fixture Vite configuration changed while a component was compiled.');
      }

      const errors: CompileResult['diagnostics'][number][] = [];
      for (let index = 0; index < result.diagnostics.length; index += 1) {
        const diagnostic = result.diagnostics[index];
        if (diagnostic?.severity === 'error') verifierArrayPush(errors, diagnostic);
      }
      if (errors.length > 0) {
        const messages: string[] = [];
        for (let index = 0; index < errors.length; index += 1) {
          const diagnostic = errors[index];
          if (diagnostic) {
            verifierArrayPush(messages, `  ${diagnostic.code}: ${diagnostic.message}`);
          }
        }
        throw new Error(`Kovo compile error in ${fileName}:\n${verifierArrayJoin(messages, '\n')}`);
      }

      for (let assetIndex = 0; assetIndex < result.cssAssets.length; assetIndex += 1) {
        const asset = result.cssAssets[assetIndex] as ComponentCssAsset;
        let cssSource = asset.criticalCss ?? '';
        for (let fileIndex = 0; fileIndex < result.files.length; fileIndex += 1) {
          const file = result.files[fileIndex];
          if (file?.kind === 'css' && file.fileName === asset.sourceFileName) {
            cssSource = file.source;
            break;
          }
        }
        verifierMapSet(cssAssets, asset.href, verifierFreeze({ ...asset, source: cssSource }));
      }

      registerGeneratedClientModule(generatedClientModules, result, fileName, transformRoot);

      const code = result.loweredSource;
      if (typeof code !== 'string') return null;
      return verifierFreeze({
        code: `${code}\n${cssRuntimeRegistration(result.cssAssets, privateCssRegistrationId)}`,
        map: null,
      });
    },
  };
}

function snapshotCompileResult(value: unknown): FixtureCompileResultSnapshot {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Fixture compiler result must be an object.');
  }
  const diagnostics = verifierDenseArraySnapshot(
    ownData(value, 'diagnostics', 'fixture compiler result') ?? [],
    'fixture compiler diagnostics',
    (diagnostic, index) => {
      if (typeof diagnostic !== 'object' || diagnostic === null) {
        throw new TypeError(`Fixture compiler diagnostic ${index} must be an object.`);
      }
      const severity = requiredString(
        diagnostic,
        'severity',
        `fixture compiler diagnostic ${index}`,
      );
      if (
        severity !== 'error' &&
        severity !== 'warn' &&
        severity !== 'lint' &&
        severity !== 'notice'
      ) {
        throw new TypeError(`Fixture compiler diagnostic ${index} has invalid severity.`);
      }
      return verifierFreeze({
        code: requiredString(diagnostic, 'code', `fixture compiler diagnostic ${index}`),
        message: requiredString(diagnostic, 'message', `fixture compiler diagnostic ${index}`),
        severity,
      });
    },
  ) as CompileResult['diagnostics'];
  const cssAssets = verifierDenseArraySnapshot(
    ownData(value, 'cssAssets', 'fixture compiler result') ?? [],
    'fixture compiler cssAssets',
    (asset, index) => snapshotCssAsset(asset, `fixture compiler cssAssets[${index}]`),
  );
  const files = verifierDenseArraySnapshot(
    ownData(value, 'files', 'fixture compiler result') ?? [],
    'fixture compiler files',
    (file, index): CompileResult['files'][number] => {
      if (typeof file !== 'object' || file === null) {
        throw new TypeError(`Fixture compiler file ${index} must be an object.`);
      }
      const kind = requiredString(file, 'kind', `fixture compiler file ${index}`);
      if (
        kind !== 'client' &&
        kind !== 'css' &&
        kind !== 'registry' &&
        kind !== 'route' &&
        kind !== 'server'
      )
        throw new TypeError(`Fixture compiler file ${index} has invalid kind.`);
      return verifierFreeze({
        fileName: requiredString(file, 'fileName', `fixture compiler file ${index}`),
        kind,
        source: requiredString(file, 'source', `fixture compiler file ${index}`),
      });
    },
  );
  const loweredSource = ownData(value, 'loweredSource', 'fixture compiler result');
  if (loweredSource !== undefined && typeof loweredSource !== 'string') {
    throw new TypeError(
      'Fixture compiler result.loweredSource must be a string own data property.',
    );
  }
  const dependencyFootprint = ownData(value, 'dependencyFootprint', 'fixture compiler result');
  if (typeof dependencyFootprint !== 'object' || dependencyFootprint === null) {
    throw new TypeError('Fixture compiler result.dependencyFootprint must be an own data object.');
  }
  const queryPlanIdentities = verifierDenseArraySnapshot(
    ownData(value, 'queryUpdatePlans', 'fixture compiler result') ?? [],
    'fixture compiler queryUpdatePlans',
    (plan, index) => {
      if (typeof plan !== 'object' || plan === null) {
        throw new TypeError(`Fixture compiler queryUpdatePlans[${index}] must be an object.`);
      }
      return verifierFreeze({
        componentName: requiredString(
          plan,
          'componentName',
          `fixture compiler queryUpdatePlans[${index}]`,
        ),
        query: requiredString(plan, 'query', `fixture compiler queryUpdatePlans[${index}]`),
      });
    },
  );
  return verifierFreeze({
    cssAssets,
    dependencyFootprint,
    diagnostics,
    files,
    loweredSource,
    queryPlanIdentities,
  });
}

function registerGeneratedClientModule(
  modules: Map<string, FixtureGeneratedClientModule>,
  result: FixtureCompileResultSnapshot,
  componentFileName: string,
  root: string,
): void {
  let clientFile: CompileResult['files'][number] | undefined;
  for (let index = 0; index < result.files.length; index += 1) {
    const file = result.files[index];
    if (file?.kind !== 'client') continue;
    if (clientFile !== undefined) {
      throw new TypeError(
        `Fixture compiler emitted more than one client module for ${componentFileName}.`,
      );
    }
    clientFile = file;
  }

  if (clientFile === undefined) {
    if (result.queryPlanIdentities.length > 0) {
      throw new TypeError(
        `Fixture compiler emitted query plans without a client module for ${componentFileName}.`,
      );
    }
    return;
  }

  const expectedFileName = fixtureClientFileName(componentFileName);
  if (clientFile.fileName !== expectedFileName) {
    throw new TypeError(
      `Fixture compiler client module identity mismatch for ${componentFileName}: expected ${expectedFileName}, received ${clientFile.fileName}.`,
    );
  }
  const id = pathResolve(root, clientFile.fileName);
  if (!pathContains(pathResolve(root), id)) {
    throw new TypeError(
      `Fixture compiler client module for ${componentFileName} escaped the configured root.`,
    );
  }

  let exportName: string | undefined;
  const queries: string[] = [];
  const seenQueries = verifierMap<string, true>();
  for (let index = 0; index < result.queryPlanIdentities.length; index += 1) {
    const identity = result.queryPlanIdentities[index]!;
    if (verifierRegExpExec(/^[A-Za-z_$][A-Za-z0-9_$]*$/u, identity.componentName) === null) {
      throw new TypeError(
        `Fixture compiler query-plan component name ${identity.componentName} is not a valid generated identifier.`,
      );
    }
    const candidate = `${identity.componentName}$queryUpdatePlans`;
    if (exportName !== undefined && exportName !== candidate) {
      throw new TypeError(
        `Fixture compiler emitted multiple query-plan component identities for ${componentFileName}.`,
      );
    }
    exportName = candidate;
    if (verifierMapHas(seenQueries, identity.query)) {
      throw new TypeError(
        `Fixture compiler emitted duplicate query-plan identity ${identity.query} for ${componentFileName}.`,
      );
    }
    verifierMapSet(seenQueries, identity.query, true);
    verifierArrayPush(queries, identity.query);
  }

  verifierMapSet(
    modules,
    id,
    verifierFreeze({
      ...(exportName === undefined ? {} : { exportName }),
      fileName: clientFile.fileName,
      id,
      queries: verifierFreeze(queries),
      source: clientFile.source,
    }),
  );
}

function fixtureClientFileName(componentFileName: string): string {
  const extensions = ['.mtsx', '.ctsx', '.tsx', '.mts', '.cts', '.ts'];
  for (let index = 0; index < extensions.length; index += 1) {
    const extension = extensions[index]!;
    if (!verifierStringEndsWith(componentFileName, extension)) continue;
    return `${verifierStringSlice(componentFileName, 0, -extension.length)}.client.js`;
  }
  throw new TypeError(
    `Fixture compiler component identity ${componentFileName} has no supported TypeScript extension.`,
  );
}

function generatedQueryPlanAggregateSource(
  modules: ReadonlyMap<string, FixtureGeneratedClientModule>,
): string {
  const planModules: FixtureGeneratedClientModule[] = [];
  verifierMapForEach(modules, (module) => {
    if (module.exportName !== undefined) verifierArrayPush(planModules, module);
  });
  verifierArraySort(planModules, (left, right) =>
    left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0,
  );
  if (planModules.length === 0) {
    throw new TypeError(
      'Fixture generated-query-plan module was imported before any compiler-owned query plans were registered.',
    );
  }

  const imports: string[] = [];
  const sources: string[] = [];
  for (let index = 0; index < planModules.length; index += 1) {
    const module = planModules[index]!;
    const alias = `__kovoFixtureQueryPlans_${index}`;
    verifierArrayPush(
      imports,
      `import { ${module.exportName} as ${alias} } from ${jsonString(module.id)};`,
    );
    verifierArrayPush(sources, `{ plans: ${alias}, queries: ${jsonStringArray(module.queries)} }`);
  }

  return `${verifierArrayJoin(imports, '\n')}

const queryPlans = Object.create(null);
for (const source of [${verifierArrayJoin(sources, ', ')}]) {
  for (const query of source.queries) {
    const descriptor = Object.getOwnPropertyDescriptor(source.plans, query);
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
      throw new TypeError('Fixture generated query plans must contain own function values.');
    }
    const existing = Object.getOwnPropertyDescriptor(queryPlans, query);
    const apply = descriptor.value;
    Object.defineProperty(queryPlans, query, {
      configurable: true,
      enumerable: true,
      value: existing && 'value' in existing
        ? (root, value, context = {}) => {
            existing.value(root, value, context);
            return apply(root, value, context);
          }
        : apply,
    });
  }
}

export const kovoFixtureQueryPlans = Object.freeze(queryPlans);
`;
}

function snapshotCssAsset(value: unknown, label: string): ComponentCssAsset {
  if (typeof value !== 'object' || value === null)
    throw new TypeError(`${label} must be an object.`);
  const criticalCss = optionalString(value, 'criticalCss', label);
  const cspHash = optionalString(value, 'cspHash', label);
  const preload = ownData(value, 'preload', label);
  if (preload !== undefined && typeof preload !== 'boolean') {
    throw new TypeError(`${label}.preload must be boolean own data.`);
  }
  const fragmentTargets = verifierDenseArraySnapshot(
    ownData(value, 'fragmentTargets', label),
    `${label}.fragmentTargets`,
    (target) => {
      if (typeof target !== 'string')
        throw new TypeError(`${label}.fragmentTargets must be strings.`);
      return target;
    },
  );
  const usagesValue = ownData(value, 'styleRuleUsages', label);
  const styleRuleUsages =
    usagesValue === undefined
      ? undefined
      : verifierDenseArraySnapshot(usagesValue, `${label}.styleRuleUsages`, (usage, index) => {
          if (typeof usage !== 'object' || usage === null) {
            throw new TypeError(`${label}.styleRuleUsages[${index}] must be an object.`);
          }
          const usageLabel = `${label}.styleRuleUsages[${index}]`;
          return verifierFreeze({
            className: requiredString(usage, 'className', usageLabel),
            moduleFileName: requiredString(usage, 'moduleFileName', usageLabel),
            source: requiredString(usage, 'source', usageLabel),
            styleRef: requiredString(usage, 'styleRef', usageLabel),
          });
        });
  return verifierFreeze({
    componentName: requiredString(value, 'componentName', label),
    ...(criticalCss === undefined ? {} : { criticalCss }),
    ...(cspHash === undefined ? {} : { cspHash }),
    fragmentTargets,
    href: requiredString(value, 'href', label),
    ...(preload === undefined ? {} : { preload }),
    sourceFileName: requiredString(value, 'sourceFileName', label),
    ...(styleRuleUsages === undefined ? {} : { styleRuleUsages }),
  });
}

function ownData(value: object, property: PropertyKey, label: string): unknown {
  const first = verifierGetOwnPropertyDescriptor(value, property);
  const second = verifierGetOwnPropertyDescriptor(value, property);
  if (first === undefined && second === undefined) return undefined;
  if (
    first === undefined ||
    second === undefined ||
    !('value' in first) ||
    !('value' in second) ||
    first.value !== second.value
  )
    throw new TypeError(
      `${label}.${typeof property === 'string' ? property : 'symbol'} must be a stable own data property.`,
    );
  return first.value;
}

function requiredString(value: object, property: string, label: string): string {
  const result = ownData(value, property, label);
  if (typeof result !== 'string')
    throw new TypeError(`${label}.${property} must be string own data.`);
  return result;
}

function optionalString(value: object, property: string, label: string): string | undefined {
  const result = ownData(value, property, label);
  if (result !== undefined && typeof result !== 'string') {
    throw new TypeError(`${label}.${property} must be string own data.`);
  }
  return result;
}

function fixtureAuthoredModule(id: string, root: string): boolean {
  const modulePath = cleanModulePath(id);
  if (!pathIsAbsolute(modulePath)) return false;
  return pathContains(pathResolve(root), pathResolve(modulePath));
}

function fixtureComponentFileName(id: string, root: string): string {
  const modulePath = pathResolve(cleanModulePath(id));
  const normalizedRoot = pathResolve(root);
  return pathContains(normalizedRoot, modulePath)
    ? verifierStringReplaceAll(pathRelative(normalizedRoot, modulePath), '\\', '/')
    : verifierStringReplaceAll(modulePath, '\\', '/');
}

function cleanModulePath(id: string): string {
  const query = verifierStringIndexOf(id, '?');
  return query < 0 ? id : verifierStringSlice(id, 0, query);
}

function pathContains(root: string, candidate: string): boolean {
  const relative = pathRelative(root, candidate);
  return (
    relative !== '' &&
    !pathIsAbsolute(relative) &&
    relative !== '..' &&
    !verifierStringStartsWith(relative, `..${nativePathSeparator}`)
  );
}

function pathIsAbsolute(value: string): boolean {
  return verifierApply<boolean>(nativePathIsAbsolute, path, [value]);
}

function pathRelative(from: string, to: string): string {
  return verifierApply<string>(nativePathRelative, path, [from, to]);
}

function pathResolve(...values: string[]): string {
  return verifierApply<string>(nativePathResolve, path, values);
}

function cssRuntimeRegistration(
  assets: readonly ComponentCssAsset[],
  privateRegistrationId: string,
): string {
  if (assets.length === 0) return '';
  const serialized: string[] = [];
  for (let index = 0; index < assets.length; index += 1) {
    verifierArrayPush(serialized, serializePublicCssAsset(assets[index] as ComponentCssAsset));
  }
  return `
import { kovoFixtureRegisterStylesheets as __kovoRegisterFixtureStylesheets } from ${jsonString(privateRegistrationId)};
__kovoRegisterFixtureStylesheets([${verifierArrayJoin(serialized, ',')}]);`;
}

function serializePublicCssAsset(asset: ComponentCssAsset): string {
  const fields = [
    `"componentName":${jsonString(asset.componentName)}`,
    `"fragmentTargets":${jsonStringArray(asset.fragmentTargets)}`,
    `"href":${jsonString(asset.href)}`,
    `"sourceFileName":${jsonString(asset.sourceFileName)}`,
  ];
  if (asset.cspHash !== undefined)
    verifierArrayPush(fields, `"cspHash":${jsonString(asset.cspHash)}`);
  if (asset.preload !== undefined)
    verifierArrayPush(fields, `"preload":${asset.preload ? 'true' : 'false'}`);
  if (asset.styleRuleUsages !== undefined) {
    const usages: string[] = [];
    for (let index = 0; index < asset.styleRuleUsages.length; index += 1) {
      const usage = asset.styleRuleUsages[index];
      if (!usage) continue;
      verifierArrayPush(
        usages,
        `{"className":${jsonString(usage.className)},"moduleFileName":${jsonString(usage.moduleFileName)},"source":${jsonString(usage.source)},"styleRef":${jsonString(usage.styleRef)}}`,
      );
    }
    verifierArrayPush(fields, `"styleRuleUsages":[${verifierArrayJoin(usages, ',')}]`);
  }
  return `{${verifierArrayJoin(fields, ',')}}`;
}

function jsonStringArray(values: readonly string[]): string {
  const serialized: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    verifierArrayPush(serialized, jsonString(values[index] as string));
  }
  return `[${verifierArrayJoin(serialized, ',')}]`;
}

function jsonString(value: string): string {
  const result = verifierJsonStringify(value);
  if (result === undefined) throw new TypeError('Fixture CSS metadata must serialize to JSON.');
  return result;
}
