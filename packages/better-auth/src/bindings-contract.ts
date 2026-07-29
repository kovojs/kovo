import type {
  AccessDecision,
  MutationDefinition,
  MutationFormDefinition,
  Schema,
  SessionProvider,
} from '@kovojs/server';
import type { AppMutationAdapter } from '@kovojs/server/custom-adapters';
import type { PrincipalEpochStore } from '@kovojs/server/principal-epochs';
import type { CsrfOptions } from '@kovojs/server/security';
import type { Session, User } from 'better-auth';

import type { BetterAuthMountAdapter } from './mount-adapter.js';
import type { BetterAuthPasswordResetOptions } from './password-reset-mail.js';
import type { BetterAuthSessionMapper } from './session.js';

/**
 * A fixed development-only account that a generated Better Auth binding may create.
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export interface BetterAuthDevelopmentSeed {
  /** Email address for the local development account. */
  email: string;
  /** Display name for the local development account. */
  name: string;
  /** Password for the local account; absent/null disables seeding. */
  password?: string | null;
}

/**
 * Minimal request carrier accepted by compiler-emitted Better Auth binding assembly.
 *
 * Generated code specializes this shape with the app's own session and CSRF fields. Keeping the
 * carrier on the generated boundary avoids making package-internal construction contracts part of
 * the human-authored API while preserving an honest structural constraint (SPEC §6.6).
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export interface BetterAuthGeneratedRequest {
  /** Framework-resolved client IP attached by Kovo's request lifecycle (SPEC §9.5). */
  clientIp?: string;
  headers: Headers;
  /** Absolute incoming request URL from the native Request-backed Kovo lifecycle carrier. */
  url: string;
}

/**
 * Public wire value returned by a compiler-emitted credential mutation.
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export interface BetterAuthGeneratedCredentialResult<Status extends string> {
  redirectTo: string;
  status: Status;
}

/**
 * Generated sign-in mutation contract without a reference to package-internal constructors.
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export type BetterAuthGeneratedSignInMutation<Request extends BetterAuthGeneratedRequest> =
  MutationDefinition<
    'auth/sign-in',
    Schema<{ email: string; next: string | undefined; password: string }>,
    {
      INVALID_CREDENTIALS: Schema<Record<string, never>>;
      RATE_LIMITED: Schema<Record<string, never>>;
    },
    Request,
    BetterAuthGeneratedCredentialResult<'signed-in'>,
    Request
  > &
    MutationFormDefinition<'auth/sign-in', Request> &
    AppMutationAdapter;

/**
 * Generated sign-out mutation contract without a reference to package-internal constructors.
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export type BetterAuthGeneratedSignOutMutation<
  Request extends BetterAuthGeneratedRequest,
  AuthenticatedRequest extends Request,
> = MutationDefinition<
  'auth/sign-out',
  Schema<Record<string, never>>,
  Record<string, never>,
  Request,
  BetterAuthGeneratedCredentialResult<'signed-out'>,
  AuthenticatedRequest
> &
  MutationFormDefinition<'auth/sign-out', Request> &
  AppMutationAdapter;

/**
 * Generated account-recovery request mutation. Completion remains experimental until Kovo owns a
 * typed CSRF-protected reset mutation in addition to this enumeration-resistant mail request.
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export type BetterAuthGeneratedPasswordResetMutation<Request extends BetterAuthGeneratedRequest> =
  MutationDefinition<
    'auth/request-password-reset',
    Schema<{ email: string }>,
    { RATE_LIMITED: Schema<Record<string, never>> },
    Request,
    BetterAuthGeneratedCredentialResult<'recovery-accepted'>,
    Request
  > &
    MutationFormDefinition<'auth/request-password-reset', Request> &
    AppMutationAdapter;

/**
 * Backend-neutral options shared by generated Postgres and SQLite authentication assembly.
 *
 * The database capability and validated signing material stay generic so each backend retains its
 * exact private witness while generated code sees one reviewed option topology (SPEC §6.6 C9).
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export interface BetterAuthBindingsOptions<
  Request extends BetterAuthGeneratedRequest,
  SessionValue,
  SigningSecret,
> {
  /** Absolute Better Auth base URL for this deployment. */
  baseURL: string;
  /** Kovo CSRF configuration shared by generated credential mutations. */
  csrf: CsrfOptions<Request>;
  /** Optional fixed local account; ignored when `NODE_ENV=production`. */
  developmentSeed?: BetterAuthDevelopmentSeed;
  /** Sanitized projection from Better Auth's credential-free session/user records. */
  mapSession: BetterAuthSessionMapper<Session, User, SessionValue>;
  /** Persistent revocation authority initialized from each authenticated provider identity. */
  principalEpochStore?: PrincipalEpochStore;
  /** Optional account-recovery mutation plus its purpose-closed mail capability. */
  passwordReset?: BetterAuthPasswordResetOptions;
  /** Exact Better Auth Drizzle table record from the app's pinned schema. */
  schema: Record<string, unknown>;
  /** Validated Better Auth signing material for the selected backend. */
  secret: SigningSecret;
  /** Explicit pre-auth access decision for the sign-in mutation. */
  signInAccess: AccessDecision;
  /** Explicit authenticated access decision for the sign-out mutation. */
  signOutAccess: AccessDecision;
  /**
   * Framework-minted database authority forwarded by generated assembly.
   *
   * Its concrete nominal carrier is deliberately absent from this cross-package ABI. The selected
   * backend constructor consumes the value through the server's runtime witness registry and
   * rejects every value not minted by that exact registry (SPEC §10.3 C9).
   */
  systemDb: unknown;
}

/**
 * Backend-neutral generated binding options whose deployment authority comes from pinned env.
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export type BetterAuthEnvironmentBindingsOptions<
  Request extends BetterAuthGeneratedRequest,
  SessionValue,
  SigningSecret,
> = Omit<
  BetterAuthBindingsOptions<Request, SessionValue, SigningSecret>,
  'baseURL' | 'developmentSeed' | 'secret'
>;

/**
 * Backend-neutral result of generated Better Auth assembly.
 *
 * Postgres and SQLite constructors both return exactly this capability-minimized record. Raw
 * Better Auth, Drizzle, and database handles are intentionally absent (SPEC §6.6/§10.3 C9).
 *
 * @generated Compiler-emitted authentication assembly ABI; app-authored modules should not name it.
 */
export interface BetterAuthBindings<
  Request extends BetterAuthGeneratedRequest,
  SessionValue,
  AuthenticatedRequest extends Request = Request,
> {
  /** Opaque provider/callback router token accepted only by `mount()`. */
  mountAdapter: BetterAuthMountAdapter;
  /** Feature-conditional, CSRF-protected account-recovery request mutation. */
  requestPasswordReset?: BetterAuthGeneratedPasswordResetMutation<Request>;
  /** Create the configured fixed development account, or do nothing when disabled/production. */
  seedDemoUser(): Promise<void>;
  /** Runtime-sanitized Better Auth session provider. */
  sessionProvider: SessionProvider<Request, SessionValue>;
  /** CSRF-protected Better Auth email/password sign-in mutation. */
  signIn: BetterAuthGeneratedSignInMutation<Request>;
  /** CSRF-protected Better Auth sign-out mutation. */
  signOut: BetterAuthGeneratedSignOutMutation<Request, AuthenticatedRequest>;
}
