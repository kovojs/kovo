import * as path from 'node:path';

import { exportStaticApp } from './static-export.js';
import type { KovoAppShellBuild, KovoAppShellBuiltClientModule } from './vite-build.js';
import { kovoAppShellViteStaticExportAssets, resolvedFileSystemPath } from './vite-build-assets.js';
import type { StaticExportAssetInput, StaticExportResult } from './static-export-types.js';
import {
  kovoAppShellViteBuildOutputStaticExportPlan,
  type KovoAppShellViteBuildOutputStaticExportOptions,
} from './vite-static-export-options.js';
import {
  assertWritableKovoAppShellViteClientModuleOutput,
  kovoAppShellViteClientModuleOutputPlan,
  writeKovoAppShellViteClientModuleOutput,
  type KovoAppShellViteClientModuleOutputPlanItem,
} from './vite-client-module-output.js';

export interface KovoAppShellViteOutputOptions {
  dir?: string;
  file?: string;
}

export interface KovoAppShellViteBuildOutputOptions {
  outDir: string | URL;
  staticExport?: KovoAppShellViteBuildOutputStaticExportOptions | false;
}

export interface KovoAppShellViteBuildOutput {
  clientModuleOutputPlan: readonly KovoAppShellViteClientModuleOutputPlanItem[];
  clientModules: readonly KovoAppShellBuiltClientModule[];
  staticExport?: StaticExportResult;
  staticExportAssets: readonly StaticExportAssetInput[];
}

export async function writeKovoAppShellViteBuildOutput(
  build: Pick<KovoAppShellBuild, 'clientModules'> &
    Partial<Pick<KovoAppShellBuild, 'app' | 'assets'>>,
  options: KovoAppShellViteBuildOutputOptions,
): Promise<KovoAppShellViteBuildOutput> {
  const root = resolvedFileSystemPath(options.outDir);
  const staticExportOptions = options.staticExport || undefined;
  const staticExportBuild = staticExportOptions ? assertStaticExportBuild(build) : undefined;
  const staticExportPlan =
    staticExportBuild && staticExportOptions
      ? kovoAppShellViteBuildOutputStaticExportPlan(staticExportBuild, staticExportOptions, root)
      : undefined;
  const staticExportAssets =
    staticExportPlan?.assets ??
    kovoAppShellViteStaticExportAssets(build.assets ?? [], { distDir: root });

  const output: KovoAppShellViteBuildOutput = {
    clientModuleOutputPlan: kovoAppShellViteClientModuleOutputPlan(root, build.clientModules),
    clientModules: build.clientModules,
    staticExportAssets,
  };

  await assertWritableKovoAppShellViteClientModuleOutput(root, build.clientModules);

  if (staticExportBuild && staticExportPlan) {
    output.staticExport = await exportStaticApp(staticExportBuild.app, staticExportPlan.options);
  }

  await writeKovoAppShellViteClientModuleOutput(root, build.clientModules);

  return output;
}

export function kovoAppShellViteOutputDir(options: KovoAppShellViteOutputOptions): string {
  if (options.dir) return options.dir;
  if (options.file) return path.dirname(options.file);

  throw new Error('App shell Vite build output requires output.dir or output.file.');
}

function assertStaticExportBuild(
  build: Pick<KovoAppShellBuild, 'clientModules'> &
    Partial<Pick<KovoAppShellBuild, 'app' | 'assets'>>,
): KovoAppShellBuild {
  if (!build.app) {
    throw new Error('App shell Vite build output static export requires a Kovo app.');
  }

  return {
    app: build.app,
    assets: build.assets ?? [],
    clientModules: build.clientModules,
    routeHints: [],
  };
}
