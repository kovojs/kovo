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
  CompileCache,
  compileComponentCacheKeyInput,
  type ComponentCssAsset,
  type CompileResult,
} from '@kovojs/compiler/internal';
import type { Plugin } from 'vite';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/* eslint-disable typescript/unbound-method */

import {
  verifierApply,
  verifierArrayJoin,
  verifierArrayPush,
  verifierDenseArraySnapshot,
  verifierFreeze,
  verifierGetOwnPropertyDescriptor,
  verifierJsonStringify,
  verifierMap,
  verifierMapGet,
  verifierMapSet,
  verifierRegExpExec,
  verifierStableMethod,
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
const compileCacheGetOrCreate = verifierStableMethod(CompileCache.prototype, 'getOrCreate');

const virtualCssManifestId = 'virtual:kovo-fixture-css-manifest';
const resolvedVirtualCssManifestId = `\0${virtualCssManifestId}`;

interface FixtureCssAsset extends ComponentCssAsset {
  source: string;
}

export function kovoFixtureCompilerPlugin(
  compile: (
    options: Parameters<typeof compileComponentModule>[0],
  ) => CompileResult = compileComponentModule,
): Plugin {
  const privateCssRegistrationId = `${virtualCssManifestId}:register:${randomUUID()}`;
  const resolvedPrivateCssRegistrationId = `\0${privateCssRegistrationId}`;
  let root = pathResolve(verifierApply<string>(nativeProcessCwd, process, []));
  const cssAssets = verifierMap<string, FixtureCssAsset>();
  const compileCache = new CompileCache<CompileResult>();

  return {
    name: 'kovo-fixture-compiler',
    enforce: 'pre',
    configResolved(config) {
      const configuredRoot = ownData(config, 'root', 'fixture Vite config');
      if (typeof configuredRoot !== 'string') {
        throw new TypeError('Fixture Vite config.root must be a stable own string.');
      }
      root = pathResolve(configuredRoot);
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
      return null;
    },
    load(id) {
      if (id === resolvedVirtualCssManifestId) {
        return `export { kovoFixtureStylesheetManifest, kovoFixtureStylesheetsForTargets } from ${jsonString(privateCssRegistrationId)};`;
      }
      if (id !== resolvedPrivateCssRegistrationId) return null;

      return `
let registered = [];
function copyStrings(values) {
  const out = [];
  for (let index = 0; index < (values ?? []).length; index += 1) out[out.length] = values[index];
  return out;
}
function copyUsages(values) {
  const out = [];
  for (let index = 0; index < (values ?? []).length; index += 1) {
    const value = values[index];
    out[out.length] = {
      className: value.className,
      moduleFileName: value.moduleFileName,
      source: value.source,
      styleRef: value.styleRef,
    };
  }
  return out;
}
function copyAsset(value) {
  return {
    componentName: value.componentName,
    cspHash: value.cspHash,
    fragmentTargets: copyStrings(value.fragmentTargets),
    href: value.href,
    preload: value.preload,
    sourceFileName: value.sourceFileName,
    styleRuleUsages: copyUsages(value.styleRuleUsages),
  };
}

function dedupe(values) {
  const out = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value || typeof value.href !== 'string') continue;
    let duplicate = false;
    for (let seenIndex = 0; seenIndex < out.length; seenIndex += 1) {
      if (out[seenIndex].href === value.href) duplicate = true;
    }
    if (duplicate) continue;
    out[out.length] = value;
  }
  return out;
}
export function kovoFixtureRegisterStylesheets(values) {
  const combined = [];
  for (let index = 0; index < registered.length; index += 1) combined[combined.length] = registered[index];
  for (let index = 0; index < values.length; index += 1) combined[combined.length] = copyAsset(values[index]);
  registered = dedupe(combined);
}
export function kovoFixtureStylesheetManifest() {
  const output = [];
  for (let index = 0; index < registered.length; index += 1) output[output.length] = copyAsset(registered[index]);
  return dedupe(output);
}
export function kovoFixtureStylesheetsForTargets(targets) {
  if (!targets) return kovoFixtureStylesheetManifest();
  const selected = [];
  for (let assetIndex = 0; assetIndex < registered.length; assetIndex += 1) {
    const asset = registered[assetIndex];
    const fragmentTargets = asset.fragmentTargets ?? [];
    for (let targetIndex = 0; targetIndex < fragmentTargets.length; targetIndex += 1) {
      for (let wantedIndex = 0; wantedIndex < targets.length; wantedIndex += 1) {
        if (fragmentTargets[targetIndex] === targets[wantedIndex]) {
          selected[selected.length] = copyAsset(asset);
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

      const fileName = fixtureComponentFileName(id, root);
      const compileOptions = {
        fileName,
        packagePrefixDiscoveryRoot: root,
        source,
      };
      const result = await verifierApply<CompileResult | Promise<CompileResult>>(
        compileCacheGetOrCreate,
        compileCache,
        [
          compileComponentCacheKeyInput(compileOptions),
          () => snapshotCompileResult(compile(compileOptions)),
        ],
      );

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

      const code = result.loweredSource;
      if (typeof code !== 'string') return null;
      return verifierFreeze({
        code: `${code}\n${cssRuntimeRegistration(result.cssAssets, privateCssRegistrationId)}`,
        map: null,
      });
    },
  };
}

function snapshotCompileResult(value: unknown): CompileResult {
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
    (file, index) => {
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
  return verifierFreeze({
    cssAssets,
    dependencyFootprint,
    diagnostics,
    files,
    loweredSource,
  }) as unknown as CompileResult;
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
    throw new TypeError(`${label}.${String(property)} must be a stable own data property.`);
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
