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
  RenderEquivalenceCheck,
  StateDeriveReferenceFact,
  ViewTransitionStamp,
} from './types.js';
export {
  createEmptyCompileResult,
  queryShapeFactDiagnostics,
  queryShapesFromFacts,
} from './types.js';
export { collectMinifierReservedNames } from './compile.js';
export type {
  KovoViteDevServer,
  KovoViteDiagnosticReporter,
  KovoViteMiddleware,
  KovoViteModuleDiagnosticReport,
  KovoViteModuleDiagnosticReporter,
} from './vite.js';
