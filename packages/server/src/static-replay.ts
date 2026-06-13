import type { RequestHandler } from './app.js';
import { normalizePathname } from './match.js';
import {
  StaticExportError,
  staticExportDiagnostic,
  sortedHeaders,
  type StaticExportArtifact,
  type StaticExportClientModuleArtifact,
  type StaticExportHtmlPathStyle,
} from './static-export-types.js';

export interface StaticExportRouteReplayOptions {
  handler: RequestHandler;
  htmlPathStyle: StaticExportHtmlPathStyle;
  origin: string;
  routePath: string;
}

export interface StaticExportClientModuleReplayOptions {
  handler: RequestHandler;
  origin: string;
  routeArtifacts: readonly StaticExportArtifact[];
}

export async function replayStaticExportRouteArtifact({
  handler,
  htmlPathStyle,
  origin,
  routePath,
}: StaticExportRouteReplayOptions): Promise<StaticExportArtifact> {
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

  const body = await response.text();
  assertStaticExportRouteDocumentL0L1({ body, origin, routePath });

  return {
    body,
    headers: sortedHeaders(response.headers),
    path: htmlArtifactPath(pathname, htmlPathStyle),
    status: response.status,
  };
}

export async function replayStaticExportClientModuleArtifacts({
  handler,
  origin,
  routeArtifacts,
}: StaticExportClientModuleReplayOptions): Promise<StaticExportClientModuleArtifact[]> {
  const artifacts: StaticExportClientModuleArtifact[] = [];
  const bodyByTargetPath = new Map<string, string>();

  for (const href of collectClientModuleHrefs(routeArtifacts)) {
    const artifact = await replayStaticExportClientModuleArtifact(handler, href, origin);
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

async function replayStaticExportClientModuleArtifact(
  handler: RequestHandler,
  href: string,
  origin: string,
): Promise<StaticExportClientModuleArtifact> {
  const url = new URL(href, origin);
  const response = await handler(new Request(url, { method: 'GET' }));
  const contentType = response.headers.get('content-type');

  if (response.status !== 200 || !isJavaScriptClientModuleContentType(contentType)) {
    throw new StaticExportError([
      staticExportDiagnostic(
        url.pathname,
        `FW229 static export cannot copy client module '${href}' because the app handler returned status ${response.status} with Content-Type '${contentType ?? 'none'}'. Ensure exported documents reference production versioned /c/ module URLs.`,
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

function isJavaScriptClientModuleContentType(contentType: string | null): boolean {
  if (contentType === null) return false;
  const mime = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return mime === 'text/javascript' || mime === 'application/javascript';
}

function collectClientModuleHrefs(
  routeArtifacts: readonly StaticExportArtifact[],
): readonly string[] {
  const hrefs = new Set<string>();

  for (const artifact of routeArtifacts) {
    for (const ref of collectStaticExportHtmlAttributeRefs(artifact.body)) {
      for (const token of ref.value.split(/\s+/)) {
        if (token.startsWith('/c/')) hrefs.add(token);
      }
    }

    const linkHeader = artifact.headers.link;
    if (linkHeader) collectClientModuleHrefsFromLinkHeader(linkHeader, hrefs);
  }

  return [...hrefs].sort();
}

interface StaticExportHtmlAttributeRef {
  name: string;
  value: string;
}

function collectStaticExportHtmlAttributeRefs(html: string): StaticExportHtmlAttributeRef[] {
  const refs: StaticExportHtmlAttributeRef[] = [];
  const attributePattern = /\s([\w:-]+)=["']([^"']*)["']/g;
  let attributeMatch: RegExpExecArray | null;

  while ((attributeMatch = attributePattern.exec(html)) !== null) {
    refs.push({
      name: attributeMatch[1]?.toLowerCase() ?? '',
      value: attributeMatch[2] === undefined ? '' : decodeHtmlAttributeText(attributeMatch[2]),
    });
  }

  return refs;
}

const STATIC_EXPORT_SERVER_ENDPOINT_ATTRIBUTES = new Set(['action', 'formaction', 'href', 'src']);

interface StaticExportRouteDocumentL0L1Options {
  body: string;
  origin: string;
  routePath: string;
}

function assertStaticExportRouteDocumentL0L1({
  body,
  origin,
  routePath,
}: StaticExportRouteDocumentL0L1Options): void {
  const diagnostics = collectStaticExportServerEndpointRefs(body, origin).map((ref) =>
    staticExportDiagnostic(
      routePath,
      `FW229 static export cannot export route '${routePath}' because document attribute '${ref.name}' references server ${ref.phase} endpoint '${ref.path}'. Export is L0/L1 only; serve this route dynamically or replace server-only interaction with an exportable client island.`,
    ),
  );

  if (diagnostics.length > 0) throw new StaticExportError(diagnostics);
}

interface StaticExportServerEndpointRef extends StaticExportHtmlAttributeRef {
  path: string;
  phase: 'mutation' | 'query';
}

// SPEC §9.5: exported documents are no-JS artifacts and cannot rely on server
// mutation/query endpoints that disappear on a static host.
function collectStaticExportServerEndpointRefs(
  html: string,
  origin: string,
): StaticExportServerEndpointRef[] {
  const refs: StaticExportServerEndpointRef[] = [];
  const exportOrigin = new URL(origin).origin;

  for (const ref of collectStaticExportHtmlAttributeRefs(html)) {
    if (!STATIC_EXPORT_SERVER_ENDPOINT_ATTRIBUTES.has(ref.name)) continue;

    const url = staticExportUrlFromAttributeValue(ref.value, origin);
    if (url === undefined || url.origin !== exportOrigin) continue;

    const phase = staticExportServerEndpointPhase(url.pathname);
    if (phase === undefined) continue;

    refs.push({ ...ref, path: url.pathname, phase });
  }

  return refs;
}

function staticExportUrlFromAttributeValue(value: string, origin: string): URL | undefined {
  if (value.trim() === '') return undefined;

  try {
    return new URL(value, origin);
  } catch {
    return undefined;
  }
}

function staticExportServerEndpointPhase(pathname: string): 'mutation' | 'query' | undefined {
  if (pathname.startsWith('/_m/')) return 'mutation';
  if (pathname.startsWith('/_q/')) return 'query';
  return undefined;
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

function htmlArtifactPath(pathname: string, style: StaticExportHtmlPathStyle): string {
  if (pathname === '/') return '/index.html';
  return style === 'directory' ? `${pathname}/index.html` : `${pathname}.html`;
}
