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

  return {
    body: await response.text(),
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

function htmlArtifactPath(pathname: string, style: StaticExportHtmlPathStyle): string {
  if (pathname === '/') return '/index.html';
  return style === 'directory' ? `${pathname}/index.html` : `${pathname}.html`;
}
