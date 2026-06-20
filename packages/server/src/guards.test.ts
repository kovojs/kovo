import { describe, expect, it, vi } from 'vitest';

import { guards, sanitizeNext, session } from './guards.js';
import { renderMutationResponse, renderNoJsMutationResponse, runMutation } from './mutation.js';
import { route } from './route.js';
import { s } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';

describe('sanitizeNext (bugs-1 F2 open-redirect guard)', () => {
  it('keeps a same-origin, single-leading-slash path (with query/hash)', () => {
    expect(sanitizeNext('/account')).toBe('/account');
    expect(sanitizeNext('/account?tab=1#x')).toBe('/account?tab=1#x');
  });

  it('strips protocol-relative, scheme, host, and backslash redirects to "/"', () => {
    expect(sanitizeNext('//evil.example')).toBe('/');
    expect(sanitizeNext('/\\evil.example')).toBe('/');
    expect(sanitizeNext('https://evil.example/login')).toBe('/');
    expect(sanitizeNext('javascript:alert(1)')).toBe('/');
    expect(sanitizeNext('account')).toBe('/');
  });

  // ROUTING-NAV-4 (medium, contested) — SPEC §6.5:724: `next` must also be validated
  // against the route table when available; an in-app path with no matching route is
  // stripped to the safe default `/`.

  it('ROUTING-NAV-4: strips an unrecognized in-app path to "/" when routes are supplied', () => {
    const routes = [
      route('/home', { page: () => '<h1>Home</h1>' }),
      route('/account', { page: () => '<h1>Account</h1>' }),
    ];

    expect(sanitizeNext('/totally-unknown', routes)).toBe('/');
    expect(sanitizeNext('/home', routes)).toBe('/home');
    expect(sanitizeNext('/account', routes)).toBe('/account');
  });

  it('ROUTING-NAV-4: keeps query/hash on a matched route path', () => {
    const routes = [route('/account', { page: () => '<h1>Account</h1>' })];

    expect(sanitizeNext('/account?tab=orders#section', routes)).toBe('/account?tab=orders#section');
  });

  it('ROUTING-NAV-4: preserves existing open-redirect protection when routes are supplied', () => {
    const routes = [route('/home', { page: () => '<h1>Home</h1>' })];

    expect(sanitizeNext('//evil.example', routes)).toBe('/');
    expect(sanitizeNext('/\\evil.example', routes)).toBe('/');
    expect(sanitizeNext('https://evil.example/login', routes)).toBe('/');
    expect(sanitizeNext('javascript:alert(1)', routes)).toBe('/');
  });

  it('ROUTING-NAV-4: falls back to origin-only validation when routes array is empty', () => {
    // An empty routes array means no route table is available; skip route check.
    expect(sanitizeNext('/any-path', [])).toBe('/any-path');
  });
});

describe('server guard and session primitives', () => {
  it('guards mutations by authenticated session user', async () => {
    const guarded = mutation('cart/add', {
      guard: guards.authed<{ session?: { user?: { id: string } | null } | null }>(),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(runMutation(guarded, { productId: 'p1' }, { session: null })).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    });
    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { user: { id: 'u1' } } }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'ok',
    });
  });

  it('refines typed session users inside authed mutation handlers', async () => {
    interface OptionalSessionRequest {
      session?: {
        user?: { id: string; roles?: readonly string[] } | null;
      } | null;
    }

    const guarded = mutation('cart/audit', {
      guard: guards.authed<OptionalSessionRequest>(),
      input: s.object({ productId: s.string() }),
      handler(input, request) {
        const userId: string = request.session.user.id;
        const roles: readonly string[] | undefined = request.session.user.roles;
        const assertUnrefinedRequest = (candidate: OptionalSessionRequest) => {
          // @ts-expect-error optional sessions are not safe until the authed guard refines them.
          return candidate.session.user.id;
        };

        expect(assertUnrefinedRequest).toBeTypeOf('function');
        return `${userId}:${input.productId}:${roles?.join(',') ?? 'none'}`;
      },
    });

    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { user: { id: 'u1' } } }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'u1:p1:none',
    });
  });

  it('parses typed sessions through the declared schema', () => {
    const appSession = session(
      s.object({
        cartId: s.string(),
        userId: s.string(),
      }),
    );

    expect(appSession.parse({ session: { cartId: 'cart-1', userId: 'u1' } })).toEqual({
      cartId: 'cart-1',
      userId: 'u1',
    });
    expect(() => appSession.parse({})).toThrow('Expected object input');
  });

  it('guards mutations by session user role', async () => {
    const guarded = mutation('admin/refund', {
      guard: guards.role('admin'),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { user: { roles: ['staff'] } } }),
    ).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    });
    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { user: { roles: ['admin'] } } }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'ok',
    });
  });

  it('rate-limits mutations by session by default', async () => {
    const guarded = mutation('cart/add', {
      guard: guards.rateLimit({ max: 1, per: 'session' }),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { id: 's1' } }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'ok',
    });
    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { id: 's1' } }),
    ).resolves.toEqual({
      error: { code: 'RATE_LIMITED', payload: {} },
      ok: false,
      retryAfter: 60,
      status: 429,
    });
    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { id: 's2' } }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'ok',
    });
  });

  it('resets rate-limit buckets after the configured window', async () => {
    const now = vi.spyOn(Date, 'now');
    let currentTime = 1_000;
    now.mockImplementation(() => currentTime);
    const guarded = mutation('cart/add', {
      guard: guards.rateLimit({ max: 1, per: 'session', windowMs: 50 }),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    try {
      await expect(
        runMutation(guarded, { productId: 'p1' }, { session: { id: 's1' } }),
      ).resolves.toMatchObject({
        ok: true,
        value: 'ok',
      });
      await expect(
        runMutation(guarded, { productId: 'p1' }, { session: { id: 's1' } }),
      ).resolves.toMatchObject({
        error: { code: 'RATE_LIMITED', payload: {} },
        ok: false,
        retryAfter: 1,
        status: 429,
      });

      currentTime = 1_051;

      await expect(
        runMutation(guarded, { productId: 'p1' }, { session: { id: 's1' } }),
      ).resolves.toMatchObject({
        ok: true,
        value: 'ok',
      });
    } finally {
      now.mockRestore();
    }
  });

  it('shares global rate limits across sessions and isolates custom keys', async () => {
    interface TenantRequest {
      session?: { id?: string };
      tenant: string;
    }

    const globalGuarded = mutation('cart/global-add', {
      guard: guards.rateLimit({ max: 1, per: 'global' }),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });
    const keyedGuarded = mutation('cart/keyed-add', {
      guard: guards.rateLimit<TenantRequest>({
        key: (request) => request.tenant,
        max: 1,
      }),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(
      runMutation(globalGuarded, { productId: 'p1' }, { session: { id: 's1' } }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      runMutation(globalGuarded, { productId: 'p1' }, { session: { id: 's2' } }),
    ).resolves.toMatchObject({ error: { code: 'RATE_LIMITED' }, ok: false, status: 429 });

    await expect(
      runMutation(keyedGuarded, { productId: 'p1' }, { tenant: 'a' }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      runMutation(keyedGuarded, { productId: 'p1' }, { tenant: 'b' }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      runMutation(keyedGuarded, { productId: 'p1' }, { tenant: 'a' }),
    ).resolves.toMatchObject({ error: { code: 'RATE_LIMITED' }, ok: false, status: 429 });
  });

  // Security finding M3: default per:'session' keying must not silently collapse
  // anonymous clients into one shared bucket.
  it('rejects anonymous default-scoped rate limiting without an explicit key', () => {
    const guard = guards.rateLimit<{ session?: { id?: string } }>({ max: 5 });

    expect(() => guard({})).toThrow(/cannot derive a per-client key/);
    expect(() => guard({ session: {} })).toThrow(/cannot derive a per-client key/);
  });

  it('allows anonymous rate limiting when an explicit key or per:global is supplied', () => {
    const keyed = guards.rateLimit<{ ip: string; session?: { id?: string } }>({
      key: (request) => request.ip,
      max: 1,
    });
    const global = guards.rateLimit<{ session?: { id?: string } }>({ max: 1, per: 'global' });

    expect(keyed({ ip: '203.0.113.1' })).toBe(true);
    expect(keyed({ ip: '203.0.113.2' })).toBe(true);
    expect(keyed({ ip: '203.0.113.1' })).toMatchObject({ kind: 'rateLimited' });

    expect(global({})).toBe(true);
    expect(global({})).toMatchObject({ kind: 'rateLimited' });
  });

  it('keys default-scoped rate limiting by the authenticated session id', () => {
    const guard = guards.rateLimit<{ session?: { id?: string } }>({ max: 1, per: 'session' });

    expect(guard({ session: { id: 's1' } })).toBe(true);
    expect(guard({ session: { id: 's1' } })).toMatchObject({ kind: 'rateLimited' });
    expect(guard({ session: { id: 's2' } })).toBe(true);
  });

  it('evicts oldest rate-limit keys when the key cap is reached', async () => {
    interface TenantRequest {
      session?: { id?: string };
      tenant: string;
    }

    const guarded = mutation('cart/keyed-add', {
      guard: guards.rateLimit<TenantRequest>({
        key: (request) => request.tenant,
        max: 1,
        maxKeys: 2,
      }),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(runMutation(guarded, { productId: 'p1' }, { tenant: 'a' })).resolves.toMatchObject(
      { ok: true },
    );
    await expect(runMutation(guarded, { productId: 'p1' }, { tenant: 'b' })).resolves.toMatchObject(
      { ok: true },
    );
    await expect(runMutation(guarded, { productId: 'p1' }, { tenant: 'c' })).resolves.toMatchObject(
      { ok: true },
    );
    await expect(runMutation(guarded, { productId: 'p1' }, { tenant: 'a' })).resolves.toMatchObject(
      { ok: true },
    );
    await expect(runMutation(guarded, { productId: 'p1' }, { tenant: 'c' })).resolves.toMatchObject(
      { error: { code: 'RATE_LIMITED' }, ok: false, status: 429 },
    );
  });

  it('preserves rate-limit status and retry-after headers in mutation wire responses', async () => {
    const guarded = mutation('cart/add', {
      guard: guards.rateLimit({ max: 1, per: 'session', windowMs: 60_000 }),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });
    const request = { session: { id: 's1' } };

    await expect(
      renderMutationResponse(guarded, {
        fragment: true,
        rawInput: { productId: 'p1' },
        request,
      }),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      renderMutationResponse(guarded, {
        fragment: true,
        rawInput: { productId: 'p1' },
        request,
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="error"><output role="alert" data-error-code="RATE_LIMITED">{}</output></kovo-fragment>',
      headers: {
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Retry-After': '60',
      },
      status: 429,
    });
  });

  it('preserves rate-limit status and retry-after headers in no-JS mutation responses', async () => {
    const guarded = mutation('cart/add', {
      guard: guards.rateLimit({ max: 1, per: 'session', windowMs: 60_000 }),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });
    const request = { session: { id: 's1' } };

    await expect(
      renderNoJsMutationResponse(guarded, {
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request,
      }),
    ).resolves.toMatchObject({ status: 303 });
    await expect(
      renderNoJsMutationResponse(guarded, {
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request,
      }),
    ).resolves.toEqual({
      body: '<!doctype html><html><body><output role="alert" data-error-code="RATE_LIMITED">{}</output></body></html>',
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Retry-After': '60',
      },
      status: 429,
    });
  });
});

describe('guards.owns (SPEC §10.3 ownership / IDOR discharge)', () => {
  type Req = { session?: { user?: { id: string } | null } | null; args: { id: string } };
  const ownsRow = (req: Req, key: string) => req.session?.user?.id === `owner-of-${key}`;

  it('passes when the authenticated principal owns the row', async () => {
    const guard = guards.owns<Req, string>((req) => req.args.id, ownsRow);
    await expect(
      guard({ session: { user: { id: 'owner-of-r1' } }, args: { id: 'r1' } }),
    ).resolves.toBe(true);
  });

  it('forbids when the principal does not own the row (IDOR)', async () => {
    const guard = guards.owns<Req, string>((req) => req.args.id, ownsRow);
    await expect(
      guard({ session: { user: { id: 'someone-else' } }, args: { id: 'r1' } }),
    ).resolves.toEqual({ kind: 'forbidden', payload: {} });
  });

  it('rejects an unauthenticated caller before consulting the ownership check', async () => {
    const consulted: string[] = [];
    const guard = guards.owns<Req, string>(
      (req) => req.args.id,
      (_req, key) => {
        consulted.push(key);
        return true;
      },
    );
    await expect(guard({ session: null, args: { id: 'r1' } })).resolves.toEqual({
      kind: 'unauthenticated',
      payload: {},
    });
    expect(consulted).toEqual([]);
  });

  it('composes with all(authed, owns(...))', async () => {
    const guard = guards.all<Req>(
      guards.authed<Req>(),
      guards.owns<Req, string>((req) => req.args.id, ownsRow),
    );
    await expect(
      guard({ session: { user: { id: 'owner-of-r1' } }, args: { id: 'r1' } }),
    ).resolves.toBe(true);
    await expect(
      guard({ session: { user: { id: 'intruder' } }, args: { id: 'r1' } }),
    ).resolves.toEqual({ kind: 'forbidden', payload: {} });
  });

  it('awaits an async ownership predicate', async () => {
    const guard = guards.owns<Req, string>(
      (req) => req.args.id,
      async (req, key) => Promise.resolve(req.session?.user?.id === `owner-of-${key}`),
    );
    await expect(
      guard({ session: { user: { id: 'owner-of-r9' } }, args: { id: 'r9' } }),
    ).resolves.toBe(true);
  });
});
