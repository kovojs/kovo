import { createRequire } from 'node:module';
import * as ts from 'typescript';

import {
  computeRenderPlanFingerprint,
  type RenderPlanFingerprintInput,
} from '@kovojs/core/internal/render-plan-token';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { collectQueryUpdateCoverage, collectQueryUpdatePlans } from './analyze/query-updates.js';
import {
  dedupeOutputContextFacts,
  mergeQueryUpdatePlans,
  mergeStyleUpdateCoverage,
} from './compile-result.js';
import type { CompilerDiagnostic } from './diagnostics.js';
import {
  componentCssAssetForFile,
  dedupeCss,
  emitCssModule,
  type ComponentCssAsset,
} from './css.js';
import { deriveComponentNames } from './component-names.js';
import { emitClientModule } from './emit/client.js';
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
  inferComponentName,
  jsxElements,
  normalizeComponentFileName,
  parseComponentModule as parseComponentModuleModel,
  parseDiagnosticsForSourceFile,
  firstComponentModel,
  componentOptionObjectEntries,
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
import type {
  CompileComponentOptions,
  CompileResult,
  ClockUpdatePlanFact,
  CompileDependencyFootprint,
  ComponentGraphFact,
  HandlerLowering,
  QueryUpdatePlanFact,
  QueryShape,
  QueryShapeWrapper,
  RenderEquivalenceCheck,
  StateDeriveFact,
  StateDeriveReferenceFact,
  RegistryFacts,
} from './types.js';
import {
  compileArtifactFileNames,
  createEmptyCompileResult,
  emittedFileKind,
  queryShapesFromFacts,
} from './types.js';

const mutableTs = ts as unknown as Record<string, unknown>;
if (!('ScriptTarget' in mutableTs))
  Object.assign(mutableTs, createRequire(import.meta.url)('typescript') as typeof ts);

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
  const parsed = parseComponentPhase(rawOptions);
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
  readonly compileOptions: CompileComponentOptions;
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
  const options = {
    ...rawOptions,
    fileName: normalizeComponentFileName(rawOptions.fileName),
  };

  if (isCompilerIrArtifact(options.source)) {
    return {
      authoringSurfaceDiagnostics: validateAuthoringSurface(options),
      kind: 'compiler-ir',
      options,
    };
  }

  const originalModel = parseComponentModuleModel(options.fileName, options.source);
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
  return {
    lowering,
    model: lowering.model,
    source: lowering.source,
  };
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
  const clockUpdatePlans = collectClockUpdatePlans(
    lowered.model,
    parsed.componentName,
    queryUpdatePlans,
  );
  const updateCoverage = mergeStyleUpdateCoverage(
    collectQueryUpdateCoverage(lowered.model, parsed.compileOptions, parsed.componentName),
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
  const stateDerives = [
    ...lowered.lowering.structuralLowering.stateDerives,
    ...lowered.lowering.styleExtraction.stateDerives,
  ];
  const clientSource = emitClientModule(
    [...validated.handlers],
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
  const versionedHandlers = validated.handlers.map((handler) =>
    versionHandlerLowering(handler, parsed.options.fileName, clientHref),
  );

  return {
    clientHref,
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
  const componentCssSource = emitCssModule(parsed.componentNames.domName, lowered.model);
  const styleCssSource = lowered.lowering.styleExtraction.css
    ? `${cssIrHeader}\n${lowered.lowering.styleExtraction.css}`
    : null;
  const cssSource =
    componentCssSource && styleCssSource
      ? dedupeCss([componentCssSource, styleCssSource])
      : (componentCssSource ?? styleCssSource ?? '');
  const fragmentTargetFacts = findFragmentTargetFacts(
    parsed.componentNames.registryKey,
    lowered.model,
  );
  const fragmentTargets = fragmentTargetFacts.map((fact) => fact.target);
  const liveTargetFacts = findLiveTargetFacts(
    parsed.componentNames.domName,
    parsed.componentNames.registryKey,
    lowered.model,
    validated.updateCoverage,
  );
  const mutationForms = mutationFormExplainFacts(lowered.model, {
    fileName: parsed.options.fileName,
    ...(parsed.compileOptions.registryFacts
      ? { registryFacts: parsed.compileOptions.registryFacts }
      : {}),
    source: lowered.source,
  });
  const componentGraphFacts = [
    componentGraphFact(
      parsed.componentNames.registryKey,
      parsed.componentNames.domName,
      lowered.model,
      fragmentTargets,
      lowered.lowering.styleExtraction.ruleUsages,
      firstComponentModel(parsed.originalModel)?.localName,
      mutationForms,
    ),
  ];
  const cssAssets = cssSource
    ? [
        {
          ...componentCssAssetForFile(
            fileNames.css,
            parsed.componentNames.domName,
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
      domComponentName: parsed.componentNames.domName,
      fragmentTargetFacts,
      handlers: client.versionedHandlers,
      liveTargetFacts,
      platformSubstitutions: lowered.lowering.structuralLowering.platformSubstitutions,
      ...(parsed.options.queryShapeFacts
        ? { queryShapeFacts: parsed.options.queryShapeFacts }
        : {}),
      queryUpdatePlans: validated.queryUpdatePlans,
      ...(parsed.options.registryFacts ? { registryFacts: parsed.options.registryFacts } : {}),
      registryComponentName: parsed.componentNames.registryKey,
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
  const serverRender = serverRenderLowering(
    client.versionedHandlers,
    lowered.model,
    parsed.componentNames.domName,
    {
      fileName: parsed.options.fileName,
      registryComponentName: parsed.componentNames.registryKey,
      ...(parsed.compileOptions.registryFacts
        ? { registryFacts: parsed.compileOptions.registryFacts }
        : {}),
      source: lowered.source,
    },
  );
  const serverRenderReplacements = [
    ...serverRender.replacements,
    ...componentDescriptorNameAssignments(lowered.model, parsed.componentNames.registryKey),
    ...versionStateDeriveReferences(client.stateDeriveReferences),
  ];
  const serverRenderedSource = removeUnreferencedNamedImports(
    appendLiveTargetRendererExports({
      componentExpression: parsed.componentName,
      liveTargetFacts: registryCss.liveTargetFacts,
      source: applyTerminalEmitPatches(lowered.lowering.terminalState, serverRenderReplacements, {
        phase: 'server-emit',
        writer: 'compileComponentModule',
      }),
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
  const diagnostics = [
    ...parsed.authoringSurfaceDiagnostics,
    ...client.versionedHandlers.flatMap((handler) => handler.diagnostics ?? []),
    ...lowered.lowering.structuralLowering.diagnostics,
    ...lowered.lowering.styleExtraction.diagnostics,
    ...server.serverRender.diagnostics,
    ...validated.packagePrefixDiagnostics,
    ...validated.validationDiagnostics,
    ...productionRenderPlanGateDiagnostics(
      parsed.compileOptions,
      client.renderPlanFingerprintInput,
    ),
  ];

  const registryFactsOptions = parsed.compileOptions.registryFacts
    ? { registryFacts: parsed.compileOptions.registryFacts }
    : {};

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
  return {
    componentGraphFacts: registryCss.componentGraphFacts,
    dependencyFootprint: compileDependencyFootprint(parsed.compileOptions, {
      fileName: parsed.options.fileName,
      fragmentTargets: registryCss.fragmentTargets,
      model: lowered.model,
      mutationForms: registryCss.mutationForms,
      queryUpdatePlans: validated.queryUpdatePlans,
      viewTransitionNames: lowered.lowering.structuralLowering.viewTransitionStamps.map(
        (stamp) => stamp.name,
      ),
    }),
    diagnostics: verified.diagnostics,
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
    clientExports: [
      ...client.versionedHandlers.map((handler) => handler.exportName),
      ...client.stateDerives.map((derive) => derive.exportName),
    ],
    cssAssets: registryCss.cssAssets,
    handlerExports: client.versionedHandlers.map((handler) => handler.exportName),
    hmrImpact: createComponentHmrImpactMetadata({
      clientHref: client.clientHref,
      componentGraphFacts: registryCss.componentGraphFacts,
      cssAssets: registryCss.cssAssets,
      diagnostics: verified.diagnostics,
      liveTargetFacts: registryCss.liveTargetFacts,
      queryUpdatePlans: validated.queryUpdatePlans,
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
    outputContextFacts: dedupeOutputContextFacts([
      ...lowered.lowering.structuralLowering.outputContexts,
      ...server.serverRender.outputContexts,
      ...lowered.lowering.styleExtraction.outputContexts,
      ...collectTrustedHtmlOutputContextFacts(parsed.originalModel),
      ...validated.queryUpdatePlans.flatMap((plan) => [...(plan.outputContexts ?? [])]),
      ...client.stateDerives.map((derive) => derive.outputContext),
    ]),
    platformSubstitutions: lowered.lowering.structuralLowering.platformSubstitutions,
    publishToClientFacts: validated.clientCaptureAnalysis.publishFacts,
    queryUpdatePlans: validated.queryUpdatePlans,
    renderEquivalenceChecks: verified.renderEquivalenceChecks,
    renderPlanFingerprint: client.renderPlanFingerprint,
    updateCoverage: validated.updateCoverage,
    viewTransitions: lowered.lowering.structuralLowering.viewTransitionStamps,
  };
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
  const names = new Set<string>();
  for (const plan of usage.queryUpdatePlans) names.add(plan.query);
  for (const component of usage.model.components) {
    for (const option of component.options) {
      if (option.key !== 'queries') continue;
      for (const entry of option.objectEntries ?? []) names.add(entry.key);
    }
  }
  return names;
}

function referencedMutationInputKeys(usage: CompileDependencyFootprintUsage): Set<string> {
  return new Set(usage.mutationForms.map((form) => form.mutation));
}

function previousRegistryComponentDomLeaves(usage: CompileDependencyFootprintUsage): Set<string> {
  return new Set(
    usage.model.components.map(
      (component) => deriveComponentNames(usage.fileName, component).domName,
    ),
  );
}

function compileDependencyReads(reads: {
  fragmentTargets: readonly string[];
  mutationInputKeys: ReadonlySet<string>;
  previousRegistryComponentDomLeaves: ReadonlySet<string>;
  queryShapeNames: readonly string[];
  viewTransitions: readonly string[];
}): CompileDependencyFootprint['reads'] | undefined {
  const fragmentTargets = sortedUnique(reads.fragmentTargets);
  const mutationInputKeys = sortedUnique([...reads.mutationInputKeys]);
  const previousRegistryComponentDomLeaves = sortedUnique([
    ...reads.previousRegistryComponentDomLeaves,
  ]);
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
  return Object.keys(footprint).length === 0 ? undefined : footprint;
}

function slicePreviousRegistryFacts(
  facts: RegistryFacts | undefined,
  usage: CompileDependencyFootprintUsage,
): RegistryFacts | undefined {
  const previousComponents = facts?.components;
  if (!previousComponents) return undefined;

  const domLeaves = previousRegistryComponentDomLeaves(usage);
  const components = previousComponents.filter((name) => domLeaves.has(registryNameLeaf(name)));
  return components.length === 0 ? undefined : { components };
}

function sliceRegistryFacts(
  facts: RegistryFacts | undefined,
  usage: CompileDependencyFootprintUsage,
  mutationKeys = referencedMutationInputKeys(usage),
): RegistryFacts | undefined {
  if (!facts) return undefined;

  const mutationInputs = sliceRecord(facts.mutationInputs, mutationKeys);
  const fragmentTargets = sliceArray(facts.fragmentTargets, new Set(usage.fragmentTargets));
  const viewTransitions = sliceArray(facts.viewTransitions, new Set(usage.viewTransitionNames));
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
  return Object.keys(sliced).length === 0 ? undefined : sliced;
}

function sliceRecord<T>(
  record: Readonly<Record<string, T>> | undefined,
  keys: ReadonlySet<string>,
): Record<string, T> | undefined {
  if (!record || keys.size === 0) return undefined;

  const entries = Object.entries(record).filter(([key]) => keys.has(key));
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function sliceArray<T>(items: readonly T[] | undefined, keys: ReadonlySet<T>): T[] | undefined {
  if (!items || keys.size === 0) return undefined;

  const selected = items.filter((item) => keys.has(item));
  return selected.length === 0 ? undefined : selected;
}

function registryNameLeaf(registryName: string): string {
  return registryName.split('/').at(-1) ?? registryName;
}

function sortedUnique(items: readonly string[]): string[] {
  return [...new Set(items)].sort((left, right) => left.localeCompare(right));
}

function collectClockUpdatePlans(
  model: ComponentModuleModel,
  componentName: string,
  queryUpdatePlans: readonly QueryUpdatePlanFact[],
): ClockUpdatePlanFact[] {
  if (!queryUpdatePlans.some((plan) => plan.query === 'now')) return [];

  const clocks = componentOptionObjectEntries(model, 'clocks')
    .filter((entry) => entry.value && !clockEntryIsRenderOnce(entry))
    .map((entry) => ({ name: entry.key, spec: entry.value! }));

  return clocks.length > 0 ? [{ clocks, componentName }] : [];
}

function clockEntryIsRenderOnce(entry: Pick<ObjectLiteralEntry, 'objectEntries'>): boolean {
  return (entry.objectEntries ?? []).some(
    (field) => field.key === 'renderOnce' && field.value === 'true',
  );
}

function componentDescriptorNameAssignments(
  model: ComponentModuleModel,
  registryComponentName: string,
): SourceReplacement[] {
  const component = firstComponentModel(model);
  if (!component?.localName) return [];

  return [
    {
      end: component.declarationEnd,
      replacement: `\n${component.localName}.name = ${JSON.stringify(registryComponentName)};`,
      start: component.declarationEnd,
    },
  ];
}

export function collectStateDeriveReferenceFacts(
  model: ComponentModuleModel,
  stateDerives: readonly StateDeriveFact[],
  clientHref: string,
): StateDeriveReferenceFact[] {
  if (stateDerives.length === 0) return [];

  const derivesByPlaceholder = new Map(stateDerives.map((derive) => [derive.placeholder, derive]));
  const references: StateDeriveReferenceFact[] = [];

  for (const element of jsxElements(model)) {
    for (const attribute of element.attributes) {
      if (
        !(
          attribute.name === 'data-bind' ||
          attribute.name.startsWith('data-bind:') ||
          // SPEC §4.8 data-bind-prop: version the live-property stamp's derive
          // reference identically to its data-bind:<attr> sibling.
          attribute.name.startsWith('data-bind-prop:')
        ) ||
        !attribute.value
      ) {
        continue;
      }

      const derive = derivesByPlaceholder.get(attribute.value);
      if (!derive) continue;

      references.push({
        attr: attribute.name,
        clientHref,
        exportName: derive.exportName,
        placeholder: derive.placeholder,
        target: { end: attribute.end, start: attribute.start },
        value: `${clientHref}#${derive.exportName}`,
        writer: 'state derive URL versioning',
      });
    }
  }

  return references;
}

function versionStateDeriveReferences(
  references: readonly StateDeriveReferenceFact[],
): SourceReplacement[] {
  return references.map((reference) => ({
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
          : ` expected=${JSON.stringify(check.expected)} actual=${JSON.stringify(check.actual)}`;
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

  const shapesChanged =
    JSON.stringify(sortedRecord(before)) !== JSON.stringify(sortedRecord(after));

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
  return Object.keys(record)
    .sort()
    .map((k) => [k, record[k] as string]);
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
  for (const [name, shape] of Object.entries(shapes)) {
    input[name] = stableQueryShapeSignature(shape);
  }
  return input;
}

function stableQueryShapeSignature(shape: QueryShape): string {
  if (Array.isArray(shape)) return `[${shape.map(stableQueryShapeSignature).join(',')}]`;
  if (typeof shape === 'string') return shape;
  if (isQueryShapeWrapper(shape)) {
    return `${shape.kind}<${stableQueryShapeSignature(shape.shape)}>`;
  }

  const objectShape = shape as Readonly<Record<string, QueryShape>>;
  return `{${Object.keys(shape)
    .sort()
    .map((key) => `${key}:${stableQueryShapeSignature(objectShape[key] ?? 'object')}`)
    .join(',')}}`;
}

function isQueryShapeWrapper(shape: QueryShape): shape is QueryShapeWrapper {
  if (typeof shape !== 'object' || shape === null || Array.isArray(shape)) return false;
  return (
    'kind' in shape &&
    'shape' in shape &&
    (shape.kind === 'nullable' ||
      shape.kind === 'optional' ||
      shape.kind === 'secret' ||
      shape.kind === 'volatile-time' ||
      (shape.kind === 'revealed' && 'reveal' in shape))
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
  const reserved = new Set<string>();
  const items = Array.isArray(results) ? results : [results];

  for (const result of items) {
    for (const exportName of result.clientExports) reserved.add(exportName);
  }

  return [...reserved].sort();
}
