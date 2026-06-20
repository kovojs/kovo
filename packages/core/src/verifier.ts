/** The raw request body a webhook verifier signs over: a string or raw bytes. */
export type WebhookPayload = string | ArrayBuffer | ArrayBufferView;

/** A single header value as seen by a verifier: a string, a list of strings, or absent. */
export type WebhookHeaderValue = null | string | readonly string[] | undefined;

/** The request headers a verifier reads, accepted as a `Headers`, a `Map`, a record, or any object exposing `get`. */
export type WebhookHeaders =
  | Headers
  | Map<string, string>
  | Record<string, WebhookHeaderValue>
  | { get(name: string): WebhookHeaderValue };

/** The inbound webhook request a verifier checks: its headers, raw payload, and an optional verification clock. */
export interface WebhookVerificationRequest {
  headers: WebhookHeaders;
  now?: Date | number;
  payload: WebhookPayload;
}

/** A configured webhook verifier: either an HMAC-signature verifier or a custom-scheme verifier. */
export type WebhookVerifier = HmacSignatureVerifier | CustomWebhookVerifier;

/** A verifier for a bespoke webhook scheme: a named scheme plus an async `verify` of the request. */
export interface CustomWebhookVerifier {
  kind: 'custom';
  name: string;
  scheme: string;
  verify(request: WebhookVerificationRequest): Promise<boolean>;
}

/** Encoding of an HMAC signature as it appears in the signature header. */
export type HmacSignatureEncoding = 'base64' | 'base64url' | 'hex';

/** A signing secret: a string, raw bytes, or a value with an explicit encoding. */
export type HmacSecret =
  | string
  | Uint8Array
  | {
      encoding?: 'base64' | 'base64url' | 'utf8';
      value: string | Uint8Array;
    };

/** Context passed to a custom payload builder: the signature header value and a header lookup. */
export interface HmacSignaturePayloadContext {
  header(name: string): string | undefined;
  signatureHeader: string;
}

/** What gets signed: the request payload directly, or a function that derives the signed bytes from the request and context. */
export type HmacSignaturePayload =
  | WebhookPayload
  | ((
      request: WebhookVerificationRequest,
      context: HmacSignaturePayloadContext,
    ) => Promise<WebhookPayload> | WebhookPayload);

/** Replay-protection window: the allowed clock skew in seconds plus how to read the request timestamp. */
export interface HmacSignatureTolerance {
  header?: string;
  seconds: number;
  timestamp?: (
    request: WebhookVerificationRequest,
    context: HmacSignaturePayloadContext,
  ) => number | string | undefined;
}

/** Whether a signature header may carry multiple candidate signatures, or a function that splits them out. */
export type HmacMultiSignature = boolean | ((signatureHeader: string) => readonly string[]);

/** Configuration for an HMAC-signature verifier: header, encoding, payload, secret(s), and optional tolerance and multi-signature handling. */
export interface HmacSignatureOptions {
  encoding: HmacSignatureEncoding;
  header: string;
  multiSig?: HmacMultiSignature;
  name?: string;
  payload: HmacSignaturePayload;
  scheme?: string;
  secret: HmacSecret | readonly HmacSecret[];
  /**
   * When `tolerance` is configured, the verifier automatically prepends
   * `${timestamp}.` to the signed bytes so a captured `(signature, body)` pair
   * cannot be replayed with a forged-fresh timestamp (SPEC §9.1.1:846 / B5).
   *
   * Set `timestampBound: false` only when your `payload` function already folds
   * the timestamp into the signed bytes — the preset recipes (`standardWebhooks`,
   * `timestampedProvider`) both do this and therefore set `false`.
   *
   * Defaults to `true` whenever `tolerance` is present.
   */
  timestampBound?: boolean;
  tolerance?: HmacSignatureTolerance;
}

/** The resolved, defaults-applied view of an HMAC verifier's configuration. */
export interface ResolvedHmacSignatureConfig {
  encoding: HmacSignatureEncoding;
  header: string;
  kind: 'hmac';
  multiSig: boolean;
  name: string;
  scheme: string;
  toleranceSeconds?: number;
}

/** A configured HMAC-signature verifier: its options, resolved config, and an async `verify` of the request. */
export interface HmacSignatureVerifier {
  config: HmacSignatureOptions;
  kind: 'hmac';
  name: string;
  resolved: ResolvedHmacSignatureConfig;
  scheme: string;
  verify(request: WebhookVerificationRequest): Promise<boolean>;
}

/** Options for the Standard Webhooks preset: the signing secret(s). */
export interface StandardWebhooksOptions {
  secret: HmacSecret | readonly HmacSecret[];
}

const defaultWebhookToleranceSeconds = 5 * 60;
const textEncoder = new TextEncoder();

/**
 * Build an HMAC webhook verifier that checks a signature header against the raw
 * payload bytes before any parsing — the default for machine endpoints (SPEC §9.1).
 * Provider-specific recipes can be written locally on top of this helper;
 * `standardWebhooks` remains the shared non-vendor preset.
 *
 * @param options - Secret(s), header name, encoding, payload derivation, and tolerance.
 * @returns An `HmacSignatureVerifier` with an async `verify`.
 * @example
 * import { hmacSignature } from '@kovojs/core';
 *
 * export const verifier = hmacSignature({
 *   encoding: 'hex',
 *   header: 'x-signature',
 *   payload: (request) => request.payload,
 *   secret: 'whsec_test',
 * });
 */
export function hmacSignature(options: HmacSignatureOptions): HmacSignatureVerifier {
  const name = options.name ?? 'hmac';
  const scheme = options.scheme ?? `hmac-sha256:${options.encoding}`;
  const resolved: ResolvedHmacSignatureConfig = {
    encoding: options.encoding,
    header: options.header,
    kind: 'hmac',
    multiSig: options.multiSig !== undefined && options.multiSig !== false,
    name,
    scheme,
    ...(options.tolerance === undefined ? {} : { toleranceSeconds: options.tolerance.seconds }),
  };

  return {
    config: options,
    kind: 'hmac',
    name,
    resolved,
    scheme,
    async verify(request) {
      return verifyHmacSignature(options, request);
    },
  };
}

/**
 * Wrap a custom verification function as a named webhook verifier, for schemes
 * that HMAC presets do not cover.
 *
 * @param name - Identifier recorded on the verifier and its `custom:<name>` scheme.
 * @param verify - Predicate over the raw request returning whether it is authentic.
 * @returns A `CustomWebhookVerifier`.
 * @example
 * import { customVerifier, type WebhookHeaders } from '@kovojs/core';
 *
 * function tokenFrom(headers: WebhookHeaders): string | undefined {
 *   if ('get' in headers && typeof headers.get === 'function') {
 *     const value = headers.get('x-token');
 *     return typeof value === 'string' ? value : undefined;
 *   }
 *   return undefined;
 * }
 *
 * export const verifier = customVerifier(
 *   'static-token',
 *   (request) => tokenFrom(request.headers) === 'expected',
 * );
 */
export function customVerifier(
  name: string,
  verify: (request: WebhookVerificationRequest) => Promise<boolean> | boolean,
): CustomWebhookVerifier {
  return {
    kind: 'custom',
    name,
    scheme: `custom:${name}`,
    async verify(request) {
      return verify(request);
    },
  };
}

/**
 * Preset HMAC verifier for the Standard Webhooks spec (`webhook-id`,
 * `webhook-timestamp`, `webhook-signature` headers).
 *
 * @param options - The Standard Webhooks signing secret(s).
 * @returns An `HmacSignatureVerifier` configured for Standard Webhooks.
 * @example
 * import { standardWebhooks } from '@kovojs/core';
 *
 * export const verifier = standardWebhooks({ secret: 'whsec_test' });
 */
export function standardWebhooks(options: StandardWebhooksOptions): HmacSignatureVerifier {
  return hmacSignature({
    encoding: 'base64',
    header: 'webhook-signature',
    multiSig: standardV1Signatures,
    name: 'standard-webhooks',
    payload: (request, context) => {
      const messageId = context.header('webhook-id');
      const timestamp = context.header('webhook-timestamp');
      if (messageId === undefined || timestamp === undefined) return '';
      return `${messageId}.${timestamp}.${payloadToString(request.payload)}`;
    },
    scheme: 'standard-webhooks:v1:hmac-sha256',
    secret: normalizeStandardWebhooksSecrets(options.secret),
    // timestamp is already embedded in the payload above; skip the automatic
    // timestamp-prefix folding that hmacSignature applies when tolerance is set.
    timestampBound: false,
    tolerance: {
      header: 'webhook-timestamp',
      seconds: defaultWebhookToleranceSeconds,
    },
  });
}

async function verifyHmacSignature(
  options: HmacSignatureOptions,
  request: WebhookVerificationRequest,
): Promise<boolean> {
  const signatureHeader = getHeader(request.headers, options.header);
  if (signatureHeader === undefined || signatureHeader.length === 0) return false;

  const context: HmacSignaturePayloadContext = {
    header: (name) => getHeader(request.headers, name),
    signatureHeader,
  };

  if (!isWithinTolerance(options.tolerance, request, context)) return false;

  const signedPayload =
    typeof options.payload === 'function'
      ? await options.payload(request, context)
      : options.payload;

  // SPEC §9.1.1:846 (B5): when `tolerance` is configured and the caller has not
  // explicitly opted out via `timestampBound: false`, fold the timestamp into the
  // signed bytes so a captured (signature, body) cannot be replayed with a forged-
  // fresh timestamp header. Preset recipes that already embed the timestamp in their
  // payload function set `timestampBound: false` to avoid double-binding.
  let signedPayloadBytes: Uint8Array;
  if (options.tolerance !== undefined && options.timestampBound !== false) {
    const timestampValue =
      options.tolerance.timestamp?.(request, context) ??
      (options.tolerance.header === undefined
        ? undefined
        : getHeader(request.headers, options.tolerance.header));
    const prefix = timestampValue !== undefined ? `${timestampValue}.` : '';
    const prefixBytes = textEncoder.encode(prefix);
    const payloadBytes = payloadToBytes(signedPayload);
    signedPayloadBytes = new Uint8Array(prefixBytes.length + payloadBytes.length);
    signedPayloadBytes.set(prefixBytes, 0);
    signedPayloadBytes.set(payloadBytes, prefixBytes.length);
  } else {
    signedPayloadBytes = payloadToBytes(signedPayload);
  }
  const signatures = parseSignatures(options.multiSig, signatureHeader)
    .map((signature) => decodeSignature(signature, options.encoding))
    .filter((signature): signature is Uint8Array => signature !== undefined);
  if (signatures.length === 0) return false;

  const secrets = Array.isArray(options.secret) ? options.secret : [options.secret];
  for (const secret of secrets) {
    const expected = await hmacSha256(secretToBytes(secret), signedPayloadBytes);
    for (const signature of signatures) {
      if (constantTimeEqual(expected, signature)) return true;
    }
  }

  return false;
}

function parseSignatures(
  multiSig: HmacMultiSignature | undefined,
  header: string,
): readonly string[] {
  if (typeof multiSig === 'function') return multiSig(header);
  if (multiSig === true) return header.split(/[,\s]+/u).filter(Boolean);
  return [header];
}

function standardV1Signatures(header: string): readonly string[] {
  const signatures: string[] = [];
  for (const versionedSignature of header.split(/\s+/u)) {
    const [version, signature] = versionedSignature.split(',', 2);
    if (version === 'v1' && signature !== undefined && signature.length > 0) {
      signatures.push(signature);
    }
  }
  return signatures;
}

function normalizeStandardWebhooksSecrets(
  secrets: HmacSecret | readonly HmacSecret[],
): HmacSecret | readonly HmacSecret[] {
  if (Array.isArray(secrets)) {
    return (secrets as readonly HmacSecret[]).map(normalizeStandardWebhooksSecret);
  }
  return normalizeStandardWebhooksSecret(secrets as HmacSecret);
}

function normalizeStandardWebhooksSecret(secret: HmacSecret): HmacSecret {
  if (typeof secret === 'string') {
    return { encoding: 'base64', value: secret.replace(/^whsec_/u, '') };
  }
  if (secret instanceof Uint8Array) return secret;
  if (typeof secret.value === 'string' && secret.encoding === undefined) {
    return { encoding: 'base64', value: secret.value.replace(/^whsec_/u, '') };
  }
  return secret;
}

function isWithinTolerance(
  tolerance: HmacSignatureTolerance | undefined,
  request: WebhookVerificationRequest,
  context: HmacSignaturePayloadContext,
): boolean {
  if (tolerance === undefined) return true;

  const timestampValue =
    tolerance.timestamp?.(request, context) ??
    (tolerance.header === undefined ? undefined : getHeader(request.headers, tolerance.header));
  const timestamp = parseTimestampSeconds(timestampValue);
  if (timestamp === undefined) return false;

  const now = request.now instanceof Date ? request.now.getTime() : (request.now ?? Date.now());
  const nowSeconds = Math.floor(now / 1000);
  return Math.abs(nowSeconds - timestamp) <= tolerance.seconds;
}

function parseTimestampSeconds(value: number | string | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (value === undefined || !/^-?\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function getHeader(headers: WebhookHeaders, name: string): string | undefined {
  const get =
    'get' in headers && typeof headers.get === 'function' ? headers.get.bind(headers) : undefined;
  const direct = get?.(name) ?? get?.(name.toLowerCase()) ?? get?.(name.toUpperCase());
  if (direct !== undefined && direct !== null) return normalizeHeaderValue(direct);

  if (headers instanceof Headers || headers instanceof Map) return undefined;

  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return normalizeHeaderValue(value);
  }

  return undefined;
}

function normalizeHeaderValue(value: Exclude<WebhookHeaderValue, null | undefined>): string {
  return typeof value === 'string' ? value : value.join(',');
}

function payloadToString(payload: WebhookPayload): string {
  if (typeof payload === 'string') return payload;
  return new TextDecoder().decode(payloadToBytes(payload));
}

function payloadToBytes(payload: WebhookPayload): Uint8Array {
  if (typeof payload === 'string') return textEncoder.encode(payload);
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
}

function secretToBytes(secret: HmacSecret): Uint8Array {
  if (typeof secret === 'string') return textEncoder.encode(secret);
  if (secret instanceof Uint8Array) return secret;
  if (secret.value instanceof Uint8Array) return secret.value;

  switch (secret.encoding ?? 'utf8') {
    case 'base64':
      return base64ToBytes(secret.value);
    case 'base64url':
      return base64ToBytes(secret.value.replace(/-/gu, '+').replace(/_/gu, '/'));
    case 'utf8':
      return textEncoder.encode(secret.value);
  }
}

function decodeSignature(
  signature: string,
  encoding: HmacSignatureEncoding,
): Uint8Array | undefined {
  try {
    switch (encoding) {
      case 'base64':
        return base64ToBytes(signature);
      case 'base64url':
        return base64ToBytes(signature.replace(/-/gu, '+').replace(/_/gu, '/'));
      case 'hex':
        return hexToBytes(signature);
    }
  } catch {
    return undefined;
  }
}

function base64ToBytes(value: string): Uint8Array {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  const binary = globalThis.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function hexToBytes(value: string): Uint8Array | undefined {
  if (value.length % 2 !== 0 || !/^[\da-f]*$/iu.test(value)) return undefined;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function hmacSha256(secret: Uint8Array, payload: Uint8Array): Promise<Uint8Array> {
  const secretBytes = copyBytes(secret);
  const payloadBytes = copyBytes(payload);
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    secretBytes,
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, payloadBytes);
  return new Uint8Array(signature);
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}
