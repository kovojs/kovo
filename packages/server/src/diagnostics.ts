import {
  sanitizeDiagnosticText,
  sanitizeDiagnosticUrl,
  scrubConsoleArgs,
  scrubSecretLifecycleValue,
} from './logging.js';

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
 * request-shell phase throws, with a secret/URL-sanitized error and
 * {@link ServerErrorDiagnosticContext}; it must not change the stable SPEC.md
 * §9.2 server-error responses (errors thrown here are swallowed).
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
  const prepared = prepareServerErrorDiagnostic(error, context);
  if (!onError) {
    reportServerErrorToStderr(prepared.error, prepared.context);
    return;
  }

  try {
    const result = onError(prepared.error, prepared.context);
    if (result && typeof result === 'object' && 'then' in result) {
      void result.catch((_diagnosticError) => undefined);
    }
  } catch (_diagnosticError) {
    void _diagnosticError;
    // Diagnostics must not change SPEC §9.2's stable server-error responses.
  }
}

function prepareServerErrorDiagnostic(
  error: unknown,
  context: ServerErrorDiagnosticContext,
): { context: ServerErrorDiagnosticContext; error: unknown } {
  const requestUrl = diagnosticRequestUrl(context.request);
  const requestUrls = [context.url, requestUrl].filter(
    (value): value is string => value !== undefined,
  );
  const sanitizedError = sanitizeDiagnosticValue(error, requestUrls, new WeakMap());
  const sanitizedRequest = sanitizeDiagnosticRequest(context.request);
  const sanitizedUrl = context.url === undefined ? undefined : sanitizeDiagnosticUrl(context.url);
  const contextChanged = sanitizedRequest !== context.request || sanitizedUrl !== context.url;
  const sanitizedContext = contextChanged
    ? {
        ...context,
        ...(context.request === undefined ? {} : { request: sanitizedRequest }),
        ...(sanitizedUrl === undefined ? {} : { url: sanitizedUrl }),
      }
    : context;

  return {
    context: scrubSecretLifecycleValue(sanitizedContext) as ServerErrorDiagnosticContext,
    error: scrubSecretLifecycleValue(sanitizedError),
  };
}

function diagnosticRequestUrl(request: unknown): string | undefined {
  if (!(request instanceof Request)) return undefined;
  try {
    return request.url;
  } catch {
    return undefined;
  }
}

function sanitizeDiagnosticRequest(request: unknown): unknown {
  const rawUrl = diagnosticRequestUrl(request);
  if (rawUrl === undefined || !(request instanceof Request)) return request;

  const parsed = new URL(rawUrl);
  if (parsed.search === '' && parsed.hash === '') return request;
  const safeUrl = new URL(sanitizeDiagnosticUrl(rawUrl), parsed.origin).href;

  return new Proxy(request, {
    get(target, property) {
      if (property === 'url') return safeUrl;
      if (property === 'referrer') {
        const referrer = Reflect.get(target, property, target) as unknown;
        return typeof referrer === 'string' && referrer !== ''
          ? sanitizeDiagnosticUrl(referrer)
          : referrer;
      }
      if (property === 'clone') {
        return () => {
          const clone = Reflect.get(target, property, target) as () => Request;
          return sanitizeDiagnosticRequest(clone.call(target));
        };
      }

      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function sanitizeDiagnosticValue(
  value: unknown,
  requestUrls: readonly string[],
  seen: WeakMap<object, unknown>,
): unknown {
  if (typeof value === 'string') {
    return sanitizeDiagnosticText(value, requestUrls, sanitizeDiagnosticUrl);
  }
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;

  const object = value as object;
  const existing = seen.get(object);
  if (existing !== undefined) return existing;

  if (value instanceof Error) {
    const name = sanitizeDiagnosticText(value.name, requestUrls, sanitizeDiagnosticUrl);
    const message = sanitizeDiagnosticText(value.message, requestUrls, sanitizeDiagnosticUrl);
    const stack =
      value.stack === undefined
        ? undefined
        : sanitizeDiagnosticText(value.stack, requestUrls, sanitizeDiagnosticUrl);
    const clone = new Error(message);
    clone.name = name;
    if (stack !== undefined) clone.stack = stack;
    seen.set(object, clone);

    let changed = name !== value.name || message !== value.message || stack !== value.stack;
    if (value.cause !== undefined) {
      const cause = sanitizeDiagnosticValue(value.cause, requestUrls, seen);
      Object.defineProperty(clone, 'cause', {
        configurable: true,
        enumerable: false,
        value: cause,
        writable: true,
      });
      if (cause !== value.cause) changed = true;
    }
    const record = value as unknown as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      const current = record[key];
      const sanitized = sanitizeDiagnosticValue(current, requestUrls, seen);
      Object.defineProperty(clone, key, {
        configurable: true,
        enumerable: true,
        value: sanitized,
        writable: true,
      });
      if (sanitized !== current) changed = true;
    }
    if (!changed) {
      seen.set(object, value);
      return value;
    }
    return clone;
  }

  if (Array.isArray(value)) {
    const next: unknown[] = [];
    seen.set(object, next);
    let changed = false;
    for (const item of value) {
      const sanitized = sanitizeDiagnosticValue(item, requestUrls, seen);
      next.push(sanitized);
      if (sanitized !== item) changed = true;
    }
    if (!changed) {
      seen.set(object, value);
      return value;
    }
    return next;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const next: Record<string, unknown> = {};
  seen.set(object, next);
  let changed = false;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const current = record[key];
    const sanitized = sanitizeDiagnosticValue(current, requestUrls, seen);
    next[key] = sanitized;
    if (sanitized !== current) changed = true;
  }
  if (!changed) {
    seen.set(object, value);
    return value;
  }
  return next;
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
