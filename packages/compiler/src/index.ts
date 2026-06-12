import type { DiagnosticCode } from '@jiso/core';

import { compileComponentModule } from './compile.js';
import { createJisoVitePlugin, type JisoVitePlugin, type JisoVitePluginOptions } from './vite.js';

export type { DiagnosticCode };
export type { CompilerDiagnostic, SourcePosition } from './diagnostics.js';
export type { QueryPlanBootstrapInput, QueryPlanBootstrapOptions } from './emit/bootstrap.js';
export { emitQueryPlanBootstrapModule } from './emit/bootstrap.js';
export type {
  JisoViteDevServer,
  JisoViteDiagnosticReporter,
  JisoViteMiddleware,
  JisoViteModuleDiagnosticReport,
  JisoViteModuleDiagnosticReporter,
  JisoVitePlugin,
  JisoVitePluginOptions,
} from './vite.js';
export type { PlatformSubstitution } from './lower/platform.js';
export { deriveAppGraph, deriveRegistryFactsFromGraph } from './graph.js';
export type {
  ComponentCssAsset,
  CssAsset,
  CssAssetManifest,
  CssAssetManifestOptions,
  ScopedCssResult,
  ScopeComponentCssOptions,
} from './css.js';
export { collectCssAssetManifest, dedupeCss, scopeComponentCss, selectCssAssets } from './css.js';
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
  ViewTransitionStamp,
} from './types.js';
export {
  assertFixpoint,
  assertRenderEquivalence,
  collectMinifierReservedNames,
  compileComponentModule,
} from './compile.js';
export { createEmptyCompileResult, queryShapesFromFacts } from './types.js';

export function jisoVitePlugin(options: JisoVitePluginOptions = {}): JisoVitePlugin {
  return createJisoVitePlugin(compileComponentModule, options);
}
