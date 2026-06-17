import { definedProps } from './defined-props.js';
import { reportRuntimeError } from './error-policy.js';
import {
  applyQueryChunksToRuntime,
  type OnDeltaMiss,
  type QueryApplyInterposition,
} from './query-apply.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { QueryStore } from './query-store.js';
import { queryWireKey } from './query-store.js';
import { readQueryChunks } from './wire-parser.js';
import type { QueryChunk } from './wire-parser.js';

/** @internal */
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

/** @internal */
export interface QueryRefetchFetch {
  (
    url: string,
    init: {
      cache: 'no-store';
      headers: Record<string, string>;
      method: 'GET';
    },
  ): Promise<QueryRefetchResponse> | QueryRefetchResponse;
}

/** @internal */
export interface QueryRefetchResponse {
  ok?: boolean;
  status?: number;
  text(): Promise<string> | string;
}

/** @internal */
export interface RefetchQueriesOptions extends QueryRefetchOptions {
  applyQuery?: QueryApplyInterposition;
  queryPlans?: CompiledQueryUpdatePlans;
  queries: readonly string[];
  queryStore: QueryStore;
  root?: unknown;
}

/** @internal */
export interface RefetchedQueryResponse {
  fragments: [];
  queries: readonly string[];
}

interface RefetchedQueryBody {
  queries: QueryChunk[];
}

interface AppliedRefetchedQueryBody extends RefetchedQueryResponse {
  decodedQueryCount: number;
}

/**
 * Refetch named queries over the typed-read endpoint and apply the results to
 * the query store and bindings. A background "visible return" layer: individual
 * query failures are reported via `onError` and skipped while the rest continue
 * (SPEC §4.4, §9.4).
 *
 * @param options - The `queries` to refetch, the `queryStore`, a `fetch`, and apply/plan hooks.
 * @returns The applied query responses.
 * @internal
 */
export async function refetchQueries(
  options: RefetchQueriesOptions,
): Promise<RefetchedQueryResponse[]> {
  const bodies: RefetchedQueryBody[] = [];

  for (const query of options.queries) {
    const url = options.urlForQuery?.(query) ?? `/_q/${encodeURIComponent(query)}`;
    if (!url) continue;

    try {
      const response = await options.fetch(url, {
        cache: 'no-store',
        headers: {
          Accept: 'text/html',
          'Kovo-Fragment': 'true',
        },
        method: 'GET',
      });

      if (response.ok === false || (response.status !== undefined && response.status >= 400)) {
        continue;
      }

      bodies.push({ queries: readQueryChunks(await response.text(), options.onError) });
    } catch (error) {
      reportRuntimeError(options.onError, error);
    }
  }

  const queries = bodies.flatMap((body) => body.queries);
  const appliedQueries = new Set<QueryChunk>();

  // SPEC.md §4.4/§9.4: typed reads are query-only transport. A visible-return
  // refetch pass decodes successful response bodies first, then enters the same
  // batched runtime query apply primitive as script hydration, mutation bodies,
  // deferred streams, and inline query events.
  applyQueryChunksToRuntime(options.queryStore, queries, {
    afterApplyQuery(query) {
      appliedQueries.add(query);
    },
    ...definedProps({
      applyQuery: options.applyQuery,
      queryPlans: options.queryPlans,
      root: options.root,
    }),
    onError: options.onError,
  });

  return bodies
    .map<AppliedRefetchedQueryBody>((body) => ({
      decodedQueryCount: body.queries.length,
      fragments: [],
      queries: body.queries
        .filter((query) => appliedQueries.has(query))
        .map((query) => queryWireKey(query.name, query.key)),
    }))
    .filter((body) => body.decodedQueryCount === 0 || body.queries.length > 0)
    .map(({ decodedQueryCount: _decodedQueryCount, ...body }) => body);
}

/** @internal */
export interface CreateDeltaMissRefetcherOptions extends QueryRefetchOptions {
  applyQuery?: QueryApplyInterposition;
  queryPlans?: CompiledQueryUpdatePlans;
  queryStore: QueryStore;
  root?: unknown;
}

/**
 * Create a default `onDeltaMiss` callback that GETs `/_q/<wireKey>`, parses the
 * full `<kovo-query>` body, and applies it to the store (SPEC §9.1.1 refetch-full
 * path). The returned callback is fire-and-forget (async); errors are routed to
 * `options.onError`. Injectable via `options.fetch` for tests.
 *
 * @internal
 */
export function createDeltaMissRefetcher(
  options: CreateDeltaMissRefetcherOptions,
): OnDeltaMiss {
  // SPEC §9.1.1: on a delta miss, refetch the full value over /_q/<wireKey>.
  // Debounce rapid repeated misses for the same query key so one response can
  // serve multiple quick triggers during a single microtask drain.
  const pending = new Map<string, true>();

  return (name: string, key: string | undefined): void => {
    const wireKey = queryWireKey(name, key);
    if (pending.has(wireKey)) return;
    pending.set(wireKey, true);

    void refetchQueries({
      ...options,
      queries: [wireKey],
      queryStore: options.queryStore,
    }).finally(() => {
      pending.delete(wireKey);
    });
  };
}
