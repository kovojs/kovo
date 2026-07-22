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
import { queryRefetchHref } from './query-refetch-metadata.js';
import { readQueryElementChunk } from './wire-parser.js';
import type { QueryChunk } from './wire-parser.js';
import { readExactTypedQueryResponseElement } from './wire-response-scanner.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import { readPageBuildToken } from './build-token.js';
import { reloadSessionTransitionDocument } from './session-transition.js';
import {
  freezeSecurityValue,
  securityArrayAppend,
  securityGetOwnPropertyDescriptor,
  securityMap,
  securityMapDelete,
  securityMapGet,
  securityMapHas,
  securityMapSet,
  securityOwnArrayEntry,
  securitySet,
  securitySetAdd,
  securitySetHas,
  securityWeakMap,
  securityWeakMapGet,
  securityWeakMapSet,
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
  /**
   * Invoked when an admitted, same-build typed read reports that the current principal may no
   * longer read the query. The old private store/DOM must not remain authoritative after a 401 or
   * 403, so the default performs a full-document recovery of the current route (SPEC §9.4).
   */
  onAuthDenied?: () => void;
  /** Full-document recovery when the server did not issue canonical refetch authority. */
  onDocumentRecovery?: () => void;
  /** Explicit trusted document URL for browser-free adapters; browsers use their pinned location. */
  sourceUrl?: string;
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
      redirect: 'error';
    },
  ): Promise<QueryRefetchResponse> | QueryRefetchResponse;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface QueryRefetchResponse {
  body?: ReadableStream<Uint8Array> | null;
  headers?: { get(name: string): string | null };
  ok?: boolean;
  redirected?: boolean;
  status?: number;
  text(): Promise<string> | string;
  url?: string;
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

interface QueryRecoveryState {
  generation: number;
  terminal: boolean;
}

// One private recovery generation per runtime store. Visible-return, delta-miss, and direct
// refetch callers share the store; a denial observed by any one of them invalidates every
// in-flight batch before body decode/apply, even when navigation is delayed or throws.
const queryRecoveryStates = securityWeakMap<QueryStore, QueryRecoveryState>();

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
  const stagedResponseHrefs = securityMap<string, string>();
  const fetchControl = options.fetch;
  const expectedBuildToken = options.expectedBuildToken ?? readPageBuildToken();
  const onBuildSkew = options.onBuildSkew ?? reloadSessionTransitionDocument;
  const onAuthDenied = options.onAuthDenied ?? reloadSessionTransitionDocument;
  const onDocumentRecovery = options.onDocumentRecovery ?? reloadSessionTransitionDocument;
  const onError = options.onError;
  const urlForQuery = options.urlForQuery;
  const sourceUrl = options.sourceUrl ?? queryRefetchSecurity.currentUrl()?.href;
  const recoveryState = queryRecoveryState(options.queryStore);
  if (recoveryState.terminal) return [];
  const recoveryGeneration = recoveryState.generation;
  if (!expectedBuildToken) {
    if (latchQueryRecovery(options.queryStore, recoveryGeneration)) {
      try {
        onBuildSkew();
      } catch (error) {
        reportRuntimeError(onError, error);
      }
    }
    return [];
  }
  const queryNames = snapshotQueryIdentities(options.queries);
  let terminalRecovery:
    | 'auth-denied'
    | 'build-skew'
    | 'invalid-response'
    | 'missing-href'
    | undefined;
  let terminalRecoveryLatched = false;
  const selectInvalidResponseRecovery = (error: unknown): void => {
    // Recovery selection is framework authority. An app/runtime diagnostic observer may throw,
    // but it cannot prevent the batch from latching terminal recovery before any earlier decoded
    // query becomes browser truth (SPEC §9.4/§14).
    terminalRecovery = 'invalid-response';
    if (!terminalRecoveryLatched) {
      terminalRecoveryLatched = latchQueryRecovery(options.queryStore, recoveryGeneration);
    }
    try {
      reportRuntimeError(onError, error);
    } catch {}
  };

  for (let index = 0; terminalRecovery === undefined && index < queryNames.length; index += 1) {
    if (!queryRecoveryGenerationIsCurrent(options.queryStore, recoveryGeneration)) return [];
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
    const candidateUrl = customUrl ?? defaultQueryRefetchUrl(query);
    if (!candidateUrl) {
      terminalRecovery = 'missing-href';
      break;
    }

    try {
      const request = admittedQueryRequest(candidateUrl, sourceUrl, queryRefetchSecurity);
      if (!request) throw new TypeError('Kovo refused an invalid typed-read request URL.');
      const response = (await queryRefetchSecurity.fetchWithOptionalSyncResult(
        fetchControl,
        undefined,
        request.fetchUrl,
        {
          cache: 'no-store',
          headers: {
            Accept: 'text/html',
            'Kovo-Build': expectedBuildToken,
            'Kovo-Fragment': 'true',
          },
          method: 'GET',
          redirect: 'error',
        },
      )) as QueryRefetchResponse;
      if (!queryRecoveryGenerationIsCurrent(options.queryStore, recoveryGeneration)) {
        discardQueryResponseBody(response, queryRefetchSecurity);
        return [];
      }

      // SPEC §9.4/§14: response headers gain recovery authority only at the exact typed-read URL.
      // A readable redirect must not forge a build-skew reload or become query truth.
      if (!queryResponseUrlIsAdmitted(response, request.expectedUrl, queryRefetchSecurity)) {
        discardQueryResponseBody(response, queryRefetchSecurity);
        selectInvalidResponseRecovery(
          new TypeError('Kovo refused a redirected or malformed typed-read response.'),
        );
        continue;
      }

      const ok = queryRefetchSecurity.readResponseField(response, 'ok');
      const status = queryRefetchSecurity.readResponseField(response, 'status');
      // SPEC §5.2.1/§14: after exact final-URL admission, a missing/foreign build is itself
      // terminal recovery authority. Content-Type cannot downgrade it into a background error.
      const responseBuildToken = queryRefetchSecurity.readHeader(response, 'Kovo-Build');
      if (responseBuildToken === undefined || responseBuildToken !== expectedBuildToken) {
        discardQueryResponseBody(response, queryRefetchSecurity);
        terminalRecovery = 'build-skew';
        continue;
      }
      const markedBuildSkew =
        status === 409 && queryRefetchSecurity.readHeader(response, 'Kovo-Build-Skew') === 'true';
      const expectedMediaType = markedBuildSkew ? 'text/vnd.kovo.fragment+html' : 'text/html';
      if (!queryResponseEnvelopeHasMediaType(response, expectedMediaType, queryRefetchSecurity)) {
        discardQueryResponseBody(response, queryRefetchSecurity);
        selectInvalidResponseRecovery(
          new TypeError('Kovo refused an attachment or malformed typed-read response.'),
        );
        continue;
      }

      if (
        // A stripped request header can make the current app reject with its own (therefore equal)
        // build token. Only the framework-reserved typed marker, exact 409 status, and admitted
        // fragment envelope distinguish that response from an ordinary query conflict (SPEC §14).
        responseBuildToken === expectedBuildToken &&
        markedBuildSkew
      ) {
        discardQueryResponseBody(response, queryRefetchSecurity);
        terminalRecovery = 'build-skew';
      } else if (status === 401 || status === 403) {
        // SPEC §9.4: an admitted auth denial revokes the old private query truth. The native
        // route reached by this recovery owns the eventual login redirect/forbidden document.
        // Fetch rejection remains an ordinary transport failure; never infer revocation from it.
        discardQueryResponseBody(response, queryRefetchSecurity);
        terminalRecovery = 'auth-denied';
      } else if (ok !== false && status === 200) {
        let responseBody: string;
        try {
          responseBody = await queryRefetchSecurity.readResponseTextOptionalSync(response);
        } catch (error) {
          discardQueryResponseBody(response, queryRefetchSecurity);
          throw error;
        }
        if (!queryRecoveryGenerationIsCurrent(options.queryStore, recoveryGeneration)) {
          discardQueryResponseBody(response, queryRefetchSecurity);
          return [];
        }
        const responseElement = readExactTypedQueryResponseElement(responseBody, query);
        let responseQuery: QueryChunk | undefined;
        let responseDecodeError: unknown;
        let responseDecodeFailed = false;
        try {
          responseQuery = responseElement
            ? readQueryElementChunk(responseElement, (error) => {
                if (responseDecodeFailed) return;
                responseDecodeFailed = true;
                responseDecodeError = error;
              })
            : undefined;
        } catch (error) {
          discardQueryResponseBody(response, queryRefetchSecurity);
          selectInvalidResponseRecovery(error);
          continue;
        }
        if (
          responseDecodeFailed ||
          !responseQuery ||
          responseQuery.delta === true ||
          !queryResponseHrefIsAdmitted(
            responseQuery.href,
            request.expectedUrl,
            queryRefetchSecurity,
          )
        ) {
          discardQueryResponseBody(response, queryRefetchSecurity);
          selectInvalidResponseRecovery(
            responseDecodeFailed
              ? responseDecodeError
              : new TypeError(
                  'Kovo refused typed-read truth outside the exact full-query response vocabulary.',
                ),
          );
          continue;
        }
        const reconciledQuery = reconcileTypedReadResponseHref(
          responseQuery,
          request.expectedUrl,
          stagedResponseHrefs,
          queryRefetchSecurity,
        );
        if (!reconciledQuery) {
          discardQueryResponseBody(response, queryRefetchSecurity);
          selectInvalidResponseRecovery(
            new TypeError('Kovo refused conflicting typed-read refetch metadata.'),
          );
          continue;
        }
        securityArrayAppend(
          bodies,
          { queries: [reconciledQuery] },
          'Browser typed-read response bodies',
        );
      } else {
        discardQueryResponseBody(response, queryRefetchSecurity);
      }
    } catch (error) {
      reportRuntimeError(onError, error);
    }
    if (terminalRecovery !== undefined) break;
  }

  if (terminalRecovery !== undefined) {
    if (terminalRecoveryLatched || latchQueryRecovery(options.queryStore, recoveryGeneration)) {
      try {
        if (terminalRecovery === 'build-skew') onBuildSkew();
        else if (terminalRecovery === 'auth-denied') onAuthDenied();
        else onDocumentRecovery();
      } catch (error) {
        reportRuntimeError(onError, error);
      }
    }
    return [];
  }

  if (!queryRecoveryGenerationIsCurrent(options.queryStore, recoveryGeneration)) return [];

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
  if (!queryRecoveryGenerationIsCurrent(options.queryStore, recoveryGeneration)) return [];
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

function queryRecoveryState(store: QueryStore): QueryRecoveryState {
  const existing = securityWeakMapGet(queryRecoveryStates, store);
  if (existing !== undefined) return existing;
  const created = freezeSecurityValue({ generation: 0, terminal: false });
  securityWeakMapSet(queryRecoveryStates, store, created);
  return created;
}

function queryRecoveryGenerationIsCurrent(store: QueryStore, generation: number): boolean {
  const state = securityWeakMapGet(queryRecoveryStates, store);
  return state !== undefined && state.terminal === false && state.generation === generation;
}

function latchQueryRecovery(store: QueryStore, generation: number): boolean {
  if (!queryRecoveryGenerationIsCurrent(store, generation)) return false;
  securityWeakMapSet(
    queryRecoveryStates,
    store,
    freezeSecurityValue({ generation: generation + 1, terminal: true }),
  );
  return true;
}

function queryResponseUrlIsAdmitted(
  response: QueryRefetchResponse,
  expectedUrl: string,
  security: QueryRefetchSecurity,
): boolean {
  const rawFinalUrl = security.readResponseField(response, 'url');
  const redirected = security.readResponseField(response, 'redirected');
  if (redirected !== false || typeof rawFinalUrl !== 'string' || rawFinalUrl === '') return false;
  const expected = security.parseUrl(expectedUrl);
  const final = security.parseUrl(rawFinalUrl);
  return (
    expected !== undefined &&
    final !== undefined &&
    expected.origin !== 'null' &&
    final.origin === expected.origin &&
    (final.protocol === 'http:' || final.protocol === 'https:') &&
    final.href === expected.href
  );
}

function discardQueryResponseBody(
  response: QueryRefetchResponse,
  security: QueryRefetchSecurity,
): void {
  const body = security.readResponseField(response, 'body');
  if (body === null || typeof body !== 'object') return;
  try {
    security.observePromiseRejection(security.cancelReadableStream(body));
  } catch {}
}

function admittedQueryRequest(
  candidate: string,
  sourceUrl: string | undefined,
  security: QueryRefetchSecurity,
): { readonly expectedUrl: string; readonly fetchUrl: string } | undefined {
  const current = security.currentUrl();
  if (sourceUrl === undefined) return undefined;
  const source = security.parseUrl(sourceUrl);
  const parsed = source ? security.parseUrl(candidate, source.href) : undefined;
  if (
    source === undefined ||
    parsed === undefined ||
    source.origin === 'null' ||
    (source.protocol !== 'http:' && source.protocol !== 'https:') ||
    (current !== undefined && (current.origin === 'null' || source.origin !== current.origin)) ||
    parsed.origin !== source.origin ||
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.hash !== '' ||
    security.indexOf(parsed.pathname, '/_q/') !== 0
  ) {
    return undefined;
  }
  return { expectedUrl: parsed.href, fetchUrl: parsed.href };
}

function queryResponseEnvelopeHasMediaType(
  response: QueryRefetchResponse,
  expectedMediaType: 'text/html' | 'text/vnd.kovo.fragment+html',
  security: QueryRefetchSecurity,
): boolean {
  const contentType = security.readHeader(response, 'Content-Type');
  if (
    typeof contentType !== 'string' ||
    security.indexOf(contentType, ',') >= 0 ||
    security.indexOf(contentType, '\r') >= 0 ||
    security.indexOf(contentType, '\n') >= 0 ||
    security.indexOf(contentType, '\0') >= 0
  ) {
    return false;
  }
  const separator = typeof contentType === 'string' ? security.indexOf(contentType, ';') : -1;
  const mediaType =
    typeof contentType === 'string'
      ? security.lower(
          security.trim(separator < 0 ? contentType : security.slice(contentType, 0, separator)),
        )
      : '';
  return (
    mediaType === expectedMediaType &&
    security.isInlineContentDisposition(security.readHeader(response, 'Content-Disposition'))
  );
}

function queryResponseHrefIsAdmitted(
  href: string | undefined,
  expectedUrl: string,
  security: QueryRefetchSecurity,
): boolean {
  if (href === undefined) return true;
  if (!frameworkWireIdentityIsValid(href) || href.length > 65_536) return false;
  const expected = security.parseUrl(expectedUrl);
  const parsed = expected ? security.parseUrl(href, expected.href) : undefined;
  return parsed !== undefined && parsed.href === expected?.href;
}

function reconcileTypedReadResponseHref(
  query: QueryChunk,
  expectedUrl: string,
  staged: Map<string, string>,
  security: QueryRefetchSecurity,
): QueryChunk | undefined {
  const href = query.href;
  if (href === undefined) return query;
  const identity = queryStoreKey(query.name, query.key);
  const retained = queryRefetchHref(query.name, query.key) ?? securityMapGet(staged, identity);
  if (retained === undefined) {
    securityMapSet(staged, identity, href);
    return query;
  }
  if (!queryResponseHrefIsAdmitted(retained, expectedUrl, security)) return undefined;
  securityMapSet(staged, identity, retained);
  return retained === href ? query : { ...query, href: retained };
}

/**
 * @internal Build the default `/_q/` refetch URL for a query wireKey (SPEC §9.4/§10.2, F5).
 * Returns only the framework-emitted canonical href snapshotted when this exact query identity was
 * hydrated/applied. Kovo cannot invert an app-authored `instanceKey` function: stripping a
 * name-shaped prefix aliases valid raw keys that begin with that prefix.
 */
function defaultQueryRefetchUrl(identity: QueryIdentity): string {
  return queryRefetchHref(identity.name, identity.key) ?? '';
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
