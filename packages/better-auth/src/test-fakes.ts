import {
  type BetterAuthLike,
  type BetterAuthMountLike,
  type BetterAuthResponseLike,
} from './index.js';

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

export class FakeBetterAuth implements BetterAuthLike<AuthSession, AuthUser> {
  readonly api = {
    getSession: (options: { headers: Headers }) => {
      this.lastHeaders = options.headers;

      if (options.headers.get('cookie') !== 'jiso_session=s1') return null;

      return {
        session: {
          activeOrganizationId: 'org-1',
          id: 'session-1',
        },
        user: {
          email: 'ada@example.com',
          id: 'user-1',
          roles: ['admin', 'member'] as const,
        },
      };
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
        'jiso_session=session-1; Path=/; HttpOnly; SameSite=Lax',
        'jiso_session_data=user-1; Path=/; HttpOnly; SameSite=Lax',
      ]);
    },
    signOut: async (options: { asResponse: true; headers: Headers }) => {
      this.lastSignOut = options;

      return responseWithCookies([
        'jiso_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
        'jiso_session_data=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
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

      return responseWithCookies(['jiso_session=session-2; Path=/; HttpOnly; SameSite=Lax']);
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
