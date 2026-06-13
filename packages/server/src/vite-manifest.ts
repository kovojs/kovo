import { readFile } from 'node:fs/promises';
import type { PageHintOptions } from './hints.js';

export interface JisoAppShellViteManifestChunk {
  css?: readonly string[];
  file?: string;
  imports?: readonly string[];
  isEntry?: boolean;
  src?: string;
}

export type JisoAppShellViteManifest = Record<string, JisoAppShellViteManifestChunk>;

export interface JisoAppShellViteManifestHintOptions {
  base?: string;
}

export interface JisoAppShellViteOutputAsset {
  fileName: string;
  source: string | Uint8Array;
  type: 'asset';
}

export interface JisoAppShellViteOutputChunk {
  fileName: string;
  type: 'chunk';
}

export type JisoAppShellViteOutputBundle = Readonly<
  Record<string, JisoAppShellViteOutputAsset | JisoAppShellViteOutputChunk>
>;

export interface JisoAppShellRouteBuildEntry {
  entries: readonly string[];
  routePath: string;
}

export type JisoAppShellRouteEntryMap = Readonly<Record<string, string | readonly string[]>>;

export interface JisoAppShellViteRouteEntryOptions {
  manifest?: JisoAppShellViteManifest;
  routes?: readonly { path: string }[];
}

export interface JisoAppShellBuildAsset {
  file: string;
  href: string;
  path: string;
}

export function jisoAppShellViteManifestHints(
  manifest: JisoAppShellViteManifest,
  entries: readonly string[],
  options: JisoAppShellViteManifestHintOptions = {},
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

export function jisoAppShellViteRouteEntries(
  routeEntryMap: JisoAppShellRouteEntryMap,
  options: JisoAppShellViteRouteEntryOptions = {},
): JisoAppShellRouteBuildEntry[] {
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
    const ordered: JisoAppShellRouteBuildEntry[] = [];
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

export function jisoAppShellViteManifestAssets(
  manifest: JisoAppShellViteManifest,
  options: JisoAppShellViteManifestHintOptions = {},
): JisoAppShellBuildAsset[] {
  const assets = new Map<string, JisoAppShellBuildAsset>();

  for (const chunk of Object.values(manifest)) {
    addManifestBuildAsset(assets, chunk.file, options);
    for (const stylesheet of chunk.css ?? []) addManifestBuildAsset(assets, stylesheet, options);
  }

  return [...assets.values()].sort((left, right) => left.file.localeCompare(right.file));
}

export async function jisoAppShellViteManifestFromFile(
  manifestFile: string | URL,
): Promise<JisoAppShellViteManifest> {
  const source = await readFile(manifestFile, 'utf8');
  return jisoAppShellViteManifestFromSource(source);
}

export async function jisoAppShellViteManifestAssetsFromFile(
  manifestFile: string | URL,
  options: JisoAppShellViteManifestHintOptions = {},
): Promise<JisoAppShellBuildAsset[]> {
  return jisoAppShellViteManifestAssets(
    await jisoAppShellViteManifestFromFile(manifestFile),
    options,
  );
}

function jisoAppShellViteManifestStylesheetHrefs(
  manifest: JisoAppShellViteManifest,
  options: JisoAppShellViteManifestHintOptions = {},
): string[] {
  return jisoAppShellViteManifestAssets(manifest, options)
    .filter((asset) => asset.file.endsWith('.css'))
    .map((asset) => asset.href);
}

export function jisoAppShellViteManifestStylesheetHref(
  manifest: JisoAppShellViteManifest,
  options: JisoAppShellViteManifestHintOptions = {},
): string {
  const hrefs = jisoAppShellViteManifestStylesheetHrefs(manifest, options);
  if (hrefs.length !== 1) {
    throw new Error(
      `App shell Vite build manifest must contain exactly one stylesheet asset; found ${hrefs.length}.`,
    );
  }

  const href = hrefs[0];
  if (href === undefined) {
    throw new Error(
      `App shell Vite build manifest must contain exactly one stylesheet asset; found ${hrefs.length}.`,
    );
  }

  return href;
}

export async function jisoAppShellViteManifestStylesheetHrefFromFile(
  manifestFile: string | URL,
  options: JisoAppShellViteManifestHintOptions = {},
): Promise<string> {
  return jisoAppShellViteManifestStylesheetHref(
    await jisoAppShellViteManifestFromFile(manifestFile),
    options,
  );
}

export function jisoAppShellViteManifestFromBundle(
  bundle: JisoAppShellViteOutputBundle,
): JisoAppShellViteManifest {
  const manifestAsset = Object.values(bundle).find(
    (asset): asset is JisoAppShellViteOutputAsset =>
      asset.type === 'asset' && asset.fileName.replaceAll('\\', '/') === '.vite/manifest.json',
  );
  if (!manifestAsset) throw new Error('App shell Vite build requires .vite/manifest.json.');

  const source =
    typeof manifestAsset.source === 'string'
      ? manifestAsset.source
      : Buffer.from(manifestAsset.source).toString('utf8');

  return jisoAppShellViteManifestFromSource(source);
}

export function normalizedDistFile(file: string): string {
  const pathname = file.replace(/[?#].*$/, '').replace(/^\/+/, '');
  const segments = pathname.split('/');

  if (segments.length === 0 || segments.some((segment) => !isSafeDistFileSegment(segment))) {
    throw new Error(`App shell build asset must stay within the Vite output directory: ${file}`);
  }

  return segments.join('/');
}

function jisoAppShellViteManifestFromSource(source: string): JisoAppShellViteManifest {
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

  return jisoAppShellViteManifestFromUnknown(parsed);
}

function addManifestBuildAsset(
  assets: Map<string, JisoAppShellBuildAsset>,
  file: string | undefined,
  options: JisoAppShellViteManifestHintOptions,
): void {
  if (!file || isExternalAssetHref(file)) return;

  const normalizedFile = normalizedDistFile(file);
  if (assets.has(normalizedFile)) return;

  const href = manifestAssetHref(normalizedFile, options.base);
  const url = new URL(href, 'https://jiso.local');

  assets.set(normalizedFile, {
    file: normalizedFile,
    href,
    path: url.pathname,
  });
}

function collectManifestHints(
  manifest: JisoAppShellViteManifest,
  entry: string,
  options: JisoAppShellViteManifestHintOptions,
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
  manifest: JisoAppShellViteManifest,
  entry: string,
): { chunk: JisoAppShellViteManifestChunk; key: string } | undefined {
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

  return `${base.replace(/\/?$/, '/')}${file.replace(/^\/+/, '')}`;
}

function isExternalAssetHref(file: string): boolean {
  return file.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(file);
}

function jisoAppShellViteManifestFromUnknown(value: unknown): JisoAppShellViteManifest {
  if (!isRecord(value)) {
    throw new Error('App shell Vite build manifest must be a JSON object.');
  }

  const manifest: JisoAppShellViteManifest = {};
  for (const [entry, rawChunk] of Object.entries(value)) {
    if (!isRecord(rawChunk)) {
      throw new Error(`App shell Vite build manifest entry '${entry}' must be a JSON object.`);
    }

    const chunk: JisoAppShellViteManifestChunk = {};
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
