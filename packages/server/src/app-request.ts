import { blockingAppDiagnostics } from './app-diagnostics.js';
import { reportServerError } from './diagnostics.js';
import { renderDiagnosticDocument } from './document-diagnostics.js';
import { matchShellDispatch } from './shell.js';
import { routeResponseToWebResponse } from './response.js';
import { KOVO_CSP_REPORT_ENDPOINT } from './csp.js';
import { kovoSecurityReportResponse } from './reporting.js';
import type { KovoApp } from './app-types.js';
import { appSystemResponse } from './app-system-response.js';
import {
  preDispatchLoadShedResponse,
  requestWithBodyLimit,
  RequestBodyLimitExceededError,
  type LoadShedSurface,
} from './app-load-shed.js';
import { dispatchMatchedAppRequest } from './app-dispatch.js';
import { appRequestUrl, renderAppErrorDocumentResponse } from './app-document.js';

export async function handleAppRequest(app: KovoApp, request: Request): Promise<Response> {
  const appDiagnostics = blockingAppDiagnostics(app);
  if (appDiagnostics.length > 0) {
    return routeResponseToWebResponse(renderDiagnosticDocument(appDiagnostics), request);
  }

  const url = new URL(request.url);
  const match = matchShellDispatch({
    endpoints: app.endpoints,
    method: request.method,
    pathname: url.pathname,
    routes: app.routes,
  });
  const surface = loadShedSurface(match.kind);
  const buildToken = systemResponseBuildToken(app, surface);

  if (match.normalization.redirect) {
    url.pathname = match.normalization.redirect.pathname;
    return appSystemResponse(null, {
      buildToken,
      headers: { Location: `${url.pathname}${url.search}${url.hash}` },
      status: match.normalization.redirect.status,
      surface,
    });
  }

  const loadShed = preDispatchLoadShedResponse(app, request, surface, buildToken);
  if (loadShed) return loadShed;

  if (url.pathname === KOVO_CSP_REPORT_ENDPOINT) {
    return kovoSecurityReportResponse(app, request);
  }

  const limitedRequest = requestWithBodyLimit(request, app.requestLimits.maxBodyBytes);
  try {
    return await dispatchMatchedAppRequest({ app, match, request: limitedRequest, url });
  } catch (error) {
    if (error instanceof RequestBodyLimitExceededError) {
      return appSystemResponse('Payload Too Large', {
        buildToken,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        status: 413,
        surface,
      });
    }
    reportServerError(app.onError, error, {
      operation: 'app-request',
      request: limitedRequest,
      url: appRequestUrl(url),
    });
    return routeResponseToWebResponse(
      await renderAppErrorDocumentResponse(app, request, 500),
      request,
    );
  }
}

function loadShedSurface(kind: string): LoadShedSurface {
  if (kind === 'mutation') return 'mutation';
  if (kind === 'query') return 'query';
  return 'other';
}

function systemResponseBuildToken(app: KovoApp, surface: LoadShedSurface): string | undefined {
  return surface === 'mutation' || surface === 'query' ? app.clientModules.buildToken() : undefined;
}
