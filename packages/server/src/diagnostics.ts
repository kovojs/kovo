export interface ServerErrorDiagnosticContext {
  mutationKey?: string;
  operation:
    | 'app-request'
    | 'client-module'
    | 'mutation-handler'
    | 'mutation-render'
    | 'no-js-mutation-handler'
    | 'query-endpoint'
    | 'route-page'
    | 'route-render';
  queryKey?: string;
  request?: unknown;
  routePath?: string;
  targets?: readonly string[];
  url?: string;
}

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
