import { createQueryStore, installKovoLoader } from '@kovojs/runtime/client';

declare global {
  interface Window {
    __queryRefetchReady?: boolean;
  }
}

installKovoLoader({
  importModule: (url) => import(/* @vite-ignore */ url),
  queryRefetch: { fetch: window.fetch.bind(window) },
  queryStore: createQueryStore(),
  root: document,
});

window.__queryRefetchReady = true;
