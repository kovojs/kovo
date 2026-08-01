import type * as TS from 'typescript';

import {
  computeRenderPlanFingerprint,
  encodeRenderPlanFrame,
  type RenderPlanFingerprintInput,
} from '@kovojs/core/internal/render-plan-token';
import {
  assertRegisteredDiagnostic,
  createRegisteredDiagnostic,
} from '@kovojs/core/internal/diagnostics';
import {
  callExpressionAtSpan,
  expressionResolvesToFrameworkExport,
  frameworkExport,
  registerFrameworkIdentityProject,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';
import type * as CoreGraph from '@kovojs/core/internal/graph';
import type { SourceAnchor } from '@kovojs/core/internal/graph';
import { formatKovoModuleRef, kovoModuleRef } from '@kovojs/core/internal/module-ref';
import {
  browserPostureManifestSchema,
  browserSecurityOperationKinds,
  isBrowserSecurityOperationKind,
  type BrowserPostureManifest,
  type BrowserSecurityOperationKind,
} from '@kovojs/core/internal/security-operation-ir';
import { verifyEmittedTranslation } from '@kovojs/verify/internal/translation';

import { collectQueryUpdateCoverage, collectQueryUpdatePlans } from './analyze/query-updates.js';
import { jsxAttributes } from './analyze/query-internal.js';
import { canonicalJson } from './canonical-json.js';
import { mergeQueryUpdatePlans, mergeStyleUpdateCoverage } from './compile-result.js';
import { snapshotCompileComponentOptions } from './compile-options.js';
import { createCompileFactLedger, type CompileFactSnapshot } from './compile-fact-ledger.js';
import { compilerOwnedAppContractFactoryEquals } from './app-contract-resolver.js';
import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateNullRecord,
  compilerCreateSet,
  compilerDefineOwnDataProperty,
  compilerFailClosed,
  compilerFreeze,
  compilerJsonStringify,
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
  type StyleRuleUsage,
} from './css.js';
import { deriveComponentNames } from './component-names.js';
import { deriveMutationKey } from './mutation-names.js';
import { deriveRegistryIdentity } from './registry-identities.js';
import {
  emittedClientPlanExportMetadata,
  emitClientModule,
  emitClientModuleImportManifest,
  rewriteClientModuleRuntimeImportsForBrowser,
} from './emit/client.js';
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
  clientModuleRepresentationIdentity,
  clientModuleUrl,
  lowerEventHandlers,
  versionHandlerLowering,
} from './lower/handlers.js';
import { runLoweringPipeline } from './lowering-pipeline.js';
import {
  handlerWriteSinkUsesManagedAppTransaction,
  handlerWriteSinks,
  inferComponentName,
  callExpressions,
  jsxElements,
  jsxExpressions,
  normalizeComponentFileName,
  parseComponentModule as parseComponentModuleModel,
  parseDiagnosticsForSourceFile,
  parseSourceFile,
  firstComponentModel,
  componentHasInferredFragmentTarget,
  componentModelForSourceSpan,
  componentOptionObjectEntries,
  componentOptionObjectEntriesFor,
  jsxComments,
  jsxAttributeSemanticStringValue,
  parserFactCompilerGeneratedComponentControlName,
  type CallExpressionModel,
  type ComponentModel,
  type ComponentModuleModel,
  type ObjectLiteralEntry,
  type TaskCompositionEdgeModel,
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
import { secretQueryWireDecisionFacts } from './validate/confidentiality.js';
import { validatePackageComponentPrefixes } from './validate/package-prefixes.js';
import { collectCompilerDiagnostics } from './validate/pipeline.js';
import {
  escapeAttribute,
  generatedOffsetToOriginal,
  originalOffsetToGenerated,
  type SourceOffsetMap,
  type SourceReplacement,
} from './shared.js';
import { collectTrustedHtmlOutputContextFacts } from './security/output-context.js';
import { componentCacheInfluenceFacts } from './cache-influence-facts.js';
import { agentGraphFactsFromModel } from './agent-tool-facts.js';
import {
  componentSecurityOperationFacts,
  componentSecuritySemanticGraphFacts,
  serverSecurityOperationFacts,
} from './security-operation-facts.js';
import { compilerEmittedSourceProvenanceToken } from './source-provenance.js';
import { typescriptRuntime as ts } from './ts-api.js';
import type {
  CompileComponentOptions,
  CompileResult,
  ClockUpdatePlanFact,
  CompileDependencyFootprint,
  ComponentGraphFact,
  EndpointGraphFact,
  HandlerWriteSinkFact,
  HandlerLowering,
  QueryDeriveFact,
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
  elementParamNameFromAttribute,
  emittedFileKind,
  queryShapesFromFacts,
} from './types.js';

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
  readonly packagePrefixDiscoveryBoundary?: string;
  readonly packagePrefixDiscoveryRootWitness?: import('./source-filesystem.js').CompilerSourceRootWitness;
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
  readonly authoredSourceAnchors: AuthoredSourceAnchorIndex;
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
  readonly confidentialityClosed: boolean;
  readonly cssAssets: readonly ComponentCssAsset[];
  readonly cssSource: string;
  readonly fileNames: ReturnType<typeof compileArtifactFileNames>;
  readonly fragmentTargetFacts: ReturnType<typeof findFragmentTargetFacts>;
  readonly fragmentTargets: readonly string[];
  readonly liveTargetFacts: ReturnType<typeof findLiveTargetFacts>;
  readonly mutationForms: MutationFormFacts;
  readonly registrySource: string;
  readonly secretFieldNames: readonly string[];
}

interface EmitServerPhaseResult {
  readonly serverModule: EmittedServerModule;
  readonly serverRender: ServerRenderLowering;
  readonly serverRenderedSource: string;
}

function authoredComponentSourceAnchor(
  model: ComponentModuleModel,
  fileName: string,
  localName: string | undefined,
): SourceAnchor | undefined {
  const components = compilerSnapshotDenseArray(
    model.components,
    `Authored component declarations for ${fileName}`,
  );
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index]!;
    if (
      (localName === undefined ? components.length !== 1 : component.localName !== localName) ||
      component.localNameSpan === undefined
    ) {
      continue;
    }
    return {
      end: component.declarationEnd,
      file: fileName,
      start: component.localNameSpan.start,
    };
  }
  return undefined;
}

interface ComponentFeedbackExplainInput {
  readonly authoredSourceAnchors: AuthoredSourceAnchorIndex;
  readonly clientHref: string;
  readonly component: ComponentModel;
  readonly fileName: string;
  readonly handlers: readonly HandlerLowering[];
  readonly loweredModel: ComponentModuleModel;
  readonly originalModel: ComponentModuleModel;
  readonly queryUpdatePlans: readonly QueryUpdatePlanFact[];
  readonly sourceOffsetMap: SourceOffsetMap;
  readonly stateDerives: readonly StateDeriveFact[];
}

function componentFeedbackExplainFacts(
  input: Omit<ComponentFeedbackExplainInput, 'component'> & {
    readonly component: ComponentModel | null;
  },
): Pick<CoreGraph.ComponentExplain, 'derives' | 'handlers' | 'suppressions' | 'triggers'> {
  if (input.component === null) return {};
  const componentInput: ComponentFeedbackExplainInput = {
    ...input,
    component: input.component,
  };
  const handlerFacts = componentHandlerExplainFacts(componentInput);
  const derives = componentDeriveExplainFacts(componentInput);
  const suppressions = componentDiagnosticSuppressionFacts(componentInput);
  return {
    ...(derives.length === 0 ? {} : { derives }),
    ...(handlerFacts.handlers.length === 0 ? {} : { handlers: handlerFacts.handlers }),
    ...(suppressions.length === 0 ? {} : { suppressions }),
    ...(handlerFacts.triggers.length === 0 ? {} : { triggers: handlerFacts.triggers }),
  };
}

function componentHandlerExplainFacts(input: ComponentFeedbackExplainInput): {
  handlers: CoreGraph.HandlerExplain[];
  triggers: CoreGraph.TriggerExplain[];
} {
  const handlers: CoreGraph.HandlerExplain[] = [];
  const triggers: CoreGraph.TriggerExplain[] = [];
  const source = compilerSnapshotDenseArray(input.handlers, 'Component explain handlers');
  for (let index = 0; index < source.length; index += 1) {
    const handler = source[index]!;
    const generatedSpan = { end: handler.attributeEnd, start: handler.attributeStart };
    if (componentModelForSourceSpan(input.loweredModel, generatedSpan) !== input.component)
      continue;
    const authored =
      authoredSourceAnchorForGeneratedSpan(input.fileName, generatedSpan, input.sourceOffsetMap) ??
      authoredComponentSourceAnchor(input.originalModel, input.fileName, input.component.localName);
    if (authored === undefined) continue;

    const params = compilerMapDense(
      handler.params,
      'Component explain handler parameters',
      (param) => elementParamNameFromAttribute(param.attributeName),
    );
    const event = compilerStringStartsWith(handler.attributeName, 'on:')
      ? compilerStringSlice(handler.attributeName, 'on:'.length)
      : handler.attributeName;
    if (event === 'idle' || event === 'load' || event === 'visible') {
      const justification = triggerJustification(input.originalModel, authored.start);
      appendCompileValue(
        triggers,
        {
          ...(params.length === 0 ? {} : { deps: params }),
          exportName: handler.exportName,
          generatedFrom: authored,
          ...(justification === undefined ? {} : { justification }),
          ref: handler.attributeValue,
          source: authored,
          trigger: event,
        },
        'Component explain trigger facts',
      );
      continue;
    }

    const captures: CoreGraph.CaptureChannel[] = ['ctx'];
    if (params.length > 0) appendCompileValue(captures, 'element-params', 'Handler captures');
    if ((handler.clientConstants?.length ?? 0) > 0 || (handler.clientImports?.length ?? 0) > 0) {
      appendCompileValue(captures, 'module-scope', 'Handler captures');
    }
    appendCompileValue(
      handlers,
      {
        captures,
        event,
        exportName: handler.exportName,
        generatedFrom: authored,
        ...(params.length === 0 ? {} : { params }),
        ref: handler.attributeValue,
        source: authored,
      },
      'Component explain handler facts',
    );
  }
  return { handlers, triggers };
}

function componentDeriveExplainFacts(
  input: ComponentFeedbackExplainInput,
): CoreGraph.DeriveExplain[] {
  const output: CoreGraph.DeriveExplain[] = [];
  const seen = compilerCreateSet<string>();
  const plans = compilerSnapshotDenseArray(
    input.queryUpdatePlans,
    'Component explain query-update plans',
  );
  for (let planIndex = 0; planIndex < plans.length; planIndex += 1) {
    const plan = plans[planIndex]!;
    const derives = compilerSnapshotDenseArray(
      plan.derives ?? [],
      'Component explain query derives',
    );
    for (let index = 0; index < derives.length; index += 1) {
      appendQueryDeriveExplainFact(
        output,
        seen,
        input,
        plan,
        derives[index]!,
        derives[index]!.selector,
      );
    }
    const stamps = compilerSnapshotDenseArray(
      plan.stamps ?? [],
      'Component explain query derive stamps',
    );
    for (let index = 0; index < stamps.length; index += 1) {
      const stamp = stamps[index]!;
      appendQueryDeriveExplainFact(output, seen, input, plan, stamp.derive, stamp.selector);
    }
  }

  const stateDerives = compilerSnapshotDenseArray(
    input.stateDerives,
    'Component explain state derives',
  );
  for (let index = 0; index < stateDerives.length; index += 1) {
    const derive = stateDerives[index]!;
    const generatedSpan = derive.sourceSpan;
    if (
      generatedSpan !== undefined &&
      componentModelForSourceSpan(input.loweredModel, generatedSpan) !== input.component
    ) {
      continue;
    }
    if (
      generatedSpan === undefined &&
      input.component.localName !== undefined &&
      !compilerStringStartsWith(derive.exportName, `${input.component.localName}$`)
    ) {
      continue;
    }
    const source =
      authoredSourceAnchorForReactivePaths(input.authoredSourceAnchors, derive.sourcePaths ?? []) ??
      (generatedSpan === undefined
        ? undefined
        : authoredSourceAnchorForGeneratedSpan(
            input.fileName,
            generatedSpan,
            input.sourceOffsetMap,
          )) ??
      authoredComponentSourceAnchor(input.originalModel, input.fileName, input.component.localName);
    if (source === undefined) continue;
    const key = `${derive.exportName}\0${derive.placeholder}\0${source.start}\0${source.end}`;
    if (compilerSetHas(seen, key)) continue;
    compilerSetAdd(seen, key);
    const inputs =
      derive.sourcePaths === undefined || derive.sourcePaths.length === 0
        ? ['state']
        : compilerSnapshotDenseArray(derive.sourcePaths, 'Component explain state derive inputs');
    appendCompileValue(
      output,
      {
        generatedFrom: source,
        inputs,
        name: derive.name,
        ref: `${input.clientHref}#${derive.exportName}`,
        source,
        target: derive.placeholder,
      },
      'Component explain state derive facts',
    );
  }
  return output;
}

function appendQueryDeriveExplainFact(
  output: CoreGraph.DeriveExplain[],
  seen: Set<string>,
  input: ComponentFeedbackExplainInput,
  plan: QueryUpdatePlanFact,
  derive: QueryDeriveFact,
  target: string,
): void {
  const ownershipSpan = derive.generatedFromSpan ?? derive.sourceSpan;
  if (
    ownershipSpan !== undefined &&
    componentModelForSourceSpan(input.loweredModel, ownershipSpan) !== input.component
  ) {
    return;
  }
  if (
    ownershipSpan === undefined &&
    input.component.localName !== undefined &&
    plan.componentName !== input.component.localName
  ) {
    return;
  }
  const componentSource = authoredComponentSourceAnchor(
    input.originalModel,
    input.fileName,
    input.component.localName,
  );
  const source =
    (derive.sourceSpan === undefined
      ? undefined
      : authoredSourceAnchorForGeneratedSpan(
          input.fileName,
          derive.sourceSpan,
          input.sourceOffsetMap,
        )) ?? componentSource;
  const generatedFrom =
    (derive.generatedFromSpan === undefined
      ? undefined
      : authoredSourceAnchorForGeneratedSpan(
          input.fileName,
          derive.generatedFromSpan,
          input.sourceOffsetMap,
        )) ?? source;
  if (source === undefined) return;
  const key = `${derive.exportName}\0${target}\0${source.start}\0${source.end}`;
  if (compilerSetHas(seen, key)) return;
  compilerSetAdd(seen, key);
  const inputs = compilerSnapshotDenseArray(
    derive.inputs ?? [derive.input],
    'Component explain query derive inputs',
  );
  appendCompileValue(
    output,
    {
      ...(generatedFrom === undefined ? {} : { generatedFrom }),
      inputs,
      name: derive.name,
      ref: `${input.clientHref}#${derive.exportName}`,
      source,
      target,
    },
    'Component explain query derive facts',
  );
}

function componentDiagnosticSuppressionFacts(
  input: ComponentFeedbackExplainInput,
): CoreGraph.DiagnosticSuppressionExplain[] {
  const output: CoreGraph.DiagnosticSuppressionExplain[] = [];
  const comments = compilerSnapshotDenseArray(
    jsxComments(input.originalModel),
    'Component explain diagnostic suppressions',
  );
  const attributes = compilerSnapshotDenseArray(
    jsxAttributes(input.originalModel),
    'Component explain suppression targets',
  );
  for (let index = 0; index < comments.length; index += 1) {
    const comment = comments[index]!;
    if (
      comment.justifiedDiagnostics === undefined ||
      comment.justifiedDiagnostics.length === 0 ||
      !originalSpanBelongsToComponent(input.originalModel, input.component, comment)
    ) {
      continue;
    }
    let target: SourceAnchor | undefined;
    if (comment.attachedAttributeStart !== undefined) {
      for (let attributeIndex = 0; attributeIndex < attributes.length; attributeIndex += 1) {
        const attribute = attributes[attributeIndex]!;
        if (attribute.start !== comment.attachedAttributeStart) continue;
        target = { end: attribute.end, file: input.fileName, start: attribute.start };
        break;
      }
    }
    appendCompileValue(
      output,
      {
        codes: compilerSnapshotDenseArray(
          comment.justifiedDiagnostics,
          'Component explain suppression codes',
        ),
        source: { end: comment.end, file: input.fileName, start: comment.start },
        ...(target === undefined ? {} : { target }),
      },
      'Component explain diagnostic suppression facts',
    );
  }
  return output;
}

function originalSpanBelongsToComponent(
  model: ComponentModuleModel,
  loweredComponent: ComponentModel,
  span: { end: number; start: number },
): boolean {
  const original = componentModelForSourceSpan(model, span);
  if (original === null) return false;
  if (loweredComponent.localName !== undefined) {
    return original.localName === loweredComponent.localName;
  }
  return model.components.length === 1;
}

function triggerJustification(
  originalModel: ComponentModuleModel,
  targetStart: number,
): string | undefined {
  const comments = compilerSnapshotDenseArray(
    jsxComments(originalModel),
    'Execution trigger justifications',
  );
  for (let index = 0; index < comments.length; index += 1) {
    const comment = comments[index]!;
    if (
      comment.attachedAttributeStart === targetStart &&
      containsCompilerString(comment.justifiedDiagnostics ?? [], 'KV211')
    ) {
      return comment.text;
    }
  }
  return undefined;
}

function containsCompilerString(values: readonly string[], expected: string): boolean {
  const source = compilerSnapshotDenseArray(values, 'Compiler string membership');
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === expected) return true;
  }
  return false;
}

function authoredSourceAnchorForGeneratedSpan(
  file: string,
  span: { end: number; start: number },
  sourceOffsetMap: SourceOffsetMap,
): SourceAnchor | undefined {
  const start = generatedOffsetToOriginal(sourceOffsetMap, span.start);
  const end =
    span.end === span.start
      ? start
      : generatedOffsetToOriginal(sourceOffsetMap, Math.max(span.start, span.end - 1));
  if (start === undefined || end === undefined) return undefined;
  return { end: span.end === span.start ? end : end + 1, file, start };
}

function sourceAnchoredUpdateCoverage(
  coverage: readonly import('./types.js').QueryUpdateCoverageFact[],
  originalModel: ComponentModuleModel,
  fileName: string,
  sourceOffsetMap: SourceOffsetMap,
  authoredSourceAnchors: AuthoredSourceAnchorIndex,
): import('./types.js').QueryUpdateCoverageFact[] {
  return compilerMapDense(coverage, 'Source-anchored update coverage', (fact) => {
    const generatedSpan =
      fact.sourceSpan === undefined
        ? undefined
        : {
            end: fact.sourceSpan.start + fact.sourceSpan.length,
            start: fact.sourceSpan.start,
          };
    const sourceAnchor =
      (generatedSpan === undefined
        ? undefined
        : authoredSourceAnchorForGeneratedSpan(fileName, generatedSpan, sourceOffsetMap)) ??
      authoredCoverageSourceAnchor(fact, authoredSourceAnchors) ??
      authoredComponentSourceAnchor(originalModel, fileName, fact.componentName) ??
      authoredComponentSourceAnchor(originalModel, fileName, undefined);
    const output: import('./types.js').QueryUpdateCoverageFact = {
      componentName: fact.componentName,
      ...(fact.detail === undefined ? {} : { detail: fact.detail }),
      position: fact.position,
      query: fact.query,
      ...(fact.source === undefined ? {} : { source: fact.source }),
      ...(fact.status === 'UNHANDLED' && fact.sourceSpan !== undefined
        ? { sourceSpan: fact.sourceSpan }
        : {}),
      status: fact.status,
    };
    if (sourceAnchor !== undefined) {
      compilerDefineOwnDataProperty(output, 'sourceAnchor', sourceAnchor, false);
    }
    return output;
  });
}

function authoredCoverageSourceAnchor(
  fact: import('./types.js').QueryUpdateCoverageFact,
  authoredSourceAnchors: AuthoredSourceAnchorIndex,
): SourceAnchor | undefined {
  const direct = authoredSourceAnchorForReactivePath(authoredSourceAnchors, fact.query);
  if (direct !== undefined || !compilerStringStartsWith(fact.query, 'state.')) return direct;

  const deriveExportName = compilerStringSlice(fact.query, 'state.'.length);
  const sourcePaths = compilerMapGet(
    authoredSourceAnchors.stateDeriveSourcePaths,
    deriveExportName,
  );
  return sourcePaths === undefined
    ? undefined
    : authoredSourceAnchorForReactivePaths(authoredSourceAnchors, sourcePaths);
}

interface AuthoredReactiveSourceAnchor {
  readonly anchor: SourceAnchor;
  readonly order: number;
}

interface AuthoredSourceAnchorIndex {
  readonly reactiveByPath: Map<string, AuthoredReactiveSourceAnchor>;
  readonly stateDeriveSourcePaths: Map<string, readonly string[]>;
}

function createAuthoredSourceAnchorIndex(
  model: ComponentModuleModel,
  fileName: string,
  stateDerives: readonly StateDeriveFact[],
): AuthoredSourceAnchorIndex {
  const reactiveByPath = compilerCreateMap<string, AuthoredReactiveSourceAnchor>();
  let order = 0;
  const attributes = compilerSnapshotDenseArray(
    jsxAttributes(model),
    'Authored reactive JSX attributes',
  );
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    const semanticValue = jsxAttributeSemanticStringValue(attribute);
    if (
      semanticValue !== undefined &&
      (attribute.name === 'data-bind' ||
        attribute.name === 'data-bind-list' ||
        compilerStringStartsWith(attribute.name, 'data-bind:'))
    ) {
      order = indexAuthoredReactivePath(
        reactiveByPath,
        semanticValue,
        { end: attribute.end, file: fileName, start: attribute.start },
        order,
      );
    }
    order = indexAuthoredReactiveAccesses(
      reactiveByPath,
      attribute.expressionPropertyAccesses ?? [],
      fileName,
      order,
    );
  }

  const expressions = compilerSnapshotDenseArray(
    jsxExpressions(model),
    'Authored reactive JSX expressions',
  );
  for (let index = 0; index < expressions.length; index += 1) {
    order = indexAuthoredReactiveAccesses(
      reactiveByPath,
      expressions[index]!.propertyAccesses,
      fileName,
      order,
    );
  }

  const calls = compilerSnapshotDenseArray(callExpressions(model), 'Authored reactive calls');
  for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
    const groups = compilerSnapshotDenseArray(
      calls[callIndex]!.argumentPropertyAccesses,
      'Authored reactive call arguments',
    );
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      order = indexAuthoredReactiveAccesses(reactiveByPath, groups[groupIndex]!, fileName, order);
    }
  }

  const stateDeriveSourcePaths = compilerCreateMap<string, readonly string[]>();
  const derives = compilerSnapshotDenseArray(stateDerives, 'Coverage state derive provenance');
  for (let index = 0; index < derives.length; index += 1) {
    const derive = derives[index]!;
    if (compilerMapGet(stateDeriveSourcePaths, derive.exportName) !== undefined) continue;
    compilerMapSet(
      stateDeriveSourcePaths,
      derive.exportName,
      compilerSnapshotDenseArray(derive.sourcePaths ?? [], 'Coverage state derive source paths'),
    );
  }

  return { reactiveByPath, stateDeriveSourcePaths };
}

function indexAuthoredReactiveAccesses(
  target: Map<string, AuthoredReactiveSourceAnchor>,
  accesses: readonly { readonly end: number; readonly path: string; readonly start: number }[],
  fileName: string,
  initialOrder: number,
): number {
  const source = compilerSnapshotDenseArray(accesses, 'Authored reactive property accesses');
  let order = initialOrder;
  for (let index = 0; index < source.length; index += 1) {
    const access = source[index]!;
    order = indexAuthoredReactivePath(
      target,
      access.path,
      { end: access.end, file: fileName, start: access.start },
      order,
    );
  }
  return order;
}

function indexAuthoredReactivePath(
  target: Map<string, AuthoredReactiveSourceAnchor>,
  path: string,
  anchor: SourceAnchor,
  order: number,
): number {
  if (compilerMapGet(target, path) === undefined) {
    compilerMapSet(target, path, { anchor, order });
  }
  return order + 1;
}

function authoredSourceAnchorForReactivePath(
  index: AuthoredSourceAnchorIndex,
  path: string,
): SourceAnchor | undefined {
  return compilerMapGet(index.reactiveByPath, path)?.anchor;
}

function authoredSourceAnchorForReactivePaths(
  index: AuthoredSourceAnchorIndex,
  paths: readonly string[],
): SourceAnchor | undefined {
  const source = compilerSnapshotDenseArray(paths, 'Authored reactive source paths');
  let earliest: AuthoredReactiveSourceAnchor | undefined;
  for (let pathIndex = 0; pathIndex < source.length; pathIndex += 1) {
    const candidate = compilerMapGet(index.reactiveByPath, source[pathIndex]!);
    if (candidate !== undefined && (earliest === undefined || candidate.order < earliest.order)) {
      earliest = candidate;
    }
  }
  return earliest?.anchor;
}

function authoredStyleRuleUsages(
  loweredUsages: readonly StyleRuleUsage[],
  authoredUsages: readonly StyleRuleUsage[],
): StyleRuleUsage[] {
  const lowered = compilerSnapshotDenseArray(loweredUsages, 'Lowered style rule usages');
  const authored = compilerSnapshotDenseArray(authoredUsages, 'Authored style rule usages');
  const authoredByIdentity = compilerCreateMap<
    string,
    { count: number; generatedFrom: SourceAnchor | undefined }
  >();
  for (let index = 0; index < authored.length; index += 1) {
    const usage = authored[index]!;
    const identity = styleRuleUsageIdentity(usage);
    const previous = compilerMapGet(authoredByIdentity, identity);
    compilerMapSet(authoredByIdentity, identity, {
      count: (previous?.count ?? 0) + 1,
      generatedFrom: usage.generatedFrom,
    });
  }
  return compilerMapDense(lowered, 'Source-anchored style rule usages', (usage) => {
    const authoredMatch = compilerMapGet(authoredByIdentity, styleRuleUsageIdentity(usage));
    return {
      className: usage.className,
      ...(authoredMatch?.count === 1 && authoredMatch.generatedFrom !== undefined
        ? { generatedFrom: authoredMatch.generatedFrom }
        : {}),
      moduleFileName: usage.moduleFileName,
      source: usage.source,
      styleRef: usage.styleRef,
    };
  });
}

function styleRuleUsageIdentity(usage: StyleRuleUsage): string {
  return canonicalJson([usage.className, usage.moduleFileName, usage.source, usage.styleRef]);
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
  sourceFile: TS.SourceFile,
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
    clientCaptureAnalysis,
  );
  const queryUpdatePlans = mergeQueryUpdatePlans([
    ...collectQueryUpdatePlans(lowered.model, parsed.componentName),
    ...styleExtraction.queryUpdatePlans,
  ]);
  const stateDerives = [
    ...lowered.lowering.structuralLowering.stateDerives,
    ...styleExtraction.stateDerives,
  ];
  const authoredSourceAnchors = createAuthoredSourceAnchorIndex(
    parsed.originalModel,
    parsed.options.fileName,
    stateDerives,
  );
  const clockUpdatePlans = collectClockUpdatePlans(
    lowered.model,
    parsed.componentName,
    queryUpdatePlans,
  );
  const updateCoverage = sourceAnchoredUpdateCoverage(
    mergeStyleUpdateCoverage(
      collectQueryUpdateCoverage(
        lowered.model,
        parsed.compileOptions,
        parsed.componentName,
        stateDerives,
        lowered.lowering.validationOffsetMap,
      ),
      styleExtraction.updateCoverage,
      styleExtraction.handledSpans,
    ),
    parsed.originalModel,
    parsed.options.fileName,
    lowered.lowering.validationOffsetMap,
    authoredSourceAnchors,
  );

  return {
    authoredSourceAnchors,
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
  // SPEC §5.2.1/§14: immutable module identity covers the exact final browser representation,
  // after the compiler-owned generated-runtime import rewrite. Render-plan identity stays separate.
  const browserClientSource = rewriteClientModuleRuntimeImportsForBrowser(clientSource);
  const clientHref = clientModuleUrl(
    parsed.options.fileName,
    clientModuleRepresentationIdentity(browserClientSource),
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
  const secretWireDecision = secretQueryWireDecisionFacts(lowered.model, parsed.compileOptions);
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
  const styleRuleUsages = authoredStyleRuleUsages(
    lowered.lowering.styleExtraction.ruleUsages,
    lowered.lowering.styleSpanProbe.ruleUsages,
  );
  // Explain provenance is authored-source provenance. Derive it from the pinned original model so
  // earlier lowering insertions cannot shift a form's offsets into generated source.
  const mutationForms = mutationFormExplainFacts(parsed.originalModel, {
    fileName: parsed.options.fileName,
    ...(parsed.compileOptions.registryFacts
      ? { registryFacts: parsed.compileOptions.registryFacts }
      : {}),
    source: parsed.options.source,
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
        index === 0 ? styleRuleUsages : [],
        fact.component?.localName,
        index === 0 ? mutationForms : [],
        fact.component,
        parsed.options.fileName,
        index === 0 ? componentCacheInfluenceFacts(parsed.originalModel) : [],
        // SPEC §5.2 rule 9 / §6.6: server security operations remain bound to the exact authored
        // Program snapshot. Style extraction reparses transformed source whose spans cannot
        // authenticate app-scoped factory facts, while browser operations are already carried by
        // the versioned handler lowerings.
        index === 0
          ? componentSecurityOperationFacts(parsed.originalModel, client.versionedHandlers)
          : [],
        index === 0 ? componentSecuritySemanticGraphFacts(parsed.originalModel) : undefined,
        authoredComponentSourceAnchor(
          parsed.originalModel,
          parsed.options.fileName,
          fact.component?.localName,
        ),
        componentFeedbackExplainFacts({
          authoredSourceAnchors: validated.authoredSourceAnchors,
          clientHref: client.clientHref,
          component: fact.component,
          fileName: parsed.options.fileName,
          handlers: client.versionedHandlers,
          loweredModel: lowered.model,
          originalModel: parsed.originalModel,
          queryUpdatePlans: validated.queryUpdatePlans,
          sourceOffsetMap: lowered.lowering.validationOffsetMap,
          stateDerives: client.stateDerives,
        }),
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
          ...(styleRuleUsages.length > 0 ? { styleRuleUsages } : {}),
        },
      ]
    : [];

  return {
    componentGraphFacts,
    confidentialityClosed: secretWireDecision.refusedQueryNames.length > 0,
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
      refusedQueryNames: secretWireDecision.refusedQueryNames,
      ...(parsed.options.registryFacts ? { registryFacts: parsed.options.registryFacts } : {}),
      registryComponentName: primaryComponentNames.registryKey,
      viewTransitions: lowered.lowering.structuralLowering.viewTransitionStamps,
    }),
    secretFieldNames: secretWireDecision.fieldNames,
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
      ...(parsed.compileOptions.extraFiles?.length
        ? { extraFiles: parsed.compileOptions.extraFiles }
        : {}),
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
    derivedMutationKeyAssignments(
      parsed.originalModel,
      parsed.options.fileName,
      lowered.source,
      lowered.lowering.validationOffsetMap,
    ),
    'Derived mutation-key replacements',
  );
  serverRenderReplacements = compilerAppendDense(
    serverRenderReplacements,
    derivedQueryKeyAssignments(
      parsed.originalModel,
      parsed.options.fileName,
      lowered.source,
      lowered.lowering.validationOffsetMap,
    ),
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
  const terminalImportInsertionOffset = generatedImportOffsetAfterPatches(
    lowered.model.moduleImportInsertionOffset,
    serverRenderReplacements,
  );
  const derivedWireKeySource = insertDerivedWireKeyImports(
    patchedServerSource,
    parsed.originalModel,
    lowered.model,
    terminalImportInsertionOffset,
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
      moduleImportInsertionOffset: derivedWireKeySource.nextImportInsertionOffset,
      namedImports: lowered.model.namedImports,
      source: derivedWireKeySource.source,
      sourceIdentifierNames: lowered.model.sourceIdentifierNames,
    }),
  );

  return {
    // SPEC §5.2 rule 9 / §6.6: the generated manifest carries operations and semantic roots from
    // the same exact authored model. A lowered style reparse is an emitted artifact, not a second
    // authority source for app-scoped handler identity.
    serverModule: emitServerModule(serverRenderedSource, parsed.originalModel),
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
    ...(parsed.compileOptions.extraFiles?.length
      ? { extraFiles: parsed.compileOptions.extraFiles }
      : {}),
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
    assertRegisteredDiagnostic(value, `${label}[${index}]`);
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
    parsed.options.fileName,
  );
  const confidentialityClosed = registryCss.confidentialityClosed;
  const files: CompileResult['files'] = [
    {
      fileName: registryCss.fileNames.server,
      kind: 'server',
      source: server.serverModule.source,
    },
    {
      fileName: registryCss.fileNames.client,
      kind: 'client',
      source: confidentialityClosed ? '' : client.clientSource,
    },
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
      source: confidentialityClosed ? '' : registryCss.registrySource,
    },
  ];
  assertEmittedTranslation(client, registryCss, files, confidentialityClosed, parsed.originalModel);
  const queryPlanBootstrapMetadata = emittedClientPlanExportMetadata(
    parsed.componentName,
    parsed.componentNames.registryKey,
    validated.queryUpdatePlans,
    validated.clockUpdatePlans,
    localQueryPlanRuntimeNames(parsed.originalModel, parsed.options.fileName),
  );

  return {
    agentGraphFacts: agentGraphFactsFromModel(parsed.originalModel, parsed.options.fileName),
    browserPostureManifest: compileBrowserPostureManifest(lowered, validated.handlers),
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
    files,
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
    ...(queryPlanBootstrapMetadata === undefined ? {} : { queryPlanBootstrapMetadata }),
    renderEquivalenceChecks: verified.renderEquivalenceChecks,
    renderPlanFingerprint: client.renderPlanFingerprint,
    renderPlanFingerprintInput: client.renderPlanFingerprintInput,
    taskGraphFacts: facts.taskGraphFacts,
    updateCoverage: facts.queryUpdateCoverage,
    viewTransitions: facts.viewTransitions,
  };
}

function compileBrowserPostureManifest(
  lowered: LowerComponentPhaseResult,
  handlers: readonly HandlerLowering[],
): BrowserPostureManifest {
  const seen = compilerCreateSet<BrowserSecurityOperationKind>();
  let hasUnclosedBrowserAuthority = false;
  const handlerLength = compilerArrayLength(handlers, 'Browser posture handlers');
  for (let handlerIndex = 0; handlerIndex < handlerLength; handlerIndex += 1) {
    const handler = compilerOwnDataValue(
      handlers,
      handlerIndex,
      'Browser posture handlers',
    ) as HandlerLowering;
    const operations = handler.securityOperations;
    const operationLength = compilerArrayLength(operations, 'Browser posture operation facts');
    for (let operationIndex = 0; operationIndex < operationLength; operationIndex += 1) {
      const operation = compilerOwnDataValue(
        operations,
        operationIndex,
        'Browser posture operation facts',
      ) as (typeof operations)[number];
      if (isBrowserSecurityOperationKind(operation.kind)) compilerSetAdd(seen, operation.kind);
    }
    const diagnostics =
      handler.diagnostics ?? (handler.diagnostic === undefined ? [] : [handler.diagnostic]);
    const diagnosticLength = compilerArrayLength(
      diagnostics,
      'Browser posture handler diagnostics',
    );
    for (let diagnosticIndex = 0; diagnosticIndex < diagnosticLength; diagnosticIndex += 1) {
      const diagnostic = compilerOwnDataValue(
        diagnostics,
        diagnosticIndex,
        'Browser posture handler diagnostics',
      ) as CompilerDiagnostic;
      if (diagnostic.code === 'KV201') hasUnclosedBrowserAuthority = true;
    }
  }
  const operations: BrowserSecurityOperationKind[] = [];
  const operationKindLength = compilerArrayLength(
    browserSecurityOperationKinds,
    'Browser security operation kinds',
  );
  for (let index = 0; index < operationKindLength; index += 1) {
    const kind = compilerOwnDataValue(
      browserSecurityOperationKinds,
      index,
      'Browser security operation kinds',
    ) as BrowserSecurityOperationKind;
    if (compilerSetHas(seen, kind)) {
      compilerArrayAppend(operations, kind, 'Browser posture operations');
    }
  }
  const posture = lowered.lowering.structuralLowering.browserPosture;
  const isolationBlockers = compilerSnapshotDenseArray(
    posture.isolationBlockers,
    'Browser posture isolation blockers',
  );
  if (compilerSetHas(seen, 'browser.framework.call') || hasUnclosedBrowserAuthority) {
    compilerArrayAppend(
      isolationBlockers,
      {
        fileName: lowered.lowering.terminalState.fileName,
        kind: 'dynamic-fetch-or-worker',
        site: 'browser.framework.call',
      },
      'Browser posture isolation blockers',
    );
  }
  return {
    externalOrigins: compilerSnapshotDenseArray(
      posture.externalOrigins,
      'Browser posture external origins',
    ),
    isolationBlockers,
    opaqueExternalUrls: compilerSnapshotDenseArray(
      posture.opaqueExternalUrls,
      'Browser posture opaque URLs',
    ),
    operations,
    schema: browserPostureManifestSchema,
  };
}

function assertEmittedTranslation(
  client: EmitClientPhaseResult,
  registryCss: EmitRegistryCssPhaseResult,
  files: CompileResult['files'],
  confidentialityClosed: boolean,
  authoredModel: ComponentModuleModel,
): void {
  const result = verifyEmittedTranslation({
    artifacts: files,
    decision: {
      clientHandlers: confidentialityClosed
        ? []
        : compilerMapDense(
            client.versionedHandlers,
            'Translation-validation client handlers',
            (handler) => ({
              exportName: handler.exportName,
              operations: handler.securityOperations,
            }),
          ),
      clientImports: client.clientModuleImportManifest,
      secretFieldNames: registryCss.secretFieldNames,
      serverOperations: serverSecurityOperationFacts(authoredModel),
    },
  });
  if (result.ok) return;
  const findings = compilerMapDense(
    result.findings,
    'Emitted translation findings',
    (finding) => `${finding.relation}:${finding.code}:${finding.message}`,
  );
  compilerFailClosed(
    `Emitted translation validation failed: ${compilerArrayJoin(findings, ' | ')}`,
  );
}

function componentCompileFactSnapshot(
  lowered: LowerComponentPhaseResult,
  validated: ValidateComponentPhaseResult,
  client: EmitClientPhaseResult,
  registryCss: EmitRegistryCssPhaseResult,
  server: EmitServerPhaseResult,
  originalModel: ComponentModuleModel,
  fileName: string,
): CompileFactSnapshot {
  const ledger = createCompileFactLedger();
  // Validation owns the final source-anchored coverage. Append it first so the lower pipeline's
  // structurally identical pre-anchor style facts dedupe behind the authoritative projection.
  ledger.append('queryUpdateCoverage', { phase: 'validate', pass: 'query-update-coverage' }, [
    ...validated.updateCoverage,
  ]);
  ledger.merge(lowered.lowering.factSnapshot, { phase: 'lower', pass: 'lowering-pipeline' });
  ledger.append('clockUpdatePlans', { phase: 'validate', pass: 'clock-update-plans' }, [
    ...validated.clockUpdatePlans,
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
    ...taskGraphFactsFromModel(originalModel, fileName),
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

function taskGraphFactsFromModel(model: ComponentModuleModel, fileName: string): TaskGraphFact[] {
  return compilerMapDense(model.taskRunHandlers, 'Task graph handlers', (handler) => {
    const runMutations = taskCompositionTargets(handler.runMutationEdges);
    const runQueries = taskCompositionTargets(handler.runQueryEdges);
    const schedules = taskCompositionTargets(handler.scheduleEdges);
    return {
      composition: [
        ...taskCompositionFacts(fileName, 'run-mutation', handler.runMutationEdges),
        ...taskCompositionFacts(fileName, 'run-query', handler.runQueryEdges),
        ...taskCompositionFacts(fileName, 'schedule', handler.scheduleEdges),
      ],
      ...(handler.cron === undefined ? {} : { cron: handler.cron }),
      key: handler.key,
      ...(runMutations.length === 0 ? {} : { runMutations }),
      ...(runQueries.length === 0 ? {} : { runQueries }),
      ...(schedules.length === 0 ? {} : { schedules }),
      source: { end: handler.callSpan.end, file: fileName, start: handler.callSpan.start },
    };
  });
}

function taskCompositionFacts(
  fileName: string,
  kind: CoreGraph.TaskCompositionExplain['kind'],
  edges: readonly TaskCompositionEdgeModel[],
): CoreGraph.TaskCompositionExplain[] {
  return compilerMapDense(edges, `Task ${kind} composition edges`, (edge) => ({
    kind,
    source: { end: edge.span.end, file: fileName, start: edge.span.start },
    target: edge.target,
  }));
}

function taskCompositionTargets(edges: readonly TaskCompositionEdgeModel[]): string[] {
  const targets = compilerCreateSet<string>();
  const snapshot = compilerSnapshotDenseArray(edges, 'Task composition targets');
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerSetAdd(targets, snapshot[index]!.target);
  }
  const result: string[] = [];
  compilerSetForEachSorted(targets, result);
  return result;
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
  // SPEC §10.3: compiler-proven app.mutation request.db work is the framework-managed
  // transaction itself, not a raw driver escape. Keep ordinary/captured/shadowed DB sinks in the
  // graph, but remove the private parser-marked managed sinks before the compile ledger snapshots
  // them and necessarily sheds their non-structural WeakMap provenance.
  return compilerFilterDense(
    handlerWriteSinks(model),
    'Handler write sink graph facts',
    (sink) => !handlerWriteSinkUsesManagedAppTransaction(sink),
  );
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
  const mutationOptimism = sliceRecord(facts.mutationOptimism, mutationKeys);
  const mutationBindings = sliceProjectMutationBindings(
    facts.mutationBindings,
    usage.fileName,
    mutationKeys,
  );
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
    ...(mutationBindings === undefined ? {} : { mutationBindings }),
    ...(mutationInputs === undefined ? {} : { mutationInputs }),
    ...(mutationOptimism === undefined ? {} : { mutationOptimism }),
    ...(facts.mutations === undefined ? {} : { mutations: facts.mutations }),
    ...(facts.queries === undefined ? {} : { queries: facts.queries }),
    ...(facts.routes === undefined ? {} : { routes: facts.routes }),
    ...(viewTransitions === undefined ? {} : { viewTransitions }),
  };
  return compilerObjectKeys(sliced).length === 0 ? undefined : sliced;
}

function sliceProjectMutationBindings(
  bindings: RegistryFacts['mutationBindings'],
  fileName: string,
  mutationKeys: ReadonlySet<string>,
): RegistryFacts['mutationBindings'] | undefined {
  if (!bindings || compilerSetValues(mutationKeys).length === 0) return undefined;
  const selected = compilerFilterDense(
    bindings,
    'Project mutation binding facts',
    (binding) => binding.fileName === fileName && compilerSetHas(mutationKeys, binding.key),
  );
  return selected.length === 0 ? undefined : selected;
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
  loweredSource: string,
  sourceOffsetMap: SourceOffsetMap,
): SourceReplacement[] {
  return compilerFlatMapDense(model.calls, 'Derived mutation-key calls', (call) => {
    if (!isExportedObjectFormMutationCall(model, call)) return [];

    const derivedKey = canonicalJson(deriveMutationKey(fileName, call.exportedConstName));
    const span = loweredSpanForOriginalCall(call, sourceOffsetMap);
    if (span === undefined) return [];
    return [
      {
        end: span.end,
        replacement: `${derivedMutationKeyHelper}(${compilerStringSlice(loweredSource, span.start, span.end)}, ${derivedKey})`,
        start: span.start,
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

const derivedMutationKeyHelper = '__kovoAssignDerivedMutationKey';
const derivedQueryKeyHelper = '__kovoAssignDerivedQueryKey';
const derivedWireKeyModule = '@kovojs/server/internal/wire';

function derivedQueryKeyAssignments(
  model: ComponentModuleModel,
  fileName: string,
  loweredSource: string,
  sourceOffsetMap: SourceOffsetMap,
): SourceReplacement[] {
  return compilerFlatMapDense(
    exportedObjectFirstQueryCalls(model),
    'Derived query-key calls',
    (call) => {
      const key = deriveRegistryIdentity(fileName, call.exportedConstName!).key;
      const span = loweredSpanForOriginalCall(call, sourceOffsetMap);
      if (span === undefined) return [];
      return [
        {
          end: span.end,
          replacement: `${derivedQueryKeyHelper}(${compilerStringSlice(loweredSource, span.start, span.end)}, ${canonicalJson(key)})`,
          start: span.start,
        },
      ];
    },
  );
}

function loweredSpanForOriginalCall(
  call: Pick<CallExpressionModel, 'end' | 'start'>,
  sourceOffsetMap: SourceOffsetMap,
): { end: number; start: number } | undefined {
  const start = originalOffsetToGenerated(sourceOffsetMap, call.start);
  const mappedEnd =
    call.end === call.start
      ? start
      : originalOffsetToGenerated(sourceOffsetMap, Math.max(call.start, call.end - 1));
  if (start === undefined || mappedEnd === undefined) return undefined;
  return { end: call.end === call.start ? mappedEnd : mappedEnd + 1, start };
}

interface GeneratedImportInsertion {
  nextImportInsertionOffset: number;
  source: string;
}

function insertDerivedWireKeyImports(
  source: string,
  originalModel: ComponentModuleModel,
  loweredModel: ComponentModuleModel,
  importInsertionOffset: number,
): GeneratedImportInsertion {
  const imports: string[] = [];
  if (
    compilerSomeDense(originalModel.calls, 'Derived mutation-key calls', (call) =>
      isExportedObjectFormMutationCall(originalModel, call),
    ) &&
    !hasDerivedWireImport(loweredModel, derivedMutationKeyHelper)
  ) {
    compilerArrayAppend(
      imports,
      `assignDerivedMutationKey as ${derivedMutationKeyHelper}`,
      'Derived wire-key imports',
    );
  }
  if (
    exportedObjectFirstQueryCalls(originalModel).length > 0 &&
    !hasDerivedWireImport(loweredModel, derivedQueryKeyHelper)
  ) {
    compilerArrayAppend(
      imports,
      `assignDerivedQueryKey as ${derivedQueryKeyHelper}`,
      'Derived wire-key imports',
    );
  }
  if (imports.length === 0) {
    return { nextImportInsertionOffset: importInsertionOffset, source };
  }

  const importLine = `import { ${compilerArrayJoin(imports, ', ')} } from '${derivedWireKeyModule}';\n`;
  return {
    nextImportInsertionOffset: importInsertionOffset + importLine.length,
    source: `${compilerStringSlice(source, 0, importInsertionOffset)}${importLine}${compilerStringSlice(source, importInsertionOffset)}`,
  };
}

/** Carry the parser-owned import boundary through typed terminal patches (SPEC §5.2 rule 10). */
function generatedImportOffsetAfterPatches(
  originalOffset: number,
  replacements: readonly SourceReplacement[],
): number {
  let generatedOffset = originalOffset;
  const snapshot = compilerSnapshotDenseArray(
    replacements,
    'Generated import terminal replacements',
  );
  for (let index = 0; index < snapshot.length; index += 1) {
    const replacement = snapshot[index]!;
    if (replacement.start < originalOffset && replacement.end > originalOffset) {
      throw new TypeError('A terminal source patch may not cross the generated-import boundary.');
    }
    if (replacement.end <= originalOffset) {
      generatedOffset += replacement.replacement.length - (replacement.end - replacement.start);
    }
  }
  return generatedOffset;
}

function hasDerivedWireImport(model: ComponentModuleModel, localName: string): boolean {
  return compilerSomeDense(
    model.namedImports,
    'Derived wire-key helper imports',
    (entry) => entry.moduleSpecifier === derivedWireKeyModule && entry.localName === localName,
  );
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

function localQueryPlanRuntimeNames(
  model: ComponentModuleModel,
  fileName: string,
): Readonly<Record<string, string>> {
  const result = compilerCreateNullRecord<string>();
  const component = firstComponentModel(model);
  if (component === null) return compilerFreeze(result);
  const entries = compilerSnapshotDenseArray(
    componentOptionObjectEntriesFor(component, 'queries'),
    'Component query runtime-name entries',
  );
  const calls = compilerSnapshotDenseArray(model.calls, 'Component query runtime-name calls');
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex]!;
    const expression = entry.queryBinding?.queryKeyExpression;
    if (expression === undefined) {
      compilerDefineOwnDataProperty(result, entry.key, entry.key);
      continue;
    }
    for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
      const call = calls[callIndex]!;
      if (call.exportedConstName !== expression || !isKovoQueryCall(model, call)) continue;
      const explicitKey = call.argumentStaticValues[0];
      compilerDefineOwnDataProperty(
        result,
        entry.key,
        typeof explicitKey === 'string'
          ? explicitKey
          : deriveRegistryIdentity(fileName, expression).key,
      );
      break;
    }
  }
  return compilerFreeze(result);
}

function isKovoQueryCall(model: ComponentModuleModel, call: CallExpressionModel) {
  const astCall = callExpressionAtSpan(ts as FrameworkIdentityTypeScript, model.sourceFile, call);
  return astCall ? isKovoQueryCallee(model.sourceFile, astCall.expression) : false;
}

function isKovoMutationCall(model: ComponentModuleModel, call: CallExpressionModel) {
  const astCall = callExpressionAtSpan(ts as FrameworkIdentityTypeScript, model.sourceFile, call);
  return astCall
    ? compilerOwnedAppContractFactoryEquals(
        ts as FrameworkIdentityTypeScript,
        model.sourceFile,
        astCall.expression,
        KOVO_MUTATION_IDENTITY,
      ) ||
        expressionResolvesToFrameworkExport(
          ts as FrameworkIdentityTypeScript,
          model.sourceFile,
          astCall.expression,
          KOVO_MUTATION_IDENTITY,
          { legacyGlobals: [KOVO_MUTATION_IDENTITY] },
        )
    : false;
}

function isKovoQueryCallee(sourceFile: TS.SourceFile, expression: TS.Expression): boolean {
  return (
    compilerOwnedAppContractFactoryEquals(
      ts as FrameworkIdentityTypeScript,
      sourceFile,
      expression,
      KOVO_QUERY_IDENTITY,
    ) ||
    expressionResolvesToFrameworkExport(
      ts as FrameworkIdentityTypeScript,
      sourceFile,
      expression,
      KOVO_QUERY_IDENTITY,
    )
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
      const semanticValue = jsxAttributeSemanticStringValue(attribute);
      if (
        !(
          attribute.name === 'data-bind' ||
          compilerStringStartsWith(attribute.name, 'data-bind:') ||
          // SPEC §4.8 data-bind-prop: version the live-property stamp's derive
          // reference identically to its data-bind:<attr> sibling.
          compilerStringStartsWith(attribute.name, 'data-bind-prop:')
        ) ||
        !semanticValue
      ) {
        continue;
      }

      const derive = compilerMapGet(derivesByPlaceholder, semanticValue);
      if (!derive) continue;

      const componentControlHelper =
        element.intrinsicTagName === undefined
          ? generatedComponentControlHelperForReference(model, attribute)
          : undefined;
      if (element.intrinsicTagName === undefined && componentControlHelper === undefined) {
        compilerFailClosed(
          `Generated ${attribute.name} derive reference on a component host must retain its exact component-control receipt fact.`,
        );
      }

      appendCompileValue(
        references,
        {
          attr: attribute.name,
          clientHref,
          ...(componentControlHelper === undefined ? {} : { componentControlHelper }),
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
  return compilerMapDense(references, 'State-derive reference replacements', (reference) => {
    let replacement: string;
    if (reference.componentControlHelper === undefined) {
      replacement = `${reference.attr}="${escapeAttribute(reference.value)}"`;
    } else {
      const name = compilerJsonStringify(reference.attr);
      const value = compilerJsonStringify(reference.value);
      if (name === undefined || value === undefined) {
        compilerFailClosed('Generated component-control derive reference must serialize exactly.');
      }
      replacement = `${reference.attr}={${reference.componentControlHelper}(${name}, ${value})}`;
    }
    return {
      end: reference.target.end,
      replacement,
      start: reference.target.start,
    };
  });
}

function generatedComponentControlHelperForReference(
  model: ComponentModuleModel,
  attribute: ComponentModuleModel['jsxElements'][number]['attributes'][number],
): string | undefined {
  if (parserFactCompilerGeneratedComponentControlName(attribute) !== attribute.name) {
    return undefined;
  }
  const imports = compilerSnapshotDenseArray(
    model.namedImports,
    'Generated component-control reference imports',
  );
  let helper: string | undefined;
  for (let index = 0; index < imports.length; index += 1) {
    const candidate = imports[index]!;
    if (
      candidate.moduleSpecifier !== '@kovojs/server/internal/escape' ||
      candidate.importedName !== 'kovoGeneratedComponentControl'
    ) {
      continue;
    }
    if (helper !== undefined) {
      compilerFailClosed('Generated component-control reference import must be unique.');
    }
    helper = candidate.localName;
  }
  return helper;
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
 * Input for a KV416 fingerprint-monotonicity check: a "before" and "after" snapshot of
 * the projected query-shape signatures, plus an optional fingerprint function that takes
 * a {@link CompilerRenderPlanFingerprintInput} and returns an opaque string.
 * Supply `fingerprintFn` to test a custom fingerprint provider; omit it to use the built-in
 * {@link computeCompilerRenderPlanFingerprint}.
 * @internal
 */
export interface AssertRenderPlanFingerprintMonotonicityOptions {
  after: CompilerRenderPlanFingerprintInput;
  before: CompilerRenderPlanFingerprintInput;
  fingerprintFn?: (input: CompilerRenderPlanFingerprintInput) => string;
}

/**
 * Assert SPEC §5.2.2 KV416 fingerprint monotonicity: if the projected query shapes (or the
 * grammar version) changed between `before` and `after`, the render-plan fingerprint MUST
 * also change. A fingerprint that fails to move on a shape change causes a `KV416` build
 * failure.
 *
 * Callers pass the "before" and "after" shape-signature records; the function uses
 * `computeCompilerRenderPlanFingerprint` (or a custom `fingerprintFn`) to compute both
 * fingerprints and compares them. Call this from the build gate after a differential corpus
 * run (SPEC §5.2.2).
 */
export function assertRenderPlanFingerprintMonotonicity(
  options: AssertRenderPlanFingerprintMonotonicityOptions,
): void {
  const { before, after, fingerprintFn = computeCompilerRenderPlanFingerprint } = options;

  const beforeFingerprint = fingerprintFn(before);
  const afterFingerprint = fingerprintFn(after);

  const shapesChanged = canonicalJson(sortedRecord(before)) !== canonicalJson(sortedRecord(after));

  if (shapesChanged && beforeFingerprint === afterFingerprint) {
    throw new CompilerDiagnosticError(
      kv416Diagnostic(
        'render-plan fingerprint failed to move on a projected-query-shape change',
        `Fingerprint before and after: "${beforeFingerprint}".`,
      ),
    );
  }
}

/**
 * Build-facing SPEC §5.2.2 production gate. Production callers pass the compile result plus the
 * previous/current render-plan fingerprint inputs; this assertion combines the existing semantic
 * render-equivalence checks with KV416 fingerprint monotonicity so the build fails before output is
 * published.
 */
export function assertProductionRenderPlanGate(options: {
  after: CompilerRenderPlanFingerprintInput;
  before: CompilerRenderPlanFingerprintInput;
  result: CompileResult;
  fingerprintFn?: (input: CompilerRenderPlanFingerprintInput) => string;
}): void {
  try {
    assertRenderEquivalence(options.result);
    assertRenderPlanFingerprintMonotonicity({
      before: options.before,
      after: options.after,
      ...(options.fingerprintFn ? { fingerprintFn: options.fingerprintFn } : {}),
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
    super(compilerDiagnosticErrorMessage(diagnostic));
    this.name = 'CompilerDiagnosticError';
    this.diagnostic = diagnostic;
  }
}

function compilerDiagnosticErrorMessage(diagnostic: ReturnType<typeof kv416Diagnostic>): string {
  assertRegisteredDiagnostic(diagnostic, 'Compiler diagnostic error');
  return `${diagnostic.code}: ${diagnostic.message}`;
}

function sortedRecord(record: Record<string, string>): [string, string][] {
  const keys = compilerSortedKeys(record);
  const result: [string, string][] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const value = compilerOwnDataValue(record, key, 'Render-plan fingerprint input');
    if (typeof value !== 'string') {
      compilerFailClosed(`Render-plan fingerprint input ${key} must be a string.`);
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
    assertRenderPlanFingerprintMonotonicity({
      before: gate.previous,
      after,
      ...(gate.fingerprintFn ? { fingerprintFn: gate.fingerprintFn } : {}),
    });
    return [];
  } catch (error) {
    if (error instanceof CompilerDiagnosticError) return [error.diagnostic];
    return [
      kv416Diagnostic(
        'production render-plan fingerprint gate failed',
        error instanceof Error ? error.message : String(error),
        options.fileName,
      ),
    ];
  }
}

function kv416Diagnostic(reason: string, detail: string, fileName = '<production-build>') {
  return createRegisteredDiagnostic(
    'KV416',
    { fileName },
    { detail: `${reason}. ${detail}`, includeHelp: true },
  );
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
