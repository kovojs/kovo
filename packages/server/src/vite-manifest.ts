import { readFile } from 'node:fs/promises';
import type { PageHintOptions } from './hints.js';
import {
  buildOwnDataProperty,
  buildSecurityDecodeURIComponent,
  buildSecurityFileUrlToPath,
  snapshotBuildArray,
} from './build-security-intrinsics.js';
import {
  createSecurityMap,
  createSecuritySet,
  securityArrayIsArray,
  securityArrayJoin,
  securityArraySort,
  securityBufferFrom,
  securityBufferToString,
  securityIsUrl,
  securityJsonParse,
  securityMapForEach,
  securityMapGet,
  securityMapHas,
  securityMapSet,
  securityObjectKeys,
  securityRegExpTest,
  securityRegExpReplace,
  securitySetAdd,
  securitySetHas,
  securityStringEndsWith,
  securityStringIncludes,
  securityStringSplit,
  securityStringStartsWith,
  securityStringTrim,
  securityUrlObjectSnapshot,
  securityUrlSnapshot,
} from './response-security-intrinsics.js';
import {
  witnessArrayAppend,
  witnessCreateNullRecord,
  witnessFreeze,
} from './security-witness-intrinsics.js';
import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). One parsed Vite
 * manifest chunk (file/css/imports/src/isEntry).
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteManifestChunk {
  css?: readonly string[];
  file?: string;
  imports?: readonly string[];
  isEntry?: boolean;
  src?: string;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Parsed Vite manifest
 * keyed by entry id.
 * Exported only for in-repo build/host config, not app authors.
 */
export type KovoAppShellViteManifest = Record<string, KovoAppShellViteManifestChunk>;

/**
 * Options for resolving asset hrefs from a Vite manifest, such as the base path used to
 * prefix emitted asset URLs. Accepted by manifest helpers including
 * kovoAppShellViteManifestStylesheetHrefFromFile (SPEC.md §9.5 Vite dev/build/export
 * replay).
 */
export interface KovoAppShellViteManifestHintOptions {
  base?: string;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Emitted asset entry
 * within a Rollup/Vite output bundle.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteOutputAsset {
  fileName: string;
  source: string | Uint8Array;
  type: 'asset';
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Emitted chunk entry
 * within a Rollup/Vite output bundle.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteOutputChunk {
  fileName: string;
  type: 'chunk';
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Rollup/Vite output
 * bundle map passed from a writeBundle hook.
 * Exported only for in-repo build/host config, not app authors.
 */
export type KovoAppShellViteOutputBundle = Readonly<
  Record<string, KovoAppShellViteOutputAsset | KovoAppShellViteOutputChunk>
>;

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Normalized route ->
 * Vite entries mapping used to compute per-route build hints.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellRouteBuildEntry {
  entries: readonly string[];
  routePath: string;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Raw route -> Vite
 * entry mapping authored in plugin/build config.
 * Exported only for in-repo build/host config, not app authors.
 */
export type KovoAppShellRouteEntryMap = Readonly<Record<string, string | readonly string[]>>;

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Options for resolving
 * and validating route build entries against a manifest.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteRouteEntryOptions {
  manifest?: KovoAppShellViteManifest;
  routes?: readonly { path: string }[];
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). A built static asset
 * (dist file, href, and path) derived from the Vite manifest.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellBuildAsset {
  file: string;
  href: string;
  path: string;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Computes modulepreload
 * and stylesheet page hints by walking manifest entries.
 * Exported only for in-repo build/host config, not app authors.
 */
export function kovoAppShellViteManifestHints(
  manifest: KovoAppShellViteManifest,
  entries: readonly string[],
  options: KovoAppShellViteManifestHintOptions = {},
): PageHintOptions {
  const pinnedManifest = kovoAppShellViteManifestFromUnknown(manifest);
  const pinnedEntries = snapshotBuildArray(entries, 'Vite manifest hint entries');
  const modulepreloads: string[] = [];
  const stylesheets: string[] = [];
  const visited = createSecuritySet<string>();

  for (let index = 0; index < pinnedEntries.length; index += 1) {
    collectManifestHints(
      pinnedManifest,
      pinnedEntries[index]!,
      options,
      visited,
      modulepreloads,
      stylesheets,
    );
  }

  const hints: PageHintOptions = {};
  if (modulepreloads.length > 0) hints.modulepreloads = modulepreloads;
  if (stylesheets.length > 0) hints.stylesheets = stylesheets;
  return hints;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Normalizes and
 * validates a route -> entry map into ordered route build entries.
 * Exported only for in-repo build/host config, not app authors.
 */
export function kovoAppShellViteRouteEntries(
  routeEntryMap: KovoAppShellRouteEntryMap,
  options: KovoAppShellViteRouteEntryOptions = {},
): KovoAppShellRouteBuildEntry[] {
  const manifest = options.manifest
    ? kovoAppShellViteManifestFromUnknown(options.manifest)
    : undefined;
  const routes = options.routes
    ? snapshotBuildArray(options.routes, 'Vite route declarations')
    : undefined;
  const knownRoutes = options.routes ? createSecuritySet<string>() : undefined;
  if (knownRoutes && routes) {
    for (let index = 0; index < routes.length; index += 1) {
      securitySetAdd(knownRoutes, routes[index]!.path);
    }
  }
  const mapped = createSecurityMap<string, string[]>();

  const routeEntryPairs = ownRecordEntries(routeEntryMap, 'Vite route entry map');
  for (let pairIndex = 0; pairIndex < routeEntryPairs.length; pairIndex += 1) {
    const [routePath, rawEntries] = routeEntryPairs[pairIndex]!;
    if (!securityStringStartsWith(routePath, '/')) {
      throw new Error(`App shell route build entry must use an absolute route path: ${routePath}`);
    }
    if (knownRoutes && !securitySetHas(knownRoutes, routePath)) {
      throw new Error(`App shell route build entry does not match an app route: ${routePath}`);
    }

    const entries = securityArrayIsArray(rawEntries)
      ? snapshotBuildArray(rawEntries, `Vite entries for '${routePath}'`)
      : [rawEntries];
    if (entries.length === 0) {
      throw new Error(
        `App shell route build entry must include at least one Vite entry: ${routePath}`,
      );
    }

    const normalizedEntries: string[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (typeof entry !== 'string') {
        throw new Error(`App shell route build entry must be a string: ${routePath}`);
      }
      const normalizedEntry = securityStringTrim(entry);
      if (normalizedEntry.length === 0) {
        throw new Error(
          `App shell route build entry must include a non-empty Vite entry: ${routePath}`,
        );
      }
      if (manifest && !resolveManifestChunk(manifest, normalizedEntry)) {
        throw new Error(
          `App shell route build entry is missing from the Vite manifest: ${routePath} -> ${normalizedEntry}`,
        );
      }
      addUnique(normalizedEntries, normalizedEntry);
    }

    securityMapSet(mapped, routePath, normalizedEntries);
  }

  if (routes) {
    const ordered: KovoAppShellRouteBuildEntry[] = [];
    const seenRoutePaths = createSecuritySet<string>();
    for (let index = 0; index < routes.length; index += 1) {
      const route = routes[index]!;
      if (securitySetHas(seenRoutePaths, route.path)) continue;
      securitySetAdd(seenRoutePaths, route.path);

      const routeEntries = securityMapGet(mapped, route.path);
      if (routeEntries)
        witnessArrayAppend(
          ordered,
          { entries: routeEntries, routePath: route.path },
          'Server packages/server/src/vite-manifest.ts collection',
        );
    }
    return ordered;
  }

  const result: KovoAppShellRouteBuildEntry[] = [];
  securityMapForEach(mapped, (entries, routePath) => {
    witnessArrayAppend(
      result,
      { entries, routePath },
      'Server packages/server/src/vite-manifest.ts collection',
    );
  });
  securityArraySort(result, (left, right) =>
    left.routePath < right.routePath ? -1 : left.routePath > right.routePath ? 1 : 0,
  );
  return result;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Collects the unique
 * built static assets referenced across a manifest.
 * Exported only for in-repo build/host config, not app authors.
 */
export function kovoAppShellViteManifestAssets(
  manifest: KovoAppShellViteManifest,
  options: KovoAppShellViteManifestHintOptions = {},
): KovoAppShellBuildAsset[] {
  const pinnedManifest = kovoAppShellViteManifestFromUnknown(manifest);
  const assets = createSecurityMap<string, KovoAppShellBuildAsset>();

  const manifestEntries = ownRecordEntries(pinnedManifest, 'Vite manifest');
  for (let index = 0; index < manifestEntries.length; index += 1) {
    const chunk = manifestEntries[index]![1];
    if (!isRecord(chunk)) throw new Error('App shell Vite build manifest entry must be an object.');
    const normalizedChunk = chunk as KovoAppShellViteManifestChunk;
    addManifestBuildAsset(assets, normalizedChunk.file, options);
    const stylesheets = normalizedChunk.css ?? [];
    for (let index = 0; index < stylesheets.length; index += 1) {
      addManifestBuildAsset(assets, stylesheets[index], options);
    }
  }

  const result: KovoAppShellBuildAsset[] = [];
  securityMapForEach(assets, (asset) => {
    witnessArrayAppend(result, asset, 'Server packages/server/src/vite-manifest.ts collection');
  });
  securityArraySort(result, (left, right) =>
    left.file < right.file ? -1 : left.file > right.file ? 1 : 0,
  );
  return result;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Reads and parses a
 * Vite manifest from a filesystem path or file: URL.
 * Exported only for in-repo build/host config, not app authors.
 */
export async function kovoAppShellViteManifestFromFile(
  manifestFile: string | URL,
): Promise<KovoAppShellViteManifest> {
  const source = await readFile(resolvedManifestFile(manifestFile), 'utf8');
  return kovoAppShellViteManifestFromSource(source);
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Reads a manifest file
 * and returns its built static assets.
 * Exported only for in-repo build/host config, not app authors.
 */
export async function kovoAppShellViteManifestAssetsFromFile(
  manifestFile: string | URL,
  options: KovoAppShellViteManifestHintOptions = {},
): Promise<KovoAppShellBuildAsset[]> {
  return kovoAppShellViteManifestAssets(
    await kovoAppShellViteManifestFromFile(manifestFile),
    options,
  );
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Resolves the single
 * stylesheet href from an in-memory manifest.
 * Exported only for in-repo build/host config, not app authors.
 */
export function kovoAppShellViteManifestStylesheetHref(
  manifest: KovoAppShellViteManifest,
  options: KovoAppShellViteManifestHintOptions = {},
): string {
  let stylesheetHref: string | undefined;
  let stylesheetCount = 0;
  const assets = kovoAppShellViteManifestAssets(manifest, options);
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index]!;
    if (!securityStringEndsWith(asset.file, '.css')) continue;
    stylesheetHref = asset.href;
    stylesheetCount += 1;
  }

  if (stylesheetCount !== 1 || stylesheetHref === undefined) {
    throw new Error(
      `App shell Vite build manifest must contain exactly one stylesheet asset; found ${stylesheetCount}.`,
    );
  }

  return stylesheetHref;
}

/**
 * Resolves the app shell's single stylesheet href from a built Vite manifest file. App
 * authors call this in scripts/export-static.mjs to find the hashed CSS asset URL to
 * reference in their exported shell. Reads the manifest from a filesystem path or file:
 * URL and throws unless the manifest contains exactly one stylesheet (SPEC.md §9.5 Vite
 * dev/build/export replay).
 */
export async function kovoAppShellViteManifestStylesheetHrefFromFile(
  manifestFile: string | URL,
  options: KovoAppShellViteManifestHintOptions = {},
): Promise<string> {
  return kovoAppShellViteManifestStylesheetHref(
    await kovoAppShellViteManifestFromFile(manifestFile),
    options,
  );
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Extracts and parses
 * the manifest from a Rollup/Vite output bundle.
 * Exported only for in-repo build/host config, not app authors.
 */
export function kovoAppShellViteManifestFromBundle(
  bundle: KovoAppShellViteOutputBundle,
): KovoAppShellViteManifest {
  let manifestAsset: KovoAppShellViteOutputAsset | undefined;
  const bundleEntries = ownRecordEntries(bundle, 'Vite output bundle');
  for (let index = 0; index < bundleEntries.length; index += 1) {
    const asset = bundleEntries[index]![1];
    if (
      isRecord(asset) &&
      asset.type === 'asset' &&
      typeof asset.fileName === 'string' &&
      securityRegExpReplace(asset.fileName, /\\/gu, '/') === '.vite/manifest.json'
    ) {
      manifestAsset = asset as unknown as KovoAppShellViteOutputAsset;
      break;
    }
  }
  if (!manifestAsset) throw new Error('App shell Vite build requires .vite/manifest.json.');

  const source =
    typeof manifestAsset.source === 'string'
      ? manifestAsset.source
      : securityBufferToString(securityBufferFrom(manifestAsset.source), 'utf8');

  return kovoAppShellViteManifestFromSource(source);
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Normalizes a manifest
 * file path into a safe dist-relative file, rejecting traversal.
 * Exported only for in-repo build/host config, not app authors.
 */
export function normalizedDistFile(file: string): string {
  const withoutQuery = securityRegExpReplace(file, /[?#].*$/u, '');
  const pathname = securityRegExpReplace(withoutQuery, /^\/+/, '');
  const segments = securityStringSplit(pathname, '/');

  let unsafe = segments.length === 0;
  for (let index = 0; index < segments.length; index += 1) {
    if (!isSafeDistFileSegment(segments[index]!)) {
      unsafe = true;
      break;
    }
  }
  if (unsafe) {
    throw new Error(`App shell build asset must stay within the Vite output directory: ${file}`);
  }

  return securityArrayJoin(segments, '/');
}

function kovoAppShellViteManifestFromSource(source: string): KovoAppShellViteManifest {
  let parsed: unknown;
  try {
    parsed = securityJsonParse(source);
  } catch (error) {
    throw new Error(
      `App shell Vite build manifest must be valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return kovoAppShellViteManifestFromUnknown(parsed);
}

function addManifestBuildAsset(
  assets: Map<string, KovoAppShellBuildAsset>,
  file: string | undefined,
  options: KovoAppShellViteManifestHintOptions,
): void {
  if (!file || isExternalAssetHref(file)) return;

  const normalizedFile = normalizedDistFile(file);
  if (securityMapHas(assets, normalizedFile)) return;

  const href = manifestAssetHref(normalizedFile, options.base);
  const url = securityUrlSnapshot(href, 'https://kovo.local');

  securityMapSet(assets, normalizedFile, {
    file: normalizedFile,
    href,
    path: url.pathname,
  });
}

function collectManifestHints(
  manifest: KovoAppShellViteManifest,
  entry: string,
  options: KovoAppShellViteManifestHintOptions,
  visited: Set<string>,
  modulepreloads: string[],
  stylesheets: string[],
): void {
  const resolved = resolveManifestChunk(manifest, entry);
  if (!resolved || securitySetHas(visited, resolved.key)) return;
  securitySetAdd(visited, resolved.key);

  const chunk = resolved.chunk;
  if (chunk.file) addUnique(modulepreloads, manifestAssetHref(chunk.file, options.base));
  const chunkStylesheets = chunk.css ?? [];
  for (let index = 0; index < chunkStylesheets.length; index += 1) {
    addUnique(stylesheets, manifestAssetHref(chunkStylesheets[index]!, options.base));
  }
  const imports = chunk.imports ?? [];
  for (let index = 0; index < imports.length; index += 1) {
    collectManifestHints(manifest, imports[index]!, options, visited, modulepreloads, stylesheets);
  }
}

function resolveManifestChunk(
  manifest: KovoAppShellViteManifest,
  entry: string,
): { chunk: KovoAppShellViteManifestChunk; key: string } | undefined {
  const direct = manifest[entry];
  if (direct) return { chunk: direct, key: entry };

  const entries = ownRecordEntries(manifest, 'Vite manifest');
  for (let index = 0; index < entries.length; index += 1) {
    const [key, rawChunk] = entries[index]!;
    if (!isRecord(rawChunk)) continue;
    const chunk = rawChunk as KovoAppShellViteManifestChunk;
    if (chunk.src === entry || chunk.file === entry) return { chunk, key };
  }

  return undefined;
}

function manifestAssetHref(file: string, base = '/'): string {
  if (isExternalAssetHref(file)) {
    return file;
  }

  // SPEC §9.5: Vite build hints and static-export asset copies must describe the
  // same static-host files, so hint hrefs use the shared dist-file boundary.
  return `${securityRegExpReplace(base, /\/?$/u, '/')}${normalizedDistFile(file)}`;
}

function isExternalAssetHref(file: string): boolean {
  return securityStringStartsWith(file, '//') || securityRegExpTest(/^[a-z][a-z0-9+.-]*:/i, file);
}

function resolvedManifestFile(manifestFile: string | URL): string | URL {
  if (!securityIsUrl(manifestFile)) return manifestFile;
  const snapshot = securityUrlObjectSnapshot(manifestFile);
  if (snapshot.protocol === 'file:') return buildSecurityFileUrlToPath(snapshot.href);

  throw new StaticExportError([
    staticExportDiagnostic(
      'vite-manifestFile',
      `KV229 Vite app-shell manifest files must be filesystem paths or file: URLs, received '${snapshot.href}'. SPEC §9.5 static export reads Vite manifests from a local output file.`,
    ),
  ]);
}

function kovoAppShellViteManifestFromUnknown(value: unknown): KovoAppShellViteManifest {
  if (!isRecord(value)) {
    throw new Error('App shell Vite build manifest must be a JSON object.');
  }

  // SPEC §6.6: Vite manifest input is a caller-owned carrier. Reconstruct a deep, null-prototype
  // manifest from own data properties so inherited fields and getters cannot become public assets.
  const manifest =
    witnessCreateNullRecord<KovoAppShellViteManifestChunk>() as KovoAppShellViteManifest;
  const manifestEntries = ownRecordEntries(value, 'Vite manifest');
  for (let index = 0; index < manifestEntries.length; index += 1) {
    const [entry, rawChunk] = manifestEntries[index]!;
    if (!isRecord(rawChunk)) {
      throw new Error(`App shell Vite build manifest entry '${entry}' must be a JSON object.`);
    }

    const chunk = witnessCreateNullRecord<unknown>() as KovoAppShellViteManifestChunk;
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
    manifest[entry] = witnessFreeze(chunk);
  }

  return witnessFreeze(manifest);
}

function optionalManifestString(
  chunk: Record<string, unknown>,
  entry: string,
  field: string,
): string | undefined {
  const property = buildOwnDataProperty(chunk, field, `Vite manifest '${entry}'.${field}`);
  if (!property.present || property.value === undefined) return undefined;
  if (typeof property.value === 'string') return property.value;

  throw new Error(
    `App shell Vite build manifest entry '${entry}' field '${field}' must be a string.`,
  );
}

function optionalManifestStringArray(
  chunk: Record<string, unknown>,
  entry: string,
  field: string,
): readonly string[] | undefined {
  const property = buildOwnDataProperty(chunk, field, `Vite manifest '${entry}'.${field}`);
  if (!property.present || property.value === undefined) return undefined;
  if (securityArrayIsArray(property.value)) {
    const source = snapshotBuildArray(property.value, `Vite manifest '${entry}'.${field}`);
    const strings: string[] = [];
    let valid = true;
    for (let index = 0; index < source.length; index += 1) {
      const item = source[index];
      if (typeof item !== 'string') {
        valid = false;
        break;
      }
      witnessArrayAppend(strings, item, 'Server packages/server/src/vite-manifest.ts collection');
    }
    if (valid) return witnessFreeze(strings);
  }

  throw new Error(
    `App shell Vite build manifest entry '${entry}' field '${field}' must be an array of strings.`,
  );
}

function optionalManifestBoolean(
  chunk: Record<string, unknown>,
  entry: string,
  field: string,
): boolean | undefined {
  const property = buildOwnDataProperty(chunk, field, `Vite manifest '${entry}'.${field}`);
  if (!property.present || property.value === undefined) return undefined;
  if (typeof property.value === 'boolean') return property.value;

  throw new Error(
    `App shell Vite build manifest entry '${entry}' field '${field}' must be a boolean.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !securityArrayIsArray(value);
}

function isSafeDistFileSegment(segment: string): boolean {
  if (!segment) return false;

  let decoded: string;
  try {
    decoded = buildSecurityDecodeURIComponent(segment);
  } catch {
    return false;
  }

  return (
    decoded !== '.' &&
    decoded !== '..' &&
    !securityStringIncludes(decoded, '/') &&
    !securityStringIncludes(decoded, '\\')
  );
}

function addUnique(values: string[], value: string): void {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === value) return;
  }
  witnessArrayAppend(values, value, 'Server packages/server/src/vite-manifest.ts collection');
}

function ownRecordEntries(value: object, label: string): readonly (readonly [string, unknown])[] {
  const keys = securityObjectKeys(value);
  const entries: (readonly [string, unknown])[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const property = buildOwnDataProperty(value, key, `${label}.${key}`);
    if (!property.present) {
      throw new TypeError(`Kovo build security boundary could not snapshot ${label}.${key}.`);
    }
    witnessArrayAppend(
      entries,
      witnessFreeze([key, property.value] as const),
      'Server packages/server/src/vite-manifest.ts collection',
    );
  }
  return witnessFreeze(entries);
}
