import type { AppliedMutationResponse } from './apply-mutation-response.js';
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
  OptimisticChange,
  OptimisticPlan,
  OptimisticRebaser,
} from './optimism.js';
import { stampPendingQueries } from './pending.js';
import { queryStoreKey } from './query-store.js';
import type { QueryChunk } from './wire-parser.js';

/** @internal */
export interface OptimisticEnhancedMutationSubmitOptions<
  Input,
> extends EnhancedMutationSubmitOptions {
  change?: OptimisticChange<Input>;
  input: Input;
  optimistic: OptimisticPlan<Input>;
  queue?: MutationQueue;
  rebaser: OptimisticRebaser;
}

/** @internal */
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
  if (options.queue) {
    // SPEC.md §10.4: mutations that declare a named queue run as named FIFO.
    return options.queue.run(options.optimistic.queue, () =>
      submitOptimisticEnhancedMutationDirect(options),
    );
  }

  return submitOptimisticEnhancedMutationDirect(options);
}

async function submitOptimisticEnhancedMutationDirect<Input>(
  options: OptimisticEnhancedMutationSubmitOptions<Input>,
): Promise<EnhancedMutationAppliedResult> {
  const idem = options.idem ?? createMutationIdem();
  const queryNames = Object.keys(options.optimistic.transforms);
  const optimisticChange = optimisticChangeFromInput(options.input, options.change);
  const optimisticKeys = resolveOptimisticKeys(options.optimistic, optimisticChange);

  // SPEC.md §10.4: predict against query data, mark dependent islands pending,
  // then reconcile the server fragment/query truth over remaining predictions.
  options.rebaser.addChange(idem, optimisticChange, options.optimistic);
  if (options.pendingRoot) {
    stampPendingQueries(options.pendingRoot, queryNames, true);
  }

  try {
    const fetched = await fetchEnhancedMutation(options, idem);

    if (isFailedMutationResponse(fetched.response)) {
      options.rebaser.discardPendingOptimism(queryNames, optimisticKeys);
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
    options.rebaser.discardPendingOptimism(queryNames, optimisticKeys);
    if (options.pendingRoot) {
      stampPendingQueries(options.pendingRoot, queryNames, false);
    }
    reportRuntimeError(options.onError, error);
    throw error;
  }
}

function optimisticMutationRuntimeApplyHooks<Input>(
  options: OptimisticEnhancedMutationSubmitOptions<Input>,
  idem: string,
  queryNames: readonly string[],
  optimisticKeys: Readonly<Record<string, string | undefined>>,
): MutationRuntimeApplyHooks {
  return {
    applyQuery(query) {
      options.rebaser.applyServerTruth(query.name, query.value, query.key);
      return { value: options.store.get(query.name, query.key) };
    },
    beforeApplyQueries(queryChunks) {
      const uncoveredQueries = uncoveredOptimisticQueries(queryChunks, queryNames, optimisticKeys);
      for (const queryName of uncoveredQueries) {
        options.rebaser.settleWithoutServerTruth(idem, queryName, optimisticKeys[queryName]);
        reportRuntimeError(
          options.onError,
          uncoveredOptimisticQueryError(queryName, optimisticKeys[queryName]),
        );
      }
      options.rebaser.settle(idem);
    },
  };
}

function uncoveredOptimisticQueries(
  queryChunks: readonly QueryChunk[],
  queryNames: readonly string[],
  optimisticKeys: Readonly<Record<string, string | undefined>>,
): string[] {
  const covered = new Set(queryChunks.map((query) => queryStoreKey(query.name, query.key)));
  return queryNames.filter(
    (queryName) => !covered.has(queryStoreKey(queryName, optimisticKeys[queryName])),
  );
}

function uncoveredOptimisticQueryError(queryName: string, key?: string): Error {
  const identity = key ? `${queryName}:${key}` : queryName;
  return new Error(`Optimistic transform for ${identity} was not covered by server query truth.`);
}
