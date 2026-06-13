import * as path from 'node:path';

import type { JisoAppShellBuild, JisoAppShellBuiltClientModule } from './vite-build.js';
import { jisoAppShellViteStaticExportAssets, resolvedFileSystemPath } from './vite-build-assets.js';
import type { StaticExportAssetInput, StaticExportResult } from './static-export.js';
import {
  exportJisoAppShellViteBuild,
  type JisoAppShellViteBuildStaticExportOptions,
} from './vite-static-export.js';
import { writeJisoAppShellViteClientModuleOutput } from './vite-client-module-output.js';

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

  const output: JisoAppShellViteBuildOutput = {
    clientModules: build.clientModules,
    staticExportAssets: jisoAppShellViteStaticExportAssets(build.assets ?? [], { distDir: root }),
  };

  if (options.staticExport) {
    output.staticExport = await exportJisoAppShellViteBuild(assertStaticExportBuild(build), {
      ...options.staticExport,
      distDir: root,
    });
  }

  await writeJisoAppShellViteClientModuleOutput(root, build.clientModules);

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
