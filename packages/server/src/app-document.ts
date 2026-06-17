import { reportServerError } from './diagnostics.js';
import { renderErrorDocument, renderRouteDocumentResponse } from './document-core.js';
import { routeResponseToDocumentResponse, type RoutePageResponse } from './response.js';
import { renderRoutePageResponse, type RouteDeclaration, type RouteRequestInput } from './route.js';
import type { KovoApp } from './app-types.js';

type AnyRouteDeclaration = RouteDeclaration<any, any, any, any, any, any>;

export interface AppRouteDocumentOptions {
  app: KovoApp;
  params: Record<string, string>;
  request: Request;
  route: AnyRouteDeclaration;
  url: URL;
}

export async function renderAppRouteDocumentResponse({
  app,
  params,
  request,
  route,
  url,
}: AppRouteDocumentOptions): Promise<RoutePageResponse> {
  const search = searchParamsToRecord(url.searchParams);
  const routeInput: RouteRequestInput = {
    params,
    search,
  };
  const routeResponse = await renderRoutePageResponse(
    route,
    routeInput,
    request,
    (value) =>
      app.renderRoute
        ? app.renderRoute(value, {
            params,
            request,
            route,
            search,
          })
        : renderDefaultRouteValue(value),
    {
      currentUrl: appRequestUrl(url),
      ...(app.onError === undefined ? {} : { onError: app.onError }),
      renderForbidden: async () =>
        appErrorDocumentResponseBody(await renderAppErrorDocumentResponse(app, request, 403)),
      ...(app.sessionProvider === undefined ? {} : { sessionProvider: app.sessionProvider }),
    },
  );

  if (routeResponse.status === 404) {
    return renderAppErrorDocumentResponse(app, request, 404);
  }

  if (routeResponse.status === 500) {
    return renderAppErrorDocumentResponse(app, request, 500);
  }

  return renderRouteDocumentResponse(routeResponseToDocumentResponse(routeResponse), {
    hints: route,
    ...(app.document.lang === undefined ? {} : { lang: app.document.lang }),
    ...(app.document.template === undefined ? {} : { template: app.document.template }),
  });
}

function appErrorDocumentResponseBody(response: RoutePageResponse): string {
  return typeof response.body === 'string' ? response.body : '';
}

export async function renderAppErrorDocumentResponse(
  app: KovoApp,
  request: Request,
  status: 403 | 404 | 500,
): Promise<RoutePageResponse> {
  const renderer =
    status === 403
      ? app.errorShells.forbidden
      : status === 404
        ? app.errorShells.notFound
        : app.errorShells.serverError;

  if (renderer) {
    try {
      return await renderer({ request, status });
    } catch (error) {
      reportServerError(app.onError, error, {
        operation: 'error-shell',
        request,
        status,
        url: appRequestUrl(new URL(request.url)),
      });
    }
  }

  // SPEC §9.2/§9.5: error shells are app config, but unexpected failures
  // still fall back to a stable no-internals document.
  return renderErrorDocument({
    ...(app.document.lang === undefined ? {} : { lang: app.document.lang }),
    status,
    ...(app.document.template === undefined ? {} : { template: app.document.template }),
  });
}

export function appRequestUrl(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

function renderDefaultRouteValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;

  return JSON.stringify(value);
}

function searchParamsToRecord(searchParams: URLSearchParams): Record<string, string | string[]> {
  const record: Record<string, string | string[]> = {};

  for (const [key, value] of searchParams) {
    const existing = record[key];
    if (existing === undefined) {
      record[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      record[key] = [existing, value];
    }
  }

  return record;
}
