import { frameworkWireIdentityIsValid } from '@kovojs/core/internal/wire-input-grammar';

import { definedProps } from './defined-props.js';
import { reportRuntimeError } from './error-policy.js';
import {
  applyQueryChunksToRuntime,
  type OnDeltaMiss,
  type QueryApplyInterposition,
} from './query-apply.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { QueryIdentity, QueryStore } from './query-store.js';
import { createQueryIdentity, queryStoreKey } from './query-store.js';
import { readQueryChunks } from './wire-parser.js';
import type { QueryChunk } from './wire-parser.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import {
  freezeSecurityValue,
  securityArrayAppend,
  securityGetOwnPropertyDescriptor,
  securityMap,
  securityMapDelete,
  securityMapHas,
  securityMapSet,
  securityOwnArrayEntry,
  securitySet,
  securitySetAdd,
  securitySetHas,
} from './security-witness-intrinsics.js';

// SPEC §6.6/§9.4: typed-read refetch is a credential-bearing browser transport and a
// server-truth sink. Capture its platform controls before authored browser modules can replace
// response getters, text(), URL encoding, or collection methods. `@kovojs/server` transitively
// exposes this framework-white-box module to its Vite SSR evaluator, though, so a non-DOM server
// import must not run browser realm controls merely by importing the package. Node-only structural
// adapters used by focused tests initialize the same controls at their first refetch boundary.
type QueryRefetchSecurity = ReturnType<typeof createBrowserNavigationSecurityControls>;

let queryRefetchSecurityAtBoot: QueryRefetchSecurity | undefined =
  typeof globalThis.Element === 'function' && typeof globalThis.Document === 'function'
    ? createBrowserNavigationSecurityControls()
    : undefined;

function queryRefetchSecurityControls(): QueryRefetchSecurity {
  if (queryRefetchSecurityAtBoot) return queryRefetchSecurityAtBoot;
  const security = createBrowserNavigationSecurityControls();
  queryRefetchSecurityAtBoot = security;
  return security;
}
const queryRefetchEncodeURIComponent = encodeURIComponent;
const queryRefetchEncodingSound =
  queryRefetchEncodeURIComponent('kovo/query?key=value') === 'kovo%2Fquery%3Fkey%3Dvalue' &&
  queryRefetchEncodeURIComponent('../_m/auth/sign-out') === '..%2F_m%2Fauth%2Fsign-out';

/**
 * @internal A declared query whose refetch-on-focus opt-out drives the runtime exclusion set
 * (SPEC §9.3/§9.4). Mirrors the `@kovojs/core` `Query` handle shape produced by
 * `queryRef(key, { refetchOnFocus: false })`.
 */
export interface RefetchOnFocusDeclaration {
  key: string;
  refetchOnFocus?: false;
}

/**
 * @internal Derive the refetch-on-focus opt-out NAME set from declared queries (SPEC §9.3/§9.4).
 *
 * A query whose declaration sets `refetchOnFocus: false` (the `@kovojs/core` `queryRef()` config) is
 * excluded from the visible-return/focus typed-read refetch (§9.4). This maps that per-query
 * declaration into the `refetchOnFocusOptOut` set the loader runtime consumes, so the declared
 * value actually drives behavior instead of being dead metadata. Matching is by query NAME
 * (SPEC §9.4 dispatches `/_q/` by name), so opting a keyed query out excludes every instance key.
 */
export function deriveRefetchOnFocusOptOut(
  queries: readonly RefetchOnFocusDeclaration[],
): readonly string[] {
  const optOut: string[] = [];
  const seen = securitySet<string>();
  for (let index = 0; index < queries.length; index += 1) {
    const entry = securityOwnArrayEntry(queries, index);
    if (!entry.ok || entry.value === null || typeof entry.value !== 'object') continue;
    const key = ownDeclarationData(entry.value, 'key');
    const refetchOnFocus = ownDeclarationData(entry.value, 'refetchOnFocus');
    if (typeof key === 'string' && refetchOnFocus === false && !securitySetHas(seen, key)) {
      securitySetAdd(seen, key);
      securityArrayAppend(optOut, key, 'Browser query refetch opt-out declarations');
    }
  }
  return optOut;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface QueryRefetchOptions {
  /**
   * The current document's app-build token (`<meta name="kovo-build">`). When set, a
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
  /** Receives the exact frozen query identity; names and keys are never collapsed into one string. */
  urlForQuery?: (query: QueryIdentity) => string | undefined;
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
  queries: readonly (string | QueryIdentity)[];
  queryStore: QueryStore;
  root?: unknown;
}

/** @internal The applied result of a refetched query: exact structured identities (SPEC §9.4). */
export interface RefetchedQueryResponse {
  fragments: [];
  queries: readonly QueryIdentity[];
}

interface RefetchedQueryBody {
  queries: QueryChunk[];
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
  const queryRefetchSecurity = queryRefetchSecurityControls();
  const bodies: RefetchedQueryBody[] = [];
  const fetchControl = options.fetch;
  const expectedBuildToken = options.expectedBuildToken;
  const onBuildSkew = options.onBuildSkew;
  const onError = options.onError;
  const urlForQuery = options.urlForQuery;
  const queryNames = snapshotQueryIdentities(options.queries);

  for (let index = 0; index < queryNames.length; index += 1) {
    const queryEntry = securityOwnArrayEntry(queryNames, index);
    if (!queryEntry.ok) continue;
    const query = queryEntry.value;
    // SPEC §9.4/§10.2 (F5): the typed-read endpoint dispatches by query NAME
    // (`/_q/<name>`), and a keyed query's args arrive as search params through the
    // query's `args` schema. The default URL therefore uses the NAME from the
    // wireKey, never the canonical `name:keyValue` (which the server registers no
    // query for → 404, silently stale base + broken deploy-skew recovery). Apps
    // that need to carry per-instance args build the full `/_q/<name>?<args>` URL
    // via `urlForQuery`. The hook receives name/key as separate frozen facts, because an unkeyed
    // name containing `:` can have the same display string as a keyed query instance.
    const customUrl = urlForQuery?.(query);
    const url = customUrl ?? defaultQueryRefetchUrl(query);
    if (!url) continue;

    try {
      const response = await queryRefetchSecurity.fetchWithOptionalSyncResult(
        fetchControl,
        undefined,
        url,
        {
          cache: 'no-store',
          headers: {
            Accept: 'text/html',
            'Kovo-Fragment': 'true',
          },
          method: 'GET',
        },
      );

      const ok = queryRefetchSecurity.readResponseField(response, 'ok');
      const status = queryRefetchSecurity.readResponseField(response, 'status');
      if (ok === false || (typeof status === 'number' && status >= 400)) {
        continue;
      }

      if (
        !queryRefetchSecurity.isInlineContentDisposition(
          queryRefetchSecurity.readHeader(response, 'Content-Disposition'),
        )
      ) {
        throw new TypeError('Kovo refused an attachment or malformed typed-read response.');
      }

      // SPEC §5.2.1 rule 2d / §14: a /_q/ refetch whose build token still differs from the
      // document token means the document is fundamentally skewed — do NOT merge fresh-build data
      // into the stale-build store; escalate to a full navigation reload (once) instead.
      const responseBuildToken = queryRefetchSecurity.readHeader(response, 'Kovo-Build');
      if (
        expectedBuildToken !== undefined &&
        (responseBuildToken === undefined || responseBuildToken !== expectedBuildToken)
      ) {
        onBuildSkew?.();
        return [];
      }

      securityArrayAppend(
        bodies,
        {
          queries: readQueryChunks(
            await queryRefetchSecurity.readResponseTextOptionalSync(response),
            onError,
          ),
        },
        'Browser typed-read response bodies',
      );
    } catch (error) {
      reportRuntimeError(onError, error);
    }
  }

  const queries: QueryChunk[] = [];
  for (let bodyIndex = 0; bodyIndex < bodies.length; bodyIndex += 1) {
    const body = securityOwnArrayEntry(bodies, bodyIndex);
    if (!body.ok) continue;
    appendDenseValues(queries, body.value.queries, 'Browser typed-read decoded queries');
  }
  const appliedQueries = securitySet<QueryChunk>();

  // SPEC.md §4.4/§9.4: typed reads are query-only transport. A visible-return
  // refetch pass decodes successful response bodies first, then enters the same
  // batched runtime query apply primitive as script hydration, mutation bodies,
  // deferred streams, and inline query events.
  applyQueryChunksToRuntime(options.queryStore, queries, {
    afterApplyQuery(query) {
      securitySetAdd(appliedQueries, query);
    },
    ...definedProps({
      applyQuery: options.applyQuery,
      queryPlans: options.queryPlans,
      root: options.root,
    }),
    onError,
  });

  const appliedBodies: RefetchedQueryResponse[] = [];
  for (let bodyIndex = 0; bodyIndex < bodies.length; bodyIndex += 1) {
    const bodyEntry = securityOwnArrayEntry(bodies, bodyIndex);
    if (!bodyEntry.ok) continue;
    const body = bodyEntry.value;
    const appliedIdentities: QueryIdentity[] = [];
    for (let queryIndex = 0; queryIndex < body.queries.length; queryIndex += 1) {
      const queryEntry = securityOwnArrayEntry(body.queries, queryIndex);
      if (!queryEntry.ok || !securitySetHas(appliedQueries, queryEntry.value)) continue;
      securityArrayAppend(
        appliedIdentities,
        createQueryIdentity(queryEntry.value.name, queryEntry.value.key),
        'Browser typed-read applied query identities',
      );
    }
    const appliedBody: RefetchedQueryResponse = {
      fragments: [],
      queries: freezeSecurityValue(appliedIdentities),
    };
    if (body.queries.length === 0 || appliedBody.queries.length > 0) {
      securityArrayAppend(appliedBodies, appliedBody, 'Browser typed-read applied response facts');
    }
  }
  return appliedBodies;
}

/**
 * @internal Build the default `/_q/` refetch URL for a query wireKey (SPEC §9.4/§10.2, F5).
 * Splits `name:keyValue` and uses the NAME as the path segment so dispatch matches the
 * registered query, never `/_q/<name:keyValue>` (a guaranteed 404). The instance key value
 * rides as the reserved `key` search param so a keyed query whose `args` schema reads it can
 * scope the read; an unkeyed query gets `/_q/<name>` with no params.
 */
function defaultQueryRefetchUrl(identity: QueryIdentity): string {
  if (!queryRefetchEncodingSound) {
    throw new TypeError('Kovo query URL encoding controls are unavailable.');
  }
  const path = `/_q/${encodeQueryPath(identity.name)}`;
  if (identity.key === undefined) return path;
  const security = queryRefetchSecurityControls();
  const prefix = `${identity.name}:`;
  const keyValue =
    security.indexOf(identity.key, prefix) === 0
      ? security.slice(identity.key, prefix.length)
      : identity.key;
  return `${path}?key=${queryRefetchEncodeURIComponent(keyValue)}`;
}

function encodeQueryPath(name: string): string {
  const security = queryRefetchSecurityControls();
  let encoded = '';
  let remaining = name;
  for (;;) {
    const separator = security.indexOf(remaining, '/');
    const segment = separator < 0 ? remaining : security.slice(remaining, 0, separator);
    encoded += `${encoded === '' ? '' : '/'}${queryRefetchEncodeURIComponent(segment)}`;
    if (separator < 0) return encoded;
    remaining = security.slice(remaining, separator + 1);
  }
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
  const pending = securityMap<string, true>();

  return (name: string, key: string | undefined): void => {
    const storeKey = queryStoreKey(name, key);
    if (securityMapHas(pending, storeKey)) return;
    securityMapSet(pending, storeKey, true);

    void (async () => {
      try {
        await refetchQueries({
          ...options,
          queries: [key === undefined ? { name } : { key, name }],
          queryStore: options.queryStore,
        });
      } finally {
        securityMapDelete(pending, storeKey);
      }
    })();
  };
}

function ownDeclarationData(
  declaration: RefetchOnFocusDeclaration,
  property: 'key' | 'refetchOnFocus',
): unknown {
  const descriptor = securityGetOwnPropertyDescriptor(declaration, property);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function snapshotQueryIdentities(queries: readonly (string | QueryIdentity)[]): QueryIdentity[] {
  if (queries.length > 100_000) throw new TypeError('Kovo query refetch list is too large.');
  const snapshot: QueryIdentity[] = [];
  for (let index = 0; index < queries.length; index += 1) {
    const entry = securityOwnArrayEntry(queries, index);
    if (!entry.ok) throw new TypeError('Kovo query refetch list must be dense.');
    if (typeof entry.value === 'string') {
      if (!frameworkWireIdentityIsValid(entry.value)) {
        throw new TypeError('Kovo query names must be non-empty valid scalar strings.');
      }
      securityArrayAppend(
        snapshot,
        createQueryIdentity(entry.value),
        'Browser typed-read query snapshot',
      );
      continue;
    }
    if (entry.value === null || typeof entry.value !== 'object') {
      throw new TypeError('Kovo query refetch entries must be names or structured identities.');
    }
    const name = securityGetOwnPropertyDescriptor(entry.value, 'name');
    const key = securityGetOwnPropertyDescriptor(entry.value, 'key');
    if (!name || !('value' in name) || !frameworkWireIdentityIsValid(name.value)) {
      throw new TypeError('Kovo structured query identity requires a non-empty valid scalar name.');
    }
    if (key && (!('value' in key) || !frameworkWireIdentityIsValid(key.value))) {
      throw new TypeError(
        'Kovo structured query identity key must be a non-empty own-data valid scalar string.',
      );
    }
    securityArrayAppend(
      snapshot,
      createQueryIdentity(name.value, key && 'value' in key ? (key.value as string) : undefined),
      'Browser typed-read query snapshot',
    );
  }
  return snapshot;
}

function appendDenseValues<Value>(target: Value[], source: readonly Value[], label: string): void {
  for (let index = 0; index < source.length; index += 1) {
    const entry = securityOwnArrayEntry(source, index);
    if (!entry.ok) throw new TypeError(`${label} must be dense.`);
    securityArrayAppend(target, entry.value, label);
  }
}
