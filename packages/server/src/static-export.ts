import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequestHandler, type JisoApp, type RequestHandler } from './app.js';
import { normalizePathname } from './match.js';

export interface StaticExportArtifact {
  body: string;
  headers: Record<string, string>;
  path: string;
  status: number;
}

export interface StaticExportClientModuleArtifact {
  body: string;
  headers: Record<string, string>;
  href: string;
  path: string;
  status: number;
}

export interface StaticExportAssetInput {
  contentType?: string;
  headers?: HeadersInit;
  path: string;
  source: string | URL;
}

export interface StaticExportAssetArtifact {
  headers: Record<string, string>;
  path: string;
  source: string;
  status: number;
}

export interface StaticExportDiagnostic {
  code: 'FW229';
  message: string;
  routePath: string;
}

export interface StaticExportOptions {
  assets?: readonly StaticExportAssetInput[];
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

export class StaticExportError extends Error {
  readonly code = 'FW229';
  readonly diagnostics: readonly StaticExportDiagnostic[];

  constructor(diagnostics: readonly StaticExportDiagnostic[]) {
    super(
      diagnostics.length === 1
        ? diagnostics[0]?.message
        : `FW229 static export found ${diagnostics.length} non-exportable routes.`,
    );
    this.name = 'StaticExportError';
    this.diagnostics = diagnostics;
  }
}

export async function exportStaticApp(
  app: JisoApp,
  options: StaticExportOptions = {},
): Promise<StaticExportResult> {
  const diagnostics = nonExportableRouteDiagnostics(app);
  if (diagnostics.length > 0 && options.onNonExportable !== 'skip') {
    throw new StaticExportError(diagnostics);
  }

  const handler = createRequestHandler(app);
  const origin = options.origin ?? 'https://jiso.local';
  const artifacts: StaticExportArtifact[] = [];

  for (const route of app.routes) {
    if (diagnostics.some((diagnostic) => diagnostic.routePath === route.path)) continue;

    artifacts.push(await exportRouteArtifact(handler, route.path, origin));
  }

  const clientModules =
    options.outDir === undefined
      ? []
      : await exportClientModuleArtifacts(handler, artifacts, origin);
  const assets =
    options.outDir === undefined ? [] : staticExportAssetArtifacts(options.assets ?? []);

  if (options.outDir !== undefined) {
    await writeStaticExportOutput({ artifacts, assets, clientModules, outDir: options.outDir });
  }

  return { artifacts, assets, clientModules, diagnostics };
}

interface StaticExportOutputPlan {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
  outDir: string | URL;
}

async function writeStaticExportOutput(plan: StaticExportOutputPlan): Promise<void> {
  const root = path.resolve(plan.outDir instanceof URL ? fileURLToPath(plan.outDir) : plan.outDir);
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

  await Promise.all(writes.map((write) => write.write()));
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

async function exportRouteArtifact(
  handler: RequestHandler,
  routePath: string,
  origin: string,
): Promise<StaticExportArtifact> {
  const pathname = normalizePathname(routePath).pathname;
  const response = await handler(new Request(new URL(pathname, origin), { method: 'GET' }));
  const contentType = response.headers.get('content-type');

  if (response.status !== 200 || !contentType?.toLowerCase().includes('text/html')) {
    throw new StaticExportError([
      staticExportDiagnostic(
        routePath,
        `FW229 static export can only write successful HTML route documents; '${routePath}' returned status ${response.status} with Content-Type '${contentType ?? 'none'}'.`,
      ),
    ]);
  }

  return {
    body: await response.text(),
    headers: sortedHeaders(response.headers),
    path: htmlArtifactPath(pathname),
    status: response.status,
  };
}

async function exportClientModuleArtifacts(
  handler: RequestHandler,
  routeArtifacts: readonly StaticExportArtifact[],
  origin: string,
): Promise<StaticExportClientModuleArtifact[]> {
  const artifacts: StaticExportClientModuleArtifact[] = [];
  const bodyByTargetPath = new Map<string, string>();

  for (const href of collectClientModuleHrefs(routeArtifacts)) {
    const artifact = await exportClientModuleArtifact(handler, href, origin);
    const existingBody = bodyByTargetPath.get(artifact.path);
    if (existingBody !== undefined && existingBody !== artifact.body) {
      throw new StaticExportError([
        staticExportDiagnostic(
          artifact.path,
          `FW229 static export found multiple client module versions for '${artifact.path}' with different bytes. Static hosts serve query-string variants from the same file path, so export documents must reference one immutable version per /c/ path.`,
        ),
      ]);
    }

    if (existingBody === undefined) {
      artifacts.push(artifact);
      bodyByTargetPath.set(artifact.path, artifact.body);
    }
  }

  return artifacts;
}

async function exportClientModuleArtifact(
  handler: RequestHandler,
  href: string,
  origin: string,
): Promise<StaticExportClientModuleArtifact> {
  const url = new URL(href, origin);
  const response = await handler(new Request(url, { method: 'GET' }));

  if (response.status !== 200) {
    throw new StaticExportError([
      staticExportDiagnostic(
        url.pathname,
        `FW229 static export cannot copy client module '${href}' because the app handler returned status ${response.status}. Ensure exported documents reference production versioned /c/ module URLs.`,
      ),
    ]);
  }

  return {
    body: await response.text(),
    headers: sortedHeaders(response.headers),
    href,
    path: url.pathname,
    status: response.status,
  };
}

function collectClientModuleHrefs(
  routeArtifacts: readonly StaticExportArtifact[],
): readonly string[] {
  const hrefs = new Set<string>();

  for (const artifact of routeArtifacts) {
    collectClientModuleHrefsFromHtmlAttributes(artifact.body, hrefs);
    const linkHeader = artifact.headers.link;
    if (linkHeader) collectClientModuleHrefsFromLinkHeader(linkHeader, hrefs);
  }

  return [...hrefs].sort();
}

function collectClientModuleHrefsFromHtmlAttributes(html: string, hrefs: Set<string>): void {
  const attributePattern = /\s(?:[\w:-]+)=["']([^"']*)["']/g;
  let attributeMatch: RegExpExecArray | null;

  while ((attributeMatch = attributePattern.exec(html)) !== null) {
    const value = attributeMatch[1] === undefined ? '' : decodeHtmlAttributeText(attributeMatch[1]);
    for (const ref of value.split(/\s+/)) {
      if (ref.startsWith('/c/')) hrefs.add(ref);
    }
  }
}

function collectClientModuleHrefsFromLinkHeader(header: string, hrefs: Set<string>): void {
  const linkPattern = /<(?<href>\/c\/[^>\s]+)>/g;
  let linkMatch: RegExpExecArray | null;

  while ((linkMatch = linkPattern.exec(header)) !== null) {
    const href = linkMatch.groups?.href;
    if (href) hrefs.add(href);
  }
}

function decodeHtmlAttributeText(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function nonExportableRouteDiagnostics(app: JisoApp): readonly StaticExportDiagnostic[] {
  const diagnostics: StaticExportDiagnostic[] = [];

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
      diagnostics.push(
        staticExportDiagnostic(
          route.path,
          `FW229 static export cannot enumerate param route '${route.path}' without static-path metadata. Add the planned static-path enumeration once SPEC 9.5 names it, or exclude the route from export.`,
        ),
      );
    }
  }

  return diagnostics;
}

function staticExportDiagnostic(routePath: string, message: string): StaticExportDiagnostic {
  return { code: 'FW229', message, routePath };
}

function routeHasParams(path: string): boolean {
  return normalizePathname(path)
    .pathname.split('/')
    .some((segment) => segment.startsWith(':') && segment.length > 1);
}

function htmlArtifactPath(pathname: string): string {
  return pathname === '/' ? '/index.html' : `${pathname}.html`;
}

function sortedHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    [...headers.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}
