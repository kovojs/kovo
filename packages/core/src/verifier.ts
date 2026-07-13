import {
  freezeSecurityValue,
  securityArrayAppend,
  securityApply,
  securityGetOwnPropertyDescriptor,
  securityHasInstance,
  securityIsArray,
  securityIsMap,
  securityMapGet,
  securityObjectKeys,
  securityRegExpTest,
  securityStringCharCodeAt,
  securityStringSlice,
  securityStringToLowerCase,
  securityStringToUpperCase,
  securityWeakSet,
  securityWeakSetAdd,
  securityWeakSetHas,
} from '#security-witness-intrinsics';

const IntrinsicArrayBuffer = ArrayBuffer;
const IntrinsicDate = Date;
const IntrinsicHeaders = globalThis.Headers;
const IntrinsicTextDecoder = TextDecoder;
const IntrinsicTextEncoder = TextEncoder;
const IntrinsicUint8Array = Uint8Array;
const intrinsicAtob = globalThis.atob;
const hmacTextEncoder = new IntrinsicTextEncoder();
const hmacTextDecoder = new IntrinsicTextDecoder();
const intrinsicTextEncoderEncode = IntrinsicTextEncoder.prototype.encode;
const intrinsicTextDecoderDecode = IntrinsicTextDecoder.prototype.decode;
const intrinsicUint8ArraySet = IntrinsicUint8Array.prototype.set;
const intrinsicHeadersGet = IntrinsicHeaders?.prototype.get;
const intrinsicDateGetTime = IntrinsicDate.prototype.getTime;
const intrinsicDateNow = IntrinsicDate.now;
const capturedSubtleCrypto = globalThis.crypto?.subtle;
const capturedSubtleImportKey = capturedSubtleCrypto?.importKey;
const capturedSubtleSign = capturedSubtleCrypto?.sign;
const capturedHmacByteControlsSound = verifyCapturedHmacByteControls();
const capturedVerifierScalarControlsSound = verifyCapturedVerifierScalarControls();
const capturedHmacCryptoControl = verifyCapturedHmacCryptoControls();

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

/**
 * HMAC signing material: a string, raw bytes, or a value with an explicit encoding.
 *
 * {@link hmacSignature} validates the decoded value at construction and rejects material shorter
 * than 32 bytes (SPEC §6.6). The type is author-time ergonomics; the runtime constructor remains
 * the security boundary, so JavaScript callers and casts cannot bypass the strength floor.
 */
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
  /** Whole seconds from 0 through 86,400 (24 hours); larger windows are not clock-skew tolerance. */
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
  timestampBinding: 'automatic' | 'none' | 'payload';
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
const minimumHmacSecretBytes = 32;
// A timestamp tolerance is clock-skew protection, not an event-retention policy. One day is a
// deliberately generous ceiling that accommodates badly skewed integrations without making a
// captured signature valid indefinitely (SPEC §9.1 verifier replay protection).
const maximumWebhookToleranceSeconds = 24 * 60 * 60;
const frameworkHmacSignatureVerifiers = securityWeakSet<object>();
// Module-private authority used only by framework presets whose provider protocol fixes the
// timestamp at a non-prefix position in the signed payload. App code cannot mint or import this
// sentinel, so public hmacSignature() always owns timestamp binding when tolerance is configured.
const payloadBindsTimestamp = Symbol('kovo.hmac.payload-binds-timestamp');
type HmacTimestampBinding = typeof payloadBindsTimestamp | undefined;

/** @internal Unforgeable provenance check for framework-constructed HMAC verifiers. */
export function isFrameworkHmacSignatureVerifier(value: unknown): value is HmacSignatureVerifier {
  return (
    typeof value === 'object' &&
    value !== null &&
    securityWeakSetHas(frameworkHmacSignatureVerifiers, value)
  );
}

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
 *   secret: '0123456789abcdef0123456789abcdef',
 * });
 */
export function hmacSignature(options: HmacSignatureOptions): HmacSignatureVerifier {
  return createHmacSignature(options);
}

function createHmacSignature(
  options: HmacSignatureOptions,
  timestampBinding?: HmacTimestampBinding,
): HmacSignatureVerifier {
  // SPEC §9.1 verifier-before-parse is a security boundary. Keep the executable
  // verifier on a private semantic snapshot so later writes through either the
  // caller-owned options object or the public audit config cannot change which
  // bytes, secrets, or timestamp posture authenticate an already-declared app.
  const runtimeOptions = snapshotHmacSignatureOptions(options);
  const config = snapshotHmacSignatureOptions(runtimeOptions);
  const name = runtimeOptions.name ?? 'hmac';
  const scheme = runtimeOptions.scheme ?? `hmac-sha256:${runtimeOptions.encoding}`;
  const resolved: ResolvedHmacSignatureConfig = freezeSecurityValue({
    encoding: runtimeOptions.encoding,
    header: runtimeOptions.header,
    kind: 'hmac',
    multiSig: runtimeOptions.multiSig !== undefined && runtimeOptions.multiSig !== false,
    name,
    scheme,
    timestampBinding:
      runtimeOptions.tolerance === undefined
        ? 'none'
        : timestampBinding === payloadBindsTimestamp
          ? 'payload'
          : 'automatic',
    ...(runtimeOptions.tolerance === undefined
      ? {}
      : { toleranceSeconds: runtimeOptions.tolerance.seconds }),
  });

  const verifier: HmacSignatureVerifier = {
    config,
    kind: 'hmac',
    name,
    resolved,
    scheme,
    async verify(request: WebhookVerificationRequest) {
      return verifyHmacSignature(runtimeOptions, request, timestampBinding);
    },
  };
  securityWeakSetAdd(frameworkHmacSignatureVerifiers, verifier);
  return freezeSecurityValue(verifier);
}

function snapshotHmacSignatureOptions(options: HmacSignatureOptions): HmacSignatureOptions {
  const sourceTolerance = options.tolerance;
  const tolerance =
    sourceTolerance === undefined ? undefined : snapshotHmacSignatureTolerance(sourceTolerance);
  return freezeSecurityValue({
    encoding: options.encoding,
    header: options.header,
    ...(options.multiSig === undefined ? {} : { multiSig: options.multiSig }),
    ...(options.name === undefined ? {} : { name: options.name }),
    payload: snapshotWebhookPayload(options.payload),
    ...(options.scheme === undefined ? {} : { scheme: options.scheme }),
    secret: snapshotHmacSecrets(options.secret),
    ...(tolerance === undefined ? {} : { tolerance }),
  });
}

function snapshotHmacSignatureTolerance(tolerance: HmacSignatureTolerance): HmacSignatureTolerance {
  const header = tolerance.header;
  const seconds = tolerance.seconds;
  const timestamp = tolerance.timestamp;
  if (
    typeof seconds !== 'number' ||
    !isFiniteNumber(seconds) ||
    seconds % 1 !== 0 ||
    seconds < 0 ||
    seconds > maximumWebhookToleranceSeconds
  ) {
    throw new TypeError(
      `HMAC signature tolerance.seconds must be a whole number from 0 through ${maximumWebhookToleranceSeconds}.`,
    );
  }
  if (header !== undefined && typeof header !== 'string') {
    throw new TypeError('HMAC signature tolerance.header must be a string when provided.');
  }
  if (timestamp !== undefined && typeof timestamp !== 'function') {
    throw new TypeError('HMAC signature tolerance.timestamp must be a function when provided.');
  }
  return freezeSecurityValue({
    ...(header === undefined ? {} : { header }),
    seconds,
    ...(timestamp === undefined ? {} : { timestamp }),
  });
}

function snapshotWebhookPayload(payload: HmacSignaturePayload): HmacSignaturePayload {
  if (typeof payload === 'function' || typeof payload === 'string') return payload;
  if (securityHasInstance(IntrinsicArrayBuffer, payload)) {
    return copyBytes(new IntrinsicUint8Array(payload as ArrayBuffer));
  }
  const view = payload as ArrayBufferView;
  return copyBytes(new IntrinsicUint8Array(view.buffer, view.byteOffset, view.byteLength));
}

function snapshotHmacSecrets(
  secret: HmacSignatureOptions['secret'],
): HmacSignatureOptions['secret'] {
  if (securityIsArray(secret)) {
    if (secret.length === 0) {
      throw new TypeError('HMAC signature configuration requires at least one signing secret.');
    }
    const snapshot: HmacSecret[] = [];
    for (let index = 0; index < secret.length; index += 1) {
      const descriptor = securityGetOwnPropertyDescriptor(secret, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError('HMAC secret arrays require stable own-data entries.');
      }
      securityArrayAppend(snapshot, snapshotHmacSecret(descriptor.value as HmacSecret));
    }
    return freezeSecurityValue(snapshot);
  }
  return snapshotHmacSecret(secret as HmacSecret);
}

function snapshotHmacSecret(secret: HmacSecret): HmacSecret {
  let snapshot: HmacSecret;
  if (typeof secret === 'string') {
    snapshot = secret;
  } else if (securityHasInstance(IntrinsicUint8Array, secret)) {
    snapshot = copyBytes(secret as Uint8Array);
  } else {
    const encoded = secret as Exclude<HmacSecret, string | Uint8Array>;
    const encoding = encoded.encoding;
    const value = encoded.value;
    if (
      encoding !== undefined &&
      encoding !== 'base64' &&
      encoding !== 'base64url' &&
      encoding !== 'utf8'
    ) {
      throw new TypeError('HMAC signing material uses an unsupported encoding.');
    }
    if (typeof value !== 'string' && !securityHasInstance(IntrinsicUint8Array, value)) {
      throw new TypeError('HMAC signing material must be a string or Uint8Array.');
    }
    snapshot = freezeSecurityValue({
      ...(encoding === undefined ? {} : { encoding }),
      value: typeof value === 'string' ? value : copyBytes(value as Uint8Array),
    });
  }

  const byteLength = secretToBytes(snapshot).byteLength;
  if (byteLength < minimumHmacSecretBytes) {
    throw new TypeError(
      `HMAC signing material is ${byteLength} bytes; minimum is ${minimumHmacSecretBytes} bytes (SPEC §6.6).`,
    );
  }
  return snapshot;
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
 * export const verifier = standardWebhooks({
 *   secret: 'whsec_c3RhbmRhcmQgdGVzdCBzZWNyZXQga2V5IDMyIGJ5dGVzISE=',
 * });
 */
export function standardWebhooks(options: StandardWebhooksOptions): HmacSignatureVerifier {
  return createHmacSignature(
    {
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
      tolerance: {
        header: 'webhook-timestamp',
        seconds: defaultWebhookToleranceSeconds,
      },
    },
    payloadBindsTimestamp,
  );
}

async function verifyHmacSignature(
  options: HmacSignatureOptions,
  request: WebhookVerificationRequest,
  timestampBinding?: HmacTimestampBinding,
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

  // SPEC §9.1.1:846 (B5): when `tolerance` is configured, fold the timestamp into
  // the signed bytes so a captured (signature, body) cannot
  // be replayed with a forged-fresh timestamp header. Only framework presets can
  // carry the private payload-binding sentinel when the provider protocol already
  // fixes the timestamp at another position in the signed payload.
  let signedPayloadBytes: Uint8Array;
  if (options.tolerance !== undefined && timestampBinding !== payloadBindsTimestamp) {
    const timestampValue =
      options.tolerance.timestamp?.(request, context) ??
      (options.tolerance.header === undefined
        ? undefined
        : getHeader(request.headers, options.tolerance.header));
    const prefix = timestampValue !== undefined ? `${timestampValue}.` : '';
    const prefixBytes = encodeUtf8(prefix);
    const payloadBytes = payloadToBytes(signedPayload);
    signedPayloadBytes = new IntrinsicUint8Array(prefixBytes.length + payloadBytes.length);
    setBytes(signedPayloadBytes, prefixBytes, 0);
    setBytes(signedPayloadBytes, payloadBytes, prefixBytes.length);
  } else {
    signedPayloadBytes = payloadToBytes(signedPayload);
  }
  const parsedSignatures = parseSignatures(options.multiSig, signatureHeader);
  const signatures: Uint8Array[] = [];
  for (let index = 0; index < parsedSignatures.length; index += 1) {
    const descriptor = securityGetOwnPropertyDescriptor(parsedSignatures, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      continue;
    }
    const signature = descriptor.value;
    const decoded = decodeSignature(signature, options.encoding);
    if (decoded !== undefined) securityArrayAppend(signatures, decoded);
  }
  if (signatures.length === 0) return false;

  const secrets = securityIsArray(options.secret) ? options.secret : [options.secret];
  for (let secretIndex = 0; secretIndex < secrets.length; secretIndex += 1) {
    const descriptor = securityGetOwnPropertyDescriptor(secrets, secretIndex);
    if (descriptor === undefined || !('value' in descriptor) || descriptor.value === undefined) {
      continue;
    }
    const secret = descriptor.value;
    const expected = await hmacSha256(secretToBytes(secret), signedPayloadBytes);
    for (let signatureIndex = 0; signatureIndex < signatures.length; signatureIndex += 1) {
      const descriptor = securityGetOwnPropertyDescriptor(signatures, signatureIndex);
      if (descriptor === undefined || !('value' in descriptor) || descriptor.value === undefined) {
        continue;
      }
      const signature = descriptor.value;
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
  if (multiSig === true) {
    const signatures: string[] = [];
    let start = 0;
    for (let index = 0; index <= header.length; index += 1) {
      const delimiter =
        index === header.length ||
        header[index] === ',' ||
        securityRegExpTest(/\s/u, header[index] ?? '');
      if (!delimiter) continue;
      if (index > start) {
        securityArrayAppend(signatures, securityStringSlice(header, start, index));
      }
      start = index + 1;
    }
    return signatures;
  }
  return [header];
}

function standardV1Signatures(header: string): readonly string[] {
  const signatures: string[] = [];
  let start = 0;
  for (let index = 0; index <= header.length; index += 1) {
    if (index < header.length && !securityRegExpTest(/\s/u, header[index] ?? '')) continue;
    if (index > start) {
      const token = securityStringSlice(header, start, index);
      const comma = firstCharacterIndex(token, ',');
      if (comma === 2 && token[0] === 'v' && token[1] === '1' && comma + 1 < token.length) {
        securityArrayAppend(signatures, securityStringSlice(token, comma + 1));
      }
    }
    start = index + 1;
  }
  return signatures;
}

function normalizeStandardWebhooksSecrets(
  secrets: HmacSecret | readonly HmacSecret[],
): HmacSecret | readonly HmacSecret[] {
  if (securityIsArray(secrets)) {
    const secretValues = secrets as readonly HmacSecret[];
    const normalized: HmacSecret[] = [];
    for (let index = 0; index < secretValues.length; index += 1) {
      const descriptor = securityGetOwnPropertyDescriptor(secretValues, index);
      if (descriptor !== undefined && 'value' in descriptor && descriptor.value !== undefined) {
        securityArrayAppend(
          normalized,
          normalizeStandardWebhooksSecret(descriptor.value as HmacSecret),
        );
      }
    }
    return normalized;
  }
  return normalizeStandardWebhooksSecret(secrets as HmacSecret);
}

function normalizeStandardWebhooksSecret(secret: HmacSecret): HmacSecret {
  if (typeof secret === 'string') {
    return { encoding: 'base64', value: stripStandardWebhookSecretPrefix(secret) };
  }
  if (securityHasInstance(IntrinsicUint8Array, secret)) return secret as Uint8Array;
  const encoded = secret as Exclude<HmacSecret, string | Uint8Array>;
  if (typeof encoded.value === 'string' && encoded.encoding === undefined) {
    return { encoding: 'base64', value: stripStandardWebhookSecretPrefix(encoded.value) };
  }
  return secret;
}

function stripStandardWebhookSecretPrefix(value: string): string {
  return securityStringSlice(value, 0, 6) === 'whsec_' ? securityStringSlice(value, 6) : value;
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
  if (!capturedVerifierScalarControlsSound) return false;

  const now =
    typeof request.now === 'number'
      ? request.now
      : request.now !== undefined && securityHasInstance(IntrinsicDate, request.now)
        ? securityApply<number>(intrinsicDateGetTime, request.now, [])
        : securityApply<number>(intrinsicDateNow, IntrinsicDate, []);
  const nowSeconds = floorNumber(now / 1000);
  const difference = nowSeconds - timestamp;
  return (difference < 0 ? -difference : difference) <= tolerance.seconds;
}

function parseTimestampSeconds(value: number | string | undefined): number | undefined {
  if (typeof value === 'number') return isFiniteNumber(value) ? value : undefined;
  if (value === undefined || value.length === 0) return undefined;
  let index = value[0] === '-' ? 1 : 0;
  if (index === value.length) return undefined;
  let parsed = 0;
  for (; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (code < 0x30 || code > 0x39) return undefined;
    parsed = parsed * 10 + code - 0x30;
    if (parsed > 9_007_199_254_740_991) return undefined;
  }
  return value[0] === '-' ? -parsed : parsed;
}

function getHeader(headers: WebhookHeaders, name: string): string | undefined {
  const lowerName = securityStringToLowerCase(name);
  const upperName = securityStringToUpperCase(name);
  let direct: WebhookHeaderValue;
  if (
    typeof IntrinsicHeaders === 'function' &&
    intrinsicHeadersGet !== undefined &&
    securityHasInstance(IntrinsicHeaders, headers)
  ) {
    direct =
      securityApply<string | null>(intrinsicHeadersGet, headers, [name]) ??
      securityApply<string | null>(intrinsicHeadersGet, headers, [lowerName]) ??
      securityApply<string | null>(intrinsicHeadersGet, headers, [upperName]);
  } else if (securityIsMap(headers)) {
    const headerMap = headers as Map<string, WebhookHeaderValue>;
    direct =
      securityMapGet(headerMap, name) ??
      securityMapGet(headerMap, lowerName) ??
      securityMapGet(headerMap, upperName);
  } else {
    const get = 'get' in headers && typeof headers.get === 'function' ? headers.get : undefined;
    direct =
      (get === undefined ? undefined : securityApply<WebhookHeaderValue>(get, headers, [name])) ??
      (get === undefined
        ? undefined
        : securityApply<WebhookHeaderValue>(get, headers, [lowerName])) ??
      (get === undefined
        ? undefined
        : securityApply<WebhookHeaderValue>(get, headers, [upperName]));
  }
  if (direct !== undefined && direct !== null) return normalizeHeaderValue(direct);

  if (
    (typeof IntrinsicHeaders === 'function' && securityHasInstance(IntrinsicHeaders, headers)) ||
    securityIsMap(headers)
  ) {
    return undefined;
  }

  const keys = securityObjectKeys(headers);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined || securityStringToLowerCase(key) !== lowerName) continue;
    const descriptor = securityGetOwnPropertyDescriptor(headers, key);
    if (descriptor === undefined || !('value' in descriptor)) return undefined;
    const value = descriptor.value as WebhookHeaderValue;
    if (value !== undefined && value !== null) return normalizeHeaderValue(value);
  }

  return undefined;
}

function normalizeHeaderValue(value: Exclude<WebhookHeaderValue, null | undefined>): string {
  if (typeof value === 'string') return value;
  let normalized = '';
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = securityGetOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !('value' in descriptor)) return '';
    const part = descriptor.value;
    if (part === undefined) continue;
    normalized += `${normalized === '' ? '' : ','}${part}`;
  }
  return normalized;
}

function payloadToString(payload: WebhookPayload): string {
  if (typeof payload === 'string') return payload;
  if (!capturedHmacByteControlsSound) {
    throw new TypeError('Kovo HMAC verifier byte controls are unavailable.');
  }
  return securityApply<string>(intrinsicTextDecoderDecode, hmacTextDecoder, [
    payloadToBytes(payload),
  ]);
}

function payloadToBytes(payload: WebhookPayload): Uint8Array {
  if (typeof payload === 'string') return encodeUtf8(payload);
  if (securityHasInstance(IntrinsicArrayBuffer, payload)) {
    return new IntrinsicUint8Array(payload as ArrayBuffer);
  }
  const view = payload as ArrayBufferView;
  return new IntrinsicUint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function secretToBytes(secret: HmacSecret): Uint8Array {
  if (typeof secret === 'string') return encodeUtf8(secret);
  if (securityHasInstance(IntrinsicUint8Array, secret)) return secret as Uint8Array;
  const encoded = secret as Exclude<HmacSecret, string | Uint8Array>;
  if (securityHasInstance(IntrinsicUint8Array, encoded.value)) {
    return encoded.value as Uint8Array;
  }

  switch (encoded.encoding ?? 'utf8') {
    case 'base64':
      return base64ToBytes(encoded.value as string);
    case 'base64url':
      return base64ToBytes(normalizeBase64Url(encoded.value as string));
    case 'utf8':
      return encodeUtf8(encoded.value as string);
  }
  throw new TypeError('Unsupported HMAC secret encoding.');
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
        return base64ToBytes(normalizeBase64Url(signature));
      case 'hex':
        return hexToBytes(signature);
    }
  } catch {
    return undefined;
  }
}

function base64ToBytes(value: string): Uint8Array {
  let padded = value;
  const padding = (4 - (value.length % 4)) % 4;
  for (let index = 0; index < padding; index += 1) padded += '=';
  if (!capturedHmacByteControlsSound || typeof intrinsicAtob !== 'function') {
    throw new TypeError('Kovo HMAC verifier base64 controls are unavailable.');
  }
  const binary = intrinsicAtob(padded);
  const bytes = new IntrinsicUint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = securityStringCharCodeAt(binary, index);
  }
  return bytes;
}

function normalizeBase64Url(value: string): string {
  let normalized = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    normalized += character === '-' ? '+' : character === '_' ? '/' : character;
  }
  return normalized;
}

function hexToBytes(value: string): Uint8Array | undefined {
  if (value.length % 2 !== 0) return undefined;
  const bytes = new IntrinsicUint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const high = hexNibble(securityStringCharCodeAt(value, index * 2));
    const low = hexNibble(securityStringCharCodeAt(value, index * 2 + 1));
    if (high < 0 || low < 0) return undefined;
    bytes[index] = (high << 4) + low;
  }
  return bytes;
}

async function hmacSha256(secret: Uint8Array, payload: Uint8Array): Promise<Uint8Array> {
  if (!(await capturedHmacCryptoControl)) {
    throw new TypeError(
      'Kovo HMAC verifier crypto controls were modified before framework initialization.',
    );
  }
  if (
    capturedSubtleCrypto === undefined ||
    capturedSubtleImportKey === undefined ||
    capturedSubtleSign === undefined
  ) {
    throw new TypeError('Kovo HMAC verifier requires Web Crypto SubtleCrypto support.');
  }
  const secretBytes = copyBytes(secret);
  const payloadBytes = copyBytes(payload);
  const key = await securityApply<Promise<CryptoKey>>(
    capturedSubtleImportKey,
    capturedSubtleCrypto,
    ['raw', secretBytes, { hash: 'SHA-256', name: 'HMAC' }, false, ['sign']],
  );
  const signature = await securityApply<Promise<ArrayBuffer>>(
    capturedSubtleSign,
    capturedSubtleCrypto,
    ['HMAC', key, payloadBytes],
  );
  return new IntrinsicUint8Array(signature);
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  // Do not dispatch to bytes.slice(): Node Buffer is a Uint8Array subclass whose
  // slice() shares backing memory, which would retain caller-owned signing material.
  const copy = new IntrinsicUint8Array(bytes.byteLength);
  setBytes(copy, bytes, 0);
  return copy;
}

function encodeUtf8(value: string): Uint8Array {
  if (!capturedHmacByteControlsSound) {
    throw new TypeError('Kovo HMAC verifier UTF-8 controls are unavailable.');
  }
  const encoded = securityApply<Uint8Array>(intrinsicTextEncoderEncode, hmacTextEncoder, [value]);
  return encoded;
}

function setBytes(target: Uint8Array, source: Uint8Array, offset: number): void {
  if (!capturedHmacByteControlsSound) {
    throw new TypeError('Kovo HMAC verifier byte-copy controls are unavailable.');
  }
  securityApply<void>(intrinsicUint8ArraySet, target, [source, offset]);
}

function verifyCapturedHmacByteControls(): boolean {
  try {
    const encoded = securityApply<Uint8Array>(intrinsicTextEncoderEncode, hmacTextEncoder, [
      'Kovo',
    ]);
    if (
      encoded.length !== 4 ||
      encoded[0] !== 0x4b ||
      encoded[1] !== 0x6f ||
      encoded[2] !== 0x76 ||
      encoded[3] !== 0x6f
    ) {
      return false;
    }
    const source = new IntrinsicUint8Array(2);
    source[0] = 0x41;
    source[1] = 0x42;
    const target = new IntrinsicUint8Array(4);
    securityApply<void>(intrinsicUint8ArraySet, target, [source, 1]);
    if (target[0] !== 0 || target[1] !== 0x41 || target[2] !== 0x42 || target[3] !== 0) {
      return false;
    }
    if (securityApply<string>(intrinsicTextDecoderDecode, hmacTextDecoder, [encoded]) !== 'Kovo') {
      return false;
    }
    return typeof intrinsicAtob === 'function' && intrinsicAtob('S292bw==') === 'Kovo';
  } catch {
    return false;
  }
}

function verifyCapturedVerifierScalarControls(): boolean {
  try {
    const control = new IntrinsicDate(1_700_000_000_123);
    const timestamp = securityApply<number>(intrinsicDateGetTime, control, []);
    const now = securityApply<number>(intrinsicDateNow, IntrinsicDate, []);
    const directNow = securityApply<number>(intrinsicDateGetTime, new IntrinsicDate(), []);
    return (
      timestamp === 1_700_000_000_123 &&
      isFiniteNumber(now) &&
      isFiniteNumber(directNow) &&
      (now > directNow ? now - directNow : directNow - now) < 60_000
    );
  } catch {
    return false;
  }
}

async function verifyCapturedHmacCryptoControls(): Promise<boolean> {
  if (
    capturedSubtleCrypto === undefined ||
    capturedSubtleImportKey === undefined ||
    capturedSubtleSign === undefined
  ) {
    return false;
  }
  try {
    const keyBytes = encodeUtf8('kovo-hmac-control-key');
    const payloadBytes = encodeUtf8('kovo-hmac-control-payload');
    const key = await securityApply<Promise<CryptoKey>>(
      capturedSubtleImportKey,
      capturedSubtleCrypto,
      ['raw', keyBytes, { hash: 'SHA-256', name: 'HMAC' }, false, ['sign']],
    );
    const signature = await securityApply<Promise<ArrayBuffer>>(
      capturedSubtleSign,
      capturedSubtleCrypto,
      ['HMAC', key, payloadBytes],
    );
    return bytesEqualHex(
      new IntrinsicUint8Array(signature),
      '0822211b3d7ed77d25825fa1873c00ea4809fde1dc06e95f71d5a891ca453a0b',
    );
  } catch {
    return false;
  }
}

function bytesEqualHex(bytes: Uint8Array, hex: string): boolean {
  if (bytes.length * 2 !== hex.length) return false;
  for (let index = 0; index < bytes.length; index += 1) {
    const high = hexNibble(securityStringCharCodeAt(hex, index * 2));
    const low = hexNibble(securityStringCharCodeAt(hex, index * 2 + 1));
    if (high < 0 || low < 0 || bytes[index] !== (high << 4) + low) return false;
  }
  return true;
}

function hexNibble(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

function firstCharacterIndex(value: string, expected: string): number {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === expected) return index;
  }
  return -1;
}

function floorNumber(value: number): number {
  if (!isFiniteNumber(value)) return value;
  const remainder = value % 1;
  if (remainder === 0) return value;
  return value - remainder - (value < 0 ? 1 : 0);
}

function isFiniteNumber(value: number): boolean {
  return value === value && value !== Infinity && value !== -Infinity;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = left.length > right.length ? left.length : right.length;
  let difference = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}
