import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import type { KovoAppShellBuiltClientModule } from './vite-build.js';
import { viteDistSourcePath } from './vite-build-assets.js';

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Planned immutable
 * /c/ module output target.
 */
export interface KovoAppShellViteClientModuleOutputPlanItem {
  path: string;
  targetPath: string;
}

interface KovoAppShellViteClientModuleWrite extends KovoAppShellViteClientModuleOutputPlanItem {
  source: string;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Atomically writes
 * built client modules into the Vite output directory.
 */
export async function writeKovoAppShellViteClientModuleOutput(
  root: string,
  modules: readonly KovoAppShellBuiltClientModule[],
): Promise<void> {
  const writes = kovoAppShellViteClientModuleWrites(root, modules);

  // SPEC §9.5: production app-shell builds publish immutable /c/ modules
  // through one validated output commit, so export rejection never leaves partial files.
  assertNoKovoAppShellViteClientModuleWriteConflicts(writes);
  await assertWritableKovoAppShellViteClientModuleTargets(root, writes);
  if (writes.length === 0) return;

  const stagingRoot = await createKovoAppShellViteStagingRoot(root);
  try {
    await Promise.all(
      writes.map((write) =>
        writeKovoAppShellViteClientModuleFile(
          write.source,
          kovoAppShellViteStagedTargetPath(root, stagingRoot, write.targetPath),
        ),
      ),
    );

    for (const write of writes) {
      const stagedPath = kovoAppShellViteStagedTargetPath(root, stagingRoot, write.targetPath);
      await mkdir(path.dirname(write.targetPath), { recursive: true });
      await rename(stagedPath, write.targetPath);
    }
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Validates client
 * module output targets before static export writes begin.
 */
export async function assertWritableKovoAppShellViteClientModuleOutput(
  root: string,
  modules: readonly KovoAppShellBuiltClientModule[],
): Promise<void> {
  const writes = kovoAppShellViteClientModuleWrites(root, modules);

  // SPEC §9.5: plugin-time static export must not publish static-host files
  // until the matching Vite /c/ module output has proved its target boundary.
  assertNoKovoAppShellViteClientModuleWriteConflicts(writes);
  await assertWritableKovoAppShellViteClientModuleTargets(root, writes);
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Returns the dry-run
 * client module output plan for build/export evidence.
 */
export function kovoAppShellViteClientModuleOutputPlan(
  root: string,
  modules: readonly KovoAppShellBuiltClientModule[],
): KovoAppShellViteClientModuleOutputPlanItem[] {
  // SPEC §9.5: build hooks and static export tasks inspect the same immutable
  // /c/ module targets that the Vite app-shell output commit will publish.
  return kovoAppShellViteClientModuleWrites(root, modules).map((write) => ({
    path: write.path,
    targetPath: write.targetPath,
  }));
}

function kovoAppShellViteClientModuleWrites(
  root: string,
  modules: readonly KovoAppShellBuiltClientModule[],
): KovoAppShellViteClientModuleWrite[] {
  return modules.map((module) => ({
    path: module.path,
    source: module.source,
    targetPath: viteDistSourcePath(root, module.file),
  }));
}

async function writeKovoAppShellViteClientModuleFile(
  source: string,
  targetPath: string,
): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, source, 'utf8');
}

function assertNoKovoAppShellViteClientModuleWriteConflicts(
  writes: readonly KovoAppShellViteClientModuleWrite[],
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

async function assertWritableKovoAppShellViteClientModuleTargets(
  root: string,
  writes: readonly KovoAppShellViteClientModuleWrite[],
): Promise<void> {
  for (const write of writes) {
    await assertKovoAppShellViteClientModuleParentDirectories(root, write.targetPath);
    await assertKovoAppShellViteClientModuleTargetIsNotDirectory(write.targetPath);
  }
}

async function assertKovoAppShellViteClientModuleParentDirectories(
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

async function assertKovoAppShellViteClientModuleTargetIsNotDirectory(
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

async function createKovoAppShellViteStagingRoot(root: string): Promise<string> {
  await mkdir(path.dirname(root), { recursive: true });
  return await mkdtemp(path.join(path.dirname(root), '.kovo-vite-app-shell-'));
}

function kovoAppShellViteStagedTargetPath(
  root: string,
  stagingRoot: string,
  targetPath: string,
): string {
  return path.join(stagingRoot, path.relative(root, targetPath));
}
