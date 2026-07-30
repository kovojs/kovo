// Bundle entry for the immutable generated app runtime served from Kovo's `/c/` registry.
// Keep this surface deliberately narrow: compiler-emitted app bootstraps import only these values.
export {
  applyDeferredStreamResponseToRuntime,
  createBrowserKovoRoot,
  createQueryStore,
  defaultEnhancedFetch,
  installInlineKovoLoader,
  installKovoLoader,
} from './generated.js';
