import { describe, expect, it } from 'vitest';

type SessionUser = {
  email: string;
  id: string;
};

type Session = {
  user: SessionUser;
};

type SignInBody = {
  email: string;
  password: string;
};

type SignInInput = SignInBody & {
  next?: string;
};

type Failure = {
  code: 'INVALID_CREDENTIALS';
  kind: 'fail';
  payload: Record<string, never>;
};

type Redirect = {
  headers: string[];
  kind: 'redirect';
  location: string;
};

type MutationContext = {
  fail(code: Failure['code'], payload: Failure['payload']): Failure;
  setCookie(cookie: string): void;
};

type BetterAuthLikeApi = {
  getSession(options: { headers: Headers }): Promise<Session | null>;
  signInEmail(options: { asResponse: true; body: SignInBody; headers: Headers }): Promise<Response>;
  signOut(options: { asResponse: true; headers: Headers }): Promise<Response>;
};

class AuthApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

class FakeBetterAuthApi implements BetterAuthLikeApi {
  private readonly sessions = new Map<string, Session>();

  async getSession(options: { headers: Headers }): Promise<Session | null> {
    const sessionId = readCookie(options.headers, 'jiso_session');

    return sessionId ? (this.sessions.get(sessionId) ?? null) : null;
  }

  async signInEmail(options: {
    asResponse: true;
    body: SignInBody;
    headers: Headers;
  }): Promise<Response> {
    expect(options.asResponse).toBe(true);
    expect(options.headers.get('user-agent')).toBe('vitest');

    if (options.body.email !== 'ada@example.com' || options.body.password !== 'correct') {
      throw new AuthApiError(401, 'Invalid credentials');
    }

    this.sessions.set('session-1', {
      user: {
        email: options.body.email,
        id: 'user-1',
      },
    });

    const headers = new Headers();
    headers.append('Set-Cookie', 'jiso_session=session-1; Path=/; HttpOnly; SameSite=Lax');
    headers.append('Set-Cookie', 'jiso_session_data=user-1; Path=/; HttpOnly; SameSite=Lax');

    return new Response(null, { headers, status: 204 });
  }

  async signOut(options: { asResponse: true; headers: Headers }): Promise<Response> {
    expect(options.asResponse).toBe(true);

    const sessionId = readCookie(options.headers, 'jiso_session');
    if (sessionId) {
      this.sessions.delete(sessionId);
    }

    const headers = new Headers();
    headers.append('Set-Cookie', 'jiso_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    headers.append('Set-Cookie', 'jiso_session_data=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');

    return new Response(null, { headers, status: 204 });
  }
}

async function signInMutation(
  auth: Pick<BetterAuthLikeApi, 'signInEmail'>,
  input: SignInInput,
  requestHeaders: Headers,
  ctx: MutationContext,
): Promise<Failure | Redirect> {
  try {
    const authResponse = await auth.signInEmail({
      asResponse: true,
      body: {
        email: input.email,
        password: input.password,
      },
      headers: requestHeaders,
    });

    forwardSetCookie(authResponse.headers, ctx);

    return {
      headers: getSetCookie(authResponse.headers),
      kind: 'redirect',
      location: input.next ?? '/',
    };
  } catch (error) {
    if (error instanceof AuthApiError && (error.status === 401 || error.status === 403)) {
      return ctx.fail('INVALID_CREDENTIALS', {});
    }

    throw error;
  }
}

async function signOutMutation(
  auth: Pick<BetterAuthLikeApi, 'signOut'>,
  requestHeaders: Headers,
  ctx: MutationContext,
): Promise<Redirect> {
  const authResponse = await auth.signOut({
    asResponse: true,
    headers: requestHeaders,
  });

  forwardSetCookie(authResponse.headers, ctx);

  return {
    headers: getSetCookie(authResponse.headers),
    kind: 'redirect',
    location: '/login',
  };
}

async function betterAuthSession(
  auth: Pick<BetterAuthLikeApi, 'getSession'>,
  requestHeaders: Headers,
): Promise<Session | null> {
  const session = await auth.getSession({ headers: requestHeaders });

  if (!session) {
    return null;
  }

  return {
    user: {
      email: session.user.email,
      id: session.user.id,
    },
  };
}

function createMutationContext(): MutationContext & { cookies: string[] } {
  const cookies: string[] = [];

  return {
    cookies,
    fail(code, payload) {
      return { code, kind: 'fail', payload };
    },
    setCookie(cookie) {
      cookies.push(cookie);
    },
  };
}

function forwardSetCookie(headers: Headers, ctx: Pick<MutationContext, 'setCookie'>): void {
  for (const cookie of getSetCookie(headers)) {
    ctx.setCookie(cookie);
  }
}

function getSetCookie(headers: Headers): string[] {
  const platformHeaders = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const cookies = platformHeaders.getSetCookie?.();

  if (cookies && cookies.length > 0) {
    return cookies;
  }

  const cookie = headers.get('set-cookie');

  return cookie ? [cookie] : [];
}

function readCookie(headers: Headers, name: string): string | null {
  const cookieHeader = headers.get('cookie');
  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = cookie.trim().split('=');
    if (rawName === name) {
      return rawValue.join('=');
    }
  }

  return null;
}

function requestHeaders(cookie?: string): Headers {
  const headers = new Headers({ 'user-agent': 'vitest' });

  if (cookie) {
    headers.set('cookie', cookie);
  }

  return headers;
}

describe('wrapped Better Auth credential mutation spike', () => {
  it.each(['enhanced', 'no-js'] as const)(
    'forwards auth cookies through the normal redirect vocabulary for %s sign-in',
    async () => {
      const auth = new FakeBetterAuthApi();
      const ctx = createMutationContext();

      const result = await signInMutation(
        auth,
        {
          email: 'ada@example.com',
          next: '/account',
          password: 'correct',
        },
        requestHeaders(),
        ctx,
      );

      expect(result).toEqual({
        headers: [
          'jiso_session=session-1; Path=/; HttpOnly; SameSite=Lax',
          'jiso_session_data=user-1; Path=/; HttpOnly; SameSite=Lax',
        ],
        kind: 'redirect',
        location: '/account',
      });
      expect(result.kind).toBe('redirect');
      if (result.kind !== 'redirect') {
        throw new Error('Expected sign-in to redirect');
      }
      expect(ctx.cookies).toEqual(result.headers);

      const session = await betterAuthSession(auth, requestHeaders('jiso_session=session-1'));

      expect(session).toEqual({
        user: {
          email: 'ada@example.com',
          id: 'user-1',
        },
      });
    },
  );

  it('maps invalid credentials to a declared mutation failure without forwarding cookies', async () => {
    const auth = new FakeBetterAuthApi();
    const ctx = createMutationContext();

    const result = await signInMutation(
      auth,
      {
        email: 'ada@example.com',
        password: 'wrong',
      },
      requestHeaders(),
      ctx,
    );

    expect(result).toEqual({
      code: 'INVALID_CREDENTIALS',
      kind: 'fail',
      payload: {},
    });
    expect(ctx.cookies).toEqual([]);
  });

  it('forwards clearing cookies on sign-out and leaves the next request anonymous', async () => {
    const auth = new FakeBetterAuthApi();
    const signInCtx = createMutationContext();

    await signInMutation(
      auth,
      {
        email: 'ada@example.com',
        password: 'correct',
      },
      requestHeaders(),
      signInCtx,
    );

    const signOutCtx = createMutationContext();
    const result = await signOutMutation(
      auth,
      requestHeaders('jiso_session=session-1'),
      signOutCtx,
    );

    expect(result).toEqual({
      headers: [
        'jiso_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
        'jiso_session_data=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
      ],
      kind: 'redirect',
      location: '/login',
    });
    expect(signOutCtx.cookies).toEqual(result.headers);
    await expect(betterAuthSession(auth, requestHeaders('jiso_session=session-1'))).resolves.toBe(
      null,
    );
  });
});
