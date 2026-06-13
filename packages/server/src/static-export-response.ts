import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
import { sortedHeaders, type StaticExportResponseSnapshot } from './static-export-types.js';

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
