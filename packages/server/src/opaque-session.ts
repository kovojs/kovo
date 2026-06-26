import { randomBytes } from 'node:crypto';

import { serializeCookie, type CookieOptions } from './cookies.js';
import type { SessionProvider } from './guards.js';
import { markNormalizedSessionProvider } from './session-provider-boundary.js';

const OPAQUE_SESSION_PROVIDER = Symbol('kovo.opaqueSessionProvider');

/** Stable rejection code for an opaque session lookup that did not produce a live session. */
export type OpaqueSessionRejectReason = 'missing' | 'malformed' | 'expired' | 'revoked';

/** A live opaque session record returned only after store validation. */
export interface OpaqueSessionRecord<SessionValue> {
  /** Opaque bearer id minted by the Kovo-owned store. It is not a client-readable payload. */
  id: string;
  /** Absolute creation time as epoch milliseconds. */
  createdAt: number;
  /** Absolute expiry as epoch milliseconds. */
  expiresAt: number;
  /** The typed app session value exposed through `req.session` after validation. */
  value: SessionValue;
}

/** Result of validating an opaque session id against the store. */
export type OpaqueSessionValidation<SessionValue> =
  | { ok: true; session: OpaqueSessionRecord<SessionValue> }
  | { ok: false; reason: OpaqueSessionRejectReason };

/** Options used when minting or rotating an opaque session. */
export interface OpaqueSessionEstablishOptions {
  /** Time-to-live in milliseconds. Defaults to the store's configured TTL. */
  ttlMs?: number;
}

/**
 * Framework-owned opaque session store contract.
 *
 * SPEC §6.5 currently models session provenance as an app `sessionProvider` capability; this
 * store is the Kovo-owned boundary an app can choose for that provider. The credential crossing
 * the browser boundary is only an opaque lookup key: validation, rotation, expiry, and revocation
 * happen at the store before `req.session` is populated.
 */
export interface OpaqueSessionStore<SessionValue> {
  /** Mint a fresh opaque id and store the session value. */
  create(
    value: SessionValue,
    options?: OpaqueSessionEstablishOptions,
  ): OpaqueSessionRecord<SessionValue> | Promise<OpaqueSessionRecord<SessionValue>>;

  /** Validate a presented id against current, unexpired, non-revoked store state. */
  validate(
    id: string,
  ): OpaqueSessionValidation<SessionValue> | Promise<OpaqueSessionValidation<SessionValue>>;

  /**
   * Rotate a session id by minting a replacement and revoking the prior id immediately.
   * This is the fixation floor needed when an anonymous/pre-auth session becomes authenticated.
   */
  rotate(
    priorId: string,
    value: SessionValue,
    options?: OpaqueSessionEstablishOptions,
  ): OpaqueSessionRecord<SessionValue> | Promise<OpaqueSessionRecord<SessionValue>>;

  /** Revoke a session id immediately. Repeated revocation is a no-op. */
  revoke(id: string): void | Promise<void>;
}

/** Bounded in-memory opaque session store options. */
export interface MemoryOpaqueSessionStoreOptions {
  /** Maximum live records retained before oldest records are evicted. Defaults to 10,000. */
  maxEntries?: number;
  /** Default TTL for minted sessions. Defaults to 7 days. */
  ttlMs?: number;
  /** Optional clock hook for tests. */
  now?: () => number;
}

/** Options for creating a Kovo-owned opaque session manager. */
export interface OpaqueSessionManagerOptions<SessionValue> {
  /** Store that owns mint/validate/rotate/revoke semantics. */
  store: OpaqueSessionStore<SessionValue>;
  /** Cookie name used for browser session credentials. Defaults to `kovo_session`. */
  cookieName?: string;
  /** Additional typed cookie options. `class: 'session'` and `path: '/'` are always applied. */
  cookie?: Omit<CookieOptions, 'class' | 'maxAge'>;
  /** Accept `Authorization: Bearer <id>` as an alternate credential source. Defaults to false. */
  acceptAuthorizationHeader?: boolean;
}

/** Result of establishing or rotating an opaque browser session. */
export interface OpaqueSessionEstablishResult<SessionValue> {
  /** Fresh store-backed session record. */
  session: OpaqueSessionRecord<SessionValue>;
  /** Hardened `Set-Cookie` header carrying only the opaque id. */
  setCookie: string;
}

/** Result of revoking an opaque browser session. */
export interface OpaqueSessionRevokeResult {
  /** Expiring `Set-Cookie` header for the configured session cookie name. */
  setCookie: string;
}

/**
 * Kovo-owned opaque session manager.
 *
 * The manager is intentionally honest about today's lifecycle: it returns a `provider` compatible
 * with `createApp({ sessionProvider })`, plus establish/revoke sinks an auth flow can call. It does
 * not silently replace every Better Auth adapter, but it makes the owned opaque-store boundary
 * available with rotation and immediate revocation semantics.
 */
export interface OpaqueSessionManager<SessionValue> {
  /** Session cookie name configured for this manager. */
  cookieName: string;
  /** Validate a raw opaque id against the store. */
  validate(id: string | null | undefined): Promise<OpaqueSessionValidation<SessionValue>>;
  /** Extract an id from cookie/header material and validate it against the store. */
  validateRequest(request: Request): Promise<OpaqueSessionValidation<SessionValue>>;
  /** `sessionProvider` adapter that exposes only a store-validated session value. */
  provider: SessionProvider<Request, SessionValue>;
  /** Mint or rotate a browser session and return the hardened `Set-Cookie` header. */
  establish(
    value: SessionValue,
    options?: OpaqueSessionEstablishOptions & { priorId?: string | null | undefined },
  ): Promise<OpaqueSessionEstablishResult<SessionValue>>;
  /** Revoke an id immediately and return an expiring session cookie header. */
  revoke(id: string | null | undefined): Promise<OpaqueSessionRevokeResult>;
}

/**
 * @internal Runtime marker for Kovo-owned opaque-session providers. The request shell uses this
 * to reject `createApp({ sessionProvider: manager.provider })`, which would otherwise make a
 * Kovo-owned lifecycle look like an explicit delegated boundary without exposing the manager.
 */
export function isOpaqueSessionProvider(
  value: unknown,
): value is SessionProvider<Request, unknown> {
  return (
    typeof value === 'function' &&
    (value as { [OPAQUE_SESSION_PROVIDER]?: true })[OPAQUE_SESSION_PROVIDER] === true
  );
}

const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 10_000;
const OPAQUE_ID_BYTES = 32;
const OPAQUE_ID_PATTERN = /^kos_[A-Za-z0-9_-]{43}$/;
const AMBIGUOUS_OPAQUE_SESSION_ID = '__kovo_ambiguous_opaque_session__';

/** Create a bounded in-memory opaque session store for tests, local dev, or single-process apps. */
export function createMemoryOpaqueSessionStore<SessionValue>(
  options: MemoryOpaqueSessionStoreOptions = {},
): OpaqueSessionStore<SessionValue> & { size(): number } {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error('MemoryOpaqueSessionStore maxEntries must be a positive integer');
  }
  const defaultTtlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  if (!Number.isInteger(defaultTtlMs) || defaultTtlMs < 1) {
    throw new Error('MemoryOpaqueSessionStore ttlMs must be a positive integer');
  }
  const now = options.now ?? Date.now;
  const records = new Map<string, OpaqueSessionRecord<SessionValue>>();
  const revoked = new Set<string>();

  const evict = (options: { pruneExpired?: boolean } = {}): void => {
    const pruneExpired = options.pruneExpired ?? true;
    const current = now();
    for (const [id, record] of records) {
      if (revoked.has(id) || (pruneExpired && record.expiresAt <= current)) records.delete(id);
    }
    while (records.size > maxEntries) {
      const oldest = records.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      records.delete(oldest);
      revoked.add(oldest);
    }
    while (revoked.size > maxEntries) {
      const oldest = revoked.keys().next().value;
      if (oldest === undefined) break;
      revoked.delete(oldest);
    }
  };

  const create = (
    value: SessionValue,
    establishOptions: OpaqueSessionEstablishOptions = {},
  ): OpaqueSessionRecord<SessionValue> => {
    evict();
    const ttlMs = establishOptions.ttlMs ?? defaultTtlMs;
    if (!Number.isInteger(ttlMs) || ttlMs < 1) {
      throw new Error('Opaque session ttlMs must be a positive integer');
    }
    let id = mintOpaqueSessionId();
    while (records.has(id) || revoked.has(id)) id = mintOpaqueSessionId();
    const createdAt = now();
    const expiresAt = createdAt + ttlMs;
    if (!isCoherentEpochMillisecond(createdAt) || !isCoherentEpochMillisecond(expiresAt)) {
      throw new Error(
        'Opaque session clock must return a non-negative safe integer epoch millisecond',
      );
    }
    const record = { id, createdAt, expiresAt, value };
    records.set(id, record);
    evict();
    return record;
  };

  return {
    create,
    validate(id: string): OpaqueSessionValidation<SessionValue> {
      evict({ pruneExpired: false });
      if (!isOpaqueSessionId(id)) return { ok: false, reason: 'malformed' };
      if (revoked.has(id)) return { ok: false, reason: 'revoked' };
      const record = records.get(id);
      if (record === undefined) return { ok: false, reason: 'missing' };
      if (record.expiresAt <= now()) {
        records.delete(id);
        revoked.add(id);
        evict();
        return { ok: false, reason: 'expired' };
      }
      return { ok: true, session: record };
    },
    rotate(
      priorId: string,
      value: SessionValue,
      establishOptions?: OpaqueSessionEstablishOptions,
    ): OpaqueSessionRecord<SessionValue> {
      const next = create(value, establishOptions);
      records.delete(priorId);
      revoked.add(priorId);
      evict();
      return next;
    },
    revoke(id: string): void {
      records.delete(id);
      revoked.add(id);
      evict();
    },
    size(): number {
      evict();
      return records.size;
    },
  };
}

/** Create a manager that adapts an opaque store into Kovo's current `sessionProvider` lifecycle. */
export function createOpaqueSessionManager<SessionValue>(
  options: OpaqueSessionManagerOptions<SessionValue>,
): OpaqueSessionManager<SessionValue> {
  assertOpaqueSessionManagerOptions(options);
  const cookieName = options.cookieName ?? 'kovo_session';
  const cookieOptions: CookieOptions = {
    ...options.cookie,
    class: 'session',
    path: options.cookie?.path ?? '/',
  };

  const validate = async (
    id: string | null | undefined,
  ): Promise<OpaqueSessionValidation<SessionValue>> => {
    if (id === null || id === undefined || id === '') return { ok: false, reason: 'missing' };
    if (!isOpaqueSessionId(id)) return { ok: false, reason: 'malformed' };
    try {
      return normalizeOpaqueSessionValidation(id, await options.store.validate(id));
    } catch {
      // SPEC §6.5 / OPP-11: the request shell treats absent or invalid owned-session material as
      // anonymous. A store outage or adapter bug must not turn browser credentials into a request
      // lifecycle exception.
      return { ok: false, reason: 'malformed' };
    }
  };
  const provider: SessionProvider<Request, SessionValue> = async (
    request: Request,
  ): Promise<SessionValue | null> => {
    const result = await validate(
      extractOpaqueSessionId(request, cookieName, options.acceptAuthorizationHeader),
    );
    return result.ok ? result.session.value : null;
  };
  Object.defineProperty(provider, OPAQUE_SESSION_PROVIDER, {
    value: true,
  });
  markNormalizedSessionProvider(provider, 'owned');

  return {
    cookieName,
    validate,
    async validateRequest(request: Request): Promise<OpaqueSessionValidation<SessionValue>> {
      return validate(
        extractOpaqueSessionId(request, cookieName, options.acceptAuthorizationHeader),
      );
    },
    provider,
    async establish(
      value: SessionValue,
      establishOptions: OpaqueSessionEstablishOptions & {
        priorId?: string | null | undefined;
      } = {},
    ): Promise<OpaqueSessionEstablishResult<SessionValue>> {
      const rawSession =
        establishOptions.priorId === null || establishOptions.priorId === undefined
          ? await options.store.create(value, establishOptions)
          : await rotateOpaqueSession(
              options.store,
              establishOptions.priorId,
              value,
              establishOptions.ttlMs === undefined ? {} : { ttlMs: establishOptions.ttlMs },
            );
      const session = assertEstablishedOpaqueSession(rawSession);
      return {
        session,
        setCookie: serializeCookie(cookieName, session.id, {
          ...cookieOptions,
          // SPEC §6.5 / OPP-11: the browser credential must not outlive the store-backed
          // lifecycle. Derive cookie expiry from the store's absolute expiry at emission time,
          // not from a store-supplied createdAt delta.
          expires: new Date(session.expiresAt),
          maxAge: resolveOpaqueSessionCookieMaxAge(session),
        }),
      };
    },
    async revoke(id: string | null | undefined): Promise<OpaqueSessionRevokeResult> {
      if (id !== null && id !== undefined && id !== '') {
        await revokeOpaqueSession(options.store, id);
      }
      return {
        setCookie: serializeCookie(cookieName, '', {
          ...cookieOptions,
          expires: new Date(0),
          maxAge: 0,
        }),
      };
    },
  };
}

async function revokeOpaqueSession<SessionValue>(
  store: OpaqueSessionStore<SessionValue>,
  id: string,
): Promise<void> {
  await store.revoke(id);
  if (!isOpaqueSessionId(id)) return;

  let revoked: OpaqueSessionValidation<SessionValue>;
  try {
    revoked = normalizeOpaqueSessionValidation(id, await store.validate(id));
  } catch {
    throw new Error(
      'Opaque session store could not verify revocation; refusing to emit a browser session clearing cookie',
    );
  }
  if (revoked.ok) {
    throw new Error(
      'Opaque session store did not immediately revoke the id; refusing to emit a browser session clearing cookie',
    );
  }
}

async function rotateOpaqueSession<SessionValue>(
  store: OpaqueSessionStore<SessionValue>,
  priorId: string,
  value: SessionValue,
  options?: OpaqueSessionEstablishOptions,
): Promise<OpaqueSessionRecord<SessionValue>> {
  if (priorId === '') {
    throw new Error(
      'Opaque session rotation requires a live prior session; validation rejected it as missing',
    );
  }
  const prior = normalizeOpaqueSessionValidation(priorId, await store.validate(priorId));
  if (!prior.ok) {
    throw new Error(
      `Opaque session rotation requires a live prior session; validation rejected it as ${prior.reason}`,
    );
  }

  const next = assertEstablishedOpaqueSession(await store.rotate(priorId, value, options));
  if (next.id === priorId) {
    throw new Error(
      'Opaque session store returned the prior id during rotation; refusing to set a browser session cookie',
    );
  }

  const revokedPrior = normalizeOpaqueSessionValidation(priorId, await store.validate(priorId));
  if (revokedPrior.ok) {
    throw new Error(
      'Opaque session store did not immediately revoke the prior id during rotation; refusing to set a browser session cookie',
    );
  }
  return next;
}

function normalizeOpaqueSessionValidation<SessionValue>(
  presentedId: string,
  result: unknown,
): OpaqueSessionValidation<SessionValue> {
  // SPEC §6.5 / OPP-11: custom stores sit on the owned session trust boundary. Treat
  // malformed validation outcomes as anonymous/malformed instead of throwing or accepting an
  // undeclared lifecycle reason.
  if (result === null || typeof result !== 'object') return { ok: false, reason: 'malformed' };
  const validation = result as {
    ok?: unknown;
    reason?: unknown;
    session?: unknown;
  };
  if (validation.ok !== true) {
    return isOpaqueSessionRejectReason(validation.reason)
      ? { ok: false, reason: validation.reason }
      : { ok: false, reason: 'malformed' };
  }
  const session = snapshotCoherentOpaqueSessionRecord<SessionValue>(validation.session);
  if (session === undefined || session.id !== presentedId) {
    return { ok: false, reason: 'malformed' };
  }
  return { ok: true, session };
}

function isOpaqueSessionRejectReason(value: unknown): value is OpaqueSessionRejectReason {
  return value === 'missing' || value === 'malformed' || value === 'expired' || value === 'revoked';
}

function assertEstablishedOpaqueSession<SessionValue>(
  session: OpaqueSessionRecord<SessionValue>,
): OpaqueSessionRecord<SessionValue> {
  const snapshot = snapshotCoherentOpaqueSessionRecord<SessionValue>(session);
  if (snapshot === undefined) {
    throw new Error(
      'Opaque session store returned a malformed session record; refusing to set a browser session cookie',
    );
  }
  return snapshot;
}

function resolveOpaqueSessionCookieMaxAge<SessionValue>(
  session: OpaqueSessionRecord<SessionValue>,
): number {
  const remainingMs = session.expiresAt - Date.now();
  if (remainingMs <= 0) {
    throw new Error(
      'Opaque session store returned an expired session record; refusing to set a browser session cookie',
    );
  }
  return Math.max(1, Math.floor(remainingMs / 1000));
}

function isCoherentOpaqueSessionRecord<SessionValue>(
  value: unknown,
): value is OpaqueSessionRecord<SessionValue> {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Partial<OpaqueSessionRecord<SessionValue>>;
  const { createdAt, expiresAt, id } = record;
  return (
    typeof id === 'string' &&
    isOpaqueSessionId(id) &&
    isCoherentEpochMillisecond(createdAt) &&
    isCoherentEpochMillisecond(expiresAt) &&
    expiresAt > createdAt &&
    'value' in record
  );
}

function isCoherentEpochMillisecond(value: unknown): value is number {
  // SPEC §6.5 / OPP-11: owned session lifecycle times are store facts used to decide whether a
  // browser credential may remain live. Non-finite or fractional values fail closed.
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function snapshotCoherentOpaqueSessionRecord<SessionValue>(
  value: unknown,
): OpaqueSessionRecord<SessionValue> | undefined {
  if (!isCoherentOpaqueSessionRecord<SessionValue>(value)) return undefined;
  try {
    return {
      id: value.id,
      createdAt: value.createdAt,
      expiresAt: value.expiresAt,
      value: structuredClone(value.value) as SessionValue,
    };
  } catch {
    return undefined;
  }
}

function assertOpaqueSessionManagerOptions<SessionValue>(
  options: OpaqueSessionManagerOptions<SessionValue>,
): void {
  const store = options.store as Partial<OpaqueSessionStore<SessionValue>> | undefined;
  if (
    store === undefined ||
    typeof store.create !== 'function' ||
    typeof store.validate !== 'function' ||
    typeof store.rotate !== 'function' ||
    typeof store.revoke !== 'function'
  ) {
    throw new Error(
      'createOpaqueSessionManager requires an opaque session store with create, validate, rotate, and revoke methods',
    );
  }
  if (options.cookieName !== undefined) assertOpaqueSessionCookieName(options.cookieName);
}

function assertOpaqueSessionCookieName(cookieName: string): void {
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(cookieName)) {
    throw new Error('Opaque session cookieName must be an HTTP token');
  }
  if (cookieName.startsWith('__Host-') || cookieName.startsWith('__Secure-')) {
    throw new Error(
      'Opaque session cookieName must be the unprefixed base name; Kovo owns __Host-/__Secure- aliases for the session credential',
    );
  }
}

function mintOpaqueSessionId(): string {
  return `kos_${base64url(randomBytes(OPAQUE_ID_BYTES))}`;
}

function isOpaqueSessionId(id: string): boolean {
  return OPAQUE_ID_PATTERN.test(id);
}

function extractOpaqueSessionId(
  request: Request,
  cookieName: string,
  acceptAuthorizationHeader = false,
): string | null {
  const cookie = request.headers.get('cookie');
  const cookieId = cookie === null ? null : readCookie(cookie, cookieName);

  if (!acceptAuthorizationHeader) return cookieId;
  const authorization = request.headers.get('authorization');
  if (authorization === null) return cookieId;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  const headerId = match?.[1] ?? null;
  if (cookieId !== null && headerId !== null) return AMBIGUOUS_OPAQUE_SESSION_ID;
  return cookieId ?? headerId;
}

function readCookie(header: string, cookieName: string): string | null {
  const names = new Set([cookieName, `__Host-${cookieName}`, `__Secure-${cookieName}`]);
  let value: string | null = null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!names.has(name)) continue;
    // SPEC §6.5 / OPP-11: owned sessions fail closed on ambiguous credentials instead of
    // choosing a cookie alias by header order and silently changing session provenance.
    if (value !== null) return AMBIGUOUS_OPAQUE_SESSION_ID;
    try {
      value = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      value = part.slice(index + 1).trim();
    }
  }
  return value;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}
