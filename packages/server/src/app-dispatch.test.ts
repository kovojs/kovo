import { createHmac } from 'node:crypto';
import { trustedHtml } from '@kovojs/browser';
import { customVerifier, hmacSignature } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { KovoApp } from './app-types.js';
import { dispatchMatchedAppRequest } from './app-dispatch.js';
import { csrfToken, mintCsrfField, mintCsrfToken } from './csrf.js';
import { endpoint, type EndpointResponsePosture } from './endpoint.js';
import { matchShellDispatch, type ShellDispatchMatch } from './shell.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { route } from './route.js';
import { s } from './schema.js';

const rawTextResponse = {
  appOwnedSafety: true,
  body: 'text',
  cache: 'no-store',
} satisfies EndpointResponsePosture;

const ENDPOINT_CSRF_SECRET = 'endpoint-csrf-secret-0123456789abcdef012345';
const MACHINE_HMAC_SECRET = 'endpoint-hmac-secret-0123456789abcdef012345';
const APP_CSRF_SECRET = 'app-csrf-secret-0123456789abcdef012345';

describe('server app matched dispatch boundary', () => {
  it('owns SPEC §9.5 client-module dispatch through the app registry', async () => {
    const app = createApp();
    const href = app.clientModules.put({
      path: '/c/cart.client.js',
      source: 'export const cart = "ok";',
      version: 'v1',
    });
    const request = new Request(`https://shop.example.test${href}`);

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    await expect(response.text()).resolves.toBe('export const cart = "ok";');
  });

  it('owns SPEC §9.5 query endpoint dispatch with request/session wiring', async () => {
    let sessionReads = 0;
    const cart = query('cart', {
      args: s.object({ id: s.string() }),
      load(
        input: { id: string },
        context?: { request: Request & { session?: { user: { id: string } } } },
      ) {
        return { count: 2, id: input.id, user: context?.request.session?.user.id };
      },
      reads: [],
      version: 'q1',
    });
    const app = createApp({
      queries: [cart],
      sessionProvider() {
        sessionReads += 1;
        return { user: { id: 'u1' } };
      },
    });
    const request = new Request('https://shop.example.test/_q/cart?id=c1');

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toContain('"user":"u1"');
    expect(sessionReads).toBe(1);
  });

  it('owns SPEC §9.5 raw endpoint dispatch without app session leakage', async () => {
    const status = endpoint('/status', {
      handler(request) {
        return new Response(`session:${'session' in request}`);
      },
      method: 'GET',
      reason: 'status endpoint session isolation test',
      response: rawTextResponse,
    });
    const app = createApp({
      endpoints: [status],
      sessionProvider() {
        return { user: { id: 'u1' } };
      },
    });
    const request = new Request('https://shop.example.test/status');

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('session:false');
  });

  it('owns SPEC §9.5 raw endpoint dispatch without app db leakage', async () => {
    const status = endpoint('/status', {
      handler(request) {
        return new Response(`db:${'db' in request}`);
      },
      method: 'GET',
      reason: 'status endpoint db isolation test',
      response: rawTextResponse,
    });
    const app = createApp({
      db: () => ({ writes: [] }),
      endpoints: [status],
    });
    const request = new Request('https://shop.example.test/status');

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('db:false');
  });

  it('keeps endpoint db opt-in free of ambient owner authority', async () => {
    let dbProviderCalls = 0;
    const status = endpoint('/status', {
      db: true,
      handler(_request, context) {
        return new Response(`ctx-db:${'db' in context}`);
      },
      method: 'GET',
      reason: 'status endpoint scoped db isolation test',
      response: rawTextResponse,
    });
    const app = createApp({
      db: () => {
        dbProviderCalls += 1;
        return {};
      },
      endpoints: [status],
    });
    const request = new Request('https://shop.example.test/status');

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('ctx-db:false');
    expect(dbProviderCalls).toBe(0);
  });

  it('threads an unsafe endpoint actAs principal to read/write managed handles', async () => {
    const providerRequests: unknown[] = [];
    const rawDb = {
      insert() {
        return 'write-ok';
      },
      select() {
        return 'read-ok';
      },
    };
    const status = endpoint('/orders', {
      csrf: false,
      csrfJustification: 'machine-authenticated write-scope fixture',
      db: true,
      async handler(_request, context) {
        const scoped = await context.actAs('user-1');
        return new Response(`${scoped.db.read.select()}:${scoped.db.write.insert()}`);
      },
      method: 'POST',
      reason: 'orders endpoint actAs scoped db test',
      response: rawTextResponse,
    });
    const app = createApp({
      db(request) {
        providerRequests.push(request);
        return rawDb;
      },
      endpoints: [status],
      sessionProvider() {
        return { user: { id: 'ambient-session-user' } };
      },
    });
    const request = new Request('https://shop.example.test/orders', { method: 'POST' });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('read-ok:write-ok');
    expect(providerRequests).toHaveLength(1);
    const providerRequest = providerRequests[0] as {
      principalPosture?: {
        audit?: { ingress?: string; surface?: string };
        kind?: string;
        principal?: string;
      };
      session?: unknown;
    };
    expect('session' in providerRequest).toBe(false);
    expect(providerRequest.principalPosture).toMatchObject({
      audit: { ingress: 'endpoint', operation: 'write', surface: '/orders' },
      kind: 'act-as',
      principal: 'user-1',
    });
  });

  it('rejects structural GET routing authority over a declared POST Writer before dispatch', () => {
    let handlerCalls = 0;
    let providerCalls = 0;
    const declaredPost = endpoint('/orders/structural-method-divergence', {
      csrf: false,
      csrfJustification: 'signed machine write fixture',
      db: true,
      async handler(_request, context) {
        handlerCalls += 1;
        const scoped = await context.actAs('attacker-selected-principal');
        return new Response(String(scoped.db.write));
      },
      method: 'POST',
      reason: 'structural endpoint effective-method regression',
      response: rawTextResponse,
    });
    const structural = {
      ...declaredPost,
      allowedMethods: ['GET'],
    } as typeof declaredPost;

    expect(() =>
      createApp({
        db() {
          providerCalls += 1;
          return {};
        },
        endpoints: [structural],
      }),
    ).toThrow(
      'Kovo endpoint declarations cannot provide allowedMethods; request routing derives the effective method set from the canonical declared method',
    );
    expect(providerCalls).toBe(0);
    expect(handlerCalls).toBe(0);
  });

  it('rejects cast structural lowercase endpoint methods while assembling the app', () => {
    const declaredGet = endpoint('/status/lowercase-structural-method', {
      handler: () => new Response('must-not-dispatch'),
      method: 'GET',
      reason: 'lowercase structural endpoint method regression',
      response: rawTextResponse,
    });
    const structural = { ...declaredGet, method: 'get' } as unknown as typeof declaredGet;

    expect(() => createApp({ endpoints: [structural] })).toThrow(
      'Kovo endpoint declaration method must use its canonical uppercase spelling',
    );
  });

  it('keeps safe endpoint DB authority reader-only while retaining explicit Authorization', async () => {
    const providerRequests: unknown[] = [];
    const rawDb = {
      insert() {
        return 'write-must-not-run';
      },
      select() {
        return 'read-ok';
      },
    };
    const status = endpoint('/orders/read-only', {
      db: true,
      async handler(request, context) {
        const scoped = await context.actAs('reader-1');
        // @ts-expect-error SPEC §9.1: safe endpoint methods do not expose a Writer.
        const write = scoped.db.write;
        return new Response(
          `${scoped.db.read.select()}:${String(write)}:${request.headers.get('authorization')}`,
        );
      },
      method: 'GET',
      reason: 'safe endpoint reader-only capability proof',
      response: rawTextResponse,
    });
    const app = createApp({
      db(request) {
        providerRequests.push(request);
        return rawDb;
      },
      endpoints: [status],
    });

    const response = await dispatchMatchedAppRequest(
      matchedAppRequest(
        app,
        new Request('https://shop.example.test/orders/read-only', {
          headers: { Authorization: 'Bearer explicit-machine-token' },
        }),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('read-ok:undefined:Bearer explicit-machine-token');
    expect(providerRequests).toHaveLength(1);
    expect(providerRequests[0]).toMatchObject({
      principalPosture: {
        audit: { ingress: 'endpoint', operation: 'read', surface: '/orders/read-only' },
        kind: 'act-as',
        principal: 'reader-1',
      },
    });
  });

  it('does not let endpoint code cross-bind actAs through Request.clone', async () => {
    const dbCookies: Array<string | null> = [];
    const dbPrincipals: Array<string | undefined> = [];
    const victimRequest = new Request('https://shop.example.test/victim', {
      headers: { Cookie: 'sid=victim-cached-session' },
    });
    const nativeClone = Request.prototype.clone;
    const nativeHeaderGet = Headers.prototype.get;
    const nativeDefineProperty = Object.defineProperty;
    const status = endpoint('/orders/clone-authority', {
      db: true,
      async handler(request, context) {
        Request.prototype.clone = function () {
          return this === request ? victimRequest : Reflect.apply(nativeClone, this, []);
        };
        Headers.prototype.get = function (name: string) {
          return name.toLowerCase() === 'cookie'
            ? 'sid=prototype-substituted-session'
            : Reflect.apply(nativeHeaderGet, this, [name]);
        };
        Object.defineProperty = ((target, property, descriptor) =>
          Reflect.apply(nativeDefineProperty, Object, [
            target,
            property,
            property === 'principalPosture'
              ? {
                  ...descriptor,
                  value: { kind: 'act-as', principal: 'attacker-substituted-principal' },
                }
              : descriptor,
          ])) as typeof Object.defineProperty;
        try {
          await context.actAs('machine-principal');
        } finally {
          Request.prototype.clone = nativeClone;
          Headers.prototype.get = nativeHeaderGet;
          Object.defineProperty = nativeDefineProperty;
        }
        return new Response('ok');
      },
      method: 'GET',
      reason: 'actAs clone authority regression',
      response: rawTextResponse,
    });
    const app = createApp({
      db(request) {
        dbCookies.push(request.headers.get('cookie'));
        dbPrincipals.push(
          (request as { principalPosture?: { principal?: string } }).principalPosture?.principal,
        );
        return {};
      },
      endpoints: [status],
    });
    const request = new Request('https://shop.example.test/orders/clone-authority', {
      headers: { Cookie: 'sid=ambient-browser-session' },
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    expect(dbCookies).toEqual([null]);
    expect(dbPrincipals).toEqual(['machine-principal']);
  });

  it('finalizes raw endpoint Set-Cookie and redirect headers at the app shell boundary', async () => {
    const cookieEndpoint = endpoint('/raw-cookie', {
      auth: {
        kind: 'custom',
        name: 'raw-cookie-finalization',
        verify: customVerifier(
          'raw-cookie-finalization',
          (request) => request.headers.get('x-cookie-proof') === 'accepted',
        ),
      },
      handler() {
        return new Response('cookie', {
          headers: {
            'Cache-Control': 'no-store',
            'Set-Cookie': 'sid=abc; Path=/',
          },
        });
      },
      method: 'GET',
      reason: 'raw endpoint cookie finalization proof',
      response: {
        ...rawTextResponse,
        reservedHeaders: ['Set-Cookie'],
      },
    });
    const redirectEndpoint = endpoint('/raw-redirect', {
      handler() {
        return new Response(null, {
          headers: {
            'Cache-Control': 'no-store',
            Location: 'https://evil.example/phish',
          },
          status: 303,
        });
      },
      method: 'GET',
      reason: 'raw endpoint redirect finalization proof',
      response: {
        appOwnedSafety: true,
        body: 'redirect',
        cache: 'no-store',
        reservedHeaders: ['Location'],
      },
    });
    const allowedRedirectEndpoint = endpoint('/raw-redirect-allowed', {
      handler() {
        return new Response(null, {
          headers: {
            'Cache-Control': 'no-store',
            Location: 'https://accounts.example.test/oauth/start',
          },
          status: 303,
        });
      },
      method: 'GET',
      reason: 'raw endpoint external redirect allowlist proof',
      response: {
        appOwnedSafety: true,
        body: 'redirect',
        cache: 'no-store',
        redirectAllowlist: [
          {
            origin: 'https://accounts.example.test',
            reason: 'Delegated OAuth flow redirects through the identity provider',
          },
        ],
        reservedHeaders: ['Location'],
      },
    });
    const app = createApp({
      endpoints: [cookieEndpoint, redirectEndpoint, allowedRedirectEndpoint],
    });

    const cookie = await dispatchMatchedAppRequest(
      matchedAppRequest(
        app,
        new Request('https://shop.example.test/raw-cookie', {
          headers: { 'X-Cookie-Proof': 'accepted' },
        }),
      ),
    );
    expect(await cookie.text()).toBe('cookie');
    const cookies = cookie.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain('sid=abc');
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain('SameSite=Lax');

    const redirect = await dispatchMatchedAppRequest(
      matchedAppRequest(app, new Request('https://shop.example.test/raw-redirect')),
    );
    expect(redirect.status).toBe(303);
    expect(redirect.headers.get('location')).toBe('/');
    expect(redirect.headers.getSetCookie()).toEqual([]);

    const allowedRedirect = await dispatchMatchedAppRequest(
      matchedAppRequest(app, new Request('https://shop.example.test/raw-redirect-allowed')),
    );
    expect(allowedRedirect.status).toBe(303);
    expect(allowedRedirect.headers.get('location')).toBe(
      'https://accounts.example.test/oauth/start',
    );
  });

  it('pins raw endpoint headers after browser-state posture classification', async () => {
    let retainedResponse: Response | undefined;
    const machine = endpoint('/machine/retained-response', {
      csrf: false,
      csrfJustification: 'non-browser machine status request',
      handler() {
        retainedResponse = new Response('ok', {
          headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/plain; charset=utf-8',
          },
        });
        return retainedResponse;
      },
      method: 'POST',
      reason: 'retained raw response security regression',
      response: rawTextResponse,
    });
    const app = createApp({ endpoints: [machine] });
    const request = new Request('https://shop.example.test/machine/retained-response', {
      method: 'POST',
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));
    retainedResponse?.headers.set('Clear-Site-Data', '"cookies"');
    retainedResponse?.headers.set('Set-Cookie', 'sid=attacker; Path=/');

    expect(response).not.toBe(retainedResponse);
    expect(response.headers.get('clear-site-data')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
    await expect(response.text()).resolves.toBe('ok');
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'MKCOL', 'PURGE'])(
    'enforces default endpoint CSRF before %s handler dispatch',
    async (method) => {
      let handlerCalls = 0;
      const updateEmail = endpoint('/account/email', {
        handler() {
          handlerCalls += 1;
          return new Response('updated');
        },
        method,
        reason: 'account email update endpoint',
        response: rawTextResponse,
      });
      const app = createApp({
        csrf: { secret: ENDPOINT_CSRF_SECRET, sessionId: () => 's1' },
        endpoints: [updateEmail],
      });
      const requestInit: RequestInit = { method };
      if (method !== 'GET' && method !== 'HEAD') {
        requestInit.body = new URLSearchParams({ email: 'ada@example.com' });
      }
      const request = new Request('https://shop.example.test/account/email', requestInit);

      const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

      expect(response.status).toBe(422);
      await expect(response.text()).resolves.toBe('CSRF');
      expect(handlerCalls).toBe(0);
    },
  );

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'treats the closed safe endpoint method %s as read-only rather than CSRF-checked',
    async (method) => {
      let handlerCalls = 0;
      const readOnly = endpoint('/safe-method', {
        handler() {
          handlerCalls += 1;
          return new Response('read-only');
        },
        method,
        reason: 'closed safe-method runtime proof',
        response: rawTextResponse,
      });
      const app = createApp({
        csrf: { secret: ENDPOINT_CSRF_SECRET, sessionId: () => 's1' },
        endpoints: [readOnly],
      });
      const request = new Request('https://shop.example.test/safe-method', { method });

      const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

      expect(response.status).toBe(200);
      expect(handlerCalls).toBe(1);
    },
  );

  it('does not skip endpoint CSRF when app code poisons method uppercasing', async () => {
    let handlerCalls = 0;
    const updateEmail = endpoint('/account/poisoned-method', {
      handler() {
        handlerCalls += 1;
        return new Response('updated');
      },
      method: 'POST',
      reason: 'post-import request method poisoning regression',
      response: rawTextResponse,
    });
    const app = createApp({
      csrf: { secret: ENDPOINT_CSRF_SECRET, sessionId: () => 's1' },
      endpoints: [updateEmail],
    });
    const request = new Request('https://shop.example.test/account/poisoned-method', {
      body: new URLSearchParams({ email: 'ada@example.com' }),
      method: 'POST',
    });
    const originalToUpperCase = String.prototype.toUpperCase;
    String.prototype.toUpperCase = () => 'GET';
    try {
      const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));
      expect(response.status).toBe(422);
      await expect(response.text()).resolves.toBe('CSRF');
      expect(handlerCalls).toBe(0);
    } finally {
      String.prototype.toUpperCase = originalToUpperCase;
    }
  });

  it('allows default endpoint CSRF requests with a valid token', async () => {
    let handlerCalls = 0;
    const updateEmail = endpoint('/account/email', {
      handler() {
        handlerCalls += 1;
        return new Response('updated');
      },
      method: 'POST',
      reason: 'account email update endpoint',
      response: rawTextResponse,
    });
    const csrf = { secret: ENDPOINT_CSRF_SECRET, sessionId: () => 's1' };
    const app = createApp({ csrf, endpoints: [updateEmail] });
    const request = new Request('https://shop.example.test/account/email', {
      body: new URLSearchParams({
        email: 'ada@example.com',
        'kovo-csrf': csrfToken({} as Request, csrf),
      }),
      headers: { Origin: 'https://shop.example.test' },
      method: 'POST',
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('updated');
    expect(handlerCalls).toBe(1);
  });

  it('allows an unsafe custom endpoint method only when its default CSRF check succeeds', async () => {
    let handlerCalls = 0;
    const purge = endpoint('/cache/product', {
      handler() {
        handlerCalls += 1;
        return new Response('purged');
      },
      method: 'PURGE',
      reason: 'custom unsafe-method CSRF acceptance proof',
      response: rawTextResponse,
    });
    const csrf = { secret: ENDPOINT_CSRF_SECRET, sessionId: () => 's1' };
    const app = createApp({ csrf, endpoints: [purge] });
    const request = new Request('https://shop.example.test/cache/product', {
      body: new URLSearchParams({ 'kovo-csrf': csrfToken({} as Request, csrf) }),
      headers: { Origin: 'https://shop.example.test' },
      method: 'PURGE',
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('purged');
    expect(handlerCalls).toBe(1);
  });

  it.each([undefined, 'https://evil.example.test'])(
    'rejects a valid-token custom endpoint request whose Origin is %s',
    async (origin) => {
      let handlerCalls = 0;
      const purge = endpoint('/cache/product', {
        handler() {
          handlerCalls += 1;
          return new Response('purged');
        },
        method: 'PURGE',
        reason: 'custom unsafe-method CSRF origin-floor proof',
        response: rawTextResponse,
      });
      const csrf = { secret: ENDPOINT_CSRF_SECRET, sessionId: () => 's1' };
      const app = createApp({ csrf, endpoints: [purge] });
      const headers = new Headers();
      if (origin !== undefined) headers.set('Origin', origin);
      const request = new Request('https://shop.example.test/cache/product', {
        body: new URLSearchParams({ 'kovo-csrf': csrfToken({} as Request, csrf) }),
        headers,
        method: 'PURGE',
      });

      const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

      expect(response.status).toBe(422);
      await expect(response.text()).resolves.toBe('CSRF');
      expect(handlerCalls).toBe(0);
    },
  );

  it('L15: accepts a JSON endpoint POST whose valid kovo-csrf token rides in the JSON body (SPEC §9.1)', async () => {
    // bugz-3 L15: default endpoint CSRF read the token only via formData(), which throws on
    // an application/json body, so a legitimate JSON endpoint POST (SPEC.md §9.1 routes
    // ad-hoc JSON APIs through endpoint()) always 422'd even with a valid token + Origin.
    let handlerCalls = 0;
    let seenBody = '';
    const updateEmail = endpoint('/account/email', {
      async handler(request) {
        handlerCalls += 1;
        seenBody = await request.text();
        return new Response('updated');
      },
      method: 'POST',
      reason: 'account email update endpoint',
      response: rawTextResponse,
    });
    const csrf = { secret: ENDPOINT_CSRF_SECRET, sessionId: () => 's1' };
    const app = createApp({ csrf, endpoints: [updateEmail] });
    const body = JSON.stringify({
      email: 'ada@example.com',
      'kovo-csrf': csrfToken({} as Request, csrf),
    });
    const request = new Request('https://shop.example.test/account/email', {
      body,
      headers: { 'Content-Type': 'application/json', Origin: 'https://shop.example.test' },
      method: 'POST',
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('updated');
    expect(handlerCalls).toBe(1);
    // The raw handler still receives the original, unconsumed JSON body.
    expect(seenBody).toBe(body);
  });

  it('accepts a first anonymous form POST to a default-CSRF endpoint using mintCsrfField', async () => {
    let handlerCalls = 0;
    const upload = endpoint('/files', {
      async handler(request) {
        handlerCalls += 1;
        const body = await request.formData();
        return new Response(String(body.get('name')));
      },
      method: 'POST',
      reason: 'anonymous browser file metadata form',
      response: rawTextResponse,
    });
    const csrf = { secret: ENDPOINT_CSRF_SECRET, sessionId: () => undefined };
    const app = createApp({ csrf, endpoints: [upload] });
    const getRequest = new Request('https://shop.example.test/files');
    const minted = mintCsrfField(getRequest, csrf);
    const cookiePair = minted.setCookie?.split(';')[0];
    if (cookiePair === undefined) throw new Error('expected anonymous CSRF Set-Cookie');

    const request = new Request('https://shop.example.test/files', {
      body: new URLSearchParams({ name: 'first-upload', [minted.field]: minted.token }),
      headers: { Cookie: cookiePair, Origin: 'https://shop.example.test' },
      method: 'POST',
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('first-upload');
    expect(handlerCalls).toBe(1);
  });

  it('accepts a first anonymous JSON POST to a default-CSRF endpoint using mintCsrfToken', async () => {
    let handlerCalls = 0;
    let seenBody = '';
    const upload = endpoint('/files.json', {
      async handler(request) {
        handlerCalls += 1;
        seenBody = await request.text();
        return new Response('created');
      },
      method: 'POST',
      reason: 'anonymous browser file metadata JSON',
      response: rawTextResponse,
    });
    const csrf = { secret: ENDPOINT_CSRF_SECRET, sessionId: () => undefined };
    const app = createApp({ csrf, endpoints: [upload] });
    const minted = mintCsrfToken(new Request('https://shop.example.test/files.json'), csrf);
    const cookiePair = minted.setCookie?.split(';')[0];
    if (cookiePair === undefined) throw new Error('expected anonymous CSRF Set-Cookie');
    const body = JSON.stringify({ name: 'first-upload', 'kovo-csrf': minted.token });
    const request = new Request('https://shop.example.test/files.json', {
      body,
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookiePair,
        Origin: 'https://shop.example.test',
      },
      method: 'POST',
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('created');
    expect(seenBody).toBe(body);
    expect(handlerCalls).toBe(1);
  });

  it('L15: still fails closed (422) for a JSON endpoint POST missing the kovo-csrf token', async () => {
    let handlerCalls = 0;
    const updateEmail = endpoint('/account/email', {
      handler() {
        handlerCalls += 1;
        return new Response('updated');
      },
      method: 'POST',
      reason: 'account email update endpoint',
      response: rawTextResponse,
    });
    const csrf = { secret: ENDPOINT_CSRF_SECRET, sessionId: () => 's1' };
    const app = createApp({ csrf, endpoints: [updateEmail] });
    const request = new Request('https://shop.example.test/account/email', {
      body: JSON.stringify({ email: 'ada@example.com' }),
      headers: { 'Content-Type': 'application/json', Origin: 'https://shop.example.test' },
      method: 'POST',
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(422);
    await expect(response.text()).resolves.toBe('CSRF');
    expect(handlerCalls).toBe(0);
  });

  it('fails closed for a malformed JSON endpoint POST without running the handler', async () => {
    let handlerCalls = 0;
    const updateEmail = endpoint('/account/email', {
      handler() {
        handlerCalls += 1;
        return new Response('updated');
      },
      method: 'POST',
      reason: 'account email update endpoint',
      response: rawTextResponse,
    });
    const csrf = { secret: ENDPOINT_CSRF_SECRET, sessionId: () => 's1' };
    const app = createApp({ csrf, endpoints: [updateEmail] });
    const request = new Request('https://shop.example.test/account/email', {
      body: '{ this is not valid json !!',
      headers: { 'Content-Type': 'application/json', Origin: 'https://shop.example.test' },
      method: 'POST',
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(422);
    await expect(response.text()).resolves.toBe('CSRF');
    expect(handlerCalls).toBe(0);
  });

  it('L16: neutralizes the inbound Cookie header for a csrf:false endpoint handler (SPEC §9.1)', async () => {
    // bugz-3 L16: a csrf:false endpoint skips the synchronizer token AND the Origin floor;
    // the exemption is sound only because "cookies are not interpreted" (SPEC.md §9.1).
    let seenCookie: string | null = 'unset';
    const signedWebhook = endpoint('/webhooks/signed', {
      csrf: false,
      csrfJustification: 'signed webhook validates raw body',
      handler(request) {
        seenCookie = request.headers.get('cookie');
        return new Response('ok', { status: 202 });
      },
      method: 'POST',
      reason: 'signed webhook raw body dispatch',
      response: rawTextResponse,
    });
    const app = createApp({
      csrf: { secret: ENDPOINT_CSRF_SECRET, sessionId: () => 's1' },
      endpoints: [signedWebhook],
    });
    const request = new Request('https://shop.example.test/webhooks/signed', {
      body: '{"event":"ok"}',
      headers: { Cookie: 'sid=victim-session-secret' },
      method: 'POST',
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(202);
    // The exempt handler can no longer ride the victim's ambient browser cookie.
    expect(seenCookie).toBeNull();
  });

  it('strips ambient authorization through verifier, handler, and DB while preserving signed machine auth', async () => {
    const verifierViews: Array<[string | null, string | null, string | null]> = [];
    const handlerViews: Array<[string | null, string | null, string | null]> = [];
    const dbViews: Array<[string | null, string | null, string | null]> = [];
    const verifier = customVerifier('machine-browser-state', (request) => {
      verifierViews.push([
        request.headers.get('authorization'),
        request.headers.get('proxy-authorization'),
        request.headers.get('x-machine-signature'),
      ]);
      return request.headers.get('x-machine-signature') === 'sig_accepted';
    });
    const machine = endpoint('/machine/browser-state', {
      auth: { kind: 'custom', name: 'machine-browser-state', verify: verifier },
      csrf: false,
      csrfJustification: 'signed machine request establishes browser state',
      db: true,
      async handler(request, context) {
        handlerViews.push([
          request.headers.get('authorization'),
          request.headers.get('proxy-authorization'),
          request.headers.get('x-machine-signature'),
        ]);
        await context.actAs('machine-principal');
        return new Response('ok', {
          headers: {
            'Cache-Control': 'no-store',
            'Clear-Site-Data': '"cookies"',
            'Content-Type': 'text/plain; charset=utf-8',
            'Set-Cookie': 'sid=machine; Path=/',
          },
        });
      },
      method: 'POST',
      reason: 'signed machine browser-state integration test',
      response: {
        ...rawTextResponse,
        reservedHeaders: ['Clear-Site-Data', 'Set-Cookie'],
      },
    });
    const app = createApp({
      db(request) {
        dbViews.push([
          request.headers.get('authorization'),
          request.headers.get('proxy-authorization'),
          request.headers.get('x-machine-signature'),
        ]);
        return {};
      },
      endpoints: [machine],
    });
    const request = new Request('https://shop.example.test/machine/browser-state', {
      headers: {
        Authorization: 'Basic victim-browser-credential',
        'Proxy-Authorization': 'Basic victim-proxy-credential',
        'X-Machine-Signature': 'sig_accepted',
      },
      method: 'POST',
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    expect(verifierViews).toEqual([[null, null, 'sig_accepted']]);
    expect(handlerViews).toEqual([[null, null, 'sig_accepted']]);
    expect(dbViews).toEqual([[null, null, 'sig_accepted']]);
    expect(response.headers.get('clear-site-data')).toBe('"cookies"');
    expect(response.headers.get('set-cookie')).toContain('sid=machine');
  });

  it('enforces executable endpoint auth before CSRF or handler dispatch', async () => {
    const verifier = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      payload: (request) => request.payload,
      secret: MACHINE_HMAC_SECRET,
    });
    let handlerCalls = 0;
    const signedEndpoint = endpoint('/machine/signed', {
      auth: { kind: 'verifier', name: verifier.resolved.scheme, verify: verifier },
      handler() {
        handlerCalls += 1;
        return new Response('signed');
      },
      method: 'POST',
      reason: 'signed machine endpoint',
      response: rawTextResponse,
    });
    const app = createApp({
      csrf: { secret: APP_CSRF_SECRET, sessionId: () => 's1' },
      endpoints: [signedEndpoint],
    });
    const body = 'payload';
    const badSignature = createHmac('sha256', MACHINE_HMAC_SECRET).update('other').digest('hex');
    const badRequest = new Request('https://shop.example.test/machine/signed', {
      body,
      headers: { 'x-signature': badSignature },
      method: 'POST',
    });

    const badResponse = await dispatchMatchedAppRequest(matchedAppRequest(app, badRequest));

    expect(badResponse.status).toBe(401);
    await expect(badResponse.text()).resolves.toBe('Unauthorized');
    expect(handlerCalls).toBe(0);

    const goodSignature = createHmac('sha256', MACHINE_HMAC_SECRET).update(body).digest('hex');
    const goodRequest = new Request('https://shop.example.test/machine/signed', {
      body,
      headers: { 'x-signature': goodSignature },
      method: 'POST',
    });

    const goodResponse = await dispatchMatchedAppRequest(matchedAppRequest(app, goodRequest));

    expect(goodResponse.status).toBe(422);
    await expect(goodResponse.text()).resolves.toBe('CSRF');
    expect(handlerCalls).toBe(0);
  });

  it('preserves raw body dispatch for explicitly CSRF-exempt endpoints', async () => {
    let handlerCalls = 0;
    const signedWebhook = endpoint('/webhooks/signed', {
      csrf: false,
      csrfJustification: 'signed webhook validates raw body',
      async handler(request) {
        handlerCalls += 1;
        return new Response(await request.text(), { status: 202 });
      },
      method: 'POST',
      reason: 'signed webhook raw body dispatch',
      response: rawTextResponse,
    });
    const app = createApp({
      csrf: { secret: ENDPOINT_CSRF_SECRET, sessionId: () => 's1' },
      endpoints: [signedWebhook],
    });
    const request = new Request('https://shop.example.test/webhooks/signed', {
      body: '{"event":"ok"}',
      method: 'POST',
    });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe('{"event":"ok"}');
    expect(handlerCalls).toBe(1);
  });

  it('returns 405 Allow for a method mismatch on an existing endpoint path', async () => {
    let handlerCalls = 0;
    const status = endpoint('/status', {
      handler() {
        handlerCalls += 1;
        return new Response('ok');
      },
      method: 'GET',
      reason: 'endpoint method mismatch dispatch test',
      response: rawTextResponse,
    });
    const app = createApp({ endpoints: [status] });
    const request = new Request('https://shop.example.test/status', { method: 'POST' });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    await expect(response.text()).resolves.toBe('Method Not Allowed');
    expect(handlerCalls).toBe(0);
  });

  it('D2: dispatches HEAD to GET endpoints with bodyless GET semantics', async () => {
    let handlerCalls = 0;
    const status = endpoint('/status', {
      handler() {
        handlerCalls += 1;
        return new Response('ok', {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Status': 'ok' },
          status: 200,
        });
      },
      method: 'GET',
      reason: 'endpoint HEAD dispatch test',
      response: rawTextResponse,
    });
    const app = createApp({ endpoints: [status] });
    const request = new Request('https://shop.example.test/status', { method: 'HEAD' });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-status')).toBe('ok');
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe('');
    expect(handlerCalls).toBe(1);
  });

  it('owns SPEC §9.5 page method rejection after route matching', async () => {
    const product = route('/products/:id', {});
    const app = createApp({ routes: [product] });
    const request = new Request('https://shop.example.test/products/p1', { method: 'POST' });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    await expect(response.text()).resolves.toBe('Method Not Allowed');
  });

  it('shares mutation method rejection without replaying the mutation lifecycle', async () => {
    let handlerCalls = 0;
    const addToCart = mutation('cart/add', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({ productId: s.string() }),
      handler(input) {
        handlerCalls += 1;
        return input;
      },
    });
    const app = createApp({ mutations: [addToCart] });
    const request = new Request('https://shop.example.test/_m/cart/add', { method: 'HEAD' });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    await expect(response.text()).resolves.toBe('');
    expect(handlerCalls).toBe(0);
  });

  it('owns SPEC §9.5 not-found dispatch through configured error shells', async () => {
    const app = createApp({
      errorShells: {
        notFound() {
          return {
            body: trustedHtml('<h1>Missing</h1>'),
            status: 404,
          };
        },
      },
    });
    const request = new Request('https://shop.example.test/missing');

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toContain('<!doctype html>');
    expect(body).toContain('<h1>Missing</h1>');
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  // H2 (medium) — SPEC §9.4: /_q/ is a credentialed GET endpoint; non-GET/HEAD methods
  // must be rejected 405 with Allow: GET, HEAD so they cannot be used as a no-CSRF read channel.

  it('H2: rejects POST to /_q/<key> with 405 Allow:GET,HEAD without running the query', async () => {
    let loadCalls = 0;
    const cart = query('cart', {
      load() {
        loadCalls += 1;
        return { count: 1 };
      },
      reads: [],
    });
    const app = createApp({ queries: [cart] });
    const request = new Request('https://shop.example.test/_q/cart', { method: 'POST' });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(loadCalls).toBe(0);
  });

  it('H2: rejects DELETE to /_q/<key> with 405 Allow:GET,HEAD without running the query', async () => {
    let loadCalls = 0;
    const cart = query('cart', {
      load() {
        loadCalls += 1;
        return { count: 1 };
      },
      reads: [],
    });
    const app = createApp({ queries: [cart] });
    const request = new Request('https://shop.example.test/_q/cart', { method: 'DELETE' });

    const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(loadCalls).toBe(0);
  });

  it.each([
    ['GET', 'POST', 200, 1],
    ['HEAD', 'POST', 200, 1],
    ['POST', 'GET', 405, 0],
  ] as const)(
    'pins /_q method %s classification when app uppercasing reports %s',
    async (method, poisonedMethod, expectedStatus, expectedLoads) => {
      let loadCalls = 0;
      const cart = query('poisoned-method-cart', {
        load() {
          loadCalls += 1;
          return { count: 1 };
        },
        reads: [],
      });
      const app = createApp({ queries: [cart] });
      const request = new Request('https://shop.example.test/_q/poisoned-method-cart', { method });
      const originalToUpperCase = String.prototype.toUpperCase;
      String.prototype.toUpperCase = () => poisonedMethod;
      try {
        const response = await dispatchMatchedAppRequest(matchedAppRequest(app, request));
        expect(response.status).toBe(expectedStatus);
        expect(loadCalls).toBe(expectedLoads);
        if (expectedStatus === 405) expect(response.headers.get('allow')).toBe('GET, HEAD');
      } finally {
        String.prototype.toUpperCase = originalToUpperCase;
      }
    },
  );
});

function matchedAppRequest(
  app: KovoApp,
  request: Request,
): {
  app: KovoApp;
  match: ShellDispatchMatch<KovoApp['routes'][number], KovoApp['endpoints'][number]>;
  request: Request;
  url: URL;
} {
  const url = new URL(request.url);
  return {
    app,
    match: matchShellDispatch({
      endpoints: app.endpoints,
      method: request.method,
      pathname: url.pathname,
      routes: app.routes,
    }),
    request,
    url,
  };
}
