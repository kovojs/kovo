import {
  type BetterAuthLike,
  type BetterAuthMountLike,
  type BetterAuthResponseLike,
} from './internal.js';

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
  refreshSetCookie: readonly string[] | string | undefined;

  forceAuthenticated = false;

  readonly api = {
    getSession: (options: { headers: Headers; returnHeaders: true }) => {
      this.lastHeaders = options.headers;

      const authenticated =
        this.forceAuthenticated ||
        (options.headers.get('cookie') ?? '')
          .split(';')
          .map((cookie) => cookie.trim())
          .includes('kovo_session=s1') ||
        (options.headers.get('cookie') ?? '')
          .split(';')
          .map((cookie) => cookie.trim())
          .includes('better-auth.session_token=opaque-session-1');
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
        for (const cookie of Array.isArray(this.refreshSetCookie)
          ? this.refreshSetCookie
          : [this.refreshSetCookie]) {
          headers.append('set-cookie', cookie);
        }
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

export class FakeMountedAuth implements BetterAuthMountLike {
  lastRequest: Request | undefined;
  sawSession = false;

  readonly handler = async (request: Request): Promise<Response> => {
    this.lastRequest = request;
    this.sawSession = 'session' in request;

    return new Response(new URL(request.url).pathname, {
      headers: { location: '/login/complete' },
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

  Object.defineProperty(headers, 'getSetCookie', {
    value: () => [...cookies],
  });

  return { headers, status };
}

export function authTable(fields: readonly string[] = [], modelName?: string) {
  return {
    fields: Object.fromEntries(fields.map((field) => [field, { type: 'string' }])),
    ...(modelName === undefined ? {} : { modelName }),
  };
}
