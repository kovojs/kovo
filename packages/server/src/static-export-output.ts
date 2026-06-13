import { constants as fsConstants } from 'node:fs';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  staticExportOutputTargets,
  type StaticExportOutputPlanItem,
  type StaticExportOutputPlanItemKind,
  type StaticExportOutputTarget,
} from './static-export-output-targets.js';
import {
  StaticExportError,
  sortedHeaders,
  staticExportDiagnostic,
  type StaticExportArtifact,
  type StaticExportAssetArtifact,
  type StaticExportAssetInput,
  type StaticExportClientModuleArtifact,
} from './static-export-types.js';

export const STATIC_EXPORT_DRY_RUN_ROOT = '/__jiso_static_export_plan__';

export type { StaticExportOutputPlanItem, StaticExportOutputPlanItemKind };

export interface StaticExportOutputPlanOptions {
  outDir: string | URL;
}

interface StaticExportOutputArtifacts {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
}

export interface StaticExportOutputPlan extends StaticExportOutputArtifacts {
  outDir: string | URL;
  root: string;
  writes: readonly StaticExportPlannedWrite[];
}

interface StaticExportOutputPlanInput extends StaticExportOutputArtifacts {
  outDir: string | URL;
}

export function staticExportOutputPlan(
  result: StaticExportOutputArtifacts,
  options: StaticExportOutputPlanOptions,
): StaticExportOutputPlanItem[] {
  // SPEC §9.5: dry-run export task wiring must inspect the same target files
  // that a write export would publish, without reimplementing path planning.
  return createStaticExportOutputPlan({
    artifacts: result.artifacts,
    assets: result.assets,
    clientModules: result.clientModules,
    outDir: options.outDir,
  }).writes.map((write) => ({
    kind: write.itemKind,
    path: write.diagnosticPath,
    targetPath: write.targetPath,
  }));
}

export function createStaticExportOutputPlan(
  plan: StaticExportOutputPlanInput,
): StaticExportOutputPlan {
  const root = path.resolve(plan.outDir instanceof URL ? fileURLToPath(plan.outDir) : plan.outDir);
  const writes = staticExportPlannedWrites(plan, root);

  return { ...plan, root, writes };
}

export async function writeStaticExportOutput(plan: StaticExportOutputPlan): Promise<void> {
  for (const artifact of plan.assets) {
    await assertReadableStaticExportAssetSource(artifact);
  }

  await assertWritableStaticExportTargets(plan);
  if (plan.writes.length === 0) return;

  const stagingRoot = await createStaticExportStagingRoot(plan.root);
  try {
    await Promise.all(
      plan.writes.map((write) =>
        write.write(staticExportStagedTargetPath(plan.root, stagingRoot, write.targetPath)),
      ),
    );
    await commitStaticExportStagedOutput(plan, stagingRoot);
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}

export function staticExportAssetArtifacts(
  assets: readonly StaticExportAssetInput[],
): StaticExportAssetArtifact[] {
  return assets.map((asset) => ({
    headers: sortedHeaders(staticExportAssetHeaders(asset)),
    path: asset.path,
    source: staticExportSourcePath(asset.source),
    status: 200,
  }));
}

function staticExportPlannedWrites(
  plan: StaticExportOutputArtifacts,
  root: string,
): StaticExportPlannedWrite[] {
  return staticExportOutputTargets(plan, root).map((target) =>
    staticExportPlannedWrite(plan, target),
  );
}

function staticExportPlannedWrite(
  plan: StaticExportOutputArtifacts,
  target: StaticExportOutputTarget,
): StaticExportPlannedWrite {
  if (target.itemKind === 'route-document') {
    const artifact = plan.artifacts[target.itemIndex]!;
    return {
      ...target,
      write: async (writePath) => writeTextStaticExportFile(artifact.body, writePath),
    };
  }

  if (target.itemKind === 'client-module') {
    const artifact = plan.clientModules[target.itemIndex]!;
    return {
      ...target,
      write: async (writePath) => writeTextStaticExportFile(artifact.body, writePath),
    };
  }

  const artifact = plan.assets[target.itemIndex]!;
  return {
    ...target,
    write: async (writePath) => copyStaticExportAsset(artifact.source, writePath),
  };
}

async function assertReadableStaticExportAssetSource(
  artifact: StaticExportAssetArtifact,
): Promise<void> {
  let sourceStat: Awaited<ReturnType<typeof stat>>;
  try {
    sourceStat = await stat(artifact.source);
  } catch {
    throw new StaticExportError([
      staticExportDiagnostic(
        artifact.path,
        `FW229 static export cannot copy static asset '${artifact.path}' because source '${artifact.source}' is not a readable file.`,
      ),
    ]);
  }

  if (!sourceStat.isFile()) {
    throw new StaticExportError([
      staticExportDiagnostic(
        artifact.path,
        `FW229 static export cannot copy static asset '${artifact.path}' because source '${artifact.source}' is not a file.`,
      ),
    ]);
  }

  try {
    await access(artifact.source, fsConstants.R_OK);
  } catch {
    throw new StaticExportError([
      staticExportDiagnostic(
        artifact.path,
        `FW229 static export cannot copy static asset '${artifact.path}' because source '${artifact.source}' is not a readable file.`,
      ),
    ]);
  }
}

async function writeTextStaticExportFile(body: string, targetPath: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, body, 'utf8');
}

async function copyStaticExportAsset(source: string, targetPath: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(source, targetPath);
}

interface StaticExportPlannedWrite extends StaticExportOutputTarget {
  diagnosticPath: string;
  itemKind: StaticExportOutputPlanItemKind;
  kind: string;
  targetPath: string;
  write(writePath: string): Promise<void>;
}

async function assertWritableStaticExportTargets(plan: StaticExportOutputPlan): Promise<void> {
  for (const write of plan.writes) {
    await assertStaticExportTargetParentDirectories(plan.root, write);
    await assertStaticExportTargetIsNotDirectory(write);
  }
}

async function assertStaticExportTargetParentDirectories(
  root: string,
  write: StaticExportPlannedWrite,
): Promise<void> {
  const relativeDirectory = path.relative(root, path.dirname(write.targetPath));
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
      throw new StaticExportError([
        staticExportDiagnostic(
          write.diagnosticPath,
          `FW229 static export cannot write ${write.kind} '${write.diagnosticPath}' because output parent '${current}' is not a directory.`,
        ),
      ]);
    }
  }
}

async function assertStaticExportTargetIsNotDirectory(
  write: StaticExportPlannedWrite,
): Promise<void> {
  let targetStat: Awaited<ReturnType<typeof lstat>>;
  try {
    targetStat = await lstat(write.targetPath);
  } catch {
    return;
  }

  if (!targetStat.isDirectory()) return;

  throw new StaticExportError([
    staticExportDiagnostic(
      write.diagnosticPath,
      `FW229 static export cannot write ${write.kind} '${write.diagnosticPath}' because target '${write.targetPath}' is a directory.`,
    ),
  ]);
}

async function createStaticExportStagingRoot(root: string): Promise<string> {
  await mkdir(path.dirname(root), { recursive: true });
  return await mkdtemp(path.join(path.dirname(root), '.jiso-static-export-'));
}

function staticExportStagedTargetPath(
  root: string,
  stagingRoot: string,
  targetPath: string,
): string {
  return path.join(stagingRoot, path.relative(root, targetPath));
}

async function commitStaticExportStagedOutput(
  plan: StaticExportOutputPlan,
  stagingRoot: string,
): Promise<void> {
  for (const write of plan.writes) {
    const stagedPath = staticExportStagedTargetPath(plan.root, stagingRoot, write.targetPath);
    await mkdir(path.dirname(write.targetPath), { recursive: true });
    await rename(stagedPath, write.targetPath);
  }
}

function staticExportAssetHeaders(asset: StaticExportAssetInput): Headers {
  const headers = new Headers(asset.headers);
  if (asset.contentType !== undefined) headers.set('content-type', asset.contentType);
  return headers;
}

function staticExportSourcePath(source: string | URL): string {
  return source instanceof URL ? fileURLToPath(source) : source;
}
