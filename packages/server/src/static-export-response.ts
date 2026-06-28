import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
import { collectStaticExportServerEndpointRefs } from './static-export-document-refs.js';
import { staticExportHeaders } from './static-export-headers.js';
import { type StaticExportResponseSnapshot } from './static-export-types.js';

export interface StaticExportRouteDocumentResponseOptions {
  response: Response;
  routePath: string;
}

export interface StaticExportClientModuleResponseOptions {
  href: string;
  path: string;
  response: Response;
}

export type StaticExportReplayedResponseReadOptions =
  | (StaticExportRouteDocumentResponseOptions & { kind: 'route-document' })
  | (StaticExportClientModuleResponseOptions & { kind: 'client-module' });

export async function readStaticExportReplayedResponse(
  options: StaticExportReplayedResponseReadOptions,
): Promise<StaticExportResponseSnapshot> {
  const { response } = options;
  const contentType = response.headers.get('content-type');
  const body = await response.text();

  if (response.status !== 200 || !isExpectedStaticExportContentType(options, contentType)) {
    throw new StaticExportError(staticExportReplayResponseDiagnostics(options, contentType, body));
  }

  return {
    body,
    headers: staticExportHeaders(response.headers, { path: staticExportResponsePath(options) }),
    status: response.status,
  };
}

function staticExportResponsePath(options: StaticExportReplayedResponseReadOptions): string {
  return options.kind === 'route-document' ? options.routePath : options.path;
}

function staticExportReplayResponseDiagnostics(
  options: StaticExportReplayedResponseReadOptions,
  contentType: string | null,
  body: string,
) {
  if (options.kind === 'route-document') {
    const endpointDiagnostics = routeDocumentEndpointDiagnostics(
      options.routePath,
      contentType,
      body,
    );
    if (endpointDiagnostics.length > 0) return endpointDiagnostics;
    // `routePath` here is the concrete replay target (e.g. `/products/p1`), so stamp it as the
    // concrete-path discriminator: SPEC §9.5 `skip` must suppress only this exact non-exportable
    // target, never its valid param siblings replayed in the same pass.
    return [
      staticExportDiagnostic(
        options.routePath,
        `KV229 static export can only write successful HTML route documents; '${options.routePath}' returned status ${options.response.status} with Content-Type '${contentType ?? 'none'}'.`,
        options.routePath,
      ),
    ];
  }

  return [
    staticExportDiagnostic(
      options.path,
      `KV229 static export cannot copy client module '${options.href}' because the app handler returned status ${options.response.status} with Content-Type '${contentType ?? 'none'}'. Ensure exported documents reference production versioned /c/ module URLs.`,
    ),
  ];
}

function routeDocumentEndpointDiagnostics(
  routePath: string,
  contentType: string | null,
  body: string,
) {
  if (!isHtmlDocumentContentType(contentType)) return [];

  return collectStaticExportServerEndpointRefs(body, 'https://kovo.static-export.local').map(
    (ref) =>
      staticExportDiagnostic(
        routePath,
        `KV229 static export cannot export route '${routePath}' because replayed HTML attribute '${ref.name}' references server ${ref.phase} endpoint '${ref.path}'. Export is L0/L1 only; serve this route dynamically or replace server-only interaction with an exportable client island.`,
        routePath,
      ),
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
