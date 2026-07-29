import type { TargetCollectorRoot } from './mutation-targets.js';
import { DomMorphRoot, type MorphRoot } from './morph.js';
import type { FragmentTargetRoot } from './fragment-targets.js';
import type { EnhancedMutationFetch } from './mutation-fetch.js';
import { definedProps } from './defined-props.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';

const browserKovoRootBrand: unique symbol = Symbol('kovo.browser-root');
type BrowserKovoRuntimeRoot = BrowserKovoRoot & MorphRoot & TargetCollectorRoot;
// SPEC §6.6/§9.1: the framework default transport carries credentials and replay
// authority. Pin the platform fetch before any authored client module can replace it.
const browserRootSecurity = createBrowserNavigationSecurityControls();

/**
 * The browser root that `installKovoLoader` (and `applyKovoDeferredStreamResponse`)
 * operate on: the live-DOM fragment-target lookup and target collector the runtime
 * needs to apply mutation/stream fragments and collect `Kovo-Targets` (SPEC §9.1).
 *
 * Build it with {@link createBrowserKovoRoot} and treat the value as opaque; an
 * app entry hands it to the loader's `enhancedMutations.root` without naming the
 * low-level morph/target types.
 */
export interface BrowserKovoRoot {
  readonly [browserKovoRootBrand]: true;
}

/**
 * Options for {@link createBrowserKovoRoot}.
 */
export interface CreateBrowserKovoRootOptions {
  /**
   * The DOM root used for fragment-target lookup and target collection. Defaults
   * to the global `document`.
   */
  documentRoot?: ParentNode;
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
export const defaultEnhancedFetch: EnhancedMutationFetch = async (url, options) => {
  const init: RequestInit = {
    credentials: 'same-origin',
    headers: options.headers,
    keepalive: options.keepalive,
    method: options.method,
    redirect: options.redirect,
    referrerPolicy: options.referrerPolicy,
    ...definedProps({ signal: options.signal }),
  };

  if (options.body !== undefined) {
    init.body = options.body as BodyInit | null;
  }

  return (await browserRootSecurity.fetchValue(url, init)) as Awaited<
    ReturnType<EnhancedMutationFetch>
  >;
};

/**
 * Build the generated-runtime browser root: a live-DOM fragment-target lookup
 * plus target collector (SPEC §9.1). Compiler-emitted bootstraps consume this
 * through `@kovojs/browser/generated`; custom shells use `installKovoClient`,
 * which creates the adapter internally.
 *
 * @param options - Optional `documentRoot` (defaults to `document`).
 * @returns A generated-runtime {@link BrowserKovoRoot}.
 */
export function createBrowserKovoRoot(options: CreateBrowserKovoRootOptions = {}): BrowserKovoRoot {
  const documentRoot =
    options.documentRoot ?? (document as FragmentTargetRoot & TargetCollectorRoot);
  const runtimeRoot = documentRoot as FragmentTargetRoot & TargetCollectorRoot;
  const morphRoot = new DomMorphRoot(runtimeRoot);

  const root: BrowserKovoRuntimeRoot = {
    [browserKovoRootBrand]: true,
    findFragmentTarget(target) {
      return morphRoot.findFragmentTarget(target);
    },
    querySelectorAll(selector) {
      // SPEC §6.6/§9.1: live target and stream routing are security-bearing server-truth inputs.
      // Snapshot through the same boot-witnessed selector membrane as fragment application.
      return browserRootSecurity.queryAllElements(runtimeRoot, selector);
    },
  };
  return root;
}
