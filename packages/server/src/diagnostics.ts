import { scrubConsoleArgs, scrubSecretLifecycleValue } from './logging.js';

/**
 * Diagnostic context passed to a `createApp({ onError })` {@link ServerErrorHandler}
 * when a request-shell phase throws. `operation` names the failing phase and the
 * optional fields carry whatever request/route/mutation/query identity is known
 * for that phase (SPEC.md §9.2).
 */
export interface ServerErrorDiagnosticContext {
  mutationKey?: string;
  taskJobId?: string;
  taskKey?: string;
  operation:
    | 'app-request'
    | 'client-module'
    | 'error-shell'
    | 'mutation-handler'
    | 'mutation-render'
    | 'mutation-response-policy'
    | 'no-js-mutation-handler'
    | 'query-endpoint'
    | 'task-runner'
    | 'task-runtime-startup'
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
  if (!onError) {
    reportServerErrorToStderr(error, context);
    return;
  }

  try {
    const result = onError(
      scrubSecretLifecycleValue(error),
      scrubSecretLifecycleValue(context) as ServerErrorDiagnosticContext,
    );
    if (result && typeof result === 'object' && 'then' in result) {
      void result.catch((_diagnosticError) => undefined);
    }
  } catch (_diagnosticError) {
    void _diagnosticError;
    // Diagnostics must not change SPEC §9.2's stable server-error responses.
  }
}

function reportServerErrorToStderr(error: unknown, context: ServerErrorDiagnosticContext): void {
  try {
    const details = [
      `[kovo] ${context.operation} failed`,
      context.url === undefined ? undefined : `url=${context.url}`,
      context.routePath === undefined ? undefined : `route=${context.routePath}`,
      context.queryKey === undefined ? undefined : `query=${context.queryKey}`,
      context.mutationKey === undefined ? undefined : `mutation=${context.mutationKey}`,
      context.status === undefined ? undefined : `status=${context.status}`,
    ].filter((part): part is string => part !== undefined);
    console.error(...scrubConsoleArgs([details.join(' '), error]));
  } catch (_diagnosticError) {
    void _diagnosticError;
    // Diagnostics must not change SPEC §9.2's stable server-error responses.
  }
}
