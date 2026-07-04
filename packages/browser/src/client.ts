// Browser bootstrap surface (SPEC §§4.4, 9.1, 9.4). App entries name only the
// value helpers below; the exported types form the fully-public option surface
// `installKovoLoader` and `createBrowserKovoRoot` require (recursive publicness,
// rules/api-surface.md). Loader engine internals (morph apply, enhanced-mutation
// submit, the event bus, broadcast/queue, optimistic apply, submit context,
// inline-query/refetch, lifecycle) are `@internal` and no longer re-exported here.

// --- Value helpers an app entry installs ---
export { createBrowserKovoRoot, defaultEnhancedFetch } from './browser-root.js';
export { installKovoLoader } from './loader.js';
export { createQueryStore } from './query-store.js';

// --- Browser-root + loader option surface ---
export type { BrowserKovoRoot, CreateBrowserKovoRootOptions } from './browser-root.js';
export type { BrowserEnhancedMutationOptions, KovoLoader, KovoLoaderOptions } from './loader.js';
export type { QuerySnapshot, QueryStore, QueryUpdatePlan } from './query-store.js';

// --- Morph/target/fetch types named by the enhanced-mutation option surface ---
export type {
  EnhancedMutationFetch,
  EnhancedMutationFetchOptions,
  EnhancedMutationResponseLike,
  UploadProgress,
} from './mutation-fetch.js';
