export type { CompilerDiagnostic, SourcePosition } from './diagnostics.js';
/** @internal Supported runners call this before evaluating app/plugin modules. */
export { assertCompilerSecurityIntrinsics } from './compiler-security-intrinsics.js';
export { snapshotCompileComponentOptions } from './compile-options.js';
/** @internal Framework runner that snapshots options and compiles without retained state. */
export { compileComponentModuleForFramework } from './framework-compile.js';
export type { PlatformSubstitution } from './lower/platform.js';
export { appGraphContributionHash } from './app-graph.js';
export { factHash } from './fact-hash.js';
export {
  analyzeCapabilityClosure,
  collectCapabilityPackageRequests,
  packageCapabilitySummarySchema,
} from './security/capability-closure.js';
export type {
  AnalyzeCapabilityClosureOptions,
  AnalyzeCapabilityClosureResult,
  CapabilityClosureSourceFile,
  CapabilityPackageRequest,
  CapabilityRootKind,
  PackageCapabilitySummary,
  PackageCapabilitySummaryEntry,
  PackageCapabilitySummaryExport,
  RawCapabilityKind,
  ResolvedCapabilityPackage,
} from './security/capability-closure.js';
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
  ProjectMutationBindingFact,
  PublishToClientFact,
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
export type { LocalMutationInputFact } from './scan/mutation-inputs.js';
export { mutationInputFactsFromSource } from './scan/mutation-inputs.js';
export type {
  ProjectMutationRegistryFacts,
  ProjectMutationSourceFile,
} from './scan/project-mutation-bindings.js';
export { projectMutationRegistryFactsFromFiles } from './scan/project-mutation-bindings.js';
export type {
  InlineOptimisticPlanFact,
  InlineOptimisticTransformFact,
} from './scan/optimistic-inline.js';
export {
  inlineOptimisticPlansFromSource,
  serializeInlineOptimisticPlanIr,
} from './scan/optimistic-inline.js';
export {
  allComponentOptionObjectEntries,
  mutationHandlerFingerprintFromRuntimeSource,
  mutationSessionAuthorityFacts,
  parseComponentModule,
} from './scan/parse.js';
export { queryExpressionFromBinding } from './scan/query-binding.js';
export { deriveRegistryIdentity } from './registry-identities.js';
export {
  createEmptyCompileResult,
  queryShapeFactDiagnostics,
  queryShapeRegistryTypeFacts,
  queryShapeTypeExpression,
  queryShapesFromFacts,
} from './types.js';
export {
  mergeQueryShapeFactSets,
  outputSchemaQueryShapeFactsFromProject,
  outputSchemaQueryShapeFactsFromSource,
} from './scan/query-shape-source.js';
export { collectMinifierReservedNames } from './compile.js';
export { lowerStandaloneSourceDerivedRegistryDeclarations } from './source-derived-lowering.js';
export { viteFrameworkIdentityFiles } from './vite.js';
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
