/**
 * Diagnostic context passed to a `createApp({ onError })` {@link ServerErrorHandler}
 * when a request-shell phase throws. `operation` names the failing phase and the
 * optional fields carry whatever request/route/mutation/query identity is known
 * for that phase (SPEC.md §9.2).
 */
export interface ServerErrorDiagnosticContext {
  /**
   * Opaque, user-facing id that joins a stable error response to the server-side
   * error observed by `onError` (SPEC.md §9.2).
   */
  correlationId?: string;
  mutationKey?: string;
  operation:
    | 'app-request'
    | 'client-module'
    | 'error-shell'
    | 'mutation-handler'
    | 'mutation-render'
    | 'mutation-stream'
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

export interface ServerErrorReport {
  correlationId: string;
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

export function createServerErrorCorrelationId(): string {
  const crypto = globalThis.crypto as
    | {
        getRandomValues?: (array: Uint8Array) => Uint8Array;
        randomUUID?: () => string;
      }
    | undefined;
  const uuid = crypto?.randomUUID?.();
  if (uuid) return `kovo-${uuid}`;

  const bytes = new Uint8Array(16);
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return `kovo-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function reportServerError(
  onError: ServerErrorHandler | undefined,
  error: unknown,
  context: ServerErrorDiagnosticContext,
  options: { correlationId?: string } = {},
): ServerErrorReport {
  const correlationId = options.correlationId ?? createServerErrorCorrelationId();
  if (!onError) return { correlationId };

  try {
    const result = onError(error, { ...context, correlationId });
    if (result && typeof result === 'object' && 'then' in result) {
      void result.catch((_diagnosticError) => undefined);
    }
  } catch (_diagnosticError) {
    void _diagnosticError;
    // Diagnostics must not change SPEC §9.2's stable server-error responses.
  }

  return { correlationId };
}

export function serverErrorHeaders(report: ServerErrorReport): Record<string, string> {
  return { 'Kovo-Error-Id': report.correlationId };
}
