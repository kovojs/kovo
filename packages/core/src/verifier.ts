import {
  freezeSecurityValue,
  securityArrayAppend,
  securityApply,
  securityDefineProperty,
  securityGetOwnPropertyDescriptor,
  securityGetPrototypeOf,
  securityHasInstance,
  securityIsArray,
  securityIsMap,
  securityMap,
  securityMapGet,
  securityMapHas,
  securityMapSet,
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
const IntrinsicDataView = DataView;
const IntrinsicHeaders = globalThis.Headers;
const IntrinsicTextDecoder = TextDecoder;
const IntrinsicTextEncoder = TextEncoder;
const IntrinsicUint8Array = Uint8Array;
const intrinsicArrayBufferIsView = IntrinsicArrayBuffer.isView;
const intrinsicAtob = globalThis.atob;
const hmacTextEncoder = new IntrinsicTextEncoder();
const hmacTextDecoder = new IntrinsicTextDecoder();
const intrinsicTextEncoderEncode = IntrinsicTextEncoder.prototype.encode;
const intrinsicTextDecoderDecode = IntrinsicTextDecoder.prototype.decode;
const intrinsicUint8ArraySet = IntrinsicUint8Array.prototype.set;
const typedArrayPrototype = securityGetPrototypeOf(IntrinsicUint8Array.prototype);
const intrinsicTypedArrayBuffer =
  typedArrayPrototype === null
    ? undefined
    : securityGetOwnPropertyDescriptor(typedArrayPrototype, 'buffer')?.get;
const intrinsicTypedArrayByteOffset =
  typedArrayPrototype === null
    ? undefined
    : securityGetOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')?.get;
const intrinsicTypedArrayByteLength =
  typedArrayPrototype === null
    ? undefined
    : securityGetOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')?.get;
const intrinsicDataViewBuffer = securityGetOwnPropertyDescriptor(
  IntrinsicDataView.prototype,
  'buffer',
)?.get;
const intrinsicDataViewByteOffset = securityGetOwnPropertyDescriptor(
  IntrinsicDataView.prototype,
  'byteOffset',
)?.get;
const intrinsicDataViewByteLength = securityGetOwnPropertyDescriptor(
  IntrinsicDataView.prototype,
  'byteLength',
)?.get;
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
const maximumHmacSecretBytes = 4_096;
const maximumHmacSecrets = 32;
const maximumHmacEncodedSecretCharacters = 8_192;
const maximumHmacPayloadBytes = 16 * 1_024 * 1_024;
const maximumHmacSignatureCandidates = 64;
const maximumHmacSignatureCandidateCharacters = 256;
const maximumHmacSignatureHeaderCharacters = 16_384;
const maximumWebhookHeaderValues = 100;
const frameworkHmacSignatureVerifiers = securityWeakSet<object>();
// Module-private authority used only by framework presets whose provider protocol fixes the
// timestamp at a non-prefix position in the signed payload. App code cannot mint or import this
// sentinel, so public hmacSignature() always owns timestamp binding when tolerance is configured.
const payloadBindsTimestamp = Symbol('kovo.hmac.payload-binds-timestamp');
type HmacTimestampBinding = typeof payloadBindsTimestamp | undefined;
type ResolvedHmacToleranceTimestamp = {
  parsedSeconds: number;
  signedValue: number | string;
};

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
 * const secret = process.env.PROVIDER_WEBHOOK_SECRET;
 * if (secret === undefined) throw new Error('Missing provider webhook signing material');
 *
 * export const verifier = hmacSignature({
 *   encoding: 'hex',
 *   header: 'x-signature',
 *   payload: (request) => request.payload,
 *   secret,
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
  const encoding = ownHmacOption<HmacSignatureEncoding>(
    options,
    'encoding',
    'HMAC signature encoding',
    true,
  );
  const header = ownHmacOption<string>(options, 'header', 'HMAC signature header', true);
  const multiSig = ownHmacOption<HmacMultiSignature>(
    options,
    'multiSig',
    'HMAC signature multiSig',
  );
  const name = ownHmacOption<string>(options, 'name', 'HMAC signature name');
  const payload = ownHmacOption<HmacSignaturePayload>(
    options,
    'payload',
    'HMAC signature payload',
    true,
  );
  const scheme = ownHmacOption<string>(options, 'scheme', 'HMAC signature scheme');
  const secret = ownHmacOption<HmacSignatureOptions['secret']>(
    options,
    'secret',
    'HMAC signature secret',
    true,
  );
  const sourceTolerance = ownHmacOption<HmacSignatureTolerance>(
    options,
    'tolerance',
    'HMAC signature tolerance',
  );
  if (encoding !== 'base64' && encoding !== 'base64url' && encoding !== 'hex') {
    throw new TypeError('HMAC signature encoding must be base64, base64url, or hex.');
  }
  if (typeof header !== 'string' || header.length === 0 || header.length > 256) {
    throw new TypeError(
      'HMAC signature header must be a non-empty string of at most 256 characters.',
    );
  }
  if (multiSig !== undefined && typeof multiSig !== 'boolean' && typeof multiSig !== 'function') {
    throw new TypeError('HMAC signature multiSig must be a boolean or function.');
  }
  if (name !== undefined && (typeof name !== 'string' || name.length > 256)) {
    throw new TypeError('HMAC signature name must be at most 256 characters when provided.');
  }
  if (scheme !== undefined && (typeof scheme !== 'string' || scheme.length > 256)) {
    throw new TypeError('HMAC signature scheme must be at most 256 characters when provided.');
  }
  if (
    sourceTolerance !== undefined &&
    (typeof sourceTolerance !== 'object' || sourceTolerance === null)
  ) {
    throw new TypeError('HMAC signature tolerance must be an object when provided.');
  }
  const tolerance =
    sourceTolerance === undefined ? undefined : snapshotHmacSignatureTolerance(sourceTolerance);
  return freezeSecurityValue({
    encoding,
    header,
    ...(multiSig === undefined ? {} : { multiSig }),
    ...(name === undefined ? {} : { name }),
    payload: snapshotWebhookPayload(payload),
    ...(scheme === undefined ? {} : { scheme }),
    secret: snapshotHmacSecrets(secret),
    ...(tolerance === undefined ? {} : { tolerance }),
  });
}

function snapshotHmacSignatureTolerance(tolerance: HmacSignatureTolerance): HmacSignatureTolerance {
  const header = ownHmacOption<string>(tolerance, 'header', 'HMAC signature tolerance.header');
  const seconds = ownHmacOption<number>(
    tolerance,
    'seconds',
    'HMAC signature tolerance.seconds',
    true,
  );
  const timestamp = ownHmacOption<HmacSignatureTolerance['timestamp']>(
    tolerance,
    'timestamp',
    'HMAC signature tolerance.timestamp',
  );
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
  if (header !== undefined && (typeof header !== 'string' || header.length > 256)) {
    throw new TypeError(
      'HMAC signature tolerance.header must be at most 256 characters when provided.',
    );
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
  if (typeof payload === 'function') return payload;
  if (typeof payload === 'string') {
    assertHmacPayloadCharacterBound(payload);
    return payload;
  }
  if (securityHasInstance(IntrinsicArrayBuffer, payload)) {
    const bytes = new IntrinsicUint8Array(payload as ArrayBuffer);
    assertHmacPayloadByteBound(bytes);
    return copyBytes(bytes);
  }
  const view = snapshotByteView(payload, 'HMAC signature payload');
  if (view.byteLength > maximumHmacPayloadBytes) {
    throw new TypeError(
      `HMAC signature payload must contain at most ${maximumHmacPayloadBytes} bytes.`,
    );
  }
  return copyBytes(new IntrinsicUint8Array(view.buffer, view.byteOffset, view.byteLength));
}

function snapshotHmacSecrets(
  secret: HmacSignatureOptions['secret'],
): HmacSignatureOptions['secret'] {
  if (securityIsArray(secret)) {
    const length = exactArrayLength(secret, 'HMAC secret array', maximumHmacSecrets);
    if (length === 0) {
      throw new TypeError('HMAC signature configuration requires at least one signing secret.');
    }
    const snapshot: HmacSecret[] = [];
    for (let index = 0; index < length; index += 1) {
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
    assertHmacSecretStringBound(secret, 'utf8');
    snapshot = secret;
  } else if (securityHasInstance(IntrinsicUint8Array, secret)) {
    assertHmacSecretByteBound(secret as Uint8Array);
    snapshot = copyBytes(secret as Uint8Array);
  } else {
    if (typeof secret !== 'object' || secret === null) {
      throw new TypeError('HMAC signing material must be a string, Uint8Array, or encoded object.');
    }
    const encoded = secret as Exclude<HmacSecret, string | Uint8Array>;
    const encoding = ownHmacOption<Exclude<HmacSecret, string | Uint8Array>['encoding']>(
      encoded,
      'encoding',
      'HMAC signing material encoding',
    );
    const value = ownHmacOption<string | Uint8Array>(
      encoded,
      'value',
      'HMAC signing material value',
      true,
    );
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
    if (typeof value === 'string') {
      assertHmacSecretStringBound(value, encoding ?? 'utf8');
    } else {
      assertHmacSecretByteBound(value as Uint8Array);
    }
    snapshot = freezeSecurityValue({
      ...(encoding === undefined ? {} : { encoding }),
      value: typeof value === 'string' ? value : copyBytes(value as Uint8Array),
    });
  }

  const byteLength = byteLengthOf(secretToBytes(snapshot));
  if (byteLength < minimumHmacSecretBytes || byteLength > maximumHmacSecretBytes) {
    throw new TypeError(
      `HMAC signing material is ${byteLength} bytes; minimum is ${minimumHmacSecretBytes} bytes and maximum is ${maximumHmacSecretBytes} bytes (SPEC §6.6).`,
    );
  }
  return snapshot;
}

function assertHmacSecretStringBound(
  value: string,
  encoding: 'base64' | 'base64url' | 'utf8',
): void {
  const maximum = encoding === 'utf8' ? maximumHmacSecretBytes : maximumHmacEncodedSecretCharacters;
  if (value.length > maximum) {
    throw new TypeError(`HMAC signing material must contain at most ${maximum} characters.`);
  }
}

function assertHmacSecretByteBound(value: Uint8Array): void {
  const byteLength = byteLengthOf(value);
  if (byteLength > maximumHmacSecretBytes) {
    throw new TypeError(
      `HMAC signing material must contain at most ${maximumHmacSecretBytes} bytes.`,
    );
  }
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
  if (typeof name !== 'string' || name.length === 0 || name.length > 256) {
    throw new TypeError(
      'Custom webhook verifier name must be a non-empty string of at most 256 characters.',
    );
  }
  if (typeof verify !== 'function') {
    throw new TypeError('Custom webhook verifier callback must be a function.');
  }
  return freezeSecurityValue({
    kind: 'custom',
    name,
    scheme: `custom:${name}`,
    async verify(request) {
      // SPEC §9.1 verifier-before-parse is fail-closed. JavaScript callers and casts can violate
      // the TypeScript callback signature, so only the exact boolean verdict authorizes.
      return (await verify(request)) === true;
    },
  });
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
 * const secret = process.env.STANDARD_WEBHOOK_SECRET;
 * if (secret === undefined) throw new Error('Missing Standard Webhooks signing material');
 *
 * export const verifier = standardWebhooks({
 *   secret,
 * });
 */
export function standardWebhooks(options: StandardWebhooksOptions): HmacSignatureVerifier {
  const secret = ownHmacOption<StandardWebhooksOptions['secret']>(
    options,
    'secret',
    'Standard Webhooks secret',
    true,
  );
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
      secret: normalizeStandardWebhooksSecrets(secret),
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
  if (
    signatureHeader === undefined ||
    signatureHeader.length === 0 ||
    signatureHeader.length > maximumHmacSignatureHeaderCharacters
  ) {
    return false;
  }

  const headerCache = securityMap<string, string | undefined>();
  securityMapSet(headerCache, securityStringToLowerCase(options.header), signatureHeader);
  const context: HmacSignaturePayloadContext = {
    header: (name) => {
      const cacheKey = securityStringToLowerCase(name);
      if (securityMapHas(headerCache, cacheKey)) return securityMapGet(headerCache, cacheKey);
      const value = getHeader(request.headers, name);
      securityMapSet(headerCache, cacheKey, value);
      return value;
    },
    signatureHeader,
  };

  const toleranceTimestamp = resolveToleranceTimestamp(options.tolerance, request, context);
  if (!isWithinTolerance(options.tolerance, toleranceTimestamp, request)) return false;

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
    if (toleranceTimestamp === undefined) return false;
    const prefix = `${toleranceTimestamp.signedValue}.`;
    const prefixBytes = encodeUtf8(prefix);
    const payloadBytes = payloadToBytes(signedPayload);
    const prefixLength = byteLengthOf(prefixBytes);
    signedPayloadBytes = new IntrinsicUint8Array(prefixLength + byteLengthOf(payloadBytes));
    setBytes(signedPayloadBytes, prefixBytes, 0);
    setBytes(signedPayloadBytes, payloadBytes, prefixLength);
  } else {
    signedPayloadBytes = payloadToBytes(signedPayload);
  }
  assertHmacPayloadByteBound(signedPayloadBytes);
  const parsedSignatures = parseSignatures(options.multiSig, signatureHeader);
  if (!securityIsArray(parsedSignatures)) return false;
  const parsedSignatureLength = exactArrayLength(
    parsedSignatures,
    'HMAC signature candidate array',
    maximumHmacSignatureCandidates,
  );
  const signatures: Uint8Array[] = [];
  for (let index = 0; index < parsedSignatureLength; index += 1) {
    const descriptor = securityGetOwnPropertyDescriptor(parsedSignatures, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      continue;
    }
    const signature = descriptor.value;
    if (signature.length > maximumHmacSignatureCandidateCharacters) continue;
    const decoded = decodeSignature(signature, options.encoding);
    if (decoded !== undefined && byteLengthOf(decoded) === 32) {
      securityArrayAppend(signatures, decoded);
    }
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
        if (signatures.length >= maximumHmacSignatureCandidates) return [];
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
        if (signatures.length >= maximumHmacSignatureCandidates) return [];
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
    const length = exactArrayLength(
      secretValues,
      'Standard Webhooks secret array',
      maximumHmacSecrets,
    );
    const normalized: HmacSecret[] = [];
    for (let index = 0; index < length; index += 1) {
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
  if (typeof secret !== 'object' || secret === null) {
    throw new TypeError('Standard Webhooks secret must be stable signing material.');
  }
  const encoded = secret as Exclude<HmacSecret, string | Uint8Array>;
  const value = ownHmacOption<string | Uint8Array>(
    encoded,
    'value',
    'Standard Webhooks signing material value',
    true,
  );
  const encoding = ownHmacOption<Exclude<HmacSecret, string | Uint8Array>['encoding']>(
    encoded,
    'encoding',
    'Standard Webhooks signing material encoding',
  );
  if (typeof value === 'string' && encoding === undefined) {
    return { encoding: 'base64', value: stripStandardWebhookSecretPrefix(value) };
  }
  return freezeSecurityValue({ ...(encoding === undefined ? {} : { encoding }), value });
}

function stripStandardWebhookSecretPrefix(value: string): string {
  return securityStringSlice(value, 0, 6) === 'whsec_' ? securityStringSlice(value, 6) : value;
}

function ownHmacOption<Value>(
  options: object,
  property: PropertyKey,
  label: string,
  required: true,
): Value;
function ownHmacOption<Value>(
  options: object,
  property: PropertyKey,
  label: string,
  required?: false,
): Value | undefined;
function ownHmacOption<Value>(
  options: object,
  property: PropertyKey,
  label: string,
  required = false,
): Value | undefined {
  const descriptor = securityGetOwnPropertyDescriptor(options, property);
  if (descriptor === undefined) {
    if (required) throw new TypeError(`${label} must be an own-data property.`);
    return undefined;
  }
  if (!('value' in descriptor)) {
    throw new TypeError(`${label} must be an own-data property.`);
  }
  if (required && descriptor.value === undefined) {
    throw new TypeError(`${label} must be an own-data property.`);
  }
  return descriptor.value as Value | undefined;
}

function resolveToleranceTimestamp(
  tolerance: HmacSignatureTolerance | undefined,
  request: WebhookVerificationRequest,
  context: HmacSignaturePayloadContext,
): ResolvedHmacToleranceTimestamp | undefined {
  if (tolerance === undefined) return undefined;

  const timestampValue =
    tolerance.timestamp?.(request, context) ??
    (tolerance.header === undefined ? undefined : context.header(tolerance.header));
  const parsedSeconds = parseTimestampSeconds(timestampValue);
  if (timestampValue === undefined || parsedSeconds === undefined) return undefined;
  return { parsedSeconds, signedValue: timestampValue };
}

function isWithinTolerance(
  tolerance: HmacSignatureTolerance | undefined,
  timestamp: ResolvedHmacToleranceTimestamp | undefined,
  request: WebhookVerificationRequest,
): boolean {
  if (tolerance === undefined) return true;
  if (timestamp === undefined) return false;
  if (!capturedVerifierScalarControlsSound) return false;

  const now =
    typeof request.now === 'number'
      ? request.now
      : request.now !== undefined && securityHasInstance(IntrinsicDate, request.now)
        ? securityApply<number>(intrinsicDateGetTime, request.now, [])
        : securityApply<number>(intrinsicDateNow, IntrinsicDate, []);
  const nowSeconds = floorNumber(now / 1000);
  const difference = nowSeconds - timestamp.parsedSeconds;
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
    // A polluted Object.prototype.get must not outrank the actual own header
    // record, and an accessor-backed lookup must not execute while selecting
    // authentication bytes. Custom carriers must expose an own data method.
    const getDescriptor = securityGetOwnPropertyDescriptor(headers, 'get');
    const get =
      getDescriptor !== undefined &&
      'value' in getDescriptor &&
      typeof getDescriptor.value === 'function'
        ? getDescriptor.value
        : undefined;
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
  if (!securityIsArray(value)) return '';
  const length = exactArrayLength(value, 'Webhook header value array', maximumWebhookHeaderValues);
  let normalized = '';
  for (let index = 0; index < length; index += 1) {
    const descriptor = securityGetOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !('value' in descriptor)) return '';
    const part = descriptor.value;
    if (part === undefined) continue;
    if (typeof part !== 'string') return '';
    const separatorLength = normalized === '' ? 0 : 1;
    if (part.length > maximumHmacSignatureHeaderCharacters - normalized.length - separatorLength) {
      return '';
    }
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
  if (typeof payload === 'string') {
    assertHmacPayloadCharacterBound(payload);
    return encodeUtf8(payload);
  }
  if (securityHasInstance(IntrinsicArrayBuffer, payload)) {
    const bytes = new IntrinsicUint8Array(payload as ArrayBuffer);
    assertHmacPayloadByteBound(bytes);
    return bytes;
  }
  const view = snapshotByteView(payload, 'Webhook payload');
  if (view.byteLength > maximumHmacPayloadBytes) {
    throw new TypeError(`Webhook payload must contain at most ${maximumHmacPayloadBytes} bytes.`);
  }
  return new IntrinsicUint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function assertHmacPayloadCharacterBound(value: string): void {
  if (value.length > maximumHmacPayloadBytes) {
    throw new TypeError(
      `HMAC signature payload must contain at most ${maximumHmacPayloadBytes} characters.`,
    );
  }
}

function assertHmacPayloadByteBound(value: Uint8Array): void {
  if (byteLengthOf(value) > maximumHmacPayloadBytes) {
    throw new TypeError(
      `HMAC signature payload must contain at most ${maximumHmacPayloadBytes} bytes.`,
    );
  }
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
  for (let index = 0; index < value.length / 2; index += 1) {
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
  // Node's Web Crypto BufferSource conversion consults mutable public view
  // accessors before entering the native implementation. Pin exact own data
  // fields on fresh private copies so late TypedArray/ArrayBuffer prototype
  // poisoning cannot collapse the authenticated key or payload to empty bytes.
  const secretBytes = pinCryptoByteView(copyBytes(secret));
  const payloadBytes = pinCryptoByteView(copyBytes(payload));
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
  const copy = new IntrinsicUint8Array(byteLengthOf(bytes));
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
    if (
      intrinsicTypedArrayBuffer === undefined ||
      intrinsicTypedArrayByteOffset === undefined ||
      intrinsicTypedArrayByteLength === undefined ||
      intrinsicDataViewBuffer === undefined ||
      intrinsicDataViewByteOffset === undefined ||
      intrinsicDataViewByteLength === undefined
    ) {
      return false;
    }
    const encoded = securityApply<Uint8Array>(intrinsicTextEncoderEncode, hmacTextEncoder, [
      'Kovo',
    ]);
    const controlBuffer = new IntrinsicArrayBuffer(4);
    const controlBytes = new IntrinsicUint8Array(controlBuffer);
    const dataView = new IntrinsicDataView(controlBuffer, 1, 2);
    if (
      securityApply<boolean>(intrinsicArrayBufferIsView, IntrinsicArrayBuffer, [encoded]) !==
        true ||
      securityApply<boolean>(intrinsicArrayBufferIsView, IntrinsicArrayBuffer, [dataView]) !==
        true ||
      securityApply<boolean>(intrinsicArrayBufferIsView, IntrinsicArrayBuffer, [{}]) !== false ||
      securityApply<ArrayBufferLike>(intrinsicTypedArrayBuffer, controlBytes, []) !==
        controlBuffer ||
      securityApply<number>(intrinsicTypedArrayByteOffset, controlBytes, []) !== 0 ||
      securityApply<number>(intrinsicTypedArrayByteLength, controlBytes, []) !== 4 ||
      securityApply<ArrayBufferLike>(intrinsicDataViewBuffer, dataView, []) !== controlBuffer ||
      securityApply<number>(intrinsicDataViewByteOffset, dataView, []) !== 1 ||
      securityApply<number>(intrinsicDataViewByteLength, dataView, []) !== 2 ||
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
  const byteLength = byteLengthOf(bytes);
  if (byteLength * 2 !== hex.length) return false;
  for (let index = 0; index < byteLength; index += 1) {
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
  // SPEC §6.6/§9.1: signature equality is an authorization boundary. Read exact
  // byte lengths through the boot-witnessed typed-array intrinsic so late realm
  // poisoning cannot collapse the comparison loop to zero bytes.
  const leftLength = byteLengthOf(left);
  const rightLength = byteLengthOf(right);
  const length = leftLength > rightLength ? leftLength : rightLength;
  let difference = leftLength ^ rightLength;

  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}

interface SnapshotByteView {
  readonly buffer: ArrayBufferLike;
  readonly byteLength: number;
  readonly byteOffset: number;
}

function snapshotByteView(value: unknown, label: string): SnapshotByteView {
  if (
    !capturedHmacByteControlsSound ||
    securityApply<boolean>(intrinsicArrayBufferIsView, IntrinsicArrayBuffer, [value]) !== true
  ) {
    throw new TypeError(`${label} must be a string, ArrayBuffer, or ArrayBufferView.`);
  }
  const view = value as ArrayBufferView;
  const isDataView = securityHasInstance(IntrinsicDataView, view);
  const bufferGetter = isDataView ? intrinsicDataViewBuffer : intrinsicTypedArrayBuffer;
  const byteOffsetGetter = isDataView ? intrinsicDataViewByteOffset : intrinsicTypedArrayByteOffset;
  const byteLengthGetter = isDataView ? intrinsicDataViewByteLength : intrinsicTypedArrayByteLength;
  if (
    bufferGetter === undefined ||
    byteOffsetGetter === undefined ||
    byteLengthGetter === undefined
  ) {
    throw new TypeError('Kovo HMAC verifier byte-view controls are unavailable.');
  }
  return {
    buffer: securityApply<ArrayBufferLike>(bufferGetter, view, []),
    byteLength: securityApply<number>(byteLengthGetter, view, []),
    byteOffset: securityApply<number>(byteOffsetGetter, view, []),
  };
}

function byteLengthOf(value: Uint8Array): number {
  if (!capturedHmacByteControlsSound || intrinsicTypedArrayByteLength === undefined) {
    throw new TypeError('Kovo HMAC verifier byte-length controls are unavailable.');
  }
  return securityApply<number>(intrinsicTypedArrayByteLength, value, []);
}

function pinCryptoByteView(value: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const view = snapshotByteView(value, 'Kovo HMAC crypto input');
  securityDefineProperty(value, 'buffer', {
    configurable: false,
    enumerable: false,
    value: view.buffer,
    writable: false,
  });
  securityDefineProperty(value, 'byteOffset', {
    configurable: false,
    enumerable: false,
    value: view.byteOffset,
    writable: false,
  });
  securityDefineProperty(value, 'byteLength', {
    configurable: false,
    enumerable: false,
    value: view.byteLength,
    writable: false,
  });
  return value;
}

function exactArrayLength(value: readonly unknown[], label: string, maximum: number): number {
  const descriptor = securityGetOwnPropertyDescriptor(value, 'length');
  const length = descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  if (typeof length !== 'number' || length % 1 !== 0 || length < 0 || length > maximum) {
    throw new TypeError(`${label} must contain at most ${maximum} entries.`);
  }
  return length;
}
