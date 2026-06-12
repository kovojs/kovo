import { domain, endpoint, guards, mutation, s } from '@jiso/server';
import type {
  AuthenticatedRequest,
  CsrfValidationOptions,
  Domain,
  EndpointAuthDeclaration,
  EndpointDeclaration,
  EndpointMethod,
  Guard,
  GuardFailure,
  MaybePromise,
  MutationDefinition,
  MutationFail,
  MutationRegistry,
  SessionProvider,
  SessionRequestLike,
} from '@jiso/server';

export interface BetterAuthGetSessionOptions {
  headers: Headers;
}

export interface BetterAuthSessionPayload<Session, User> {
  session: Session;
  user: User;
}

export interface BetterAuthApi<Session, User> {
  getSession(
    options: BetterAuthGetSessionOptions,
  ): MaybePromise<BetterAuthSessionPayload<Session, User> | null | undefined>;
}

export interface BetterAuthLike<Session, User> {
  api: BetterAuthApi<Session, User>;
}

export interface BetterAuthRequestLike {
  headers: Headers;
}

export type BetterAuthMountHandler = (request: Request) => MaybePromise<Response>;

export interface BetterAuthMountLike {
  handler: BetterAuthMountHandler;
}

export interface BetterAuthMountOptions<Method extends EndpointMethod = EndpointMethod> {
  auth?: EndpointAuthDeclaration;
  csrfJustification?: string;
  method?: Method;
}

export type BetterAuthSessionMapper<AuthSession, AuthUser, SessionValue> = (
  value: BetterAuthSessionPayload<AuthSession, AuthUser>,
) => SessionValue;

export function betterAuthSession<
  AuthSession,
  AuthUser,
  SessionValue,
  Request extends BetterAuthRequestLike = BetterAuthRequestLike,
>(
  auth: BetterAuthLike<AuthSession, AuthUser>,
  map: BetterAuthSessionMapper<AuthSession, AuthUser, SessionValue>,
): SessionProvider<Request, SessionValue> {
  return async (request) => {
    const value = await auth.api.getSession({ headers: request.headers });

    if (!value) return null;

    return map(value);
  };
}

// SPEC.md §9.1: adapter-owned OAuth/SAML/magic-link callbacks live behind declared
// prefix endpoints, while credential forms stay on typed mutations.
export function mount<
  const Path extends string,
  const Method extends EndpointMethod = EndpointMethod,
>(
  path: Path,
  auth: BetterAuthMountLike | BetterAuthMountHandler,
  options: BetterAuthMountOptions<Method> = {},
): EndpointDeclaration<Path, Method, 'prefix'> {
  const handler = typeof auth === 'function' ? auth : auth.handler;

  return endpoint(path, {
    auth: options.auth ?? { kind: 'custom', name: 'better-auth' },
    csrf: false,
    csrfJustification: options.csrfJustification ?? 'better-auth browser redirect protocol handler',
    handler(request) {
      return handler(request);
    },
    ...(options.method === undefined ? {} : { method: options.method }),
    mount: 'prefix',
  });
}

export interface BetterAuthResponseLike {
  headers: Headers;
  status: number;
}

export interface BetterAuthSignInEmailBody {
  email: string;
  password: string;
}

export interface BetterAuthSignUpEmailBody extends BetterAuthSignInEmailBody {
  name: string;
}

export interface BetterAuthSignInEmailApi {
  signInEmail(options: {
    asResponse: true;
    body: BetterAuthSignInEmailBody;
    headers: Headers;
  }): MaybePromise<BetterAuthResponseLike>;
}

export interface BetterAuthSignUpEmailApi {
  signUpEmail(options: {
    asResponse: true;
    body: BetterAuthSignUpEmailBody;
    headers: Headers;
  }): MaybePromise<BetterAuthResponseLike>;
}

export interface BetterAuthSignOutApi {
  signOut(options: { asResponse: true; headers: Headers }): MaybePromise<BetterAuthResponseLike>;
}

export interface BetterAuthSignInEmailLike {
  api: BetterAuthSignInEmailApi;
}

export interface BetterAuthSignUpEmailLike {
  api: BetterAuthSignUpEmailApi;
}

export interface BetterAuthSignOutLike {
  api: BetterAuthSignOutApi;
}

const optionalStringSchema = {
  parse(input: unknown): string | undefined {
    if (input === undefined || input === null || input === '') return undefined;
    if (typeof input !== 'string') throw new Error('Expected string');
    return input;
  },
};

export const betterAuthSignInEmailInput = s.object({
  email: s.string(),
  next: optionalStringSchema,
  password: s.string(),
});

export const betterAuthSignUpEmailInput = s.object({
  email: s.string(),
  name: s.string(),
  next: optionalStringSchema,
  password: s.string(),
});

export const betterAuthSignOutInput = s.object({});

export const betterAuthCredentialMutationErrors = {
  INVALID_CREDENTIALS: s.object({}),
};

export type BetterAuthCredentialMutationApi = 'signInEmail' | 'signOut' | 'signUpEmail';

export type BetterAuthTable = 'account' | 'session' | 'user' | 'verification';

export type BetterAuthTouchDomain = 'auth' | 'user';

export interface BetterAuthDeclaredTableTouch {
  domain: BetterAuthTouchDomain;
  table: BetterAuthTable;
}

export const betterAuthAuthDomain = domain('auth');
export const betterAuthUserDomain = domain('user');

// plans/auth.md B1/B6: better-auth writes are library-internal, so the blessed
// wrappers carry declared table/domain touches until the P9 observed-write
// harness can verify observed ⊆ declared at runtime.
export const betterAuthCredentialMutationDeclaredTableTouches = {
  signInEmail: [{ domain: 'auth', table: 'session' }],
  signOut: [{ domain: 'auth', table: 'session' }],
  signUpEmail: [
    { domain: 'user', table: 'user' },
    { domain: 'auth', table: 'account' },
    { domain: 'auth', table: 'session' },
  ],
} as const satisfies Record<
  BetterAuthCredentialMutationApi,
  readonly BetterAuthDeclaredTableTouch[]
>;

export const betterAuthCredentialMutationTouches = {
  signInEmail: [betterAuthAuthDomain],
  signOut: [betterAuthAuthDomain],
  signUpEmail: [betterAuthUserDomain, betterAuthAuthDomain],
} as const satisfies Record<BetterAuthCredentialMutationApi, readonly Domain[]>;

export interface BetterAuthCredentialMutationValue<Status extends string> {
  redirectTo: string;
  status: Status;
}

export type BetterAuthCredentialFailure = MutationFail<
  'INVALID_CREDENTIALS',
  Record<string, never>
>;

export interface BetterAuthCredentialMutationOptions<
  Key extends string,
  Request extends BetterAuthRequestLike,
  GuardedRequest extends Request,
> {
  csrf?: CsrfValidationOptions<Request> | false;
  defaultRedirectTo?: string;
  guard?: Guard<Request, GuardedRequest>;
  key?: Key;
  registry?: MutationRegistry;
  transaction?: <Result>(
    request: Request,
    run: (transactionRequest: GuardedRequest) => Promise<Result>,
  ) => Promise<Result>;
}

export function betterAuthSignInEmailMutation<
  const Key extends string = 'auth/sign-in',
  Request extends BetterAuthRequestLike = BetterAuthRequestLike,
  GuardedRequest extends Request = Request,
>(
  auth: BetterAuthSignInEmailLike,
  options: BetterAuthCredentialMutationOptions<Key, Request, GuardedRequest> = {},
): MutationDefinition<
  Key,
  typeof betterAuthSignInEmailInput,
  typeof betterAuthCredentialMutationErrors,
  Request,
  BetterAuthCredentialMutationValue<'signed-in'>,
  GuardedRequest
> & { key: Key } {
  return mutation(options.key ?? ('auth/sign-in' as Key), {
    ...credentialMutationDefinitionOptions(
      options,
      betterAuthCredentialMutationTouches.signInEmail,
    ),
    errors: betterAuthCredentialMutationErrors,
    input: betterAuthSignInEmailInput,
    async handler(input, request, context) {
      try {
        const response = await auth.api.signInEmail({
          asResponse: true,
          body: {
            email: input.email,
            password: input.password,
          },
          headers: request.headers,
        });

        if (isBetterAuthCredentialFailureResponse(response)) {
          return context.fail('INVALID_CREDENTIALS', {});
        }

        forwardBetterAuthSetCookie(response.headers, context);

        return {
          redirectTo: redirectPath(input.next, options.defaultRedirectTo ?? '/'),
          status: 'signed-in',
        };
      } catch (error) {
        if (isBetterAuthCredentialFailureError(error)) {
          return context.fail('INVALID_CREDENTIALS', {});
        }

        throw error;
      }
    },
  });
}

export function betterAuthSignUpEmailMutation<
  const Key extends string = 'auth/sign-up',
  Request extends BetterAuthRequestLike = BetterAuthRequestLike,
  GuardedRequest extends Request = Request,
>(
  auth: BetterAuthSignUpEmailLike,
  options: BetterAuthCredentialMutationOptions<Key, Request, GuardedRequest> = {},
): MutationDefinition<
  Key,
  typeof betterAuthSignUpEmailInput,
  typeof betterAuthCredentialMutationErrors,
  Request,
  BetterAuthCredentialMutationValue<'signed-up'>,
  GuardedRequest
> & { key: Key } {
  return mutation(options.key ?? ('auth/sign-up' as Key), {
    ...credentialMutationDefinitionOptions(
      options,
      betterAuthCredentialMutationTouches.signUpEmail,
    ),
    errors: betterAuthCredentialMutationErrors,
    input: betterAuthSignUpEmailInput,
    async handler(input, request, context) {
      try {
        const response = await auth.api.signUpEmail({
          asResponse: true,
          body: {
            email: input.email,
            name: input.name,
            password: input.password,
          },
          headers: request.headers,
        });

        if (isBetterAuthCredentialFailureResponse(response)) {
          return context.fail('INVALID_CREDENTIALS', {});
        }

        forwardBetterAuthSetCookie(response.headers, context);

        return {
          redirectTo: redirectPath(input.next, options.defaultRedirectTo ?? '/'),
          status: 'signed-up',
        };
      } catch (error) {
        if (isBetterAuthCredentialFailureError(error)) {
          return context.fail('INVALID_CREDENTIALS', {});
        }

        throw error;
      }
    },
  });
}

export function betterAuthSignOutMutation<
  const Key extends string = 'auth/sign-out',
  Request extends BetterAuthRequestLike = BetterAuthRequestLike,
  GuardedRequest extends Request = Request,
>(
  auth: BetterAuthSignOutLike,
  options: BetterAuthCredentialMutationOptions<Key, Request, GuardedRequest> = {},
): MutationDefinition<
  Key,
  typeof betterAuthSignOutInput,
  Record<string, never>,
  Request,
  BetterAuthCredentialMutationValue<'signed-out'>,
  GuardedRequest
> & { key: Key } {
  return mutation(options.key ?? ('auth/sign-out' as Key), {
    ...credentialMutationDefinitionOptions(options, betterAuthCredentialMutationTouches.signOut),
    input: betterAuthSignOutInput,
    async handler(_input, request, context) {
      const response = await auth.api.signOut({
        asResponse: true,
        headers: request.headers,
      });

      forwardBetterAuthSetCookie(response.headers, context);

      return {
        redirectTo: options.defaultRedirectTo ?? '/login',
        status: 'signed-out',
      };
    },
  });
}

// SPEC.md §9.1 and plans/auth.md B4: credential mutations can only forward auth cookies
// through the current mutation response-header channel.
export function forwardBetterAuthSetCookie(
  headers: Headers,
  context: { setCookie?: (rawSetCookie: string) => void },
): void {
  for (const cookie of getBetterAuthSetCookie(headers)) {
    context.setCookie?.(cookie);
  }
}

export function getBetterAuthSetCookie(headers: Headers): string[] {
  const platformHeaders = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const cookies = platformHeaders.getSetCookie?.();

  if (cookies && cookies.length > 0) return cookies;

  const cookie = headers.get('set-cookie');

  return cookie ? [cookie] : [];
}

export function isBetterAuthCredentialFailureResponse(response: BetterAuthResponseLike): boolean {
  return isCredentialFailureStatus(response.status);
}

export function isBetterAuthCredentialFailureError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const status =
    readNumericProperty(error, 'status') ??
    readNumericProperty(error, 'statusCode') ??
    readNumericProperty(error, 'code');

  return status === undefined ? false : isCredentialFailureStatus(status);
}

export function authed<Request extends SessionRequestLike>(): Guard<
  Request,
  AuthenticatedRequest<Request>
> {
  return guards.authed<Request>();
}

export interface BetterAuthRoleUser {
  id?: string;
  roles?: readonly string[] | null;
}

export interface BetterAuthRoleSession {
  user?: BetterAuthRoleUser | null;
}

export interface BetterAuthRoleRequest {
  session?: BetterAuthRoleSession | null;
}

type SessionFor<Request extends BetterAuthRoleRequest> = NonNullable<Request['session']>;
type UserFor<Request extends BetterAuthRoleRequest> = NonNullable<SessionFor<Request>['user']>;
type RoleNameFor<Request extends BetterAuthRoleRequest> =
  UserFor<Request> extends {
    roles?: readonly (infer Role)[] | null;
  }
    ? Extract<Role, string>
    : string;

export function role<Request extends BetterAuthRoleRequest>(
  requiredRole: RoleNameFor<Request>,
): Guard<Request>;
export function role(requiredRole: string): Guard<BetterAuthRoleRequest>;
export function role(requiredRole: string): Guard<BetterAuthRoleRequest> {
  return (request) => {
    if (!request.session?.user) return unauthenticatedGuardFailure();

    return request.session.user.roles?.includes(requiredRole) === true
      ? true
      : unauthorizedGuardFailure();
  };
}

export interface BetterAuthOrganizationSession extends BetterAuthRoleSession {
  activeOrganizationId?: string | null;
}

export interface BetterAuthOrganizationRequest {
  session?: BetterAuthOrganizationSession | null;
}

export type ActiveOrganizationRequest<Request extends BetterAuthOrganizationRequest> = Request & {
  session: NonNullable<Request['session']> & {
    activeOrganizationId: string;
    user: NonNullable<NonNullable<Request['session']>['user']>;
  };
};

export function activeOrganization<Request extends BetterAuthOrganizationRequest>(): Guard<
  Request,
  ActiveOrganizationRequest<Request>
> {
  return (request) => {
    if (!request.session?.user) return unauthenticatedGuardFailure();

    return request.session.activeOrganizationId ? true : unauthorizedGuardFailure();
  };
}

// SPEC.md §6.5 and §10.3: adapter guards preserve anonymous vs unauthorized failures.
function unauthenticatedGuardFailure(): GuardFailure {
  return {
    auth: 'unauthenticated',
    code: 'UNAUTHORIZED',
    payload: {},
    status: 422,
  };
}

function unauthorizedGuardFailure(): GuardFailure {
  return {
    auth: 'unauthorized',
    code: 'UNAUTHORIZED',
    payload: {},
    status: 422,
  };
}

function isCredentialFailureStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403;
}

function readNumericProperty(value: object, key: string): number | undefined {
  if (!Object.hasOwn(value, key)) return undefined;

  const property = (value as Record<string, unknown>)[key];

  return typeof property === 'number' ? property : undefined;
}

function redirectPath(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;

  return value;
}

function credentialMutationDefinitionOptions<
  Key extends string,
  Request extends BetterAuthRequestLike,
  GuardedRequest extends Request,
>(
  options: BetterAuthCredentialMutationOptions<Key, Request, GuardedRequest>,
  touches: readonly Domain[],
): Pick<
  MutationDefinition<Key, never, never, Request, never, GuardedRequest>,
  'csrf' | 'guard' | 'registry' | 'transaction'
> {
  return {
    ...(options.csrf === undefined ? {} : { csrf: options.csrf }),
    ...(options.guard === undefined ? {} : { guard: options.guard }),
    registry: {
      ...options.registry,
      touches: mergeDomainTouches(touches, options.registry?.touches),
    },
    ...(options.transaction === undefined ? {} : { transaction: options.transaction }),
  };
}

function mergeDomainTouches(
  defaults: readonly Domain[],
  overrides: readonly Domain[] | undefined,
): Domain[] {
  const merged = new Map(defaults.map((item) => [item.key, item]));

  for (const item of overrides ?? []) {
    merged.set(item.key, item);
  }

  return [...merged.values()];
}
