import * as ts from 'typescript';

import {
  computeRenderPlanFingerprint,
  encodeRenderPlanFrame,
  type RenderPlanFingerprintInput,
} from '@kovojs/core/internal/render-plan-token';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import {
  callExpressionAtSpan,
  expressionResolvesToFrameworkExport,
  frameworkExport,
  registerFrameworkIdentityProject,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';
import { formatKovoModuleRef, kovoModuleRef } from '@kovojs/core/internal/module-ref';

import { collectQueryUpdateCoverage, collectQueryUpdatePlans } from './analyze/query-updates.js';
import { canonicalJson } from './canonical-json.js';
import { mergeQueryUpdatePlans, mergeStyleUpdateCoverage } from './compile-result.js';
import { snapshotCompileComponentOptions } from './compile-options.js';
import { createCompileFactLedger, type CompileFactSnapshot } from './compile-fact-ledger.js';
import {
  compilerArrayIsArray,
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerDefineOwnDataProperty,
  compilerFailClosed,
  compilerMapGet,
  compilerMapSet,
  compilerObjectKeys,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetForEach,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringSlice,
  compilerStringStartsWith,
  compilerStringTrim,
} from './compiler-security-intrinsics.js';
import type { CompilerDiagnostic } from './diagnostics.js';
import {
  componentCssAssetForFile,
  dedupeCss,
  emitCssModule,
  type ComponentCssAsset,
} from './css.js';
import { deriveComponentNames } from './component-names.js';
import { deriveMutationKey } from './mutation-names.js';
import { deriveRegistryIdentity } from './registry-identities.js';
import { emitClientModule, emitClientModuleImportManifest } from './emit/client.js';
import { removeUnreferencedNamedImports } from './emit/dead-imports.js';
import { appendLiveTargetRendererExports } from './emit/live-target-renderers.js';
import { emitRegistryModule } from './emit/registry.js';
import {
  emitServerModule,
  type EmittedServerModule,
  mutationFormExplainFacts,
  semanticRenderEquivalenceCheck,
  serverRenderLowering,
  type ServerRenderLowering,
} from './emit/server.js';
// bugz-3 L5: the authored→lowered structural leg lives in the owned render-equivalence module.
import { authoredStaticTextEquivalenceCheck } from './emit/render-equivalence.js';
import { componentGraphFact, findFragmentTargetFacts, findLiveTargetFacts } from './app-graph.js';
import { cssIrHeader } from './ir.js';
import { createComponentHmrImpactMetadata } from './hmr-impact.js';
import {
  clientModuleUrl,
  clientModuleVersion,
  lowerEventHandlers,
  versionHandlerLowering,
} from './lower/handlers.js';
import { runLoweringPipeline } from './lowering-pipeline.js';
import {
  handlerWriteSinks,
  inferComponentName,
  jsxElements,
  normalizeComponentFileName,
  parseComponentModule as parseComponentModuleModel,
  parseDiagnosticsForSourceFile,
  parseSourceFile,
  firstComponentModel,
  componentHasInferredFragmentTarget,
  componentOptionObjectEntries,
  type CallExpressionModel,
  type ComponentModel,
  type ComponentModuleModel,
  type ObjectLiteralEntry,
} from './scan/parse.js';
import {
  applyTerminalEmitPatches,
  componentPipelineState,
  type ComponentPipelineState,
} from './model-pipeline.js';
import {
  mergePackageComponentPrefixFacts,
  packageComponentPrefixesForModule,
} from './package-prefixes.js';
import { isCompilerIrArtifact, validateAuthoringSurface } from './validate/authoring-surface.js';
import { analyzeClientCaptures } from './validate/client-capture.js';
import { validatePackageComponentPrefixes } from './validate/package-prefixes.js';
import { collectCompilerDiagnostics } from './validate/pipeline.js';
import { escapeAttribute, type SourceReplacement } from './shared.js';
import { collectTrustedHtmlOutputContextFacts } from './security/output-context.js';
import { compilerEmittedSourceProvenanceToken } from './source-provenance.js';
import { ensureTypescriptRuntime } from './ts-api.js';
import type {
  CompileComponentOptions,
  CompileResult,
  ClockUpdatePlanFact,
  CompileDependencyFootprint,
  ComponentGraphFact,
  EndpointGraphFact,
  HandlerWriteSinkFact,
  HandlerLowering,
  QueryUpdatePlanFact,
  QueryShape,
  QueryShapeWrapper,
  RenderEquivalenceCheck,
  StateDeriveFact,
  StateDeriveReferenceFact,
  TaskGraphFact,
  RegistryFacts,
} from './types.js';
import {
  compileArtifactFileNames,
  createEmptyCompileResult,
  emittedFileKind,
  queryShapesFromFacts,
} from './types.js';

ensureTypescriptRuntime(ts);

function compilerMapDense<Value, Result>(
  values: readonly Value[],
  label: string,
  map: (value: Value, index: number) => Result,
): Result[] {
  const source = compilerSnapshotDenseArray(values, label);
  const result: Result[] = [];
  for (let index = 0; index < source.length; index += 1) {
    appendCompileValue(result, map(source[index]!, index), `${label} mapped values`);
  }
  return result;
}

function compilerFlatMapDense<Value, Result>(
  values: readonly Value[],
  label: string,
  map: (value: Value, index: number) => readonly Result[],
): Result[] {
  const source = compilerSnapshotDenseArray(values, label);
  const result: Result[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const mapped = compilerSnapshotDenseArray(map(source[index]!, index), `${label} mapped result`);
    for (let mappedIndex = 0; mappedIndex < mapped.length; mappedIndex += 1) {
      appendCompileValue(result, mapped[mappedIndex]!, `${label} flattened values`);
    }
  }
  return result;
}

function compilerFilterDense<Value>(
  values: readonly Value[],
  label: string,
  keep: (value: Value, index: number) => boolean,
): Value[] {
  const source = compilerSnapshotDenseArray(values, label);
  const result: Value[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (keep(source[index]!, index)) {
      appendCompileValue(result, source[index]!, `${label} filtered values`);
    }
  }
  return result;
}

function compilerSomeDense<Value>(
  values: readonly Value[],
  label: string,
  predicate: (value: Value, index: number) => boolean,
): boolean {
  const source = compilerSnapshotDenseArray(values, label);
  for (let index = 0; index < source.length; index += 1) {
    if (predicate(source[index]!, index)) return true;
  }
  return false;
}

function compilerFindDense<Value>(
  values: readonly Value[],
  label: string,
  predicate: (value: Value, index: number) => boolean,
): Value | undefined {
  const source = compilerSnapshotDenseArray(values, label);
  for (let index = 0; index < source.length; index += 1) {
    if (predicate(source[index]!, index)) return source[index]!;
  }
  return undefined;
}

function compilerSortedKeys(value: object): string[] {
  const keys = compilerObjectKeys(value);
  for (let index = 1; index < keys.length; index += 1) {
    const key = keys[index]!;
    let insertAt = index;
    while (insertAt > 0 && key < keys[insertAt - 1]!) {
      keys[insertAt] = keys[insertAt - 1]!;
      insertAt -= 1;
    }
    keys[insertAt] = key;
  }
  return keys;
}

function compilerAppendDense<Value>(
  first: readonly Value[],
  second: readonly Value[],
  label: string,
): Value[] {
  const result = compilerSnapshotDenseArray(first, `${label} first values`);
  const tail = compilerSnapshotDenseArray(second, `${label} second values`);
  for (let index = 0; index < tail.length; index += 1) {
    appendCompileValue(result, tail[index]!, `${label} appended values`);
  }
  return result;
}

function compilerSetValues<Value>(values: ReadonlySet<Value>): Value[] {
  const result: Value[] = [];
  compilerSetForEach(values, (value) => {
    appendCompileValue(result, value, 'Compiler set values');
  });
  return result;
}

function appendCompileValue<Value>(target: Value[], value: Value, label: string): void {
  compilerDefineOwnDataProperty(target, compilerArrayLength(target, label), value);
}

const KOVO_MUTATION_IDENTITY = frameworkExport('@kovojs/server', 'mutation');
const KOVO_QUERY_IDENTITY = frameworkExport('@kovojs/server', 'query');

interface CompileComponentProjectFile {
  readonly fileName: string;
  readonly source: string;
}

interface CompileComponentProjectOptions extends CompileComponentOptions {
  readonly extraFiles?: readonly CompileComponentProjectFile[];
}

/**
 * Compile a single authored component module (TSX/JSX source) into its lowered-IR
 * artifacts — the server render module, the client island module, scoped CSS, and the
 * registry stamp — plus diagnostics, render-equivalence checks, and query update plans.
 *
 * This is the primary public entry point of `@kovojs/compiler`: `create-kovo` templates,
 * the example apps, and the tutorial all call it to lower components and assert the
 * compiler's invariants. Re-compiling a `compiler-emitted` artifact is a no-op pass-through
 * so the pipeline reaches a fixpoint (SPEC.md §5.2; hand-authored lowered IR is KV235).
 */
export function compileComponentModule(rawOptions: CompileComponentOptions): CompileResult {
  const parsed = parseComponentPhase(snapshotCompileComponentOptions(rawOptions));
  if (parsed.kind === 'compiler-ir') return compilerIrPassThroughResult(parsed);
  if (parsed.kind === 'parse-error') return parseErrorResult(parsed);

  const lowered = lowerComponentPhase(parsed);
  const validated = validateComponentPhase(parsed, lowered);
  const client = emitClientPhase(parsed, lowered, validated);
  const registryCss = emitRegistryCssPhase(parsed, lowered, validated, client);
  const server = emitServerPhase(parsed, lowered, validated, client, registryCss);
  const verified = verifyComponentPhase(parsed, lowered, validated, client, server);

  return assembleCompileResult(parsed, lowered, validated, client, registryCss, server, verified);
}

type ComponentNames = ReturnType<typeof deriveComponentNames>;
interface ModuleComponentNameFact {
  readonly component: ComponentModel | null;
  readonly names: ComponentNames;
}
type ClientCaptureAnalysis = ReturnType<typeof analyzeClientCaptures>;
type MutationFormFacts = ReturnType<typeof mutationFormExplainFacts>;

interface CompileComponentPhaseBase {
  readonly options: CompileComponentOptions;
}

interface CompilerIrPhaseResult extends CompileComponentPhaseBase {
  readonly authoringSurfaceDiagnostics: readonly CompilerDiagnostic[];
  readonly kind: 'compiler-ir';
}

interface ParseErrorPhaseResult extends CompileComponentPhaseBase {
  readonly kind: 'parse-error';
  readonly parseDiagnostics: readonly CompilerDiagnostic[];
}

interface ParsedComponentPhaseResult extends CompileComponentPhaseBase {
  readonly authoringSurfaceDiagnostics: readonly CompilerDiagnostic[];
  readonly compileOptions: CompileComponentProjectOptions;
  readonly componentName: string;
  readonly componentNames: ComponentNames;
  readonly kind: 'parsed';
  readonly originalModel: ComponentModuleModel;
  readonly originalState: ComponentPipelineState<ComponentModuleModel>;
}

type ParseComponentPhaseResult =
  | CompilerIrPhaseResult
  | ParseErrorPhaseResult
  | ParsedComponentPhaseResult;

interface LowerComponentPhaseResult {
  readonly lowering: ReturnType<typeof runLoweringPipeline>;
  readonly model: ComponentModuleModel;
  readonly source: string;
}

interface ValidateComponentPhaseResult {
  readonly clientCaptureAnalysis: ClientCaptureAnalysis;
  readonly clockUpdatePlans: readonly ClockUpdatePlanFact[];
  readonly handlers: readonly HandlerLowering[];
  readonly packagePrefixDiagnostics: readonly CompilerDiagnostic[];
  readonly queryUpdatePlans: readonly QueryUpdatePlanFact[];
  readonly updateCoverage: ReturnType<typeof mergeStyleUpdateCoverage>;
  readonly validationDiagnostics: readonly CompilerDiagnostic[];
}

interface EmitClientPhaseResult {
  readonly clientHref: string;
  readonly clientModuleImportManifest: CompileResult['clientModuleImportManifest'];
  readonly clientSource: string;
  readonly renderPlanFingerprint: string;
  readonly renderPlanFingerprintInput: RenderPlanFingerprintInput;
  readonly stateDeriveReferences: readonly StateDeriveReferenceFact[];
  readonly stateDerives: readonly StateDeriveFact[];
  readonly versionedHandlers: readonly HandlerLowering[];
}

interface EmitRegistryCssPhaseResult {
  readonly componentGraphFacts: readonly ComponentGraphFact[];
  readonly cssAssets: readonly ComponentCssAsset[];
  readonly cssSource: string;
  readonly fileNames: ReturnType<typeof compileArtifactFileNames>;
  readonly fragmentTargetFacts: ReturnType<typeof findFragmentTargetFacts>;
  readonly fragmentTargets: readonly string[];
  readonly liveTargetFacts: ReturnType<typeof findLiveTargetFacts>;
  readonly mutationForms: MutationFormFacts;
  readonly registrySource: string;
}

interface EmitServerPhaseResult {
  readonly serverModule: EmittedServerModule;
  readonly serverRender: ServerRenderLowering;
  readonly serverRenderedSource: string;
}

interface VerifyComponentPhaseResult {
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly renderEquivalenceChecks: readonly RenderEquivalenceCheck[];
}

function parseComponentPhase(rawOptions: CompileComponentOptions): ParseComponentPhaseResult {
  const projectOptions = rawOptions as CompileComponentProjectOptions;
  const options: CompileComponentProjectOptions = {
    ...projectOptions,
    fileName: normalizeComponentFileName(rawOptions.fileName),
  };

  if (isCompilerIrArtifact(options.source)) {
    return {
      authoringSurfaceDiagnostics: validateAuthoringSurface(options),
      kind: 'compiler-ir',
      options,
    };
  }

  const originalModel = parseComponentModuleModel(
    options.fileName,
    options.source,
    parseComponentProjectOptions(options),
  );
  registerFrameworkIdentityProjectForOptions(originalModel.sourceFile, options);
  const parseDiagnostics = parseDiagnosticsForSourceFile(originalModel.sourceFile, options.source);
  if (parseDiagnostics.length > 0) return { kind: 'parse-error', options, parseDiagnostics };

  const packageComponentPrefixes = mergePackageComponentPrefixFacts(
    packageComponentPrefixesForModule(options, originalModel),
    options.packageComponentPrefixes,
  );
  const compileOptions = { ...options, packageComponentPrefixes };

  return {
    authoringSurfaceDiagnostics: validateAuthoringSurface(options, originalModel),
    compileOptions,
    componentName: inferComponentName(options.fileName, originalModel),
    componentNames: deriveComponentNames(options.fileName, firstComponentModel(originalModel)),
    kind: 'parsed',
    options,
    originalModel,
    originalState: componentPipelineState(options.fileName, options.source, originalModel),
  };
}

function compilerIrPassThroughResult(parsed: CompilerIrPhaseResult): CompileResult {
  return {
    ...createEmptyCompileResult(),
    dependencyFootprint: compileDependencyFootprint(parsed.options),
    diagnostics: parsed.authoringSurfaceDiagnostics,
    files: [
      {
        fileName: parsed.options.fileName,
        kind: emittedFileKind(parsed.options.fileName),
        source: parsed.options.source,
      },
    ],
  };
}

function parseErrorResult(parsed: ParseErrorPhaseResult): CompileResult {
  return {
    ...createEmptyCompileResult(),
    dependencyFootprint: compileDependencyFootprint(parsed.options),
    diagnostics: parsed.parseDiagnostics,
  };
}

function lowerComponentPhase(parsed: ParsedComponentPhaseResult): LowerComponentPhaseResult {
  // FN5 (plans/compiler-refactoring.md): the lowering stage runs as a declarative pass list
  // (probe -> structural -> standalone-href -> reparse -> style-extract -> reparse).
  const lowering = runLoweringPipeline(
    parsed.originalState,
    parsed.componentName,
    parsed.compileOptions,
  );
  registerFrameworkIdentityProjectForOptions(lowering.model.sourceFile, parsed.compileOptions);
  return {
    lowering,
    model: lowering.model,
    source: lowering.source,
  };
}

function registerFrameworkIdentityProjectForOptions(
  sourceFile: ts.SourceFile,
  options: CompileComponentProjectOptions,
): void {
  if (!options.extraFiles?.length) return;
  registerFrameworkIdentityProject(
    sourceFile,
    compilerMapDense(options.extraFiles, 'Compiler framework-identity files', (file) =>
      parseSourceFile(file.fileName, file.source),
    ),
  );
}

function parseComponentProjectOptions(options: CompileComponentProjectOptions) {
  return options.extraFiles?.length ? { frameworkIdentityFiles: options.extraFiles } : {};
}

function validateComponentPhase(
  parsed: ParsedComponentPhaseResult,
  lowered: LowerComponentPhaseResult,
): ValidateComponentPhaseResult {
  const { styleSpanProbe, styleExtraction } = lowered.lowering;
  const clientCaptureAnalysis = analyzeClientCaptures(lowered.model);
  const handlers = lowerEventHandlers(
    { ...parsed.compileOptions, source: lowered.source },
    parsed.componentName,
    lowered.model,
  );
  const queryUpdatePlans = mergeQueryUpdatePlans([
    ...collectQueryUpdatePlans(lowered.model, parsed.componentName),
    ...styleExtraction.queryUpdatePlans,
  ]);
  const stateDerives = [
    ...lowered.lowering.structuralLowering.stateDerives,
    ...styleExtraction.stateDerives,
  ];
  const clockUpdatePlans = collectClockUpdatePlans(
    lowered.model,
    parsed.componentName,
    queryUpdatePlans,
  );
  const updateCoverage = mergeStyleUpdateCoverage(
    collectQueryUpdateCoverage(
      lowered.model,
      parsed.compileOptions,
      parsed.componentName,
      stateDerives,
      lowered.lowering.validationOffsetMap,
    ),
    styleExtraction.updateCoverage,
    styleExtraction.handledSpans,
  );

  return {
    clientCaptureAnalysis,
    clockUpdatePlans,
    handlers,
    packagePrefixDiagnostics: validatePackageComponentPrefixes(
      parsed.compileOptions.packageComponentPrefixes,
      parsed.options.fileName,
    ),
    queryUpdatePlans,
    updateCoverage,
    validationDiagnostics: collectCompilerDiagnostics({
      componentName: parsed.componentName,
      diagnosticSource: parsed.options.source,
      model: lowered.model,
      options: parsed.compileOptions,
      originalModel: parsed.originalModel,
      source: lowered.source,
      sourceOffsetMap: lowered.lowering.validationOffsetMap,
      styleOwnedSpans: styleSpanProbe.handledSpans,
      updateCoverage,
    }),
  };
}

function emitClientPhase(
  parsed: ParsedComponentPhaseResult,
  lowered: LowerComponentPhaseResult,
  validated: ValidateComponentPhaseResult,
): EmitClientPhaseResult {
  const stateDerives = compilerAppendDense(
    lowered.lowering.structuralLowering.stateDerives,
    lowered.lowering.styleExtraction.stateDerives,
    'Client state derives',
  );
  const validatedHandlers = compilerSnapshotDenseArray(
    validated.handlers,
    'Validated client handlers',
  );
  const clientSource = emitClientModule(
    validatedHandlers,
    validated.queryUpdatePlans,
    stateDerives,
    parsed.componentName,
    validated.clockUpdatePlans,
  );
  const renderPlanFingerprintInput = renderPlanFingerprintInputForOptions(parsed.compileOptions);
  const renderPlanFingerprint = computeCompilerRenderPlanFingerprint(renderPlanFingerprintInput);
  const clientHref = clientModuleUrl(
    parsed.options.fileName,
    `${renderPlanFingerprint}-${clientModuleVersion(clientSource)}`,
  );
  const versionedHandlers = compilerMapDense(
    validatedHandlers,
    'Versioned client handlers',
    (handler) => versionHandlerLowering(handler, parsed.options.fileName, clientHref),
  );

  return {
    clientHref,
    clientModuleImportManifest: emitClientModuleImportManifest(
      validatedHandlers,
      validated.queryUpdatePlans,
      stateDerives,
      validated.clockUpdatePlans,
    ),
    clientSource,
    renderPlanFingerprint,
    renderPlanFingerprintInput,
    stateDeriveReferences: collectStateDeriveReferenceFacts(
      lowered.model,
      stateDerives,
      clientHref,
    ),
    stateDerives,
    versionedHandlers,
  };
}

function emitRegistryCssPhase(
  parsed: ParsedComponentPhaseResult,
  lowered: LowerComponentPhaseResult,
  validated: ValidateComponentPhaseResult,
  client: EmitClientPhaseResult,
): EmitRegistryCssPhaseResult {
  const fileNames = compileArtifactFileNames(parsed.options.fileName);
  const componentNameFacts = componentNameFactsForModel(parsed.options.fileName, lowered.model);
  const primaryComponentNames = componentNameFacts[0]?.names ?? parsed.componentNames;
  const componentCssSource = emitCssModule(primaryComponentNames.domName, lowered.model);
  const styleCssSource = lowered.lowering.styleExtraction.css
    ? `${cssIrHeader}\n${lowered.lowering.styleExtraction.css}`
    : null;
  const cssSource =
    componentCssSource && styleCssSource
      ? dedupeCss([componentCssSource, styleCssSource])
      : (componentCssSource ?? styleCssSource ?? '');
  const fragmentTargetFacts = compilerFlatMapDense(
    componentNameFacts,
    'Component fragment-target names',
    (fact) => findFragmentTargetFacts(fact.names.registryKey, lowered.model, fact.component),
  );
  const fragmentTargets = compilerMapDense(
    fragmentTargetFacts,
    'Component fragment-target facts',
    (fact) => fact.target,
  );
  const liveTargetFacts = compilerFlatMapDense(
    componentNameFacts,
    'Component live-target names',
    (fact) =>
      findLiveTargetFacts(
        fact.names.domName,
        fact.names.registryKey,
        lowered.model,
        validated.updateCoverage,
        fact.component,
      ),
  );
  const mutationForms = mutationFormExplainFacts(lowered.model, {
    fileName: parsed.options.fileName,
    ...(parsed.compileOptions.registryFacts
      ? { registryFacts: parsed.compileOptions.registryFacts }
      : {}),
    source: lowered.source,
  });
  const componentGraphFacts = compilerMapDense(
    componentNameFacts,
    'Component graph names',
    (fact, index) =>
      componentGraphFact(
        fact.names.registryKey,
        fact.names.domName,
        lowered.model,
        fact.component && componentHasInferredFragmentTarget(fact.component)
          ? [fact.names.registryKey]
          : [],
        index === 0 ? lowered.lowering.styleExtraction.ruleUsages : [],
        fact.component?.localName,
        index === 0 ? mutationForms : [],
        fact.component,
        parsed.options.fileName,
      ),
  );
  const cssAssets = cssSource
    ? [
        {
          ...componentCssAssetForFile(
            fileNames.css,
            primaryComponentNames.domName,
            fragmentTargets,
            {},
            cssSource,
          ),
          ...(lowered.lowering.styleExtraction.ruleUsages.length > 0
            ? { styleRuleUsages: lowered.lowering.styleExtraction.ruleUsages }
            : {}),
        },
      ]
    : [];

  return {
    componentGraphFacts,
    cssAssets,
    cssSource,
    fileNames,
    fragmentTargetFacts,
    fragmentTargets,
    liveTargetFacts,
    mutationForms,
    registrySource: emitRegistryModule({
      clientFileName: fileNames.client,
      cssAssets,
      componentName: parsed.componentName,
      componentRegistryNames: compilerMapDense(
        componentNameFacts,
        'Component registry names',
        (fact) => fact.names.registryKey,
      ),
      domComponentName: primaryComponentNames.domName,
      fragmentTargetFacts,
      handlers: client.versionedHandlers,
      liveTargetFacts,
      platformSubstitutions: lowered.lowering.structuralLowering.platformSubstitutions,
      ...(parsed.options.queryShapeFacts
        ? { queryShapeFacts: parsed.options.queryShapeFacts }
        : {}),
      queryUpdatePlans: validated.queryUpdatePlans,
      ...(parsed.options.registryFacts ? { registryFacts: parsed.options.registryFacts } : {}),
      registryComponentName: primaryComponentNames.registryKey,
      viewTransitions: lowered.lowering.structuralLowering.viewTransitionStamps,
    }),
  };
}

function emitServerPhase(
  parsed: ParsedComponentPhaseResult,
  lowered: LowerComponentPhaseResult,
  validated: ValidateComponentPhaseResult,
  client: EmitClientPhaseResult,
  registryCss: EmitRegistryCssPhaseResult,
): EmitServerPhaseResult {
  const componentNameFacts = componentNameFactsForModel(parsed.options.fileName, lowered.model);
  const primaryComponentNames = componentNameFacts[0]?.names ?? parsed.componentNames;
  const serverRender = serverRenderLowering(
    client.versionedHandlers,
    lowered.model,
    primaryComponentNames.domName,
    {
      clientHref: client.clientHref,
      componentStampTargets: compilerFlatMapDense(
        componentNameFacts,
        'Component stamp targets',
        (fact) =>
          fact.component
            ? [
                {
                  component: fact.component,
                  domComponentName: fact.names.domName,
                  registryComponentName: fact.names.registryKey,
                },
              ]
            : [],
      ),
      fileName: parsed.options.fileName,
      registryComponentName: primaryComponentNames.registryKey,
      ...(parsed.compileOptions.registryFacts
        ? { registryFacts: parsed.compileOptions.registryFacts }
        : {}),
      source: lowered.source,
    },
  );
  let serverRenderReplacements = compilerSnapshotDenseArray(
    serverRender.replacements,
    'Server render replacements',
  );
  serverRenderReplacements = compilerAppendDense(
    serverRenderReplacements,
    componentDescriptorNameAssignments(lowered.model, componentNameFacts),
    'Component descriptor replacements',
  );
  serverRenderReplacements = compilerAppendDense(
    serverRenderReplacements,
    derivedMutationKeyAssignments(lowered.model, parsed.options.fileName),
    'Derived mutation-key replacements',
  );
  serverRenderReplacements = compilerAppendDense(
    serverRenderReplacements,
    derivedQueryKeyAssignments(lowered.model, parsed.options.fileName, lowered.source),
    'Derived query-key replacements',
  );
  serverRenderReplacements = compilerAppendDense(
    serverRenderReplacements,
    versionStateDeriveReferences(client.stateDeriveReferences),
    'State-derive URL replacements',
  );
  const patchedServerSource = applyTerminalEmitPatches(
    lowered.lowering.terminalState,
    serverRenderReplacements,
    {
      phase: 'server-emit',
      writer: 'compileComponentModule',
    },
  );
  const serverRenderedSource = removeUnreferencedNamedImports(
    appendLiveTargetRendererExports({
      componentExpression: parsed.componentName,
      componentExpressionForFact: (fact) =>
        compilerFindDense(
          componentNameFacts,
          'Component expression facts',
          (componentFact) => componentFact.names.registryKey === fact.component,
        )?.component?.localName ?? parsed.componentName,
      liveTargetFacts: registryCss.liveTargetFacts,
      source: insertDerivedQueryKeyImport(patchedServerSource, lowered.model),
    }),
  );

  return {
    serverModule: emitServerModule(serverRenderedSource),
    serverRender,
    serverRenderedSource,
  };
}

function verifyComponentPhase(
  parsed: ParsedComponentPhaseResult,
  lowered: LowerComponentPhaseResult,
  validated: ValidateComponentPhaseResult,
  client: EmitClientPhaseResult,
  server: EmitServerPhaseResult,
): VerifyComponentPhaseResult {
  const diagnostics: CompilerDiagnostic[] = [];
  appendCompilerDiagnostics(
    diagnostics,
    parsed.authoringSurfaceDiagnostics,
    'Authoring-surface diagnostics',
  );
  const handlerLength = compilerArrayLength(client.versionedHandlers, 'Versioned handlers');
  for (let index = 0; index < handlerLength; index += 1) {
    const handler = compilerOwnDataValue(client.versionedHandlers, index, 'Versioned handlers') as
      | HandlerLowering
      | undefined;
    if (!handler) compilerFailClosed(`Versioned handlers[${index}] must be dense own data.`);
    appendCompilerDiagnostics(
      diagnostics,
      handler.diagnostics ?? [],
      'Versioned handler diagnostics',
    );
  }
  appendCompilerDiagnostics(
    diagnostics,
    lowered.lowering.structuralLowering.diagnostics,
    'Structural lowering diagnostics',
  );
  appendCompilerDiagnostics(
    diagnostics,
    lowered.lowering.styleExtraction.diagnostics,
    'Style extraction diagnostics',
  );
  appendCompilerDiagnostics(
    diagnostics,
    server.serverRender.diagnostics,
    'Server-render diagnostics',
  );
  appendCompilerDiagnostics(
    diagnostics,
    validated.packagePrefixDiagnostics,
    'Package-prefix diagnostics',
  );
  appendCompilerDiagnostics(
    diagnostics,
    validated.validationDiagnostics,
    'Compiler validation diagnostics',
  );
  appendCompilerDiagnostics(
    diagnostics,
    productionRenderPlanGateDiagnostics(parsed.compileOptions, client.renderPlanFingerprintInput),
    'Production render-plan diagnostics',
  );

  const registryFactsOptions = {
    fileName: parsed.compileOptions.fileName,
    ...(parsed.compileOptions.registryFacts
      ? { registryFacts: parsed.compileOptions.registryFacts }
      : {}),
  };

  // SPEC §5.2 rule 3. The gate combines two complementary legs into ONE check:
  //   1. semanticRenderEquivalenceCheck: the lowered model vs the executed lowered server
  //      render-source round-trip — proves the emitted server module renders the lowered model
  //      transparently on top of the generated runtime stamps (allowlisted away).
  //   2. authoredStaticTextEquivalenceCheck (bugz-3 L5): the authored→lowered leg. A
  //      byte-identical authored↔lowered gate is infeasible — lowering deliberately rewrites
  //      visible HTML (escapeText text wrapping, mixed-text <span data-bind> insertion,
  //      style={…} → class="kv-…" extraction), so re-deriving it here would be the forbidden
  //      source-normalization gate. This conservative leg instead fails closed when lowering
  //      DROPS or reorders author-written literal text — a class of divergence leg 1 cannot see
  //      (both of its sides are already lowered). Coupled to bugz.md M2 (runtime escapeText
  //      single-escape), now fixed in @kovojs/server.
  const loweredRoundTrip = semanticRenderEquivalenceCheck(
    registryFileName(parsed),
    lowered.model,
    server.serverModule.executableSource,
    registryFactsOptions,
  );
  const authoredStaticText = authoredStaticTextEquivalenceCheck(
    registryFileName(parsed),
    parsed.originalModel,
    lowered.model,
    registryFactsOptions,
  );

  return {
    diagnostics,
    renderEquivalenceChecks: [combineRenderEquivalenceChecks(loweredRoundTrip, authoredStaticText)],
  };
}

function appendCompilerDiagnostics(
  output: CompilerDiagnostic[],
  values: readonly CompilerDiagnostic[],
  label: string,
): void {
  const length = compilerArrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, label) as CompilerDiagnostic | undefined;
    if (!value) compilerFailClosed(`${label}[${index}] must be dense own data.`);
    appendCompileValue(output, value, label);
  }
}

/**
 * Fold the two SPEC §5.2 rule-3 legs into a single render-equivalence check. The lowered
 * round-trip leg is the primary signal; the authored→lowered static-text leg (bugz-3 L5) fails the
 * combined check closed when lowering drops author copy. A failing leg surfaces its own
 * expected/actual/detail so `assertRenderEquivalence` reports the actionable divergence.
 */
function combineRenderEquivalenceChecks(
  loweredRoundTrip: RenderEquivalenceCheck,
  authoredStaticText: RenderEquivalenceCheck,
): RenderEquivalenceCheck {
  if (!loweredRoundTrip.ok) return loweredRoundTrip;
  if (!authoredStaticText.ok) return authoredStaticText;
  return loweredRoundTrip;
}

function assembleCompileResult(
  parsed: ParsedComponentPhaseResult,
  lowered: LowerComponentPhaseResult,
  validated: ValidateComponentPhaseResult,
  client: EmitClientPhaseResult,
  registryCss: EmitRegistryCssPhaseResult,
  server: EmitServerPhaseResult,
  verified: VerifyComponentPhaseResult,
): CompileResult {
  const facts = componentCompileFactSnapshot(
    lowered,
    validated,
    client,
    registryCss,
    server,
    parsed.originalModel,
  );

  return {
    clientModuleImportManifest: client.clientModuleImportManifest,
    componentGraphFacts: facts.componentGraphFacts,
    dependencyFootprint: compileDependencyFootprint(parsed.compileOptions, {
      fileName: parsed.options.fileName,
      fragmentTargets: compilerMapDense(
        facts.fragmentTargetFacts,
        'Compile-result fragment targets',
        (fact) => fact.target,
      ),
      model: lowered.model,
      mutationForms: registryCss.mutationForms,
      queryUpdatePlans: facts.queryUpdatePlans,
      viewTransitionNames: compilerMapDense(
        facts.viewTransitions,
        'Compile-result view transitions',
        (stamp) => stamp.name,
      ),
    }),
    diagnostics: verified.diagnostics,
    endpointGraphFacts: facts.endpointGraphFacts,
    files: [
      {
        fileName: registryCss.fileNames.server,
        kind: 'server',
        source: server.serverModule.source,
      },
      { fileName: registryCss.fileNames.client, kind: 'client', source: client.clientSource },
      ...(registryCss.cssSource
        ? [
            {
              fileName: registryCss.fileNames.css,
              kind: 'css' as const,
              source: registryCss.cssSource,
            },
          ]
        : []),
      {
        fileName: registryCss.fileNames.registry,
        kind: 'registry',
        source: registryCss.registrySource,
      },
    ],
    clientExports: compilerAppendDense(
      compilerMapDense(
        client.versionedHandlers,
        'Client handler exports',
        (handler) => handler.exportName,
      ),
      compilerMapDense(
        facts.stateDerives,
        'Client state-derive exports',
        (derive) => derive.exportName,
      ),
      'Client exports',
    ),
    cssAssets: facts.componentCssAssets,
    handlerWriteSinkFacts: facts.handlerWriteSinkFacts,
    handlerExports: compilerMapDense(
      client.versionedHandlers,
      'Compile-result handler exports',
      (handler) => handler.exportName,
    ),
    hmrImpact: createComponentHmrImpactMetadata({
      clientHref: client.clientHref,
      componentGraphFacts: facts.componentGraphFacts,
      cssAssets: facts.componentCssAssets,
      diagnostics: verified.diagnostics,
      liveTargetFacts: facts.liveTargetFacts,
      queryUpdatePlans: facts.queryUpdatePlans,
      renderEquivalenceChecks: verified.renderEquivalenceChecks,
      sourceFileName: parsed.options.fileName,
      ...(registryCss.cssSource
        ? {
            stylesheetSources: [
              { source: registryCss.cssSource, sourceFileName: registryCss.fileNames.css },
            ],
          }
        : {}),
    }),
    loweredSource: server.serverRenderedSource,
    outputContextFacts: facts.outputContexts,
    platformSubstitutions: facts.platformSubstitutions,
    publishToClientFacts: facts.publishToClientFacts,
    queryUpdatePlans: facts.queryUpdatePlans,
    renderEquivalenceChecks: verified.renderEquivalenceChecks,
    renderPlanFingerprint: client.renderPlanFingerprint,
    taskGraphFacts: facts.taskGraphFacts,
    updateCoverage: facts.queryUpdateCoverage,
    viewTransitions: facts.viewTransitions,
  };
}

function componentCompileFactSnapshot(
  lowered: LowerComponentPhaseResult,
  validated: ValidateComponentPhaseResult,
  client: EmitClientPhaseResult,
  registryCss: EmitRegistryCssPhaseResult,
  server: EmitServerPhaseResult,
  originalModel: ComponentModuleModel,
): CompileFactSnapshot {
  const ledger = createCompileFactLedger();
  ledger.merge(lowered.lowering.factSnapshot, { phase: 'lower', pass: 'lowering-pipeline' });
  ledger.append('clockUpdatePlans', { phase: 'validate', pass: 'clock-update-plans' }, [
    ...validated.clockUpdatePlans,
  ]);
  ledger.append('queryUpdateCoverage', { phase: 'validate', pass: 'query-update-coverage' }, [
    ...validated.updateCoverage,
  ]);
  ledger.append('queryUpdatePlans', { phase: 'validate', pass: 'query-update-plans' }, [
    ...validated.queryUpdatePlans,
  ]);
  ledger.append('publishToClientFacts', { phase: 'validate', pass: 'client-capture' }, [
    ...validated.clientCaptureAnalysis.publishFacts,
  ]);
  ledger.append('stateDerives', { phase: 'emit', pass: 'client-module' }, [...client.stateDerives]);
  ledger.append('componentCssAssets', { phase: 'emit', pass: 'registry-css' }, [
    ...registryCss.cssAssets,
  ]);
  ledger.append('componentGraphFacts', { phase: 'graph', pass: 'component-graph' }, [
    ...registryCss.componentGraphFacts,
  ]);
  ledger.append('endpointGraphFacts', { phase: 'graph', pass: 'webhook-endpoint-graph' }, [
    ...webhookEndpointGraphFactsFromModel(originalModel),
  ]);
  ledger.append('taskGraphFacts', { phase: 'graph', pass: 'task-graph' }, [
    ...taskGraphFactsFromModel(originalModel),
  ]);
  ledger.append('handlerWriteSinkFacts', { phase: 'graph', pass: 'handler-write-sinks' }, [
    ...handlerWriteSinkFactsFromModel(originalModel),
  ]);
  ledger.append('fragmentTargetFacts', { phase: 'graph', pass: 'fragment-targets' }, [
    ...registryCss.fragmentTargetFacts,
  ]);
  ledger.append('liveTargetFacts', { phase: 'graph', pass: 'live-targets' }, [
    ...registryCss.liveTargetFacts,
  ]);
  ledger.append('outputContexts', { phase: 'emit', pass: 'server-render' }, [
    ...server.serverRender.outputContexts,
  ]);
  ledger.append('outputContexts', { phase: 'validate', pass: 'trusted-html' }, [
    ...collectTrustedHtmlOutputContextFacts(originalModel),
  ]);
  ledger.append(
    'outputContexts',
    { phase: 'validate', pass: 'query-update-plans' },
    compilerFlatMapDense(validated.queryUpdatePlans, 'Query update-plan output contexts', (plan) =>
      compilerSnapshotDenseArray(plan.outputContexts ?? [], 'Query output contexts'),
    ),
  );
  ledger.append(
    'outputContexts',
    { phase: 'emit', pass: 'state-derives' },
    compilerMapDense(
      client.stateDerives,
      'State-derive output contexts',
      (derive) => derive.outputContext,
    ),
  );
  return ledger.snapshot();
}

function taskGraphFactsFromModel(model: ComponentModuleModel): TaskGraphFact[] {
  return compilerMapDense(model.taskRunHandlers, 'Task graph handlers', (handler) => ({
    ...(handler.cron === undefined ? {} : { cron: handler.cron }),
    key: handler.key,
    ...(handler.runMutationEdges.length === 0 ? {} : { runMutations: handler.runMutationEdges }),
    ...(handler.runQueryEdges.length === 0 ? {} : { runQueries: handler.runQueryEdges }),
    ...(handler.scheduleEdges.length === 0 ? {} : { schedules: handler.scheduleEdges }),
  }));
}

function webhookEndpointGraphFactsFromModel(model: ComponentModuleModel): EndpointGraphFact[] {
  return compilerMapDense(model.webhookHandlers, 'Webhook graph handlers', (handler) => ({
    access: { kind: 'verified-machine-auth' },
    appOwnedSafety: false,
    auth: 'webhook-verifier',
    body: 'text',
    cache: 'no-store',
    csrf: 'exempt',
    csrfJustification: `${handler.owner.value} webhook verifier`,
    method: 'POST',
    mount: 'exact',
    name: handler.owner.value,
    path: handler.owner.value,
    ...(handler.runMutationEdges.length === 0 ? {} : { runMutations: handler.runMutationEdges }),
    surface: 'webhook',
    ...(handler.declaredWriteKeys.length === 0
      ? {}
      : {
          writes: compilerFilterDense(
            handler.declaredWriteKeys,
            'Webhook declared write keys',
            (key) => key !== 'UNRESOLVED',
          ),
        }),
  }));
}

function handlerWriteSinkFactsFromModel(model: ComponentModuleModel): HandlerWriteSinkFact[] {
  return handlerWriteSinks(model);
}

function registryFileName(parsed: ParsedComponentPhaseResult): string {
  return compileArtifactFileNames(parsed.options.fileName).server;
}

interface CompileDependencyFootprintUsage {
  fileName: string;
  fragmentTargets: readonly string[];
  model: ComponentModuleModel;
  mutationForms: readonly { mutation: string }[];
  queryUpdatePlans: readonly QueryUpdatePlanFact[];
  viewTransitionNames: readonly string[];
}

function compileDependencyFootprint(
  options: CompileComponentOptions,
  usage?: CompileDependencyFootprintUsage,
): CompileDependencyFootprint {
  if (!usage) return conservativeCompileDependencyFootprint(options);

  const queryNames = referencedQueryNames(usage);
  const mutationInputKeys = referencedMutationInputKeys(usage);
  const previousDomLeaves = previousRegistryComponentDomLeaves(usage);
  const reads = compileDependencyReads({
    fragmentTargets: usage.fragmentTargets,
    mutationInputKeys,
    previousRegistryComponentDomLeaves: previousDomLeaves,
    queryShapeNames: [...queryNames],
    viewTransitions: usage.viewTransitionNames,
  });
  const previousRegistryFacts = slicePreviousRegistryFacts(options.previousRegistryFacts, usage);
  const queryShapes = sliceRecord(options.queryShapes, queryNames);
  const registryFacts = sliceRegistryFacts(options.registryFacts, usage, mutationInputKeys);

  return {
    ...(options.packageComponentPrefixes === undefined
      ? {}
      : { packageComponentPrefixes: options.packageComponentPrefixes }),
    ...(options.packagePrefixDiscoveryRoot === undefined
      ? {}
      : { packagePrefixDiscoveryRoot: options.packagePrefixDiscoveryRoot }),
    ...(previousRegistryFacts === undefined ? {} : { previousRegistryFacts }),
    ...(options.queryShapeFacts === undefined ? {} : { queryShapeFacts: options.queryShapeFacts }),
    ...(queryShapes === undefined ? {} : { queryShapes }),
    ...(reads === undefined ? {} : { reads }),
    ...(registryFacts === undefined ? {} : { registryFacts }),
  };
}

function conservativeCompileDependencyFootprint(
  options: CompileComponentOptions,
): CompileDependencyFootprint {
  return {
    ...(options.packageComponentPrefixes === undefined
      ? {}
      : { packageComponentPrefixes: options.packageComponentPrefixes }),
    ...(options.packagePrefixDiscoveryRoot === undefined
      ? {}
      : { packagePrefixDiscoveryRoot: options.packagePrefixDiscoveryRoot }),
    ...(options.previousRegistryFacts === undefined
      ? {}
      : { previousRegistryFacts: options.previousRegistryFacts }),
    ...(options.queryShapeFacts === undefined ? {} : { queryShapeFacts: options.queryShapeFacts }),
    ...(options.queryShapes === undefined ? {} : { queryShapes: options.queryShapes }),
    ...(options.registryFacts === undefined ? {} : { registryFacts: options.registryFacts }),
  };
}

function referencedQueryNames(usage: CompileDependencyFootprintUsage): Set<string> {
  const names = compilerCreateSet<string>();
  const plans = compilerSnapshotDenseArray(usage.queryUpdatePlans, 'Dependency query plans');
  for (let index = 0; index < plans.length; index += 1) {
    compilerSetAdd(names, plans[index]!.query);
  }
  const components = compilerSnapshotDenseArray(
    usage.model.components,
    'Dependency model components',
  );
  for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
    const component = components[componentIndex]!;
    const options = compilerSnapshotDenseArray(component.options, 'Dependency component options');
    for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
      const option = options[optionIndex]!;
      if (option.key !== 'queries') continue;
      const entries = compilerSnapshotDenseArray(
        option.objectEntries ?? [],
        'Dependency query option entries',
      );
      for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
        compilerSetAdd(names, entries[entryIndex]!.key);
      }
    }
  }
  return names;
}

function referencedMutationInputKeys(usage: CompileDependencyFootprintUsage): Set<string> {
  const keys = compilerCreateSet<string>();
  const forms = compilerSnapshotDenseArray(usage.mutationForms, 'Dependency mutation forms');
  for (let index = 0; index < forms.length; index += 1) {
    compilerSetAdd(keys, forms[index]!.mutation);
  }
  return keys;
}

function previousRegistryComponentDomLeaves(usage: CompileDependencyFootprintUsage): Set<string> {
  const names = compilerCreateSet<string>();
  const components = compilerSnapshotDenseArray(
    usage.model.components,
    'Previous registry components',
  );
  for (let index = 0; index < components.length; index += 1) {
    compilerSetAdd(names, deriveComponentNames(usage.fileName, components[index]!).domName);
  }
  return names;
}

function compileDependencyReads(reads: {
  fragmentTargets: readonly string[];
  mutationInputKeys: ReadonlySet<string>;
  previousRegistryComponentDomLeaves: ReadonlySet<string>;
  queryShapeNames: readonly string[];
  viewTransitions: readonly string[];
}): CompileDependencyFootprint['reads'] | undefined {
  const fragmentTargets = sortedUnique(reads.fragmentTargets);
  const mutationInputKeys = sortedUnique(compilerSetValues(reads.mutationInputKeys));
  const previousRegistryComponentDomLeaves = sortedUnique(
    compilerSetValues(reads.previousRegistryComponentDomLeaves),
  );
  const queryShapeNames = sortedUnique(reads.queryShapeNames);
  const viewTransitions = sortedUnique(reads.viewTransitions);
  const footprint: NonNullable<CompileDependencyFootprint['reads']> = {
    ...(fragmentTargets.length === 0 ? {} : { fragmentTargets }),
    ...(mutationInputKeys.length === 0 ? {} : { mutationInputKeys }),
    ...(previousRegistryComponentDomLeaves.length === 0
      ? {}
      : { previousRegistryComponentDomLeaves }),
    ...(queryShapeNames.length === 0 ? {} : { queryShapeNames }),
    ...(viewTransitions.length === 0 ? {} : { viewTransitions }),
  };
  return compilerObjectKeys(footprint).length === 0 ? undefined : footprint;
}

function slicePreviousRegistryFacts(
  facts: RegistryFacts | undefined,
  usage: CompileDependencyFootprintUsage,
): RegistryFacts | undefined {
  const previousComponents = facts?.components;
  if (!previousComponents) return undefined;

  const domLeaves = previousRegistryComponentDomLeaves(usage);
  const components = compilerFilterDense(
    previousComponents,
    'Previous registry component names',
    (name) => compilerSetHas(domLeaves, registryNameLeaf(name)),
  );
  return components.length === 0 ? undefined : { components };
}

function sliceRegistryFacts(
  facts: RegistryFacts | undefined,
  usage: CompileDependencyFootprintUsage,
  mutationKeys = referencedMutationInputKeys(usage),
): RegistryFacts | undefined {
  if (!facts) return undefined;

  const mutationInputs = sliceRecord(facts.mutationInputs, mutationKeys);
  const fragmentTargetKeys = compilerCreateSet<string>();
  const fragmentTargetsSnapshot = compilerSnapshotDenseArray(
    usage.fragmentTargets,
    'Dependency fragment targets',
  );
  for (let index = 0; index < fragmentTargetsSnapshot.length; index += 1) {
    compilerSetAdd(fragmentTargetKeys, fragmentTargetsSnapshot[index]!);
  }
  const viewTransitionKeys = compilerCreateSet<string>();
  const viewTransitionSnapshot = compilerSnapshotDenseArray(
    usage.viewTransitionNames,
    'Dependency view transitions',
  );
  for (let index = 0; index < viewTransitionSnapshot.length; index += 1) {
    compilerSetAdd(viewTransitionKeys, viewTransitionSnapshot[index]!);
  }
  const fragmentTargets = sliceArray(facts.fragmentTargets, fragmentTargetKeys);
  const viewTransitions = sliceArray(facts.viewTransitions, viewTransitionKeys);
  const sliced: RegistryFacts = {
    ...(facts.components === undefined ? {} : { components: facts.components }),
    ...(facts.domainKeys === undefined ? {} : { domainKeys: facts.domainKeys }),
    ...(fragmentTargets === undefined ? {} : { fragmentTargets }),
    ...(facts.invalidations === undefined ? {} : { invalidations: facts.invalidations }),
    ...(facts.liveTargets === undefined ? {} : { liveTargets: facts.liveTargets }),
    ...(mutationInputs === undefined ? {} : { mutationInputs }),
    ...(facts.mutations === undefined ? {} : { mutations: facts.mutations }),
    ...(facts.queries === undefined ? {} : { queries: facts.queries }),
    ...(facts.routes === undefined ? {} : { routes: facts.routes }),
    ...(viewTransitions === undefined ? {} : { viewTransitions }),
  };
  return compilerObjectKeys(sliced).length === 0 ? undefined : sliced;
}

function sliceRecord<T>(
  record: Readonly<Record<string, T>> | undefined,
  keys: ReadonlySet<string>,
): Record<string, T> | undefined {
  if (!record || compilerSetValues(keys).length === 0) return undefined;

  const result: Record<string, T> = {};
  const recordKeys = compilerObjectKeys(record);
  let count = 0;
  for (let index = 0; index < recordKeys.length; index += 1) {
    const key = recordKeys[index]!;
    if (!compilerSetHas(keys, key)) continue;
    const value = compilerOwnDataValue(record, key, 'Registry fact record') as T | undefined;
    if (value === undefined) continue;
    result[key] = value;
    count += 1;
  }
  return count === 0 ? undefined : result;
}

function sliceArray<T>(items: readonly T[] | undefined, keys: ReadonlySet<T>): T[] | undefined {
  if (!items || compilerSetValues(keys).length === 0) return undefined;

  const selected = compilerFilterDense(items, 'Registry fact array', (item) =>
    compilerSetHas(keys, item),
  );
  return selected.length === 0 ? undefined : selected;
}

function registryNameLeaf(registryName: string): string {
  return registryName.split('/').at(-1) ?? registryName;
}

function sortedUnique(items: readonly string[]): string[] {
  const source = compilerSnapshotDenseArray(items, 'Strings to deduplicate and sort');
  const seen = compilerCreateSet<string>();
  const result: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index]!;
    if (compilerSetHas(seen, value)) continue;
    compilerSetAdd(seen, value);
    let insertAt = result.length;
    while (insertAt > 0 && value < result[insertAt - 1]!) {
      result[insertAt] = result[insertAt - 1]!;
      insertAt -= 1;
    }
    result[insertAt] = value;
  }
  return result;
}

function collectClockUpdatePlans(
  model: ComponentModuleModel,
  componentName: string,
  queryUpdatePlans: readonly QueryUpdatePlanFact[],
): ClockUpdatePlanFact[] {
  if (
    !compilerSomeDense(queryUpdatePlans, 'Clock query update plans', (plan) => plan.query === 'now')
  ) {
    return [];
  }

  const clocks = compilerMapDense(
    compilerFilterDense(
      componentOptionObjectEntries(model, 'clocks'),
      'Clock component options',
      (entry) => entry.value !== undefined && entry.value !== '' && !clockEntryIsRenderOnce(entry),
    ),
    'Live clock component options',
    (entry) => ({ name: entry.key, spec: entry.value! }),
  );

  return clocks.length > 0 ? [{ clocks, componentName }] : [];
}

function clockEntryIsRenderOnce(entry: Pick<ObjectLiteralEntry, 'objectEntries'>): boolean {
  return compilerSomeDense(
    entry.objectEntries ?? [],
    'Clock render-once fields',
    (field) => field.key === 'renderOnce' && field.value === 'true',
  );
}

function componentNameFactsForModel(
  fileName: string,
  model: ComponentModuleModel,
): ModuleComponentNameFact[] {
  if (model.components.length === 0) {
    return [{ component: null, names: deriveComponentNames(fileName, null) }];
  }

  return compilerMapDense(model.components, 'Component naming facts', (component) => ({
    component,
    names: deriveComponentNames(fileName, component),
  }));
}

function componentDescriptorNameAssignments(
  model: ComponentModuleModel,
  componentNameFacts: readonly ModuleComponentNameFact[],
): SourceReplacement[] {
  const factsByComponent = compilerCreateMap<ComponentModel, ModuleComponentNameFact>();
  const facts = compilerSnapshotDenseArray(componentNameFacts, 'Component descriptor name facts');
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index]!;
    if (fact.component) compilerMapSet(factsByComponent, fact.component, fact);
  }

  return compilerFlatMapDense(model.components, 'Component descriptor assignments', (component) => {
    const registryComponentName = compilerMapGet(factsByComponent, component)?.names.registryKey;
    if (!component.localName || registryComponentName === undefined) return [];

    return [
      {
        end: component.declarationEnd,
        replacement: `\n${component.localName}.name = ${canonicalJson(registryComponentName)};`,
        start: component.declarationEnd,
      },
    ];
  });
}

function derivedMutationKeyAssignments(
  model: ComponentModuleModel,
  fileName: string,
): SourceReplacement[] {
  return compilerFlatMapDense(model.calls, 'Derived mutation-key calls', (call) => {
    if (!isExportedObjectFormMutationCall(model, call)) return [];

    const derivedKey = canonicalJson(deriveMutationKey(fileName, call.exportedConstName));
    return [
      {
        end: call.end,
        replacement: `\n${call.exportedConstName}.key = ${derivedKey};\nif (${call.exportedConstName}.queue === true) ${call.exportedConstName}.queue = ${derivedKey};`,
        start: call.end,
      },
    ];
  });
}

function isExportedObjectFormMutationCall(
  model: ComponentModuleModel,
  call: ComponentModuleModel['calls'][number],
): call is ComponentModuleModel['calls'][number] & { exportedConstName: string } {
  return (
    isKovoMutationCall(model, call) &&
    call.exportedConstName !== undefined &&
    call.arguments.length === 1 &&
    call.arguments[0] !== undefined &&
    compilerStringStartsWith(compilerStringTrim(call.arguments[0]), '{')
  );
}

const derivedQueryKeyHelper = '__kovoAssignDerivedQueryKey';
const derivedQueryKeyWireModule = '@kovojs/server/internal/wire';

function derivedQueryKeyAssignments(
  model: ComponentModuleModel,
  fileName: string,
  source: string,
): SourceReplacement[] {
  return compilerMapDense(
    exportedObjectFirstQueryCalls(model),
    'Derived query-key calls',
    (call) => {
      const key = deriveRegistryIdentity(fileName, call.exportedConstName!).key;
      return {
        end: call.end,
        replacement: `${derivedQueryKeyHelper}(${compilerStringSlice(source, call.start, call.end)}, ${canonicalJson(key)})`,
        start: call.start,
      };
    },
  );
}

function insertDerivedQueryKeyImport(source: string, model: ComponentModuleModel): string {
  if (exportedObjectFirstQueryCalls(model).length === 0) return source;
  if (
    compilerSomeDense(
      model.namedImports,
      'Derived query-key helper imports',
      (entry) =>
        entry.moduleSpecifier === derivedQueryKeyWireModule &&
        entry.localName === derivedQueryKeyHelper,
    )
  ) {
    return source;
  }

  const sourceFile = parseSourceFile('lowered.tsx', source);
  const statements = compilerSnapshotDenseArray(sourceFile.statements, 'Lowered source statements');
  let importDeclarationEnd = 0;
  for (let index = statements.length - 1; index >= 0; index -= 1) {
    if (ts.isImportDeclaration(statements[index]!)) {
      importDeclarationEnd = statements[index]!.end;
      break;
    }
  }
  const importLine = `import { assignDerivedQueryKey as ${derivedQueryKeyHelper} } from '${derivedQueryKeyWireModule}';\n`;
  if (importDeclarationEnd > 0) {
    return `${compilerStringSlice(source, 0, importDeclarationEnd)}\n${importLine}${compilerStringSlice(source, importDeclarationEnd)}`;
  }
  return `${importLine}${source}`;
}

function exportedObjectFirstQueryCalls(model: ComponentModuleModel) {
  return compilerFilterDense(
    model.calls,
    'Exported object-form query calls',
    (call) =>
      call.exportedConstName !== undefined &&
      isKovoQueryCall(model, call) &&
      call.arguments.length === 1 &&
      typeof call.argumentStaticValues[0] !== 'string',
  );
}

function isKovoQueryCall(model: ComponentModuleModel, call: CallExpressionModel) {
  const astCall = callExpressionAtSpan(ts as FrameworkIdentityTypeScript, model.sourceFile, call);
  return astCall ? isKovoQueryCallee(model.sourceFile, astCall.expression) : false;
}

function isKovoMutationCall(model: ComponentModuleModel, call: CallExpressionModel) {
  const astCall = callExpressionAtSpan(ts as FrameworkIdentityTypeScript, model.sourceFile, call);
  return astCall
    ? expressionResolvesToFrameworkExport(
        ts as FrameworkIdentityTypeScript,
        model.sourceFile,
        astCall.expression,
        KOVO_MUTATION_IDENTITY,
        { legacyGlobals: [KOVO_MUTATION_IDENTITY] },
      )
    : false;
}

function isKovoQueryCallee(sourceFile: ts.SourceFile, expression: ts.Expression): boolean {
  return expressionResolvesToFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    expression,
    KOVO_QUERY_IDENTITY,
  );
}

export function collectStateDeriveReferenceFacts(
  model: ComponentModuleModel,
  stateDerives: readonly StateDeriveFact[],
  clientHref: string,
): StateDeriveReferenceFact[] {
  if (stateDerives.length === 0) return [];

  const derivesByPlaceholder = compilerCreateMap<string, StateDeriveFact>();
  const derives = compilerSnapshotDenseArray(stateDerives, 'State derives for URL versioning');
  for (let index = 0; index < derives.length; index += 1) {
    compilerMapSet(derivesByPlaceholder, derives[index]!.placeholder, derives[index]!);
  }
  const references: StateDeriveReferenceFact[] = [];

  const elements = compilerSnapshotDenseArray(jsxElements(model), 'State-derive JSX elements');
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex]!;
    const attributes = compilerSnapshotDenseArray(
      element.attributes,
      'State-derive JSX attributes',
    );
    for (let attributeIndex = 0; attributeIndex < attributes.length; attributeIndex += 1) {
      const attribute = attributes[attributeIndex]!;
      if (
        !(
          attribute.name === 'data-bind' ||
          compilerStringStartsWith(attribute.name, 'data-bind:') ||
          // SPEC §4.8 data-bind-prop: version the live-property stamp's derive
          // reference identically to its data-bind:<attr> sibling.
          compilerStringStartsWith(attribute.name, 'data-bind-prop:')
        ) ||
        !attribute.value
      ) {
        continue;
      }

      const derive = compilerMapGet(derivesByPlaceholder, attribute.value);
      if (!derive) continue;

      appendCompileValue(
        references,
        {
          attr: attribute.name,
          clientHref,
          exportName: derive.exportName,
          placeholder: derive.placeholder,
          target: { end: attribute.end, start: attribute.start },
          value: formatKovoModuleRef(kovoModuleRef(clientHref, derive.exportName, 'derive')),
          writer: 'state derive URL versioning',
        },
        'State derive references',
      );
    }
  }

  return references;
}

function versionStateDeriveReferences(
  references: readonly StateDeriveReferenceFact[],
): SourceReplacement[] {
  return compilerMapDense(references, 'State-derive reference replacements', (reference) => ({
    end: reference.target.end,
    replacement: `${reference.attr}="${escapeAttribute(reference.value)}"`,
    start: reference.target.start,
  }));
}

/**
 * Assert the SPEC.md §5.2 fixpoint property: re-compiling every emitted artifact of a
 * compileComponentModule result reproduces that artifact byte-for-byte. Throws on the first
 * artifact that changes under recompilation. Public verification helper used by `create-kovo`
 * templates and example apps to prove the compiler is idempotent.
 */
export function assertFixpoint(result: CompileResult): void {
  for (const file of result.files) {
    const recompileOptions = {
      ...file,
      sourceProvenance: compilerEmittedSourceProvenanceToken(),
    };
    const recompiled = compileComponentModule(
      recompileOptions as unknown as CompileComponentOptions,
    );
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

/**
 * Assert the SPEC.md §5.2 rule 3 render-equivalence property. Two legs (see
 * `verifyComponentPhase`): (1) the emitted server module renders the lowered model
 * transparently over generated-only runtime stamps, and (2) the authored→lowered leg
 * (bugz-3 L5) — lowering never drops or reorders author-written literal text. Throws on the
 * first failing check in a compileComponentModule result. Public verification helper used by
 * `create-kovo` templates and example apps. (Note: leg 1 compares the LOWERED model against the
 * executed lowered render-source, not the authored source — a byte-identical authored↔lowered
 * render gate is infeasible because lowering rewrites visible HTML; see render-equivalence.ts.)
 */
export function assertRenderEquivalence(result: CompileResult): void {
  for (const check of result.renderEquivalenceChecks) {
    if (!check.ok) {
      const detail =
        check.expected === undefined && check.actual === undefined
          ? ''
          : ` expected=${canonicalJson(check.expected ?? null)} actual=${canonicalJson(check.actual ?? null)}`;
      throw new Error(`Render equivalence failed for ${check.artifact}${detail}`);
    }
  }
}

/**
 * Input to {@link computeCompilerRenderPlanFingerprint}: a map of query name to an
 * opaque string that captures the projected shape for that query.  The values must
 * change whenever the projected shape changes (SPEC §5.2.1 rule 1).
 * @internal
 */
export type CompilerRenderPlanFingerprintInput = RenderPlanFingerprintInput;

/**
 * Compute the render-plan fingerprint over a set of projected query shapes + the
 * grammar version.  FN1 (plans/compiler-refactoring.md): a thin wrapper over the
 * single shared implementation in `@kovojs/core` so the compiler (KV416) and
 * `@kovojs/server` (build token) cannot drift (SPEC §5.2.1 rule 1, §5.2.2 KV416).
 * @internal
 */
export function computeCompilerRenderPlanFingerprint(
  input: CompilerRenderPlanFingerprintInput,
): string {
  return computeRenderPlanFingerprint(input);
}

/**
 * Input for a KV416 token-monotonicity check: a "before" and "after" snapshot of
 * the projected query-shape signatures, plus an optional token function that takes
 * a {@link CompilerRenderPlanFingerprintInput} and returns an opaque string.
 * Supply `tokenFn` to use a custom token provider; omit it to use the built-in
 * {@link computeCompilerRenderPlanFingerprint}.
 * @internal
 */
export interface AssertRenderPlanTokenMonotonicityOptions {
  after: CompilerRenderPlanFingerprintInput;
  before: CompilerRenderPlanFingerprintInput;
  tokenFn?: (input: CompilerRenderPlanFingerprintInput) => string;
}

/**
 * Assert SPEC §5.2.2 KV416 token monotonicity: if the projected query shapes (or the
 * grammar version) changed between `before` and `after`, the render-plan token MUST
 * also change.  A token that fails to move on a shape change causes a `KV416` build
 * failure.
 *
 * Callers pass the "before" and "after" shape-signature records; the function uses
 * `computeCompilerRenderPlanFingerprint` (or a custom `tokenFn`) to compute both
 * tokens and compares them.  Call this from the build gate after a differential corpus
 * run (SPEC §5.2.2).
 */
export function assertRenderPlanTokenMonotonicity(
  options: AssertRenderPlanTokenMonotonicityOptions,
): void {
  const { before, after, tokenFn = computeCompilerRenderPlanFingerprint } = options;

  const beforeToken = tokenFn(before);
  const afterToken = tokenFn(after);

  const shapesChanged = canonicalJson(sortedRecord(before)) !== canonicalJson(sortedRecord(after));

  if (shapesChanged && beforeToken === afterToken) {
    throw new CompilerDiagnosticError(
      kv416Diagnostic(
        'render-plan token failed to move on a projected-query-shape change',
        `Token before and after: "${beforeToken}".`,
      ),
    );
  }
}

/**
 * Build-facing SPEC §5.2.2 production gate. Production callers pass the compile result plus the
 * previous/current render-plan token inputs; this assertion combines the existing semantic
 * render-equivalence checks with KV416 token monotonicity so the build fails before output is
 * published.
 */
export function assertProductionRenderPlanGate(options: {
  after: CompilerRenderPlanFingerprintInput;
  before: CompilerRenderPlanFingerprintInput;
  result: CompileResult;
  tokenFn?: (input: CompilerRenderPlanFingerprintInput) => string;
}): void {
  try {
    assertRenderEquivalence(options.result);
    assertRenderPlanTokenMonotonicity({
      before: options.before,
      after: options.after,
      ...(options.tokenFn ? { tokenFn: options.tokenFn } : {}),
    });
  } catch (error) {
    if (error instanceof CompilerDiagnosticError) throw error;
    throw new CompilerDiagnosticError(
      kv416Diagnostic(
        'production render-equivalence or delta gate failed',
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

/**
 * @internal Build-gate diagnostic wrapper surfaced through the compiler's internal entrypoint.
 */
export class CompilerDiagnosticError extends Error {
  readonly diagnostic: ReturnType<typeof kv416Diagnostic>;

  constructor(diagnostic: ReturnType<typeof kv416Diagnostic>) {
    super(`${diagnostic.code}: ${diagnostic.message}`);
    this.name = 'CompilerDiagnosticError';
    this.diagnostic = diagnostic;
  }
}

function sortedRecord(record: Record<string, string>): [string, string][] {
  const keys = compilerSortedKeys(record);
  const result: [string, string][] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const value = compilerOwnDataValue(record, key, 'Render-plan token input');
    if (typeof value !== 'string') {
      compilerFailClosed(`Render-plan token input ${key} must be a string.`);
    }
    appendCompileValue(result, [key, value], 'Sorted render-plan input');
  }
  return result;
}

function productionRenderPlanGateDiagnostics(
  options: CompileComponentOptions,
  after: CompilerRenderPlanFingerprintInput,
) {
  const gate = options.productionRenderPlanGate;
  if (!gate) return [];

  try {
    assertRenderPlanTokenMonotonicity({
      before: gate.previous,
      after,
      ...(gate.tokenFn ? { tokenFn: gate.tokenFn } : {}),
    });
    return [];
  } catch (error) {
    if (error instanceof CompilerDiagnosticError) return [error.diagnostic];
    return [
      kv416Diagnostic(
        'production render-plan token gate failed',
        error instanceof Error ? error.message : String(error),
        options.fileName,
      ),
    ];
  }
}

function kv416Diagnostic(reason: string, detail: string, fileName = '<production-build>') {
  const definition = diagnosticDefinitions.KV416;
  return {
    code: 'KV416' as const,
    fileName,
    help: definition.help,
    message: `${definition.message} ${reason}. ${detail}`,
    severity: definition.severity,
  };
}

function renderPlanFingerprintInputForOptions(
  options: CompileComponentOptions,
): CompilerRenderPlanFingerprintInput {
  const shapes =
    options.queryShapes ??
    (options.queryShapeFacts ? queryShapesFromFacts(options.queryShapeFacts) : undefined);
  if (!shapes) return {};

  const input: CompilerRenderPlanFingerprintInput = {};
  const names = compilerSortedKeys(shapes);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const shape = compilerOwnDataValue(shapes, name, 'Compiler query shapes') as
      | QueryShape
      | undefined;
    if (shape === undefined) compilerFailClosed(`Compiler query shape ${name} is undefined.`);
    input[name] = stableQueryShapeSignature(shape);
  }
  return input;
}

function stableQueryShapeSignature(shape: QueryShape): string {
  if (compilerArrayIsArray(shape)) {
    const entries = compilerSnapshotDenseArray(shape as readonly QueryShape[], 'Array query shape');
    const signatures = compilerMapDense(entries, 'Array query-shape entries', (entry) =>
      stableQueryShapeSignature(entry),
    );
    return encodeRenderPlanFrame('array', compilerArrayJoin(signatures, ''));
  }
  if (typeof shape === 'string') return encodeRenderPlanFrame('primitive', shape);
  if (isQueryShapeWrapper(shape)) {
    const kind = compilerOwnDataValue(
      shape,
      'kind',
      'Query-shape wrapper',
    ) as QueryShapeWrapper['kind'];
    const wrappedShape = compilerOwnDataValue(shape, 'shape', 'Query-shape wrapper') as QueryShape;
    return encodeRenderPlanFrame(
      'wrapper',
      encodeRenderPlanFrame('kind', kind) +
        encodeRenderPlanFrame('shape', stableQueryShapeSignature(wrappedShape)),
    );
  }

  const objectShape = shape as Readonly<Record<string, QueryShape>>;
  const keys = compilerSortedKeys(objectShape);
  const frames: string[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const propertyShape = compilerOwnDataValue(objectShape, key, 'Object query shape');
    appendCompileValue(
      frames,
      encodeRenderPlanFrame(
        'property',
        encodeRenderPlanFrame('name', key) +
          encodeRenderPlanFrame(
            'shape',
            stableQueryShapeSignature((propertyShape ?? 'object') as QueryShape),
          ),
      ),
      'Object query-shape frames',
    );
  }
  return encodeRenderPlanFrame('object', compilerArrayJoin(frames, ''));
}

function isQueryShapeWrapper(shape: QueryShape): shape is QueryShapeWrapper {
  if (typeof shape !== 'object' || shape === null || compilerArrayIsArray(shape)) return false;
  const kind = compilerOwnDataValue(shape, 'kind', 'Query-shape wrapper candidate');
  const wrappedShape = compilerOwnDataValue(shape, 'shape', 'Query-shape wrapper candidate');
  return (
    wrappedShape !== undefined &&
    (kind === 'nullable' ||
      kind === 'optional' ||
      kind === 'secret' ||
      kind === 'volatile-time' ||
      (kind === 'revealed' &&
        compilerOwnDataValue(shape, 'reveal', 'Revealed query-shape wrapper') !== undefined))
  );
}

/**
 * @internal Collect the client-island export names a build's minifier must treat as
 * reserved so cross-module references in lowered IR keep resolving. Exported for the
 * in-repo build/codegen pipeline, not for app authors (SPEC.md §5.2).
 */
export function collectMinifierReservedNames(
  results: CompileResult | readonly CompileResult[],
): string[] {
  const reserved = compilerCreateSet<string>();
  const items: readonly CompileResult[] = compilerArrayIsArray(results)
    ? compilerSnapshotDenseArray(
        results as readonly CompileResult[],
        'Compile results for minifier reservations',
      )
    : [results as CompileResult];

  for (let resultIndex = 0; resultIndex < items.length; resultIndex += 1) {
    const exports = compilerSnapshotDenseArray(
      items[resultIndex]!.clientExports,
      'Client exports for minifier reservations',
    );
    for (let exportIndex = 0; exportIndex < exports.length; exportIndex += 1) {
      compilerSetAdd(reserved, exports[exportIndex]!);
    }
  }
  const result: string[] = [];
  compilerSetForEachSorted(reserved, result);
  return result;
}

function compilerSetForEachSorted(values: ReadonlySet<string>, result: string[]): void {
  // The set was populated by pinned operations. Re-scan known values via the captured forEach path
  // so a late Set iterator/sort replacement cannot change the minifier reservation ABI.
  const candidates: string[] = [];
  // `compilerSetForEach` dispatches through the boot-captured Set control.
  compilerSetForEach(values, (value) => {
    appendCompileValue(candidates, value, 'Minifier reservation candidates');
  });
  const selected = compilerCreateSet<number>();
  for (let outputIndex = 0; outputIndex < candidates.length; outputIndex += 1) {
    let bestIndex = -1;
    let best = '';
    for (let index = 0; index < candidates.length; index += 1) {
      if (compilerSetHas(selected, index)) continue;
      const value = candidates[index]!;
      if (bestIndex < 0 || value < best) {
        bestIndex = index;
        best = value;
      }
    }
    if (bestIndex < 0) compilerFailClosed('Minifier reservation candidates must be dense.');
    compilerSetAdd(selected, bestIndex);
    appendCompileValue(result, best, 'Minifier reservations');
  }
}
