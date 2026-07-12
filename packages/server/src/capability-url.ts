/**
 * Capability-URL primitive (SPEC §6.6 / §9.1; `plans/secure-framework.md` Phase 5). A signed,
 * short-lived, scope-bound token over a storage object so a download URL is *un-dereferenceable
 * without a valid token*: the verify sink (a framework-owned download route) checks the HMAC
 * BEFORE any storage read, so an attacker who guesses or enumerates object keys cannot read them.
 *
 * What this is (label honestly): **by-construction AT THE VERIFY SINK** — given the sink runs
 * before the storage read, an object is not dereferenceable without a token that verifies. What
 * it is NOT: it does not stop URL-as-credential *leakage* (a signed URL handed to a browser can
 * leak via `Referer`, server/proxy logs, or a CDN cache). That leakage is *mitigated* — never
 * proven — by short expiry, narrow scope, and the optional one-time replay store; the token is a
 * bearer credential and must be treated as one.
 *
 * Canonicalization: we sign over a canonical, unambiguous byte string built from the token version,
 * signing-key id, method, object key, expiry, scope, one-time posture, and nonce. Length-prefixed
 * fields prevent delimiter injection or field confusion. Canonicalize BEFORE signing and verify by
 * re-canonicalizing the received fields, never by parsing the signature.
 *
 * The framework route is shipped in `capability-route.ts`: `createStorageDownloadEndpoint` mounts
 * the verify-before-read sink, `ctx.signUrl` mints URLs pointing at that route, and mint facts are
 * drained for `kovo explain --capabilities`.
 */

import { securityClassifier, wireEmitter } from '@kovojs/core/internal/security-markers';
import { isProvenPrincipal } from './auth-principal.js';
import {
  capabilityBase64Url,
  capabilityDecode,
  capabilityEncode,
  capabilityFreeze,
  capabilityFromBase64Url,
  capabilityHasRecordPrototype,
  capabilityIsFinite,
  capabilityIsSafeInteger,
  capabilityJsonParse,
  capabilityJsonQuote,
  capabilityMapDelete,
  capabilityMapEntries,
  capabilityMapHas,
  capabilityMapSet,
  capabilityMapSize,
  capabilityNow,
  capabilityOwnDataValue,
  capabilityOwnKeys,
  capabilityRandomBytes,
  capabilityReflectApply,
  capabilityString,
  capabilityStringCharCodeAt,
  capabilityStringIndexOf,
  capabilityStringSlice,
  capabilityStringToLowerCase,
  capabilityStringTrim,
  capabilityStableProperty,
  capabilityTypeError,
  createCapabilityMap,
} from './capability-intrinsics.js';
import { signingKeyRingFromSecret, type SigningSecret } from './keyring.js';

const TOKEN_VERSION = 'v2';
const CAPABILITY_SIGNING_PURPOSE = 'capability-url';
const DEFAULT_CAPABILITY_AUDIENCE = 'storage-download';

/** HTTP method a capability token authorizes. Downloads are reads; we model GET/HEAD. */
export type CapabilityMethod = 'GET' | 'HEAD';

/** Fields a capability URL signs over and a verifier re-canonicalizes. */
export interface CapabilityClaims {
  /** The storage object key the token authorizes (e.g. `receipts/ord_1.pdf`). */
  key: string;
  /** The HTTP method the token authorizes. */
  method: CapabilityMethod;
  /** Absolute expiry as epoch milliseconds. The verifier rejects `now >= expiry`. */
  expiry: number;
  /** Optional scope binding (e.g. a tenant or principal id) folded into the signature. */
  scope?: string;
}

/** Options for minting a capability token (`ctx.signUrl` shape). */
export interface SignCapabilityOptions {
  key: string;
  method?: CapabilityMethod;
  scope?: string;
  /** Time-to-live in milliseconds. A short default keeps a leaked URL useful only briefly. */
  expiresIn?: number;
  /** When true, the token is single-use: the verifier burns it in a replay store on first use. */
  oneTime?: boolean;
  /** Verify-sink audience. Storage download routes bind this to their mount surface. */
  audience?: string;
}

/** Default token TTL: 5 minutes. Short by design — a leaked capability URL is a bearer secret. */
export const DEFAULT_CAPABILITY_TTL_MS = 5 * 60 * 1000;

/** A minted capability token plus the claims it encodes (for building the download URL). */
export interface SignedCapability {
  /** The opaque token string to place in the URL (query param or path segment). */
  token: string;
  claims: CapabilityClaims;
  oneTime: boolean;
}

/** Outcome of verifying a capability token. */
export type CapabilityVerifyResult =
  | { ok: true; claims: CapabilityClaims }
  | { ok: false; reason: CapabilityRejectReason };

/** Why a capability token was rejected (stable codes for audit; never leak which to the client). */
export type CapabilityRejectReason =
  | 'malformed'
  | 'bad-signature'
  | 'expired'
  | 'claim-mismatch'
  | 'replayed';

/** A replay store for one-time capability tokens: returns true iff this token id was unused. */
export interface CapabilityReplayStore {
  /**
   * Atomically mark `id` consumed until the token's absolute expiry; return true if it was
   * previously unconsumed (first use). Stores that cannot honor expiry should fail closed outside
   * this interface rather than retaining replay ids for an unrelated horizon.
   */
  consume(id: string, expiresAt: number): boolean | Promise<boolean>;
}

/**
 * In-memory one-time replay store with TTL eviction. Suitable for single-process apps and tests;
 * a multi-process deployment injects a shared store (Redis &c.) with the same contract.
 */
export function createMemoryCapabilityReplayStore(
  options: { now?: () => number } = {},
): CapabilityReplayStore & {
  size(): number;
} {
  const consumed = createCapabilityMap<string, number>();
  const configuredNow = capabilityOwnDataValue(options, 'now');
  if (configuredNow !== undefined && typeof configuredNow !== 'function') {
    throw capabilityTypeError('Capability replay-store now must be a function.');
  }
  const now = configuredNow ?? capabilityNow;
  const evict = (): void => {
    const current = capabilityReflectApply<number>(now, undefined, []);
    if (!isValidClock(current)) {
      throw capabilityTypeError(
        'Capability replay-store clock must return a non-negative safe integer.',
      );
    }
    const entries = capabilityMapEntries(consumed);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      if (entry[1] <= current) capabilityMapDelete(consumed, entry[0]);
    }
  };
  return capabilityFreeze({
    consume(id: string, expiresAt: number): boolean {
      evict();
      if (capabilityMapHas(consumed, id)) return false;
      // Hold the replay id only until the signed token expiry. After that, the expiry check rejects
      // the token before replay lookup, so retaining the id no longer buys security.
      capabilityMapSet(consumed, id, expiresAt);
      return true;
    },
    size(): number {
      evict();
      return capabilityMapSize(consumed);
    },
  });
}

/**
 * Build the canonical, length-prefixed byte string signed over. Length prefixes make field
 * boundaries unambiguous so `(key="a", scope="bc")` and `(key="ab", scope="c")` never collide.
 */
function canonicalizeWithNonce(
  claims: CapabilityClaims,
  oneTime: boolean,
  nonce: string,
  keyId: string,
): Uint8Array {
  const fields = [
    TOKEN_VERSION,
    keyId,
    claims.method,
    claims.key,
    capabilityString(claims.expiry),
    claims.scope ?? '',
    oneTime ? '1' : '0',
    nonce,
  ];
  let canonical = '';
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    const bytes = capabilityEncode(field);
    if (index !== 0) canonical += '|';
    canonical += `${capabilityString(bytes.length)}:${field}`;
  }
  return capabilityEncode(canonical);
}

/**
 * Mint a capability token over a storage object. Canonicalize-before-sign: the signed bytes are
 * built from the resolved claims, not from any client-supplied string.
 *
 * @param secret - The framework signing secret (NOT app-controlled per request).
 * @param options - `{ key, method?, scope?, expiresIn?, oneTime? }`.
 * @param now - Injectable clock (epoch ms) for tests.
 */
export const signCapability = wireEmitter(
  'server.wire.capability-url',
  async function (
    secret: SigningSecret,
    options: SignCapabilityOptions,
    now: number = capabilityNow(),
  ): Promise<SignedCapability> {
    const ring = signingKeyRingFromSecret(secret);
    const key = capabilityOwnDataValue(options, 'key');
    const configuredMethod = capabilityOwnDataValue(options, 'method');
    const scope = capabilityOwnDataValue(options, 'scope');
    const configuredExpiresIn = capabilityOwnDataValue(options, 'expiresIn');
    const configuredOneTime = capabilityOwnDataValue(options, 'oneTime');
    const configuredAudience = capabilityOwnDataValue(options, 'audience');
    const method = configuredMethod ?? 'GET';
    const expiresIn = configuredExpiresIn ?? DEFAULT_CAPABILITY_TTL_MS;
    const audience = configuredAudience ?? DEFAULT_CAPABILITY_AUDIENCE;
    if (
      typeof key !== 'string' ||
      key.length === 0 ||
      (method !== 'GET' && method !== 'HEAD') ||
      (scope !== undefined && typeof scope !== 'string') ||
      typeof expiresIn !== 'number' ||
      !capabilityIsSafeInteger(expiresIn) ||
      expiresIn <= 0 ||
      (configuredOneTime !== undefined && typeof configuredOneTime !== 'boolean') ||
      typeof audience !== 'string' ||
      audience.length === 0 ||
      !isValidClock(now) ||
      !capabilityIsSafeInteger(now + expiresIn)
    ) {
      throw capabilityTypeError('Capability signing options must contain valid, bounded claims.');
    }
    const claims: CapabilityClaims = {
      key,
      method,
      expiry: now + expiresIn,
      ...(scope === undefined ? {} : { scope }),
    };
    const oneTime = configuredOneTime === true;
    // A per-token nonce gives one-time tokens a stable replay id even when claims are identical.
    const nonce = oneTime ? capabilityBase64Url(capabilityRandomBytes(12)) : '';
    const signedBytes = canonicalizeWithNonce(claims, oneTime, nonce, ring.currentKeyId);
    const signedResult = ring.sign({
      audience,
      payload: signedBytes,
      purpose: CAPABILITY_SIGNING_PURPOSE,
    });
    const signedKeyId = capabilityOwnDataValue(signedResult, 'keyId');
    const signature = capabilityOwnDataValue(signedResult, 'signature');
    if (
      typeof signedKeyId !== 'string' ||
      signedKeyId !== ring.currentKeyId ||
      !isSafeKeyIdText(signedKeyId) ||
      typeof signature !== 'string' ||
      !isCanonicalSignature(signature)
    ) {
      throw capabilityTypeError('SigningKeyRing returned an invalid capability signature.');
    }
    const payloadB64 = capabilityBase64Url(
      capabilityEncode(serializeCapabilityPayload(signedKeyId, claims, oneTime, nonce)),
    );
    const token = `${payloadB64}.${signature}`;
    return { token, claims, oneTime };
  },
);

/**
 * Verify a capability token against the *expected* claims the download route derives from the
 * request (the requested key + method + the route's scope), the secret, and the clock. The
 * route MUST pass the key/method it is about to read — verification re-canonicalizes those, so a
 * token for `a.pdf` cannot authorize reading `b.pdf` even if the signature is otherwise valid.
 *
 * Order (fail-closed): parse → re-canonicalize received fields → constant-time signature check →
 * expiry → claim match → (if one-time) burn in the replay store. The keyring performs the signature
 * comparison in constant time; authenticated route claims are then compared exactly.
 *
 * @returns `{ ok: true, claims }` only when every check passes; otherwise `{ ok: false, reason }`.
 *          Callers MUST NOT leak `reason` to the client (return a generic 403/404).
 */
export const verifyCapability = securityClassifier(
  'server.auth.verify-capability-url',
  async function (
    secret: SigningSecret,
    token: string,
    expected: { key: string; method: CapabilityMethod; scope?: string },
    options: { audience?: string; now?: number; replayStore?: CapabilityReplayStore } = {},
  ): Promise<CapabilityVerifyResult> {
    try {
      if (typeof token !== 'string') return { ok: false, reason: 'malformed' };
      const expectedKey = capabilityOwnDataValue(expected, 'key');
      const expectedMethod = capabilityOwnDataValue(expected, 'method');
      const expectedScope = capabilityOwnDataValue(expected, 'scope');
      const configuredNow = capabilityOwnDataValue(options, 'now');
      const configuredAudience = capabilityOwnDataValue(options, 'audience');
      const configuredReplayStore = capabilityOwnDataValue(options, 'replayStore');
      const now = configuredNow ?? capabilityNow();
      const audience = configuredAudience ?? DEFAULT_CAPABILITY_AUDIENCE;
      if (
        typeof expectedKey !== 'string' ||
        expectedKey.length === 0 ||
        (expectedMethod !== 'GET' && expectedMethod !== 'HEAD') ||
        (expectedScope !== undefined && typeof expectedScope !== 'string') ||
        typeof now !== 'number' ||
        !isValidClock(now) ||
        typeof audience !== 'string' ||
        audience.length === 0
      ) {
        return { ok: false, reason: 'malformed' };
      }

      const dot = capabilityStringIndexOf(token, '.');
      if (dot <= 0 || capabilityStringIndexOf(token, '.', dot + 1) !== -1) {
        return { ok: false, reason: 'malformed' };
      }
      const payloadBytes = capabilityFromBase64Url(capabilityStringSlice(token, 0, dot));
      const signature = capabilityStringSlice(token, dot + 1);
      if (payloadBytes === undefined || !isCanonicalSignature(signature)) {
        return { ok: false, reason: 'malformed' };
      }

      const payload = parseCapabilityPayload(payloadBytes);
      if (payload === undefined) return { ok: false, reason: 'malformed' };
      const claims: CapabilityClaims = {
        key: payload.key,
        method: payload.method,
        expiry: payload.expiry,
        ...(payload.scope === undefined ? {} : { scope: payload.scope }),
      };

      // Recompute the signature over every received authority field, including key id and replay
      // posture. The keyring owns the constant-time signature comparison.
      const verification = signingKeyRingFromSecret(secret).verify({
        audience,
        keyId: payload.keyId,
        payload: canonicalizeWithNonce(claims, payload.oneTime, payload.nonce, payload.keyId),
        purpose: CAPABILITY_SIGNING_PURPOSE,
        signature,
      });
      if (!verification.ok) return { ok: false, reason: 'bad-signature' };

      if (now >= claims.expiry) return { ok: false, reason: 'expired' };

      if (
        (expectedScope !== undefined && !isStableProvenPrincipal(expectedScope)) ||
        (claims.scope !== undefined && !isStableProvenPrincipal(claims.scope))
      ) {
        return { ok: false, reason: 'claim-mismatch' };
      }

      // The token's claims must match what the route is about to do. The route derives `expected`
      // from the request URL, not from the token — this is what makes the token un-substitutable.
      if (
        claims.key !== expectedKey ||
        claims.method !== expectedMethod ||
        (claims.scope ?? '') !== (expectedScope ?? '')
      ) {
        return { ok: false, reason: 'claim-mismatch' };
      }

      if (payload.oneTime) {
        if (configuredReplayStore === undefined) {
          // A one-time token without a replay store cannot be enforced — fail closed.
          return { ok: false, reason: 'replayed' };
        }
        let replayStore: CapabilityReplayStore;
        try {
          replayStore = snapshotReplayStore(configuredReplayStore);
        } catch {
          return { ok: false, reason: 'replayed' };
        }
        const replayId = `${TOKEN_VERSION}:${claims.key}:${payload.nonce}`;
        try {
          const fresh = await replayStore.consume(replayId, claims.expiry);
          if (fresh !== true) return { ok: false, reason: 'replayed' };
        } catch {
          return { ok: false, reason: 'replayed' };
        }
      }

      return { ok: true, claims };
    } catch {
      return { ok: false, reason: 'malformed' };
    }
  },
);

interface ParsedCapabilityPayload {
  readonly keyId: string;
  readonly method: CapabilityMethod;
  readonly key: string;
  readonly expiry: number;
  readonly scope?: string;
  readonly oneTime: boolean;
  readonly nonce: string;
}

function parseCapabilityPayload(bytes: Uint8Array): ParsedCapabilityPayload | undefined {
  let source: string;
  let parsed: unknown;
  try {
    source = capabilityDecode(bytes);
    parsed = capabilityJsonParse(source);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || !capabilityHasRecordPrototype(parsed)) {
    return undefined;
  }
  const keys = capabilityOwnKeys(parsed);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== 'string' || !isCapabilityPayloadKey(key)) return undefined;
  }
  const version = capabilityOwnDataValue(parsed, 'v');
  const keyId = capabilityOwnDataValue(parsed, 'i');
  const method = capabilityOwnDataValue(parsed, 'm');
  const key = capabilityOwnDataValue(parsed, 'k');
  const expiry = capabilityOwnDataValue(parsed, 'e');
  const scope = capabilityOwnDataValue(parsed, 's');
  const oneTimeFlag = capabilityOwnDataValue(parsed, 'o');
  const nonceValue = capabilityOwnDataValue(parsed, 'n');
  if (
    version !== TOKEN_VERSION ||
    typeof keyId !== 'string' ||
    !isSafeKeyIdText(keyId) ||
    (method !== 'GET' && method !== 'HEAD') ||
    typeof key !== 'string' ||
    key.length === 0 ||
    typeof expiry !== 'number' ||
    !isValidExpiry(expiry) ||
    (scope !== undefined && typeof scope !== 'string') ||
    (oneTimeFlag !== undefined && oneTimeFlag !== 1)
  ) {
    return undefined;
  }
  const oneTime = oneTimeFlag === 1;
  let nonce = '';
  if (oneTime) {
    if (typeof nonceValue !== 'string' || !isCapabilityNonce(nonceValue)) return undefined;
    nonce = nonceValue;
  } else if (nonceValue !== undefined) {
    return undefined;
  }
  const claims: CapabilityClaims = {
    key,
    method,
    expiry,
    ...(scope === undefined ? {} : { scope }),
  };
  if (source !== serializeCapabilityPayload(keyId, claims, oneTime, nonce)) return undefined;
  return capabilityFreeze({
    keyId,
    method,
    key,
    expiry,
    ...(scope === undefined ? {} : { scope }),
    oneTime,
    nonce,
  });
}

function serializeCapabilityPayload(
  keyId: string,
  claims: CapabilityClaims,
  oneTime: boolean,
  nonce: string,
): string {
  let value =
    `{"v":${capabilityJsonQuote(TOKEN_VERSION)},` +
    `"i":${capabilityJsonQuote(keyId)},` +
    `"m":${capabilityJsonQuote(claims.method)},` +
    `"k":${capabilityJsonQuote(claims.key)},` +
    `"e":${capabilityString(claims.expiry)}`;
  if (claims.scope !== undefined) value += `,"s":${capabilityJsonQuote(claims.scope)}`;
  if (oneTime) value += `,"o":1,"n":${capabilityJsonQuote(nonce)}`;
  return `${value}}`;
}

function isCapabilityPayloadKey(value: string): boolean {
  return (
    value === 'v' ||
    value === 'i' ||
    value === 'm' ||
    value === 'k' ||
    value === 'e' ||
    value === 's' ||
    value === 'o' ||
    value === 'n'
  );
}

function isCanonicalSignature(value: string): boolean {
  const bytes = capabilityFromBase64Url(value);
  return bytes !== undefined && bytes.length === 32 && capabilityBase64Url(bytes) === value;
}

function isCapabilityNonce(value: string): boolean {
  const bytes = capabilityFromBase64Url(value);
  return bytes !== undefined && bytes.length === 12 && capabilityBase64Url(bytes) === value;
}

function isSafeKeyIdText(value: string): boolean {
  if (value.length === 0 || value.length > 256) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = capabilityStringCharCodeAt(value, index);
    if (
      !(
        (code >= 0x30 && code <= 0x39) ||
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        code === 0x2d ||
        code === 0x5f
      )
    ) {
      return false;
    }
  }
  return true;
}

function isValidClock(value: number): boolean {
  return capabilityIsFinite(value) && capabilityIsSafeInteger(value) && value >= 0;
}

function isValidExpiry(value: number): boolean {
  return isValidClock(value) && value > 0;
}

function isStableProvenPrincipal(value: string): boolean {
  try {
    if (!isProvenPrincipal(value) || capabilityStringTrim(value) !== value || value === '') {
      return false;
    }
    const normalized = capabilityStringToLowerCase(value);
    return normalized !== 'anonymous' && normalized !== 'unknown' && normalized !== 'unresolved';
  } catch {
    return false;
  }
}

export function snapshotReplayStore(source: unknown): CapabilityReplayStore {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw capabilityTypeError('Capability replay store must be an object.');
  }
  const consume = capabilityStableProperty(source, 'consume');
  if (typeof consume !== 'function') {
    throw capabilityTypeError('Capability replay store must expose a stable consume function.');
  }
  return capabilityFreeze({
    consume(id: string, expiresAt: number): boolean | Promise<boolean> {
      return capabilityReflectApply(consume, source, [id, expiresAt]);
    },
  });
}
