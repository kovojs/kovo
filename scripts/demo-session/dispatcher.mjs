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
// concurrent requests for the same new session share one in-flight build.

const DEFAULT_COOKIE_NAME = 'kovo_demo_sid';
const DEFAULT_IDLE_MS = 20 * 60_000;
const DEFAULT_MAX_SESSIONS = 40;

/**
 * @param {{
 *   buildHandler: () => unknown,
 *   cookieName?: string,
 *   idleMs?: number,
 *   maxSessions?: number,
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
  now = () => Date.now(),
  genId = () => randomUUID(),
  onEvict,
} = {}) {
  if (typeof buildHandler !== 'function') {
    throw new TypeError('createPerSessionDispatcher requires a buildHandler function.');
  }

  /** @type {Map<string, { handler: unknown, pending: Promise<unknown> | null, lastSeen: number }>} */
  const sessions = new Map();

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
      const built = buildHandler();
      if (built && typeof built.then === 'function') {
        session.pending = Promise.resolve(built).then(
          (handler) => {
            session.handler = handler;
            session.pending = null;
            return handler;
          },
          (error) => {
            // A failed build must not wedge the session id forever.
            sessions.delete(sid);
            throw error;
          },
        );
      } else {
        session.handler = built;
      }
    }
    touch(sid, session, at);
    return session;
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
    let sid = cookies[cookieName];
    if (!sid || !isPlausibleSid(sid)) {
      sid = genId();
      appendSetCookie(res, serializeSessionCookie(cookieName, sid));
    }

    const session = getSession(sid, at);
    enforceCap();

    const handler = session.handler ?? (await session.pending);
    return handler(req, res);
  }

  return {
    dispatch,
    /** @internal test/inspection surface */
    get size() {
      return sessions.size;
    },
    sweepIdle,
    sessions,
  };
}

// A session id we minted is a UUID; reject anything else so a hostile/garbage
// cookie can't pin an attacker-chosen key or bloat the map with junk.
const SID_RE = /^[0-9a-fA-F-]{8,64}$/;
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
    out[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function serializeSessionCookie(name, value) {
  // Session cookie (no Max-Age → cleared when the tab/browser closes), scoped to
  // the whole app, SameSite=Lax so it rides top-level navigations. Not HttpOnly:
  // it carries no auth, only demo-instance identity, and staying readable keeps
  // it debuggable. No Secure flag here so it also works over plain http in local
  // dev; the hosting layer is TLS-terminated.
  return `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
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
