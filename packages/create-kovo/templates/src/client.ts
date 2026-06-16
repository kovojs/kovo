import {
  applyDeferredStreamResponseToRuntime,
  createQueryStore,
  DomMorphTarget,
  installKovoLoader,
  type EnhancedMutationFetch,
  type MorphRoot,
  type TargetCollectorRoot,
} from '@kovojs/runtime';

const store = createQueryStore();
const queryPlans = {};
const root = createBrowserKovoRoot(document);

const enhancedFetch: EnhancedMutationFetch = (url, options) => {
  const init: RequestInit = {
    headers: options.headers,
    keepalive: options.keepalive,
    method: options.method,
  };

  if (options.body !== undefined) {
    init.body = options.body as BodyInit | null;
  }

  return fetch(url, init);
};

type BrowserKovoRoot = MorphRoot & TargetCollectorRoot;

type DeferredStreamOptions = {
  boundary?: string;
  morph?: Parameters<typeof applyDeferredStreamResponseToRuntime>[0]['morph'];
  root?: Parameters<typeof applyDeferredStreamResponseToRuntime>[0]['root'];
};

installKovoLoader({
  importModule: (specifier) => import(specifier),
  root: document,
  queryStore: store,
  enhancedMutations: {
    fetch: enhancedFetch,
    queryPlans,
    root,
    store,
  },
});

export function applyKovoDeferredStreamResponse(body: string, options: DeferredStreamOptions = {}) {
  return applyDeferredStreamResponseToRuntime({
    body,
    ...(options.boundary ? { boundary: options.boundary } : {}),
    ...(options.morph ? { morph: options.morph } : {}),
    queryPlans,
    root: options.root ?? root,
    store,
  });
}

function createBrowserKovoRoot(documentRoot: Document): BrowserKovoRoot {
  return {
    findFragmentTarget(target) {
      const element =
        documentRoot.getElementById(target) ??
        documentRoot.querySelector('[kovo-fragment-target="' + CSS.escape(target) + '"]');

      return element ? new DomMorphTarget(element) : null;
    },
    querySelectorAll(selector) {
      return documentRoot.querySelectorAll(selector);
    },
  };
}
