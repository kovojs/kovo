import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { diagnosticDefinitions } from '@jiso/core';

import { createRequestHandler, type JisoApp } from './app.js';
import { matchRoute, normalizePathname } from './match.js';
import {
  replayStaticExportClientModuleArtifacts,
  replayStaticExportRouteArtifact,
} from './static-replay.js';
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
  assertStaticExportOutputPlan({
    artifacts,
    assets,
    clientModules,
    outDir: options.outDir ?? STATIC_EXPORT_DRY_RUN_ROOT,
  });

  if (options.outDir !== undefined) {
    await writeStaticExportOutput({ artifacts, assets, clientModules, outDir: options.outDir });
  }

  return { artifacts, assets, clientModules, diagnostics };
}

const STATIC_EXPORT_DRY_RUN_ROOT = '/__jiso_static_export_plan__';

interface StaticExportOutputPlan {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
  outDir: string | URL;
}

async function writeStaticExportOutput(plan: StaticExportOutputPlan): Promise<void> {
  const root = path.resolve(plan.outDir instanceof URL ? fileURLToPath(plan.outDir) : plan.outDir);
  const writes = staticExportPlannedWrites(plan, root);

  for (const artifact of plan.assets) {
    await assertReadableStaticExportAssetSource(artifact);
  }

  await Promise.all(writes.map((write) => write.write()));
}

function assertStaticExportOutputPlan(plan: StaticExportOutputPlan): void {
  const root = path.resolve(plan.outDir instanceof URL ? fileURLToPath(plan.outDir) : plan.outDir);
  staticExportPlannedWrites(plan, root);
}

function staticExportPlannedWrites(
  plan: Omit<StaticExportOutputPlan, 'outDir'>,
  root: string,
): StaticExportPlannedWrite[] {
  const writes: StaticExportPlannedWrite[] = [];

  for (const artifact of plan.artifacts) {
    const targetPath = staticExportArtifactTargetPath(root, artifact.path);
    writes.push({
      diagnosticPath: artifact.path,
      kind: 'route document',
      targetPath,
      write: async () => writeTextStaticExportFile(artifact.body, targetPath),
    });
  }

  for (const artifact of plan.clientModules) {
    const targetPath = staticExportClientModuleTargetPath(root, artifact.path);
    writes.push({
      diagnosticPath: artifact.path,
      kind: 'client module',
      targetPath,
      write: async () => writeTextStaticExportFile(artifact.body, targetPath),
    });
  }

  for (const artifact of plan.assets) {
    const targetPath = staticExportAssetTargetPath(root, artifact.path);
    writes.push({
      diagnosticPath: artifact.path,
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

interface StaticExportRouteTarget {
  path: string;
  routePath: string;
}

interface StaticExportRoutePlan {
  diagnostics: readonly StaticExportDiagnostic[];
  targets: readonly StaticExportRouteTarget[];
}

function staticExportRoutePlan(app: JisoApp): StaticExportRoutePlan {
  const diagnostics: StaticExportDiagnostic[] = [];
  const targets: StaticExportRouteTarget[] = [];

  for (const route of app.routes) {
    if (app.sessionProvider) {
      diagnostics.push(
        staticExportDiagnostic(
          route.path,
          `FW229 static export cannot prove '${route.path}' is session-independent while the app has a sessionProvider. Exported sites have no server-side sessions; split this route into an explicitly public app shell or wait for compiler-backed session-dependence metadata.`,
        ),
      );
      continue;
    }

    if (route.guard) {
      diagnostics.push(
        staticExportDiagnostic(
          route.path,
          `FW229 static export cannot export guarded route '${route.path}'. Exported sites have no server-side guard/session pass; serve this route dynamically or remove the guard from the exported surface.`,
        ),
      );
      continue;
    }

    if (routeHasParams(route.path)) {
      const planned = staticExportParamRouteTargets(route);
      diagnostics.push(...planned.diagnostics);
      targets.push(...planned.targets);
      continue;
    }

    targets.push({ path: normalizePathname(route.path).pathname, routePath: route.path });
  }

  return { diagnostics, targets };
}

function staticExportParamRouteTargets(route: JisoApp['routes'][number]): StaticExportRoutePlan {
  const staticPaths = route.staticPaths;
  if (!staticPaths) {
    return {
      diagnostics: [
        staticExportDiagnostic(
          route.path,
          `FW229 static export cannot enumerate param route '${route.path}' without staticPaths metadata. Add explicit staticPaths for every exported concrete URL, or exclude the route from export.`,
        ),
      ],
      targets: [],
    };
  }

  if (staticPaths.length === 0) {
    return {
      diagnostics: [
        staticExportDiagnostic(
          route.path,
          `FW229 static export cannot enumerate param route '${route.path}' because staticPaths is empty. Add at least one concrete exported URL, or exclude the route from export.`,
        ),
      ],
      targets: [],
    };
  }

  const diagnostics: StaticExportDiagnostic[] = [];
  const targets: StaticExportRouteTarget[] = [];

  for (const staticPath of staticPaths) {
    const normalized = normalizePathname(staticPath);
    if (!staticPath.startsWith('/') || staticPath.includes('?') || staticPath.includes('#')) {
      diagnostics.push(
        staticExportDiagnostic(
          route.path,
          `FW229 static export staticPath '${staticPath}' for param route '${route.path}' must be an absolute pathname without search or hash.`,
        ),
      );
      continue;
    }

    if (routeHasParams(normalized.pathname)) {
      diagnostics.push(
        staticExportDiagnostic(
          route.path,
          `FW229 static export staticPath '${staticPath}' for param route '${route.path}' must be a concrete URL, not a route pattern.`,
        ),
      );
      continue;
    }

    if (!matchRoute([route], normalized.pathname)) {
      diagnostics.push(
        staticExportDiagnostic(
          route.path,
          `FW229 static export staticPath '${staticPath}' does not match param route '${route.path}'.`,
        ),
      );
      continue;
    }

    targets.push({ path: normalized.pathname, routePath: route.path });
  }

  return { diagnostics, targets };
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

function routeHasParams(path: string): boolean {
  return normalizePathname(path)
    .pathname.split('/')
    .some((segment) => segment.startsWith(':') && segment.length > 1);
}
