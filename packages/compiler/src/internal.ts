export type { CompilerDiagnostic, SourcePosition } from './diagnostics.js';
export type { PlatformSubstitution } from './lower/platform.js';
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
  createCssAssetResolver,
  dedupeCss,
  scopeComponentCss,
  selectCssAssets,
} from './css.js';
export type { GeneratedOutputWriteFact, OutputContext } from './output-context-facts.js';
export type {
  CompileArtifactFileNames,
  CompileComponentOptions,
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
  KovoViteWebSocket,
  KovoViteWebSocketPayload,
} from './vite.js';
