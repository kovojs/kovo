import { applyMutationResponseToStore } from './apply-path.js';
import type { AppliedMutationResponse } from './apply-path.js';
import { hydrateQueryScripts } from './query-store.js';
import type { QueryScriptLike, QueryStore } from './query-store.js';

export interface QueryRefetchOptions {
  fetch: QueryRefetchFetch;
  urlForQuery?: (query: string) => string | undefined;
}

export interface QueryRefetchFetch {
  (
    url: string,
    init: {
      headers: Record<string, string>;
      method: 'GET';
    },
  ): Promise<QueryRefetchResponse> | QueryRefetchResponse;
}

export interface QueryRefetchResponse {
  ok?: boolean;
  status?: number;
  text(): Promise<string> | string;
}

export interface RefetchQueryLedger {
  eligible(optOut?: readonly string[]): readonly string[];
  remember(queries: readonly string[]): void;
}

export interface QueryVisibleReturnRefetchRoot {
  addEventListener(
    type: string,
    listener: (event: unknown) => void | Promise<void>,
    options?: { capture?: boolean },
  ): void;
  removeEventListener?: (
    type: string,
    listener: (event: unknown) => void | Promise<void>,
    options?: { capture?: boolean },
  ) => void;
  visibilityState?: 'hidden' | 'visible';
}

export interface QueryVisibleReturnRefetchOptions {
  onError?: (error: unknown) => void;
  queryScripts?: () => Iterable<QueryScriptLike>;
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

export function installQueryVisibleReturnRefetch(
  options: QueryVisibleReturnRefetchOptions,
): InstalledQueryVisibleReturnRefetch {
  const ledger = createRefetchQueryLedger();
  const seenQueryScripts = new Set<QueryScriptLike>();

  const hydrateNewQueryScripts = () => {
    if (!options.queryStore || !options.queryScripts) return;

    const scripts: QueryScriptLike[] = [];
    for (const script of options.queryScripts()) {
      if (seenQueryScripts.has(script)) continue;

      seenQueryScripts.add(script);
      scripts.push(script);
    }

    ledger.remember(
      hydrateQueryScripts(options.queryStore, scripts, {
        onError(error) {
          options.onError?.(error);
        },
      }),
    );
  };

  hydrateNewQueryScripts();

  if (!options.refetchOnFocus && (!options.queryRefetch || !options.queryStore)) {
    return {
      dispose() {},
      rememberAppliedQueries: (queries) => {
        ledger.remember(queries);
      },
    };
  }

  let refetchInFlight: Promise<void> | undefined;
  const refetchOnVisibleReturn = async () => {
    // SPEC.md §4.4: visible-return refetch follows hydrated query data, including
    // query scripts introduced by later fragment/stream DOM updates.
    hydrateNewQueryScripts();
    const queries = ledger.eligible(options.refetchOnFocusOptOut);
    await options.refetchOnFocus?.(queries);
    if (options.queryRefetch && options.queryStore) {
      const applied = await refetchQueries({
        ...options.queryRefetch,
        queries,
        queryStore: options.queryStore,
      });
      ledger.remember(applied.flatMap((chunk) => chunk.queries));
    }
  };
  const refetchOnce = () => {
    refetchInFlight ??= refetchOnVisibleReturn().finally(() => {
      refetchInFlight = undefined;
    });
    return refetchInFlight;
  };
  const listener = async () => {
    if (options.root.visibilityState === 'hidden') return;
    await refetchOnce();
  };

  options.root.addEventListener('visibilitychange', listener);

  return {
    dispose() {
      options.root.removeEventListener?.('visibilitychange', listener);
    },
    rememberAppliedQueries(queries) {
      ledger.remember(queries);
    },
  };
}

export async function refetchQueries(
  options: QueryRefetchOptions & {
    queries: readonly string[];
    queryStore: QueryStore;
  },
): Promise<AppliedMutationResponse[]> {
  const applied: AppliedMutationResponse[] = [];

  for (const query of options.queries) {
    const url = options.urlForQuery?.(query) ?? `/_q/${encodeURIComponent(query)}`;
    if (!url) continue;

    const response = await options.fetch(url, {
      headers: {
        Accept: 'text/html',
        'FW-Fragment': 'true',
      },
      method: 'GET',
    });

    if (response.ok === false || (response.status !== undefined && response.status >= 400)) {
      continue;
    }

    applied.push(applyMutationResponseToStore(options.queryStore, await response.text()));
  }

  return applied;
}
