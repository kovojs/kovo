import { StaticExportError, staticExportDiagnostic, sortedHeaders } from './static-export-types.js';

export interface StaticExportReplayedResponseBody {
  body: string;
  headers: Record<string, string>;
  status: number;
}

export interface StaticExportRouteDocumentResponseOptions {
  response: Response;
  routePath: string;
}

export interface StaticExportClientModuleResponseOptions {
  href: string;
  path: string;
  response: Response;
}

export async function readStaticExportRouteDocumentResponse({
  response,
  routePath,
}: StaticExportRouteDocumentResponseOptions): Promise<StaticExportReplayedResponseBody> {
  const contentType = response.headers.get('content-type');

  if (response.status !== 200 || !isHtmlDocumentContentType(contentType)) {
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
    status: response.status,
  };
}

export async function readStaticExportClientModuleResponse({
  href,
  path,
  response,
}: StaticExportClientModuleResponseOptions): Promise<StaticExportReplayedResponseBody> {
  const contentType = response.headers.get('content-type');

  if (response.status !== 200 || !isJavaScriptClientModuleContentType(contentType)) {
    throw new StaticExportError([
      staticExportDiagnostic(
        path,
        `FW229 static export cannot copy client module '${href}' because the app handler returned status ${response.status} with Content-Type '${contentType ?? 'none'}'. Ensure exported documents reference production versioned /c/ module URLs.`,
      ),
    ]);
  }

  return {
    body: await response.text(),
    headers: sortedHeaders(response.headers),
    status: response.status,
  };
}

function isHtmlDocumentContentType(contentType: string | null): boolean {
  return contentType?.toLowerCase().includes('text/html') ?? false;
}

function isJavaScriptClientModuleContentType(contentType: string | null): boolean {
  if (contentType === null) return false;
  const mime = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return mime === 'text/javascript' || mime === 'application/javascript';
}
