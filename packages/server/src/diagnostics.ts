/**
 * Diagnostic context passed to a `createApp({ onError })` {@link ServerErrorHandler}
 * when a request-shell phase throws. `operation` names the failing phase and the
 * optional fields carry whatever request/route/mutation/query identity is known
 * for that phase (SPEC.md §9.2).
 */
export interface ServerErrorDiagnosticContext {
  mutationKey?: string;
  operation:
    | 'app-request'
    | 'client-module'
    | 'error-shell'
    | 'mutation-handler'
    | 'mutation-render'
    | 'no-js-mutation-handler'
    | 'query-endpoint'
    | 'route-page'
    | 'route-render';
  queryKey?: string;
  request?: unknown;
  routePath?: string;
  status?: 403 | 404 | 500;
  targets?: readonly string[];
  url?: string;
}

/**
 * Observability hook supplied to `createApp({ onError })`. Invoked when a
 * request-shell phase throws, with the original error and a
 * {@link ServerErrorDiagnosticContext}; it must not change the stable
 * SPEC.md §9.2 server-error responses (errors thrown here are swallowed).
 */
export type ServerErrorHandler = (
  error: unknown,
  context: ServerErrorDiagnosticContext,
) => Promise<void> | void;

export function reportServerError(
  onError: ServerErrorHandler | undefined,
  error: unknown,
  context: ServerErrorDiagnosticContext,
): void {
  if (!onError) return;

  try {
    const result = onError(error, context);
    if (result && typeof result === 'object' && 'then' in result) {
      void result.catch((_diagnosticError) => undefined);
    }
  } catch (_diagnosticError) {
    void _diagnosticError;
    // Diagnostics must not change SPEC §9.2's stable server-error responses.
  }
}
