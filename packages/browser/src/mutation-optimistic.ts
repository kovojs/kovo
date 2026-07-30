import type { AppliedMutationResponse } from './apply-mutation-response.js';
import { definedProps } from './defined-props.js';
import { reportRuntimeError } from './error-policy.js';
import {
  applyFetchedEnhancedMutationResponseToRuntime,
  applyStreamingFetchedEnhancedMutationResponseToRuntime,
  retiredSessionTransitionResult,
  type EnhancedMutationAppliedResult,
  type MutationRuntimeApplyHooks,
} from './mutation-apply.js';
import {
  createEnhancedMutationIdem,
  fetchEnhancedMutation,
  isFailedMutationResponse,
} from './mutation-fetch.js';
import type { MutationQueue } from './mutation-queue.js';
import type { EnhancedMutationSubmitOptions } from './mutation-submit.js';
import { isStreamingEnhancedMutationForm } from './mutation-form.js';
import { optimisticChangeFromInput, resolveOptimisticTargets } from './optimism.js';
import type {
  MutationChangeRecord,
  OptimisticEntry,
  OptimisticChange,
  OptimisticPlan,
  OptimisticQueryTarget,
  OptimisticRebaser,
  OptimisticRebaseTransaction,
} from './optimism.js';
import {
  familyPendingQuerySelector,
  stampPendingQueries,
  type PendingQuerySelector,
} from './pending.js';
import { rebaserApplyQueryInterposition } from './query-apply.js';
import { queryStoreKey } from './query-store.js';
import {
  captureSessionTransitionPrincipalRetirement,
  reloadSessionTransitionDocument,
} from './session-transition.js';
import { readPageBuildToken } from './build-token.js';
import type { QueryChunk } from './wire-parser.js';
import {
  securityArrayAppend,
  securityGetOwnPropertyDescriptor,
  securityObjectKeys,
  securityOwnArrayEntry,
  securitySet,
  securitySetAdd,
  securitySetHas,
} from './security-witness-intrinsics.js';

/** @internal Options for submitting an enhanced mutation with optimistic prediction (SPEC §10.4). */
export interface OptimisticEnhancedMutationSubmitOptions<
  Input,
> extends EnhancedMutationSubmitOptions {
  change?: OptimisticChange<Input>;
  input: Input;
  optimistic: OptimisticPlan<Input>;
  queue?: MutationQueue;
  rebaser: OptimisticRebaser;
}

/** @internal Submit an enhanced mutation with optimistic prediction and rebase reconciliation (SPEC §10.4/§10.5). */
export async function submitOptimisticEnhancedMutation<Input>(
  options: OptimisticEnhancedMutationSubmitOptions<Input>,
): Promise<
  AppliedMutationResponse & {
    appliedFragments: string[];
    changes: MutationChangeRecord[];
    idem: string;
    targets: string[];
  }
> {
  options = definedProps(options) as OptimisticEnhancedMutationSubmitOptions<Input>;
  const expectedBuildToken = options.expectedBuildToken ?? readPageBuildToken();
  if (!expectedBuildToken) {
    (options.onBuildSkew ?? reloadSessionTransitionDocument)();
    throw new TypeError(
      'Kovo refused an optimistic enhanced mutation without a document build proof.',
    );
  }
  const streaming = options.streaming ?? isStreamingEnhancedMutationForm(options.form);
  options = { ...options, expectedBuildToken, streaming };
  const retirePrincipal = captureSessionTransitionPrincipalRetirement(options);
  const idem = options.idem ?? createEnhancedMutationIdem(options.formData, false);
  const queryNames = securityObjectKeys(options.optimistic.transforms);
  const pendingSelectors: PendingQuerySelector[] = [];
  for (let index = 0; index < queryNames.length; index += 1) {
    const queryName = securityOwnArrayEntry(queryNames, index);
    if (!queryName.ok) throw new TypeError('Kovo optimistic query names must be dense.');
    securityArrayAppend(
      pendingSelectors,
      familyPendingQuerySelector(queryName.value),
      'Kovo optimistic pending-query selector snapshot',
    );
  }
  const optimisticChange = optimisticChangeFromInput(options.input, options.change);
  const optimisticTargets = resolveOptimisticTargets(
    options.optimistic,
    optimisticChange,
    options.store,
  );
  const queueName = options.optimistic.queue;

  if (options.queue) {
    try {
      options.queue.assertCanEnqueue(queueName);
    } catch (error) {
      reportRuntimeError(options.onError, error);
      throw error;
    }
  }

  // SPEC.md §10.4 line 1121 (normative): a queued mutation applies its optimistic transform on
  // ENQUEUE (immediately, against the current optimistic value including earlier queued-but-unsent
  // transforms), not on dequeue — so the UI reflects the full queued intent without waiting for the
  // head to drain. We therefore predict + mark pending up-front and queue only the network send +
  // reconcile.
  options.rebaser.addChange(idem, optimisticChange, options.optimistic);
  if (options.pendingRoot) {
    stampPendingQueries(options.pendingRoot, pendingSelectors, true);
  }

  const context: OptimisticSubmitContext = {
    idem,
    optimisticTargets,
    pendingSelectors,
    queryNames,
    retirePrincipal,
  };

  if (options.queue) {
    // SPEC.md §10.4: mutations that declare a named queue send as a named FIFO (the prediction
    // already applied above; only the send/reconcile is serialized behind the head).
    const queueState: OptimisticQueueState = { timedOut: false };
    return options.queue.run(
      queueName,
      (signal) => submitOptimisticEnhancedMutationDirect(options, context, signal, queueState),
      {
        onTimeout(error) {
          queueState.timedOut = true;
          queueState.streamingTransaction?.restore();
          discardFailedOptimism(options.rebaser, idem, optimisticTargets);
          if (options.pendingRoot) {
            stampPendingQueries(options.pendingRoot, pendingSelectors, false);
          }
          reportRuntimeError(options.onError, error);
        },
      },
    );
  }

  return submitOptimisticEnhancedMutationDirect(options, context);
}

interface OptimisticSubmitContext {
  idem: string;
  optimisticTargets: OptimisticQueryTarget[];
  pendingSelectors: PendingQuerySelector[];
  queryNames: string[];
  retirePrincipal: () => void;
}

interface OptimisticQueueState {
  streamingTransaction?: OptimisticRebaseTransaction;
  timedOut: boolean;
}

async function submitOptimisticEnhancedMutationDirect<Input>(
  options: OptimisticEnhancedMutationSubmitOptions<Input>,
  context: OptimisticSubmitContext,
  signal?: AbortSignal,
  queueState?: OptimisticQueueState,
): Promise<EnhancedMutationAppliedResult> {
  const { idem, optimisticTargets, pendingSelectors, queryNames, retirePrincipal } = context;
  let streamingTransaction: OptimisticRebaseTransaction | undefined;

  try {
    const fetched = await fetchEnhancedMutation(
      {
        ...options,
        ...definedProps({ signal }),
        onSessionTransition: retirePrincipal,
        onSessionTransitionReload: reloadSessionTransitionDocument,
      },
      idem,
    );
    if (queueState?.timedOut) throw lateQueueSettlementAfterTimeoutError();
    if (fetched.sessionTransition) return retiredSessionTransitionResult(fetched);
    if (isFailedMutationResponse(fetched.response)) {
      discardFailedOptimism(options.rebaser, idem, optimisticTargets);
      if (options.pendingRoot) {
        stampPendingQueries(options.pendingRoot, pendingSelectors, false);
      }

      return applyFetchedEnhancedMutationResponseToRuntime(options, fetched);
    }

    let applied: EnhancedMutationAppliedResult;
    if (fetched.streamBody !== undefined) {
      streamingTransaction = options.rebaser.beginServerTruthTransaction();
      if (queueState !== undefined) queueState.streamingTransaction = streamingTransaction;
      applied = await applyStreamingFetchedEnhancedMutationResponseToRuntime(
        {
          ...options,
          ...definedProps({ streamSignal: signal }),
        },
        { ...fetched, streamBody: fetched.streamBody },
        {
          applyQuery: rebaserApplyQueryInterposition(
            options.store,
            streamingTransaction,
            options.onDeltaMiss,
          ),
        },
      );
      if (queueState?.timedOut) throw lateQueueSettlementAfterTimeoutError();
      captureOptimisticTargets(streamingTransaction, optimisticTargets);
      settleOptimisticResponseCoverage(options, idem, optimisticTargets, applied.queries);
    } else {
      applied = applyFetchedEnhancedMutationResponseToRuntime(
        options,
        fetched,
        optimisticMutationRuntimeApplyHooks(options, idem, optimisticTargets),
      );
    }
    const settledQueries: string[] = [];
    for (let index = 0; index < queryNames.length; index += 1) {
      const queryName = securityOwnArrayEntry(queryNames, index);
      if (!queryName.ok) throw new TypeError('Kovo optimistic query names must be dense.');
      if (optimisticQueryFamilyIsSettled(options.rebaser, queryName.value, optimisticTargets)) {
        securityArrayAppend(settledQueries, queryName.value, 'Browser settled optimistic queries');
      }
    }
    if (options.pendingRoot && settledQueries.length > 0) {
      const settledSelectors: PendingQuerySelector[] = [];
      for (let index = 0; index < settledQueries.length; index += 1) {
        const queryName = securityOwnArrayEntry(settledQueries, index);
        if (!queryName.ok) throw new TypeError('Kovo settled query names must be dense.');
        securityArrayAppend(
          settledSelectors,
          familyPendingQuerySelector(queryName.value),
          'Kovo settled pending-query selector snapshot',
        );
      }
      stampPendingQueries(options.pendingRoot, settledSelectors, false);
    }
    streamingTransaction?.commit();

    return {
      ...applied,
    };
  } catch (error) {
    streamingTransaction?.restore();
    if (queueState?.timedOut) {
      discardFailedOptimism(options.rebaser, idem, optimisticTargets);
      throw error;
    }
    discardFailedOptimism(options.rebaser, idem, optimisticTargets);
    if (options.pendingRoot) {
      stampPendingQueries(options.pendingRoot, pendingSelectors, false);
    }
    if (!queueState?.timedOut) {
      reportRuntimeError(options.onError, error);
    }
    throw error;
  }
}

function captureOptimisticTargets(
  transaction: OptimisticRebaseTransaction,
  optimisticTargets: readonly OptimisticQueryTarget[],
): void {
  for (let index = 0; index < optimisticTargets.length; index += 1) {
    const target = securityOwnArrayEntry(optimisticTargets, index);
    if (!target.ok) {
      throw new TypeError('Kovo optimistic transaction targets must be dense.');
    }
    transaction.capture(target.value.queryName, target.value.key);
  }
}

function lateQueueSettlementAfterTimeoutError(): Error {
  const error = new Error('Mutation queue result arrived after its timeout and was ignored.');
  error.name = 'AbortError';
  return error;
}

/**
 * Roll back ONLY the failed mutation's own optimistic transforms, preserving any co-pending
 * sibling mutations' predictions (SPEC §10.4 line 1118: per-query pending log — rebase only the
 * not-yet-committed transforms). `settleWithoutServerTruth` removes this mutation's id from each
 * query's pending log and re-derives the store from the captured baseline plus the surviving
 * siblings, so a single failure never wipes a concurrent in-flight mutation's prediction.
 */
function discardFailedOptimism(
  rebaser: OptimisticRebaser,
  idem: string,
  optimisticTargets: readonly OptimisticQueryTarget[],
): void {
  for (let index = 0; index < optimisticTargets.length; index += 1) {
    const target = securityOwnArrayEntry(optimisticTargets, index);
    if (!target.ok) {
      throw new TypeError('Kovo optimistic rollback targets must be dense.');
    }
    rebaser.settleWithoutServerTruth(idem, target.value.queryName, target.value.key);
  }
}

function optimisticMutationRuntimeApplyHooks<Input>(
  options: OptimisticEnhancedMutationSubmitOptions<Input>,
  idem: string,
  optimisticTargets: readonly OptimisticQueryTarget[],
): MutationRuntimeApplyHooks {
  return {
    // SPEC §9.1.1 (F1) + §10.4: route each chunk through the rebaser as server truth. A
    // `<kovo-query delta>` body is a QueryDelta envelope merged against the held base BEFORE
    // it is handed to the rebaser; otherwise the raw {set}/{lists} envelope is written to the
    // store as the full value and the rebaser baseline is corrupted. `applyServerTruth` then
    // settles the transforms this truth already reflects (`query.settles`) before rebasing the
    // rest, so a sibling mutation's committed effect folded into this re-run is not re-applied.
    applyQuery: rebaserApplyQueryInterposition(options.store, options.rebaser, options.onDeltaMiss),
    beforeApplyQueries(queryChunks) {
      settleOptimisticResponseCoverage(options, idem, optimisticTargets, queryChunks);
    },
  };
}

function settleOptimisticResponseCoverage<Input>(
  options: OptimisticEnhancedMutationSubmitOptions<Input>,
  idem: string,
  optimisticTargets: readonly OptimisticQueryTarget[],
  queryChunks: readonly Pick<QueryChunk, 'key' | 'name'>[],
): void {
  const uncoveredQueries = uncoveredOptimisticQueries(
    queryChunks,
    options.optimistic.transforms,
    optimisticTargets,
  );
  for (let index = 0; index < uncoveredQueries.length; index += 1) {
    const uncovered = securityOwnArrayEntry(uncoveredQueries, index);
    if (!uncovered.ok) {
      throw new TypeError('Kovo uncovered optimistic queries must be dense.');
    }
    const { key, queryName, status } = uncovered.value;
    options.rebaser.settleWithoutServerTruth(idem, queryName, key);
    reportRuntimeError(options.onError, uncoveredOptimisticQueryError(queryName, key, status));
  }
  options.rebaser.settle(idem);
}

interface UncoveredOptimisticQuery {
  key?: string;
  queryName: string;
  status: 'await-fragment' | 'transform';
}

function uncoveredOptimisticQueries<Input>(
  queryChunks: readonly Pick<QueryChunk, 'key' | 'name'>[],
  transforms: Readonly<Record<string, OptimisticEntry<Input>>>,
  optimisticTargets: readonly OptimisticQueryTarget[],
): UncoveredOptimisticQuery[] {
  const covered = securitySet<string>();
  for (let index = 0; index < queryChunks.length; index += 1) {
    const query = securityOwnArrayEntry(queryChunks, index);
    if (!query.ok) throw new TypeError('Kovo optimistic server query chunks must be dense.');
    securitySetAdd(covered, queryStoreKey(query.value.name, query.value.key));
  }
  const uncovered: UncoveredOptimisticQuery[] = [];

  for (let index = 0; index < optimisticTargets.length; index += 1) {
    const targetEntry = securityOwnArrayEntry(optimisticTargets, index);
    if (!targetEntry.ok) throw new TypeError('Kovo optimistic targets must be dense.');
    const { key, queryName } = targetEntry.value;
    const transform = securityGetOwnPropertyDescriptor(transforms, queryName);
    if (!transform || !('value' in transform)) {
      throw new TypeError('Kovo optimistic transforms must be own-data properties.');
    }
    if (securitySetHas(covered, queryStoreKey(queryName, key))) {
      continue;
    }

    securityArrayAppend(
      uncovered,
      {
        ...(key === undefined ? {} : { key }),
        queryName,
        status: transform.value === 'await-fragment' ? 'await-fragment' : 'transform',
      },
      'Browser uncovered optimistic queries',
    );
  }

  return uncovered;
}

function optimisticQueryFamilyIsSettled(
  rebaser: OptimisticRebaser,
  queryName: string,
  optimisticTargets: readonly OptimisticQueryTarget[],
): boolean {
  for (let index = 0; index < optimisticTargets.length; index += 1) {
    const target = securityOwnArrayEntry(optimisticTargets, index);
    if (!target.ok) throw new TypeError('Kovo optimistic targets must be dense.');
    if (
      target.value.queryName === queryName &&
      rebaser.pendingCount(queryName, target.value.key) > 0
    ) {
      return false;
    }
  }
  return true;
}

function uncoveredOptimisticQueryError(
  queryName: string,
  key: string | undefined,
  status: UncoveredOptimisticQuery['status'],
): Error {
  const identity = key ? `${queryName}:${key}` : queryName;
  if (status === 'await-fragment') {
    return new Error(
      `Await-fragment position for ${identity} produced no server query truth after guard rerun.`,
    );
  }
  return new Error(`Optimistic transform for ${identity} was not covered by server query truth.`);
}
