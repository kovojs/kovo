import { definedProps } from './defined-props.js';
import type {
  ListenerTargetLike,
  OptionalQuerySelectorAllRootLike,
  VisibilityStateLike,
} from './dom-like.js';
import { reportRuntimeError } from './error-policy.js';
import type { QueryApplyInterposition } from './query-apply.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import { refetchQueries } from './query-refetch.js';
import type { QueryRefetchOptions } from './query-refetch.js';
import { readPageBuildToken } from './build-token.js';
import { createQueryScriptHydrationLedger } from './query-script-hydration.js';
import type { QueryScriptLike } from './query-script-hydration.js';
import type { QueryStore } from './query-store.js';

export interface RefetchQueryLedger {
  eligible(optOut?: readonly string[]): readonly string[];
  remember(queries: readonly string[]): void;
}

export interface QueryVisibleReturnRefetchRoot
  extends
    ListenerTargetLike<unknown>,
    OptionalQuerySelectorAllRootLike<unknown>,
    VisibilityStateLike {}

export interface QueryVisibleReturnRefetchOptions {
  applyQuery?: QueryApplyInterposition;
  onError?: (error: unknown) => void;
  queryPlans?: CompiledQueryUpdatePlans;
  queryRefetch?: QueryRefetchOptions;
  queryStore?: QueryStore;
  refetchOnFocus?: (queries: readonly string[]) => void | Promise<void>;
  refetchOnFocusOptOut?: readonly string[];
  root: QueryVisibleReturnRefetchRoot;
}

export interface InstalledQueryVisibleReturnRefetch {
  dispose(): void;
  rememberAppliedQueries(queries: readonly string[]): void;
}

export function createRefetchQueryLedger(
  initialQueries: readonly string[] = [],
): RefetchQueryLedger {
  const queries = new Set<string>();

  const remember = (nextQueries: readonly string[]): void => {
    for (const query of nextQueries) {
      queries.add(query);
    }
  };

  remember(initialQueries);

  return {
    eligible(optOut: readonly string[] = []): readonly string[] {
      const excluded = new Set(optOut);
      const eligible: string[] = [];

      for (const query of queries) {
        if (!excluded.has(query)) {
          eligible.push(query);
        }
      }

      return eligible;
    },
    remember,
  };
}

export function readVisibleReturnQueryScripts(
  root: QueryVisibleReturnRefetchRoot,
): Iterable<QueryScriptLike> {
  // SPEC.md §4.4/§9.4: visible-return refetch only follows server-authored
  // query hydration scripts; DOM binding scans stay inside the shared query
  // apply path.
  return (root.querySelectorAll?.('script[kovo-query]') ?? []) as Iterable<QueryScriptLike>;
}

export function installQueryVisibleReturnRefetch(
  options: QueryVisibleReturnRefetchOptions,
): InstalledQueryVisibleReturnRefetch {
  const ledger = createRefetchQueryLedger();
  const hydrationLedger = options.queryStore
    ? createQueryScriptHydrationLedger(options.queryStore, {
        ...definedProps({
          applyQuery: options.applyQuery,
          queryPlans: options.queryPlans,
          root: options.root,
        }),
      })
    : undefined;

  const hydrateNewQueryScripts = () => {
    if (!hydrationLedger) return;

    ledger.remember(
      hydrationLedger.hydrate(readVisibleReturnQueryScripts(options.root), {
        onError(error) {
          reportRuntimeError(options.onError, error);
        },
      }),
    );
  };

  hydrateNewQueryScripts();

  if (!options.refetchOnFocus && (!options.queryRefetch || !options.queryStore)) {
    let disposed = false;

    return {
      dispose() {
        disposed = true;
      },
      rememberAppliedQueries: (queries) => {
        if (disposed) return;
        ledger.remember(queries);
      },
    };
  }

  let disposed = false;
  let refetchInFlight: Promise<void> | undefined;
  const refetchOnVisibleReturn = async () => {
    if (disposed) return;
    // SPEC.md §4.4: visible-return refetch follows hydrated query data, including
    // query scripts introduced by later fragment/stream DOM updates.
    hydrateNewQueryScripts();
    if (disposed) return;
    const queries = ledger.eligible(options.refetchOnFocusOptOut);
    try {
      await options.refetchOnFocus?.(queries);
    } catch (error) {
      reportRuntimeError(options.onError, error);
    }
    if (disposed) return;
    if (options.queryRefetch && options.queryStore) {
      const onError = options.queryRefetch.onError ?? options.onError;
      const applied = await refetchQueries({
        ...options.queryRefetch,
        ...definedProps({ onError }),
        expectedBuildToken: options.queryRefetch.expectedBuildToken ?? readPageBuildToken(),
        ...definedProps({
          applyQuery: options.applyQuery,
          queryPlans: options.queryPlans,
          root: options.root,
        }),
        queries,
        queryStore: options.queryStore,
      });
      ledger.remember(applied.flatMap((result) => result.queries));
    }
  };
  const refetchOnce = () => {
    refetchInFlight ??= refetchOnVisibleReturn().finally(() => {
      refetchInFlight = undefined;
    });
    return refetchInFlight;
  };
  const listener = async () => {
    if (disposed) return;
    if (options.root.visibilityState === 'hidden') return;
    await refetchOnce();
  };

  // SPEC.md §8/§9.3: bfcache restoration resumes the same background typed-read
  // recovery path as focus/visibility return. In browsers pageshow is a Window
  // lifecycle event, while the loader root is usually document for query scans.
  const pageShowTarget = globalPageShowTarget(options.root);
  options.root.addEventListener('visibilitychange', listener);
  options.root.addEventListener('pageshow', listener);
  pageShowTarget?.addEventListener('pageshow', listener);

  return {
    dispose() {
      disposed = true;
      options.root.removeEventListener?.('visibilitychange', listener);
      options.root.removeEventListener?.('pageshow', listener);
      pageShowTarget?.removeEventListener?.('pageshow', listener);
    },
    rememberAppliedQueries(queries) {
      if (disposed) return;
      ledger.remember(queries);
    },
  };
}

function globalPageShowTarget(
  root: QueryVisibleReturnRefetchRoot,
): ListenerTargetLike<unknown> | undefined {
  const target = globalThis as unknown as ListenerTargetLike<unknown>;
  return target !== root && typeof target.addEventListener === 'function' ? target : undefined;
}
