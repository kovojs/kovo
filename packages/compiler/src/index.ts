import type { DiagnosticCode } from '@jiso/core';

import { componentCssAssetForFile, emitCssModule, type ComponentCssAsset } from './css.js';
import type { CompilerDiagnostic } from './diagnostics.js';
import { emitClientModule } from './emit/client.js';
import { emitRegistryModule } from './emit/registry.js';
import { emitServerModule, renderEquivalenceCheck, serverRenderSource } from './emit/server.js';
import {
  componentGraphFact,
  findFragmentTargetFacts,
  type ComponentGraphFact,
  type RegistryFacts,
} from './graph.js';
import {
  clientModuleUrl,
  clientModuleVersion,
  lowerEventHandlers,
  versionHandlerLowering,
} from './lower/handlers.js';
import { lowerInlineAttributeDerives } from './lower/inline-derives.js';
import { lowerNavigationSugar } from './lower/navigation.js';
import { lowerPlatformBehaviors, type PlatformSubstitution } from './lower/platform.js';
import { lowerViewTransitions } from './lower/view-transitions.js';
import {
  firstComponentModel,
  type ComponentModuleModel,
  parseComponentModule as parseComponentModuleModel,
} from './scan/parse.js';
import { replaceExtension } from './shared.js';
import {
  collectQueryUpdateCoverage,
  collectQueryUpdatePlans,
  validateDataBindings,
  validateStampExpressionDrift,
} from './validate/bindings.js';
import {
  unhandledUpdateCoverageDiagnostics,
  validateDirectDbAccess,
  validateEventPayloads,
  validateFragmentTargetChildren,
  validateFragmentTargetInputs,
  validateServerFactsInLocalState,
} from './validate/component-contracts.js';
import { validateEventTriggerNames } from './validate/event-triggers.js';
import {
  validateAttributeMergeConflicts,
  validateHtmlContentModel,
  validateIdrefs,
  validateResidualStamps,
  validateStaticIds,
} from './validate/markup.js';
import { validateLiteralHrefs } from './validate/navigation.js';
import {
  validatePackageComponentPrefixes,
  type PackageComponentPrefixFact,
} from './validate/package-prefixes.js';
import { createJisoVitePlugin, type JisoVitePlugin } from './vite.js';

export type { DiagnosticCode };
export type { CompilerDiagnostic, SourcePosition } from './diagnostics.js';
export type { QueryPlanBootstrapInput, QueryPlanBootstrapOptions } from './emit/bootstrap.js';
export { emitQueryPlanBootstrapModule } from './emit/bootstrap.js';
export type { JisoViteDevServer, JisoViteMiddleware, JisoVitePlugin } from './vite.js';
export type { PlatformSubstitution } from './lower/platform.js';
export type {
  CompileAppGraphOptions,
  CompileAppGraphResult,
  ComponentGraphFact,
  RegistryFacts,
  RegistryGraphInput,
  RegistryTypeFactOptions,
  RegistryTypeFacts,
} from './graph.js';
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
export type { PackageComponentPrefixFact } from './validate/package-prefixes.js';

export interface EmittedFile {
  fileName: string;
  kind: 'client' | 'css' | 'registry' | 'server';
  source: string;
}

export interface CompileResult {
  componentGraphFacts: readonly ComponentGraphFact[];
  cssAssets: readonly ComponentCssAsset[];
  diagnostics: readonly CompilerDiagnostic[];
  files: readonly EmittedFile[];
  handlerExports: readonly string[];
  platformSubstitutions: readonly PlatformSubstitution[];
  queryUpdatePlans: readonly QueryUpdatePlanFact[];
  renderEquivalenceChecks: readonly RenderEquivalenceCheck[];
  updateCoverage: readonly QueryUpdateCoverageFact[];
  viewTransitions: ViewTransitionStamp[];
}

export interface RenderEquivalenceCheck {
  actual: string;
  artifact: string;
  expected: string;
  ok: boolean;
}

export interface QueryUpdatePlanFact {
  componentName: string;
  derives?: readonly QueryDeriveFact[];
  paths: readonly string[];
  query: string;
  stamps?: readonly QueryStampFact[];
  templateStamps?: readonly QueryTemplateStampFact[];
}

export interface QueryDeriveFact {
  expression: string;
  exportName: string;
  input: string;
  name: string;
  param: string;
  selector: string;
}

export interface QueryStampFact {
  attr: string;
  derive: QueryDeriveFact;
  selector: string;
}

export interface QueryTemplateStampFact {
  itemBindings: readonly string[];
  key: string;
  list: string;
  selector: string;
  template: string;
}

export interface QueryUpdateCoverageFact {
  componentName: string;
  detail?: string;
  position: string;
  query: string;
  status: 'UNHANDLED' | 'fragment' | 'isomorphic' | 'plan' | 'renderOnce';
}

export function createEmptyCompileResult(): CompileResult {
  return {
    componentGraphFacts: [],
    cssAssets: [],
    diagnostics: [],
    files: [],
    handlerExports: [],
    platformSubstitutions: [],
    queryUpdatePlans: [],
    renderEquivalenceChecks: [],
    updateCoverage: [],
    viewTransitions: [],
  };
}

export interface CompileComponentOptions {
  fileName: string;
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[];
  queryShapeFacts?: readonly QueryShapeFact[];
  queryShapes?: Record<string, QueryShape>;
  registryFacts?: RegistryFacts;
  source: string;
}

export type QueryShape =
  | 'array'
  | 'boolean'
  | 'number'
  | 'object'
  | 'string'
  | QueryShapeWrapper
  | readonly QueryShape[]
  | {
      readonly [key: string]: QueryShape;
    };

export interface QueryShapeWrapper {
  kind: 'nullable' | 'optional';
  shape: QueryShape;
}

export interface QueryShapeFact {
  query: string;
  shape: QueryShape;
  source: string;
}

export interface ViewTransitionStamp {
  name: string;
}

interface ValidatorContext {
  componentName: string;
  model: ComponentModuleModel;
  options: CompileComponentOptions;
  originalModel: ComponentModuleModel;
  source: string;
  updateCoverage: readonly QueryUpdateCoverageFact[];
}

type CompilerValidator = (context: ValidatorContext) => readonly CompilerDiagnostic[];

const irHeader = '// @jiso-ir';
const cssIrHeader = '/* @jiso-ir */';

const compilerValidators: readonly CompilerValidator[] = [
  ({ model, options, source }) => validateServerFactsInLocalState(source, model, options.fileName),
  ({ model, options, source }) => validateFragmentTargetInputs(source, model, options.fileName),
  ({ model, options, source }) => validateFragmentTargetChildren(source, model, options.fileName),
  ({ model, options, source }) => validateDataBindings(source, model, options),
  ({ options, originalModel }) =>
    validateStampExpressionDrift(options.source, originalModel, options),
  ({ model, options, source }) => validateEventPayloads(source, model, options),
  ({ model, options, source }) => validateDirectDbAccess(source, model, options.fileName),
  ({ options, originalModel }) => validateIdrefs(options.source, originalModel, options.fileName),
  ({ model, options, source }) => validateStaticIds(source, model, options.fileName),
  ({ options, source }) => validateLiteralHrefs(source, options),
  ({ model, options, source }) => validateHtmlContentModel(source, model, options.fileName),
  ({ model, options, source }) => validateEventTriggerNames(source, model, options.fileName),
  ({ componentName, model, options, source }) =>
    validateResidualStamps(source, model, options, componentName),
  ({ model, options, source }) => validateAttributeMergeConflicts(source, model, options.fileName),
  ({ options, source, updateCoverage }) =>
    unhandledUpdateCoverageDiagnostics(source, options.fileName, updateCoverage),
];

export function compileComponentModule(options: CompileComponentOptions): CompileResult {
  if (isIr(options.source)) {
    return {
      ...createEmptyCompileResult(),
      files: [
        {
          fileName: options.fileName,
          kind: emittedFileKind(options.fileName),
          source: options.source,
        },
      ],
    };
  }

  const originalModel = parseComponentModuleModel(options.fileName, options.source);
  const componentName = inferComponentName(options, originalModel);
  const viewTransitionLowering = lowerViewTransitions(options.source);
  const platformLowering = lowerPlatformBehaviors(viewTransitionLowering.source);
  const navigationLowering = lowerNavigationSugar(platformLowering.source);
  const deriveLowering = lowerInlineAttributeDerives(
    navigationLowering.source,
    componentName,
    options,
  );
  const source = deriveLowering.source;
  const model = parseComponentModuleModel(options.fileName, source);
  const handlers = lowerEventHandlers({ ...options, source }, componentName);
  const queryUpdatePlans = collectQueryUpdatePlans(source, model, componentName);
  const updateCoverage = collectQueryUpdateCoverage(source, model, options, componentName);
  const packagePrefixDiagnostics = validatePackageComponentPrefixes(
    options.packageComponentPrefixes,
    options.fileName,
  );
  const validationDiagnostics = compilerValidators.flatMap((validator) =>
    validator({ componentName, model, options, originalModel, source, updateCoverage }),
  );
  const clientFileName = replaceExtension(options.fileName, '.client.js');
  const cssFileName = replaceExtension(options.fileName, '.css');
  const serverFileName = replaceExtension(options.fileName, '.server.js');
  const registryFileName = 'generated/registries.d.ts';

  const clientSource = emitClientModule(handlers, queryUpdatePlans, componentName, irHeader);
  const clientHref = clientModuleUrl(options.fileName, clientModuleVersion(clientSource));
  const versionedHandlers = handlers.map((handler) =>
    versionHandlerLowering(handler, options.fileName, clientHref),
  );
  const cssSource = emitCssModule(source, componentName);
  const fragmentTargetFacts = findFragmentTargetFacts(source, componentName);
  const fragmentTargets = fragmentTargetFacts.map((fact) => fact.target);
  const componentGraphFacts = [componentGraphFact(componentName, model, fragmentTargets)];
  const cssAssets = cssSource
    ? [componentCssAssetForFile(cssFileName, componentName, fragmentTargets, {}, cssSource)]
    : [];
  const serverSource = emitServerModule(source, versionedHandlers);
  const serverRenderedSource = serverRenderSource(source, versionedHandlers);
  const registrySource = emitRegistryModule({
    clientFileName,
    cssAssets,
    componentName,
    fragmentTargetFacts,
    handlers: versionedHandlers,
    platformSubstitutions: platformLowering.substitutions,
    queryUpdatePlans,
    ...(options.registryFacts ? { registryFacts: options.registryFacts } : {}),
    viewTransitions: viewTransitionLowering.stamps,
  });

  return {
    componentGraphFacts,
    diagnostics: [
      ...versionedHandlers.flatMap((handler) => (handler.diagnostic ? [handler.diagnostic] : [])),
      ...packagePrefixDiagnostics,
      ...validationDiagnostics,
    ],
    files: [
      { fileName: serverFileName, kind: 'server', source: serverSource },
      { fileName: clientFileName, kind: 'client', source: clientSource },
      ...(cssSource ? [{ fileName: cssFileName, kind: 'css' as const, source: cssSource }] : []),
      { fileName: registryFileName, kind: 'registry', source: registrySource },
    ],
    handlerExports: versionedHandlers.map((handler) => handler.exportName),
    cssAssets,
    platformSubstitutions: platformLowering.substitutions,
    queryUpdatePlans,
    renderEquivalenceChecks: [
      renderEquivalenceCheck(serverFileName, serverRenderedSource, serverSource),
    ],
    updateCoverage,
    viewTransitions: viewTransitionLowering.stamps,
  };
}

export function assertFixpoint(result: CompileResult): void {
  for (const file of result.files) {
    const recompiled = compileComponentModule(file);
    const sameFile =
      recompiled.files.length === 1 &&
      recompiled.files[0]?.fileName === file.fileName &&
      recompiled.files[0]?.kind === file.kind &&
      recompiled.files[0]?.source === file.source;

    if (!sameFile) {
      throw new Error(`Fixpoint failed for ${file.fileName}`);
    }
  }
}

export function assertRenderEquivalence(result: CompileResult): void {
  for (const check of result.renderEquivalenceChecks) {
    if (!check.ok) {
      throw new Error(`Render equivalence failed for ${check.artifact}`);
    }
  }
}

export function queryShapesFromFacts(facts: readonly QueryShapeFact[]): Record<string, QueryShape> {
  return Object.fromEntries(facts.map((fact) => [fact.query, fact.shape]));
}

export function collectMinifierReservedNames(
  results: CompileResult | readonly CompileResult[],
): string[] {
  const reserved = new Set<string>();
  const items = Array.isArray(results) ? results : [results];

  for (const result of items) {
    for (const exportName of result.handlerExports) reserved.add(exportName);
  }

  return [...reserved].sort();
}

export function jisoVitePlugin(): JisoVitePlugin {
  return createJisoVitePlugin(compileComponentModule);
}

function emittedFileKind(fileName: string): EmittedFile['kind'] {
  if (fileName.endsWith('.client.js')) return 'client';
  if (fileName.endsWith('.css')) return 'css';
  if (fileName.endsWith('.server.js')) return 'server';
  return 'registry';
}

function isIr(source: string): boolean {
  return source.startsWith(irHeader) || source.startsWith(cssIrHeader);
}

function inferComponentName(
  options: CompileComponentOptions,
  model = parseComponentModuleModel(options.fileName, options.source),
): string {
  const component = firstComponentModel(model);
  if (component?.localName) return component.localName;

  const baseName =
    options.fileName
      .replace(/\.[^.]+$/, '')
      .split('/')
      .at(-1) ?? 'Component';
  return baseName
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('');
}
