import { createRequestHandler, type JisoApp, type RequestHandler } from './app.js';
import { normalizePathname } from './match.js';

export interface StaticExportArtifact {
  body: string;
  headers: Record<string, string>;
  path: string;
  status: number;
}

export interface StaticExportDiagnostic {
  code: 'FW229';
  message: string;
  routePath: string;
}

export interface StaticExportOptions {
  onNonExportable?: 'error' | 'skip';
  origin?: string;
}

export interface StaticExportResult {
  artifacts: readonly StaticExportArtifact[];
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

  return { artifacts, diagnostics };
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
