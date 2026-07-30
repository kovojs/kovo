import type {
  AccessDecision,
  MutationDefinition,
  MutationFormDefinition,
  Schema,
  SessionProvider,
} from '@kovojs/server';
import { type AppMutationAdapter } from '@kovojs/server/custom-adapters';
import { type CsrfOptions } from '@kovojs/server/security';
import type { Session, User } from 'better-auth';

import type { BetterAuthCsrfRequestLike } from './environment.js';
import type { BetterAuthMountAdapter } from './mount-adapter.js';
import type { BetterAuthSessionMapper } from './session.js';

/**
 * Lifecycle request consumed by the first-party Better Auth app binding.
 *
 * The request contains only Kovo's native request carrier, resolved client identity, CSRF identity,
 * and sanitized session. Raw Better Auth request/context objects are deliberately absent (SPEC
 * §6.6).
 */
export type BetterAuthAppRequest<SessionValue extends { id: string } = { id: string }> = {
  /** Framework-resolved anonymous pre-auth identity, when available. */
  authCsrfId?: string | null;
  /** Framework-resolved client IP attached by Kovo's request lifecycle (SPEC §9.5). */
  clientIp?: string;
  /** Native request headers used by the fixed Better Auth session provider. */
  headers: Headers;
  /** Sanitized app session returned by the configured mapper. */
  session?: SessionValue | null;
  /** Absolute incoming request URL from Kovo's native request carrier. */
  url: string;
} & BetterAuthCsrfRequestLike;

/** Public wire result returned by the first-party credential mutations. */
export interface BetterAuthAppCredentialResult<Status extends string> {
  /** Same-origin destination applied after the credential transition. */
  redirectTo: string;
  /** Stable credential-transition outcome. */
  status: Status;
}

/** CSRF-protected email/password sign-in mutation returned by an app binding constructor. */
export type BetterAuthAppSignInMutation<Request extends BetterAuthAppRequest> = MutationDefinition<
  'auth/sign-in',
  Schema<{ email: string; next: string | undefined; password: string }>,
  {
    INVALID_CREDENTIALS: Schema<Record<string, never>>;
    RATE_LIMITED: Schema<Record<string, never>>;
  },
  Request,
  BetterAuthAppCredentialResult<'signed-in'>,
  Request
> &
  MutationFormDefinition<'auth/sign-in', Request> &
  AppMutationAdapter;

/** CSRF-protected sign-out mutation returned by an app binding constructor. */
export type BetterAuthAppSignOutMutation<
  Request extends BetterAuthAppRequest,
  AuthenticatedRequest extends Request,
> = MutationDefinition<
  'auth/sign-out',
  Schema<Record<string, never>>,
  Record<string, never>,
  Request,
  BetterAuthAppCredentialResult<'signed-out'>,
  AuthenticatedRequest
> &
  MutationFormDefinition<'auth/sign-out', Request> &
  AppMutationAdapter;

/**
 * Human-authored options shared by the Postgres and SQLite app binding constructors.
 *
 * Deployment secrets, base URL, persistent revocation storage, authenticated sign-out posture,
 * and system database authority are framework-owned and therefore cannot be supplied here (SPEC
 * §6.6/§10.3 C9).
 */
export interface BetterAuthAppBindingsOptions<
  SessionValue extends { id: string },
  Request extends BetterAuthAppRequest<SessionValue> = BetterAuthAppRequest<SessionValue>,
> {
  /** Kovo CSRF configuration shared by the credential mutations. */
  csrf: CsrfOptions<Request>;
  /** Sanitized projection from Better Auth's credential-free session/user records. */
  mapSession: BetterAuthSessionMapper<Session, User, SessionValue>;
  /** Exact Better Auth Drizzle table record from the app's pinned schema. */
  schema: Record<string, unknown>;
  /** Explicit pre-auth access decision for the sign-in mutation. */
  signInAccess: AccessDecision;
}

/**
 * Capability-minimized result shared by the Postgres and SQLite app binding constructors.
 *
 * The raw Better Auth instance, Drizzle adapter, system database, deployment secret, and signing
 * controls are structurally absent (SPEC §6.6/§10.3 C9).
 */
export interface BetterAuthAppBindings<
  SessionValue extends { id: string },
  Request extends BetterAuthAppRequest<SessionValue> = BetterAuthAppRequest<SessionValue>,
  AuthenticatedRequest extends Request = Request & { session: SessionValue },
> {
  /** Opaque provider/callback router token accepted only by `mount()`. */
  mountAdapter: BetterAuthMountAdapter;
  /** Create the configured fixed development account, or do nothing when disabled/production. */
  seedDemoUser(): Promise<void>;
  /** Runtime-sanitized Better Auth session provider. */
  sessionProvider: SessionProvider<Request, SessionValue>;
  /** CSRF-protected Better Auth email/password sign-in mutation. */
  signIn: BetterAuthAppSignInMutation<Request>;
  /** CSRF-protected Better Auth sign-out mutation with framework-fixed authenticated access. */
  signOut: BetterAuthAppSignOutMutation<Request, AuthenticatedRequest>;
}
