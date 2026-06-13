import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { diagnosticDefinitions } from '@jiso/core';

import { createRequestHandler, type JisoApp } from './app.js';
import { replayStaticExportClientModuleArtifacts } from './static-export-client-modules.js';
import { replayStaticExportRouteArtifact } from './static-replay.js';
import { staticExportRoutePlan } from './static-export-route-plan.js';
import {
  StaticExportError,
  staticExportDiagnostic,
  sortedHeaders,
  type StaticExportArtifact,
  type StaticExportAssetArtifact,
  type StaticExportAssetInput,
  type StaticExportClientModuleArtifact,
  type StaticExportCompileDiagnostic,
  type StaticExportDiagnostic,
  type StaticExportHtmlPathStyle,
} from './static-export-types.js';

export {
  StaticExportError,
  formatStaticExportDiagnostic,
  formatStaticExportDiagnostics,
  isStaticExportDiagnostic,
  isStaticExportDiagnosticError,
  staticExportInventory,
  staticExportManifest,
  type StaticExportArtifact,
  type StaticExportAssetArtifact,
  type StaticExportAssetInput,
  type StaticExportClientModuleArtifact,
  type StaticExportCompileDiagnostic,
  type StaticExportDiagnostic,
  type StaticExportDiagnosticSeverity,
  type StaticExportHtmlPathStyle,
  type StaticExportInventoryItem,
  type StaticExportManifest,
  type StaticExportManifestAsset,
  type StaticExportManifestClientModule,
  type StaticExportManifestRouteDocument,
} from './static-export-types.js';

export interface StaticExportOptions {
  assets?: readonly StaticExportAssetInput[];
  diagnostics?: readonly StaticExportCompileDiagnostic[];
  htmlPathStyle?: StaticExportHtmlPathStyle;
  onNonExportable?: 'error' | 'skip';
  origin?: string;
  outDir?: string | URL;
}

export interface StaticExportResult {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
  diagnostics: readonly StaticExportDiagnostic[];
}

export type StaticExportOutputPlanItemKind = 'client-module' | 'route-document' | 'static-asset';

export interface StaticExportOutputPlanItem {
  kind: StaticExportOutputPlanItemKind;
  path: string;
  targetPath: string;
}

export interface StaticExportOutputPlanOptions {
  outDir: string | URL;
}

export async function exportStaticApp(
  app: JisoApp,
  options: StaticExportOptions = {},
): Promise<StaticExportResult> {
  const blockingDiagnostics = blockingStaticExportDiagnostics(options.diagnostics ?? []);
  if (blockingDiagnostics.length > 0) {
    throw new StaticExportError(blockingDiagnostics);
  }

  const routePlan = staticExportRoutePlan(app);
  const diagnostics = [...routePlan.diagnostics];
  if (diagnostics.length > 0 && options.onNonExportable !== 'skip') {
    throw new StaticExportError(diagnostics);
  }

  const handler = createRequestHandler(app);
  const origin = options.origin ?? 'https://jiso.local';
  const htmlPathStyle = staticExportHtmlPathStyle(options.htmlPathStyle);
  const artifacts: StaticExportArtifact[] = [];

  for (const routeTarget of routePlan.targets) {
    if (diagnostics.some((diagnostic) => diagnostic.routePath === routeTarget.routePath)) continue;

    try {
      artifacts.push(
        await replayStaticExportRouteArtifact({
          handler,
          htmlPathStyle,
          origin,
          routePath: routeTarget.path,
        }),
      );
    } catch (error) {
      if (!(error instanceof StaticExportError) || options.onNonExportable !== 'skip') {
        throw error;
      }

      diagnostics.push(...error.diagnostics);
    }
  }

  const clientModules = await replayStaticExportClientModuleArtifacts({
    handler,
    origin,
    routeArtifacts: artifacts,
  });
  const assets = staticExportAssetArtifacts(options.assets ?? []);
  const outputPlan = createStaticExportOutputPlan({
    artifacts,
    assets,
    clientModules,
    outDir: options.outDir ?? STATIC_EXPORT_DRY_RUN_ROOT,
  });

  if (options.outDir !== undefined) {
    await writeStaticExportOutput(outputPlan);
  }

  return { artifacts, assets, clientModules, diagnostics };
}

const STATIC_EXPORT_DRY_RUN_ROOT = '/__jiso_static_export_plan__';

interface StaticExportOutputArtifacts {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
}

interface StaticExportOutputPlan extends StaticExportOutputArtifacts {
  outDir: string | URL;
  root: string;
  writes: readonly StaticExportPlannedWrite[];
}

export function staticExportOutputPlan(
  result: Pick<StaticExportResult, 'artifacts' | 'assets' | 'clientModules'>,
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

function createStaticExportOutputPlan(
  plan: StaticExportOutputArtifacts & Pick<StaticExportOutputPlan, 'outDir'>,
): StaticExportOutputPlan {
  const root = path.resolve(plan.outDir instanceof URL ? fileURLToPath(plan.outDir) : plan.outDir);
  const writes = staticExportPlannedWrites(plan, root);

  return { ...plan, root, writes };
}

async function writeStaticExportOutput(plan: StaticExportOutputPlan): Promise<void> {
  for (const artifact of plan.assets) {
    await assertReadableStaticExportAssetSource(artifact);
  }

  await Promise.all(plan.writes.map((write) => write.write()));
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

function staticExportAssetArtifacts(
  assets: readonly StaticExportAssetInput[],
): StaticExportAssetArtifact[] {
  return assets.map((asset) => ({
    headers: sortedHeaders(staticExportAssetHeaders(asset)),
    path: asset.path,
    source: staticExportSourcePath(asset.source),
    status: 200,
  }));
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

function staticExportHtmlPathStyle(
  style: StaticExportHtmlPathStyle | undefined,
): StaticExportHtmlPathStyle {
  if (style === undefined) return 'directory';
  if (style === 'flat' || style === 'directory') return style;

  throw new StaticExportError([
    staticExportDiagnostic(
      'htmlPathStyle',
      `FW229 static export refused htmlPathStyle '${String(
        style,
      )}'. Expected 'flat' or 'directory'.`,
    ),
  ]);
}

function blockingStaticExportDiagnostics(
  diagnostics: readonly StaticExportCompileDiagnostic[],
): StaticExportDiagnostic[] {
  return diagnostics
    .filter((diagnostic) => diagnosticDefinitions[diagnostic.code].severity === 'error')
    .map((diagnostic) => ({
      code: diagnostic.code,
      message: staticExportCompileDiagnosticMessage(diagnostic),
      routePath: diagnostic.fileName,
    }));
}

function staticExportCompileDiagnosticMessage(diagnostic: StaticExportCompileDiagnostic): string {
  const site = diagnostic.start
    ? `${diagnostic.fileName}:${diagnostic.start.line}:${diagnostic.start.column}`
    : diagnostic.fileName;
  const help = diagnostic.help?.trim();
  const message = `Static export refused error diagnostic ${diagnostic.code} at ${site}. ${diagnostic.message}`;

  return help ? `${message}\n${help}` : message;
}
