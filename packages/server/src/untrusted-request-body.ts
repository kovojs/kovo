import { isUntrusted, revealUntrusted, untrusted } from '@kovojs/core';

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
export function readUntrustedRequestHeader(request: Request, name: string): unknown | undefined {
  const value = request.headers.get(name);
  return value === null ? undefined : untrusted(value);
}

/**
 * @internal Read a request cookie through Kovo's DX-only untrusted provenance tag.
 * The returned value must be revealed only by the validation choke that consumes it.
 */
export function readUntrustedCookieValue(request: Request, name: string): unknown | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;

  for (const cookie of header.split(';')) {
    const [rawName, ...rawValue] = cookie.trim().split('=');
    if (rawName !== name) continue;
    const value = rawValue.join('=');
    try {
      return untrusted(decodeURIComponent(value));
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
  const carrier = requestBodyCarrier(request.headers.get('content-type'));

  if (carrier === 'json') {
    try {
      return { carrier, ok: true, value: tagUntrustedRequestValue(await request.json()) };
    } catch {
      return { ok: false, reason: 'invalid-json' };
    }
  }

  if (carrier === 'form') {
    try {
      return { carrier, ok: true, value: tagUntrustedRequestValue(await request.formData()) };
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
      value: tagUntrustedRequestValue(JSON.parse(new TextDecoder().decode(rawBody))),
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
  const result = await readUntrustedRequestBody(request.clone());
  if (!result.ok) return {};
  if (result.carrier === 'json' && !isObjectLike(result.value)) return {};
  return result.value;
}

function requestBodyCarrier(
  contentTypeHeader: string | null,
): UntrustedRequestBodyCarrier | undefined {
  const contentType = contentTypeHeader?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) return 'json';
  if (
    contentType === '' ||
    contentType.includes('multipart/form-data') ||
    contentType.includes('application/x-www-form-urlencoded')
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
  if (value instanceof FormData) {
    return tagUntrustedFormData(value);
  }
  if (Array.isArray(value)) return value.map((item) => tagUntrustedRequestValue(item));
  if (isPlainRecord(value)) {
    const tagged = Object.create(null) as Record<string, unknown>;
    for (const [key, entry] of Object.entries(value)) {
      tagged[key] = tagUntrustedRequestValue(entry);
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
  if (value instanceof FormData) {
    const revealed = new FormData();
    for (const [key, entry] of value.entries()) {
      const entryValue = revealUntrustedRequestValue(entry, reason);
      if (typeof entryValue === 'string' || entryValue instanceof Blob) {
        revealed.append(key, entryValue);
      }
    }
    return revealed;
  }
  if (Array.isArray(value)) return value.map((entry) => revealUntrustedRequestValue(entry, reason));
  if (isPlainRecord(value)) {
    const revealed: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      revealed[key] = revealUntrustedRequestValue(entry, reason);
    }
    return revealed;
  }
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function tagUntrustedFormData(form: FormData): FormData {
  return new Proxy(form, {
    get(target, property, receiver) {
      if (property === 'get') {
        return (name: string) => tagUntrustedFormEntry(target.get(name));
      }
      if (property === 'getAll') {
        return (name: string) => target.getAll(name).map(tagUntrustedFormEntry);
      }
      if (property === 'entries' || property === Symbol.iterator) {
        return function* entries(): IterableIterator<[string, FormDataEntryValue]> {
          for (const [key, entry] of target.entries()) {
            yield [key, tagUntrustedFormEntry(entry) as FormDataEntryValue];
          }
        };
      }
      if (property === 'values') {
        return function* values(): IterableIterator<FormDataEntryValue> {
          for (const entry of target.values()) {
            yield tagUntrustedFormEntry(entry) as FormDataEntryValue;
          }
        };
      }

      const member = Reflect.get(target, property, receiver);
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
}

function tagUntrustedFormEntry(entry: FormDataEntryValue | null): FormDataEntryValue | null {
  if (entry === null || entry instanceof File) return entry;
  return untrusted(entry) as unknown as FormDataEntryValue;
}
