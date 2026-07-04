import { reportServerError } from '../diagnostics.js';
import { wireEmitter } from '@kovojs/core/internal/security-markers';
import { guardFailureIsUnauthenticated, type ResolvedGuardFailure } from '../guards.js';
import { generatedFragmentHtml, generatedFragmentHtmlValue } from '../html.js';
import type { ChangeRecord } from '../change-record.js';
import {
  frameworkWireBody,
  mergeResponseHeaders,
  retryAfterHeaders,
  type ResponseHeaders,
} from '../response.js';
import { renderFragmentWireHtml } from '../wire-html.js';
import { commitReservedMutationReplay } from '../replay.js';
import {
  type BufferedMutationWireResponse,
  type MutationWireRequest,
  type MutationWireResponse,
} from '../mutation-wire.js';
import type { GeneratedFragmentRenderable } from '../renderable.js';
import { queryRuntimeWarningHeaderValue, queryRuntimeWarningsFromRequest } from '../query.js';
import type { RuntimeRegistryFacts } from '../registry-facts.js';
import type { InferSchema, Schema } from '../schema.js';
import { renderStreamingMutationWireResponse } from './streaming.js';
import {
  renderFragmentChunks,
  renderLiveTargetChunks,
  renderQueryChunks,
  selectMutationResponseTargets,
} from './targets.js';
import { isEnhancedReplayResponse, type MutationLifecycleOutcome } from './replay-policy.js';
import { renderDefaultFailureFragmentContent } from './failure-html.js';
import type { MutationDefinition, MutationFail, MutationSuccess } from './definition.js';

export interface MutationWireLifecycleResponseOptions<
  Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request,
> {
  csrfReauthResponse(): Promise<BufferedMutationWireResponse | undefined>;
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>;
  lifecycle: MutationLifecycleOutcome<
    Value,
    InferSchema<InputSchema>,
    BufferedMutationWireResponse
  >;
  registryFacts: RuntimeRegistryFacts<Request>;
  wireRequest: MutationWireRequest<Request>;
}

export const renderMutationWireLifecycleResponse = wireEmitter(
  'server.wire.mutation-lifecycle',
  async function <
    const Key extends string,
    InputSchema extends Schema<unknown>,
    Errors extends Record<string, Schema<unknown>>,
    Request,
    Value,
    GuardedRequest extends Request = Request,
  >(
    options: MutationWireLifecycleResponseOptions<
      Key,
      InputSchema,
      Errors,
      Request,
      Value,
      GuardedRequest
    >,
  ): Promise<MutationWireResponse> {
    const { definition, lifecycle, wireRequest } = options;

    if (lifecycle.kind === 'csrf-failure') {
      const reauthResponse = await options.csrfReauthResponse();
      if (reauthResponse) return reauthResponse;
      return mutationWireFailureResponse(lifecycle.failure, wireRequest);
    }

    if (lifecycle.kind === 'validation-failure') {
      return mutationWireFailureResponse(lifecycle.failure, wireRequest);
    }

    if (lifecycle.kind === 'guard-failure') {
      const reauthResponse = enhancedMutationReauthResponse(
        lifecycle.guardFailure,
        lifecycle.lifecycleRequest as Request,
        wireRequest.currentUrl === undefined ? {} : { currentUrl: wireRequest.currentUrl },
      );
      if (reauthResponse) return reauthResponse;
      return {
        body: frameworkWireBody(await renderFailureFragment(lifecycle.failure, wireRequest)),
        // A1: a rate-limit (or other retry-able) guard failure carries Retry-After; preserve it on the
        // pre-replay guard-failure response (the old runMutation path added it via retryAfterHeaders).
        headers: mergeResponseHeaders(
          mutationWireResponseHeaders(wireRequest),
          retryAfterHeaders(lifecycle.guardFailure),
        ),
        status: lifecycle.failure.status,
      };
    }

    if (lifecycle.kind === 'replay-conflict') return renderReplayConflictFragment(wireRequest);
    if (lifecycle.kind === 'replay-unavailable')
      return renderReplayUnavailableFragment(wireRequest);
    if (lifecycle.kind === 'replayed') {
      if (isEnhancedReplayResponse(lifecycle.response)) return lifecycle.response;
      return renderReplayConflictFragment(wireRequest);
    }

    if (lifecycle.kind === 'handler-error') {
      reportServerError(wireRequest.onError, lifecycle.error, {
        mutationKey: definition.key,
        operation: 'mutation-handler',
        request: wireRequest.request,
        ...(wireRequest.targets === undefined ? {} : { targets: wireRequest.targets }),
      });
      return mutationServerErrorResponse(wireRequest);
    }

    if (lifecycle.kind === 'mutation-failure') {
      const result = lifecycle.result;
      if (result.error.code === 'VALIDATION' || result.status === 429 || result.status === 409) {
        return {
          body: frameworkWireBody(await renderFailureFragment(result, wireRequest)),
          headers: mergeResponseHeaders(
            mutationWireResponseHeaders(wireRequest),
            retryAfterHeaders(result),
          ),
          status: result.status,
        };
      }

      return commitReservedMutationReplay(lifecycle.reservation, async () => ({
        body: frameworkWireBody(await renderFailureFragment(result, wireRequest)),
        headers: mergeResponseHeaders(
          mutationWireResponseHeaders(wireRequest),
          retryAfterHeaders(result),
        ),
        status: result.status,
      }));
    }

    const { reservation, result } = lifecycle;
    const renderInput = mutationResponseInput(result, wireRequest.rawInput);
    let finalResponse: BufferedMutationWireResponse;
    try {
      finalResponse = await renderSuccessfulMutationWireResponse(
        definition,
        wireRequest,
        result,
        renderInput,
        options.registryFacts,
      );
    } catch (error) {
      reportServerError(wireRequest.onError, error, {
        mutationKey: definition.key,
        operation: 'mutation-render',
        request: wireRequest.request,
        ...(wireRequest.targets === undefined ? {} : { targets: wireRequest.targets }),
      });
      return commitReservedMutationReplay(reservation, async () =>
        mutationRenderErrorResponse(result.changes, wireRequest, result.responseHeaders),
      );
    }

    if (wireRequest.stream === true && definition.stream) {
      // A3 (SPEC §10.3:1063 + §9): do NOT commit the head-only finalResponse before
      // the stream runs — that would replay an unterminated empty body to duplicates.
      return renderStreamingMutationWireResponse(
        definition.stream({
          input: result.input,
          request: wireRequest.request as GuardedRequest,
          result,
        }),
        finalResponse,
        reservation,
        {
          onError: wireRequest.onError,
          context: {
            mutationKey: definition.key,
            operation: 'mutation-stream',
            request: wireRequest.request,
            ...(wireRequest.targets === undefined ? {} : { targets: wireRequest.targets }),
          },
        },
      );
    }

    reservation?.commit(finalResponse);
    return finalResponse;
  },
);

const renderSuccessfulMutationWireResponse = wireEmitter(
  'server.wire.mutation-success-delta',
  async function <
    const Key extends string,
    InputSchema extends Schema<unknown>,
    Errors extends Record<string, Schema<unknown>>,
    Request,
    Value,
    GuardedRequest extends Request = Request,
  >(
    definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
    wireRequest: MutationWireRequest<Request>,
    result: MutationSuccess<Value, InferSchema<InputSchema>>,
    renderInput: unknown,
    registryFacts: RuntimeRegistryFacts<Request>,
  ): Promise<BufferedMutationWireResponse> {
    const selection = selectMutationResponseTargets({
      changes: result.changes,
      fragmentRenderers: wireRequest.fragmentRenderers ?? [],
      liveTargetDescriptors: wireRequest.liveTargetDescriptors ?? [],
      liveTargetRenderers: wireRequest.liveTargetRenderers ?? [],
      liveTargets: wireRequest.liveTargets,
      registryFacts,
      rerunQueries: result.rerunQueryInstances ?? result.rerunQueries.map((key) => ({ key })),
      targets: wireRequest.targets ?? [],
    });
    const queryChunks = await renderQueryChunks(
      definition.registry?.queries ?? [],
      selection.rerunQueries,
      renderInput,
      wireRequest.request,
      result.changes,
      wireRequest.maxListItems,
      wireRequest.idem === undefined ? undefined : [wireRequest.idem],
    );
    const fragmentChunks = [
      ...(await renderLiveTargetChunks(
        wireRequest.liveTargetRenderers ?? [],
        selection.liveTargetDescriptors,
        renderInput,
        wireRequest.request,
        wireRequest.csrf,
        wireRequest.maxListItems,
      )),
      ...(await renderFragmentChunks(
        wireRequest.fragmentRenderers ?? [],
        selection.fragmentTargets,
        renderInput,
      )),
    ];

    // SPEC §5.2.1 rule 2(c): enhanced mutation/full fragment responses are build-scoped
    // payloads, so a successful response must carry the render-plan token.
    const buildHeaders: ResponseHeaders = {
      'Kovo-Build': requiredMutationBuildToken(wireRequest),
    };
    const queryWarningHeader = queryRuntimeWarningHeaderValue(
      queryRuntimeWarningsFromRequest(wireRequest.request),
    );
    const queryWarningHeaders =
      queryWarningHeader === undefined ? undefined : { 'Kovo-Warn': queryWarningHeader };

    return {
      body: frameworkWireBody([...queryChunks, ...fragmentChunks].join('\n')),
      headers: mergeResponseHeaders(
        mutationWireResponseHeaders(wireRequest),
        {
          'Kovo-Changes': mutationWireChangeHeader(result.changes),
        },
        buildHeaders,
        result.responseHeaders,
        queryWarningHeaders,
      ),
      status: 200,
    };
  },
);

const mutationWireFailureResponse = wireEmitter('server.wire.mutation-failure', function <
  Request,
>(failure: MutationFail, wireRequest: MutationWireRequest<Request>): Promise<BufferedMutationWireResponse> {
  return Promise.resolve(renderFailureFragment(failure, wireRequest)).then((body) => ({
    body: frameworkWireBody(body),
    headers: mutationWireResponseHeaders(wireRequest),
    status: 422,
  }));
});

function renderReplayConflictFragment<Request>(
  wireRequest: MutationWireRequest<Request>,
): BufferedMutationWireResponse {
  return {
    body: frameworkWireBody(
      renderFragmentWireHtml({
        html: generatedFragmentHtml(
          '<output role="alert" data-error-code="IDEMPOTENCY_CONFLICT">Conflict</output>',
        ),
        target: mutationFailureTarget(wireRequest),
      }),
    ),
    headers: mutationWireResponseHeaders(wireRequest),
    status: 422,
  };
}

async function renderReplayUnavailableFragment<Request>(
  wireRequest: MutationWireRequest<Request>,
): Promise<MutationWireResponse> {
  return {
    body: frameworkWireBody(await renderFailureFragment(replayUnavailableFailure(), wireRequest)),
    headers: mergeResponseHeaders(mutationWireResponseHeaders(wireRequest), {
      'Retry-After': '1',
    }),
    status: 429,
  };
}

function replayUnavailableFailure(): MutationFail<'RATE_LIMITED', { reason: string }> {
  return {
    error: { code: 'RATE_LIMITED', payload: { reason: 'replay-unavailable' } },
    ok: false,
    retryAfter: 1,
    status: 429,
  };
}

function requiredMutationBuildToken<Request>(wireRequest: MutationWireRequest<Request>): string {
  if (wireRequest.buildToken !== undefined && wireRequest.buildToken !== '') {
    return wireRequest.buildToken;
  }

  throw new TypeError(
    'renderMutationResponse() requires a non-empty buildToken for successful mutation wire responses. SPEC §5.2.1 requires every mutation delta/full response to carry the render-plan token.',
  );
}

function mutationRenderErrorResponse<Request>(
  changes: readonly ChangeRecord[],
  wireRequest: MutationWireRequest<Request>,
  responseHeaders?: ResponseHeaders,
): BufferedMutationWireResponse {
  return {
    body: frameworkWireBody(renderMutationRenderErrorFragment(wireRequest)),
    headers: mergeResponseHeaders(
      mutationWireResponseHeaders(wireRequest),
      {
        'Kovo-Changes': mutationWireChangeHeader(changes),
      },
      responseHeaders,
    ),
    status: 500,
  };
}

function mutationServerErrorResponse<Request>(
  wireRequest: MutationWireRequest<Request>,
): MutationWireResponse {
  return {
    body: frameworkWireBody(renderMutationServerErrorFragment(wireRequest)),
    headers: mutationWireResponseHeaders(wireRequest),
    status: 500,
  };
}

async function renderFailureFragment<Request>(
  failure: MutationFail,
  wireRequest: MutationWireRequest<Request>,
): Promise<string> {
  const target = mutationFailureTarget(wireRequest);
  const html = wireRequest.renderFailureFragment
    ? await wireRequest.renderFailureFragment(failure, wireRequest.rawInput)
    : await renderDefaultFailureFragment(failure, wireRequest, target);

  return renderFragmentWireHtml({
    html: generatedFragmentHtmlValue(html),
    stylesheets: wireRequest.failureStylesheets,
    target,
  });
}

async function renderDefaultFailureFragment<Request>(
  failure: MutationFail,
  wireRequest: MutationWireRequest<Request>,
  target: string,
): Promise<GeneratedFragmentRenderable> {
  const descriptor = wireRequest.liveTargetDescriptors?.find((entry) => entry.target === target);
  const renderer =
    descriptor === undefined
      ? undefined
      : wireRequest.liveTargetRenderers?.find(
          (candidate) => candidate.component === descriptor.component,
        );
  if (descriptor && renderer) {
    return renderer.render({
      failure,
      input: wireRequest.rawInput,
      ...(wireRequest.csrf === undefined ? {} : { csrf: wireRequest.csrf }),
      ...(wireRequest.mutationKey === undefined ? {} : { mutationKey: wireRequest.mutationKey }),
      props: descriptor.props,
      request: wireRequest.request,
      target,
    });
  }

  return renderDefaultFailureFragmentContent(failure);
}

function renderMutationRenderErrorFragment<Request>(
  wireRequest: MutationWireRequest<Request>,
): string {
  const target = mutationFailureTarget(wireRequest);

  return renderFragmentWireHtml({
    html: generatedFragmentHtml(
      '<output role="alert" data-error-code="RENDER_ERROR">Internal Server Error</output>',
    ),
    target,
  });
}

function renderMutationServerErrorFragment<Request>(
  wireRequest: MutationWireRequest<Request>,
): string {
  const target = mutationFailureTarget(wireRequest);

  return renderFragmentWireHtml({
    html: generatedFragmentHtml(
      '<output role="alert" data-error-code="SERVER_ERROR">Internal Server Error</output>',
    ),
    stylesheets: wireRequest.failureStylesheets,
    target,
  });
}

function mutationFailureTarget<Request>(wireRequest: MutationWireRequest<Request>): string {
  return (
    wireRequest.failureTarget ??
    wireRequest.submittedFormTarget ??
    wireRequest.targets?.[0] ??
    'error'
  );
}

const mutationWireResponseHeaders = wireEmitter('server.wire.mutation-headers', function <
  Request,
>(wireRequest: MutationWireRequest<Request>): ResponseHeaders {
  return {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
    Vary: 'Cookie',
    ...(wireRequest.buildToken ? { 'Kovo-Build': wireRequest.buildToken } : {}),
    ...(wireRequest.idem ? { 'Kovo-Idem': wireRequest.idem } : {}),
  };
});

export const enhancedMutationReauthResponse = wireEmitter('server.wire.mutation-reauth', function <
  Request,
>(guardFailure: ResolvedGuardFailure, request: Request, options: { currentUrl?: string }):
  | BufferedMutationWireResponse
  | undefined {
  if (!mutationGuardFailureIsUnauthenticated(guardFailure, request)) return undefined;

  // SPEC §6.5: enhanced unauthenticated mutation guard failures re-enter auth
  // with a 401 Kovo-Reauth directive instead of rendering validation UI.
  return {
    body: frameworkWireBody(''),
    headers: mergeResponseHeaders(
      mutationWireResponseHeaders({} as MutationWireRequest<Request>),
      {
        'Kovo-Reauth': loginLocation(options.currentUrl ?? '/'),
      },
    ),
    status: 401,
  };
});

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

function mutationWireChangeRecords(
  changes: readonly ChangeRecord[],
): Pick<ChangeRecord, 'domain' | 'keys'>[] {
  return changes.map((change) => ({
    domain: change.domain,
    ...(change.keys === undefined ? {} : { keys: change.keys }),
  }));
}

function mutationWireChangeHeader(changes: readonly ChangeRecord[]): string {
  return asciiJsonHeaderValue(mutationWireChangeRecords(changes));
}

function asciiJsonHeaderValue(value: unknown): string {
  return JSON.stringify(value).replace(
    /[^\x20-\x7e]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function mutationResponseInput<Value>(result: MutationSuccess<Value>, rawInput: unknown): unknown {
  if (Object.hasOwn(result, 'input')) return result.input;

  return result.changes.find((change) => change.input !== undefined)?.input ?? rawInput;
}
