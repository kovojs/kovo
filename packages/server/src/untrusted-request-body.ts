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
  requestJson,
  requestParseJson,
  requestReflectGet,
  requestRegisterFormDataProxy,
} from './request-body-intrinsics.js';
import {
  securityArrayIsArray,
  securityArrayJoin,
  securityArrayPush,
  securityObjectKeys,
  securityStringSplit,
  securityStringToLowerCase,
  securityStringTrim,
} from './response-security-intrinsics.js';
import { witnessGetOwnPropertyDescriptor, witnessProxy } from './security-witness-intrinsics.js';

const formDataIteratorSymbol = Symbol.iterator;

export type UntrustedRequestBodyCarrier = 'json' | 'form';

export type UntrustedRequestBodyFailureReason =
  | 'invalid-form'
  | 'invalid-json'
  | 'unsupported-content-type';

export type UntrustedRequestBodyResult =
  | { carrier: UntrustedRequestBodyCarrier; ok: true; value: unknown }
  | { ok: false; reason: UntrustedRequestBodyFailureReason };

export type UntrustedJsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'invalid-json' };

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
    try {
      return { carrier, ok: true, value: tagUntrustedRequestValue(await requestJson(request)) };
    } catch {
      return { ok: false, reason: 'invalid-json' };
    }
  }

  if (carrier === 'form') {
    try {
      return { carrier, ok: true, value: tagUntrustedRequestValue(await requestFormData(request)) };
    } catch {
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
  if (rawBody.byteLength === 0) return { ok: true, value: {} };

  try {
    return {
      ok: true,
      value: tagUntrustedRequestValue(requestParseJson(requestDecodeUtf8(rawBody))),
    };
  } catch {
    return { ok: false, reason: 'invalid-json' };
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
  if (requestIsFormData(value)) {
    return tagUntrustedFormData(value);
  }
  if (securityArrayIsArray(value)) {
    const tagged: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      securityArrayPush(tagged, tagUntrustedRequestValue(stableRecordValue(value, index)));
    }
    return tagged;
  }
  if (requestIsPlainRecord(value)) {
    const tagged = requestCreateNullRecord<unknown>() as Record<string, unknown>;
    const keys = securityObjectKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      tagged[key] = tagUntrustedRequestValue(stableRecordValue(value, key));
    }
    return tagged;
  }
  if (value === undefined) return value;
  return untrusted(value);
}

/** @internal SPEC §5.2 rule 11: reveal request provenance tags only after a validating choke. */
export function revealUntrustedRequestValue(value: unknown, reason: string): unknown {
  if (isUntrusted(value))
    return revealUntrustedRequestValue(revealUntrusted(value, reason), reason);
  if (requestIsFormData(value)) {
    const revealed = requestCreateFormData();
    const entries = requestFormDataEntries(value);
    for (let index = 0; index < entries.length; index += 1) {
      const pair = entries[index]!;
      const key = pair[0];
      const entry = pair[1];
      const entryValue = revealUntrustedRequestValue(entry, reason);
      if (typeof entryValue === 'string' || requestIsBlob(entryValue)) {
        requestFormDataAppend(revealed, key, entryValue);
      }
    }
    return revealed;
  }
  if (securityArrayIsArray(value)) {
    const revealed: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      securityArrayPush(
        revealed,
        revealUntrustedRequestValue(stableRecordValue(value, index), reason),
      );
    }
    return revealed;
  }
  if (requestIsPlainRecord(value)) {
    const revealed = requestCreateNullRecord<unknown>() as Record<string, unknown>;
    const keys = securityObjectKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      revealed[key] = revealUntrustedRequestValue(stableRecordValue(value, key), reason);
    }
    return revealed;
  }
  return value;
}

function stableRecordValue(value: object, property: PropertyKey): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError('Kovo request carriers require stable own data properties.');
  }
  return descriptor.value;
}

function tagUntrustedFormData(form: FormData): FormData {
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
  return proxy;
}

function tagUntrustedFormEntry(entry: FormDataEntryValue | null): FormDataEntryValue | null {
  if (entry === null || requestIsFile(entry)) return entry;
  return untrusted(entry) as unknown as FormDataEntryValue;
}
