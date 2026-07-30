// Bundle entry for the immutable generated app runtime served from Kovo's `/c/` registry.
// Keep this facade on direct runtime modules: routing through the broad generated-authoring
// entry retains unrelated derive/source-construction initializers in every browser response.
export { applyDeferredStreamResponseToRuntime } from './apply-deferred-stream.js';
export { createBrowserKovoRoot, defaultEnhancedFetch } from './browser-root.js';
export { installInlineKovoLoader } from './inline-loader-runtime.js';
export { installGeneratedKovoLoader as installKovoLoader } from './loader.js';
export { createQueryStore } from './query-store.js';
