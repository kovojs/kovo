import type { TargetCollectorRoot } from './mutation-targets.js';
import { DomMorphRoot, type MorphRoot } from './morph.js';
import type { FragmentTargetRoot } from './fragment-targets.js';
import type { EnhancedMutationFetch } from './mutation-fetch.js';
import { definedProps } from './defined-props.js';

/**
 * The browser root that `installKovoLoader` (and `applyKovoDeferredStreamResponse`)
 * operate on: the live-DOM fragment-target lookup and target collector the runtime
 * needs to apply mutation/stream fragments and collect `Kovo-Targets` (SPEC §9.1).
 *
 * Build it with {@link createBrowserKovoRoot} and treat the value as opaque; an
 * app entry hands it to the loader's `enhancedMutations.root` without naming the
 * low-level morph/target types.
 */
export interface BrowserKovoRoot extends MorphRoot, TargetCollectorRoot {}

/**
 * Options for {@link createBrowserKovoRoot}.
 */
export interface CreateBrowserKovoRootOptions {
  /**
   * The DOM root used for fragment-target lookup and target collection. Defaults
   * to the global `document`.
   */
  documentRoot?: FragmentTargetRoot & TargetCollectorRoot;
}

/**
 * The default enhanced-mutation fetch: a thin adapter over the platform `fetch`
 * that forwards the request method, headers, keepalive flag, and body (SPEC §9.1).
 * Pass it (or a wrapper over it) as the loader's `enhancedMutations.fetch`.
 *
 * @param url - The mutation endpoint URL.
 * @param options - The method, headers, keepalive flag, and serialized body.
 * @returns The fetch `Response`.
 */
export const defaultEnhancedFetch: EnhancedMutationFetch = (url, options) => {
  const init: RequestInit = {
    headers: options.headers,
    keepalive: options.keepalive,
    method: options.method,
    ...definedProps({ signal: options.signal }),
  };

  if (options.body !== undefined) {
    init.body = options.body as BodyInit | null;
  }

  return fetch(url, init);
};

/**
 * Build the browser root that `installKovoLoader` and
 * `applyKovoDeferredStreamResponse` consume: a live-DOM fragment-target lookup
 * plus target collector (SPEC §9.1). This is the single helper an app entry needs
 * to wire the runtime root; it replaces hand-building the low-level morph/target
 * objects. Pair it with {@link defaultEnhancedFetch} for the mutation `fetch`.
 *
 * @param options - Optional `documentRoot` (defaults to `document`).
 * @returns A {@link BrowserKovoRoot} to pass as the loader/stream `root`.
 * @example
 * import {
 *   createBrowserKovoRoot,
 *   createQueryStore,
 *   defaultEnhancedFetch,
 *   installKovoLoader,
 * } from '@kovojs/browser/client';
 *
 * const store = createQueryStore();
 * const root = createBrowserKovoRoot();
 *
 * installKovoLoader({
 *   importModule: (specifier) => import(specifier),
 *   root: document,
 *   queryStore: store,
 *   enhancedMutations: { fetch: defaultEnhancedFetch, queryPlans: {}, root, store },
 * });
 */
export function createBrowserKovoRoot(options: CreateBrowserKovoRootOptions = {}): BrowserKovoRoot {
  const documentRoot =
    options.documentRoot ?? (document as FragmentTargetRoot & TargetCollectorRoot);
  const morphRoot = new DomMorphRoot(documentRoot);

  return {
    findFragmentTarget(target) {
      return morphRoot.findFragmentTarget(target);
    },
    querySelectorAll(selector) {
      return documentRoot.querySelectorAll(selector);
    },
  };
}
