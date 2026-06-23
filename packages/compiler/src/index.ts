import { compileComponentModule } from './compile.js';
import { createKovoVitePlugin, type KovoVitePlugin, type KovoVitePluginOptions } from './vite.js';

export type { QueryPlanBootstrapInput, QueryPlanBootstrapOptions } from './emit/bootstrap.js';
export { emitQueryPlanBootstrapModule } from './emit/bootstrap.js';
export { classifyHmrImpact, createComponentHmrImpactMetadata } from './hmr-impact.js';
export type {
  AttributeMergeResult,
  MergeableAttribute,
  MergeableAttributeValue,
} from './lower/attribute-merge.js';
export { mergePrimitiveAndAuthorAttributes } from './lower/attribute-merge.js';
export type {
  KovoHmrEventName,
  KovoHmrEventPayload,
  KovoViteHotUpdateContext,
  KovoViteModuleFilter,
  KovoVitePlugin,
  KovoVitePluginOptions,
  KovoViteRegistryFactsSource,
  KovoViteWebSocket,
  KovoViteWebSocketPayload,
} from './vite.js';
export { deriveAppGraph } from './graph.js';
export { composePageComponentArtifacts } from './page-composition.js';
export { compileRouteModule } from './scan/route-pages.js';
export type {
  CompileComponentOptions,
  CompileResult,
  CompileRouteModuleOptions,
  CompileRouteModuleResult,
  HmrImpactClass,
  HmrImpactClassification,
  HmrImpactComponentFact,
  HmrImpactDiagnosticFact,
  HmrImpactMetadata,
  HmrImpactReason,
  HmrImpactStylesheetFact,
  RouteComponentImportRewrite,
  RoutePageComponentFact,
  RoutePageComponentPropFact,
  RoutePageFact,
} from './types.js';
export {
  assertFixpoint,
  assertProductionRenderPlanGate,
  assertRenderEquivalence,
  assertRenderPlanTokenMonotonicity,
  compileComponentModule,
  computeCompilerRenderPlanFingerprint,
  CompilerDiagnosticError,
  type AssertRenderPlanTokenMonotonicityOptions,
  type CompilerRenderPlanFingerprintInput,
} from './compile.js';

/**
 * The Kovo Vite plugin: lowers authored component modules through compileComponentModule
 * during `transform` and serves emitted client islands in dev. Add it to an app's
 * `vite.config` to compile components at build/dev time (SPEC.md §5.2). Public entry point
 * of `@kovojs/compiler`.
 */
export function kovoVitePlugin(options: KovoVitePluginOptions = {}): KovoVitePlugin {
  return createKovoVitePlugin(compileComponentModule, options);
}
