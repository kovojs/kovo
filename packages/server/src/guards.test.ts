import { describe, expect, it, vi } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import {
  stampParameterizedSql,
  stampRawSqlChunk,
  stampStaticSql,
  stampTrustedSql,
} from '@kovojs/core/internal/sql-safety';
import {
  guards,
  renderHttpGuardFailureResponse,
  resolveLifecycleRequest,
  sanitizeNext,
  session,
} from './guards.js';
import { renderMutationResponse, renderNoJsMutationResponse, runMutation } from './mutation.js';
import { createMemoryOpaqueSessionStore, createOpaqueSessionManager } from './opaque-session.js';
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
      route('/home', { page: () => trustedHtml('<h1>Home</h1>') }),
      route('/account', { page: () => trustedHtml('<h1>Account</h1>') }),
    ];

    expect(sanitizeNext('/totally-unknown', routes)).toBe('/');
    expect(sanitizeNext('/home', routes)).toBe('/home');
    expect(sanitizeNext('/account', routes)).toBe('/account');
  });

  it('ROUTING-NAV-4: keeps query/hash on a matched route path', () => {
    const routes = [route('/account', { page: () => trustedHtml('<h1>Account</h1>') })];

    expect(sanitizeNext('/account?tab=orders#section', routes)).toBe('/account?tab=orders#section');
  });

  it('ROUTING-NAV-4: preserves existing open-redirect protection when routes are supplied', () => {
    const routes = [route('/home', { page: () => trustedHtml('<h1>Home</h1>') })];

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
  it('rejects raw session providers passed directly to lower-level lifecycle helpers', async () => {
    await expect(
      resolveLifecycleRequest(new Request('https://app.test/account'), {
        sessionProvider: () => ({ user: { id: 'raw' } }),
      }),
    ).rejects.toThrow('Plain session provider functions cannot be passed directly');
  });

  it('accepts explicitly wrapped session providers in lower-level lifecycle helpers', async () => {
    const appSession = session(s.object({ user: s.object({ id: s.string() }) }));
    const request = await resolveLifecycleRequest(new Request('https://app.test/account'), {
      sessionProvider: appSession.provider(() => ({ user: { id: 'wrapped' } })),
    });

    expect(request.session).toEqual({ user: { id: 'wrapped' } });
  });

  it('accepts Kovo-owned opaque session providers in lower-level lifecycle helpers', async () => {
    const manager = createOpaqueSessionManager({
      store: createMemoryOpaqueSessionStore<{ user: { id: string } }>(),
    });
    const established = await manager.establish({ user: { id: 'opaque' } });
    const request = await resolveLifecycleRequest(
      new Request('https://app.test/account', {
        headers: { cookie: established.setCookie.split(';')[0]! },
      }),
      { sessionProvider: manager.provider },
    );

    expect(request.session).toEqual({ user: { id: 'opaque' } });
  });

  it('guards managed DB handles from unbranded raw SQL strings before driver execution', async () => {
    const calls: unknown[] = [];
    const request = await resolveLifecycleRequest(
      {},
      {
        db: () => ({
          execute(statement: unknown) {
            calls.push(statement);
            return 'ok';
          },
        }),
      },
    );

    expect(() => request.db.execute("select * from products where id = 'p1'")).toThrow(/KV422/);
    expect(calls).toEqual([]);

    const parameterized = stampParameterizedSql({});
    expect(request.db.execute(parameterized)).toBe('ok');
    expect(
      request.db.execute({ text: 'select * from products where id = $1', values: ['p1'] }),
    ).toBe('ok');
    expect(calls).toHaveLength(2);
  });

  it('requires trustedSql around raw SQL chunks on managed handles', async () => {
    const calls: unknown[] = [];
    const raw = stampRawSqlChunk({});
    const request = await resolveLifecycleRequest(
      {},
      {
        db: () => ({
          client: {
            execute(statement: unknown) {
              calls.push(statement);
              return 'ok';
            },
          },
        }),
      },
    );

    expect(() => request.db.client.execute(raw)).toThrow(/trustedSql/);
    expect(calls).toEqual([]);
    expect(request.db.client.execute(stampTrustedSql(raw, 'audited migration clause'))).toBe('ok');
    expect(calls).toEqual([raw]);
  });

  it('guards blessed nested adapter handles without silently passing unknown SQL shapes', async () => {
    const calls: Array<[string, unknown]> = [];
    const request = await resolveLifecycleRequest(
      {},
      {
        db: () => ({
          $client: {
            prepare(statement: unknown) {
              calls.push(['$client.prepare', statement]);
              return { get: () => 'prepared-ok' };
            },
          },
          client: {
            execute(statement: unknown) {
              calls.push(['client.execute', statement]);
              return 'client-ok';
            },
          },
          pglite: {
            query(statement: unknown) {
              calls.push(['pglite.query', statement]);
              return 'pglite-ok';
            },
          },
          sqlite: {
            exec(statement: unknown) {
              calls.push(['sqlite.exec', statement]);
              return 'sqlite-ok';
            },
          },
        }),
      },
    );

    expect(() => request.db.pglite.query('select * from products')).toThrow(/KV422/);
    expect(() => request.db.sqlite.exec('select * from products')).toThrow(/KV422/);
    expect(() => request.db.client.execute('select * from products')).toThrow(/KV422/);
    expect(() => request.db.$client.prepare('select * from products')).toThrow(/KV422/);
    expect(calls).toEqual([]);

    expect(
      request.db.pglite.query({ text: 'select * from products where id = $1', values: ['p1'] }),
    ).toBe('pglite-ok');
    expect(request.db.sqlite.exec(stampParameterizedSql({}))).toBe('sqlite-ok');
    expect(
      request.db.client.execute({ sql: 'select * from products where id = ?', args: ['p1'] }),
    ).toBe('client-ok');
    expect(
      request.db.$client
        .prepare(stampStaticSql({ sql: 'select * from products where id = ?' }))
        .get(),
    ).toBe('prepared-ok');
    expect(calls).toHaveLength(4);
  });

  it('rejects attacker-shaped SQL text and still allows static prepared statement values', async () => {
    const payloads = [
      "p1' or '1'='1",
      "p1'; drop table products; --",
      "p1' union select * from users --",
      '%',
    ];
    const calls: unknown[] = [];
    const request = await resolveLifecycleRequest(
      {},
      {
        db: () => ({
          exec(statement: unknown) {
            calls.push(statement);
            return [];
          },
          prepare(statement: unknown) {
            calls.push(statement);
            return {
              all(value: string) {
                return value === 'p1' ? [{ id: 'p1' }] : [];
              },
            };
          },
          query(statement: unknown) {
            calls.push(statement);
            return [{ id: 'p1' }, { id: 'p2' }];
          },
        }),
      },
    );

    for (const payload of payloads) {
      expect(() => request.db.query(`select * from products where id = '${payload}'`)).toThrow(
        /KV422/,
      );
    }
    expect(calls).toEqual([]);

    const prepared = request.db.prepare(
      stampStaticSql({ sql: 'select * from products where id = $1' }),
    );
    expect(prepared.all('p1')).toEqual([{ id: 'p1' }]);
    expect(prepared.all(payloads[0]!)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('rejects realistic vulnerable SQL scenario strings before driver execution', async () => {
    const calls: unknown[] = [];
    const request = await resolveLifecycleRequest(
      {},
      {
        db: () => ({
          exec(statement: unknown) {
            calls.push(statement);
            return 'exec-ok';
          },
          execute(statement: unknown) {
            calls.push(statement);
            return 'execute-ok';
          },
          prepare(statement: unknown) {
            calls.push(statement);
            return { all: () => [] };
          },
          query(statement: unknown) {
            calls.push(statement);
            return [];
          },
        }),
      },
    );

    const sort = 'created_at desc; drop table products; --';
    const status = "open' or '1'='1";
    const q = "%' union select id from users --";
    const limit = '1; delete from products; --';
    const ids = ['p1', "p2'); delete from products; --"];
    const table = 'products join users on true';
    const userClause = "where archived = false or '1'='1'";

    expect(() => request.db.query(`select * from products order by ${sort}`)).toThrow(/KV422/);
    expect(() => request.db.execute(`select * from products where status = '${status}'`)).toThrow(
      /KV422/,
    );
    expect(() => request.db.query(`select * from products where name like '%${q}%'`)).toThrow(
      /KV422/,
    );
    expect(() => request.db.query(`select * from products limit ${limit}`)).toThrow(/KV422/);
    expect(() => request.db.query(`select * from products where id in (${ids.join(',')})`)).toThrow(
      /KV422/,
    );
    expect(() => request.db.query(`select * from ${table}`)).toThrow(/KV422/);
    expect(() => request.db.exec(`select * from products ${userClause}`)).toThrow(/KV422/);
    expect(() => request.db.prepare(`select * from products where id = ${ids[0]}`)).toThrow(
      /KV422/,
    );
    expect(calls).toEqual([]);

    expect(request.db.query(stampParameterizedSql({}))).toEqual([]);
    expect(
      request.db.execute({ text: 'select * from products where status = $1', values: [status] }),
    ).toBe('execute-ok');
    expect(
      request.db.exec(stampTrustedSql(stampRawSqlChunk({}), 'audited static report clause')),
    ).toBe('exec-ok');
    expect(calls).toHaveLength(3);
  });

  it('enforces the managed SQL guard by default in production (SPEC §10.2 fail-closed floor)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const previousNodeEnv = process.env.NODE_ENV;
    const previousGuard = process.env.KOVO_SQL_GUARD;
    process.env.NODE_ENV = 'production';
    delete process.env.KOVO_SQL_GUARD;

    try {
      const calls: unknown[] = [];
      const request = await resolveLifecycleRequest(
        {},
        {
          db: () => ({
            execute(statement: unknown) {
              calls.push(statement);
              return 'ok';
            },
          }),
        },
      );

      // Default (no KOVO_SQL_GUARD) is now `enforce` everywhere, production included: a raw string
      // throws KV422 fail-closed rather than executing with a warning.
      expect(() => request.db.execute('select 1')).toThrow(/KV422/);
      expect(calls).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousGuard === undefined) delete process.env.KOVO_SQL_GUARD;
      else process.env.KOVO_SQL_GUARD = previousGuard;
      warn.mockRestore();
    }
  });

  it('ignores fail-open KOVO_SQL_GUARD=warn/off overrides at managed SQL sinks', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const previousNodeEnv = process.env.NODE_ENV;
    const previousGuard = process.env.KOVO_SQL_GUARD;
    process.env.NODE_ENV = 'production';

    try {
      const calls: unknown[] = [];
      const request = await resolveLifecycleRequest(
        {},
        {
          db: () => ({
            execute(statement: unknown) {
              calls.push(statement);
              return 'ok';
            },
          }),
        },
      );

      process.env.KOVO_SQL_GUARD = 'warn';
      expect(() => request.db.execute('select 1')).toThrow(/KV422/);
      process.env.KOVO_SQL_GUARD = 'off';
      expect(() => request.db.execute('select 2')).toThrow(/KV422/);
      expect(calls).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousGuard === undefined) delete process.env.KOVO_SQL_GUARD;
      else process.env.KOVO_SQL_GUARD = previousGuard;
      warn.mockRestore();
    }
  });

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
        buildToken: 'guard-build',
        fragment: true,
        rawInput: { productId: 'p1' },
        request,
      }),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      renderMutationResponse(guarded, {
        buildToken: 'guard-build',
        fragment: true,
        rawInput: { productId: 'p1' },
        request,
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="error"><output role="alert" data-error-code="RATE_LIMITED">{}</output></kovo-fragment>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Build': 'guard-build',
        'Retry-After': '60',
        Vary: 'Cookie',
      },
      status: 429,
    });
  });

  it('returns 401 plus Kovo-Reauth for unauthenticated enhanced mutation guard failures', async () => {
    const guarded = mutation('cart/add', {
      csrf: false,
      guard: guards.authed<{ session?: { user?: { id: string } } | null }>(),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(
      renderMutationResponse(guarded, {
        currentUrl: '/cart?from=button',
        rawInput: { productId: 'p1' },
        request: { session: null },
      }),
    ).resolves.toEqual({
      body: '',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Reauth': '/login?next=%2Fcart%3Ffrom%3Dbutton',
        Vary: 'Cookie',
      },
      status: 401,
    });
  });

  it('returns 303 login redirect for unauthenticated no-JS mutation guard failures', async () => {
    const guarded = mutation('cart/add', {
      csrf: false,
      guard: guards.authed<{ session?: { user?: { id: string } } | null }>(),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(
      renderNoJsMutationResponse(guarded, {
        currentUrl: '/cart',
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request: { session: null },
      }),
    ).resolves.toEqual({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/login?next=%2Fcart',
      },
      status: 303,
    });
  });

  it('sanitizes next before invoking custom onUnauthenticated handlers', async () => {
    await expect(
      renderHttpGuardFailureResponse(
        {
          error: { code: 'UNAUTHORIZED' },
          ok: false,
          status: 422,
        },
        { session: null },
        {
          currentUrl: 'https://evil.example/phish',
          onUnauthenticated({ next }) {
            return { location: `/signin?continue=${encodeURIComponent(next)}`, status: 303 };
          },
          routes: [route('/signin')],
        },
      ),
    ).resolves.toEqual({
      body: '',
      headers: { Location: '/signin?continue=%2F' },
      status: 303,
    });
  });

  it('keeps authenticated authorization failures on typed enhanced fragments with 403', async () => {
    const guarded = mutation('admin/refund', {
      csrf: false,
      guard: guards.role<{ session?: { user?: { roles?: readonly string[] } } | null }>('admin'),
      input: s.object({ orderId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(
      renderMutationResponse(guarded, {
        failureTarget: 'refund-form',
        rawInput: { orderId: 'o1' },
        request: { session: { user: { roles: ['staff'] } } },
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="refund-form"><output role="alert" data-error-code="UNAUTHORIZED">{}</output></kovo-fragment>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        Vary: 'Cookie',
      },
      status: 403,
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
