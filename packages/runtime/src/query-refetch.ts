import { applyFragmentQueryBody, type AppliedMutationResponse } from './apply-mutation-response.js';
import { definedProps } from './defined-props.js';
import { reportRuntimeError } from './error-policy.js';
import { applyQueryChunksToRuntime } from './query-apply.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { QueryStore } from './query-store.js';

export interface QueryRefetchOptions {
  fetch: QueryRefetchFetch;
  /**
   * Reports typed-read fetch, response-body, and wire-apply failures. Refetch is
   * a visible-return background layer, so individual query failures are reported
   * and skipped while later queries continue under SPEC.md §4.4 hydration.
   */
  onError?: (error: unknown) => void;
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

export interface RefetchQueriesOptions extends QueryRefetchOptions {
  queryPlans?: CompiledQueryUpdatePlans;
  queries: readonly string[];
  queryStore: QueryStore;
  root?: unknown;
}

export async function refetchQueries(
  options: RefetchQueriesOptions,
): Promise<AppliedMutationResponse[]> {
  const applied: AppliedMutationResponse[] = [];

  for (const query of options.queries) {
    const url = options.urlForQuery?.(query) ?? `/_q/${encodeURIComponent(query)}`;
    if (!url) continue;

    try {
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

      applied.push(
        applyFragmentQueryBody(
          await response.text(),
          (queries) =>
            applyQueryChunksToRuntime(options.queryStore, queries, {
              ...definedProps({
                queryPlans: options.queryPlans,
                root: options.root,
              }),
            }),
          options.onError,
        ),
      );
    } catch (error) {
      reportRuntimeError(options.onError, error);
    }
  }

  return applied;
}
