import { confinedPath } from '@kovojs/core/internal/filesystem';

import {
  buildOwnDataProperty,
  buildSecurityFileUrlToPath,
  buildSecurityPathExtname,
  buildSecurityPathJoin,
  buildSecurityPathResolve,
  snapshotBuildArray,
} from './build-security-intrinsics.js';
import {
  securityIsUrl,
  securityStringToLowerCase,
  securityUrlObjectSnapshot,
} from './response-security-intrinsics.js';
import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
import type { StaticExportAssetInput } from './static-export-types.js';
import {
  kovoAppShellViteManifestAssets,
  kovoAppShellViteManifestFromFile,
  normalizedDistFile,
  type KovoAppShellBuildAsset,
  type KovoAppShellViteManifestHintOptions,
} from './vite-manifest.js';
import { witnessArrayAppend } from './security-witness-intrinsics.js';

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Base asset-copy options
 * carrying the Vite output dist directory.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteStaticExportAssetOptions {
  distDir: string | URL;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Asset-copy options for
 * a built app shell plus extra author-provided assets.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteBuildStaticExportAssetOptions extends KovoAppShellViteStaticExportAssetOptions {
  assets?: readonly StaticExportAssetInput[];
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Asset-copy options for
 * deriving assets directly from a manifest file.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteManifestFileStaticExportAssetOptions extends KovoAppShellViteStaticExportAssetOptions {
  base?: string;
  manifestFile?: string | URL;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Maps built manifest
 * assets into static-export asset inputs sourced from the dist directory.
 * Exported only for in-repo build/host config, not app authors.
 */
export function kovoAppShellViteStaticExportAssets(
  assets: readonly KovoAppShellBuildAsset[],
  options: KovoAppShellViteStaticExportAssetOptions,
): StaticExportAssetInput[] {
  const source = snapshotBuildArray(assets, 'Vite manifest build assets');
  const distDir = requiredViteAssetOption(options, 'distDir') as string | URL;
  const mapped: StaticExportAssetInput[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const asset = snapshotViteManifestBuildAsset(source[index], index);
    const contentType = viteAssetContentType(asset.file);

    witnessArrayAppend(
      mapped,
      {
        ...(contentType === undefined ? {} : { contentType }),
        path: asset.path,
        // SPEC §6.6/§9.5: manifest-derived assets never carry caller-provided source authority.
        // Derive the source from the one exact file snapshot through dist-root confinement.
        source: viteDistSourcePath(distDir, asset.file),
      },
      'Server packages/server/src/vite-build-assets.ts collection',
    );
  }
  return mapped;
}

function snapshotViteManifestBuildAsset(
  value: KovoAppShellBuildAsset | undefined,
  index: number,
): KovoAppShellBuildAsset {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`Vite manifest build asset ${index} must be an object.`);
  }
  return {
    file: requiredViteAssetString(value, 'file', `Vite manifest build asset ${index}.file`),
    href: requiredViteAssetString(value, 'href', `Vite manifest build asset ${index}.href`),
    path: requiredViteAssetString(value, 'path', `Vite manifest build asset ${index}.path`),
  };
}

function viteAssetOptionsObject(value: unknown, label: string): object {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${label} must be an own-data object.`);
  }
  return value;
}

function requiredViteAssetOption(options: object, property: PropertyKey): unknown {
  const field = buildOwnDataProperty(options, property, `Vite asset options.${String(property)}`);
  if (!field.present || field.value === undefined) {
    throw new TypeError(`Vite asset option ${String(property)} is required.`);
  }
  return field.value;
}

function optionalViteAssetOption(options: object, property: PropertyKey): unknown {
  const field = buildOwnDataProperty(options, property, `Vite asset options.${String(property)}`);
  return field.present ? field.value : undefined;
}

function requiredViteAssetString(value: object, property: PropertyKey, label: string): string {
  const field = buildOwnDataProperty(value, property, label);
  if (!field.present || typeof field.value !== 'string') {
    throw new TypeError(`${label} must be a string.`);
  }
  return field.value;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Reads a manifest file
 * and returns its assets as static-export asset inputs.
 * Exported only for in-repo build/host config, not app authors.
 */
export async function kovoAppShellViteStaticExportAssetsFromManifestFile(
  options: KovoAppShellViteManifestFileStaticExportAssetOptions,
): Promise<StaticExportAssetInput[]> {
  const source = viteAssetOptionsObject(options, 'Vite manifest-file asset options');
  const distDir = requiredViteAssetOption(source, 'distDir') as string | URL;
  const base = optionalViteAssetOption(source, 'base') as string | undefined;
  const manifestFile = optionalViteAssetOption(source, 'manifestFile') as string | URL | undefined;
  return kovoAppShellViteStaticExportAssets(
    kovoAppShellViteManifestAssets(
      await kovoAppShellViteManifestFromFile(manifestFile ?? kovoAppShellViteManifestFile(distDir)),
      viteManifestOptions(base),
    ),
    { distDir },
  );
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Combines a built app
 * shell's manifest assets with extra author-provided assets.
 * Exported only for in-repo build/host config, not app authors.
 */
export function kovoAppShellViteBuildStaticExportAssets(
  build: { assets: readonly KovoAppShellBuildAsset[] },
  options: KovoAppShellViteBuildStaticExportAssetOptions,
): StaticExportAssetInput[] {
  const buildObject = viteAssetOptionsObject(build, 'Vite app-shell build');
  const buildAssets = requiredViteAssetOption(
    buildObject,
    'assets',
  ) as readonly KovoAppShellBuildAsset[];
  const optionObject = viteAssetOptionsObject(options, 'Vite build static-export asset options');
  const distDir = requiredViteAssetOption(optionObject, 'distDir') as string | URL;
  const authorAssets = optionalViteAssetOption(optionObject, 'assets') as
    | readonly StaticExportAssetInput[]
    | undefined;
  const manifestAssets = kovoAppShellViteStaticExportAssets(buildAssets, { distDir });
  const pinnedAuthorAssets = snapshotBuildArray(
    authorAssets ?? [],
    'explicit author static-export assets',
  );
  const combined: StaticExportAssetInput[] = [];
  for (let index = 0; index < manifestAssets.length; index += 1) {
    witnessArrayAppend(
      combined,
      manifestAssets[index]!,
      'Server packages/server/src/vite-build-assets.ts collection',
    );
  }
  // Explicit author assets intentionally retain their own source API. They are snapshotted as a
  // separate collection and never confused with manifest assets whose source is dist-confined.
  for (let index = 0; index < pinnedAuthorAssets.length; index += 1) {
    witnessArrayAppend(
      combined,
      pinnedAuthorAssets[index]!,
      'Server packages/server/src/vite-build-assets.ts collection',
    );
  }
  return combined;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Resolves the default
 * .vite/manifest.json path within a Vite output directory.
 * Exported only for in-repo build/host config, not app authors.
 */
export function kovoAppShellViteManifestFile(distDir: string | URL): string {
  return buildSecurityPathJoin(resolvedFileSystemPath(distDir), '.vite', 'manifest.json');
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Resolves a filesystem
 * path or file: URL to an absolute path, rejecting other URL protocols.
 * Exported only for in-repo build/host config, not app authors.
 */
export function resolvedFileSystemPath(value: string | URL): string {
  if (securityIsUrl(value)) {
    const snapshot = securityUrlObjectSnapshot(value);
    if (snapshot.protocol === 'file:') {
      return buildSecurityPathResolve(buildSecurityFileUrlToPath(snapshot.href));
    }

    throw new StaticExportError([
      staticExportDiagnostic(
        'vite-distDir',
        `KV229 Vite app-shell filesystem roots must be filesystem paths or file: URLs, received '${snapshot.href}'. SPEC §9.5 static export copies Vite assets from a local output directory.`,
      ),
    ]);
  }

  return buildSecurityPathResolve(value);
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Resolves a dist-relative
 * file to an absolute source path inside the output directory, rejecting traversal.
 * Exported only for in-repo build/host config, not app authors.
 */
export function viteDistSourcePath(distDir: string | URL, file: string): string {
  const root = resolvedFileSystemPath(distDir);
  // SPEC §6.6: source-root classification and the returned path share the core filesystem
  // membrane. Do not re-check containment through mutable String.prototype.startsWith.
  const targetPath = confinedPath(root, normalizedDistFile(file));
  if (targetPath !== undefined) return targetPath;

  throw new Error(`App shell build asset must stay within the Vite output directory: ${file}`);
}

function viteManifestOptions(base: string | undefined): KovoAppShellViteManifestHintOptions {
  return base === undefined ? {} : { base };
}

function viteAssetContentType(file: string): string | undefined {
  const extension = securityStringToLowerCase(buildSecurityPathExtname(file));

  switch (extension) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return undefined;
  }
}
