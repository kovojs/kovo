import type { AppliedMutationResponse } from './apply-mutation-response.js';
import { definedProps } from './defined-props.js';
import { reportRuntimeError } from './error-policy.js';
import {
  applyFetchedEnhancedMutationResponseToRuntime,
  type EnhancedMutationAppliedResult,
  type MutationRuntimeApplyHooks,
} from './mutation-apply.js';
import { fetchEnhancedMutation, isFailedMutationResponse } from './mutation-fetch.js';
import type { MutationQueue } from './mutation-queue.js';
import { createMutationIdem } from './mutation-response.js';
import type { EnhancedMutationSubmitOptions } from './mutation-submit.js';
import { optimisticChangeFromInput, resolveOptimisticKeys } from './optimism.js';
import type {
  MutationChangeRecord,
  OptimisticEntry,
  OptimisticChange,
  OptimisticPlan,
  OptimisticRebaser,
} from './optimism.js';
import { stampPendingQueries } from './pending.js';
import { rebaserApplyQueryInterposition } from './query-apply.js';
import { queryStoreKey } from './query-store.js';
import type { QueryChunk } from './wire-parser.js';

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
  const idem = options.idem ?? createMutationIdem();
  const queryNames = Object.keys(options.optimistic.transforms);
  const optimisticChange = optimisticChangeFromInput(options.input, options.change);
  const optimisticKeys = resolveOptimisticKeys(options.optimistic, optimisticChange);
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
    stampPendingQueries(options.pendingRoot, queryNames, true);
  }

  const context: OptimisticSubmitContext = { idem, optimisticKeys, queryNames };

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
          discardFailedOptimism(options.rebaser, idem, queryNames, optimisticKeys);
          if (options.pendingRoot) {
            stampPendingQueries(options.pendingRoot, queryNames, false);
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
  optimisticKeys: Readonly<Record<string, string | undefined>>;
  queryNames: string[];
}

interface OptimisticQueueState {
  timedOut: boolean;
}

async function submitOptimisticEnhancedMutationDirect<Input>(
  options: OptimisticEnhancedMutationSubmitOptions<Input>,
  context: OptimisticSubmitContext,
  signal?: AbortSignal,
  queueState?: OptimisticQueueState,
): Promise<EnhancedMutationAppliedResult> {
  const { idem, optimisticKeys, queryNames } = context;

  try {
    const fetched = await fetchEnhancedMutation({ ...options, ...definedProps({ signal }) }, idem);

    if (isFailedMutationResponse(fetched.response)) {
      discardFailedOptimism(options.rebaser, idem, queryNames, optimisticKeys);
      if (options.pendingRoot) {
        stampPendingQueries(options.pendingRoot, queryNames, false);
      }

      return applyFetchedEnhancedMutationResponseToRuntime(options, fetched);
    }

    const applied = applyFetchedEnhancedMutationResponseToRuntime(
      options,
      fetched,
      optimisticMutationRuntimeApplyHooks(options, idem, queryNames, optimisticKeys),
    );
    const settledQueries = queryNames.filter(
      (queryName) => options.rebaser.pendingCount(queryName, optimisticKeys[queryName]) === 0,
    );
    if (options.pendingRoot && settledQueries.length > 0) {
      stampPendingQueries(options.pendingRoot, settledQueries, false);
    }

    return {
      ...applied,
    };
  } catch (error) {
    discardFailedOptimism(options.rebaser, idem, queryNames, optimisticKeys);
    if (options.pendingRoot) {
      stampPendingQueries(options.pendingRoot, queryNames, false);
    }
    if (!queueState?.timedOut) {
      reportRuntimeError(options.onError, error);
    }
    throw error;
  }
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
  queryNames: readonly string[],
  optimisticKeys: Readonly<Record<string, string | undefined>>,
): void {
  for (const queryName of queryNames) {
    rebaser.settleWithoutServerTruth(idem, queryName, optimisticKeys[queryName]);
  }
}

function optimisticMutationRuntimeApplyHooks<Input>(
  options: OptimisticEnhancedMutationSubmitOptions<Input>,
  idem: string,
  queryNames: readonly string[],
  optimisticKeys: Readonly<Record<string, string | undefined>>,
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
      const uncoveredQueries = uncoveredOptimisticQueries(
        queryChunks,
        options.optimistic.transforms,
        optimisticKeys,
      );
      for (const { queryName, status } of uncoveredQueries) {
        options.rebaser.settleWithoutServerTruth(idem, queryName, optimisticKeys[queryName]);
        reportRuntimeError(
          options.onError,
          uncoveredOptimisticQueryError(queryName, optimisticKeys[queryName], status),
        );
      }
      options.rebaser.settle(idem);
    },
  };
}

interface UncoveredOptimisticQuery {
  queryName: string;
  status: 'await-fragment' | 'transform';
}

function uncoveredOptimisticQueries<Input>(
  queryChunks: readonly QueryChunk[],
  transforms: Readonly<Record<string, OptimisticEntry<Input>>>,
  optimisticKeys: Readonly<Record<string, string | undefined>>,
): UncoveredOptimisticQuery[] {
  const covered = new Set(queryChunks.map((query) => queryStoreKey(query.name, query.key)));
  const uncovered: UncoveredOptimisticQuery[] = [];

  for (const [queryName, transform] of Object.entries(transforms)) {
    if (covered.has(queryStoreKey(queryName, optimisticKeys[queryName]))) continue;

    uncovered.push({
      queryName,
      status: transform === 'await-fragment' ? 'await-fragment' : 'transform',
    });
  }

  return uncovered;
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
