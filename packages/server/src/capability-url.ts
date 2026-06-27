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
 * Canonicalization: we sign over a canonical, unambiguous byte string built from the tuple
 * `(method, key, expiry, scope)` with length-prefixed fields, so two different tuples can never
 * produce the same signed bytes (no delimiter-injection / field-confusion). Canonicalize BEFORE
 * signing and verify by re-canonicalizing the *received* fields, never by parsing the signature.
 *
 * The framework route is shipped in `capability-route.ts`: `createStorageDownloadEndpoint` mounts
 * the verify-before-read sink, `ctx.signUrl` mints URLs pointing at that route, and mint facts are
 * drained for `kovo explain --capabilities`.
 */

import { signingKeyRingFromSecret, type SigningSecret } from './keyring.js';

const TOKEN_VERSION = 'v1';
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
  const consumed = new Map<string, number>();
  const now = options.now ?? Date.now;
  const evict = (): void => {
    const current = now();
    for (const [id, expiry] of consumed) if (expiry <= current) consumed.delete(id);
  };
  return {
    consume(id: string, expiresAt: number): boolean {
      evict();
      if (consumed.has(id)) return false;
      // Hold the replay id only until the signed token expiry. After that, the expiry check rejects
      // the token before replay lookup, so retaining the id no longer buys security.
      consumed.set(id, expiresAt);
      return true;
    },
    size(): number {
      evict();
      return consumed.size;
    },
  };
}

const encoder = new TextEncoder();

/**
 * Build the canonical, length-prefixed byte string signed over. Length prefixes make field
 * boundaries unambiguous so `(key="a", scope="bc")` and `(key="ab", scope="c")` never collide.
 */
function canonicalize(claims: CapabilityClaims): Uint8Array {
  const fields = [
    TOKEN_VERSION,
    claims.method,
    claims.key,
    String(claims.expiry),
    claims.scope ?? '',
  ];
  const parts = fields.map((f) => {
    const bytes = encoder.encode(f);
    return `${bytes.length}:${f}`;
  });
  return encoder.encode(parts.join('|'));
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Mint a capability token over a storage object. Canonicalize-before-sign: the signed bytes are
 * built from the resolved claims, not from any client-supplied string.
 *
 * @param secret - The framework signing secret (NOT app-controlled per request).
 * @param options - `{ key, method?, scope?, expiresIn?, oneTime? }`.
 * @param now - Injectable clock (epoch ms) for tests.
 */
export async function signCapability(
  secret: SigningSecret,
  options: SignCapabilityOptions,
  now: number = Date.now(),
): Promise<SignedCapability> {
  const claims: CapabilityClaims = {
    key: options.key,
    method: options.method ?? 'GET',
    expiry: now + (options.expiresIn ?? DEFAULT_CAPABILITY_TTL_MS),
    ...(options.scope === undefined ? {} : { scope: options.scope }),
  };
  const oneTime = options.oneTime === true;
  // A per-token nonce gives one-time tokens a stable replay id even when claims are identical.
  const nonce = oneTime ? base64url(crypto.getRandomValues(new Uint8Array(12))) : '';
  const signedBytes = canonicalizeWithNonce(claims, oneTime, nonce);
  const signed = signingKeyRingFromSecret(secret).sign({
    audience: options.audience ?? DEFAULT_CAPABILITY_AUDIENCE,
    payload: signedBytes,
    purpose: CAPABILITY_SIGNING_PURPOSE,
  });
  const payload = {
    v: TOKEN_VERSION,
    i: signed.keyId,
    m: claims.method,
    k: claims.key,
    e: claims.expiry,
    ...(claims.scope === undefined ? {} : { s: claims.scope }),
    ...(oneTime ? { o: 1, n: nonce } : {}),
  };
  const payloadB64 = base64url(encoder.encode(JSON.stringify(payload)));
  const token = `${payloadB64}.${signed.signature}`;
  return { token, claims, oneTime };
}

/** Canonical bytes including the one-time flag + nonce so the signature commits to them too. */
function canonicalizeWithNonce(
  claims: CapabilityClaims,
  oneTime: boolean,
  nonce: string,
): Uint8Array {
  const base = canonicalize(claims);
  const suffix = encoder.encode(`|${oneTime ? '1' : '0'}:${nonce}`);
  const out = new Uint8Array(base.length + suffix.length);
  out.set(base, 0);
  out.set(suffix, base.length);
  return out;
}

/**
 * Verify a capability token against the *expected* claims the download route derives from the
 * request (the requested key + method + the route's scope), the secret, and the clock. The
 * route MUST pass the key/method it is about to read — verification re-canonicalizes those, so a
 * token for `a.pdf` cannot authorize reading `b.pdf` even if the signature is otherwise valid.
 *
 * Order (fail-closed): parse → re-canonicalize received fields → constant-time signature check →
 * expiry → claim match → (if one-time) burn in the replay store. The signature is checked before
 * the claim comparison, and the comparison is constant-time, so neither leaks a timing oracle.
 *
 * @returns `{ ok: true, claims }` only when every check passes; otherwise `{ ok: false, reason }`.
 *          Callers MUST NOT leak `reason` to the client (return a generic 403/404).
 */
export async function verifyCapability(
  secret: SigningSecret,
  token: string,
  expected: { key: string; method: CapabilityMethod; scope?: string },
  options: { audience?: string; now?: number; replayStore?: CapabilityReplayStore } = {},
): Promise<CapabilityVerifyResult> {
  const now = options.now ?? Date.now();
  const dot = token.indexOf('.');
  if (dot <= 0) return { ok: false, reason: 'malformed' };
  const payloadBytes = fromBase64url(token.slice(0, dot));
  const signatureBytes = fromBase64url(token.slice(dot + 1));
  if (!payloadBytes || !signatureBytes) return { ok: false, reason: 'malformed' };

  let payload: {
    v?: string;
    m?: string;
    k?: string;
    e?: number;
    i?: string;
    s?: string;
    o?: number;
    n?: string;
  };
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    payload.v !== TOKEN_VERSION ||
    (payload.m !== 'GET' && payload.m !== 'HEAD') ||
    typeof payload.k !== 'string' ||
    typeof payload.e !== 'number' ||
    (payload.i !== undefined && typeof payload.i !== 'string')
  ) {
    return { ok: false, reason: 'malformed' };
  }

  const claims: CapabilityClaims = {
    key: payload.k,
    method: payload.m,
    expiry: payload.e,
    ...(payload.s === undefined ? {} : { scope: payload.s }),
  };
  const oneTime = payload.o === 1;
  const nonce = typeof payload.n === 'string' ? payload.n : '';

  // Recompute the signature over the canonicalized *received* fields and compare in constant time.
  const verification = signingKeyRingFromSecret(secret).verify({
    audience: options.audience ?? DEFAULT_CAPABILITY_AUDIENCE,
    ...(payload.i === undefined ? {} : { keyId: payload.i }),
    payload: canonicalizeWithNonce(claims, oneTime, nonce),
    purpose: CAPABILITY_SIGNING_PURPOSE,
    signature: base64url(signatureBytes),
  });
  if (!verification.ok) {
    return { ok: false, reason: 'bad-signature' };
  }

  if (now >= claims.expiry) return { ok: false, reason: 'expired' };

  // The token's claims must match what the route is about to do. The route derives `expected`
  // from the request URL, not from the token — this is what makes the token un-substitutable.
  if (
    claims.key !== expected.key ||
    claims.method !== expected.method ||
    (claims.scope ?? '') !== (expected.scope ?? '')
  ) {
    return { ok: false, reason: 'claim-mismatch' };
  }

  if (oneTime) {
    if (!options.replayStore) {
      // A one-time token without a replay store cannot be enforced — fail closed.
      return { ok: false, reason: 'replayed' };
    }
    const replayId = `${TOKEN_VERSION}:${claims.key}:${nonce}`;
    const fresh = await options.replayStore.consume(replayId, claims.expiry);
    if (!fresh) return { ok: false, reason: 'replayed' };
  }

  return { ok: true, claims };
}
