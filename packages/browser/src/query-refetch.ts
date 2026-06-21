import { definedProps } from './defined-props.js';
import { reportRuntimeError } from './error-policy.js';
import {
  applyQueryChunksToRuntime,
  type OnDeltaMiss,
  type QueryApplyInterposition,
} from './query-apply.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { QueryStore } from './query-store.js';
import { queryWireKey, splitQueryWireKey } from './query-store.js';
import { readQueryChunks } from './wire-parser.js';
import type { QueryChunk } from './wire-parser.js';

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface QueryRefetchOptions {
  /**
   * The current document's render-plan version token (`<meta name="kovo-build">`). When set, a
   * `/_q/` refetch whose `Kovo-Build` response header differs is a deploy-skew event: the chunks
   * are NOT applied to the stale-build store and `onBuildSkew` is invoked instead (SPEC §5.2.1
   * rule 2d, §14 recovery — "if the refetch still differs … perform a full navigation reload").
   */
  expectedBuildToken?: string;
  fetch: QueryRefetchFetch;
  /**
   * Reports typed-read fetch, response-body, and wire-apply failures. Refetch is
   * a visible-return background layer, so individual query failures are reported
   * and skipped while later queries continue under SPEC.md §4.4 hydration.
   */
  onError?: (error: unknown) => void;
  /**
   * Invoked at most once when a `/_q/` refetch returns a build token that still differs from
   * `expectedBuildToken` — the document is fundamentally skewed and the caller should perform a
   * single full navigation reload of the current route (SPEC §14). No chunks are applied.
   */
  onBuildSkew?: () => void;
  urlForQuery?: (query: string) => string | undefined;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
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

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface QueryRefetchResponse {
  headers?: { get(name: string): string | null };
  ok?: boolean;
  status?: number;
  text(): Promise<string> | string;
}

/** @internal Options for refetching named queries over the typed-read endpoint (SPEC §9.4). */
export interface RefetchQueriesOptions extends QueryRefetchOptions {
  applyQuery?: QueryApplyInterposition;
  queryPlans?: CompiledQueryUpdatePlans;
  queries: readonly string[];
  queryStore: QueryStore;
  root?: unknown;
}

/** @internal The applied result of a refetched query: empty fragments plus query wire keys (SPEC §9.4). */
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
 * @internal Refetch named queries over the typed-read endpoint and apply the results to
 * the query store and bindings. A background "visible return" layer: individual
 * query failures are reported via `onError` and skipped while the rest continue
 * (SPEC §4.4, §9.4).
 *
 * @param options - The `queries` to refetch, the `queryStore`, a `fetch`, and apply/plan hooks.
 * @returns The applied query responses.
 */
export async function refetchQueries(
  options: RefetchQueriesOptions,
): Promise<RefetchedQueryResponse[]> {
  const bodies: RefetchedQueryBody[] = [];

  for (const query of options.queries) {
    // SPEC §9.4/§10.2 (F5): the typed-read endpoint dispatches by query NAME
    // (`/_q/<name>`), and a keyed query's args arrive as search params through the
    // query's `args` schema. The default URL therefore uses the NAME from the
    // wireKey, never the canonical `name:keyValue` (which the server registers no
    // query for → 404, silently stale base + broken deploy-skew recovery). Apps
    // that need to carry per-instance args build the full `/_q/<name>?<args>` URL
    // via `urlForQuery`.
    const url = options.urlForQuery?.(query) ?? defaultQueryRefetchUrl(query);
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

      // SPEC §5.2.1 rule 2d / §14: a /_q/ refetch whose build token still differs from the
      // document token means the document is fundamentally skewed — do NOT merge fresh-build data
      // into the stale-build store; escalate to a full navigation reload (once) instead.
      const responseBuildToken = response.headers?.get('Kovo-Build') ?? undefined;
      if (
        options.expectedBuildToken !== undefined &&
        responseBuildToken !== undefined &&
        responseBuildToken !== options.expectedBuildToken
      ) {
        options.onBuildSkew?.();
        return [];
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

/**
 * @internal Build the default `/_q/` refetch URL for a query wireKey (SPEC §9.4/§10.2, F5).
 * Splits `name:keyValue` and uses the NAME as the path segment so dispatch matches the
 * registered query, never `/_q/<name:keyValue>` (a guaranteed 404). The instance key value
 * rides as the reserved `key` search param so a keyed query whose `args` schema reads it can
 * scope the read; an unkeyed query gets `/_q/<name>` with no params.
 */
function defaultQueryRefetchUrl(wireKey: string): string {
  const { keyValue, name } = splitQueryWireKey(wireKey);
  const path = `/_q/${encodeURIComponent(name)}`;
  return keyValue === undefined ? path : `${path}?key=${encodeURIComponent(keyValue)}`;
}

/** @internal Options for building the default delta-miss refetch callback (SPEC §9.1.1). */
export interface CreateDeltaMissRefetcherOptions extends QueryRefetchOptions {
  applyQuery?: QueryApplyInterposition;
  queryPlans?: CompiledQueryUpdatePlans;
  queryStore: QueryStore;
  root?: unknown;
}

/**
 * @internal Create a default `onDeltaMiss` callback that GETs `/_q/<wireKey>`, parses the
 * full `<kovo-query>` body, and applies it to the store (SPEC §9.1.1 refetch-full
 * path). The returned callback is fire-and-forget (async); errors are routed to
 * `options.onError`. Injectable via `options.fetch` for tests.
 *
 */
export function createDeltaMissRefetcher(options: CreateDeltaMissRefetcherOptions): OnDeltaMiss {
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
