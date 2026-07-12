import { isSecret } from '@kovojs/core';

import {
  loggingCharacterCodeAt,
  loggingDecodeURIComponent,
  loggingDiagnosticUrlParts,
  loggingIsArray,
  loggingRegExpExec,
  loggingReplaceAllLiteral,
  loggingStringEndsWith,
  loggingStringIncludes,
  loggingStringIndexOf,
  loggingStringSlice,
  loggingStringToLowerCase,
  loggingStringTrim,
} from './logging-intrinsics.js';
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
import {
  createWitnessWeakMap,
  witnessDefineProperty,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessMapGet,
  witnessOwnKeys,
  witnessReflectApply,
  witnessReflectGet,
  witnessSetHas,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

const readDiagnosticRequestHeaders = requestIntrinsicGetter<Headers>('headers');
const readDiagnosticRequestMethod = requestIntrinsicGetter<string>('method');
const readDiagnosticRequestReferrer = requestIntrinsicGetter<string>('referrer');
const readDiagnosticRequestSignal = requestIntrinsicGetter<AbortSignal>('signal');
const readDiagnosticRequestUrl = requestIntrinsicGetter<string>('url');
const NativeHeaders = Headers;
const nativeHeadersEntries = witnessGetOwnPropertyDescriptor(NativeHeaders.prototype, 'entries')
  ?.value as unknown;
const nativeHeadersIteratorNext = diagnosticHeadersIteratorNext();
const diagnosticHeadersControlsSound = diagnosticHeaderControlsAreSound();
const nativeAtob = globalThis.atob;
const NativeBlob = Blob;
const NativeError = Error;
const NativeObject = Object;
const NativeEvalError = EvalError;
const NativeRangeError = RangeError;
const NativeReferenceError = ReferenceError;
const NativeResponse = Response;
const NativeSyntaxError = SyntaxError;
const NativeTextDecoder = TextDecoder;
const NativeTypeError = TypeError;
const NativeUint8Array = Uint8Array;
const NativeURIError = URIError;
const NativeURL = URL;
const NativeURLSearchParams = URLSearchParams;
const nativeFunctionHasInstance = Function.prototype[Symbol.hasInstance];
const nativeErrorStackDescriptor = witnessGetOwnPropertyDescriptor(new NativeError(), 'stack');
const nativeObjectCreate = NativeObject.create;
const nativeObjectPrototype = NativeObject.prototype;
const nativeErrorPrototypeNames = new Map<object, string>([
  [NativeError.prototype, 'Error'],
  [NativeEvalError.prototype, 'EvalError'],
  [NativeRangeError.prototype, 'RangeError'],
  [NativeReferenceError.prototype, 'ReferenceError'],
  [NativeSyntaxError.prototype, 'SyntaxError'],
  [NativeTypeError.prototype, 'TypeError'],
  [NativeURIError.prototype, 'URIError'],
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
      if (witnessSetHas(SERVER_ERROR_OPERATIONS, context.operation)) operation = context.operation;
    } catch {}
    return {
      context: { operation },
      error: new NativeError('Server operation failed.'),
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
  if (context.url !== undefined) requestInputs.urls[requestInputs.urls.length] = context.url;
  requestInputs.urls = uniqueDiagnosticStrings(requestInputs.urls);
  for (let index = 0; index < requestInputs.urls.length; index += 1) {
    const values = diagnosticUrlValues(requestInputs.urls[index]!);
    for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
      requestInputs.secretValues[requestInputs.secretValues.length] = values[valueIndex]!;
    }
  }
  requestInputs.secretValues = uniqueDiagnosticStrings(requestInputs.secretValues);
  const sanitizedError = sanitizeDiagnosticValue(error, requestInputs, createWitnessWeakMap());
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
      createWitnessWeakMap(),
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
    inputs.urls[inputs.urls.length] = readDiagnosticRequestUrl(source);
  } catch {}
  try {
    const referrer = readDiagnosticRequestReferrer(source);
    if (referrer !== '') inputs.urls[inputs.urls.length] = referrer;
  } catch {}
  try {
    const headers = readDiagnosticRequestHeaders(source);
    if (
      !diagnosticHeadersControlsSound ||
      typeof nativeHeadersEntries !== 'function' ||
      typeof nativeHeadersIteratorNext !== 'function'
    ) {
      throw new NativeTypeError('Native diagnostic Headers controls are unavailable.');
    }
    const entries = witnessReflectApply<IterableIterator<[string, string]>>(
      nativeHeadersEntries,
      headers,
      [],
    );
    while (true) {
      const next = witnessReflectApply<IteratorResult<[string, string]>>(
        nativeHeadersIteratorNext,
        entries,
        [],
      );
      if (next.done) break;
      const name = next.value[0];
      const value = next.value[1];
      if (diagnosticNameCarriesUrl(name) && value !== '') inputs.urls[inputs.urls.length] = value;
      if (diagnosticNameCarriesSecret(name) && value !== '') {
        inputs.secretValues[inputs.secretValues.length] = value;
        appendDiagnosticStrings(inputs.secretValues, diagnosticAuthorizationValues(value));
        if (loggingStringEndsWith(normalizeDiagnosticName(name), 'cookie')) {
          appendDiagnosticStrings(inputs.secretValues, diagnosticCookieValues(value));
        }
      }
    }
  } catch {}
  return inputs;
}

function normalizeDiagnosticName(value: string): string {
  const lower = loggingStringToLowerCase(value);
  let normalized = '';
  for (let index = 0; index < lower.length; index += 1) {
    const code = loggingCharacterCodeAt(lower, index);
    if ((code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39)) {
      normalized += lower[index];
    }
  }
  return normalized;
}

function diagnosticNameCarriesSecret(value: string): boolean {
  const normalized = normalizeDiagnosticName(value);
  for (let index = 0; index < DIAGNOSTIC_SECRET_NAME_SUFFIXES.length; index += 1) {
    if (loggingStringIncludes(normalized, DIAGNOSTIC_SECRET_NAME_SUFFIXES[index]!)) return true;
  }
  return false;
}

function diagnosticNameCarriesUrl(value: string): boolean {
  const normalized = normalizeDiagnosticName(value);
  return (
    loggingStringEndsWith(normalized, 'location') ||
    loggingStringEndsWith(normalized, 'referer') ||
    loggingStringEndsWith(normalized, 'referrer') ||
    loggingStringEndsWith(normalized, 'uri') ||
    loggingStringEndsWith(normalized, 'url')
  );
}

function diagnosticCookieValues(value: string): string[] {
  const values: string[] = [];
  const parts = splitDiagnosticLiteral(value, ';');
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    const separator = loggingStringIndexOf(part, '=');
    if (separator < 0) continue;
    const raw = loggingStringTrim(loggingStringSlice(part, separator + 1));
    if (raw === '') continue;
    const unquoted =
      raw.length >= 2 && raw[0] === '"' && raw[raw.length - 1] === '"'
        ? unescapeDiagnosticCookieValue(loggingStringSlice(raw, 1, -1))
        : raw;
    try {
      appendDiagnosticStrings(
        values,
        uniqueDiagnosticStrings([raw, unquoted, loggingDecodeURIComponent(unquoted)]),
      );
    } catch {
      appendDiagnosticStrings(values, uniqueDiagnosticStrings([raw, unquoted]));
    }
  }
  return uniqueDiagnosticStrings(values);
}

function diagnosticAuthorizationValues(value: string): string[] {
  const match = loggingRegExpExec(/^\s*(basic|bearer|digest|negotiate)\s+(.+)$/i, value);
  if (!match?.[1] || !match[2]) return [];
  const scheme = loggingStringToLowerCase(match[1]);
  const payload = loggingStringTrim(match[2]);
  const values = [payload];
  if (scheme === 'basic' && typeof nativeAtob === 'function') {
    try {
      const binary = witnessReflectApply<string>(nativeAtob, globalThis, [payload]);
      const bytes = new NativeUint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = loggingCharacterCodeAt(binary, index);
      }
      const decoded = new NativeTextDecoder().decode(bytes);
      values[values.length] = decoded;
      const separator = loggingStringIndexOf(decoded, ':');
      if (separator >= 0) {
        values[values.length] = loggingStringSlice(decoded, 0, separator);
        values[values.length] = loggingStringSlice(decoded, separator + 1);
      }
    } catch {}
  }
  if (scheme === 'digest') {
    const fields = /(?:^|,)\s*[^=,]+=(?:"([^"]*)"|([^,]*))/g;
    for (
      let field = loggingRegExpExec(fields, payload);
      field !== null;
      field = loggingRegExpExec(fields, payload)
    ) {
      const fieldValue = field[1] ?? field[2];
      if (fieldValue === undefined) continue;
      const trimmed = loggingStringTrim(fieldValue);
      if (trimmed !== '') values[values.length] = trimmed;
    }
  }
  return uniqueDiagnosticStrings(values);
}

function diagnosticUrlValues(value: string): string[] {
  const parsed = loggingDiagnosticUrlParts(value);
  if (parsed === undefined || parsed.search === '') return [];
  const values: string[] = [];
  const pairs = splitDiagnosticLiteral(loggingStringSlice(parsed.search, 1), '&');
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index]!;
    const separator = loggingStringIndexOf(pair, '=');
    if (separator < 0) continue;
    const rawKey = loggingStringSlice(pair, 0, separator);
    const rawValue = loggingStringSlice(pair, separator + 1);
    let key = loggingReplaceAllLiteral(rawKey, '+', ' ');
    try {
      key = loggingDecodeURIComponent(key);
    } catch {}
    if (!diagnosticNameCarriesSecret(key) || rawValue === '') continue;
    values[values.length] = rawValue;
    try {
      const decoded = loggingDecodeURIComponent(loggingReplaceAllLiteral(rawValue, '+', ' '));
      if (decoded !== '') values[values.length] = decoded;
    } catch {}
  }
  return uniqueDiagnosticStrings(values);
}

function sanitizeDiagnosticRequest(request: unknown): unknown {
  if (!isNativeRequest(request)) return request;

  try {
    const source = requestForAuthorityNeutralMetadata(request);
    const rawUrl = readDiagnosticRequestUrl(source);
    const parsed = loggingDiagnosticUrlParts(rawUrl);
    if (parsed === undefined) return undefined;
    const safeUrl = `${parsed.origin}${sanitizeDiagnosticUrl(rawUrl)}`;
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
  const descriptor = witnessGetOwnPropertyDescriptor(Request.prototype, property);
  const getter = descriptor ? witnessReflectGet(descriptor, 'get') : undefined;
  if (typeof getter !== 'function') {
    throw new TypeError(`The Web Request implementation lacks a ${property} getter.`);
  }
  return (request) => witnessReflectApply(getter, request, []) as Value;
}

function diagnosticRequestReferrer(value: string): string | undefined {
  if (value === '') return undefined;
  if (value === 'about:client') return value;
  const parsed = loggingDiagnosticUrlParts(value);
  return parsed === undefined ? undefined : `${parsed.origin}${sanitizeDiagnosticUrl(value)}`;
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
  const existing = witnessWeakMapGet(seen, object);
  if (existing !== undefined) return existing;

  if (isNativeRequest(value)) {
    const sanitized = sanitizeDiagnosticRequest(value);
    witnessWeakMapSet(seen, object, sanitized);
    return sanitized;
  }
  if (isNativeHeaders(value)) {
    const sanitized = createNativeHeaders();
    witnessWeakMapSet(seen, object, sanitized);
    return sanitized;
  }
  if (isNativeAbortSignal(value)) {
    try {
      const sanitized = authorityNeutralAbortSignal(value);
      witnessWeakMapSet(seen, object, sanitized);
      return sanitized;
    } catch {
      witnessWeakMapSet(seen, object, '[redacted]');
      return '[redacted]';
    }
  }
  if (
    hasNativeInstance(value, NativeURL) ||
    hasNativeInstance(value, NativeURLSearchParams) ||
    hasNativeInstance(value, NativeResponse) ||
    hasNativeInstance(value, NativeBlob)
  ) {
    witnessWeakMapSet(seen, object, '[redacted]');
    return '[redacted]';
  }

  if (isNativeError(value)) {
    const prototype = witnessGetPrototypeOf(value);
    const nativeName =
      prototype === null ? undefined : witnessMapGet(nativeErrorPrototypeNames, prototype);
    const name = diagnosticErrorString(value, 'name', nativeName ?? '[redacted]', requestInputs);
    const message = diagnosticErrorString(value, 'message', '', requestInputs);
    const stack = diagnosticErrorString(value, 'stack', undefined, requestInputs);
    const clone = new NativeError(message.value);
    clone.name = name.value ?? 'Error';
    if (stack.value !== undefined) clone.stack = stack.value;
    witnessWeakMapSet(seen, object, clone);
    let changed = nativeName === undefined || name.changed || message.changed || stack.changed;

    const keys = witnessOwnKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (key === 'name' || key === 'message' || key === 'stack') continue;
      const descriptor = witnessGetOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      if (typeof key !== 'string') {
        changed = true;
        continue;
      }
      const sanitizedKey = sanitizeDiagnosticString(key, requestInputs);
      const sanitized =
        'value' in descriptor
          ? sanitizeDiagnosticValue(descriptor.value, requestInputs, seen)
          : '[redacted]';
      witnessDefineProperty(clone, sanitizedKey, {
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
      witnessWeakMapSet(seen, object, value);
      return value;
    }
    return clone;
  }

  if (loggingIsArray(value)) {
    const next: unknown[] = [];
    witnessWeakMapSet(seen, object, next);
    let changed = false;
    const keys = witnessOwnKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (key === 'length') continue;
      const descriptor = witnessGetOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      if (typeof key !== 'string') {
        changed = true;
        continue;
      }
      const sanitizedKey = sanitizeDiagnosticString(key, requestInputs);
      const sanitized =
        'value' in descriptor
          ? sanitizeDiagnosticValue(descriptor.value, requestInputs, seen)
          : '[redacted]';
      witnessDefineProperty(next, sanitizedKey, {
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
      witnessWeakMapSet(seen, object, value);
      return value;
    }
    return next;
  }

  const prototype = witnessGetPrototypeOf(value);
  if (prototype !== nativeObjectPrototype && prototype !== null) {
    witnessWeakMapSet(seen, object, '[redacted]');
    return '[redacted]';
  }
  const next = (
    prototype === null
      ? witnessReflectApply<Record<PropertyKey, unknown>>(nativeObjectCreate, NativeObject, [null])
      : {}
  ) as Record<PropertyKey, unknown>;
  witnessWeakMapSet(seen, object, next);
  let changed = false;
  const keys = witnessOwnKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const descriptor = witnessGetOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if (typeof key !== 'string') {
      changed = true;
      continue;
    }
    const sanitizedKey = sanitizeDiagnosticString(key, requestInputs);
    const sanitized =
      'value' in descriptor
        ? sanitizeDiagnosticValue(descriptor.value, requestInputs, seen)
        : '[redacted]';
    witnessDefineProperty(next, sanitizedKey, {
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
    witnessWeakMapSet(seen, object, value);
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
  const descriptor = witnessGetOwnPropertyDescriptor(error, key);
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
  const secretValues = sortDiagnosticStringsByLength(inputs.secretValues);
  for (let index = 0; index < secretValues.length; index += 1) {
    const secretValue = secretValues[index]!;
    if (secretValue !== '') {
      sanitized = loggingReplaceAllLiteral(sanitized, secretValue, '[redacted]');
    }
  }
  return sanitized;
}

function reportServerErrorToStderr(error: unknown, context: ServerErrorDiagnosticContext): void {
  try {
    let details = `[kovo] ${context.operation} failed`;
    if (context.url !== undefined) details += ` url=${context.url}`;
    if (context.routePath !== undefined) details += ` route=${context.routePath}`;
    if (context.queryKey !== undefined) details += ` query=${context.queryKey}`;
    if (context.mutationKey !== undefined) details += ` mutation=${context.mutationKey}`;
    if (context.status !== undefined) details += ` status=${context.status}`;
    console.error(neutralizeLogValue(details), diagnosticLogValue(error));
  } catch (_diagnosticError) {
    void _diagnosticError;
    // Diagnostics must not change SPEC §9.2's stable server-error responses.
  }
}

function diagnosticLogValue(value: unknown): string {
  if (!isNativeError(value)) return neutralizeLogValue('[diagnostic value redacted]');
  const prototype = witnessGetPrototypeOf(value);
  const fallbackName =
    (prototype === null ? undefined : witnessMapGet(nativeErrorPrototypeNames, prototype)) ??
    'Error';
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

function isNativeError(value: unknown): value is Error {
  return hasNativeInstance(value, NativeError);
}

function hasNativeInstance(value: unknown, constructor: Function): boolean {
  try {
    return witnessReflectApply(nativeFunctionHasInstance, constructor, [value]) as boolean;
  } catch {
    return false;
  }
}

function appendDiagnosticStrings(target: string[], values: readonly string[]): void {
  for (let index = 0; index < values.length; index += 1) {
    target[target.length] = values[index]!;
  }
}

function uniqueDiagnosticStrings(values: readonly string[]): string[] {
  const unique: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (value === '') continue;
    let found = false;
    for (let candidate = 0; candidate < unique.length; candidate += 1) {
      if (unique[candidate] === value) {
        found = true;
        break;
      }
    }
    if (!found) unique[unique.length] = value;
  }
  return unique;
}

function sortDiagnosticStringsByLength(values: readonly string[]): string[] {
  const sorted: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    let insert = sorted.length;
    while (insert > 0 && sorted[insert - 1]!.length < value.length) {
      sorted[insert] = sorted[insert - 1]!;
      insert -= 1;
    }
    sorted[insert] = value;
  }
  return sorted;
}

function splitDiagnosticLiteral(value: string, separator: string): string[] {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor <= value.length) {
    const match = loggingStringIndexOf(value, separator, cursor);
    if (match < 0) {
      parts[parts.length] = loggingStringSlice(value, cursor);
      return parts;
    }
    parts[parts.length] = loggingStringSlice(value, cursor, match);
    cursor = match + separator.length;
  }
  return parts;
}

function unescapeDiagnosticCookieValue(value: string): string {
  let result = '';
  let cursor = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (loggingCharacterCodeAt(value, index) !== 0x5c || index + 1 >= value.length) continue;
    const next = loggingCharacterCodeAt(value, index + 1);
    if (next !== 0x22 && next !== 0x5c) continue;
    result += loggingStringSlice(value, cursor, index) + value[index + 1];
    cursor = index + 2;
    index += 1;
  }
  return cursor === 0 ? value : result + loggingStringSlice(value, cursor);
}

function diagnosticHeadersIteratorNext(): Function | undefined {
  if (typeof nativeHeadersEntries !== 'function') return undefined;
  try {
    const iterator = witnessReflectApply<IterableIterator<[string, string]>>(
      nativeHeadersEntries,
      new NativeHeaders(),
      [],
    );
    return iterator.next;
  } catch {
    return undefined;
  }
}

function diagnosticHeaderControlsAreSound(): boolean {
  if (
    typeof nativeHeadersEntries !== 'function' ||
    typeof nativeHeadersIteratorNext !== 'function'
  ) {
    return false;
  }
  try {
    const iterator = witnessReflectApply<IterableIterator<[string, string]>>(
      nativeHeadersEntries,
      new NativeHeaders({ 'x-kovo-probe': 'value' }),
      [],
    );
    const first = witnessReflectApply<IteratorResult<[string, string]>>(
      nativeHeadersIteratorNext,
      iterator,
      [],
    );
    const end = witnessReflectApply<IteratorResult<[string, string]>>(
      nativeHeadersIteratorNext,
      iterator,
      [],
    );
    return (
      first.done === false &&
      first.value[0] === 'x-kovo-probe' &&
      first.value[1] === 'value' &&
      end.done === true
    );
  } catch {
    return false;
  }
}
