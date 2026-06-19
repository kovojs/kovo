import {
  createBrowserKovoRoot,
  createQueryStore,
  defaultEnhancedFetch,
  installKovoLoader,
} from '@kovojs/browser/client';
import { applyDeferredStreamResponseToRuntime } from '@kovojs/browser/generated';

const store = createQueryStore();
const queryPlans = {};
const root = createBrowserKovoRoot();

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
    fetch: defaultEnhancedFetch,
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
