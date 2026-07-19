import { isUntrusted, revealUntrusted, untrusted } from '@kovojs/core';

import {
  requestApply,
  requestClone,
  requestCreateFormData,
  requestCreateNullRecord,
  requestDecodeURIComponent,
  requestDecodeUtf8,
  requestFormData,
  requestFormDataAppend,
  requestFormDataEntries,
  requestFormDataGet,
  requestFormDataGetAll,
  requestFormDataValues,
  requestHeader,
  requestIsBlob,
  requestIsFile,
  requestIsFormData,
  requestIsPlainRecord,
  requestIterableIterator,
  requestInputShapeBudgetExceeded,
  requestJson,
  requestParseJson,
  requestReflectGet,
  requestRegisterFormDataProxy,
} from './request-body-intrinsics.js';
import {
  revealRequestProvenanceContainer,
  tagRequestProvenanceValue,
} from './request-body-provenance.js';
import {
  securityArrayIsArray,
  securityArrayJoin,
  securityArrayPush,
  securityObjectKeys,
  securityStringSplit,
  securityStringToLowerCase,
  securityStringTrim,
  securityUint8ArrayLength,
} from './response-security-intrinsics.js';
import { assertShapeWithinBudget, isShapeBudgetError } from './schema.js';
import {
  createWitnessWeakMap,
  witnessDefineProperty,
  witnessGetOwnPropertyDescriptor,
  witnessObjectIs,
  witnessProxy,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

const formDataIteratorSymbol = Symbol.iterator;
const untrustedFormDataProxies = createWitnessWeakMap<object, FormData>();

export type UntrustedRequestBodyCarrier = 'json' | 'form';

export type UntrustedRequestBodyFailureReason =
  | 'invalid-form'
  | 'invalid-json'
  | 'shape-budget'
  | 'unsupported-content-type';

export type UntrustedRequestBodyResult =
  | { carrier: UntrustedRequestBodyCarrier; ok: true; value: unknown }
  | { ok: false; reason: UntrustedRequestBodyFailureReason };

export type UntrustedJsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'invalid-json' | 'shape-budget' };

/**
 * @internal SPEC §5.2 rule 11 / fundamental-fixes-followup-3 DEC-D: request header
 * values are attacker-controlled provenance for diagnostics. Native `Request.headers`
 * remains the platform API; Kovo-owned accessors tag the value before validation reveals it.
 */
export function readUntrustedRequestHeader(request: Request, name: string): unknown {
  const value = requestHeader(request, name);
  return value === null ? undefined : untrusted(value);
}

/**
 * @internal Read a request cookie through Kovo's DX-only untrusted provenance tag.
 * The returned value must be revealed only by the validation choke that consumes it.
 */
export function readUntrustedCookieValue(request: Request, name: string): unknown {
  const header = requestHeader(request, 'cookie');
  if (!header) return undefined;

  const cookies = securityStringSplit(header, ';');
  for (let cookieIndex = 0; cookieIndex < cookies.length; cookieIndex += 1) {
    const parts = securityStringSplit(securityStringTrim(cookies[cookieIndex]!), '=');
    const rawName = parts[0];
    if (rawName !== name) continue;
    const rawValue: string[] = [];
    for (let partIndex = 1; partIndex < parts.length; partIndex += 1) {
      securityArrayPush(rawValue, parts[partIndex]!);
    }
    const value = securityArrayJoin(rawValue, '=');
    try {
      return untrusted(requestDecodeURIComponent(value));
    } catch {
      return untrusted(value);
    }
  }

  return undefined;
}

/**
 * SPEC §9.2: attacker-controlled mutation/endpoint bodies are expected client
 * input. Parse failures return typed outcomes so callers can choose their local
 * fail-closed response shape without routing malformed bodies through onError.
 */
export async function readUntrustedRequestBody(
  request: Request,
): Promise<UntrustedRequestBodyResult> {
  const carrier = requestBodyCarrier(requestHeader(request, 'content-type'));

  if (carrier === 'json') {
    let decoded: unknown;
    try {
      decoded = await requestJson(request);
    } catch {
      return { ok: false, reason: 'invalid-json' };
    }
    if (!requestShapeIsWithinBudget(decoded)) return { ok: false, reason: 'shape-budget' };
    return { carrier, ok: true, value: tagUntrustedRequestValue(decoded) };
  }

  if (carrier === 'form') {
    try {
      return { carrier, ok: true, value: tagUntrustedRequestValue(await requestFormData(request)) };
    } catch (error) {
      if (requestInputShapeBudgetExceeded(error)) return { ok: false, reason: 'shape-budget' };
      return { ok: false, reason: 'invalid-form' };
    }
  }

  return { ok: false, reason: 'unsupported-content-type' };
}

/**
 * SPEC §9.1: webhook verification owns raw-byte capture, but JSON decode still
 * routes through the same untrusted-body parser choke as browser mutation and
 * endpoint CSRF bodies.
 */
export function parseUntrustedJsonBodyBytes(rawBody: Uint8Array): UntrustedJsonBodyResult {
  if (securityUint8ArrayLength(rawBody) === 0) return { ok: true, value: {} };

  let decoded: unknown;
  try {
    decoded = requestParseJson(requestDecodeUtf8(rawBody));
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  if (!requestShapeIsWithinBudget(decoded)) return { ok: false, reason: 'shape-budget' };
  return { ok: true, value: tagUntrustedRequestValue(decoded) };
}

function requestShapeIsWithinBudget(value: unknown): boolean {
  try {
    assertShapeWithinBudget(value);
    return true;
  } catch (error) {
    if (isShapeBudgetError(error)) return false;
    throw error;
  }
}

/**
 * SPEC §6.6/§9.1: endpoint CSRF validation may inspect only a clone of the
 * request body so protected raw handlers receive the original stream. Parse
 * failures and non-record JSON cannot carry the named token field, so they map
 * to `{}` and fail through the normal synchronizer-token path.
 */
export async function readCsrfCarrierFromRequest(request: Request): Promise<unknown> {
  const result = await readUntrustedRequestBody(requestClone(request));
  if (!result.ok) return {};
  if (result.carrier === 'json' && !isObjectLike(result.value)) return {};
  return result.value;
}

function requestBodyCarrier(
  contentTypeHeader: string | null,
): UntrustedRequestBodyCarrier | undefined {
  const contentType = contentTypeHeader === null ? '' : contentTypeHeader;
  const mediaType = securityStringToLowerCase(
    securityStringTrim(securityStringSplit(contentType, ';')[0] ?? ''),
  );
  if (mediaType === 'application/json') return 'json';
  if (
    mediaType === '' ||
    mediaType === 'multipart/form-data' ||
    mediaType === 'application/x-www-form-urlencoded'
  ) {
    return 'form';
  }
  return undefined;
}

function isObjectLike(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/** @internal SPEC §5.2 rule 11 / DEC-D: request input tags are DX provenance, not enforcement. */
export function tagUntrustedRequestValue(value: unknown): unknown {
  return tagRequestProvenanceValue(value, tagUntrustedRequestLeaf);
}

/** @internal SPEC §5.2 rule 11: reveal request provenance tags only after a validating choke. */
export function revealUntrustedRequestValue(value: unknown, reason: string): unknown {
  const seen = createWitnessWeakMap<object, object>();
  const frames: RevealFrame[] = [];
  const root = materializeRevealedRequestValue(value, reason, seen, frames);

  while (frames.length > 0) {
    const frame = popRevealFrame(frames);
    if (frame === undefined) break;
    if (frame.index >= frame.length) continue;

    const property: PropertyKey = frame.array ? frame.index : frame.keys[frame.index]!;
    frame.index += 1;
    securityArrayPush(frames, frame);
    const child = materializeRevealedRequestValue(
      stableRecordValue(frame.source, property),
      reason,
      seen,
      frames,
    );
    if (frame.array) {
      securityArrayPush(frame.target as unknown[], child);
    } else {
      witnessDefineProperty(frame.target, property, {
        configurable: true,
        enumerable: true,
        value: child,
        writable: true,
      });
    }
  }

  return root;
}

interface RevealFrame {
  readonly array: boolean;
  readonly keys: readonly string[];
  readonly length: number;
  readonly source: object;
  readonly target: Record<PropertyKey, unknown> | unknown[];
  index: number;
}

function materializeRevealedRequestValue(
  value: unknown,
  reason: string,
  seen: WeakMap<object, object>,
  frames: RevealFrame[],
): unknown {
  value = revealRequestValue(value, reason);
  if (requestIsFormData(value)) return revealUntrustedFormData(value, reason);
  if (!securityArrayIsArray(value) && !requestIsPlainRecord(value)) return value;

  const cached = witnessWeakMapGet(seen, value);
  if (cached !== undefined) return cached;
  const array = securityArrayIsArray(value);
  const target = array ? [] : (requestCreateNullRecord<unknown>() as Record<PropertyKey, unknown>);
  witnessWeakMapSet(seen, value, target);
  const keys = array ? [] : securityObjectKeys(value);
  securityArrayPush(frames, {
    array,
    index: 0,
    keys,
    length: array ? stableArrayLength(value as unknown[]) : keys.length,
    source: value,
    target,
  });
  return target;
}

function revealRequestValue(value: unknown, reason: string): unknown {
  for (let depth = 0; depth < 16; depth += 1) {
    if (isUntrusted(value)) {
      value = revealUntrusted(value, reason);
      continue;
    }
    return revealRequestProvenanceContainer(value);
  }
  throw new TypeError('Kovo refused an unbounded request provenance carrier.');
}

function revealUntrustedFormData(value: FormData, reason: string): FormData {
  const revealed = requestCreateFormData();
  const entries = requestFormDataEntries(value);
  for (let index = 0; index < entries.length; index += 1) {
    const pair = entries[index]!;
    const entryValue = revealRequestValue(pair[1], reason);
    if (typeof entryValue === 'string' || requestIsBlob(entryValue)) {
      requestFormDataAppend(revealed, pair[0], entryValue);
    }
  }
  return revealed;
}

function tagUntrustedRequestLeaf(value: unknown): unknown {
  if (requestIsFormData(value)) return tagUntrustedFormData(value);
  if (value === undefined) return value;
  return untrusted(value);
}

function stableRecordValue(value: object, property: PropertyKey): unknown {
  const before = witnessGetOwnPropertyDescriptor(value, property);
  const after = witnessGetOwnPropertyDescriptor(value, property);
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value) ||
    before.configurable !== after.configurable ||
    before.enumerable !== after.enumerable ||
    before.writable !== after.writable
  ) {
    throw new TypeError('Kovo request carriers require stable own data properties.');
  }
  return before.value;
}

function stableArrayLength(value: readonly unknown[]): number {
  const descriptor = witnessGetOwnPropertyDescriptor(value, 'length');
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'number'
  ) {
    throw new TypeError('Kovo request carriers require stable own data properties.');
  }
  return descriptor.value;
}

function popRevealFrame(frames: RevealFrame[]): RevealFrame | undefined {
  if (frames.length === 0) return undefined;
  const index = frames.length - 1;
  const descriptor = witnessGetOwnPropertyDescriptor(frames, index);
  frames.length = index;
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError('Kovo request carriers require stable own data properties.');
  }
  return descriptor.value;
}

function tagUntrustedFormData(form: FormData): FormData {
  const existing = witnessWeakMapGet(untrustedFormDataProxies, form);
  if (existing !== undefined) return existing;
  const proxy = witnessProxy(form, {
    get(target, property, receiver) {
      if (property === 'get') {
        return (name: string) => tagUntrustedFormEntry(requestFormDataGet(target, name));
      }
      if (property === 'getAll') {
        return (name: string) => {
          const entries = requestFormDataGetAll(target, name);
          const tagged: FormDataEntryValue[] = [];
          for (let index = 0; index < entries.length; index += 1) {
            securityArrayPush(tagged, tagUntrustedFormEntry(entries[index]!)!);
          }
          return tagged;
        };
      }
      if (property === 'entries' || property === formDataIteratorSymbol) {
        return function entries(): IterableIterator<[string, FormDataEntryValue]> {
          const source = requestFormDataEntries(target);
          const tagged: [string, FormDataEntryValue][] = [];
          for (let index = 0; index < source.length; index += 1) {
            const pair = source[index]!;
            const key = pair[0];
            const entry = pair[1];
            securityArrayPush(tagged, [key, tagUntrustedFormEntry(entry)!]);
          }
          return requestIterableIterator(tagged);
        };
      }
      if (property === 'values') {
        return function values(): IterableIterator<FormDataEntryValue> {
          const source = requestFormDataValues(target);
          const tagged: FormDataEntryValue[] = [];
          for (let index = 0; index < source.length; index += 1) {
            securityArrayPush(tagged, tagUntrustedFormEntry(source[index]!)!);
          }
          return requestIterableIterator(tagged);
        };
      }
      if (property === 'forEach') {
        return function forEach(
          callback: (value: FormDataEntryValue, key: string, parent: FormData) => void,
          thisArg?: unknown,
        ): void {
          if (typeof callback !== 'function') {
            throw new TypeError('FormData.forEach requires a callback function.');
          }
          const source = requestFormDataEntries(target);
          for (let index = 0; index < source.length; index += 1) {
            const pair = source[index]!;
            // SPEC §9.2 KV430: callback reads cross the same lazy scalar membrane as get()/the
            // iterators, and the callback's carrier is the visible proxy rather than the raw
            // validation snapshot.
            requestApply(callback, thisArg, [tagUntrustedFormEntry(pair[1])!, pair[0], proxy]);
          }
        };
      }
      if (property === 'append') {
        return (name: string, value: string | Blob, filename?: string) =>
          requestFormDataAppend(target, name, value, filename);
      }

      const member = requestReflectGet(target, property, receiver);
      return typeof member === 'function'
        ? (...args: unknown[]) => requestApply(member, target, args)
        : member;
    },
  });
  requestRegisterFormDataProxy(proxy, form);
  witnessWeakMapSet(untrustedFormDataProxies, form, proxy);
  witnessWeakMapSet(untrustedFormDataProxies, proxy, proxy);
  return proxy;
}

function tagUntrustedFormEntry(entry: FormDataEntryValue | null): FormDataEntryValue | null {
  if (entry === null || requestIsFile(entry)) return entry;
  return untrusted(entry) as unknown as FormDataEntryValue;
}
