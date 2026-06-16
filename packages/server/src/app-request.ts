import { blockingAppDiagnostics } from './app-diagnostics.js';
import { reportServerError } from './diagnostics.js';
import { renderDiagnosticDocument } from './document-diagnostics.js';
import { matchShellDispatch } from './shell.js';
import { routeResponseToWebResponse } from './response.js';
import type { KovoApp } from './app-types.js';
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

  if (match.normalization.redirect) {
    url.pathname = match.normalization.redirect.pathname;
    return new Response(null, {
      headers: { Location: `${url.pathname}${url.search}${url.hash}` },
      status: match.normalization.redirect.status,
    });
  }

  try {
    return await dispatchMatchedAppRequest({ app, match, request, url });
  } catch (error) {
    reportServerError(app.onError, error, {
      operation: 'app-request',
      request,
      url: appRequestUrl(url),
    });
    return routeResponseToWebResponse(
      await renderAppErrorDocumentResponse(app, request, 500),
      request,
    );
  }
}
