// @ts-nocheck -- migration refusal input intentionally imports removed assembly helpers.
import { createQueryStore, defaultEnhancedFetch, installKovoLoader } from '@kovojs/browser/client';

const store = createQueryStore();
installKovoLoader({
  allowedClientModuleUrls: ['/c/manually-selected.js'],
  enhancedMutations: {
    fetch: defaultEnhancedFetch,
    store,
  },
  importModule: (url) => import(url),
  queryStore: store,
  root: document,
});
