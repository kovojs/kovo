export type { CompilerDiagnostic, SourcePosition } from './diagnostics.js';
export { compilerBuildId, type CompilerBuildIdInput } from './cache-identity.js';
export {
  CompileCache,
  compileCacheKey,
  compileComponentCacheKeyInput,
  type CompileCacheKeyInput,
} from './compile-cache.js';
export {
  persistentCompileCacheDir,
  readPersistentCompileCacheEntry,
  readPersistentCompileCacheManifest,
  writePersistentCompileCacheEntry,
  type PersistentCompileCacheEntry,
  type PersistentCompileCacheManifest,
} from './persistent-compile-cache.js';
export type { PlatformSubstitution } from './lower/platform.js';
export { appGraphContributionHash, IncrementalAppGraphCache } from './app-graph.js';
export { factHash } from './fact-hash.js';
export type {
  AttributeMergeResult,
  MergeableAttribute,
  MergeableAttributeValue,
} from './lower/attribute-merge.js';
export { mergePrimitiveAndAuthorAttributes } from './lower/attribute-merge.js';
export type {
  ComponentCssAsset,
  CssAsset,
  CssAssetManifest,
  CssAssetManifestOptions,
  CssAssetResolver,
  CssRouteByteAccounting,
  CssRouteDeliveryGateResult,
  CssRouteOvershipDiagnostic,
  CssRenderTarget,
  CssRouteSplitTarget,
  CssSplitChunks,
  CssSplitOptions,
  ScopedCssResult,
  ScopeComponentCssOptions,
  StyleRuleUsage,
} from './css.js';
export {
  collectCssAssetManifest,
  componentHostSelector,
  createCssAssetResolver,
  cssRouteByteAccounting,
  cssRouteDeliveryGate,
  cssRouteSplitTargetsFromRouteFacts,
  dedupeCss,
  scopeComponentCss,
  selectCssAssets,
} from './css.js';
export type { GeneratedOutputWriteFact, OutputContext } from './output-context-facts.js';
export type {
  CompileArtifactFileNames,
  CompileComponentOptions,
  CompileDependencyFootprint,
  CompileResult,
  ComponentGraphFact,
  EmittedFile,
  FragmentTargetFact,
  MutationInputFieldCoercion,
  MutationInputFieldFact,
  PackageComponentPrefixFact,
  QueryDeriveFact,
  RegistryFacts,
  RegistryGraphInput,
  RegistryTypeFactOptions,
  RegistryTypeFacts,
  QueryShape,
  QueryShapeFact,
  QueryShapeWrapper,
  QueryStampFact,
  QueryTemplateStampFact,
  QueryUpdateCoverageFact,
  QueryUpdatePlanFact,
  RegistryMutationInputFacts,
  RenderEquivalenceCheck,
  StateDeriveReferenceFact,
  ViewTransitionStamp,
} from './types.js';
export type { LocalMutationInputFact } from './mutation-inputs.js';
export { mutationInputFactsFromSource } from './mutation-inputs.js';
export type {
  InlineOptimisticPlanFact,
  InlineOptimisticTransformFact,
} from './scan/optimistic-inline.js';
export {
  inlineOptimisticPlansFromSource,
  serializeInlineOptimisticPlanIr,
} from './scan/optimistic-inline.js';
export {
  createEmptyCompileResult,
  queryShapeFactDiagnostics,
  queryShapesFromFacts,
} from './types.js';
export { collectMinifierReservedNames } from './compile.js';
export type {
  KovoHmrEventName,
  KovoHmrEventPayload,
  KovoViteDevServer,
  KovoViteDiagnosticReporter,
  KovoViteHotUpdateContext,
  KovoViteMiddleware,
  KovoViteModuleDiagnosticReport,
  KovoViteModuleDiagnosticReporter,
  KovoViteModuleFilter,
  KovoViteRegistryFactsSource,
  KovoViteWebSocket,
  KovoViteWebSocketPayload,
} from './vite.js';
