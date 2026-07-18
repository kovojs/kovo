import { type BetterAuthLike, type BetterAuthResponseLike } from './internal.js';

export type AuthSession = {
  activeOrganizationId: null | string;
  id: string;
};

export type AuthUser = {
  email: string;
  id: string;
  roles: readonly ('admin' | 'member')[];
};

export type AppSession = {
  activeOrganizationId: null | string;
  id: string;
  user: {
    email: string;
    id: string;
    roles: readonly ('admin' | 'member')[];
  };
};

export type RequestWithHeaders = {
  headers: Headers;
};

export type AppRequest = {
  session?: AppSession | null;
};

// part-3 I2: the adapter calls getSession with `returnHeaders: true`, so the fake returns
// the `{ response, headers }` shape and can simulate a session-refresh Set-Cookie header.
export class FakeBetterAuth implements BetterAuthLike<AuthSession, AuthUser> {
  // Set to a raw Set-Cookie string to simulate a rolling-session / cookie-cache refresh
  // header that Better Auth writes on `updateAge`/`cookieCache`.
  refreshSetCookie: string | undefined;

  readonly api = {
    getSession: (options: { headers: Headers; returnHeaders: true }) => {
      this.lastHeaders = options.headers;

      const authenticated = options.headers.get('cookie') === 'kovo_session=s1';
      const response = authenticated
        ? {
            session: {
              activeOrganizationId: 'org-1' as const,
              id: 'session-1',
            },
            user: {
              email: 'ada@example.com',
              id: 'user-1',
              roles: ['admin', 'member'] as const,
            },
          }
        : null;

      const headers = new Headers();
      if (this.refreshSetCookie !== undefined) {
        headers.append('set-cookie', this.refreshSetCookie);
      }
      return { headers, response };
    },
  };

  lastHeaders: Headers | undefined;
}

export class AuthApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class FakeCredentialAuth {
  readonly $context = Promise.resolve({
    baseURL: 'https://example.test/api/auth',
    options: {
      advanced: { ipAddress: { ipAddressHeaders: ['x-forwarded-for'] } },
      basePath: '/api/auth',
    },
  });

  readonly api = {
    signInEmail: async (options: {
      asResponse: true;
      body: { email: string; password: string };
      headers: Headers;
    }): Promise<BetterAuthResponseLike> => {
      this.lastSignIn = options;

      if (options.body.email !== 'ada@example.com' || options.body.password !== 'correct') {
        throw new AuthApiError(401, 'Invalid credentials');
      }

      return responseWithCookies([
        'kovo_session=session-1; Path=/; HttpOnly; SameSite=Lax',
        'kovo_session_data=user-1; Path=/; HttpOnly; SameSite=Lax',
      ]);
    },
    signOut: async (options: { asResponse: true; headers: Headers }) => {
      this.lastSignOut = options;

      return responseWithCookies([
        'kovo_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
        'kovo_session_data=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
      ]);
    },
    signUpEmail: async (options: {
      asResponse: true;
      body: { email: string; name: string; password: string };
      headers: Headers;
    }): Promise<BetterAuthResponseLike> => {
      this.lastSignUp = options;

      if (options.body.email === 'taken@example.com') {
        return responseWithCookies([], 400);
      }

      return responseWithCookies(['kovo_session=session-2; Path=/; HttpOnly; SameSite=Lax']);
    },
  };

  readonly handler = async (request: Request): Promise<Response> =>
    routeFakeCredentialApi(this.api, request);

  lastSignIn:
    | { asResponse: true; body: { email: string; password: string }; headers: Headers }
    | undefined;
  lastSignOut: { asResponse: true; headers: Headers } | undefined;
  lastSignUp:
    | {
        asResponse: true;
        body: { email: string; name: string; password: string };
        headers: Headers;
      }
    | undefined;
}

export function fakeRoutedCredentialAuth<
  Api extends {
    signInEmail?: (...args: any[]) => any;
    signOut?: (...args: any[]) => any;
    signUpEmail?: (...args: any[]) => any;
  },
>(api: Api, baseURL = 'https://example.test/api/auth') {
  const signInEmail = api.signInEmail;
  const signUpEmail = api.signUpEmail;
  const handlerApi = {
    ...(signInEmail === undefined
      ? {}
      : { signInEmail: (...args: any[]) => Reflect.apply(signInEmail, api, args) }),
    ...(signUpEmail === undefined
      ? {}
      : { signUpEmail: (...args: any[]) => Reflect.apply(signUpEmail, api, args) }),
  };
  return {
    $context: Promise.resolve({
      baseURL,
      options: {
        advanced: { ipAddress: { ipAddressHeaders: ['x-forwarded-for'] } },
        basePath: '/api/auth',
      },
    }),
    api,
    handler: (request: Request) => routeFakeCredentialApi(handlerApi, request),
  };
}

async function routeFakeCredentialApi(
  api: {
    signInEmail?: (...args: any[]) => any;
    signUpEmail?: (...args: any[]) => any;
  },
  request: Request,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const body = (await request.json()) as Record<string, string>;
  let response: BetterAuthResponseLike;
  if (path.endsWith('/sign-in/email') && typeof api.signInEmail === 'function') {
    response = await api.signInEmail({ asResponse: true, body, headers: request.headers });
  } else if (path.endsWith('/sign-up/email') && typeof api.signUpEmail === 'function') {
    response = await api.signUpEmail({ asResponse: true, body, headers: request.headers });
  } else {
    return new Response('Not Found', { status: 404 });
  }
  if (response instanceof Response) return response;
  return new Response(null, { headers: response.headers, status: response.status });
}

export class FakeMountedAuth {
  lastRequest: Request | undefined;
  sawSession = false;

  readonly handler = async (request: Request): Promise<Response> => {
    this.lastRequest = request;
    this.sawSession = 'session' in request;

    return new Response(new URL(request.url).pathname, {
      headers: { 'cache-control': 'no-store', location: '/login/complete' },
      status: 302,
    });
  };
}

export function mapSession(value: { session: AuthSession; user: AuthUser }): AppSession {
  return {
    activeOrganizationId: value.session.activeOrganizationId,
    id: value.session.id,
    user: {
      email: value.user.email,
      id: value.user.id,
      roles: value.user.roles,
    },
  };
}

export function requestHeaders(cookie?: string): Headers {
  const headers = new Headers({ 'user-agent': 'vitest' });

  if (cookie) headers.set('cookie', cookie);

  return headers;
}

export function responseWithCookies(
  cookies: readonly string[],
  status = 204,
): BetterAuthResponseLike {
  const headers = new Headers();
  for (let index = 0; index < cookies.length; index += 1) {
    headers.append('set-cookie', cookies[index]!);
  }

  return { headers, status };
}

export function authTable(fields: readonly string[] = [], modelName?: string) {
  return {
    fields: Object.fromEntries(fields.map((field) => [field, { type: 'string' }])),
    ...(modelName === undefined ? {} : { modelName }),
  };
}
