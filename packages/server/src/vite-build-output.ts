import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import type { JisoAppShellBuild, JisoAppShellBuiltClientModule } from './vite-build.js';
import {
  jisoAppShellViteStaticExportAssets,
  resolvedFileSystemPath,
  viteDistSourcePath,
} from './vite-build-assets.js';
import type { StaticExportAssetInput, StaticExportResult } from './static-export.js';
import {
  exportJisoAppShellViteBuild,
  type JisoAppShellViteBuildStaticExportOptions,
} from './vite-static-export.js';

export interface JisoAppShellViteOutputOptions {
  dir?: string;
  file?: string;
}

export interface JisoAppShellViteBuildOutputOptions {
  outDir: string | URL;
  staticExport?: JisoAppShellViteBuildOutputStaticExportOptions | false;
}

export interface JisoAppShellViteBuildOutputStaticExportOptions extends Omit<
  JisoAppShellViteBuildStaticExportOptions,
  'distDir'
> {
  distDir?: never;
}

export interface JisoAppShellViteBuildOutput {
  clientModules: readonly JisoAppShellBuiltClientModule[];
  staticExport?: StaticExportResult;
  staticExportAssets: readonly StaticExportAssetInput[];
}

export async function writeJisoAppShellViteBuildOutput(
  build: Pick<JisoAppShellBuild, 'clientModules'> &
    Partial<Pick<JisoAppShellBuild, 'app' | 'assets'>>,
  options: JisoAppShellViteBuildOutputOptions,
): Promise<JisoAppShellViteBuildOutput> {
  const root = resolvedFileSystemPath(options.outDir);

  for (const module of build.clientModules) {
    // SPEC §9.5: production app-shell builds publish immutable /c/ client modules
    // as files a static host can retain by versioned URL.
    const targetPath = viteDistSourcePath(root, module.file);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, module.source, 'utf8');
  }

  const output: JisoAppShellViteBuildOutput = {
    clientModules: build.clientModules,
    staticExportAssets: jisoAppShellViteStaticExportAssets(build.assets ?? [], { distDir: root }),
  };
  if (!options.staticExport) return output;

  output.staticExport = await exportJisoAppShellViteBuild(assertStaticExportBuild(build), {
    ...options.staticExport,
    distDir: root,
  });

  return output;
}

export function jisoAppShellViteOutputDir(options: JisoAppShellViteOutputOptions): string {
  if (options.dir) return options.dir;
  if (options.file) return path.dirname(options.file);

  throw new Error('App shell Vite build output requires output.dir or output.file.');
}

function assertStaticExportBuild(
  build: Pick<JisoAppShellBuild, 'clientModules'> &
    Partial<Pick<JisoAppShellBuild, 'app' | 'assets'>>,
): JisoAppShellBuild {
  if (!build.app) {
    throw new Error('App shell Vite build output static export requires a Jiso app.');
  }

  return {
    app: build.app,
    assets: build.assets ?? [],
    clientModules: build.clientModules,
    routeHints: [],
  };
}
