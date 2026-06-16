import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
import type { StaticExportAssetInput } from './static-export-types.js';
import {
  kovoAppShellViteManifestAssets,
  kovoAppShellViteManifestFromFile,
  normalizedDistFile,
  type KovoAppShellBuildAsset,
  type KovoAppShellViteManifestHintOptions,
} from './vite-manifest.js';

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
  return assets.map((asset) => {
    const contentType = viteAssetContentType(asset.file);

    return {
      ...(contentType === undefined ? {} : { contentType }),
      path: asset.path,
      source: viteDistSourcePath(options.distDir, asset.file),
    };
  });
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Reads a manifest file
 * and returns its assets as static-export asset inputs.
 * Exported only for in-repo build/host config, not app authors.
 */
export async function kovoAppShellViteStaticExportAssetsFromManifestFile(
  options: KovoAppShellViteManifestFileStaticExportAssetOptions,
): Promise<StaticExportAssetInput[]> {
  return kovoAppShellViteStaticExportAssets(
    kovoAppShellViteManifestAssets(
      await kovoAppShellViteManifestFromFile(
        options.manifestFile ?? kovoAppShellViteManifestFile(options.distDir),
      ),
      viteManifestOptions(options.base),
    ),
    { distDir: options.distDir },
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
  return [
    ...kovoAppShellViteStaticExportAssets(build.assets, { distDir: options.distDir }),
    ...(options.assets ?? []),
  ];
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Resolves the default
 * .vite/manifest.json path within a Vite output directory.
 * Exported only for in-repo build/host config, not app authors.
 */
export function kovoAppShellViteManifestFile(distDir: string | URL): string {
  return path.join(resolvedFileSystemPath(distDir), '.vite', 'manifest.json');
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Resolves a filesystem
 * path or file: URL to an absolute path, rejecting other URL protocols.
 * Exported only for in-repo build/host config, not app authors.
 */
export function resolvedFileSystemPath(value: string | URL): string {
  if (value instanceof URL) {
    if (value.protocol === 'file:') return path.resolve(fileURLToPath(value));

    throw new StaticExportError([
      staticExportDiagnostic(
        'vite-distDir',
        `KV229 Vite app-shell filesystem roots must be filesystem paths or file: URLs, received '${value.href}'. SPEC §9.5 static export copies Vite assets from a local output directory.`,
      ),
    ]);
  }

  return path.resolve(value);
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Resolves a dist-relative
 * file to an absolute source path inside the output directory, rejecting traversal.
 * Exported only for in-repo build/host config, not app authors.
 */
export function viteDistSourcePath(distDir: string | URL, file: string): string {
  const root = resolvedFileSystemPath(distDir);
  const targetPath = path.resolve(root, normalizedDistFile(file));
  if (targetPath === root || targetPath.startsWith(`${root}${path.sep}`)) return targetPath;

  throw new Error(`App shell build asset must stay within the Vite output directory: ${file}`);
}

function viteManifestOptions(base: string | undefined): KovoAppShellViteManifestHintOptions {
  return base === undefined ? {} : { base };
}

function viteAssetContentType(file: string): string | undefined {
  const extension = path.extname(file).toLowerCase();

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
