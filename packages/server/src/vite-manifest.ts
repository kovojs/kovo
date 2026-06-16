import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { PageHintOptions } from './hints.js';
import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';

export interface KovoAppShellViteManifestChunk {
  css?: readonly string[];
  file?: string;
  imports?: readonly string[];
  isEntry?: boolean;
  src?: string;
}

export type KovoAppShellViteManifest = Record<string, KovoAppShellViteManifestChunk>;

export interface KovoAppShellViteManifestHintOptions {
  base?: string;
}

export interface KovoAppShellViteOutputAsset {
  fileName: string;
  source: string | Uint8Array;
  type: 'asset';
}

export interface KovoAppShellViteOutputChunk {
  fileName: string;
  type: 'chunk';
}

export type KovoAppShellViteOutputBundle = Readonly<
  Record<string, KovoAppShellViteOutputAsset | KovoAppShellViteOutputChunk>
>;

export interface KovoAppShellRouteBuildEntry {
  entries: readonly string[];
  routePath: string;
}

export type KovoAppShellRouteEntryMap = Readonly<Record<string, string | readonly string[]>>;

export interface KovoAppShellViteRouteEntryOptions {
  manifest?: KovoAppShellViteManifest;
  routes?: readonly { path: string }[];
}

export interface KovoAppShellBuildAsset {
  file: string;
  href: string;
  path: string;
}

export function kovoAppShellViteManifestHints(
  manifest: KovoAppShellViteManifest,
  entries: readonly string[],
  options: KovoAppShellViteManifestHintOptions = {},
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

export function kovoAppShellViteRouteEntries(
  routeEntryMap: KovoAppShellRouteEntryMap,
  options: KovoAppShellViteRouteEntryOptions = {},
): KovoAppShellRouteBuildEntry[] {
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
    const ordered: KovoAppShellRouteBuildEntry[] = [];
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

export function kovoAppShellViteManifestAssets(
  manifest: KovoAppShellViteManifest,
  options: KovoAppShellViteManifestHintOptions = {},
): KovoAppShellBuildAsset[] {
  const assets = new Map<string, KovoAppShellBuildAsset>();

  for (const chunk of Object.values(manifest)) {
    addManifestBuildAsset(assets, chunk.file, options);
    for (const stylesheet of chunk.css ?? []) addManifestBuildAsset(assets, stylesheet, options);
  }

  return [...assets.values()].sort((left, right) => left.file.localeCompare(right.file));
}

export async function kovoAppShellViteManifestFromFile(
  manifestFile: string | URL,
): Promise<KovoAppShellViteManifest> {
  const source = await readFile(resolvedManifestFile(manifestFile), 'utf8');
  return kovoAppShellViteManifestFromSource(source);
}

export async function kovoAppShellViteManifestAssetsFromFile(
  manifestFile: string | URL,
  options: KovoAppShellViteManifestHintOptions = {},
): Promise<KovoAppShellBuildAsset[]> {
  return kovoAppShellViteManifestAssets(
    await kovoAppShellViteManifestFromFile(manifestFile),
    options,
  );
}

export function kovoAppShellViteManifestStylesheetHref(
  manifest: KovoAppShellViteManifest,
  options: KovoAppShellViteManifestHintOptions = {},
): string {
  let stylesheetHref: string | undefined;
  let stylesheetCount = 0;
  for (const asset of kovoAppShellViteManifestAssets(manifest, options)) {
    if (!asset.file.endsWith('.css')) continue;
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

export async function kovoAppShellViteManifestStylesheetHrefFromFile(
  manifestFile: string | URL,
  options: KovoAppShellViteManifestHintOptions = {},
): Promise<string> {
  return kovoAppShellViteManifestStylesheetHref(
    await kovoAppShellViteManifestFromFile(manifestFile),
    options,
  );
}

export function kovoAppShellViteManifestFromBundle(
  bundle: KovoAppShellViteOutputBundle,
): KovoAppShellViteManifest {
  const manifestAsset = Object.values(bundle).find(
    (asset): asset is KovoAppShellViteOutputAsset =>
      asset.type === 'asset' && asset.fileName.replaceAll('\\', '/') === '.vite/manifest.json',
  );
  if (!manifestAsset) throw new Error('App shell Vite build requires .vite/manifest.json.');

  const source =
    typeof manifestAsset.source === 'string'
      ? manifestAsset.source
      : Buffer.from(manifestAsset.source).toString('utf8');

  return kovoAppShellViteManifestFromSource(source);
}

export function normalizedDistFile(file: string): string {
  const pathname = file.replace(/[?#].*$/, '').replace(/^\/+/, '');
  const segments = pathname.split('/');

  if (segments.length === 0 || segments.some((segment) => !isSafeDistFileSegment(segment))) {
    throw new Error(`App shell build asset must stay within the Vite output directory: ${file}`);
  }

  return segments.join('/');
}

function kovoAppShellViteManifestFromSource(source: string): KovoAppShellViteManifest {
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

  return kovoAppShellViteManifestFromUnknown(parsed);
}

function addManifestBuildAsset(
  assets: Map<string, KovoAppShellBuildAsset>,
  file: string | undefined,
  options: KovoAppShellViteManifestHintOptions,
): void {
  if (!file || isExternalAssetHref(file)) return;

  const normalizedFile = normalizedDistFile(file);
  if (assets.has(normalizedFile)) return;

  const href = manifestAssetHref(normalizedFile, options.base);
  const url = new URL(href, 'https://kovo.local');

  assets.set(normalizedFile, {
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
  manifest: KovoAppShellViteManifest,
  entry: string,
): { chunk: KovoAppShellViteManifestChunk; key: string } | undefined {
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

  // SPEC §9.5: Vite build hints and static-export asset copies must describe the
  // same static-host files, so hint hrefs use the shared dist-file boundary.
  return `${base.replace(/\/?$/, '/')}${normalizedDistFile(file)}`;
}

function isExternalAssetHref(file: string): boolean {
  return file.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(file);
}

function resolvedManifestFile(manifestFile: string | URL): string | URL {
  if (!(manifestFile instanceof URL)) return manifestFile;
  if (manifestFile.protocol === 'file:') return fileURLToPath(manifestFile);

  throw new StaticExportError([
    staticExportDiagnostic(
      'vite-manifestFile',
      `KV229 Vite app-shell manifest files must be filesystem paths or file: URLs, received '${manifestFile.href}'. SPEC §9.5 static export reads Vite manifests from a local output file.`,
    ),
  ]);
}

function kovoAppShellViteManifestFromUnknown(value: unknown): KovoAppShellViteManifest {
  if (!isRecord(value)) {
    throw new Error('App shell Vite build manifest must be a JSON object.');
  }

  const manifest: KovoAppShellViteManifest = {};
  for (const [entry, rawChunk] of Object.entries(value)) {
    if (!isRecord(rawChunk)) {
      throw new Error(`App shell Vite build manifest entry '${entry}' must be a JSON object.`);
    }

    const chunk: KovoAppShellViteManifestChunk = {};
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

function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}
