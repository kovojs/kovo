import * as path from 'node:path';

import { exportStaticApp } from './static-export.js';
import type { JisoAppShellBuild, JisoAppShellBuiltClientModule } from './vite-build.js';
import {
  jisoAppShellViteBuildStaticExportAssets,
  jisoAppShellViteStaticExportAssets,
  resolvedFileSystemPath,
} from './vite-build-assets.js';
import type { StaticExportAssetInput, StaticExportResult } from './static-export-types.js';
import type { JisoAppShellViteBuildStaticExportOptions } from './vite-static-export.js';
import {
  jisoAppShellViteClientModuleOutputPlan,
  writeJisoAppShellViteClientModuleOutput,
  type JisoAppShellViteClientModuleOutputPlanItem,
} from './vite-client-module-output.js';

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
  clientModuleOutputPlan: readonly JisoAppShellViteClientModuleOutputPlanItem[];
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
  const staticExportOptions = options.staticExport || undefined;
  const staticExportBuild = staticExportOptions ? assertStaticExportBuild(build) : undefined;
  const staticExportAssets =
    staticExportBuild && staticExportOptions
      ? jisoAppShellViteBuildStaticExportAssets(staticExportBuild, {
          ...(staticExportOptions.assets === undefined
            ? {}
            : { assets: staticExportOptions.assets }),
          distDir: root,
        })
      : jisoAppShellViteStaticExportAssets(build.assets ?? [], { distDir: root });

  const output: JisoAppShellViteBuildOutput = {
    clientModuleOutputPlan: jisoAppShellViteClientModuleOutputPlan(root, build.clientModules),
    clientModules: build.clientModules,
    staticExportAssets,
  };

  if (staticExportBuild && staticExportOptions) {
    output.staticExport = await exportStaticApp(staticExportBuild.app, {
      ...staticExportOptionsForViteBuildOutput(staticExportOptions),
      assets: staticExportAssets,
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

function staticExportOptionsForViteBuildOutput({
  assets: _assets,
  distDir: _distDir,
  ...options
}: JisoAppShellViteBuildOutputStaticExportOptions): Omit<
  JisoAppShellViteBuildOutputStaticExportOptions,
  'assets' | 'distDir'
> {
  return options;
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
