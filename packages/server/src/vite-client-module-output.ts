import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import type { JisoAppShellBuiltClientModule } from './vite-build.js';
import { viteDistSourcePath } from './vite-build-assets.js';

export interface JisoAppShellViteClientModuleOutputPlanItem {
  path: string;
  targetPath: string;
}

interface JisoAppShellViteClientModuleWrite extends JisoAppShellViteClientModuleOutputPlanItem {
  source: string;
}

export async function writeJisoAppShellViteClientModuleOutput(
  root: string,
  modules: readonly JisoAppShellBuiltClientModule[],
): Promise<void> {
  const writes = jisoAppShellViteClientModuleWrites(root, modules);

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

export function jisoAppShellViteClientModuleOutputPlan(
  root: string,
  modules: readonly JisoAppShellBuiltClientModule[],
): JisoAppShellViteClientModuleOutputPlanItem[] {
  // SPEC §9.5: build hooks and static export tasks inspect the same immutable
  // /c/ module targets that the Vite app-shell output commit will publish.
  return jisoAppShellViteClientModuleWrites(root, modules).map((write) => ({
    path: write.path,
    targetPath: write.targetPath,
  }));
}

function jisoAppShellViteClientModuleWrites(
  root: string,
  modules: readonly JisoAppShellBuiltClientModule[],
): JisoAppShellViteClientModuleWrite[] {
  return modules.map((module) => ({
    path: module.path,
    source: module.source,
    targetPath: viteDistSourcePath(root, module.file),
  }));
}

async function writeJisoAppShellViteClientModuleFile(
  source: string,
  targetPath: string,
): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, source, 'utf8');
}

function assertNoJisoAppShellViteClientModuleWriteConflicts(
  writes: readonly JisoAppShellViteClientModuleWrite[],
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
  writes: readonly JisoAppShellViteClientModuleWrite[],
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
