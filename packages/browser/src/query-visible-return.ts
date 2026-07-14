import { definedProps } from './defined-props.js';
import type {
  AttributeReaderLike,
  ListenerTargetLike,
  OptionalQuerySelectorAllRootLike,
  VisibilityStateLike,
} from './dom-like.js';
import { reportRuntimeError } from './error-policy.js';
import type { QueryApplyInterposition } from './query-apply.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import { deriveRefetchOnFocusOptOut, refetchQueries } from './query-refetch.js';
import type { QueryRefetchOptions, RefetchOnFocusDeclaration } from './query-refetch.js';
import { readPageBuildToken } from './build-token.js';
import { createQueryScriptHydrationLedger } from './query-script-hydration.js';
import type { QueryScriptLike } from './query-script-hydration.js';
import { splitQueryWireKey } from './query-store.js';
import type { QueryStore } from './query-store.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import { reloadSessionTransitionDocument } from './session-transition.js';
import {
  securityArrayAppend,
  securityOwnArrayEntry,
  securitySet,
  securitySetAdd,
  securitySetForEach,
  securitySetHas,
} from './security-witness-intrinsics.js';

// SPEC §6.6/§8: capture the bfcache revalidation getter while the framework
// module graph initializes, before authored client modules can replace realm
// intrinsics. The generated inline runtime owns an equivalent boot-local set.
const browserLifecycleSecurity =
  typeof document === 'undefined' ? undefined : createBrowserNavigationSecurityControls();

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
  /**
   * SPEC §9.3/§9.4: declared queries whose `refetchOnFocus: false` opt-out drives the runtime
   * exclusion set. The declared opt-out (derived via {@link deriveRefetchOnFocusOptOut}) is unioned
   * with any explicit {@link refetchOnFocusOptOut}, so an app author opting a query out at the
   * `@kovojs/core` `queryRef(key, { refetchOnFocus: false })` declaration site actually excludes it
   * from focus refetch.
   */
  declaredQueries?: readonly RefetchOnFocusDeclaration[];
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
  const queries = securitySet<string>();

  const remember = (nextQueries: readonly string[]): void => {
    for (let index = 0; index < nextQueries.length; index += 1) {
      const entry = securityOwnArrayEntry(nextQueries, index);
      if (!entry.ok || typeof entry.value !== 'string') {
        throw new TypeError('Kovo visible-return query ledger requires dense string facts.');
      }
      securitySetAdd(queries, entry.value);
    }
  };

  remember(initialQueries);

  return {
    eligible(optOut: readonly string[] = []): readonly string[] {
      const excluded = securitySet<string>();
      for (let index = 0; index < optOut.length; index += 1) {
        const entry = securityOwnArrayEntry(optOut, index);
        if (!entry.ok || typeof entry.value !== 'string') {
          throw new TypeError('Kovo visible-return opt-out list requires dense string facts.');
        }
        securitySetAdd(excluded, entry.value);
      }
      const eligible: string[] = [];

      securitySetForEach(queries, (query) => {
        // SPEC §9.3/§9.4: the declared `refetchOnFocus: false` opt-out is per query NAME
        // (typed reads dispatch `/_q/` by name), so a keyed query's every instance key is
        // excluded when its name is opted out. Exact wire-key entries still match too.
        const { name } = splitQueryWireKey(query);
        if (!securitySetHas(excluded, query) && !securitySetHas(excluded, name)) {
          securityArrayAppend(eligible, query, 'Browser visible-return eligible query facts');
        }
      });

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
  return browserLifecycleSecurity
    ? (browserLifecycleSecurity.queryAllElements(root, 'script[kovo-query]') as QueryScriptLike[])
    : ((root.querySelectorAll?.('script[kovo-query]') ?? []) as Iterable<QueryScriptLike>);
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

  // SPEC §9.3/§9.4: the runtime opt-out is the union of any explicit `refetchOnFocusOptOut` and
  // the set derived from declared `refetchOnFocus: false` queries, so the declarative opt-out at
  // the `queryRef(key, { refetchOnFocus: false })` site actually drives focus-refetch behavior.
  const refetchOnFocusOptOut: string[] = [];
  appendDenseStrings(
    refetchOnFocusOptOut,
    options.refetchOnFocusOptOut ?? [],
    'Browser visible-return explicit opt-out facts',
  );
  appendDenseStrings(
    refetchOnFocusOptOut,
    deriveRefetchOnFocusOptOut(options.declaredQueries ?? []),
    'Browser visible-return declared opt-out facts',
  );

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
    const queries = ledger.eligible(refetchOnFocusOptOut);
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
        ...definedProps({
          expectedBuildToken: options.queryRefetch.expectedBuildToken ?? readPageBuildToken(),
        }),
        ...definedProps({
          applyQuery: options.applyQuery,
          queryPlans: options.queryPlans,
          root: options.root,
        }),
        queries,
        queryStore: options.queryStore,
      });
      const appliedQueries: string[] = [];
      for (let index = 0; index < applied.length; index += 1) {
        const result = securityOwnArrayEntry(applied, index);
        if (!result.ok) throw new TypeError('Kovo typed-read results must be dense.');
        appendDenseStrings(
          appliedQueries,
          result.value.queries,
          'Browser visible-return applied query facts',
        );
      }
      ledger.remember(appliedQueries);
    }
  };
  const refetchOnce = () => {
    refetchInFlight ??= (async () => {
      try {
        await refetchOnVisibleReturn();
      } finally {
        refetchInFlight = undefined;
      }
    })();
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
  addVisibleReturnListener(options.root, 'visibilitychange', listener);
  addVisibleReturnListener(options.root, 'pageshow', listener);
  if (pageShowTarget) addVisibleReturnListener(pageShowTarget, 'pageshow', listener);

  return {
    dispose() {
      disposed = true;
      removeVisibleReturnListener(options.root, 'visibilitychange', listener);
      removeVisibleReturnListener(options.root, 'pageshow', listener);
      if (pageShowTarget) removeVisibleReturnListener(pageShowTarget, 'pageshow', listener);
    },
    rememberAppliedQueries(queries) {
      if (disposed) return;
      ledger.remember(queries);
    },
  };
}

function addVisibleReturnListener(
  target: ListenerTargetLike<unknown>,
  type: string,
  listener: (event: unknown) => void,
): void {
  if (browserLifecycleSecurity) {
    if (!browserLifecycleSecurity.addLifecycleEventListener(target, type, listener)) {
      throw new TypeError('Kovo visible-return revalidation listener enrollment failed.');
    }
    return;
  }
  target.addEventListener(type, listener);
}

function removeVisibleReturnListener(
  target: ListenerTargetLike<unknown>,
  type: string,
  listener: (event: unknown) => void,
): void {
  if (browserLifecycleSecurity) {
    browserLifecycleSecurity.removeLifecycleEventListener(target, type, listener);
    return;
  }
  target.removeEventListener?.(type, listener);
}

function appendDenseStrings(target: string[], source: readonly string[], label: string): void {
  for (let index = 0; index < source.length; index += 1) {
    const entry = securityOwnArrayEntry(source, index);
    if (!entry.ok || typeof entry.value !== 'string') {
      throw new TypeError(`${label} must be a dense string array.`);
    }
    securityArrayAppend(target, entry.value, label);
  }
}

function globalPageShowTarget(
  root: QueryVisibleReturnRefetchRoot,
): ListenerTargetLike<unknown> | undefined {
  const target = globalThis as unknown as ListenerTargetLike<unknown>;
  return target !== root && typeof target.addEventListener === 'function' ? target : undefined;
}

/** The `querySelector` slice used to detect the non-secret session-dependent posture meta. */
interface SessionMetaDocumentLike {
  querySelector(selector: string): AttributeReaderLike | null;
}

/**
 * Options for {@link installBfcacheSessionReload}. All are injectable for tests; in the browser
 * they default to the ambient `document`, `globalThis` (the `pageshow` Window event target), and
 * `globalThis.location.reload()`.
 */
export interface BfcacheSessionReloadOptions {
  /**
   * SPEC §8: the document used to detect the `kovo-session-dependent` posture meta that
   * `document-core` stamps for guarded, resolved-session, and unresolved-session documents
   * (`packages/server/src/document-core.ts`). Defaults to the ambient `document`.
   */
  document?: SessionMetaDocumentLike;
  /** The `pageshow` lifecycle event target (a Window event). Defaults to `globalThis`. */
  pageShowTarget?: ListenerTargetLike<unknown>;
  /** The full server reload performed on a persisted restore. Defaults to `globalThis.location.reload()`. */
  reload?: () => void;
  /** @internal Injectable persisted-event reader for non-browser conformance tests. */
  readPageTransitionPersisted?: (event: unknown) => boolean;
}

/** A running bfcache session-reload guard; `dispose` removes the `pageshow` listener. */
export interface InstalledBfcacheSessionReload {
  dispose(): void;
}

/**
 * SPEC §780: the second bfcache defense. A bfcache restore is a history traversal that bypasses
 * the loader, `sessionProvider` (§6.5), and the route guard, so a persisted authenticated document
 * would otherwise reappear after logout, expiry, or revocation. `Cache-Control: no-store` (stamped
 * by `document-core`) is the first defense, but some user agents (Safari/WebKit) still keep a
 * `no-store` page in the in-memory bfcache. So the loader registers a `pageshow` handler that, when
 * `event.persisted === true` and the document is session-dependent, revalidates by reloading from
 * the server (a full GET that re-runs `sessionProvider` and the guard) rather than presenting the
 * restored DOM of the prior principal.
 *
 * Session-dependence is read from the non-secret `kovo-session-dependent` posture meta. It is
 * deliberately separate from the principal fingerprint because unresolved session carriers must
 * also revalidate after bfcache restore. Anonymous/exportable documents carry no marker and stay
 * fully bfcache-eligible. This adds no `unload` handler (SPEC §8).
 */
export function installBfcacheSessionReload(
  options: BfcacheSessionReloadOptions = {},
): InstalledBfcacheSessionReload {
  const sessionMetaDocument = options.document ?? globalSessionMetaDocument();
  const sessionDependent =
    sessionMetaDocument !== undefined &&
    (browserLifecycleSecurity
      ? browserLifecycleSecurity.queryOne(
          sessionMetaDocument,
          'meta[name="kovo-session-dependent"]',
        ) !== null
      : sessionMetaDocument.querySelector('meta[name="kovo-session-dependent"]') !== null);
  const pageShowTarget = options.pageShowTarget ?? globalEventTarget();
  const reload = options.reload ?? globalLocationReload();
  const readPageTransitionPersisted =
    options.readPageTransitionPersisted ??
    browserLifecycleSecurity?.readPageTransitionPersisted ??
    readNonBrowserPageTransitionPersisted;

  // SPEC §8: anonymous/exportable documents carry no session-dependent posture, so the handler is
  // a no-op and the page remains fully bfcache-eligible.
  if (!sessionDependent || !pageShowTarget || !reload) {
    return { dispose() {} };
  }

  let disposed = false;
  const listener = (event: unknown): void => {
    if (disposed) return;
    // SPEC §780: only a persisted restore bypassed the network/guard. A normal (non-persisted)
    // navigation already ran the loader and `sessionProvider`, so it is left untouched.
    if (!readPageTransitionPersisted(event)) return;
    reload();
  };
  if (browserLifecycleSecurity) {
    if (!browserLifecycleSecurity.addLifecycleEventListener(pageShowTarget, 'pageshow', listener)) {
      throw new TypeError('Kovo bfcache session guard could not enroll its pageshow listener.');
    }
  } else {
    pageShowTarget.addEventListener('pageshow', listener);
  }

  return {
    dispose() {
      disposed = true;
      if (browserLifecycleSecurity) {
        browserLifecycleSecurity.removeLifecycleEventListener(pageShowTarget, 'pageshow', listener);
      } else {
        pageShowTarget.removeEventListener?.('pageshow', listener);
      }
    },
  };
}

function readNonBrowserPageTransitionPersisted(event: unknown): boolean {
  // This fallback is unreachable in a browser build. Keep injected/fake event
  // tests honest without dispatching through a mutable inherited getter, and
  // fail closed toward revalidation when the carrier is malformed.
  if (event === null || typeof event !== 'object') return true;
  const descriptor = Object.getOwnPropertyDescriptor(event, 'persisted');
  return !descriptor || !('value' in descriptor) || descriptor.value !== false;
}

function globalSessionMetaDocument(): SessionMetaDocumentLike | undefined {
  const doc = (globalThis as { document?: SessionMetaDocumentLike }).document;
  if (doc === undefined) return undefined;
  // In a real browser the boot-witnessed query control owns this read. Do not consult a mutable
  // late `Document.prototype.querySelector` merely to decide whether the document is available.
  return browserLifecycleSecurity ? doc : typeof doc.querySelector === 'function' ? doc : undefined;
}

function globalEventTarget(): ListenerTargetLike<unknown> | undefined {
  const target = globalThis as unknown as ListenerTargetLike<unknown>;
  // Same rule as the document: a browser Window is enrolled through the captured EventTarget
  // control, while structural non-browser seams retain the old capability check.
  return browserLifecycleSecurity || typeof target.addEventListener === 'function'
    ? target
    : undefined;
}

function globalLocationReload(): (() => void) | undefined {
  const location = (globalThis as { location?: unknown }).location;
  return location === undefined ? undefined : () => void reloadSessionTransitionDocument();
}
