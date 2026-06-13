import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export type StaticExportOutputPlanItemKind = 'client-module' | 'route-document' | 'static-asset';

export interface StaticExportOutputPlanItem {
  kind: StaticExportOutputPlanItemKind;
  path: string;
  targetPath: string;
}

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

  await Promise.all(plan.writes.map((write) => write.write()));
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
  const writes: StaticExportPlannedWrite[] = [];

  for (const artifact of plan.artifacts) {
    const targetPath = staticExportArtifactTargetPath(root, artifact.path);
    writes.push({
      diagnosticPath: artifact.path,
      itemKind: 'route-document',
      kind: 'route document',
      targetPath,
      write: async () => writeTextStaticExportFile(artifact.body, targetPath),
    });
  }

  for (const artifact of plan.clientModules) {
    const targetPath = staticExportClientModuleTargetPath(root, artifact.path);
    writes.push({
      diagnosticPath: artifact.path,
      itemKind: 'client-module',
      kind: 'client module',
      targetPath,
      write: async () => writeTextStaticExportFile(artifact.body, targetPath),
    });
  }

  for (const artifact of plan.assets) {
    const targetPath = staticExportAssetTargetPath(root, artifact.path);
    writes.push({
      diagnosticPath: artifact.path,
      itemKind: 'static-asset',
      kind: 'static asset',
      targetPath,
      write: async () => copyStaticExportAsset(artifact.source, targetPath),
    });
  }

  assertNoStaticExportOutputConflicts(writes);
  return writes;
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

interface StaticExportPlannedWrite {
  diagnosticPath: string;
  itemKind: StaticExportOutputPlanItemKind;
  kind: string;
  targetPath: string;
  write(): Promise<void>;
}

function assertNoStaticExportOutputConflicts(writes: readonly StaticExportPlannedWrite[]): void {
  const seen = new Map<string, StaticExportPlannedWrite>();

  for (const write of writes) {
    const existing = seen.get(write.targetPath);
    if (existing) {
      throw new StaticExportError([
        staticExportDiagnostic(
          write.diagnosticPath,
          `FW229 static export cannot write ${write.kind} '${write.diagnosticPath}' because it conflicts with ${existing.kind} '${existing.diagnosticPath}'.`,
        ),
      ]);
    }

    seen.set(write.targetPath, write);
  }
}

function staticExportArtifactTargetPath(root: string, artifactPath: string): string {
  const targetPath = path.resolve(root, artifactPath.replace(/^\/+/, ''));
  if (targetPath === root || targetPath.startsWith(`${root}${path.sep}`)) return targetPath;

  throw new StaticExportError([
    staticExportDiagnostic(
      artifactPath,
      `FW229 static export refused to write '${artifactPath}' outside the configured output directory.`,
    ),
  ]);
}

function staticExportClientModuleTargetPath(root: string, modulePath: string): string {
  const segments = modulePath.split('/').filter(Boolean).map(decodeClientModulePathSegment);
  const targetPath = path.resolve(root, ...segments);
  if (targetPath === root || targetPath.startsWith(`${root}${path.sep}`)) return targetPath;

  throw new StaticExportError([
    staticExportDiagnostic(
      modulePath,
      `FW229 static export refused to write client module '${modulePath}' outside the configured output directory.`,
    ),
  ]);
}

function decodeClientModulePathSegment(segment: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new StaticExportError([
      staticExportDiagnostic(
        `/c/${segment}`,
        `FW229 static export cannot write client module path segment '${segment}' because it is not valid URL encoding.`,
      ),
    ]);
  }

  if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
    throw new StaticExportError([
      staticExportDiagnostic(
        `/c/${segment}`,
        `FW229 static export refused unsafe client module path segment '${segment}'.`,
      ),
    ]);
  }

  return decoded;
}

function staticExportAssetHeaders(asset: StaticExportAssetInput): Headers {
  const headers = new Headers(asset.headers);
  if (asset.contentType !== undefined) headers.set('content-type', asset.contentType);
  return headers;
}

function staticExportSourcePath(source: string | URL): string {
  return source instanceof URL ? fileURLToPath(source) : source;
}

function staticExportAssetTargetPath(root: string, assetPath: string): string {
  const segments = assetPath.split('/').filter(Boolean).map(decodeStaticExportAssetPathSegment);
  if (segments.length === 0) {
    throw new StaticExportError([
      staticExportDiagnostic(
        assetPath,
        `FW229 static export refused static asset '${assetPath}' because it does not name an output file.`,
      ),
    ]);
  }

  const targetPath = path.resolve(root, ...segments);
  if (targetPath === root || targetPath.startsWith(`${root}${path.sep}`)) return targetPath;

  throw new StaticExportError([
    staticExportDiagnostic(
      assetPath,
      `FW229 static export refused to write static asset '${assetPath}' outside the configured output directory.`,
    ),
  ]);
}

function decodeStaticExportAssetPathSegment(segment: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new StaticExportError([
      staticExportDiagnostic(
        segment,
        `FW229 static export cannot write static asset path segment '${segment}' because it is not valid URL encoding.`,
      ),
    ]);
  }

  if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
    throw new StaticExportError([
      staticExportDiagnostic(
        segment,
        `FW229 static export refused unsafe static asset path segment '${segment}'.`,
      ),
    ]);
  }

  return decoded;
}
