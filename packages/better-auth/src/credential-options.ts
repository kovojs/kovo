import type { AccessDecision, CsrfOptions, Guard } from '@kovojs/server';
import type { MutationRegistry } from '@kovojs/server/internal/execution';

import type { BetterAuthRequestLike } from './internal/contracts.js';

/**
 * Public options for Better Auth credential mutations. Sign-in/sign-up may pass
 * `access` because they run before an authenticated session exists and still
 * need an explicit SPEC.md §10.2 access decision.
 */
export interface BetterAuthCredentialMutationOptions<
  Key extends string,
  Request extends BetterAuthRequestLike,
  GuardedRequest extends Request,
> {
  access?: AccessDecision;
  csrf?: CsrfOptions<Request> | false;
  defaultRedirectTo?: string;
  guard?: Guard<Request, GuardedRequest>;
  key?: Key;
}

/** @internal Implementation-only extension for registry and transaction wiring. */
export interface BetterAuthCredentialMutationInternalOptions<
  Key extends string,
  Request extends BetterAuthRequestLike,
  GuardedRequest extends Request,
> extends BetterAuthCredentialMutationOptions<Key, Request, GuardedRequest> {
  registry?: MutationRegistry;
  transaction?: <Result>(
    request: Request,
    run: (transactionRequest: GuardedRequest) => Promise<Result>,
  ) => Promise<Result>;
}
