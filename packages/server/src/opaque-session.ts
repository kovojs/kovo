import { randomBytes } from 'node:crypto';

import { serializeCookie, type CookieOptions } from './cookies.js';
import type { SessionProvider } from './guards.js';

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

const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 10_000;
const OPAQUE_ID_BYTES = 32;
const OPAQUE_ID_PATTERN = /^kos_[A-Za-z0-9_-]{43}$/;

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

  const evict = (): void => {
    const current = now();
    for (const [id, record] of records) {
      if (record.expiresAt <= current || revoked.has(id)) records.delete(id);
    }
    while (records.size > maxEntries) {
      const oldest = records.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      records.delete(oldest);
      revoked.add(oldest);
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
    const record = { id, createdAt, expiresAt: createdAt + ttlMs, value };
    records.set(id, record);
    evict();
    return record;
  };

  return {
    create,
    validate(id: string): OpaqueSessionValidation<SessionValue> {
      evict();
      if (!isOpaqueSessionId(id)) return { ok: false, reason: 'malformed' };
      if (revoked.has(id)) return { ok: false, reason: 'revoked' };
      const record = records.get(id);
      if (record === undefined) return { ok: false, reason: 'missing' };
      if (record.expiresAt <= now()) {
        records.delete(id);
        revoked.add(id);
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
      return next;
    },
    revoke(id: string): void {
      records.delete(id);
      revoked.add(id);
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
    return options.store.validate(id);
  };

  return {
    cookieName,
    validate,
    async validateRequest(request: Request): Promise<OpaqueSessionValidation<SessionValue>> {
      return validate(
        extractOpaqueSessionId(request, cookieName, options.acceptAuthorizationHeader),
      );
    },
    async provider(request: Request): Promise<SessionValue | null> {
      const result = await validate(
        extractOpaqueSessionId(request, cookieName, options.acceptAuthorizationHeader),
      );
      return result.ok ? result.session.value : null;
    },
    async establish(
      value: SessionValue,
      establishOptions: OpaqueSessionEstablishOptions & {
        priorId?: string | null | undefined;
      } = {},
    ): Promise<OpaqueSessionEstablishResult<SessionValue>> {
      const session = establishOptions.priorId
        ? await options.store.rotate(establishOptions.priorId, value, establishOptions)
        : await options.store.create(value, establishOptions);
      return {
        session,
        setCookie: serializeCookie(cookieName, session.id, {
          ...cookieOptions,
          maxAge: Math.max(1, Math.floor((session.expiresAt - session.createdAt) / 1000)),
        }),
      };
    },
    async revoke(id: string | null | undefined): Promise<OpaqueSessionRevokeResult> {
      if (id !== null && id !== undefined && id !== '') await options.store.revoke(id);
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
  if (cookieId !== null) return cookieId;

  if (!acceptAuthorizationHeader) return null;
  const authorization = request.headers.get('authorization');
  if (authorization === null) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

function readCookie(header: string, cookieName: string): string | null {
  const names = new Set([cookieName, `__Host-${cookieName}`, `__Secure-${cookieName}`]);
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!names.has(name)) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return part.slice(index + 1).trim();
    }
  }
  return null;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}
