import { csrfToken, type CsrfOptions, type MutationDefinition, type Schema } from '@kovojs/server';
import { runMutation } from '@kovojs/server/internal/execution';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./internal/runtime-lock.js', () => ({
  assertBetterAuthRuntimeRealmLocked: vi.fn(),
}));

import {
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
  betterAuthSignUpEmailMutation,
  betterAuthCredentialMutationErrors,
  betterAuthCredentialMutationTouches,
  createBetterAuthCredentialMutationTouchGraph,
  getBetterAuthSetCookie,
  isBetterAuthCredentialFailureError,
  type BetterAuthResponseLike,
  type BetterAuthSignInEmailLike,
  type BetterAuthSignOutLike,
  type BetterAuthSignUpEmailLike,
} from './internal.js';
import {
  AuthApiError,
  fakeRoutedCredentialAuth,
  FakeCredentialAuth,
  requestHeaders,
  responseWithCookies,
} from './test-fakes.js';

const CREDENTIAL_CSRF_SECRET = 'better-auth-credential-csrf-test-secret-0123456789';

function credentialCsrf<Request>(): CsrfOptions<Request> {
  return {
    secret: CREDENTIAL_CSRF_SECRET,
    sessionId: () => 'better-auth-credential-test-session',
  };
}

async function runProtectedCredentialMutation<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request extends { headers: Headers },
  Value,
  GuardedRequest extends Request = Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  rawInput: Record<string, unknown>,
  request: Request,
) {
  const csrf = credentialCsrf<Request>();
  if (!Object.prototype.hasOwnProperty.call(request, 'clientIp')) {
    Object.defineProperty(request, 'clientIp', {
      configurable: true,
      enumerable: true,
      value: '192.0.2.10',
      writable: false,
    });
  }
  return runMutation(
    definition,
    {
      ...rawInput,
      'kovo-csrf': csrfToken(request, csrf, { mutation: definition }),
    },
    request,
    { csrf },
  );
}

describe('credential mutation helpers', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('keeps browser credential mutations CSRF-protected by default', async () => {
    const auth = new FakeCredentialAuth();
    const signIn = betterAuthSignInEmailMutation(auth);
    const request = { headers: requestHeaders() };

    expect(signIn.csrf).toBeUndefined();
    await expect(
      runMutation(signIn, { email: 'ada@example.com', password: 'correct' }, request, {
        csrf: credentialCsrf<typeof request>(),
      }),
    ).resolves.toEqual({
      error: { code: 'CSRF', payload: {} },
      ok: false,
      status: 422,
    });
    expect(auth.lastSignIn).toBeUndefined();
  });

  it('does not inherit credential CSRF or transaction authority from Object.prototype', () => {
    const auth = new FakeCredentialAuth();
    const inheritedTransaction = async <Result>(
      _request: unknown,
      run: (request: never) => Promise<Result>,
    ) => run({} as never);
    Object.defineProperties(Object.prototype, {
      csrf: {
        configurable: true,
        value: {
          secret: 'attacker-known-inherited-csrf-secret-0123456789',
          sessionId: () => 'attacker-session',
        },
      },
      transaction: { configurable: true, value: inheritedTransaction },
    });
    let signIn: ReturnType<typeof betterAuthSignInEmailMutation>;
    try {
      signIn = betterAuthSignInEmailMutation(auth);
    } finally {
      delete (Object.prototype as { csrf?: unknown }).csrf;
      delete (Object.prototype as { transaction?: unknown }).transaction;
    }

    expect(signIn.csrf).toBeUndefined();
    expect(signIn.transaction).not.toBe(inheritedTransaction);
  });

  it('owns and awaits configured and default credential continuations', async () => {
    const auth = new FakeCredentialAuth();
    const request = { headers: requestHeaders() };
    const directReturnAdapter = <Result>(
      adapterRequest: typeof request,
      run: (transactionRequest: typeof request) => Promise<Result>,
    ) => run(adapterRequest);
    const configured = betterAuthSignInEmailMutation(auth, {
      transaction: directReturnAdapter,
    });
    const defaulted = betterAuthSignUpEmailMutation(auth);

    for (const transaction of [configured.transaction, defaulted.transaction]) {
      if (!transaction) throw new Error('Missing credential transaction adapter');
      let continuationInvocations = 0;
      const continuation = Promise.resolve('complete');
      const completion = transaction(request, () => {
        continuationInvocations += 1;
        return continuation;
      });

      // SPEC §10.2: returning the continuation promise itself is not an awaiting adapter. The
      // wrapper owns a distinct completion promise and settles only after exactly one invocation.
      expect(completion).not.toBe(continuation);
      await expect(completion).resolves.toBe('complete');
      expect(continuationInvocations).toBe(1);
    }
  });

  it('rejects credential option accessors without invoking them', () => {
    const auth = new FakeCredentialAuth();
    let reads = 0;
    const options = Object.defineProperty({}, 'csrf', {
      get() {
        reads += 1;
        return false;
      },
    });

    expect(() => betterAuthSignInEmailMutation(auth, options as never)).toThrow(
      'credential option csrf must be an own-data property',
    );
    expect(reads).toBe(0);
  });

  it('rejects nested credential registry accessors without invoking them', () => {
    let reads = 0;
    const registry = Object.defineProperty({}, 'touches', {
      enumerable: true,
      get() {
        reads += 1;
        return [];
      },
    });

    expect(() =>
      betterAuthSignInEmailMutation(new FakeCredentialAuth(), { registry } as never),
    ).toThrow('credential registry touches must be an own-data property');
    expect(reads).toBe(0);
  });

  it('snapshots custom registry domains before late key mutation', () => {
    const customAuth = { key: 'auth' };
    const signIn = betterAuthSignInEmailMutation(new FakeCredentialAuth(), {
      registry: { touches: [customAuth] },
    } as never);
    customAuth.key = 'attacker-erased-auth';

    expect(signIn.registry?.touches?.map((touch) => touch.key)).toEqual(['auth']);
  });

  it('keeps mandatory credential touches immutable until app snapshotting', () => {
    const signIn = betterAuthSignInEmailMutation(new FakeCredentialAuth());
    const touches = signIn.registry?.touches;
    if (touches === undefined) throw new Error('Missing credential touches');

    expect(Reflect.set(touches, 'length', 0)).toBe(false);
    expect(Reflect.set(signIn.registry!, 'touches', [])).toBe(false);
    expect(touches.map((touch) => touch.key)).toEqual(['auth']);
  });

  it('rejects forged csrf:false options for every credential mutation', () => {
    const auth = new FakeCredentialAuth();
    const message = /credential mutations cannot disable CSRF.*SPEC §6\.6/i;

    expect(() => {
      // @ts-expect-error SPEC §6.6: pre-authentication forms cannot disable CSRF.
      betterAuthSignInEmailMutation(auth, { csrf: false });
    }).toThrow(message);
    expect(() => {
      // @ts-expect-error SPEC §6.6: pre-authentication forms cannot disable CSRF.
      betterAuthSignUpEmailMutation(auth, { csrf: false });
    }).toThrow(message);
    expect(() => {
      // @ts-expect-error SPEC §6.6: current-browser sign-out cannot disable CSRF.
      betterAuthSignOutMutation(auth, { csrf: false });
    }).toThrow(message);
  });

  it('does not invoke provider-owned status accessors while classifying credential failures', () => {
    let reads = 0;
    const password = 'ACCESSOR_PASSWORD_SHOULD_NEVER_ESCAPE';
    const error = Object.defineProperty(new Error('provider failed'), 'status', {
      get() {
        reads += 1;
        throw new Error(`accessor leaked ${password}`);
      },
    });

    expect(isBetterAuthCredentialFailureError(error)).toBe(false);
    expect(reads).toBe(0);
  });

  it.each(['sign-in', 'sign-up'] as const)(
    'does not let %s provider errors carry submitted passwords out of the trusted boundary',
    async (kind) => {
      const password = 'SUBMITTED_PASSWORD_SHOULD_NEVER_LOG';
      const auth = fakeRoutedCredentialAuth({
        signInEmail(input: { body: { password: string } }): never {
          throw new Error(`provider failed for password=${input.body.password}`);
        },
        async signUpEmail(input: { body: { password: string } }): Promise<never> {
          throw new Error(`provider failed for password=${input.body.password}`);
        },
      });
      const definition =
        kind === 'sign-in'
          ? betterAuthSignInEmailMutation(auth)
          : betterAuthSignUpEmailMutation(auth);
      const rawInput =
        kind === 'sign-in'
          ? { email: 'ada@example.test', password }
          : { email: 'ada@example.test', name: 'Ada', password };
      let thrown: unknown;

      try {
        await runProtectedCredentialMutation(
          definition as MutationDefinition<
            string,
            Schema<unknown>,
            Record<string, Schema<unknown>>,
            { headers: Headers },
            unknown
          >,
          rawInput,
          { headers: requestHeaders() },
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe(
        'Better Auth credential provider failed inside the trusted plaintext boundary.',
      );
      expect((thrown as Error).cause).toBeUndefined();
      expect(`${String((thrown as Error).stack)} ${JSON.stringify(thrown)}`).not.toContain(
        password,
      );
    },
  );

  it('wraps signInEmail as an ordinary mutation and forwards Better Auth cookies', async () => {
    const auth = new FakeCredentialAuth();
    const headers = requestHeaders();
    const signIn = betterAuthSignInEmailMutation(auth);

    expect(signIn.access).toEqual({
      kind: 'public',
      reason: 'better-auth email sign-in credential form',
    });
    expect(signIn.registry?.touches?.map((touch) => touch.key)).toEqual(['auth']);

    const result = await runProtectedCredentialMutation(
      signIn,
      {
        email: 'ada@example.com',
        next: '/account',
        password: 'correct',
      },
      { headers },
    );

    expect(auth.lastSignIn).toMatchObject({
      asResponse: true,
      body: {
        email: 'ada@example.com',
        password: 'correct',
      },
    });
    expect(auth.lastSignIn?.headers).not.toBe(headers);
    expect(auth.lastSignIn?.headers.get('x-forwarded-for')).toBe('192.0.2.10');
    expect(result).toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': [
          'kovo_session=session-1; Path=/; HttpOnly; SameSite=Lax',
          'kovo_session_data=user-1; Path=/; HttpOnly; SameSite=Lax',
        ],
      },
      value: {
        redirectTo: '/account',
        status: 'signed-in',
      },
    });
  });

  it('canonicalizes a lifecycle IPv6 address before assigning the Better Auth limiter key', async () => {
    const auth = new FakeCredentialAuth();
    const signIn = betterAuthSignInEmailMutation(auth);

    await expect(
      runProtectedCredentialMutation(
        signIn,
        { email: 'ada@example.com', password: 'correct' },
        {
          clientIp: '2001:0DB8:0:0:0:0:0:1',
          headers: requestHeaders(),
        },
      ),
    ).resolves.toMatchObject({ ok: true, value: { status: 'signed-in' } });
    expect(auth.lastSignIn?.headers.get('x-forwarded-for')).toBe('2001:db8::1');
  });

  it('maps invalid sign-in credentials to the declared mutation failure path', async () => {
    const auth = new FakeCredentialAuth();
    const signIn = betterAuthSignInEmailMutation(auth);

    const result = await runProtectedCredentialMutation(
      signIn,
      {
        email: 'ada@example.com',
        password: 'wrong-password-secret',
      },
      { headers: requestHeaders() },
    );

    expect(result).toEqual({
      error: {
        code: 'INVALID_CREDENTIALS',
        payload: {},
      },
      ok: false,
      status: 422,
    });
    expect(JSON.stringify(result)).not.toContain('wrong-password-secret');
  });

  it('routes real sign-in/sign-up through Better Auth rate limiting with trusted-IP isolation', async () => {
    const auth = betterAuth({
      advanced: {
        disableCSRFCheck: true,
        disableOriginCheck: true,
        ipAddress: { ipAddressHeaders: ['x-kovo-test-ip'] },
      },
      baseURL: 'https://example.test/api/auth',
      database: memoryAdapter({ account: [], session: [], user: [], verification: [] }),
      emailAndPassword: {
        enabled: true,
        password: {
          hash: async () => 'test-password-hash',
          verify: async () => false,
        },
      },
      rateLimit: { enabled: true },
      secret: 'better-auth-real-rate-limit-test-secret-0123456789',
    });
    const signIn = betterAuthSignInEmailMutation(auth);
    const signUp = betterAuthSignUpEmailMutation(auth);
    const request = (clientIp: string, spoofedIp: string) => ({
      clientIp,
      headers: new Headers({
        origin: 'https://example.test',
        'x-forwarded-for': spoofedIp,
        'x-kovo-test-ip': spoofedIp,
      }),
      url: 'https://example.test/login',
    });

    const signInResults = [];
    for (let index = 0; index < 4; index += 1) {
      signInResults.push(
        await runProtectedCredentialMutation(
          signIn,
          { email: 'missing@example.test', password: 'incorrect-password' },
          request('192.0.2.40', `198.51.100.${index + 1}`),
        ),
      );
    }
    expect(signInResults.slice(0, 3)).toEqual([
      expect.objectContaining({ error: { code: 'INVALID_CREDENTIALS', payload: {} }, status: 422 }),
      expect.objectContaining({ error: { code: 'INVALID_CREDENTIALS', payload: {} }, status: 422 }),
      expect.objectContaining({ error: { code: 'INVALID_CREDENTIALS', payload: {} }, status: 422 }),
    ]);
    expect(signInResults[3]).toEqual({
      error: { code: 'RATE_LIMITED', payload: {} },
      ok: false,
      retryAfter: 10,
      status: 429,
    });
    await expect(
      runProtectedCredentialMutation(
        signIn,
        { email: 'missing@example.test', password: 'incorrect-password' },
        request('192.0.2.41', '192.0.2.40'),
      ),
    ).resolves.toMatchObject({ error: { code: 'INVALID_CREDENTIALS' }, status: 422 });

    const signUpResults = [];
    for (let index = 0; index < 4; index += 1) {
      signUpResults.push(
        await runProtectedCredentialMutation(
          signUp,
          {
            email: `new-user-${index}@example.test`,
            name: `New User ${index}`,
            password: 'correct-password',
          },
          request('192.0.2.40', `203.0.113.${index + 1}`),
        ),
      );
    }
    expect(signUpResults.slice(0, 3).every((result) => result.ok)).toBe(true);
    expect(signUpResults[3]).toEqual({
      error: { code: 'RATE_LIMITED', payload: {} },
      ok: false,
      retryAfter: 10,
      status: 429,
    });
    await expect(
      runProtectedCredentialMutation(
        signUp,
        {
          email: 'isolated-user@example.test',
          name: 'Isolated User',
          password: 'correct-password',
        },
        request('192.0.2.41', '192.0.2.40'),
      ),
    ).resolves.toMatchObject({ ok: true, value: { status: 'signed-up' } });
  });

  it('fails loud instead of trusting raw or inherited client-IP headers', async () => {
    const auth = new FakeCredentialAuth();
    const signIn = betterAuthSignInEmailMutation(auth);
    const spoofedHeaders = () =>
      new Headers({
        origin: 'https://example.test',
        'x-forwarded-for': '198.51.100.200',
        'x-kovo-client-ip': '203.0.113.200',
      });
    const inheritedClientIp = Object.assign(Object.create({ clientIp: '192.0.2.200' }), {
      headers: spoofedHeaders(),
    }) as { clientIp?: string; headers: Headers };
    const requests: { clientIp?: string; headers: Headers }[] = [
      { headers: spoofedHeaders() },
      { clientIp: 'not-an-ip', headers: spoofedHeaders() },
      inheritedClientIp,
    ];

    for (const request of requests) {
      const csrf = credentialCsrf<typeof request>();
      await expect(
        runMutation(
          signIn,
          {
            email: 'ada@example.com',
            password: 'correct',
            'kovo-csrf': csrfToken(request, csrf, { mutation: signIn }),
          },
          request,
          { csrf },
        ),
      ).rejects.toThrow(
        'Better Auth credential provider failed inside the trusted plaintext boundary.',
      );
    }
    expect(auth.lastSignIn).toBeUndefined();
  });

  it('wraps signUpEmail with a typed body and typed credential failure', async () => {
    const auth = new FakeCredentialAuth();
    const signUp = betterAuthSignUpEmailMutation(auth, { defaultRedirectTo: '/welcome' });
    const headers = requestHeaders();

    expect(signUp.access).toEqual({
      kind: 'public',
      reason: 'better-auth email sign-up credential form',
    });
    expect(signUp.registry?.touches?.map((touch) => touch.key)).toEqual(['user', 'auth']);

    await expect(
      runProtectedCredentialMutation(
        signUp,
        {
          email: 'grace@example.com',
          name: 'Grace Hopper',
          password: 'correct',
        },
        { headers },
      ),
    ).resolves.toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': ['kovo_session=session-2; Path=/; HttpOnly; SameSite=Lax'],
      },
      value: {
        redirectTo: '/welcome',
        status: 'signed-up',
      },
    });
    expect(auth.lastSignUp).toMatchObject({
      asResponse: true,
      body: {
        email: 'grace@example.com',
        name: 'Grace Hopper',
        password: 'correct',
      },
    });
    expect(auth.lastSignUp?.headers).not.toBe(headers);
    expect(auth.lastSignUp?.headers.get('x-forwarded-for')).toBe('192.0.2.10');

    await expect(
      runProtectedCredentialMutation(
        signUp,
        {
          email: 'taken@example.com',
          name: 'Taken',
          password: 'correct',
        },
        { headers: requestHeaders() },
      ),
    ).resolves.toEqual({
      error: {
        code: 'INVALID_CREDENTIALS',
        payload: {},
      },
      ok: false,
      status: 422,
    });
  });

  it('wraps signOut and forwards clearing cookies', async () => {
    const auth = new FakeCredentialAuth();
    const headers = requestHeaders('kovo_session=session-1');
    const signOut = betterAuthSignOutMutation(auth);

    expect(signOut.access).toEqual({
      kind: 'public',
      reason: 'better-auth current-browser credential revocation form',
    });
    expect(signOut.registry?.touches?.map((touch) => touch.key)).toEqual(['auth']);

    const result = await runProtectedCredentialMutation(signOut, {}, { headers });

    expect(auth.lastSignOut).toEqual({
      asResponse: true,
      headers,
    });
    expect(result).toMatchObject({
      ok: true,
      // B3: Better Auth Set-Cookie headers are now re-emitted through the typed cookie builder, which
      // canonicalizes attribute order (Max-Age before Path). Functionally identical clearing cookies.
      responseHeaders: {
        'Clear-Site-Data': '"cookies", "storage", "executionContexts"',
        'Set-Cookie': [
          'kovo_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
          'kovo_session_data=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
        ],
      },
      value: {
        redirectTo: '/login',
        status: 'signed-out',
      },
    });
  });

  it('does not report or clear local state for a failed sign-out response', async () => {
    // SPEC §6.5/§9.1: logout success needs exact positive provider response evidence.
    // A resolved 5xx is not revocation and must not emit Clear-Site-Data or a signed-out outcome.
    const auth: BetterAuthSignOutLike = {
      api: {
        signOut: () =>
          new Response('provider failed', {
            headers: { 'set-cookie': 'kovo_session=; Max-Age=0; Path=/' },
            status: 500,
          }),
      },
    };
    const signOut = betterAuthSignOutMutation(auth);

    await expect(
      runProtectedCredentialMutation(
        signOut,
        {},
        {
          headers: requestHeaders('kovo_session=session-1'),
        },
      ),
    ).rejects.toThrow(
      'Better Auth credential provider failed inside the trusted plaintext boundary.',
    );
  });

  it('does not let deferred sign-out header failures carry cookie secrets out', async () => {
    const secret = 'SIGN_OUT_COOKIE_MUST_NOT_ESCAPE';
    const auth: BetterAuthSignOutLike = {
      api: {
        signOut: () => ({
          headers: {
            getSetCookie() {
              throw new Error(`sign-out parsing failed for ${secret}`);
            },
          } as unknown as Headers,
          status: 200,
        }),
      },
    };
    const result = await runProtectedCredentialMutation(
      betterAuthSignOutMutation(auth),
      {},
      { headers: requestHeaders('kovo_session=session-1') },
    );

    expect(result).toMatchObject({
      ok: true,
      responseHeaders: {
        'Clear-Site-Data': '"cookies", "storage", "executionContexts"',
      },
      value: { status: 'signed-out' },
    });
    expect(result.responseHeaders).not.toHaveProperty('Set-Cookie');
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it.each([Number.NaN, 200.5])(
    'rejects a structurally forged sign-out status %s instead of publishing revocation',
    async (status) => {
      // SPEC §6.5/§9.1 C9: only an exact HTTP success status is positive provider evidence.
      // NaN bypassed both range comparisons and fractional values can never be native HTTP status.
      const auth: BetterAuthSignOutLike = {
        api: {
          signOut: () => ({
            headers: responseWithCookies([
              'kovo_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
            ]).headers,
            status,
          }),
        },
      };
      const signOut = betterAuthSignOutMutation(auth);

      await expect(
        runProtectedCredentialMutation(
          signOut,
          {},
          { headers: requestHeaders('kovo_session=session-1') },
        ),
      ).rejects.toThrow(
        'Better Auth credential provider failed inside the trusted plaintext boundary.',
      );
    },
  );

  it('does not let the exported touch inventory erase later credential coverage', () => {
    // SPEC §10.3/§11.2 C9: internal observability exports are not mutable authority. A late
    // write to the exported derived array must not remove sign-up's user/auth touch closure.
    const exported = betterAuthCredentialMutationTouches.signUpEmail as Array<
      (typeof betterAuthCredentialMutationTouches.signUpEmail)[number]
    >;
    const saved = Array.from(exported);
    let mutated = false;
    try {
      mutated = Reflect.set(exported, 'length', 0);
      const signUp = betterAuthSignUpEmailMutation(new FakeCredentialAuth());
      expect(signUp.registry?.touches?.map((touch) => touch.key)).toEqual(['user', 'auth']);
    } finally {
      if (mutated) {
        Reflect.set(exported, 'length', 0);
        for (let index = 0; index < saved.length; index += 1) {
          Object.defineProperty(exported, index, {
            configurable: true,
            enumerable: true,
            value: saved[index],
            writable: true,
          });
        }
        Reflect.set(exported, 'length', saved.length);
      }
    }
  });

  it('does not let the exported error registry erase later credential failures', () => {
    // SPEC §6.5/§10.3 C9: exported declaration metadata is not mutable authority. Otherwise a
    // late delete can make the handler emit a failure absent from the mutation's declared schema.
    const exported = betterAuthCredentialMutationErrors as Record<string, unknown>;
    const original = Object.getOwnPropertyDescriptor(exported, 'INVALID_CREDENTIALS');
    if (original === undefined) throw new Error('Missing credential error schema');
    const deleted = Reflect.deleteProperty(exported, 'INVALID_CREDENTIALS');
    try {
      const signIn = betterAuthSignInEmailMutation(new FakeCredentialAuth());
      expect(signIn.errors).toHaveProperty('INVALID_CREDENTIALS');
    } finally {
      if (deleted) Object.defineProperty(exported, 'INVALID_CREDENTIALS', original);
    }
  });

  it('does not trust late native Response getters to forge sign-out success', async () => {
    const response = new Response('provider failed', { status: 500 });
    const auth: BetterAuthSignOutLike = { api: { signOut: () => response } };
    const signOut = betterAuthSignOutMutation(auth);
    const status = Object.getOwnPropertyDescriptor(Response.prototype, 'status');
    const headers = Object.getOwnPropertyDescriptor(Response.prototype, 'headers');
    if (!status?.get || !headers?.get) throw new Error('Response controls unavailable');
    const forged = new Headers({ 'set-cookie': 'kovo_session=; Max-Age=0; Path=/' });
    try {
      Object.defineProperty(Response.prototype, 'status', { ...status, get: () => 200 });
      Object.defineProperty(Response.prototype, 'headers', { ...headers, get: () => forged });
      await expect(
        runProtectedCredentialMutation(
          signOut,
          {},
          {
            headers: requestHeaders('kovo_session=session-1'),
          },
        ),
      ).rejects.toThrow(
        'Better Auth credential provider failed inside the trusted plaintext boundary.',
      );
    } finally {
      Object.defineProperty(Response.prototype, 'status', status);
      Object.defineProperty(Response.prototype, 'headers', headers);
    }
  });

  it('does not let inherited touch-graph option fields erase credential coverage', () => {
    // SPEC §10.3/§11.2: overload classification is part of the credential write graph.
    // An inherited `apis` field must not reinterpret ordinary key overrides as an empty graph.
    const keyOverrides = Object.create({ apis: [] }) as Record<string, string>;
    keyOverrides.signInEmail = 'custom/sign-in';

    const graph = createBetterAuthCredentialMutationTouchGraph(keyOverrides);
    expect(Object.keys(graph).sort()).toEqual(['auth/sign-out', 'auth/sign-up', 'custom/sign-in']);
  });

  it('rejects touch-graph option accessors without invoking them', () => {
    let reads = 0;
    const options = Object.defineProperty({}, 'apis', {
      get() {
        reads += 1;
        return [];
      },
    });

    expect(() => createBetterAuthCredentialMutationTouchGraph(options as never)).toThrow(
      /touch-graph option apis must be an own-data property/,
    );
    expect(reads).toBe(0);
  });

  it('pins routed credential handlers and their receiver before plaintext becomes reachable', async () => {
    const receiverCalls: Array<{ method: string; receiver: unknown }> = [];
    const handlerReceiverCalls: unknown[] = [];
    const capturedByPoison: string[] = [];
    let poisonCalls = 0;
    const api = {
      signInEmail(
        this: unknown,
        options: {
          asResponse: true;
          body: { email: string; password: string };
          headers: Headers;
        },
      ) {
        receiverCalls.push({ method: 'signInEmail', receiver: this });
        return responseWithCookies(['kovo_session=sign-in; Path=/; HttpOnly; SameSite=Lax']);
      },
      signOut(this: unknown, _options: { asResponse: true; headers: Headers }) {
        receiverCalls.push({ method: 'signOut', receiver: this });
        return responseWithCookies(['kovo_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax']);
      },
      signUpEmail(
        this: unknown,
        _options: {
          asResponse: true;
          body: { email: string; name: string; password: string };
          headers: Headers;
        },
      ) {
        receiverCalls.push({ method: 'signUpEmail', receiver: this });
        return responseWithCookies(['kovo_session=sign-up; Path=/; HttpOnly; SameSite=Lax']);
      },
    };
    const routed = fakeRoutedCredentialAuth(api);
    const auth = {
      ...routed,
      handler(this: unknown, request: Request) {
        handlerReceiverCalls.push(this);
        return routed.handler(request);
      },
    } satisfies BetterAuthSignInEmailLike & BetterAuthSignOutLike & BetterAuthSignUpEmailLike;
    const signIn = betterAuthSignInEmailMutation(auth);
    const signUp = betterAuthSignUpEmailMutation(auth);
    const signOut = betterAuthSignOutMutation(auth);

    api.signInEmail = (_options) => {
      poisonCalls += 1;
      capturedByPoison.push(_options.body.password);
      return responseWithCookies(['attacker=sign-in']);
    };
    api.signUpEmail = (_options) => {
      poisonCalls += 1;
      capturedByPoison.push(_options.body.password);
      return responseWithCookies(['attacker=sign-up']);
    };
    api.signOut = () => {
      poisonCalls += 1;
      return responseWithCookies(['attacker=sign-out']);
    };
    auth.api = {
      signInEmail: api.signInEmail,
      signOut: api.signOut,
      signUpEmail: api.signUpEmail,
    };
    auth.handler = async () => {
      poisonCalls += 1;
      return new Response(null, { status: 500 });
    };

    await expect(
      runProtectedCredentialMutation(
        signIn,
        { email: 'ada@example.com', password: 'SIGN_IN_SECRET' },
        { headers: requestHeaders() },
      ),
    ).resolves.toMatchObject({ ok: true, value: { status: 'signed-in' } });
    await expect(
      runProtectedCredentialMutation(
        signUp,
        { email: 'grace@example.com', name: 'Grace', password: 'SIGN_UP_SECRET' },
        { headers: requestHeaders() },
      ),
    ).resolves.toMatchObject({ ok: true, value: { status: 'signed-up' } });
    await expect(
      runProtectedCredentialMutation(signOut, {}, { headers: requestHeaders('kovo_session=s1') }),
    ).resolves.toMatchObject({ ok: true, value: { status: 'signed-out' } });

    expect(poisonCalls).toBe(0);
    expect(capturedByPoison).toEqual([]);
    expect(receiverCalls.map(({ method }) => method)).toEqual([
      'signInEmail',
      'signUpEmail',
      'signOut',
    ]);
    expect(receiverCalls.every(({ receiver }) => receiver === api)).toBe(true);
    expect(handlerReceiverCalls).toEqual([auth, auth]);
  });

  it('rejects accessor and inherited credential authority at declaration time', () => {
    const handlerAccessor = Object.defineProperty(
      {
        $context: Promise.resolve({
          baseURL: 'https://example.test/api/auth',
          options: { basePath: '/api/auth' },
        }),
        api: { signInEmail: () => responseWithCookies([]) },
      },
      'handler',
      {
        get: () => () => new Response(null, { status: 204 }),
      },
    ) as unknown as BetterAuthSignInEmailLike;
    const inheritedHandler = Object.assign(
      Object.create({ handler: () => new Response(null, { status: 204 }) }),
      {
        $context: Promise.resolve({
          baseURL: 'https://example.test/api/auth',
          options: { basePath: '/api/auth' },
        }),
        api: { signUpEmail: () => responseWithCookies([]) },
      },
    ) as BetterAuthSignUpEmailLike;
    const inheritedAuth = Object.create({
      api: { signOut: () => responseWithCookies([]) },
    }) as BetterAuthSignInEmailLike;

    expect(() => betterAuthSignInEmailMutation(handlerAccessor)).toThrow(
      'Better Auth sign-in.handler must be a stable own-data method',
    );
    expect(() =>
      betterAuthSignOutMutation(inheritedAuth as unknown as BetterAuthSignOutLike),
    ).toThrow('Better Auth sign-out.api must be a stable own-data object');
    expect(() => betterAuthSignUpEmailMutation(inheritedHandler)).toThrow(
      'Better Auth sign-up.handler must be a stable own-data method',
    );
  });

  it('snapshots and validates credential redirect defaults before request dispatch', async () => {
    const auth = new FakeCredentialAuth();
    const signInOptions = { defaultRedirectTo: '/safe-sign-in' };
    const signUpOptions = { defaultRedirectTo: '/safe-sign-up' };
    const signOutOptions = { defaultRedirectTo: '/safe-sign-out' };
    const signIn = betterAuthSignInEmailMutation(auth, signInOptions);
    const signUp = betterAuthSignUpEmailMutation(auth, signUpOptions);
    const signOut = betterAuthSignOutMutation(auth, signOutOptions);
    signInOptions.defaultRedirectTo = '//evil.example/sign-in';
    signUpOptions.defaultRedirectTo = '/\\evil.example/sign-up';
    signOutOptions.defaultRedirectTo = 'https://evil.example/sign-out';

    await expect(
      runProtectedCredentialMutation(
        signIn,
        { email: 'ada@example.com', password: 'correct' },
        { headers: requestHeaders() },
      ),
    ).resolves.toMatchObject({ value: { redirectTo: '/safe-sign-in' } });
    await expect(
      runProtectedCredentialMutation(
        signUp,
        { email: 'grace@example.com', name: 'Grace', password: 'correct' },
        { headers: requestHeaders() },
      ),
    ).resolves.toMatchObject({ value: { redirectTo: '/safe-sign-up' } });
    await expect(
      runProtectedCredentialMutation(signOut, {}, { headers: requestHeaders('kovo_session=s1') }),
    ).resolves.toMatchObject({ value: { redirectTo: '/safe-sign-out' } });

    const invalidConfiguredDefault = betterAuthSignInEmailMutation(auth, {
      defaultRedirectTo: 'https://evil.example/after-login',
    });
    await expect(
      runProtectedCredentialMutation(
        invalidConfiguredDefault,
        { email: 'ada@example.com', password: 'correct' },
        { headers: requestHeaders() },
      ),
    ).resolves.toMatchObject({ value: { redirectTo: '/' } });
  });

  it('keeps redirect targets on same-origin paths', async () => {
    const auth = new FakeCredentialAuth();
    const signIn = betterAuthSignInEmailMutation(auth, { defaultRedirectTo: '/dashboard' });

    await expect(
      runProtectedCredentialMutation(
        signIn,
        {
          email: 'ada@example.com',
          next: 'https://evil.example/account',
          password: 'correct',
        },
        { headers: requestHeaders() },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        redirectTo: '/dashboard',
      },
    });
  });

  it('exposes small helpers for Better Auth response quirks', () => {
    const headers = responseWithCookies([
      'kovo_session=session-1; Path=/; HttpOnly; SameSite=Lax',
    ]).headers;

    expect(getBetterAuthSetCookie(headers)).toEqual([
      'kovo_session=session-1; Path=/; HttpOnly; SameSite=Lax',
    ]);
    expect(isBetterAuthCredentialFailureError(new AuthApiError(403, 'Forbidden'))).toBe(true);
    expect(isBetterAuthCredentialFailureError(new AuthApiError(500, 'Broken'))).toBe(false);
  });

  // part-3 I1 (SPEC §9.1.1:856): an app serving login in a cross-site iframe sets
  // `advanced.defaultCookieAttributes = { partitioned: true }`; Better Auth then emits
  // `Set-Cookie: …; SameSite=None; Partitioned`. The re-emitted cookie MUST keep
  // `; Partitioned` or Chrome refuses/segregates it and login silently fails.
  it('preserves the Partitioned (CHIPS) attribute when forwarding Better Auth cookies', async () => {
    process.env.NODE_ENV = 'production';
    const auth = fakeRoutedCredentialAuth({
      signInEmail: () =>
        responseWithCookies([
          'better-auth.session_token=tok-1; Path=/; HttpOnly; Secure; SameSite=None; Partitioned',
        ]),
    });
    const signIn = betterAuthSignInEmailMutation(auth, { defaultRedirectTo: '/home' });

    const result = await runProtectedCredentialMutation(
      signIn,
      { email: 'ada@example.com', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toMatchObject({
      ok: true,
      responseHeaders: {
        // Round-trips through the forwarded-cookie sink (canonical attribute order), keeping
        // `; Partitioned` and `SameSite=None` while preserving Better Auth's own cookie name.
        // bugz-15 B1: Better Auth must be able to read the exact cookie name it writes.
        'Set-Cookie': [
          'better-auth.session_token=tok-1; Path=/; HttpOnly; Secure; SameSite=None; Partitioned',
        ],
      },
      value: { redirectTo: '/home', status: 'signed-in' },
    });
  });

  it('keeps Better Auth session cookie names readable under the HTTPS Secure floor', async () => {
    const auth = fakeRoutedCredentialAuth({
      signInEmail: () =>
        responseWithCookies(['better-auth.session_token=tok-1; Path=/; HttpOnly; SameSite=Lax']),
    });
    const signIn = betterAuthSignInEmailMutation(auth, { defaultRedirectTo: '/' });

    const result = await runProtectedCredentialMutation(
      signIn,
      { email: 'ada@example.com', password: 'correct' },
      new Request('https://example.test/login', { headers: requestHeaders() }),
    );

    expect(result).toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': ['better-auth.session_token=tok-1; Path=/; HttpOnly; Secure; SameSite=Lax'],
      },
      value: { redirectTo: '/', status: 'signed-in' },
    });
  });
});

// part-3 I3 (SECURITY_FINDINGS.md M2): a clearing cookie `sid=deleted; Expires=<past>`
// (non-empty value, no Max-Age) must NOT be classified as session-establishing, so a 2xx
// carrying only such a cookie fails to sign in instead of redirecting into the protected area.
describe('Expires-in-past clearing cookie is not session-establishing (part-3 I3)', () => {
  function signInAuthReturning(cookies: readonly string[]): BetterAuthSignInEmailLike {
    return fakeRoutedCredentialAuth({
      signInEmail: () => responseWithCookies(cookies, 200),
    });
  }

  it('does NOT sign in on a 200 whose only cookie has Expires in the past', async () => {
    const auth = signInAuthReturning([
      'better-auth.session_token=deleted; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly',
    ]);
    const signIn = betterAuthSignInEmailMutation(auth);

    const result = await runProtectedCredentialMutation(
      signIn,
      { email: 'ada@example.com', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toMatchObject({ ok: false, status: 422 });
  });

  it('still signs in when an Expires is in the future', async () => {
    const auth = signInAuthReturning([
      'better-auth.session_token=tok-1; Path=/; Expires=Tue, 19 Jan 2038 03:14:07 GMT; HttpOnly',
    ]);
    const signIn = betterAuthSignInEmailMutation(auth, { defaultRedirectTo: '/home' });

    const result = await runProtectedCredentialMutation(
      signIn,
      { email: 'ada@example.com', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toMatchObject({ ok: true, value: { status: 'signed-in' } });
  });

  it('keeps clearing-cookie evidence closed after late RegExp and Date poisoning', async () => {
    const auth = signInAuthReturning([
      'better-auth.session_token=deleted; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly',
    ]);
    const signIn = betterAuthSignInEmailMutation(auth);
    const originalExec = RegExp.prototype.exec;
    const originalDateParse = Date.parse;
    let result: unknown;
    try {
      RegExp.prototype.exec = function (value) {
        if (this.source.includes('max-age')) return null;
        return Reflect.apply(originalExec, this, [value]);
      };
      Date.parse = (value) =>
        value === 'Thu, 01 Jan 1970 00:00:00 GMT'
          ? originalDateParse('Tue, 19 Jan 2038 03:14:07 GMT')
          : originalDateParse(value);
      result = await runProtectedCredentialMutation(
        signIn,
        { email: 'ada@example.com', password: 'correct' },
        { headers: requestHeaders() },
      );
    } finally {
      RegExp.prototype.exec = originalExec;
      Date.parse = originalDateParse;
    }

    expect(result).toMatchObject({ ok: false, status: 422 });
  });
});

// part-3 L13-3: `getBetterAuthSetCookie`'s no-`getSetCookie()` fallback must split a
// comma-FOLDED multi-cookie header into separate cookies WITHOUT splitting inside an
// `Expires` date that itself contains a comma.
describe('getBetterAuthSetCookie comma-folded fallback (part-3 L13-3)', () => {
  it('does not erase cookie values through inherited numeric setters', () => {
    const nativeDefineProperty = Object.defineProperty;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let poisonHits = 0;
    let cookies: string[] | undefined;
    try {
      nativeDefineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          if (value === 'sid=reviewed; Path=/; HttpOnly') {
            poisonHits += 1;
            return;
          }
          nativeDefineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });
      cookies = getBetterAuthSetCookie({
        get: () => 'sid=reviewed; Path=/; HttpOnly, csrf=token; Path=/',
      } as unknown as Headers);
    } finally {
      if (originalDescriptor === undefined) {
        delete (Array.prototype as unknown as Record<string, unknown>)['0'];
      } else {
        nativeDefineProperty(Array.prototype, '0', originalDescriptor);
      }
    }
    expect(cookies).toEqual(['sid=reviewed; Path=/; HttpOnly', 'csrf=token; Path=/']);
    expect(poisonHits).toBe(0);
  });

  it('rejects unbounded structural Set-Cookie arrays before iterating them', () => {
    let descriptorReads = 0;
    const values = new Proxy(
      { length: 100_001 },
      {
        getOwnPropertyDescriptor(target, property) {
          descriptorReads += 1;
          if (property === 'length') {
            return { configurable: true, enumerable: false, value: target.length, writable: true };
          }
          if (typeof property === 'string' && /^\d+$/u.test(property)) {
            return { configurable: true, enumerable: true, value: 'sid=x', writable: true };
          }
          return undefined;
        },
      },
    );
    const headers = Object.defineProperty({}, 'getSetCookie', {
      value: () => values,
    }) as Headers;

    expect(getBetterAuthSetCookie(headers)).toEqual([]);
    expect(descriptorReads).toBeLessThan(10);
  });

  it('fails closed without leaking direct structural header inspection failures', () => {
    const secret = 'DIRECT_COOKIE_SECRET_MUST_NOT_ESCAPE';
    const headers = {
      getSetCookie() {
        throw new Error(`structural cookie failure for ${secret}`);
      },
    } as unknown as Headers;
    expect(getBetterAuthSetCookie(headers)).toEqual([]);
  });

  function headersWithFoldedSetCookie(folded: string): Headers {
    // A Headers shim with no getSetCookie(): forces the fallback path. The real
    // platform Headers always exposes getSetCookie(), so this models a degraded runtime.
    return {
      get: (name: string) => (name.toLowerCase() === 'set-cookie' ? folded : null),
    } as unknown as Headers;
  }

  it('splits a comma-folded two-cookie header into both cookies', () => {
    const headers = headersWithFoldedSetCookie('a=1; Path=/; HttpOnly, b=2; Path=/; HttpOnly');
    expect(getBetterAuthSetCookie(headers)).toEqual([
      'a=1; Path=/; HttpOnly',
      'b=2; Path=/; HttpOnly',
    ]);
  });

  it('does not split inside an Expires date containing a comma', () => {
    const folded = 'sid=tok; Path=/; Expires=Wed, 09 Jun 2099 10:18:14 GMT; HttpOnly';
    const headers = headersWithFoldedSetCookie(folded);
    expect(getBetterAuthSetCookie(headers)).toEqual([folded]);
  });

  it('splits two cookies that each carry an Expires-comma date', () => {
    const headers = headersWithFoldedSetCookie(
      'a=1; Expires=Wed, 09 Jun 2099 10:18:14 GMT, b=2; Expires=Thu, 10 Jun 2099 10:18:14 GMT',
    );
    expect(getBetterAuthSetCookie(headers)).toEqual([
      'a=1; Expires=Wed, 09 Jun 2099 10:18:14 GMT',
      'b=2; Expires=Thu, 10 Jun 2099 10:18:14 GMT',
    ]);
  });

  it('uses getSetCookie() verbatim when available (no comma-folding fallback)', () => {
    const headers = responseWithCookies(['a=1; Path=/', 'b=2; Path=/']).headers;
    expect(getBetterAuthSetCookie(headers)).toEqual(['a=1; Path=/', 'b=2; Path=/']);
  });
});

// SECURITY_FINDINGS.md H4: backslash / control-char open-redirect hardening.
describe('redirectPath same-origin hardening', () => {
  async function signInWithNext(next: string): Promise<string | undefined> {
    const auth = new FakeCredentialAuth();
    const signIn = betterAuthSignInEmailMutation(auth, { defaultRedirectTo: '/dashboard' });

    const result = await runProtectedCredentialMutation(
      signIn,
      { email: 'ada@example.com', next, password: 'correct' },
      { headers: requestHeaders() },
    );

    return result.ok ? (result.value as { redirectTo: string }).redirectTo : undefined;
  }

  it('falls back when a backslash forms a cross-origin authority', async () => {
    expect(await signInWithNext('/\\evil.com')).toBe('/dashboard');
    expect(await signInWithNext('/\\/evil.com')).toBe('/dashboard');
    expect(await signInWithNext('\\/evil.com')).toBe('/dashboard');
  });

  it('falls back when the target carries a control character (CRLF smuggling)', async () => {
    expect(await signInWithNext('/account\r\nLocation: https://evil.com')).toBe('/dashboard');
    expect(await signInWithNext('/account\nSet-Cookie: x=1')).toBe('/dashboard');
  });

  it('keeps legitimate same-origin paths intact', async () => {
    expect(await signInWithNext('/cart')).toBe('/cart');
    expect(await signInWithNext('/a/b?x=1#h')).toBe('/a/b?x=1#h');
  });

  it('keeps cross-origin and CRLF targets closed after late redirect-control poisoning', async () => {
    const originalStartsWith = String.prototype.startsWith;
    const originalReplace = String.prototype.replace;
    const originalTest = RegExp.prototype.test;
    let protocolRelative: string | undefined;
    let backslashAuthority: string | undefined;
    let headerInjection: string | undefined;
    try {
      String.prototype.startsWith = function (search, position) {
        if (this.valueOf() === '//evil.example/phish' && search === '//') return false;
        return Reflect.apply(originalStartsWith, this, [search, position]);
      };
      String.prototype.replace = function (search, replacement) {
        if (this.valueOf() === '/\\evil.example/phish') return this.valueOf();
        return Reflect.apply(originalReplace, this, [search, replacement]);
      };
      RegExp.prototype.test = function (value) {
        if (value === '/account\r\nLocation: https://evil.example') return false;
        return Reflect.apply(originalTest, this, [value]);
      };

      protocolRelative = await signInWithNext('//evil.example/phish');
      backslashAuthority = await signInWithNext('/\\evil.example/phish');
      headerInjection = await signInWithNext('/account\r\nLocation: https://evil.example');
    } finally {
      String.prototype.startsWith = originalStartsWith;
      String.prototype.replace = originalReplace;
      RegExp.prototype.test = originalTest;
    }

    expect(protocolRelative).toBe('/dashboard');
    expect(backslashAuthority).toBe('/dashboard');
    expect(headerInjection).toBe('/dashboard');
  });
});

// SECURITY_FINDINGS.md M2: credential success must be classified by positive
// evidence (2xx + session-establishing Set-Cookie + not a two-factor-pending body).
describe('credential success is positively classified', () => {
  function jsonResponse(
    status: number,
    body: unknown,
    cookies: readonly string[] = [],
  ): BetterAuthResponseLike {
    const response = new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
      status,
    });

    for (const cookie of cookies) response.headers.append('set-cookie', cookie);

    return response;
  }

  function signInAuthReturning(response: BetterAuthResponseLike): BetterAuthSignInEmailLike {
    return fakeRoutedCredentialAuth({
      signInEmail: () => response,
    });
  }

  it('treats a 2xx response with a session-establishing cookie as signed-in', async () => {
    const auth = signInAuthReturning(
      jsonResponse(200, { ok: true }, [
        'better-auth.session_token=tok-1; Path=/; HttpOnly; SameSite=Lax',
      ]),
    );
    const signIn = betterAuthSignInEmailMutation(auth, { defaultRedirectTo: '/home' });

    const result = await runProtectedCredentialMutation(
      signIn,
      { email: 'ada@example.com', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toMatchObject({
      ok: true,
      responseHeaders: {
        'Set-Cookie': ['better-auth.session_token=tok-1; Path=/; HttpOnly; SameSite=Lax'],
      },
      value: { redirectTo: '/home', status: 'signed-in' },
    });
  });

  it('does NOT sign in on a 200 two-factor-pending body (no session cookie)', async () => {
    const auth = signInAuthReturning(jsonResponse(200, { twoFactorRedirect: true }));
    const signIn = betterAuthSignInEmailMutation(auth);

    const result = await runProtectedCredentialMutation(
      signIn,
      { email: 'ada@example.com', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toEqual({
      error: { code: 'INVALID_CREDENTIALS', payload: {} },
      ok: false,
      status: 422,
    });
  });

  it('does NOT sign in on a 2xx response without a session-establishing cookie', async () => {
    const auth = signInAuthReturning(jsonResponse(200, { ok: true }));
    const signIn = betterAuthSignInEmailMutation(auth);

    const result = await runProtectedCredentialMutation(
      signIn,
      { email: 'ada@example.com', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toMatchObject({ ok: false, status: 422 });
  });

  it('does NOT sign in when late Array/Headers poisoning forges session evidence', async () => {
    const auth = signInAuthReturning(jsonResponse(200, { ok: true }));
    const signIn = betterAuthSignInEmailMutation(auth);
    const originalSome = Array.prototype.some;
    const originalGetSetCookie = Headers.prototype.getSetCookie;
    let result: Awaited<ReturnType<typeof runProtectedCredentialMutation>>;
    try {
      Array.prototype.some = function (callback, thisArg) {
        if (callback.name === 'isSessionEstablishingSetCookie') return true;
        return Reflect.apply(originalSome, this, [callback, thisArg]);
      };
      Headers.prototype.getSetCookie = () => ['attacker_session=forged; Path=/; HttpOnly'];
      result = await runProtectedCredentialMutation(
        signIn,
        { email: 'ada@example.com', password: 'correct' },
        { headers: requestHeaders() },
      );
    } finally {
      Array.prototype.some = originalSome;
      Headers.prototype.getSetCookie = originalGetSetCookie;
    }

    expect(result).toMatchObject({ ok: false, status: 422 });
  });

  it('does not let an own shadow on native Headers forge session-cookie evidence', async () => {
    // SPEC §6.5/§9.1 C9: native Headers brand evidence outranks structural extension methods.
    // An own method on a genuinely native header bag must not replace its boot-pinned contents.
    const response = jsonResponse(200, { ok: true });
    Object.defineProperty(response.headers, 'getSetCookie', {
      configurable: true,
      value: () => ['attacker_session=forged; Path=/; HttpOnly'],
    });
    const auth = signInAuthReturning(response);
    const result = await runProtectedCredentialMutation(
      betterAuthSignInEmailMutation(auth),
      { email: 'ada@example.com', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toMatchObject({ ok: false, status: 422 });
  });

  it('treats a 429 rate-limit response as a failure, not a sign-in', async () => {
    const auth = signInAuthReturning(jsonResponse(429, { message: 'rate limited' }));
    const signIn = betterAuthSignInEmailMutation(auth);

    const result = await runProtectedCredentialMutation(
      signIn,
      { email: 'ada@example.com', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toMatchObject({ error: { code: 'RATE_LIMITED' }, ok: false, status: 429 });
  });

  it('treats a 500 response as a failure, not a sign-in', async () => {
    const auth = signInAuthReturning(jsonResponse(500, { message: 'broken' }));
    const signIn = betterAuthSignInEmailMutation(auth);

    const result = await runProtectedCredentialMutation(
      signIn,
      { email: 'ada@example.com', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toMatchObject({ ok: false, status: 422 });
  });

  it('does NOT trust late-poisoned native Response status or headers getters', async () => {
    const response = jsonResponse(500, { message: 'broken' });
    const auth = signInAuthReturning(response);
    const signIn = betterAuthSignInEmailMutation(auth);
    const statusDescriptor = Object.getOwnPropertyDescriptor(Response.prototype, 'status')!;
    const headersDescriptor = Object.getOwnPropertyDescriptor(Response.prototype, 'headers')!;
    const forgedHeaders = new Headers();
    forgedHeaders.append('set-cookie', 'attacker_session=forged; Path=/; HttpOnly');
    let result: unknown;
    try {
      Object.defineProperty(Response.prototype, 'status', {
        ...statusDescriptor,
        get: () => 200,
      });
      Object.defineProperty(Response.prototype, 'headers', {
        ...headersDescriptor,
        get: () => forgedHeaders,
      });
      result = await runProtectedCredentialMutation(
        signIn,
        { email: 'ada@example.com', password: 'correct' },
        { headers: requestHeaders() },
      );
    } finally {
      Object.defineProperty(Response.prototype, 'status', statusDescriptor);
      Object.defineProperty(Response.prototype, 'headers', headersDescriptor);
    }

    expect(result).toMatchObject({ ok: false, status: 422 });
  });

  it('does NOT sign up on a 200 two-factor-pending body', async () => {
    const auth = fakeRoutedCredentialAuth({
      signUpEmail: () => jsonResponse(200, { twoFactorRedirect: true }),
    });
    const signUp = betterAuthSignUpEmailMutation(auth);

    const result = await runProtectedCredentialMutation(
      signUp,
      { email: 'grace@example.com', name: 'Grace Hopper', password: 'correct' },
      { headers: requestHeaders() },
    );

    expect(result).toMatchObject({ ok: false, status: 422 });
  });
});
