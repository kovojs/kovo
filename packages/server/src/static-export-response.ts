import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
import {
  buildSecurityResponseHeaders,
  buildSecurityResponseStatus,
  buildSecurityResponseText,
} from './build-security-intrinsics.js';
import {
  securityStringIncludes,
  securityStringSplit,
  securityStringToLowerCase,
  securityStringTrim,
} from './response-security-intrinsics.js';
import {
  staticExportFrameworkDocumentHeaders,
  staticExportHeaders,
} from './static-export-headers.js';
import { frameworkDocumentResponseBuildToken } from './response.js';
import {
  scanStaticExportDocumentProtocol,
  type StaticExportDocumentProtocol,
} from './static-export-protocol.js';
import { type StaticExportResponseSnapshot } from './static-export-types.js';
import { witnessArrayAppend } from './security-witness-intrinsics.js';

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
  // SPEC §6.6: classification and body capture use boot-pinned web controls. A route cannot hide
  // Content-Disposition or alter status/content type by replacing Headers/Response prototypes.
  const status = buildSecurityResponseStatus(response);
  const responseHeaders = buildSecurityResponseHeaders(response);
  const path = staticExportResponsePath(options);
  const frameworkBuildToken =
    options.kind === 'route-document' ? frameworkDocumentResponseBuildToken(response) : undefined;
  const headers =
    frameworkBuildToken === undefined
      ? staticExportHeaders(responseHeaders, { path })
      : staticExportFrameworkDocumentHeaders(responseHeaders, {
          buildToken: frameworkBuildToken,
          path,
        });
  const contentType = headers['content-type'] ?? null;
  const body = await buildSecurityResponseText(response);
  const routeDocumentProtocol =
    options.kind === 'route-document'
      ? scanStaticExportDocumentProtocol(body, 'https://kovo.static-export.local')
      : undefined;

  if (options.kind === 'route-document') {
    const routeOutcomeDiagnostics = routeDocumentNonExportableOutcomeDiagnostics(
      options,
      status,
      headers,
      contentType,
      routeDocumentProtocol,
    );
    if (routeOutcomeDiagnostics.length > 0) throw new StaticExportError(routeOutcomeDiagnostics);
  }

  if (status !== 200 || !isExpectedStaticExportContentType(options, contentType)) {
    throw new StaticExportError(
      staticExportReplayResponseDiagnostics(
        options,
        status,
        headers,
        contentType,
        routeDocumentProtocol,
      ),
    );
  }

  return {
    body,
    headers,
    status,
  };
}

function staticExportResponsePath(options: StaticExportReplayedResponseReadOptions): string {
  return options.kind === 'route-document' ? options.routePath : options.path;
}

function staticExportReplayResponseDiagnostics(
  options: StaticExportReplayedResponseReadOptions,
  status: number,
  headers: Record<string, string>,
  contentType: string | null,
  routeDocumentProtocol: StaticExportDocumentProtocol | undefined,
) {
  if (options.kind === 'route-document') {
    const routeOutcomeDiagnostics = routeDocumentNonExportableOutcomeDiagnostics(
      options,
      status,
      headers,
      contentType,
      routeDocumentProtocol,
    );
    if (routeOutcomeDiagnostics.length > 0) return routeOutcomeDiagnostics;

    const endpointDiagnostics = routeDocumentEndpointDiagnostics(
      options.routePath,
      contentType,
      routeDocumentProtocol,
    );
    if (endpointDiagnostics.length > 0) return endpointDiagnostics;
    // `routePath` here is the concrete replay target (e.g. `/products/p1`), so stamp it as the
    // concrete-path discriminator: SPEC §9.5 `skip` must suppress only this exact non-exportable
    // target, never its valid param siblings replayed in the same pass.
    return [
      staticExportDiagnostic(
        options.routePath,
        `KV229 static export can only write successful HTML route documents; '${options.routePath}' returned status ${status} with Content-Type '${contentType ?? 'none'}'.`,
        options.routePath,
      ),
    ];
  }

  return [
    staticExportDiagnostic(
      options.path,
      `KV229 static export cannot copy client module '${options.href}' because the app handler returned status ${status} with Content-Type '${contentType ?? 'none'}'. Ensure exported documents reference production versioned /c/ module URLs.`,
    ),
  ];
}

function routeDocumentNonExportableOutcomeDiagnostics(
  options: StaticExportRouteDocumentResponseOptions,
  status: number,
  headers: Record<string, string>,
  contentType: string | null,
  routeDocumentProtocol: StaticExportDocumentProtocol | undefined,
) {
  const { routePath } = options;
  if (status >= 300 && status < 400) {
    return [
      staticExportDiagnostic(
        routePath,
        `KV229 static export cannot export route '${routePath}' because replay returned redirect status ${status} with Location '${headers.location ?? 'none'}'. Static export is L0/L1 only; serve this route dynamically or export the redirect target as a route document.`,
        routePath,
      ),
    ];
  }

  const contentDisposition = headers['content-disposition'] ?? null;
  if (contentDisposition !== null) {
    return [
      staticExportDiagnostic(
        routePath,
        `KV229 static export cannot export route '${routePath}' because replay returned a file/stream response with Content-Disposition '${contentDisposition}' and Content-Type '${contentType ?? 'none'}'. Static export can write HTML route documents only; move this download behind a dynamic endpoint or remove it from static export.`,
        routePath,
      ),
    ];
  }

  if ((routeDocumentProtocol?.deferredMarkers.length ?? 0) > 0) {
    return [
      staticExportDiagnostic(
        routePath,
        `KV229 static export cannot export route '${routePath}' because replayed HTML contains deferred, streamed, or fragment route markers. Static export is L0/L1 only and writes complete no-JS documents; render this content eagerly for export or serve the route dynamically.`,
        routePath,
      ),
    ];
  }

  return [];
}

function routeDocumentEndpointDiagnostics(
  routePath: string,
  contentType: string | null,
  routeDocumentProtocol: StaticExportDocumentProtocol | undefined,
) {
  if (!isHtmlDocumentContentType(contentType)) return [];

  const refs = routeDocumentProtocol?.endpointRefs ?? [];
  const diagnostics: ReturnType<typeof staticExportDiagnostic>[] = [];
  for (let index = 0; index < refs.length; index += 1) {
    const ref = refs[index]!;
    witnessArrayAppend(
      diagnostics,
      staticExportDiagnostic(
        routePath,
        `KV229 static export cannot export route '${routePath}' because replayed HTML attribute '${ref.name}' references server ${ref.phase} endpoint '${ref.path}'. Export is L0/L1 only; serve this route dynamically or replace server-only interaction with an exportable client island.`,
        routePath,
      ),
      'Server packages/server/src/static-export-response.ts collection',
    );
  }
  return diagnostics;
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
  return contentType === null
    ? false
    : securityStringIncludes(securityStringToLowerCase(contentType), 'text/html');
}

function isJavaScriptClientModuleContentType(contentType: string | null): boolean {
  if (contentType === null) return false;
  const mime = securityStringToLowerCase(
    securityStringTrim(securityStringSplit(contentType, ';')[0] ?? ''),
  );
  return mime === 'text/javascript' || mime === 'application/javascript';
}
