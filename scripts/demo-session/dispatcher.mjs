import { randomUUID } from 'node:crypto';

// SPEC.md §9.5: a per-visitor multi-tenant front for the example app shells. The
// example apps are normally served as ONE process-wide instance (one seeded
// PGlite, shared by every request — the stateless demo). For a public, hosted
// demo we instead want every visitor to drive their OWN isolated, throwaway
// instance through the REAL server paths (SSR routes, `/_m/*` mutations,
// `/products?after=` pagination) — not the client-side static replay.
//
// This dispatcher keys a fresh app-shell node handler by an opaque session
// cookie. The first request from a browser mints a session id, sets the cookie,
// and lazily builds a fresh-DB handler for it; later requests carrying the
// cookie route back to the same in-memory instance. State is intentionally
// ephemeral (in-process PGlite) and bounded: idle sessions expire on a TTL and
// the live set is LRU-capped so memory stays finite under load.
//
// `buildHandler` returns a Node `(req, res)` handler over a freshly seeded app
// (the example factory called with no args already mints a fresh PGlite — see
// createCommerceAppShell / buildCrmInteractiveApp / buildSoInteractiveApp). It
// may be sync or async; the first request for a session awaits the build and
// concurrent requests for the same new session share one in-flight build. Hosted
// demo deployments can also prebuild a small warm pool, shifting that fresh-DB
// cost to instance startup/background replenishment instead of the visitor's
// first request.

const DEFAULT_COOKIE_NAME = 'kovo_demo_sid';
const DEFAULT_IDLE_MS = 20 * 60_000;
const DEFAULT_MAX_SESSIONS = 40;
export const DEMO_SESSION_HEADER = 'x-kovo-demo-sid';

/**
 * @param {{
 *   buildHandler: () => unknown,
 *   cookieName?: string,
 *   idleMs?: number,
 *   maxSessions?: number,
 *   warmSessions?: number,
 *   now?: () => number,
 *   genId?: () => string,
 *   onEvict?: (sid: string) => void,
 * }} options
 */
export function createPerSessionDispatcher({
  buildHandler,
  cookieName = DEFAULT_COOKIE_NAME,
  idleMs = DEFAULT_IDLE_MS,
  maxSessions = DEFAULT_MAX_SESSIONS,
  warmSessions = 0,
  now = () => Date.now(),
  genId = () => randomUUID(),
  onEvict,
} = {}) {
  if (typeof buildHandler !== 'function') {
    throw new TypeError('createPerSessionDispatcher requires a buildHandler function.');
  }
  if (!isCookieName(cookieName)) {
    throw new TypeError('createPerSessionDispatcher cookieName must be an HTTP cookie token.');
  }
  const productionCookies = process.env.NODE_ENV === 'production';
  const sessionCookieName = productionCookies ? hostCookieName(cookieName) : cookieName;

  /** @type {Map<string, { handler: unknown, pending: Promise<unknown> | null, lastSeen: number }>} */
  const sessions = new Map();
  /** @type {unknown[]} */
  const warmHandlers = [];
  /** @type {{ promise: Promise<unknown>, claimed: boolean }[]} */
  const pendingWarmups = [];
  const warmTarget = Math.max(0, Math.floor(Number(warmSessions) || 0));

  function evict(sid) {
    if (sessions.delete(sid)) onEvict?.(sid);
  }

  // Drop sessions idle past the TTL. Called on every dispatch so a quiet server
  // still reclaims memory the next time anyone knocks.
  function sweepIdle(at) {
    for (const [sid, session] of sessions) {
      if (at - session.lastSeen > idleMs) evict(sid);
    }
  }

  // Map iteration is insertion-ordered; re-inserting on touch (see touch()) keeps
  // the least-recently-used session at the front, so this caps the live set.
  function enforceCap() {
    while (sessions.size > maxSessions) {
      const oldest = sessions.keys().next().value;
      if (oldest === undefined) break;
      evict(oldest);
    }
  }

  function touch(sid, session, at) {
    session.lastSeen = at;
    sessions.delete(sid);
    sessions.set(sid, session);
  }

  function getSession(sid, at) {
    let session = sessions.get(sid);
    if (!session) {
      session = { handler: null, pending: null, lastSeen: at };
      sessions.set(sid, session);
      const warmHandler = warmHandlers.shift();
      if (warmHandler !== undefined) {
        session.handler = warmHandler;
        replenishWarmPool();
      } else {
        const pendingWarmup = pendingWarmups.find((warmup) => !warmup.claimed);
        if (pendingWarmup) {
          pendingWarmup.claimed = true;
          session.pending = pendingWarmup.promise.then(
            (handler) => settleSessionBuild(sid, session, handler),
            (error) => failSessionBuild(sid, error),
          );
        } else {
          const built = buildHandler();
          if (built && typeof built.then === 'function') {
            session.pending = Promise.resolve(built).then(
              (handler) => settleSessionBuild(sid, session, handler),
              (error) => failSessionBuild(sid, error),
            );
          } else {
            session.handler = built;
            replenishWarmPool();
          }
        }
      }
    }
    touch(sid, session, at);
    return session;
  }

  function settleSessionBuild(sid, session, handler) {
    session.handler = handler;
    session.pending = null;
    replenishWarmPool();
    return handler;
  }

  function failSessionBuild(sid, error) {
    // A failed build must not wedge the session id forever.
    sessions.delete(sid);
    replenishWarmPool();
    throw error;
  }

  function replenishWarmPool() {
    if (warmTarget <= 0) return;
    if (pendingWarmups.some((warmup) => !warmup.claimed)) return;
    if (warmHandlers.length + pendingWarmups.length >= warmTarget) return;

    /** @type {{ promise: Promise<unknown>, claimed: boolean }} */
    const warmup = {
      claimed: false,
      promise: Promise.resolve()
        .then(() => buildHandler())
        .then((handler) => {
          if (!warmup.claimed) warmHandlers.push(handler);
          return handler;
        })
        .finally(() => {
          const index = pendingWarmups.indexOf(warmup);
          if (index !== -1) pendingWarmups.splice(index, 1);
          replenishWarmPool();
        }),
    };
    pendingWarmups.push(warmup);
  }

  async function ready() {
    replenishWarmPool();
    while (warmHandlers.length < warmTarget) {
      if (pendingWarmups.length === 0) replenishWarmPool();
      await Promise.all(pendingWarmups.map((warmup) => warmup.promise));
    }
  }

  /**
   * Resolve the session for this request (minting + Set-Cookie on first contact)
   * and invoke its handler. Returns the promise the handler settles on.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function dispatch(req, res) {
    const at = now();
    sweepIdle(at);

    const cookies = parseCookies(req.headers.cookie);
    let sid = cookies[sessionCookieName];
    // A syntactically valid but unknown id is still caller-chosen. Never let a
    // cookie create a named session: only ids already minted into this process's
    // live map can select an app instance. Expired/restarted sessions get a new id.
    if (!sid || !isPlausibleSid(sid) || !sessions.has(sid)) {
      sid = genId();
      if (!isPlausibleSid(sid)) {
        throw new TypeError('createPerSessionDispatcher genId must return an RFC 4122 UUID.');
      }
      appendSetCookie(
        res,
        serializeSessionCookie(sessionCookieName, sid, { secure: productionCookies }),
      );
    }

    const session = getSession(sid, at);
    enforceCap();

    // Let shared-instance demos scope their own data by the dispatcher-selected
    // session id without trusting a client-supplied header.
    req.headers[DEMO_SESSION_HEADER] = sid;

    const handler = session.handler ?? (await session.pending);
    return handler(req, res);
  }

  return {
    dispatch,
    ready,
    /** @internal test/inspection surface */
    get warmSize() {
      return warmHandlers.length;
    },
    get size() {
      return sessions.size;
    },
    sweepIdle,
    sessions,
  };
}

// A session id we minted is a UUID; reject anything else so a hostile/garbage
// cookie can't pin an attacker-chosen key or bloat the map with junk.
const SID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isPlausibleSid(value) {
  return SID_RE.test(value);
}

export function parseCookies(header) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // A malformed sibling cookie must not turn the entire request into a 500.
      // Ignore it; dispatch will mint a fresh isolation id if the selected cookie
      // was the malformed one.
    }
  }
  return out;
}

function serializeSessionCookie(name, value, { secure }) {
  // Session cookie (no Max-Age → cleared when the tab/browser closes), scoped to
  // the whole app, SameSite=Lax so it rides top-level navigations. The id selects
  // one visitor's isolated mutable app, so keep it out of script and use the
  // __Host- + Secure floor in production; local HTTP development remains usable.
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly${secure ? '; Secure' : ''}; SameSite=Lax`;
}

function hostCookieName(name) {
  return name.startsWith('__Host-') ? name : `__Host-${name}`;
}

function isCookieName(value) {
  return typeof value === 'string' && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value);
}

// Coexist with any Set-Cookie the app itself emits (auth/CSRF): seed our cookie
// via setHeader, then patch writeHead/writeHeader once so a later header object
// can't silently drop it.
function appendSetCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  const merged = existing === undefined ? [cookie] : [].concat(existing, cookie);
  res.setHeader('Set-Cookie', merged);

  const originalWriteHead = res.writeHead;
  res.writeHead = function patchedWriteHead(statusCode, ...rest) {
    const ours = res.getHeader('Set-Cookie');
    const last = rest[rest.length - 1];
    if (last && typeof last === 'object' && !Array.isArray(last)) {
      const provided = last['Set-Cookie'] ?? last['set-cookie'];
      if (provided !== undefined) {
        last['Set-Cookie'] = [].concat(ours ?? [], provided);
        delete last['set-cookie'];
      }
    }
    res.writeHead = originalWriteHead;
    return originalWriteHead.call(this, statusCode, ...rest);
  };
}
