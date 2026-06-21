import { constants as fsConstants, type Dirent } from 'node:fs';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
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
import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
import { sortedHeaders } from './static-export-headers.js';
import {
  type StaticExportArtifact,
  type StaticExportAssetArtifact,
  type StaticExportAssetInput,
  type StaticExportClientModuleArtifact,
} from './static-export-types.js';

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Synthetic root used
 * when export callers need a dry-run plan but no filesystem write.
 */
export const STATIC_EXPORT_DRY_RUN_ROOT = '/__kovo_static_export_plan__';

export type { StaticExportOutputPlanItem, StaticExportOutputPlanItemKind };

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Filesystem root
 * options for dry-run and write-output planning.
 */
export interface StaticExportOutputPlanOptions {
  outDir: string | URL;
}

interface StaticExportOutputArtifacts {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
}

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Complete resolved
 * write plan consumed by the atomic output writer.
 */
export interface StaticExportOutputPlan extends StaticExportOutputArtifacts {
  outDir: string | URL;
  root: string;
  writes: readonly StaticExportPlannedWrite[];
}

interface StaticExportOutputPlanInput extends StaticExportOutputArtifacts {
  outDir: string | URL;
}

/**
 * @internal Dry-run export task wiring must inspect the same target files that a
 * write export would publish, without reimplementing path planning (SPEC.md §9.5).
 */
export function staticExportOutputPlan(
  result: StaticExportOutputArtifacts,
  options: StaticExportOutputPlanOptions,
): StaticExportOutputPlanItem[] {
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

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Creates the exact
 * target list used by static export dry-run and write modes.
 */
export function createStaticExportOutputPlan(
  plan: StaticExportOutputPlanInput,
): StaticExportOutputPlan {
  const root = staticExportOutputRoot(plan.outDir);
  const writes = staticExportPlannedWrites(plan, root);

  return { ...plan, root, writes };
}

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Resolves and validates
 * the filesystem root for a static export write.
 */
export function staticExportOutputRoot(outDir: string | URL): string {
  if (outDir instanceof URL) {
    if (outDir.protocol === 'file:') return path.resolve(fileURLToPath(outDir));

    throw new StaticExportError([
      staticExportDiagnostic(
        'outDir',
        `KV229 static export cannot write to '${outDir.href}'. SPEC §9.5 static export output directories must be filesystem paths or file: URLs.`,
      ),
    ]);
  }

  return path.resolve(outDir);
}

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Atomically writes a
 * resolved static export output plan.
 */
export async function writeStaticExportOutput(plan: StaticExportOutputPlan): Promise<void> {
  for (const artifact of plan.assets) {
    await assertReadableStaticExportAssetSource(artifact);
  }

  await assertWritableStaticExportTargets(plan);
  if (plan.writes.length === 0) {
    // C2/SPEC §9.5: even when this export emits nothing, prior route documents must be reconciled so
    // a fully-removed route stops serving stale 200 HTML across rebuilds.
    await pruneStaleStaticExportRouteDocuments(plan);
    return;
  }

  const stagingRoot = await createStaticExportStagingRoot(plan.root);
  try {
    await Promise.all(
      plan.writes.map((write) =>
        write.write(staticExportStagedTargetPath(plan.root, stagingRoot, write.targetPath)),
      ),
    );
    await commitStaticExportStagedOutput(plan, stagingRoot);
    // C2/SPEC §9.5: reconcile relative to the rename commit — remove prior route-document artifacts
    // (mutable `index.html`) the current plan no longer owns. A removed route must not keep serving
    // stale 200 HTML (stale-page disclosure). Immutable versioned `/c/__v/` modules are RETAINED per
    // SPEC §14 prior-version retention and never pruned here.
    await pruneStaleStaticExportRouteDocuments(plan);
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}

/**
 * @internal C2/SPEC §9.5 + §14. After the atomic rename commit, remove prior mutable
 * route-document `index.html` artifacts under the output root that the current plan no longer owns,
 * so a removed/unpublished route stops serving stale 200 HTML across rebuilds. Immutable versioned
 * client modules under `/c/__v/` are preserved for the SPEC §14 deploy-skew retention window and are
 * never enumerated for pruning.
 */
async function pruneStaleStaticExportRouteDocuments(plan: StaticExportOutputPlan): Promise<void> {
  const ownedRouteDocuments = new Set(
    plan.writes
      .filter((write) => write.itemKind === 'route-document')
      .map((write) => write.targetPath),
  );

  const clientModuleRoot = path.join(plan.root, 'c');
  for await (const indexHtmlPath of enumerateStaticExportRouteDocuments(
    plan.root,
    clientModuleRoot,
  )) {
    if (!ownedRouteDocuments.has(indexHtmlPath)) {
      // Remove only the stale directory-index document; leave any sibling files (assets the export
      // does not own a manifest for, user-managed files) untouched.
      await rm(indexHtmlPath, { force: true });
    }
  }
}

/**
 * @internal Enumerate existing static-export route-document `index.html` files under `root`,
 * skipping the entire `/c/` client-module subtree so immutable versioned modules (SPEC §14) are
 * never considered for pruning.
 */
async function* enumerateStaticExportRouteDocuments(
  root: string,
  clientModuleRoot: string,
): AsyncGenerator<string> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      // `/c/` holds immutable versioned client modules — never descend (SPEC §14 retention).
      if (entryPath === clientModuleRoot) continue;
      yield* enumerateStaticExportRouteDocuments(entryPath, clientModuleRoot);
      continue;
    }

    if (entry.isFile() && entry.name === 'index.html') {
      yield entryPath;
    }
  }
}

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Converts user-declared
 * static assets into replay artifacts before target planning.
 */
export function staticExportAssetArtifacts(
  assets: readonly StaticExportAssetInput[],
): StaticExportAssetArtifact[] {
  return assets.map((asset) => ({
    headers: sortedHeaders(staticExportAssetHeaders(asset)),
    path: asset.path,
    source: staticExportSourcePath(asset),
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
        `KV229 static export cannot copy static asset '${artifact.path}' because source '${artifact.source}' is not a readable file.`,
      ),
    ]);
  }

  if (!sourceStat.isFile()) {
    throw new StaticExportError([
      staticExportDiagnostic(
        artifact.path,
        `KV229 static export cannot copy static asset '${artifact.path}' because source '${artifact.source}' is not a file.`,
      ),
    ]);
  }

  try {
    await access(artifact.source, fsConstants.R_OK);
  } catch {
    throw new StaticExportError([
      staticExportDiagnostic(
        artifact.path,
        `KV229 static export cannot copy static asset '${artifact.path}' because source '${artifact.source}' is not a readable file.`,
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
          `KV229 static export cannot write ${write.kind} '${write.diagnosticPath}' because output parent '${current}' is not a directory.`,
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
      `KV229 static export cannot write ${write.kind} '${write.diagnosticPath}' because target '${write.targetPath}' is a directory.`,
    ),
  ]);
}

async function createStaticExportStagingRoot(root: string): Promise<string> {
  await mkdir(path.dirname(root), { recursive: true });
  return await mkdtemp(path.join(path.dirname(root), '.kovo-static-export-'));
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

function staticExportSourcePath(asset: StaticExportAssetInput): string {
  if (asset.source instanceof URL) {
    if (asset.source.protocol === 'file:') return fileURLToPath(asset.source);

    throw new StaticExportError([
      staticExportDiagnostic(
        asset.path,
        `KV229 static export cannot copy static asset '${asset.path}' from '${asset.source.href}'. Static asset sources must be filesystem paths or file: URLs.`,
      ),
    ]);
  }

  return asset.source;
}
