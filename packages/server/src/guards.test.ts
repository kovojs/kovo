import { describe, expect, it, vi } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import {
  isManagedSqlStatement,
  stampParameterizedSql,
  stampRawSqlChunk,
  stampStaticSql,
  stampTrustedSql,
  type ManagedSqlStatement,
} from '@kovojs/core/internal/sql-safety';
import { csrfToken } from './csrf.js';
import {
  explainGuard,
  guards,
  requestPassedRoleGuard,
  renderHttpGuardFailureResponse,
  resolveLifecycleRequest,
  sanitizeNext,
  session,
  withGuardArgs,
  type GuardArgsRequest,
  type GuardParamsRequest,
} from './guards.js';
import { renderMutationResponse, renderNoJsMutationResponse, runMutation } from './mutation.js';
import { query, runQuery } from './query.js';
import { route, runRoutePage } from './route.js';
import { s, type Schema } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';

function expectManagedSqlStatement(value: unknown, text: string): ManagedSqlStatement {
  expect(isManagedSqlStatement(value)).toBe(true);
  const statement = value as ManagedSqlStatement;
  expect(statement.text).toBe(text);
  return statement;
}

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

  it('P1-1 (plans/compiler-soundness.md): strips paths that NORMALIZE to protocol-relative "//host"', () => {
    // WHATWG URL-with-base normalization collapses `/..//evil.com` to pathname `//evil.com`; the
    // raw-input `//` prefix check never saw the synthesized leading slash. sanitizeNextOrigin must
    // re-apply the scheme-relative guard to the normalized output, or a `Location: //evil.com`
    // header is an arbitrary cross-origin open redirect (SPEC §6.5).
    expect(sanitizeNext('/..//evil.com')).toBe('/');
    expect(sanitizeNext('/a/../..//evil.com')).toBe('/');
    expect(sanitizeNext('/%2e%2e//evil.com')).toBe('/');
    expect(sanitizeNext('/..//evil.com', [{ path: '/account' }] as never)).toBe('/');
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

describe('guard principal resolution (Q.6 auth-decision fail-closed)', () => {
  type Req = {
    session?: { id?: string; user?: { id?: string; roles?: readonly string[] } | null } | null;
  };
  type RoleReq = {
    session?: {
      id?: string;
      user?: { id?: string; roles: readonly string[] } | null;
    } | null;
  };

  it('allows built-in auth guards only for a proven session principal', async () => {
    expect(guards.authed<Req>()({ session: { user: { id: 'user_1' } } })).toBe(true);
    expect(
      guards.role<Req & { session: { user: { roles: readonly string[] } } }>('admin')({
        session: { id: 'session_1', user: { id: 'user_1', roles: ['admin'] } },
      }),
    ).toBe(true);
  });

  it('does not escalate roles through a poisoned Array.includes prototype', () => {
    const originalIncludes = Array.prototype.includes;
    try {
      Array.prototype.includes = () => true;
      const decision = guards.role<
        Req & { session: { user: { id: string; roles: readonly string[] } } }
      >('admin')({ session: { user: { id: 'user_1', roles: ['member'] } } });
      expect(decision).toEqual({ kind: 'forbidden', payload: {} });
    } finally {
      Array.prototype.includes = originalIncludes;
    }
  });

  it('denies inherited or accessor-backed auth authority without invoking it', async () => {
    const existing = Object.getOwnPropertyDescriptor(Object.prototype, 'session');
    let roleReads = 0;
    try {
      Object.defineProperty(Object.prototype, 'session', {
        configurable: true,
        value: { user: { id: 'attacker', roles: ['admin'] } },
      });
      const nativeRequest: Request & RoleReq = new Request('https://app.example/admin');
      expect(guards.authed<Request & RoleReq>()(nativeRequest)).toEqual({
        kind: 'unauthenticated',
        payload: {},
      });
      expect(guards.role<Request & RoleReq>('admin')(nativeRequest)).toEqual({
        kind: 'unauthenticated',
        payload: {},
      });

      const user = { id: 'user_1' } as { id: string; roles: readonly string[] };
      Object.defineProperty(user, 'roles', {
        get() {
          roleReads += 1;
          return ['admin'];
        },
      });
      expect(guards.authed<Req>()({ session: { user } })).toBe(true);
      expect(guards.role<RoleReq>('admin')({ session: { user } })).toEqual({
        kind: 'forbidden',
        payload: {},
      });
      expect(roleReads).toBe(0);
    } finally {
      if (existing === undefined) delete (Object.prototype as { session?: unknown }).session;
      else Object.defineProperty(Object.prototype, 'session', existing);
    }
  });

  it('preserves a provider-minted own session snapshot across framework request layers', async () => {
    const base: Request & Req = new Request('https://app.example/admin');
    const lifecycle = await resolveLifecycleRequest(base, {
      sessionProvider: () => ({ user: { id: 'user_1', roles: ['admin'] } }),
    });
    const request = withGuardArgs(lifecycle, { id: 'row_1' });

    expect(guards.authed<typeof request>()(request)).toBe(true);
    expect(guards.role<typeof request>('admin')(request)).toBe(true);
  });

  it('ignores inherited session-provider envelope authority and forged refresh cookies', async () => {
    // SPEC §6.5/§6.6 C9: a provider envelope crosses a trust boundary. Only exact own data
    // fields may select its principal or response cookies; Object.prototype is never authority.
    const existingValue = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
    const existingSetCookies = Object.getOwnPropertyDescriptor(Object.prototype, 'setCookies');
    const forwarded: string[] = [];
    const victim = { user: { id: 'victim', roles: ['member'] } };
    let attachedSession: unknown;
    let adminDecision: unknown;

    try {
      Object.defineProperty(Object.prototype, 'value', {
        configurable: true,
        value: { user: { id: 'attacker', roles: ['admin'] } },
        writable: true,
      });
      Object.defineProperty(Object.prototype, 'setCookies', {
        configurable: true,
        value: ['sid=forged-admin-session; Path=/; HttpOnly'],
        writable: true,
      });

      const request = await resolveLifecycleRequest(
        {},
        {
          onSessionSetCookie: (cookie) => forwarded.push(cookie),
          sessionProvider: () => victim,
        },
      );

      attachedSession = request.session;
      adminDecision = guards.role<typeof request>('admin')(request);
    } finally {
      if (existingValue === undefined) delete (Object.prototype as { value?: unknown }).value;
      else Object.defineProperty(Object.prototype, 'value', existingValue);
      if (existingSetCookies === undefined) {
        delete (Object.prototype as { setCookies?: unknown }).setCookies;
      } else Object.defineProperty(Object.prototype, 'setCookies', existingSetCookies);
    }

    expect(attachedSession).toEqual(victim);
    expect(attachedSession).not.toBe(victim);
    expect(Object.isFrozen(attachedSession)).toBe(true);
    expect(Object.isFrozen((attachedSession as typeof victim).user)).toBe(true);
    expect(adminDecision).toEqual({ kind: 'forbidden', payload: {} });
    expect(forwarded).toEqual([]);
  });

  it('keys authorization principal from session.user.id rather than session.id', async () => {
    expect(guards.authed<Req>()({ session: { id: 'session_1', user: { id: 'user_1' } } })).toBe(
      true,
    );
    expect(guards.authed<Req>()({ session: { id: 'session_1', user: {} } })).toEqual({
      kind: 'unauthenticated',
      payload: {},
    });
  });

  it.each(['', ' ', 'unknown', 'unresolved', 'anonymous'])(
    'treats unresolved principal %j as unauthenticated at guard eval',
    async (id) => {
      expect(guards.authed<Req>()({ session: { user: { id } } })).toEqual({
        kind: 'unauthenticated',
        payload: {},
      });
    },
  );

  it('does not let role or ownership checks authorize an unresolved principal', async () => {
    const roleGuard = guards.role<
      Req & { session: { user: { id: string; roles: readonly string[] } } }
    >('admin');
    expect(roleGuard({ session: { user: { id: 'unknown', roles: ['admin'] } } })).toEqual({
      kind: 'unauthenticated',
      payload: {},
    });

    type OwnsReq = GuardArgsRequest<Req, { id: string }>;
    const ownsRow = vi.fn(() => true);
    const ownsGuard = guards.owns<OwnsReq, OwnsReq, string>((request) => request.args.id, ownsRow);
    await expect(
      ownsGuard({ session: { user: { id: 'unresolved' } }, args: { id: 'r1' } }),
    ).resolves.toEqual({ kind: 'unauthenticated', payload: {} });
    expect(ownsRow).not.toHaveBeenCalled();
  });
});

describe('server guard and session primitives', () => {
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

    const parameterized = stampParameterizedSql({
      text: 'select * from products where id = $1',
      values: ['p1'],
    });
    expect(request.db.execute(parameterized)).toBe('ok');
    expect(
      request.db.execute({ text: 'select * from products where id = $1', values: ['p1'] }),
    ).toBe('ok');
    expect(calls).toHaveLength(2);
    expectManagedSqlStatement(calls[0], 'select * from products where id = $1');
    expectManagedSqlStatement(calls[1], 'select * from products where id = $1');
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
    expect(
      request.db.client.execute(
        stampTrustedSql(
          { text: 'select * from products where id = $1', values: ['p1'] },
          'audited migration clause',
        ),
      ),
    ).toBe('ok');
    expect(calls).toHaveLength(1);
    expectManagedSqlStatement(calls[0], 'select * from products where id = $1');
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
    expect(() => request.db.$client.prepare('select * from products')).toThrow(
      /raw driver escape db\.\$client|KV422/,
    );
    expect(calls).toEqual([]);

    expect(
      request.db.pglite.query({ text: 'select * from products where id = $1', values: ['p1'] }),
    ).toBe('pglite-ok');
    expect(
      request.db.sqlite.exec(
        stampParameterizedSql({ sql: 'select * from products where id = ?', args: ['p1'] }),
      ),
    ).toBe('sqlite-ok');
    expect(
      request.db.client.execute({ sql: 'select * from products where id = ?', args: ['p1'] }),
    ).toBe('client-ok');
    expect(() =>
      request.db.$client
        .prepare(stampStaticSql({ sql: 'select * from products where id = ?' }))
        .get(),
    ).toThrow(/raw driver escape db\.\$client|KV422/);
    expect(calls).toHaveLength(3);
    expectManagedSqlStatement(calls[0]?.[1], 'select * from products where id = $1');
    expectManagedSqlStatement(calls[1]?.[1], 'select * from products where id = ?');
    expectManagedSqlStatement(calls[2]?.[1], 'select * from products where id = ?');
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

    expect(
      request.db.query(stampParameterizedSql({ text: 'select * from products', values: [] })),
    ).toEqual([]);
    expect(
      request.db.execute({ text: 'select * from products where status = $1', values: [status] }),
    ).toBe('execute-ok');
    expect(
      request.db.exec(
        stampTrustedSql(
          { text: 'select * from products where id = $1', values: [ids[0]] },
          'audited static report clause',
        ),
      ),
    ).toBe('exec-ok');
    expect(calls).toHaveLength(3);
    expectManagedSqlStatement(calls[0], 'select * from products');
    expectManagedSqlStatement(calls[1], 'select * from products where status = $1');
    expectManagedSqlStatement(calls[2], 'select * from products where id = $1');
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
      auth: 'unauthenticated',
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
    const assertRolesRequired = () => {
      // @ts-expect-error guards.role() requires session.user.roles to be present in the request type.
      guards.role<{ session?: { user?: { id: string } | null } | null }>('admin');
    };
    const guarded = mutation('admin/refund', {
      guard: guards.role('admin'),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(
      runMutation(
        guarded,
        { productId: 'p1' },
        { session: { user: { id: 'staff_1', roles: ['staff'] } } },
      ),
    ).resolves.toEqual({
      auth: 'unauthorized',
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 403,
    });
    await expect(
      runMutation(
        guarded,
        { productId: 'p1' },
        { session: { user: { id: 'admin_1', roles: ['admin'] } } },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: 'ok',
    });
    expect(assertRolesRequired).toBeTypeOf('function');
  });

  it('records passed role guards on proxied lifecycle requests', async () => {
    const request = { session: { user: { id: 'admin_1', roles: ['admin'] } } };
    const guardedRequest = withGuardArgs(request, { productId: 'p1' });

    expect(requestPassedRoleGuard(request, 'admin')).toBe(false);
    expect(await guards.role<typeof guardedRequest>('admin')(guardedRequest)).toBe(true);
    expect(requestPassedRoleGuard(guardedRequest, 'admin')).toBe(true);
    expect(requestPassedRoleGuard(request, 'admin')).toBe(true);
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
    const guarded = mutation('cart/add', {
      guard: guards.rateLimit({ max: 1, per: 'session', windowMs: 5 }),
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
    ).resolves.toMatchObject({
      error: { code: 'RATE_LIMITED', payload: {} },
      ok: false,
      retryAfter: 1,
      status: 429,
    });

    await new Promise((resolve) => setTimeout(resolve, 15));

    await expect(
      runMutation(guarded, { productId: 'p1' }, { session: { id: 's1' } }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'ok',
    });
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

    expect(() => guard({})).toThrow(/cannot derive a proven per-principal key/);
    expect(() => guard({ session: {} })).toThrow(/cannot derive a proven per-principal key/);
  });

  it('rejects unresolved session principals instead of sharing an implicit unknown bucket', () => {
    const guard = guards.rateLimit<{
      session?: { id?: string; user?: { id?: string } | null } | null;
    }>({ max: 5, per: 'session' });

    expect(() => guard({ session: { id: 'unknown' } })).toThrow(
      /cannot derive a proven per-principal key/,
    );
    expect(() => guard({ session: { user: { id: 'anonymous' } } })).toThrow(
      /cannot derive a proven per-principal key/,
    );
    expect(() => guard({ session: { id: ' user-1 ' } })).toThrow(
      /cannot derive a proven per-principal key/,
    );
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

  it('snapshots rate-limit options so later app mutation cannot change audit or enforcement', () => {
    const options: {
      max: number;
      per: 'global' | 'session';
      windowMs: number;
    } = { max: 1, per: 'global', windowMs: 60_000 };
    const guard = guards.rateLimit<{ session?: { id?: string } }>(options);

    options.max = 10_000;
    options.per = 'session';
    options.windowMs = 1;

    expect(explainGuard(guard)).toEqual([{ kind: 'rateLimit', name: 'rateLimit', per: 'global' }]);
    expect(guard({})).toBe(true);
    expect(guard({})).toMatchObject({ kind: 'rateLimited' });
  });

  it('keeps audit facts frozen and bound to the exact framework guard identity', () => {
    const guard = guards.rateLimit<{ clientIp?: string }>({ max: 1, per: 'ip' });
    const facts = explainGuard(guard);
    const proxy = new Proxy(guard, {
      get(target, property, receiver) {
        if (property === Symbol.for('kovo.guard.audit')) {
          return [{ kind: 'rateLimit', name: 'rateLimit', per: 'global' }];
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    expect(Object.isFrozen(facts)).toBe(true);
    expect(Object.isFrozen(facts[0])).toBe(true);
    expect(() => {
      (facts[0] as { name: string }).name = 'forged';
    }).toThrow();
    expect(explainGuard(proxy)).toEqual([]);
  });

  it('marks an unaudited composite child opaque instead of dropping its authority', () => {
    type Request = { clientIp?: string };
    const custom = (_request: Request) => true as const;
    const composite = guards.all<Request>(
      custom,
      guards.rateLimit<Request>({ max: 10, per: 'ip' }),
    );

    expect(explainGuard(composite)).toEqual([
      { kind: 'opaque', name: 'custom' },
      { kind: 'rateLimit', name: 'rateLimit', per: 'ip' },
    ]);
  });

  it('keys default-scoped rate limiting by the proven session principal', () => {
    const guard = guards.rateLimit<{
      session?: { id?: string; user?: { id?: string } | null };
    }>({ max: 1, per: 'session' });

    expect(guard({ session: { id: 's1' } })).toBe(true);
    expect(guard({ session: { id: 's1' } })).toMatchObject({ kind: 'rateLimited' });
    expect(guard({ session: { id: 's2' } })).toBe(true);
    expect(guard({ session: { user: { id: 'u1' } } })).toBe(true);
    expect(guard({ session: { user: { id: 'u1' } } })).toMatchObject({ kind: 'rateLimited' });
    expect(guard({ session: { user: { id: 'u2' } } })).toBe(true);
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

  it('runs enhanced mutation CSRF, parse, and guard once before the handler', async () => {
    type Request = { session?: { id?: string; user?: { id: string } | null } | null };
    let csrfSessionReads = 0;
    let parseCalls = 0;
    let guardCalls = 0;
    let handlerCalls = 0;
    const request = { session: { id: 's1', user: { id: 'u1' } } } satisfies Request;
    const csrf = {
      secret: 'single-lifecycle-gate-secret-0123456789abcdef',
      sessionId(req: Request) {
        csrfSessionReads += 1;
        return req.session?.id;
      },
    };
    const objectInput = s.object({ productId: s.string() });
    const input: Schema<{ productId: string }> = {
      parse(rawInput) {
        parseCalls += 1;
        return objectInput.parse(rawInput);
      },
    };
    const guarded = mutation('cart/deduped-lifecycle', {
      csrf,
      guard(req: Request) {
        guardCalls += 1;
        return req.session?.user ? true : { kind: 'unauthenticated' as const, payload: {} };
      },
      input,
      handler() {
        handlerCalls += 1;
        return 'ok';
      },
    });
    const token = csrfToken(request, csrf, { audience: 'cart/deduped-lifecycle' });
    csrfSessionReads = 0;

    await expect(
      renderMutationResponse(guarded, {
        buildToken: 'single-lifecycle-build',
        rawInput: { 'kovo-csrf': token, productId: 'p1' },
        request,
      }),
    ).resolves.toMatchObject({ status: 200 });

    // The closed CSRF posture resolves the session once; lifecycle duplication would repeat it.
    expect(csrfSessionReads).toBe(1);
    expect(parseCalls).toBe(1);
    expect(guardCalls).toBe(1);
    expect(handlerCalls).toBe(1);
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

  it('routes stale session-bound enhanced mutation CSRF failures through reauth', async () => {
    type Request = { session?: { id?: string; user?: { id: string } | null } | null };
    const csrf = {
      secret: 'stale-enhanced-csrf-secret-0123456789abcdef',
      sessionId: (request: Request) => request.session?.id,
    };
    const guarded = mutation('cart/add', {
      csrf,
      guard: guards.authed<Request>(),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });
    const staleToken = csrfToken({ session: { id: 's1', user: { id: 'u1' } } }, csrf, {
      audience: 'cart/add',
    });

    await expect(
      renderMutationResponse(guarded, {
        currentUrl: '/cart',
        rawInput: { 'kovo-csrf': staleToken, productId: 'p1' },
        request: { session: null },
      }),
    ).resolves.toEqual({
      body: '',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Reauth': '/login?next=%2Fcart',
        Vary: 'Cookie',
      },
      status: 401,
    });
  });

  it('routes stale session-bound no-JS mutation CSRF failures through login redirect', async () => {
    type Request = { session?: { id?: string; user?: { id: string } | null } | null };
    const csrf = {
      secret: 'stale-nojs-csrf-secret-0123456789abcdef0123',
      sessionId: (request: Request) => request.session?.id,
    };
    const guarded = mutation('cart/add', {
      csrf,
      guard: guards.authed<Request>(),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });
    const staleToken = csrfToken({ session: { id: 's1', user: { id: 'u1' } } }, csrf, {
      audience: 'cart/add',
    });

    await expect(
      renderNoJsMutationResponse(guarded, {
        currentUrl: '/cart',
        rawInput: { 'kovo-csrf': staleToken, productId: 'p1' },
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

  it('stamps no-JS mutation CSRF failure pages with the document security floor', async () => {
    const guarded = mutation('cart/add', {
      csrf: {
        secret: 'nojs-failure-floor-csrf-secret-0123456789abc',
        sessionId: () => 's1',
      },
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    const response = await renderNoJsMutationResponse(guarded, {
      rawInput: { productId: 'p1' },
      redirectTo: '/cart',
      request: { session: { id: 's1' } },
    });

    expect(response).toMatchObject({
      body: '<!doctype html><html><body><output role="alert" data-error-code="CSRF">{}</output></body></html>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': expect.stringContaining("default-src 'self'"),
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        Vary: 'Cookie',
      },
      status: 422,
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
      headers: {
        'Cache-Control': 'private, no-store',
        Location: '/signin?continue=%2F',
        Vary: 'Cookie',
      },
      status: 303,
    });
  });

  it('keeps authenticated authorization failures on typed enhanced fragments with 403', async () => {
    const guarded = mutation('admin/refund', {
      csrf: false,
      guard: guards.role<{ session?: { user?: { id?: string; roles: readonly string[] } } | null }>(
        'admin',
      ),
      input: s.object({ orderId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(
      renderMutationResponse(guarded, {
        failureTarget: 'refund-form',
        rawInput: { orderId: 'o1' },
        request: { session: { user: { id: 'staff_1', roles: ['staff'] } } },
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
    const rateLimited = await renderNoJsMutationResponse(guarded, {
      rawInput: { productId: 'p1' },
      redirectTo: '/cart',
      request,
    });
    expect(rateLimited).toMatchObject({
      body: '<!doctype html><html><body><output role="alert" data-error-code="RATE_LIMITED">{}</output></body></html>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': expect.stringContaining("default-src 'self'"),
        'Content-Type': 'text/html; charset=utf-8',
        'Retry-After': '60',
        'X-Content-Type-Options': 'nosniff',
        Vary: 'Cookie',
      },
      status: 429,
    });
    expect(rateLimited.headers).toMatchObject({
      'Retry-After': '60',
    });
  });
});

describe('guards.owns (SPEC §10.3 ownership / IDOR discharge)', () => {
  // GuardArgsRequest types the framework-merged `req.args` so `keyOf` reads it without a cast
  // (SPEC §10.3:1155-1157, §9.4).
  type Req = GuardArgsRequest<
    { session?: { user?: { id: string } | null } | null },
    { id: string }
  >;
  const ownsRow = (req: Req, key: string) => req.session?.user?.id === `owner-of-${key}`;

  it('passes when the authenticated principal owns the row', async () => {
    const guard = guards.owns<Req, Req, string>((req) => req.args.id, ownsRow);
    await expect(
      guard({ session: { user: { id: 'owner-of-r1' } }, args: { id: 'r1' } }),
    ).resolves.toBe(true);
  });

  it('forbids when the principal does not own the row (IDOR)', async () => {
    const guard = guards.owns<Req, Req, string>((req) => req.args.id, ownsRow);
    await expect(
      guard({ session: { user: { id: 'someone-else' } }, args: { id: 'r1' } }),
    ).resolves.toEqual({ kind: 'forbidden', payload: {} });
  });

  it('rejects an unauthenticated caller before consulting the ownership check', async () => {
    const consulted: string[] = [];
    const guard = guards.owns<Req, Req, string>(
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
      guards.owns<Req, Req, string>((req) => req.args.id, ownsRow, {
        resourceKey: 'args.id',
      }),
    );
    expect(explainGuard(guard)).toEqual([
      {
        auth: 'session-user',
        kind: 'authed',
        name: 'authed',
      },
      {
        auth: 'session-user',
        kind: 'owns',
        name: 'owns',
        principal: {
          expression: 'session.user.id',
          path: 'user.id',
          source: 'session',
        },
        resourceKey: {
          expression: 'args.id',
          path: 'id',
          source: 'args',
        },
        staticProof: 'not-claimed',
      },
    ]);
    await expect(
      guard({ session: { user: { id: 'owner-of-r1' } }, args: { id: 'r1' } }),
    ).resolves.toBe(true);
    await expect(
      guard({ session: { user: { id: 'intruder' } }, args: { id: 'r1' } }),
    ).resolves.toEqual({ kind: 'forbidden', payload: {} });
  });

  it('awaits an async ownership predicate', async () => {
    const guard = guards.owns<Req, Req, string>(
      (req) => req.args.id,
      async (req, key) => Promise.resolve(req.session?.user?.id === `owner-of-${key}`),
    );
    await expect(
      guard({ session: { user: { id: 'owner-of-r9' } }, args: { id: 'r9' } }),
    ).resolves.toBe(true);
  });

  it('exposes ownership principal/key audit metadata without claiming static proof', async () => {
    const guard = guards.owns<Req, Req, string>((req) => req.args.id, ownsRow, {
      name: 'order-owner',
      principal: 'session.user.id',
      resourceKey: 'args.id',
    });

    expect(explainGuard(guard)).toEqual([
      {
        auth: 'session-user',
        kind: 'owns',
        name: 'order-owner',
        principal: {
          expression: 'session.user.id',
          path: 'user.id',
          source: 'session',
        },
        resourceKey: {
          expression: 'args.id',
          path: 'id',
          source: 'args',
        },
        staticProof: 'not-claimed',
      },
    ]);
    expect(Object.getOwnPropertySymbols(guard)).toHaveLength(0);
    expect(Object.keys(guard)).toEqual([]);
    await expect(
      guard({ session: { user: { id: 'owner-of-r1' } }, args: { id: 'r1' } }),
    ).resolves.toBe(true);
  });
});

describe('guards.owns production-path: runners thread validated args/params (SPEC §10.3:1155-1157, §9.4)', () => {
  // Drives the REAL runners end-to-end (NOT the synthetic `{ args }` object the unit tests pass),
  // so a regression where a runner fails to merge the validated args/params onto the guard request
  // — the latent KV414 IDOR — is caught. The request value passed to each runner carries NO
  // `args`/`params`; the only way an owner-specific predicate can pass is if the runner merged the
  // schema-coerced key onto `req` before the guard. Ownership model: principal `owner-of-<key>`
  // owns row `<key>`; a non-owner sending a foreign key is the real IDOR case.
  type AppReq = { session?: { user?: { id: string } | null } | null };
  const ownsRowById = (req: GuardArgsRequest<AppReq, { id: string }>, key: string): boolean =>
    req.session?.user?.id === `owner-of-${key}`;
  const ownsRouteRow = (req: GuardParamsRequest<AppReq, { id: string }>, key: string): boolean =>
    req.session?.user?.id === `owner-of-${key}`;

  const orderQuery = query('order', {
    args: s.object({ id: s.string() }),
    // `owns` returns a Guard<AppReq>; only keyOf/ownsRow see the merged GuardArgsRequest, so no cast.
    guard: guards.owns<AppReq, GuardArgsRequest<AppReq, { id: string }>, string>(
      (req) => req.args.id,
      ownsRowById,
      {
        name: 'order-query-owner',
        resourceKey: 'args.id',
      },
    ),
    load: (input: { id: string }) => ({ id: input.id }),
    reads: [],
  });

  it('runQuery allows the owner of the row the validated arg key selects', async () => {
    await expect(
      runQuery(orderQuery, { id: 'r1' }, { session: { user: { id: 'owner-of-r1' } } }),
    ).resolves.toMatchObject({ ok: true, value: { id: 'r1' } });
  });

  it('runQuery denies a non-owner whose foreign arg key targets another row (the IDOR case)', async () => {
    await expect(
      runQuery(orderQuery, { id: 'r1' }, { session: { user: { id: 'intruder' } } }),
    ).resolves.toMatchObject({
      auth: 'unauthorized',
      error: { code: 'UNAUTHORIZED' },
      ok: false,
      status: 422,
    });
  });

  const orderRoute = route('/orders/:id', {
    params: s.object({ id: s.string() }),
    guard: guards.owns<AppReq, GuardParamsRequest<AppReq, { id: string }>, string>(
      (req) => req.params.id,
      ownsRouteRow,
      {
        name: 'order-route-owner',
        resourceKey: 'params.id',
      },
    ),
    page: ({ params }) => trustedHtml(`<h1>order ${params.id}</h1>`),
  });

  it('runRoutePage allows the owner of the resolved route-param key', async () => {
    await expect(
      runRoutePage(
        orderRoute,
        { params: { id: 'r1' } },
        { session: { user: { id: 'owner-of-r1' } } },
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it('runRoutePage denies a non-owner for a foreign route-param key (the IDOR case)', async () => {
    await expect(
      runRoutePage(orderRoute, { params: { id: 'r1' } }, { session: { user: { id: 'intruder' } } }),
    ).resolves.toMatchObject({ auth: 'unauthorized', ok: false, status: 422 });
  });

  const orderMutation = mutation('order/touch', {
    guard: guards.owns<AppReq, GuardArgsRequest<AppReq, { id: string }>, string>(
      (req) => req.args.id,
      ownsRowById,
      {
        name: 'order-mutation-owner',
        resourceKey: 'args.id',
      },
    ),
    input: s.object({ id: s.string() }),
    handler: (input: { id: string }) => ({ id: input.id }),
  });

  it('keeps ownership audit metadata on query, route, and mutation guard declarations', () => {
    const expectedPrincipal = {
      expression: 'session.user.id',
      path: 'user.id',
      source: 'session',
    };

    expect(explainGuard(orderQuery.guard)).toEqual([
      {
        auth: 'session-user',
        kind: 'owns',
        name: 'order-query-owner',
        principal: expectedPrincipal,
        resourceKey: {
          expression: 'args.id',
          path: 'id',
          source: 'args',
        },
        staticProof: 'not-claimed',
      },
    ]);
    expect(explainGuard(orderRoute.guard)).toEqual([
      {
        auth: 'session-user',
        kind: 'owns',
        name: 'order-route-owner',
        principal: expectedPrincipal,
        resourceKey: {
          expression: 'params.id',
          path: 'id',
          source: 'params',
        },
        staticProof: 'not-claimed',
      },
    ]);
    expect(explainGuard(orderMutation.guard)).toEqual([
      {
        auth: 'session-user',
        kind: 'owns',
        name: 'order-mutation-owner',
        principal: expectedPrincipal,
        resourceKey: {
          expression: 'args.id',
          path: 'id',
          source: 'args',
        },
        staticProof: 'not-claimed',
      },
    ]);
  });

  it('runMutation (direct path: in-handler guard) allows the owner and denies the foreign key', async () => {
    await expect(
      runMutation(orderMutation, { id: 'r1' }, { session: { user: { id: 'owner-of-r1' } } }),
    ).resolves.toMatchObject({ ok: true, value: { id: 'r1' } });
    await expect(
      runMutation(orderMutation, { id: 'r1' }, { session: { user: { id: 'intruder' } } }),
    ).resolves.toEqual({
      auth: 'unauthorized',
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 403,
    });
  });

  it('real route/query/mutation runners deny a native Request with only inherited admin session', async () => {
    const existing = Object.getOwnPropertyDescriptor(Object.prototype, 'session');
    try {
      Object.defineProperty(Object.prototype, 'session', {
        configurable: true,
        value: { user: { id: 'owner-of-r1', roles: ['admin'] } },
      });
      const request: Request & AppReq = new Request('https://app.example/orders/r1');

      await expect(runQuery(orderQuery, { id: 'r1' }, request)).resolves.toMatchObject({
        auth: 'unauthenticated',
        ok: false,
      });
      await expect(
        runRoutePage(orderRoute, { params: { id: 'r1' } }, request),
      ).resolves.toMatchObject({ auth: 'unauthenticated', ok: false });
      await expect(runMutation(orderMutation, { id: 'r1' }, request)).resolves.toMatchObject({
        auth: 'unauthenticated',
        ok: false,
      });
    } finally {
      if (existing === undefined) delete (Object.prototype as { session?: unknown }).session;
      else Object.defineProperty(Object.prototype, 'session', existing);
    }
  });

  it('renderNoJsMutationResponse (production no-JS path: pre-replay guard) discharges KV414', async () => {
    // Owner → 303 PRG redirect; the foreign-key non-owner is denied with the 403 forbidden page,
    // proving the arg-aware guard ran with the validated args in the real dispatch path.
    await expect(
      renderNoJsMutationResponse(orderMutation, {
        rawInput: { id: 'r1' },
        redirectTo: '/orders/r1',
        request: { session: { user: { id: 'owner-of-r1' } } },
      }),
    ).resolves.toMatchObject({ status: 303 });
    await expect(
      renderNoJsMutationResponse(orderMutation, {
        rawInput: { id: 'r1' },
        redirectTo: '/orders/r1',
        request: { session: { user: { id: 'intruder' } } },
      }),
    ).resolves.toMatchObject({ status: 403 });
  });

  it('renderMutationResponse (production enhanced path: pre-replay guard) discharges KV414', async () => {
    // Owner → 200 fragment; foreign-key non-owner → 403 forbidden fragment in the enhanced path.
    await expect(
      renderMutationResponse(orderMutation, {
        buildToken: 'owns-build',
        rawInput: { id: 'r1' },
        request: { session: { user: { id: 'owner-of-r1' } } },
      }),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      renderMutationResponse(orderMutation, {
        buildToken: 'owns-build',
        rawInput: { id: 'r1' },
        request: { session: { user: { id: 'intruder' } } },
      }),
    ).resolves.toMatchObject({ status: 403 });
  });
});
