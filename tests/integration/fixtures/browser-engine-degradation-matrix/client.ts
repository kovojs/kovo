import {
  createQueryStore,
  DomMorphRoot,
  installKovoLoader,
  keyedDomMorph,
  type EnhancedMutationFetch,
  type MorphRoot,
  type TargetCollectorRoot,
} from '@kovojs/runtime';

declare global {
  interface Window {
    __engineMatrixReady?: boolean;
  }
}

const store = createQueryStore();
const root = Object.assign(new DomMorphRoot(document), {
  querySelectorAll: document.querySelectorAll.bind(document),
}) as MorphRoot & TargetCollectorRoot;
const enhancedFetch: EnhancedMutationFetch = (url, options) =>
  window.fetch(url, {
    body: options.body as BodyInit,
    headers: options.headers,
    keepalive: options.keepalive,
    method: options.method,
  });

installKovoLoader({
  enhancedMutations: {
    fetch: enhancedFetch,
    morph: keyedDomMorph,
    root,
    store,
  },
  importModule: (url) => import(/* @vite-ignore */ url),
  queryRefetch: { fetch: window.fetch.bind(window) },
  queryStore: store,
  root: document,
});

window.__engineMatrixReady = true;
