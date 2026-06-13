import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
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
  const clientModuleWrites = jisoAppShellViteClientModuleWrites(root, build.clientModules);

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

  await writeJisoAppShellViteClientModules(root, clientModuleWrites);

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

function jisoAppShellViteClientModuleWrites(
  root: string,
  modules: readonly JisoAppShellBuiltClientModule[],
): { source: string; targetPath: string }[] {
  return modules.map((module) => ({
    source: module.source,
    targetPath: viteDistSourcePath(root, module.file),
  }));
}

async function writeJisoAppShellViteClientModules(
  root: string,
  writes: readonly { source: string; targetPath: string }[],
): Promise<void> {
  // SPEC §9.5: production app-shell builds publish immutable /c/ modules
  // through one validated output commit, so export rejection never leaves partial files.
  assertNoJisoAppShellViteClientModuleWriteConflicts(writes);
  await assertWritableJisoAppShellViteClientModuleTargets(root, writes);
  if (writes.length === 0) return;

  const stagingRoot = await createJisoAppShellViteStagingRoot(root);
  try {
    await Promise.all(
      writes.map((write) =>
        writeJisoAppShellViteClientModuleFile(
          write.source,
          jisoAppShellViteStagedTargetPath(root, stagingRoot, write.targetPath),
        ),
      ),
    );

    for (const write of writes) {
      const stagedPath = jisoAppShellViteStagedTargetPath(root, stagingRoot, write.targetPath);
      await mkdir(path.dirname(write.targetPath), { recursive: true });
      await rename(stagedPath, write.targetPath);
    }
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}

async function writeJisoAppShellViteClientModuleFile(
  source: string,
  targetPath: string,
): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, source, 'utf8');
}

function assertNoJisoAppShellViteClientModuleWriteConflicts(
  writes: readonly { source: string; targetPath: string }[],
): void {
  const seen = new Set<string>();

  for (const write of writes) {
    if (seen.has(write.targetPath)) {
      throw new Error(
        `App shell Vite build output cannot write duplicate client module target: ${write.targetPath}`,
      );
    }

    seen.add(write.targetPath);
  }
}

async function assertWritableJisoAppShellViteClientModuleTargets(
  root: string,
  writes: readonly { source: string; targetPath: string }[],
): Promise<void> {
  for (const write of writes) {
    await assertJisoAppShellViteClientModuleParentDirectories(root, write.targetPath);
    await assertJisoAppShellViteClientModuleTargetIsNotDirectory(write.targetPath);
  }
}

async function assertJisoAppShellViteClientModuleParentDirectories(
  root: string,
  targetPath: string,
): Promise<void> {
  const relativeDirectory = path.relative(root, path.dirname(targetPath));
  const segments = relativeDirectory === '' ? [] : relativeDirectory.split(path.sep);
  let current = root;

  for (const segment of segments) {
    current = path.join(current, segment);

    let targetStat: Awaited<ReturnType<typeof lstat>>;
    try {
      targetStat = await lstat(current);
    } catch {
      continue;
    }

    if (!targetStat.isDirectory()) {
      throw new Error(
        `App shell Vite build output cannot write client module because parent '${current}' is not a directory.`,
      );
    }
  }
}

async function assertJisoAppShellViteClientModuleTargetIsNotDirectory(
  targetPath: string,
): Promise<void> {
  let targetStat: Awaited<ReturnType<typeof lstat>>;
  try {
    targetStat = await lstat(targetPath);
  } catch {
    return;
  }

  if (!targetStat.isDirectory()) return;

  throw new Error(
    `App shell Vite build output cannot write client module because target '${targetPath}' is a directory.`,
  );
}

async function createJisoAppShellViteStagingRoot(root: string): Promise<string> {
  await mkdir(path.dirname(root), { recursive: true });
  return await mkdtemp(path.join(path.dirname(root), '.jiso-vite-app-shell-'));
}

function jisoAppShellViteStagedTargetPath(
  root: string,
  stagingRoot: string,
  targetPath: string,
): string {
  return path.join(stagingRoot, path.relative(root, targetPath));
}
