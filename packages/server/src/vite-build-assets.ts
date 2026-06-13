import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { StaticExportAssetInput } from './static-export.js';
import {
  jisoAppShellViteManifestAssets,
  jisoAppShellViteManifestFromFile,
  normalizedDistFile,
  type JisoAppShellBuildAsset,
  type JisoAppShellViteManifestHintOptions,
} from './vite-manifest.js';

export interface JisoAppShellViteStaticExportAssetOptions {
  distDir: string | URL;
}

export interface JisoAppShellViteBuildStaticExportAssetOptions extends JisoAppShellViteStaticExportAssetOptions {
  assets?: readonly StaticExportAssetInput[];
}

export interface JisoAppShellViteManifestFileStaticExportAssetOptions extends JisoAppShellViteStaticExportAssetOptions {
  base?: string;
  manifestFile?: string | URL;
}

export function jisoAppShellViteStaticExportAssets(
  assets: readonly JisoAppShellBuildAsset[],
  options: JisoAppShellViteStaticExportAssetOptions,
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

export async function jisoAppShellViteStaticExportAssetsFromManifestFile(
  options: JisoAppShellViteManifestFileStaticExportAssetOptions,
): Promise<StaticExportAssetInput[]> {
  return jisoAppShellViteStaticExportAssets(
    jisoAppShellViteManifestAssets(
      await jisoAppShellViteManifestFromFile(
        options.manifestFile ?? jisoAppShellViteManifestFile(options.distDir),
      ),
      viteManifestOptions(options.base),
    ),
    { distDir: options.distDir },
  );
}

export function jisoAppShellViteBuildStaticExportAssets(
  build: { assets: readonly JisoAppShellBuildAsset[] },
  options: JisoAppShellViteBuildStaticExportAssetOptions,
): StaticExportAssetInput[] {
  return [
    ...jisoAppShellViteStaticExportAssets(build.assets, { distDir: options.distDir }),
    ...(options.assets ?? []),
  ];
}

export function jisoAppShellViteManifestFile(distDir: string | URL): string {
  return path.join(resolvedFileSystemPath(distDir), '.vite', 'manifest.json');
}

export function resolvedFileSystemPath(value: string | URL): string {
  return path.resolve(value instanceof URL ? fileURLToPath(value) : value);
}

export function viteDistSourcePath(distDir: string | URL, file: string): string {
  const root = resolvedFileSystemPath(distDir);
  const targetPath = path.resolve(root, normalizedDistFile(file));
  if (targetPath === root || targetPath.startsWith(`${root}${path.sep}`)) return targetPath;

  throw new Error(`App shell build asset must stay within the Vite output directory: ${file}`);
}

function viteManifestOptions(base: string | undefined): JisoAppShellViteManifestHintOptions {
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
