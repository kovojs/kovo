import * as path from 'node:path';

import { exportStaticApp } from './static-export.js';
import type { JisoAppShellBuild, JisoAppShellBuiltClientModule } from './vite-build.js';
import { jisoAppShellViteStaticExportAssets, resolvedFileSystemPath } from './vite-build-assets.js';
import type { StaticExportAssetInput, StaticExportResult } from './static-export-types.js';
import {
  jisoAppShellViteBuildOutputStaticExportPlan,
  type JisoAppShellViteBuildOutputStaticExportOptions,
} from './vite-static-export-options.js';
import {
  assertWritableJisoAppShellViteClientModuleOutput,
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
  const staticExportPlan =
    staticExportBuild && staticExportOptions
      ? jisoAppShellViteBuildOutputStaticExportPlan(staticExportBuild, staticExportOptions, root)
      : undefined;
  const staticExportAssets =
    staticExportPlan?.assets ??
    jisoAppShellViteStaticExportAssets(build.assets ?? [], { distDir: root });

  const output: JisoAppShellViteBuildOutput = {
    clientModuleOutputPlan: jisoAppShellViteClientModuleOutputPlan(root, build.clientModules),
    clientModules: build.clientModules,
    staticExportAssets,
  };

  await assertWritableJisoAppShellViteClientModuleOutput(root, build.clientModules);

  if (staticExportBuild && staticExportPlan) {
    output.staticExport = await exportStaticApp(staticExportBuild.app, staticExportPlan.options);
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
