import type { RequestHandler } from './app.js';
import { normalizePathname } from './match.js';
import {
  collectStaticExportClientModuleHrefs,
  collectStaticExportServerEndpointRefs,
} from './static-export-document-refs.js';
import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
import {
  sortedHeaders,
  type StaticExportArtifact,
  type StaticExportClientModuleArtifact,
  type StaticExportHtmlPathStyle,
  type StaticExportResponseSnapshot,
} from './static-export-types.js';

export interface StaticExportRouteDocumentReplayOptions {
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

export async function replayStaticExportRouteDocumentArtifact({
  handler,
  htmlPathStyle,
  origin,
  routePath,
}: StaticExportRouteDocumentReplayOptions): Promise<StaticExportArtifact> {
  const pathname = normalizePathname(routePath).pathname;
  const { response } = await replayStaticExportRequest({ handler, origin, pathname });
  const replayed = await readStaticExportReplayedResponse({
    kind: 'route-document',
    response,
    routePath,
  });
  const { body } = replayed;
  assertStaticExportRouteDocumentL0L1({ body, origin, routePath });

  return {
    ...replayed,
    path: staticExportRouteDocumentArtifactPath(pathname, htmlPathStyle),
  };
}

export function staticExportRouteDocumentArtifactPath(
  pathname: string,
  style: StaticExportHtmlPathStyle,
): string {
  if (pathname === '/') return '/index.html';
  return style === 'directory' ? `${pathname}/index.html` : `${pathname}.html`;
}

export async function replayStaticExportClientModuleArtifacts({
  handler,
  origin,
  routeArtifacts,
}: StaticExportClientModuleReplayOptions): Promise<StaticExportClientModuleArtifact[]> {
  const artifacts: StaticExportClientModuleArtifact[] = [];
  const bodyByTargetPath = new Map<string, string>();

  for (const href of collectStaticExportClientModuleHrefs(routeArtifacts, origin)) {
    const artifact = await replayStaticExportClientModuleArtifact({ handler, href, origin });
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

interface StaticExportClientModuleArtifactReplayOptions {
  handler: RequestHandler;
  href: string;
  origin: string;
}

async function replayStaticExportClientModuleArtifact({
  handler,
  href,
  origin,
}: StaticExportClientModuleArtifactReplayOptions): Promise<StaticExportClientModuleArtifact> {
  const { response, url } = await replayStaticExportRequest({ handler, href, origin });
  const replayed = await readStaticExportReplayedResponse({
    href,
    kind: 'client-module',
    path: url.pathname,
    response,
  });

  return {
    ...replayed,
    href,
    path: url.pathname,
  };
}

interface StaticExportReplayRequestOptions {
  handler: RequestHandler;
  href?: string;
  origin: string;
  pathname?: string;
}

interface StaticExportReplayRequestResult {
  response: Response;
  url: URL;
}

async function replayStaticExportRequest({
  handler,
  href,
  origin,
  pathname,
}: StaticExportReplayRequestOptions): Promise<StaticExportReplayRequestResult> {
  const url = new URL(href ?? pathname ?? '/', origin);
  const request = new Request(url, { method: 'GET' });

  return {
    response: await handler(request),
    url,
  };
}

interface StaticExportRouteDocumentResponseOptions {
  response: Response;
  routePath: string;
}

interface StaticExportClientModuleResponseOptions {
  href: string;
  path: string;
  response: Response;
}

type StaticExportReplayedResponseReadOptions =
  | (StaticExportRouteDocumentResponseOptions & { kind: 'route-document' })
  | (StaticExportClientModuleResponseOptions & { kind: 'client-module' });

async function readStaticExportReplayedResponse(
  options: StaticExportReplayedResponseReadOptions,
): Promise<StaticExportResponseSnapshot> {
  const { response } = options;
  const contentType = response.headers.get('content-type');

  if (response.status !== 200 || !isExpectedStaticExportContentType(options, contentType)) {
    throw new StaticExportError([staticExportReplayResponseDiagnostic(options, contentType)]);
  }

  return {
    body: await response.text(),
    headers: sortedHeaders(response.headers),
    status: response.status,
  };
}

function staticExportReplayResponseDiagnostic(
  options: StaticExportReplayedResponseReadOptions,
  contentType: string | null,
) {
  if (options.kind === 'route-document') {
    return staticExportDiagnostic(
      options.routePath,
      `FW229 static export can only write successful HTML route documents; '${options.routePath}' returned status ${options.response.status} with Content-Type '${contentType ?? 'none'}'.`,
    );
  }

  return staticExportDiagnostic(
    options.path,
    `FW229 static export cannot copy client module '${options.href}' because the app handler returned status ${options.response.status} with Content-Type '${contentType ?? 'none'}'. Ensure exported documents reference production versioned /c/ module URLs.`,
  );
}

function isExpectedStaticExportContentType(
  options: StaticExportReplayedResponseReadOptions,
  contentType: string | null,
): boolean {
  return options.kind === 'route-document'
    ? isHtmlDocumentContentType(contentType)
    : isJavaScriptClientModuleContentType(contentType);
}

function isHtmlDocumentContentType(contentType: string | null): boolean {
  return contentType?.toLowerCase().includes('text/html') ?? false;
}

function isJavaScriptClientModuleContentType(contentType: string | null): boolean {
  if (contentType === null) return false;
  const mime = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return mime === 'text/javascript' || mime === 'application/javascript';
}

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
