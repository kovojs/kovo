import type { Redirect } from '@kovojs/core';
import { guardFailureIsUnauthenticated, type ResolvedGuardFailure } from '../guards.js';
import { stampGuardFailureDocumentSecurityFloor } from '../document-core.js';
import {
  blessRedirectResponse,
  mergeResponseHeaders,
  redirectLocationHeader,
  retryAfterHeaders,
  type MutationResponseHeaders,
  type ResponseHeaders,
} from '../response.js';
import { isNoJsReplayResponse, type MutationLifecycleOutcome } from './replay-policy.js';
import type { NoJsMutationRequest, NoJsMutationResponse } from '../mutation-wire.js';
import type { InferSchema, Schema } from '../schema.js';
import type { MutationDefinition, MutationFail, MutationSuccess } from './definition.js';
import { renderDefaultFailurePage } from './failure-html.js';
import { reportServerError } from '../diagnostics.js';

export interface NoJsMutationLifecycleResponseOptions<
  Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request,
> {
  csrfReauthResponse(): Promise<NoJsMutationResponse | undefined>;
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>;
  lifecycle: MutationLifecycleOutcome<Value, InferSchema<InputSchema>, NoJsMutationResponse>;
  noJsRequest: NoJsMutationRequest<Request, Value>;
}

export async function renderNoJsMutationLifecycleResponse<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
>(
  options: NoJsMutationLifecycleResponseOptions<
    Key,
    InputSchema,
    Errors,
    Request,
    Value,
    GuardedRequest
  >,
): Promise<NoJsMutationResponse> {
  const { definition, lifecycle, noJsRequest } = options;

  if (lifecycle.kind === 'csrf-failure') {
    const reauthResponse = await options.csrfReauthResponse();
    if (reauthResponse) return reauthResponse;
    return renderNoJsMutationFailureResponse(lifecycle.failure, noJsRequest);
  }

  if (lifecycle.kind === 'validation-failure') {
    return renderNoJsMutationFailureResponse(lifecycle.failure, noJsRequest);
  }

  if (lifecycle.kind === 'guard-failure') {
    const reauthResponse = noJsMutationReauthResponse(
      lifecycle.guardFailure,
      lifecycle.lifecycleRequest as Request,
      noJsRequest.currentUrl === undefined ? {} : { currentUrl: noJsRequest.currentUrl },
    );
    if (reauthResponse) return reauthResponse;
    return renderNoJsMutationFailureResponse(lifecycle.failure, noJsRequest);
  }

  if (lifecycle.kind === 'replay-conflict') return renderNoJsReplayConflictPage(noJsRequest);
  if (lifecycle.kind === 'replay-unavailable') {
    return renderNoJsReplayUnavailablePage(noJsRequest);
  }
  if (lifecycle.kind === 'replayed') {
    if (isNoJsReplayResponse(lifecycle.response)) return lifecycle.response;
    return renderNoJsReplayConflictPage(noJsRequest);
  }

  if (lifecycle.kind === 'handler-error') {
    reportServerError(noJsRequest.onError, lifecycle.error, {
      mutationKey: definition.key,
      operation: 'no-js-mutation-handler',
      request: noJsRequest.request,
    });
    return noJsMutationServerErrorResponse();
  }

  if (lifecycle.kind === 'mutation-failure') {
    lifecycle.reservation?.abort?.();
    return renderNoJsMutationFailureResponse(lifecycle.result, noJsRequest);
  }

  const successResponse = blessRedirectResponse({
    body: '',
    headers: mergeMutationResponseHeaders(
      {
        'Cache-Control': 'no-store',
        Location: redirectLocationHeader(
          mutationRedirectLocation(noJsRequest.redirectTo, lifecycle.result),
        ),
      },
      lifecycle.result.responseHeaders,
    ),
    status: 303 as const,
  });
  lifecycle.reservation?.commit(successResponse);
  return successResponse;
}

export function noJsMutationReauthResponse<Request>(
  guardFailure: ResolvedGuardFailure,
  request: Request,
  options: { currentUrl?: string },
): NoJsMutationResponse | undefined {
  if (!mutationGuardFailureIsUnauthenticated(guardFailure, request)) return undefined;

  return blessRedirectResponse({
    body: '',
    headers: {
      'Cache-Control': 'no-store',
      Location: redirectLocationHeader(loginLocation(options.currentUrl ?? '/')),
    },
    status: 303 as const,
  });
}

async function renderNoJsMutationFailureResponse<Request, Value>(
  failure: MutationFail,
  noJsRequest: NoJsMutationRequest<Request, Value>,
): Promise<NoJsMutationResponse> {
  const body = noJsRequest.renderFailurePage
    ? await noJsRequest.renderFailurePage(failure, noJsRequest.rawInput)
    : renderDefaultFailurePage(failure);

  return {
    body,
    headers: stampNoJsMutationFailureHeaders(
      mergeMutationResponseHeaders(
        { 'Content-Type': 'text/html; charset=utf-8' },
        retryAfterHeaders(failure),
      ),
    ),
    status: failure.status,
  };
}

async function renderNoJsReplayUnavailablePage<Request, Value>(
  noJsRequest: NoJsMutationRequest<Request, Value>,
): Promise<NoJsMutationResponse> {
  const failure = replayUnavailableFailure();
  return {
    body: noJsRequest.renderFailurePage
      ? await noJsRequest.renderFailurePage(failure, noJsRequest.rawInput)
      : renderDefaultFailurePage(failure),
    headers: stampNoJsMutationFailureHeaders({
      'Content-Type': 'text/html; charset=utf-8',
      'Retry-After': '1',
    }),
    status: 429,
  };
}

async function renderNoJsReplayConflictPage<Request, Value>(
  noJsRequest: NoJsMutationRequest<Request, Value>,
): Promise<NoJsMutationResponse> {
  const failure: MutationFail = {
    error: { code: 'IDEMPOTENCY_CONFLICT', payload: {} },
    ok: false,
    status: 422,
  };
  return {
    body: noJsRequest.renderFailurePage
      ? await noJsRequest.renderFailurePage(failure, noJsRequest.rawInput)
      : renderDefaultFailurePage(failure),
    headers: stampNoJsMutationFailureHeaders({ 'Content-Type': 'text/html; charset=utf-8' }),
    status: 422,
  };
}

function noJsMutationServerErrorResponse(): NoJsMutationResponse {
  return {
    body: 'Internal Server Error',
    headers: stampNoJsMutationFailureHeaders({ 'Content-Type': 'text/html; charset=utf-8' }),
    status: 500,
  };
}

function stampNoJsMutationFailureHeaders(headers: ResponseHeaders): ResponseHeaders {
  return stampGuardFailureDocumentSecurityFloor({
    body: '',
    headers,
    status: 422,
  }).headers;
}

function replayUnavailableFailure(): MutationFail<'RATE_LIMITED', { reason: string }> {
  return {
    error: { code: 'RATE_LIMITED', payload: { reason: 'replay-unavailable' } },
    ok: false,
    retryAfter: 1,
    status: 429,
  };
}

function mutationRedirectLocation<Value>(
  redirectTo: string | Redirect | ((result: MutationSuccess<Value>) => string | Redirect),
  result: MutationSuccess<Value>,
): string {
  const target = typeof redirectTo === 'function' ? redirectTo(result) : redirectTo;
  // SPEC §6.4/§9.1 (PRG): a typed `redirect()` value carries its path-typed `location`; a plain
  // string is the location itself. Either way the framework Location sink re-sanitizes (SPEC §6.6).
  return redirectLocationHeader(typeof target === 'string' ? target : target.location);
}

function mutationGuardFailureIsUnauthenticated<Request>(
  guardFailure: ResolvedGuardFailure,
  request: Request,
): boolean {
  // SPEC §6.5: mutation reauth is reserved for auth guard failures. Non-auth guard denials such as
  // RATE_LIMITED must preserve their own status/Retry-After instead of being inferred as sessionless
  // login redirects.
  if (guardFailure.code !== 'UNAUTHORIZED' || guardFailure.status !== 422) return false;
  return guardFailureIsUnauthenticated(guardFailure, request);
}

function loginLocation(next: string): string {
  const url = new URL('/login', 'https://kovo.local');
  url.searchParams.set('next', next.startsWith('/') && !next.startsWith('//') ? next : '/');
  return `${url.pathname}${url.search}${url.hash}`;
}

function mergeMutationResponseHeaders(
  ...sources: readonly (MutationResponseHeaders | undefined)[]
): MutationResponseHeaders {
  return mergeResponseHeaders(...sources);
}
