import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import type { JisoAppShellBuild, JisoAppShellBuiltClientModule } from './vite-build.js';
import {
  jisoAppShellViteStaticExportAssets,
  resolvedFileSystemPath,
  viteDistSourcePath,
} from './vite-build-assets.js';
import type { StaticExportAssetInput, StaticExportResult } from './static-export.js';

export interface JisoAppShellViteOutputOptions {
  dir?: string;
  file?: string;
}

export interface JisoAppShellViteBuildOutputOptions {
  outDir: string | URL;
}

export interface JisoAppShellViteBuildOutput {
  clientModules: readonly JisoAppShellBuiltClientModule[];
  staticExport?: StaticExportResult;
  staticExportAssets: readonly StaticExportAssetInput[];
}

export async function writeJisoAppShellViteBuildOutput(
  build: Pick<JisoAppShellBuild, 'clientModules'> & Partial<Pick<JisoAppShellBuild, 'assets'>>,
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

  return {
    clientModules: build.clientModules,
    staticExportAssets: jisoAppShellViteStaticExportAssets(build.assets ?? [], { distDir: root }),
  };
}

export function jisoAppShellViteOutputDir(options: JisoAppShellViteOutputOptions): string {
  if (options.dir) return options.dir;
  if (options.file) return path.dirname(options.file);

  throw new Error('App shell Vite build output requires output.dir or output.file.');
}
