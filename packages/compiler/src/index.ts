import type { DiagnosticCode } from '@kovojs/core';

import { compileComponentModule } from './compile.js';
import { createKovoVitePlugin, type KovoVitePlugin, type KovoVitePluginOptions } from './vite.js';

export type { DiagnosticCode };
export type { CompilerDiagnostic, SourcePosition } from './diagnostics.js';
export type { QueryPlanBootstrapInput, QueryPlanBootstrapOptions } from './emit/bootstrap.js';
export { emitQueryPlanBootstrapModule } from './emit/bootstrap.js';
export type {
  KovoViteDevServer,
  KovoViteDiagnosticReporter,
  KovoViteMiddleware,
  KovoViteModuleDiagnosticReport,
  KovoViteModuleDiagnosticReporter,
  KovoVitePlugin,
  KovoVitePluginOptions,
} from './vite.js';
export type { PlatformSubstitution } from './lower/platform.js';
export type {
  AttributeMergeResult,
  MergeableAttribute,
  MergeableAttributeValue,
} from './lower/attribute-merge.js';
export { mergePrimitiveAndAuthorAttributes } from './lower/attribute-merge.js';
export { deriveAppGraph, deriveRegistryFactsFromGraph } from './graph.js';
export { composePageComponentArtifacts } from './page-composition.js';
export type {
  ComponentCssAsset,
  CssAsset,
  CssAssetManifest,
  CssAssetManifestOptions,
  CssAssetResolver,
  CssRenderTarget,
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
  assertFixpoint,
  assertRenderEquivalence,
  collectMinifierReservedNames,
  compileComponentModule,
} from './compile.js';
export {
  createEmptyCompileResult,
  queryShapeFactDiagnostics,
  queryShapesFromFacts,
} from './types.js';

/**
 * The Kovo Vite plugin: lowers authored component modules through compileComponentModule
 * during `transform` and serves emitted client islands in dev. Add it to an app's
 * `vite.config` to compile components at build/dev time (SPEC.md §5.2). Public entry point
 * of `@kovojs/compiler`.
 */
export function kovoVitePlugin(options: KovoVitePluginOptions = {}): KovoVitePlugin {
  return createKovoVitePlugin(compileComponentModule, options);
}
