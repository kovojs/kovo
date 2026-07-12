import { isUntrusted, revealUntrusted, type JsonValue } from '@kovojs/core';

import { accessDecisionFor } from './access.js';
import {
  forwardSetCookie,
  serializeCookie,
  type CookieOptions,
  type ForwardSetCookiePosture,
} from './cookies.js';
import {
  mutationCsrfOptions,
  validateCsrfToken,
  verifyCsrfRequestOriginFloor,
  type CsrfOptions,
} from './csrf.js';
import { invalidate, mutationRegistryChangeRecords, type ChangeRecord } from './change-record.js';
import {
  explainGuard,
  guardFailureToResult,
  resolveLifecycleRequest,
  runAccessDecisionGuards,
  withoutRequestProperty,
  withGuardArgs,
  type Guard,
  type RequestLifecycleOptions,
  type ResolvedGuardFailure,
} from './guards.js';
import { registeredGeneratedLiveTargetRenderers } from './live-target-registry.js';
import {
  appendResponseHeader,
  blessRedirectResponse,
  isBlessedRedirectResponse,
  type ResponseHeaders,
} from './response.js';
import {
  mutationWireRequestFromHeaders,
  type BufferedMutationWireResponse,
  type LiveTargetRenderer,
  type MutationEndpointRequest,
  type MutationEndpointResponse,
  type MutationWireRequest,
  type MutationWireResponse,
  type NoJsMutationRequest,
  type NoJsMutationResponse,
} from './mutation-wire.js';
import type { TaskHandle, TaskInput, TaskSchedulingRequest } from './task.js';
import { durableTaskScheduleInput } from './task-runner.js';
import { MutationReplayConflictError } from './replay.js';
import {
  formLikeToRecord,
  isSchemaValidationError,
  parseSchemaAsync,
  type InferSchema,
  type Schema,
  type ValidationFailurePayload,
} from './schema.js';
import {
  enhancedMutationReplayPolicy,
  type MutationLifecycleOutcome,
  noJsMutationReplayPolicy,
  optionalReplayPolicy,
  type MutationLifecycleReplayPolicy,
  type MutationLifecycleReplayReservation,
} from './mutation/replay-policy.js';
import {
  enhancedMutationReauthResponse,
  renderMutationWireLifecycleResponse,
} from './mutation/wire-response.js';
import {
  noJsMutationReauthResponse,
  renderNoJsMutationLifecycleResponse,
} from './mutation/no-js.js';
import { queriesToRerun } from './mutation/targets.js';
import { mutationWithRuntimeRegistryFacts, type RuntimeRegistryFacts } from './registry-facts.js';
import {
  canRunSqliteAsyncTransaction,
  frameworkManagedDbRawTarget,
  kovoAsyncMutationTransaction,
  runSqliteAsyncTransaction,
  type AsyncMutationTransactionCapableDb,
} from './sql-safe-handle.js';
import { runWithRequestInputProvenance } from './request-input-provenance.js';
import type {
  MutationContext,
  MutationDefinition,
  MutationFail,
  MutationResult,
  MutationSuccess,
  RunMutationOptions,
  TaskScheduler,
} from './mutation/definition.js';
import { isStaleVersionError, staleVersionConflict } from './mutation/stale-version.js';
export {
  errorBoundary,
  mutation,
  mutationFormAttributes,
  queue,
  renderMutationFormAttributes,
  write,
} from './mutation/definition.js';
export type {
  MutationContext,
  MutationDefinition,
  MutationFactory,
  MutationFail,
  MutationFormAttributes,
  MutationFormDefinition,
  MutationHandlerRequest,
  MutationOptimisticEntry,
  MutationOptimisticMap,
  MutationOptimisticTransform,
  MutationQueue,
  MutationRequestDb,
  MutationRegistry,
  MutationResult,
  MutationSuccess,
  QueryRerun,
  RunMutationOptions,
  TaskScheduler,
  WriteDefinition,
} from './mutation/definition.js';
// KV429 (SPEC §10.3/§11.1): stale-version conflict signal for optimistic-concurrency mutations.
// `StaleVersionError` is thrown by a handler when 0 rows are updated by the CAS predicate;
// `StaleVersionConflict` is the typed 409 outcome returned by `runMutation`.
export { StaleVersionError } from './mutation/stale-version.js';
export type { StaleVersionConflict } from './mutation/stale-version.js';
export { coalesceMutationStreamChunks, stream } from './mutation/streaming.js';
export { renderLiveTargetChunks } from './mutation/targets.js';
export type {
  MutationStreamChunk,
  MutationStreamContext,
  MutationStreamDoneChunk,
  MutationStreamFragmentChunk,
  MutationStreamFragmentHtml,
  MutationStreamQueryChunk,
  MutationStreamSource,
  MutationStreamTextChunk,
  MutationTextCoalescingPolicy,
} from './mutation/streaming.js';
export { invalidate } from './change-record.js';
export type { ChangeRecord, InvalidateOptions, MutationTouchSite } from './change-record.js';

type ExecuteMutationLifecycleOptions<Request, ReplayResponse> = RunMutationOptions<Request> & {
  catchHandlerErrors?: boolean;
  replay?: MutationLifecycleReplayPolicy<ReplayResponse>;
};

const mutationLifecycleGate: unique symbol = Symbol('kovo.mutationLifecycleGate');

type ValidatedMutationLifecycle<Input, Request> = {
  readonly [mutationLifecycleGate]: true;
  readonly input: Input;
  readonly lifecycleRequest: Request;
};

type InternalRunMutationOptions<Request, Input = unknown> = RunMutationOptions<Request> & {
  readonly [mutationLifecycleGate]?: ValidatedMutationLifecycle<Input, Request>;
};

type MutationResponseDeliveryMode<Request, Value> =
  | {
      csrf: CsrfOptions<Request> | false | undefined;
      kind: 'enhanced-fragment';
      mutationKey: string;
      request: MutationWireRequest<Request>;
    }
  | {
      csrf: CsrfOptions<Request> | false | undefined;
      kind: 'no-js-prg';
      mutationKey: string;
      request: NoJsMutationRequest<Request, Value>;
    };

type TransactionCapableRequestDb = {
  transaction<Result>(
    callback: (transactionDb: unknown) => Promise<Result> | Result,
  ): Promise<Result> | Result;
};

/**
 * Internal mutation lifecycle state machine shared by enhanced, no-JS, and direct
 * mutation execution. It owns the normative SPEC §6.6/§9.1/§10.3 order:
 * CSRF → schema parse → arg-aware guard → replay reserve/read → handler.
 */
async function executeMutationLifecycle<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
  ReplayResponse = never,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  rawInput: unknown,
  request: Request,
  options: ExecuteMutationLifecycleOptions<Request, ReplayResponse> = {},
): Promise<MutationLifecycleOutcome<Value, InferSchema<InputSchema>, ReplayResponse>> {
  const csrf = mutationCsrfOptions(definition, options.csrf);
  if (
    csrf === undefined ||
    (csrf !== false && !validateCsrfToken(rawInput, request, csrf, { audience: definition.key }))
  ) {
    return {
      failure: { error: { code: 'CSRF', payload: {} }, ok: false, status: 422 },
      kind: 'csrf-failure',
    };
  }

  // SPEC §10.3: parse/coerce before guards so arg-aware guards inspect the same validated input
  // later handed to the handler, and before replay so cached responses cannot bypass revocation.
  const inputResult = options.preParsedInput
    ? { ok: true as const, value: options.preParsedInput.value as InferSchema<InputSchema> }
    : await parseMutationInput(definition.input, rawInput);
  if (!inputResult.ok) return { failure: inputResult.failure, kind: 'validation-failure' };

  const input = inputResult.value as InferSchema<InputSchema>;
  const lifecycleRequest = withGuardArgs(
    await resolveLifecycleRequest(
      request,
      mutationLifecycleOptionsWithSqlPolicy(definition, options),
    ),
    input,
  );

  if (!options.guardResolved) {
    const guardFailure = await runAccessDecisionGuards(
      accessDecisionFor(definition),
      definition.guard,
      lifecycleRequest,
    );
    if (guardFailure) {
      return {
        failure: mutationGuardFailureToResult(guardFailure),
        guardFailure,
        kind: 'guard-failure',
        lifecycleRequest,
      };
    }
  }

  if (options.replay) {
    let replayed: ReplayResponse | undefined;
    try {
      replayed = await options.replay.read();
    } catch (error) {
      if (error instanceof MutationReplayConflictError) return { kind: 'replay-conflict' };
      throw error;
    }
    if (replayed) return { kind: 'replayed', response: replayed };

    let reservationResult: Awaited<
      ReturnType<MutationLifecycleReplayPolicy<ReplayResponse>['reserve']>
    >;
    try {
      reservationResult = await options.replay.reserve();
    } catch (error) {
      if (error instanceof MutationReplayConflictError) return { kind: 'replay-conflict' };
      throw error;
    }
    if (reservationResult.kind === 'conflict') return { kind: 'replay-conflict' };
    if (reservationResult.kind === 'replayed') {
      return { kind: 'replayed', response: reservationResult.response };
    }
    if (reservationResult.kind === 'unavailable') return { kind: 'replay-unavailable' };

    const reservation =
      reservationResult.kind === 'reserved' ? reservationResult.reservation : undefined;
    return runMutationLifecycleHandler(
      definition,
      rawInput,
      request,
      validatedMutationLifecycleOptions<Request, InferSchema<InputSchema>>(
        options,
        input,
        lifecycleRequest,
      ),
      {
        catchHandlerErrors: options.catchHandlerErrors,
        reservation,
      },
    );
  }

  return runMutationLifecycleHandler(
    definition,
    rawInput,
    request,
    validatedMutationLifecycleOptions<Request, InferSchema<InputSchema>>(
      options,
      input,
      lifecycleRequest,
    ),
    {
      catchHandlerErrors: options.catchHandlerErrors,
      reservation: undefined,
    },
  );
}

function validatedMutationLifecycleOptions<Request, Input>(
  options: ExecuteMutationLifecycleOptions<Request, unknown>,
  input: Input,
  lifecycleRequest: Request,
): InternalRunMutationOptions<Request, Input> {
  return {
    ...options,
    [mutationLifecycleGate]: {
      [mutationLifecycleGate]: true,
      input,
      lifecycleRequest,
    },
  };
}

async function runMutationLifecycleHandler<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request,
  ReplayResponse,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  rawInput: unknown,
  request: Request,
  options: InternalRunMutationOptions<Request, InferSchema<InputSchema>>,
  state: {
    catchHandlerErrors: boolean | undefined;
    reservation: MutationLifecycleReplayReservation<ReplayResponse> | undefined;
  },
): Promise<MutationLifecycleOutcome<Value, InferSchema<InputSchema>, ReplayResponse>> {
  let result: MutationResult<Value, InferSchema<InputSchema>>;
  try {
    result = await runMutation(definition, rawInput, request, options);
  } catch (error) {
    state.reservation?.abort?.();
    if (!state.catchHandlerErrors) throw error;
    return { error, kind: 'handler-error', reservation: state.reservation };
  }

  if (!result.ok) {
    if (result.error.code === 'VALIDATION' || result.status === 429 || result.status === 409) {
      // Validation, transient rate-limit, and KV429 stale-version outcomes are retryable with
      // corrected/fresh state; never store them as idempotent replay responses (SPEC §9.1/§10.3).
      state.reservation?.abort?.();
    }
    return { kind: 'mutation-failure', reservation: state.reservation, result };
  }

  return { kind: 'success', reservation: state.reservation, result };
}

/**
 * Execute a mutation against raw input and a request, returning a typed result
 * without rendering any wire response. Validates CSRF and input, runs guards and
 * the transaction wrapper, and collects the change records. Prefer the render
 * helpers for HTTP; use this when you want the structured result directly (for
 * example in tests) (SPEC §10.3).
 *
 * @param definition - The mutation to run.
 * @param rawInput - Unparsed input (e.g. `FormData` or a record).
 * @param request - The per-request value passed to the handler.
 * @param options - Optional CSRF, session provider, and error hook.
 * @returns A `MutationResult`: a success with changes/value, or a typed failure.
 * @internal
 */
export async function runMutation<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  rawInput: unknown,
  request: Request,
  options: RunMutationOptions<Request> = {},
): Promise<MutationResult<Value, InferSchema<InputSchema>>> {
  const internalOptions = options as InternalRunMutationOptions<Request, InferSchema<InputSchema>>;
  const validatedLifecycle = internalOptions[mutationLifecycleGate];
  let input: InferSchema<InputSchema>;
  let lifecycleRequest: Request;

  if (validatedLifecycle) {
    // SPEC §9.1: enhanced/no-JS dispatch owns the single CSRF → parse → guard gate before replay.
    // The module-private sentinel is minted only by executeMutationLifecycle after that gate passes,
    // so runMutation can consume the validated outcome without repeating security checks by hand.
    input = validatedLifecycle.input;
    lifecycleRequest = validatedLifecycle.lifecycleRequest;
  } else {
    const csrf = mutationCsrfOptions(definition, options.csrf);
    if (
      csrf === undefined ||
      (csrf !== false && !validateCsrfToken(rawInput, request, csrf, { audience: definition.key }))
    ) {
      return {
        error: { code: 'CSRF', payload: {} },
        ok: false,
        status: 422,
      };
    }

    const inputResult = await parseMutationInput(definition.input, rawInput);
    if (!inputResult.ok) return inputResult.failure;

    input = inputResult.value as InferSchema<InputSchema>;
    // SPEC §10.3:1155-1157 ("Guards (arg-aware, normative)"): merge the mutation's *validated*
    // args onto the request so an arg-aware guard (`guards.owns` reading `req.args`) and the handler
    // both see the same `s.*`-coerced values, discharging KV414 for the covered key.
    lifecycleRequest = withGuardArgs(
      await resolveLifecycleRequest(
        request,
        mutationLifecycleOptionsWithSqlPolicy(definition, options),
      ),
      input,
    );

    const guardFailure = await runAccessDecisionGuards(
      accessDecisionFor(definition),
      definition.guard,
      lifecycleRequest,
    );
    if (guardFailure) return mutationGuardFailureToResult(guardFailure);
  }

  return runWithRequestInputProvenance(input, (trackedInput) =>
    runMutationWithTrackedInput(
      definition,
      trackedInput as InferSchema<InputSchema>,
      withGuardArgs(lifecycleRequest, trackedInput) as Request,
      options,
    ),
  );
}

async function runMutationWithTrackedInput<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  input: InferSchema<InputSchema>,
  lifecycleRequest: Request,
  options: RunMutationOptions<Request>,
): Promise<MutationResult<Value, InferSchema<InputSchema>>> {
  const manualInvalidations: ChangeRecord[] = [];
  const responseHeaders: ResponseHeaders = {};
  const csrfExempt = mutationCsrfOptions(definition, options.csrf) === false;
  function assertBrowserStateMutationAllowed(sink: string): void {
    if (!csrfExempt) return;
    throw new Error(
      `KV418 csrf:false mutation ${definition.key} cannot call ${sink}; browser credential and storage response mutations require CSRF protection.`,
    );
  }
  // B3 (SPEC §9.1.1:846): only the typed (name, value, options) builder is exposed;
  // the raw single-string overload has been removed to prevent arbitrary attribute injection.
  function setCookie(name: string, value: string, options?: CookieOptions): void {
    assertBrowserStateMutationAllowed('context.setCookie()');
    const cookie = serializeCookie(name, value, options);
    appendResponseHeader(responseHeaders, 'Set-Cookie', cookie);
  }

  function forwardCookie(rawSetCookie: string, posture: ForwardSetCookiePosture): void {
    assertBrowserStateMutationAllowed('context.forwardSetCookie()');
    appendResponseHeader(responseHeaders, 'Set-Cookie', forwardSetCookie(rawSetCookie, posture));
  }

  const context = {
    fail<const Code extends Extract<keyof Errors, string>>(
      code: Code,
      payload: InferSchema<Errors[Code]> & JsonValue,
    ): MutationFail<Code, InferSchema<Errors[Code]> & JsonValue> {
      return {
        error: { code, payload },
        ok: false,
        status: 422,
      } as MutationFail<Code, InferSchema<Errors[Code]> & JsonValue>;
    },
    invalidate(domain, options) {
      const record = invalidate(domain, options);
      manualInvalidations.push(record);
      return record;
    },
    setCookie,
    forwardSetCookie: forwardCookie,
    setSessionRevocationClearSiteData() {
      assertBrowserStateMutationAllowed('context.setSessionRevocationClearSiteData()');
      appendResponseHeader(
        responseHeaders,
        'Clear-Site-Data',
        '"cookies", "storage", "executionContexts"',
      );
    },
  } satisfies MutationContext<Errors> & {
    forwardSetCookie: (rawSetCookie: string, posture: ForwardSetCookiePosture) => void;
    setSessionRevocationClearSiteData: () => void;
  };
  const runHandler = async (handlerRequest: GuardedRequest): Promise<Value> => {
    const authorityNeutralHandlerRequest = csrfExempt
      ? (withoutRequestProperty(handlerRequest, 'clientIp') as GuardedRequest)
      : handlerRequest;
    const scheduledHandlerRequest = requestWithTaskScheduling(
      authorityNeutralHandlerRequest,
      options.taskScheduler,
    );
    const handlerValue = await definition.handler(input, scheduledHandlerRequest, context);

    if (isMutationFail(handlerValue)) {
      throw new MutationRollback(handlerValue);
    }

    return handlerValue as Value;
  };
  const guardedRequest = lifecycleRequest as GuardedRequest;

  let value: Value;

  try {
    value = definition.transaction
      ? await definition.transaction(lifecycleRequest, runHandler)
      : await runInDefaultTransaction(lifecycleRequest, runHandler, guardedRequest);
  } catch (error) {
    if (error instanceof MutationRollback) return error.failure;
    // KV429 (SPEC §10.3/§11.1): a StaleVersionError thrown from the handler (or its
    // transaction wrapper) signals that the CAS predicate matched 0 rows — the row was
    // concurrently modified since the version was read. Return a typed 409 outcome
    // distinct from the IDEMPOTENCY_CONFLICT 409 produced by the replay path.
    if (isStaleVersionError(error)) return staleVersionConflict();
    throw error;
  }

  const changes = [
    ...mutationRegistryChangeRecords(definition.registry, input),
    ...manualInvalidations,
  ];
  const rerunQueryInstances = queriesToRerun(definition.registry?.queries ?? [], changes, input);
  return mutationSuccess(
    {
      changes,
      ok: true,
      ...(Object.keys(responseHeaders).length > 0 ? { responseHeaders } : {}),
      ...(rerunQueryInstances.some((query) => query.instanceKey !== undefined)
        ? { rerunQueryInstances }
        : {}),
      rerunQueries: [...new Set(rerunQueryInstances.map((query) => query.key))],
      value,
    },
    input,
  );
}

async function runInDefaultTransaction<Request, GuardedRequest, Value>(
  lifecycleRequest: Request,
  runHandler: (handlerRequest: GuardedRequest) => Promise<Value>,
  guardedRequest: GuardedRequest,
): Promise<Value> {
  const db = transactionCapableRequestDb(lifecycleRequest);
  if (!db) return runHandler(guardedRequest);

  // SPEC §10.3: default mutation handlers receive a transaction-scoped db when the
  // request db can open one, so handler/DB errors roll back the framework-owned lifecycle.
  const runAsyncTransaction = asyncMutationTransaction(db);
  if (runAsyncTransaction) {
    return runAsyncTransaction((transactionDb) =>
      runHandler(requestWithTransactionDb(lifecycleRequest, transactionDb) as GuardedRequest),
    );
  }

  return db.transaction((transactionDb) =>
    runHandler(requestWithTransactionDb(lifecycleRequest, transactionDb) as GuardedRequest),
  );
}

function transactionCapableRequestDb(request: unknown): TransactionCapableRequestDb | undefined {
  if (!isRecord(request)) return undefined;
  const db = request.db;
  if (!isRecord(db) || typeof db.transaction !== 'function') return undefined;
  return db as TransactionCapableRequestDb;
}

function asyncMutationTransaction(
  db: TransactionCapableRequestDb,
):
  | (<Result>(callback: (transactionDb: unknown) => Promise<Result>) => Promise<Result>)
  | undefined {
  const managed = (db as AsyncMutationTransactionCapableDb)[kovoAsyncMutationTransaction];
  if (typeof managed === 'function') return managed.bind(db);

  const sqliteProbeTarget = frameworkManagedDbRawTarget(db) ?? db;
  if (!canRunSqliteAsyncTransaction(sqliteProbeTarget)) return undefined;
  return <Result>(callback: (transactionDb: unknown) => Promise<Result>) => {
    const result = runSqliteAsyncTransaction(sqliteProbeTarget, db, callback);
    if (result === undefined) {
      throw new Error('Kovo SQLite mutation transaction adapter disappeared during execution.');
    }
    return result;
  };
}

function requestWithTransactionDb(request: unknown, transactionDb: unknown): unknown {
  if (!isRecord(request)) return request;
  return { ...request, db: transactionDb };
}

function requestWithTaskScheduling<Request>(
  request: Request,
  scheduler: TaskScheduler | undefined,
): Request & TaskSchedulingRequest {
  let scheduledRequest: Request & TaskSchedulingRequest;

  const schedule: TaskSchedulingRequest['schedule'] = async (definition, args, options) => {
    if (!scheduler) {
      throw new Error(
        'request.schedule(task, args) requires a durable task scheduler. Direct runMutation callers must pass RunMutationOptions.taskScheduler before calling request.schedule().',
      );
    }

    const parsedArgs = (await parseSchemaAsync(definition.input, args)) as TaskInput<
      typeof definition
    >;
    const enqueueInput = durableTaskScheduleInput({
      args: parsedArgs,
      definition,
      options,
      registeredTasks: scheduler.registeredTasks,
    });
    const handle = await scheduler.schedule(scheduledRequest, enqueueInput);
    return handle as TaskHandle<typeof definition.key>;
  };

  const cancel: TaskSchedulingRequest['cancel'] = async (handle) => {
    if (!scheduler) {
      throw new Error(
        'request.cancel(handle) requires a durable task scheduler. Direct runMutation callers must pass RunMutationOptions.taskScheduler before calling request.cancel().',
      );
    }

    return scheduler.cancel(scheduledRequest, handle);
  };

  scheduledRequest = requestWithTaskSchedulingProperties(request, schedule, cancel);
  return scheduledRequest;
}

function requestWithTaskSchedulingProperties<Request>(
  request: Request,
  schedule: TaskSchedulingRequest['schedule'],
  cancel: TaskSchedulingRequest['cancel'],
): Request & TaskSchedulingRequest {
  if ((typeof request !== 'object' && typeof request !== 'function') || request === null) {
    return { cancel, schedule } as Request & TaskSchedulingRequest;
  }

  return new Proxy(request as object, {
    get(target, property) {
      if (property === 'schedule') return schedule;
      if (property === 'cancel') return cancel;

      const targetValue = Reflect.get(target, property, target) as unknown;
      return typeof targetValue === 'function' ? targetValue.bind(target) : targetValue;
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === 'schedule' || property === 'cancel') {
        return {
          configurable: true,
          enumerable: true,
          value: property === 'schedule' ? schedule : cancel,
          writable: false,
        };
      }

      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    has(target, property) {
      return property === 'schedule' || property === 'cancel' || property in target;
    },
    ownKeys(target) {
      const keys = Reflect.ownKeys(target);
      return [
        ...keys,
        ...(keys.includes('schedule') ? [] : ['schedule']),
        ...(keys.includes('cancel') ? [] : ['cancel']),
      ];
    },
  }) as Request & TaskSchedulingRequest;
}

function mutationLifecycleOptionsWithSqlPolicy<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  options: RunMutationOptions<Request>,
): RunMutationOptions<Request> {
  const tables = definition.registry?.tables;
  if (options.sqlWritePolicy !== undefined) {
    return options;
  }

  const touches = definition.registry?.touches?.map((domain) => domain.key);
  return {
    ...options,
    sqlWritePolicy: {
      tables: tables ?? [],
      ...(touches === undefined ? {} : { touches }),
    },
  };
}

function mutationSuccess<Value, Input>(
  result: Omit<MutationSuccess<Value, Input>, 'input'>,
  input: Input,
): MutationSuccess<Value, Input> {
  return Object.defineProperty(result, 'input', {
    enumerable: false,
    value: input,
  }) as MutationSuccess<Value, Input>;
}

class MutationRollback extends Error {
  readonly failure: MutationFail;

  constructor(failure: MutationFail) {
    super(failure.error.code);
    this.name = 'MutationRollback';
    this.failure = failure;
  }
}

/**
 * Run a mutation and render the SPEC §9.1 fragment-wire response (the
 * enhanced/JavaScript path). Prefer `renderMutationEndpointResponse`, which
 * dispatches between this and the no-JS path automatically.
 *
 * @param definition - The mutation to run.
 * @param wireRequest - The parsed wire request (raw input, request, fragment renderers).
 * @returns A `MutationWireResponse` of fragment HTML.
 * @internal
 */
export async function renderMutationResponse<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  wireRequest: MutationWireRequest<Request>,
): Promise<MutationWireResponse> {
  const csrf = mutationCsrfOptions(definition, wireRequest.csrf);
  const deliveryMode = {
    csrf,
    kind: 'enhanced-fragment',
    mutationKey: definition.key,
    request: wireRequest,
  } satisfies MutationResponseDeliveryMode<Request, Value>;
  const lifecycle = await executeMutationLifecycle<
    Key,
    InputSchema,
    Errors,
    Request,
    Value,
    GuardedRequest,
    BufferedMutationWireResponse
  >(definition, wireRequest.rawInput, wireRequest.request, {
    ...runMutationOptions(wireRequest.csrf, wireRequest),
    catchHandlerErrors: true,
    ...optionalReplayPolicy(enhancedMutationReplayPolicy(deliveryMode)),
  });

  const response = await renderMutationWireLifecycleResponse({
    csrfReauthResponse: () => staleSessionEnhancedCsrfReauthResponse(definition, csrf, wireRequest),
    definition,
    lifecycle,
    registryFacts: mutationRuntimeRegistryFacts(definition, wireRequest.liveTargetRenderers ?? []),
    wireRequest,
  });
  return csrf === false ? mutationResponseWithoutBrowserState(response) : response;
}

/**
 * Run a mutation and render the single response that serves both modes: the
 * SPEC §9.1 fragment wire when the request carries the enhancement headers, and
 * a POST-redirect-GET document otherwise. One handler answers JavaScript and
 * no-JavaScript clients identically (SPEC §6.3, §9.1).
 *
 * @param definition - The mutation to run.
 * @param endpointRequest - Raw input, request, wire headers, `redirectTo`, fragment renderers, and failure renderers.
 * @returns A `MutationEndpointResponse` (status, headers, body).
 * @internal
 * @example
 * import { mutation, s } from '@kovojs/server';
 * import { renderMutationEndpointResponse } from '@kovojs/server/internal/wire';
 *
 * interface Req { db: { add(id: string): void } }
 *
 * const addToCart = mutation('cart/add', {
 *   csrf: false,
 *   input: s.object({ productId: s.string() }),
 *   handler(input, request: Req) {
 *     request.db.add(input.productId);
 *     return { productId: input.productId };
 *   },
 * });
 *
 * export function submit(rawInput: unknown, request: Req, headers: Headers) {
 *   return renderMutationEndpointResponse(addToCart, {
 *     fragmentRenderers: [],
 *     headers,
 *     rawInput,
 *     redirectTo: '/',
 *     request,
 *   });
 * }
 */
export async function renderMutationEndpointResponse<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  endpointRequest: MutationEndpointRequest<Request, Value>,
): Promise<MutationEndpointResponse> {
  const liveTargetRenderers =
    endpointRequest.liveTargetRenderers ?? registeredGeneratedLiveTargetRenderers<Request>();
  const endpointDefinition = mutationWithRuntimeRegistryFacts(definition, {
    liveTargetRenderers,
    queries: [],
  });
  const wireRequest = mutationWireRequestFromHeaders({
    ...endpointRequest,
    liveTargetRenderers,
    mutationKey: definition.key,
  });
  if (wireRequest.fragment) return renderMutationResponse(endpointDefinition, wireRequest);

  return renderNoJsMutationResponse(endpointDefinition, {
    ...(endpointRequest.csrf === undefined ? {} : { csrf: endpointRequest.csrf }),
    ...(endpointRequest.currentUrl === undefined ? {} : { currentUrl: endpointRequest.currentUrl }),
    rawInput: endpointRequest.rawInput,
    redirectTo: endpointRequest.redirectTo,
    ...(wireRequest.requestFingerprint === undefined
      ? {}
      : { requestFingerprint: wireRequest.requestFingerprint }),
    // SPEC §10.3:1151 ("atomic reservation … for all mutation paths — the enhanced and no-JS
    // mutation() lifecycle"): thread the same injected replay store into the no-JS POST-redirect-GET
    // branch as the enhanced wire branch so duplicate/concurrent no-JS submits dedup onto one handler
    // run. Mode-specific replay scopes keep no-JS 303 records separate from enhanced fragment
    // records while preserving the store's atomic reservation contract.
    ...(endpointRequest.replayStore === undefined
      ? {}
      : { replayStore: endpointRequest.replayStore }),
    ...(endpointRequest.renderFailurePage === undefined
      ? {}
      : { renderFailurePage: endpointRequest.renderFailurePage }),
    ...(endpointRequest.resolvePostLifecycleResponse === undefined
      ? {}
      : { resolvePostLifecycleResponse: endpointRequest.resolvePostLifecycleResponse }),
    request: endpointRequest.request,
    ...(endpointRequest.db === undefined ? {} : { db: endpointRequest.db }),
    ...(endpointRequest.onError === undefined ? {} : { onError: endpointRequest.onError }),
    ...(endpointRequest.sessionProvider === undefined
      ? {}
      : { sessionProvider: endpointRequest.sessionProvider }),
    ...(endpointRequest.taskScheduler === undefined
      ? {}
      : { taskScheduler: endpointRequest.taskScheduler }),
  });
}

function mutationRuntimeRegistryFacts<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  renderers: readonly LiveTargetRenderer<Request>[],
): RuntimeRegistryFacts<Request> {
  return {
    liveTargetRenderers: renderers,
    queries: (definition.registry?.queries ?? []) as RuntimeRegistryFacts<Request>['queries'],
  };
}

/**
 * Run a mutation and render the no-JavaScript POST-redirect-GET response: a 303
 * redirect on success, or a re-rendered failure page. The fallback half of
 * `renderMutationEndpointResponse` (SPEC §6.3).
 *
 * Wires the replay reservation lifecycle so duplicate no-JS form submissions
 * (Back-resubmit / double-click) are deduplicated via the `Kovo-Idem` hidden
 * field (A2, SPEC §10.3:1063).
 *
 * @param definition - The mutation to run.
 * @param noJsRequest - Raw input, request, `redirectTo`, and optional failure-page renderer.
 * @returns A `NoJsMutationResponse` (redirect or document).
 * @internal
 */
export async function renderNoJsMutationResponse<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  noJsRequest: NoJsMutationRequest<Request, Value>,
): Promise<NoJsMutationResponse> {
  const csrf = mutationCsrfOptions(definition, noJsRequest.csrf);
  const deliveryMode = {
    csrf,
    kind: 'no-js-prg',
    mutationKey: definition.key,
    request: noJsRequest,
  } satisfies MutationResponseDeliveryMode<Request, Value>;
  const lifecycle = await executeMutationLifecycle<
    Key,
    InputSchema,
    Errors,
    Request,
    Value,
    GuardedRequest,
    NoJsMutationResponse
  >(definition, noJsRequest.rawInput, noJsRequest.request, {
    ...runMutationOptions(noJsRequest.csrf, noJsRequest),
    catchHandlerErrors: true,
    ...optionalReplayPolicy(noJsMutationReplayPolicy(deliveryMode)),
  });

  const response = await renderNoJsMutationLifecycleResponse({
    csrfReauthResponse: () => staleSessionNoJsCsrfReauthResponse(definition, csrf, noJsRequest),
    definition,
    lifecycle,
    noJsRequest,
  });
  return csrf === false ? mutationResponseWithoutBrowserState(response) : response;
}

/** @internal Final browser-state choke for csrf-exempt and pre-verification mutation responses. */
export function mutationResponseWithoutBrowserState<Response extends { headers: ResponseHeaders }>(
  response: Response,
): Response {
  let removed = false;
  const headers: ResponseHeaders = {};
  for (const [name, value] of Object.entries(response.headers)) {
    const lower = name.toLowerCase();
    if (lower === 'set-cookie' || lower === 'clear-site-data') {
      removed = true;
      continue;
    }
    headers[name] = Array.isArray(value) ? [...value] : value;
  }
  if (!removed) return response;

  const sanitized = { ...response, headers } as Response;
  return isBlessedRedirectResponse(response) ? blessRedirectResponse(sanitized) : sanitized;
}

function isMutationFail(value: unknown): value is MutationFail {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    value.ok === false &&
    'error' in value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function parseMutationInput<InputSchema extends Schema<unknown>>(
  schema: InputSchema,
  rawInput: unknown,
): Promise<
  | { ok: true; value: InferSchema<InputSchema> }
  | { failure: MutationFail<'VALIDATION', ValidationFailurePayload>; ok: false }
> {
  try {
    return {
      ok: true,
      value: (await parseSchemaAsync(schema, rawInput)) as InferSchema<InputSchema>,
    };
  } catch (error) {
    if (!isSchemaValidationError(error)) throw error;

    return {
      failure: {
        error: {
          code: 'VALIDATION',
          payload: { issues: error.issues },
        },
        ok: false,
        status: 422,
      },
      ok: false,
    };
  }
}

function runMutationOptions<Request>(
  csrf: CsrfOptions<Request> | false | undefined,
  lifecycle?: RequestLifecycleOptions<Request> & { taskScheduler?: TaskScheduler },
): RunMutationOptions<Request> {
  return {
    ...(csrf === undefined ? {} : { csrf }),
    ...(lifecycle?.db === undefined ? {} : { db: lifecycle.db }),
    ...(lifecycle?.onError === undefined ? {} : { onError: lifecycle.onError }),
    ...(lifecycle?.principalPosture === undefined
      ? {}
      : { principalPosture: lifecycle.principalPosture }),
    ...(lifecycle?.sessionProvider === undefined
      ? {}
      : { sessionProvider: lifecycle.sessionProvider }),
    ...(lifecycle?.taskScheduler === undefined ? {} : { taskScheduler: lifecycle.taskScheduler }),
  };
}

async function staleSessionEnhancedCsrfReauthResponse<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  csrf: CsrfOptions<Request> | false | undefined,
  request: MutationWireRequest<Request>,
): Promise<BufferedMutationWireResponse | undefined> {
  const lifecycleRequest = await staleSessionCsrfLifecycleRequest(definition, csrf, request);
  if (!lifecycleRequest) return undefined;
  return enhancedMutationReauthResponse(
    {
      auth: 'unauthenticated',
      code: 'UNAUTHORIZED',
      status: 422,
    },
    lifecycleRequest,
    { currentUrl: request.currentUrl ?? '/' },
  );
}

async function staleSessionNoJsCsrfReauthResponse<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  csrf: CsrfOptions<Request> | false | undefined,
  request: NoJsMutationRequest<Request, Value>,
): Promise<NoJsMutationResponse | undefined> {
  const lifecycleRequest = await staleSessionCsrfLifecycleRequest(definition, csrf, request);
  if (!lifecycleRequest) return undefined;
  return noJsMutationReauthResponse(
    {
      auth: 'unauthenticated',
      code: 'UNAUTHORIZED',
      status: 422,
    },
    lifecycleRequest,
    { currentUrl: request.currentUrl ?? '/' },
  );
}

async function staleSessionCsrfLifecycleRequest<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  csrf: CsrfOptions<Request> | false | undefined,
  request: MutationWireRequest<Request> | NoJsMutationRequest<Request, Value>,
): Promise<Request | undefined> {
  if (csrf === undefined || csrf === false) return undefined;
  if (!sessionGuardedMutation(definition)) return undefined;
  if (!hasSubmittedCsrfTokenShape(request.rawInput, csrf.field ?? 'kovo-csrf')) return undefined;
  if (!verifyCsrfRequestOriginFloor(request.request, csrf)) return undefined;

  const lifecycleRequest = await resolveLifecycleRequest(
    request.request,
    runMutationOptions(request.csrf, request),
  );
  if (requestHasSessionUser(lifecycleRequest)) return undefined;
  return lifecycleRequest;
}

function sessionGuardedMutation<Request>(definition: { guard?: Guard<Request> }): boolean {
  return explainGuard(definition.guard).some((fact) => 'auth' in fact && fact.auth !== undefined);
}

function requestHasSessionUser(request: unknown): boolean {
  return Boolean(
    (request as { session?: { user?: unknown } | null } | null | undefined)?.session?.user,
  );
}

function hasSubmittedCsrfTokenShape(rawInput: unknown, field: string): boolean {
  const submitted = revealCsrfTokenInput(formLikeToRecord(rawInput)[field]);
  return (
    typeof submitted === 'string' && /^v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/u.test(submitted)
  );
}

function revealCsrfTokenInput(input: unknown): unknown {
  return isUntrusted(input)
    ? revealUntrusted(input, 'validated request-derived CSRF token shape')
    : input;
}

function mutationGuardFailureToResult(guardFailure: ResolvedGuardFailure): MutationFail {
  return guardFailureToResult(guardFailure, { authenticatedUnauthorizedStatus: 403 });
}
