import { isSecret } from '@kovojs/core';

import { neutralizeLogValue, sanitizeDiagnosticText, sanitizeDiagnosticUrl } from './logging.js';
import {
  authorityNeutralAbortSignal,
  createNativeHeaders,
  createNativeRequest,
  isNativeAbortSignal,
  isNativeHeaders,
  isNativeRequest,
  requestForAuthorityNeutralMetadata,
} from './request-carrier.js';

const readDiagnosticRequestHeaders = requestIntrinsicGetter<Headers>('headers');
const readDiagnosticRequestMethod = requestIntrinsicGetter<string>('method');
const readDiagnosticRequestReferrer = requestIntrinsicGetter<string>('referrer');
const readDiagnosticRequestSignal = requestIntrinsicGetter<AbortSignal>('signal');
const readDiagnosticRequestUrl = requestIntrinsicGetter<string>('url');
const nativeHeadersEntries = Object.getOwnPropertyDescriptor(Headers.prototype, 'entries')
  ?.value as unknown;
const nativeAtob = globalThis.atob;
const nativeErrorStackDescriptor = Object.getOwnPropertyDescriptor(new Error(), 'stack');
const nativeErrorPrototypeNames = new Map<object, string>([
  [Error.prototype, 'Error'],
  [EvalError.prototype, 'EvalError'],
  [RangeError.prototype, 'RangeError'],
  [ReferenceError.prototype, 'ReferenceError'],
  [SyntaxError.prototype, 'SyntaxError'],
  [TypeError.prototype, 'TypeError'],
  [URIError.prototype, 'URIError'],
]);

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
  const prepared = safelyPrepareServerErrorDiagnostic(error, context);
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

function safelyPrepareServerErrorDiagnostic(
  error: unknown,
  context: ServerErrorDiagnosticContext,
): { context: ServerErrorDiagnosticContext; error: unknown } {
  try {
    return prepareServerErrorDiagnostic(error, context);
  } catch {
    let operation: ServerErrorDiagnosticContext['operation'] = 'app-request';
    try {
      if (SERVER_ERROR_OPERATIONS.has(context.operation)) operation = context.operation;
    } catch {}
    return {
      context: { operation },
      error: new Error('Server operation failed.'),
    };
  }
}

const SERVER_ERROR_OPERATIONS = new Set<ServerErrorDiagnosticContext['operation']>([
  'app-request',
  'client-module',
  'error-shell',
  'mutation-handler',
  'mutation-render',
  'mutation-response-policy',
  'no-js-mutation-handler',
  'query-endpoint',
  'route-page',
  'route-render',
  'task-runner',
  'task-runtime-startup',
]);

function prepareServerErrorDiagnostic(
  error: unknown,
  context: ServerErrorDiagnosticContext,
): { context: ServerErrorDiagnosticContext; error: unknown } {
  const requestInputs = diagnosticRequestInputs(context.request);
  if (context.url !== undefined) requestInputs.urls.push(context.url);
  requestInputs.urls = [...new Set(requestInputs.urls)];
  requestInputs.secretValues = [
    ...new Set([...requestInputs.secretValues, ...requestInputs.urls.flatMap(diagnosticUrlValues)]),
  ];
  const sanitizedError = sanitizeDiagnosticValue(error, requestInputs, new WeakMap());
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
    context: sanitizeDiagnosticValue(
      sanitizedContext,
      requestInputs,
      new WeakMap(),
    ) as ServerErrorDiagnosticContext,
    error: sanitizedError,
  };
}

interface DiagnosticRequestInputs {
  secretValues: string[];
  urls: string[];
}

const DIAGNOSTIC_SECRET_NAME_SUFFIXES = [
  'access',
  'auth',
  'authorization',
  'cap',
  'code',
  'cookie',
  'credential',
  'csrf',
  'idem',
  'key',
  'password',
  'secret',
  'session',
  'signature',
  'state',
  'token',
] as const;

function diagnosticRequestInputs(request: unknown): DiagnosticRequestInputs {
  const inputs: DiagnosticRequestInputs = { secretValues: [], urls: [] };
  if (!isNativeRequest(request)) return inputs;
  const source = requestForAuthorityNeutralMetadata(request);
  try {
    inputs.urls.push(readDiagnosticRequestUrl(source));
  } catch {}
  try {
    const referrer = readDiagnosticRequestReferrer(source);
    if (referrer !== '') inputs.urls.push(referrer);
  } catch {}
  try {
    const headers = readDiagnosticRequestHeaders(source);
    if (typeof nativeHeadersEntries !== 'function') return inputs;
    const entries = Reflect.apply(nativeHeadersEntries, headers, []) as IterableIterator<
      [string, string]
    >;
    for (const [name, value] of entries) {
      if (diagnosticNameCarriesUrl(name) && value !== '') inputs.urls.push(value);
      if (diagnosticNameCarriesSecret(name) && value !== '') {
        inputs.secretValues.push(value);
        inputs.secretValues.push(...diagnosticAuthorizationValues(value));
        if (normalizeDiagnosticName(name).endsWith('cookie')) {
          inputs.secretValues.push(...diagnosticCookieValues(value));
        }
      }
    }
  } catch {}
  return inputs;
}

function normalizeDiagnosticName(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function diagnosticNameCarriesSecret(value: string): boolean {
  const normalized = normalizeDiagnosticName(value);
  return DIAGNOSTIC_SECRET_NAME_SUFFIXES.some((suffix) => normalized.includes(suffix));
}

function diagnosticNameCarriesUrl(value: string): boolean {
  const normalized = normalizeDiagnosticName(value);
  return (
    normalized.endsWith('location') ||
    normalized.endsWith('referer') ||
    normalized.endsWith('referrer') ||
    normalized.endsWith('uri') ||
    normalized.endsWith('url')
  );
}

function diagnosticCookieValues(value: string): string[] {
  return value.split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return [];
    const raw = part.slice(separator + 1).trim();
    if (raw === '') return [];
    const unquoted =
      raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')
        ? raw.slice(1, -1).replaceAll(/\\(["\\])/g, '$1')
        : raw;
    try {
      const decoded = decodeURIComponent(unquoted);
      return [...new Set([raw, unquoted, decoded])];
    } catch {
      return [...new Set([raw, unquoted])];
    }
  });
}

function diagnosticAuthorizationValues(value: string): string[] {
  const match = /^\s*(basic|bearer|digest|negotiate)\s+(.+)$/i.exec(value);
  if (!match?.[1] || !match[2]) return [];
  const scheme = match[1].toLowerCase();
  const payload = match[2].trim();
  const values = [payload];
  if (scheme === 'basic' && typeof nativeAtob === 'function') {
    try {
      const decoded = new TextDecoder().decode(
        Uint8Array.from(Reflect.apply(nativeAtob, globalThis, [payload]), (char) =>
          char.charCodeAt(0),
        ),
      );
      values.push(decoded);
      const separator = decoded.indexOf(':');
      if (separator >= 0) {
        values.push(decoded.slice(0, separator), decoded.slice(separator + 1));
      }
    } catch {}
  }
  if (scheme === 'digest') {
    for (const field of payload.matchAll(/(?:^|,)\s*[^=,]+=(?:"([^"]*)"|([^,]*))/g)) {
      const fieldValue = (field[1] ?? field[2])?.trim();
      if (fieldValue) values.push(fieldValue);
    }
  }
  return [...new Set(values.filter((item) => item !== ''))];
}

function diagnosticUrlValues(value: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(value, 'https://kovo.invalid');
  } catch {
    return [];
  }
  const values = [...parsed.searchParams.entries()]
    .filter(([key]) => diagnosticNameCarriesSecret(key))
    .map(([, item]) => item)
    .filter((item) => item !== '');
  const rawValues = parsed.search
    .slice(1)
    .split('&')
    .flatMap((pair) => {
      const separator = pair.indexOf('=');
      if (separator < 0) return [];
      let key = pair.slice(0, separator);
      try {
        key = decodeURIComponent(key.replaceAll('+', ' '));
      } catch {}
      return diagnosticNameCarriesSecret(key) ? [pair.slice(separator + 1)] : [];
    })
    .filter((item) => item !== '');
  return [...values, ...rawValues];
}

function sanitizeDiagnosticRequest(request: unknown): unknown {
  if (!isNativeRequest(request)) return request;

  try {
    const source = requestForAuthorityNeutralMetadata(request);
    const rawUrl = readDiagnosticRequestUrl(source);
    const parsed = new URL(rawUrl);
    const safeUrl = new URL(sanitizeDiagnosticUrl(rawUrl), parsed.origin).href;
    const rawReferrer = readDiagnosticRequestReferrer(source);
    const safeReferrer = diagnosticRequestReferrer(rawReferrer);
    return createNativeRequest(safeUrl, {
      method: readDiagnosticRequestMethod(source),
      ...(safeReferrer === undefined ? {} : { referrer: safeReferrer }),
      signal: authorityNeutralAbortSignal(readDiagnosticRequestSignal(source)),
    });
  } catch {
    // A diagnostic carrier that cannot be reconstructed is less trustworthy than
    // no carrier. Never fall back to the raw request and re-expose credentials.
    return undefined;
  }
}

function requestIntrinsicGetter<Value>(property: string): (request: Request) => Value {
  const descriptor = Object.getOwnPropertyDescriptor(Request.prototype, property);
  const getter = descriptor ? (Reflect.get(descriptor, 'get') as unknown) : undefined;
  if (typeof getter !== 'function') {
    throw new TypeError(`The Web Request implementation lacks a ${property} getter.`);
  }
  return (request) => Reflect.apply(getter, request, []) as Value;
}

function diagnosticRequestReferrer(value: string): string | undefined {
  if (value === '') return undefined;
  if (value === 'about:client') return value;
  try {
    const parsed = new URL(value);
    return new URL(sanitizeDiagnosticUrl(value), parsed.origin).href;
  } catch {
    return undefined;
  }
}

function sanitizeDiagnosticValue(
  value: unknown,
  requestInputs: DiagnosticRequestInputs,
  seen: WeakMap<object, unknown>,
): unknown {
  if (isSecret(value)) return '[secret]';
  if (typeof value === 'string') {
    return sanitizeDiagnosticString(value, requestInputs);
  }
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;

  const object = value as object;
  const existing = seen.get(object);
  if (existing !== undefined) return existing;

  if (isNativeRequest(value)) {
    const sanitized = sanitizeDiagnosticRequest(value);
    seen.set(object, sanitized);
    return sanitized;
  }
  if (isNativeHeaders(value)) {
    const sanitized = createNativeHeaders();
    seen.set(object, sanitized);
    return sanitized;
  }
  if (isNativeAbortSignal(value)) {
    try {
      const sanitized = authorityNeutralAbortSignal(value);
      seen.set(object, sanitized);
      return sanitized;
    } catch {
      seen.set(object, '[redacted]');
      return '[redacted]';
    }
  }
  if (
    value instanceof URL ||
    value instanceof URLSearchParams ||
    value instanceof Response ||
    value instanceof Blob
  ) {
    seen.set(object, '[redacted]');
    return '[redacted]';
  }

  if (value instanceof Error) {
    const prototype = Object.getPrototypeOf(value);
    const nativeName = nativeErrorPrototypeNames.get(prototype);
    const name = diagnosticErrorString(value, 'name', nativeName ?? '[redacted]', requestInputs);
    const message = diagnosticErrorString(value, 'message', '', requestInputs);
    const stack = diagnosticErrorString(value, 'stack', undefined, requestInputs);
    const clone = new Error(message.value);
    clone.name = name.value ?? 'Error';
    if (stack.value !== undefined) clone.stack = stack.value;
    seen.set(object, clone);
    let changed = nativeName === undefined || name.changed || message.changed || stack.changed;

    for (const key of Reflect.ownKeys(value)) {
      if (key === 'name' || key === 'message' || key === 'stack') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      if (typeof key === 'symbol') {
        changed = true;
        continue;
      }
      const sanitizedKey = sanitizeDiagnosticString(key, requestInputs);
      const sanitized =
        'value' in descriptor
          ? sanitizeDiagnosticValue(descriptor.value, requestInputs, seen)
          : '[redacted]';
      Object.defineProperty(clone, sanitizedKey, {
        configurable: true,
        enumerable: descriptor.enumerable ?? false,
        value: sanitized,
        writable: true,
      });
      if (sanitizedKey !== key || !('value' in descriptor) || sanitized !== descriptor.value) {
        changed = true;
      }
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
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      if (typeof key === 'symbol') {
        changed = true;
        continue;
      }
      const sanitizedKey = sanitizeDiagnosticString(key, requestInputs);
      const sanitized =
        'value' in descriptor
          ? sanitizeDiagnosticValue(descriptor.value, requestInputs, seen)
          : '[redacted]';
      Object.defineProperty(next, sanitizedKey, {
        configurable: true,
        enumerable: descriptor.enumerable ?? false,
        value: sanitized,
        writable: true,
      });
      if (sanitizedKey !== key || !('value' in descriptor) || sanitized !== descriptor.value) {
        changed = true;
      }
    }
    if (!changed) {
      seen.set(object, value);
      return value;
    }
    return next;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    seen.set(object, '[redacted]');
    return '[redacted]';
  }
  const next = (prototype === null ? Object.create(null) : {}) as Record<PropertyKey, unknown>;
  seen.set(object, next);
  let changed = false;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if (typeof key === 'symbol') {
      changed = true;
      continue;
    }
    const sanitizedKey = sanitizeDiagnosticString(key, requestInputs);
    const sanitized =
      'value' in descriptor
        ? sanitizeDiagnosticValue(descriptor.value, requestInputs, seen)
        : '[redacted]';
    Object.defineProperty(next, sanitizedKey, {
      configurable: true,
      enumerable: descriptor.enumerable ?? false,
      value: sanitized,
      writable: true,
    });
    if (sanitizedKey !== key || !('value' in descriptor) || sanitized !== descriptor.value) {
      changed = true;
    }
  }
  if (!changed) {
    seen.set(object, value);
    return value;
  }
  return next;
}

function diagnosticErrorString(
  error: Error,
  key: 'message' | 'name' | 'stack',
  fallback: string | undefined,
  inputs: DiagnosticRequestInputs,
): { changed: boolean; value: string | undefined } {
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  if (
    key === 'stack' &&
    descriptor !== undefined &&
    !('value' in descriptor) &&
    nativeErrorStackDescriptor !== undefined &&
    !('value' in nativeErrorStackDescriptor) &&
    descriptor.get === nativeErrorStackDescriptor.get &&
    descriptor.set === nativeErrorStackDescriptor.set
  ) {
    return { changed: false, value: fallback };
  }
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') {
    return {
      changed: descriptor !== undefined && (!('value' in descriptor) || key !== 'stack'),
      value: fallback,
    };
  }
  const value = sanitizeDiagnosticString(descriptor.value, inputs);
  return { changed: value !== descriptor.value, value };
}

function sanitizeDiagnosticString(value: string, inputs: DiagnosticRequestInputs): string {
  let sanitized = sanitizeDiagnosticText(value, inputs.urls, sanitizeDiagnosticUrl);
  for (const secretValue of [...inputs.secretValues].sort(
    (left, right) => right.length - left.length,
  )) {
    if (secretValue !== '') sanitized = sanitized.replaceAll(secretValue, '[redacted]');
  }
  return sanitized;
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
    console.error(neutralizeLogValue(details.join(' ')), diagnosticLogValue(error));
  } catch (_diagnosticError) {
    void _diagnosticError;
    // Diagnostics must not change SPEC §9.2's stable server-error responses.
  }
}

function diagnosticLogValue(value: unknown): string {
  if (!(value instanceof Error)) return neutralizeLogValue('[diagnostic value redacted]');
  const prototype = Object.getPrototypeOf(value);
  const fallbackName = nativeErrorPrototypeNames.get(prototype) ?? 'Error';
  const name = diagnosticErrorString(value, 'name', fallbackName, {
    secretValues: [],
    urls: [],
  }).value;
  const message = diagnosticErrorString(value, 'message', '', {
    secretValues: [],
    urls: [],
  }).value;
  return neutralizeLogValue(`${name ?? fallbackName}${message ? `: ${message}` : ''}`);
}
