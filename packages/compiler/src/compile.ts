import { createRequire } from 'node:module';
import * as ts from 'typescript';

import { collectQueryUpdateCoverage, collectQueryUpdatePlans } from './analyze/query-updates.js';
import { componentCssAssetForFile, dedupeCss, emitCssModule } from './css.js';
import { deriveComponentNames } from './component-names.js';
import { emitClientModule } from './emit/client.js';
import { appendLiveTargetRendererExports } from './emit/live-target-renderers.js';
import { emitRegistryModule } from './emit/registry.js';
import {
  emitServerModule,
  mutationFormExplainFacts,
  semanticRenderEquivalenceCheck,
  serverRenderLowering,
} from './emit/server.js';
import {
  componentGraphFact,
  findFragmentTargetFacts,
  findLiveTargetFacts,
} from './internal-graph.js';
import { cssIrHeader } from './ir.js';
import { createComponentHmrImpactMetadata } from './hmr-impact.js';
import {
  clientModuleUrl,
  clientModuleVersion,
  lowerEventHandlers,
  versionHandlerLowering,
} from './lower/handlers.js';
import { navigationStandaloneHrefLowering } from './lower/navigation.js';
import { lowerStructuralJsx } from './lower/structural-jsx.js';
import {
  inferComponentName,
  jsxElements,
  parseComponentModule as parseComponentModuleModel,
  firstComponentModel,
  componentOptionObjectEntries,
  type ComponentModuleModel,
  type SourceSpan,
} from './scan/parse.js';
import {
  applyModelPatchPass,
  applyTerminalEmitPatches,
  componentPipelineState,
} from './model-pipeline.js';
import {
  mergePackageComponentPrefixFacts,
  packageComponentPrefixesForModule,
} from './package-prefixes.js';
import { isCompilerIrArtifact, validateAuthoringSurface } from './validate/authoring-surface.js';
import { validatePackageComponentPrefixes } from './validate/package-prefixes.js';
import { collectCompilerDiagnostics } from './validate/pipeline.js';
import {
  applySourceReplacements,
  composeSourceOffsetMaps,
  escapeAttribute,
  type SourceReplacement,
} from './shared.js';
import { extractKovoStyles } from './style.js';
import { collectTrustedHtmlOutputContextFacts } from './security/output-context.js';
import type { GeneratedOutputWriteFact } from './output-context-facts.js';
import type {
  CompileComponentOptions,
  CompileResult,
  ClockUpdatePlanFact,
  CompileDependencyFootprint,
  QueryUpdateCoverageFact,
  QueryUpdatePlanFact,
  StateDeriveFact,
  StateDeriveReferenceFact,
} from './types.js';
import { compileArtifactFileNames, createEmptyCompileResult, emittedFileKind } from './types.js';

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
export function compileComponentModule(options: CompileComponentOptions): CompileResult {
  if (isCompilerIrArtifact(options.source)) {
    const authoringSurfaceDiagnostics = validateAuthoringSurface(options);
    return {
      ...createEmptyCompileResult(),
      dependencyFootprint: compileDependencyFootprint(options),
      diagnostics: authoringSurfaceDiagnostics,
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
  const packageComponentPrefixes = mergePackageComponentPrefixFacts(
    packageComponentPrefixesForModule(options, originalModel),
    options.packageComponentPrefixes,
  );
  const compileOptions = { ...options, packageComponentPrefixes };
  const authoringSurfaceDiagnostics = validateAuthoringSurface(options, originalModel);
  const componentName = inferComponentName(options.fileName, originalModel);
  const componentNames = deriveComponentNames(options.fileName, firstComponentModel(originalModel));
  const originalState = componentPipelineState(options.fileName, options.source, originalModel);
  const styleSpanProbe = extractKovoStyles(
    options.fileName,
    options.source,
    originalModel,
    componentName,
    compileOptions,
  );
  const structuralLowering = lowerStructuralJsx(originalState.model, componentName, {
    ...compileOptions,
    skipInlineAttributeDeriveSpans: styleSpanProbe.handledSpans,
  });
  const hrefReplacements = navigationStandaloneHrefLowering(originalState.model);
  const structuralPatch = applyModelPatchPass(
    originalState,
    [...structuralLowering.replacements, ...hrefReplacements],
    parseComponentModuleModel,
  );
  const styleExtraction = extractKovoStyles(
    options.fileName,
    structuralPatch.state.source,
    structuralPatch.state.model,
    componentName,
    compileOptions,
  );
  const modelPatch = applyModelPatchPass(
    structuralPatch.state,
    styleExtraction.replacements,
    parseComponentModuleModel,
  );
  const source = modelPatch.state.source;
  const diagnosticSource = options.source;
  const validationOffsetMap = composeSourceOffsetMaps(
    structuralPatch.sourceOffsetMap,
    modelPatch.sourceOffsetMap,
  );
  const model = modelPatch.state.model;
  const handlers = lowerEventHandlers({ ...compileOptions, source }, componentName, model);
  const queryUpdatePlans = mergeQueryUpdatePlans([
    ...collectQueryUpdatePlans(model, componentName),
    ...styleExtraction.queryUpdatePlans,
  ]);
  const clockUpdatePlans = collectClockUpdatePlans(model, componentName, queryUpdatePlans);
  const updateCoverage = mergeStyleUpdateCoverage(
    collectQueryUpdateCoverage(model, compileOptions, componentName),
    styleExtraction.updateCoverage,
    styleExtraction.handledSpans,
  );
  const packagePrefixDiagnostics = validatePackageComponentPrefixes(
    compileOptions.packageComponentPrefixes,
    options.fileName,
  );
  const validationDiagnostics = collectCompilerDiagnostics({
    componentName,
    model,
    options: compileOptions,
    originalModel,
    diagnosticSource,
    source,
    sourceOffsetMap: validationOffsetMap,
    styleOwnedSpans: styleSpanProbe.handledSpans,
    updateCoverage,
  });
  const fileNames = compileArtifactFileNames(options.fileName);
  const stateDerives = [...structuralLowering.stateDerives, ...styleExtraction.stateDerives];

  const clientSource = emitClientModule(
    handlers,
    queryUpdatePlans,
    stateDerives,
    componentName,
    clockUpdatePlans,
  );
  const clientHref = clientModuleUrl(options.fileName, clientModuleVersion(clientSource));
  const versionedHandlers = handlers.map((handler) =>
    versionHandlerLowering(handler, options.fileName, clientHref),
  );
  const componentCssSource = emitCssModule(componentNames.domName, model);
  const styleCssSource = styleExtraction.css ? `${cssIrHeader}\n${styleExtraction.css}` : null;
  const cssSource =
    componentCssSource && styleCssSource
      ? dedupeCss([componentCssSource, styleCssSource])
      : (componentCssSource ?? styleCssSource ?? '');
  const fragmentTargetFacts = findFragmentTargetFacts(componentNames.registryKey, model);
  const fragmentTargets = fragmentTargetFacts.map((fact) => fact.target);
  const liveTargetFacts = findLiveTargetFacts(
    componentNames.domName,
    componentNames.registryKey,
    model,
    updateCoverage,
  );
  const componentGraphFacts = [
    componentGraphFact(
      componentNames.registryKey,
      componentNames.domName,
      model,
      fragmentTargets,
      styleExtraction.ruleUsages,
      firstComponentModel(originalModel)?.localName,
      mutationFormExplainFacts(model, {
        fileName: options.fileName,
        ...(compileOptions.registryFacts ? { registryFacts: compileOptions.registryFacts } : {}),
        source,
      }),
    ),
  ];
  const cssAssets = cssSource
    ? [
        {
          ...componentCssAssetForFile(
            fileNames.css,
            componentNames.domName,
            fragmentTargets,
            {},
            cssSource,
          ),
          ...(styleExtraction.ruleUsages.length > 0
            ? { styleRuleUsages: styleExtraction.ruleUsages }
            : {}),
        },
      ]
    : [];
  const serverRender = serverRenderLowering(versionedHandlers, model, componentNames.domName, {
    fileName: options.fileName,
    registryComponentName: componentNames.registryKey,
    ...(compileOptions.registryFacts ? { registryFacts: compileOptions.registryFacts } : {}),
    source,
  });
  const stateDeriveReferences = collectStateDeriveReferenceFacts(model, stateDerives, clientHref);
  const serverRenderReplacements = [
    ...serverRender.replacements,
    ...componentDescriptorNameAssignments(model, componentNames.registryKey),
    ...versionStateDeriveReferences(stateDeriveReferences),
  ];
  const serverRenderedSource = removeUnreferencedNamedImports(
    appendLiveTargetRendererExports({
      componentExpression: componentName,
      liveTargetFacts,
      source: applyTerminalEmitPatches(modelPatch.state, serverRenderReplacements),
    }),
  );
  const serverModule = emitServerModule(serverRenderedSource);
  const registrySource = emitRegistryModule({
    clientFileName: fileNames.client,
    cssAssets,
    componentName,
    domComponentName: componentNames.domName,
    registryComponentName: componentNames.registryKey,
    fragmentTargetFacts,
    handlers: versionedHandlers,
    liveTargetFacts,
    platformSubstitutions: structuralLowering.platformSubstitutions,
    queryUpdatePlans,
    ...(options.registryFacts ? { registryFacts: options.registryFacts } : {}),
    viewTransitions: structuralLowering.viewTransitionStamps,
  });
  const diagnostics = [
    ...authoringSurfaceDiagnostics,
    ...versionedHandlers.flatMap((handler) => handler.diagnostics ?? []),
    ...structuralLowering.diagnostics,
    ...styleExtraction.diagnostics,
    ...serverRender.diagnostics,
    ...packagePrefixDiagnostics,
    ...validationDiagnostics,
  ];
  const renderEquivalenceChecks = [
    semanticRenderEquivalenceCheck(
      fileNames.server,
      model,
      serverModule.executableSource,
      compileOptions.registryFacts ? { registryFacts: compileOptions.registryFacts } : {},
    ),
  ];

  return {
    componentGraphFacts,
    dependencyFootprint: compileDependencyFootprint(compileOptions),
    diagnostics,
    files: [
      { fileName: fileNames.server, kind: 'server', source: serverModule.source },
      { fileName: fileNames.client, kind: 'client', source: clientSource },
      ...(cssSource ? [{ fileName: fileNames.css, kind: 'css' as const, source: cssSource }] : []),
      { fileName: fileNames.registry, kind: 'registry', source: registrySource },
    ],
    clientExports: [
      ...versionedHandlers.map((handler) => handler.exportName),
      ...stateDerives.map((derive) => derive.exportName),
    ],
    handlerExports: versionedHandlers.map((handler) => handler.exportName),
    hmrImpact: createComponentHmrImpactMetadata({
      clientHref,
      componentGraphFacts,
      cssAssets,
      diagnostics,
      liveTargetFacts,
      queryUpdatePlans,
      renderEquivalenceChecks,
      sourceFileName: options.fileName,
      ...(cssSource
        ? { stylesheetSources: [{ source: cssSource, sourceFileName: fileNames.css }] }
        : {}),
    }),
    loweredSource: serverRenderedSource,
    cssAssets,
    outputContextFacts: dedupeOutputContextFacts([
      ...structuralLowering.outputContexts,
      ...serverRender.outputContexts,
      ...styleExtraction.outputContexts,
      ...collectTrustedHtmlOutputContextFacts(originalModel),
      ...queryUpdatePlans.flatMap((plan) => [...(plan.outputContexts ?? [])]),
      ...stateDerives.map((derive) => derive.outputContext),
    ]),
    platformSubstitutions: structuralLowering.platformSubstitutions,
    queryUpdatePlans,
    // SPEC §5.2 rule 3: render the authored Kovo JSX model and the lowered server artifact
    // independently, then ignore only generated runtime stamps with an explicit allowlist.
    renderEquivalenceChecks,
    updateCoverage,
    viewTransitions: structuralLowering.viewTransitionStamps,
  };
}

function compileDependencyFootprint(options: CompileComponentOptions): CompileDependencyFootprint {
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

function collectClockUpdatePlans(
  model: ComponentModuleModel,
  componentName: string,
  queryUpdatePlans: readonly QueryUpdatePlanFact[],
): ClockUpdatePlanFact[] {
  if (!queryUpdatePlans.some((plan) => plan.query === 'now')) return [];

  const clocks = componentOptionObjectEntries(model, 'clocks')
    .filter((entry) => entry.value && !/\brenderOnce\s*:\s*true\b/.test(entry.value))
    .map((entry) => ({ name: entry.key, spec: entry.value! }));

  return clocks.length > 0 ? [{ clocks, componentName }] : [];
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

function removeUnreferencedNamedImports(source: string): string {
  const sourceFile = ts.createSourceFile(
    'lowered.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const referenced = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && isReferenceIdentifier(node)) referenced.add(node.text);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  const replacements: SourceReplacement[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;

    const importClause = statement.importClause;
    const namedBindings = importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;

    const unused = namedBindings.elements.filter((element) => !referenced.has(element.name.text));
    if (unused.length === 0) continue;

    if (unused.length === namedBindings.elements.length) {
      replacements.push(
        importClause?.name === undefined
          ? removeStatementReplacement(source, statement, sourceFile)
          : removeNamedBindingsReplacement(importClause.name, namedBindings),
      );
      continue;
    }

    for (const run of contiguousImportSpecifierRuns(unused, namedBindings.elements)) {
      replacements.push(removeNamedImportRunReplacement(run, namedBindings.elements, sourceFile));
    }
  }

  return replacements.length === 0 ? source : applySourceReplacements(source, replacements);
}

function isReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return true;

  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isPropertySignature(parent) && parent.name === node) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  if (ts.isMethodSignature(parent) && parent.name === node) return false;
  if (ts.isGetAccessor(parent) && parent.name === node) return false;
  if (ts.isSetAccessor(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false;
  if (ts.isClassDeclaration(parent) && parent.name === node) return false;
  if (ts.isInterfaceDeclaration(parent) && parent.name === node) return false;
  if (ts.isTypeAliasDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;

  return true;
}

function removeStatementReplacement(
  source: string,
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
): SourceReplacement {
  let end = statement.getEnd();
  if (source[end] === '\r') end += 1;
  if (source[end] === '\n') end += 1;

  return {
    end,
    replacement: '',
    start: statement.getStart(sourceFile),
  };
}

function removeNamedBindingsReplacement(
  defaultImport: ts.Identifier,
  namedBindings: ts.NamedImports,
): SourceReplacement {
  return {
    end: namedBindings.getEnd(),
    replacement: '',
    start: defaultImport.getEnd(),
  };
}

function contiguousImportSpecifierRuns(
  elements: readonly ts.ImportSpecifier[],
  allElements: ts.NodeArray<ts.ImportSpecifier>,
): ts.ImportSpecifier[][] {
  const runs: ts.ImportSpecifier[][] = [];
  let current: ts.ImportSpecifier[] = [];
  let previousIndex = -2;

  for (const element of elements) {
    const index = allElements.indexOf(element);
    if (current.length > 0 && index !== previousIndex + 1) {
      runs.push(current);
      current = [];
    }
    current.push(element);
    previousIndex = index;
  }

  if (current.length > 0) runs.push(current);

  return runs;
}

function removeNamedImportRunReplacement(
  run: readonly ts.ImportSpecifier[],
  elements: ts.NodeArray<ts.ImportSpecifier>,
  sourceFile: ts.SourceFile,
): SourceReplacement {
  const first = run[0]!;
  const last = run[run.length - 1]!;
  const firstIndex = elements.indexOf(first);
  const lastIndex = elements.indexOf(last);
  const start = first.getStart(sourceFile);

  if (lastIndex < elements.length - 1) {
    return {
      end: elements[lastIndex + 1]!.getStart(sourceFile),
      replacement: '',
      start,
    };
  }

  return {
    end: last.getEnd(),
    replacement: '',
    start: elements[firstIndex - 1]!.getEnd(),
  };
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
        !(attribute.name === 'data-bind' || attribute.name.startsWith('data-bind:')) ||
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

function mergeQueryUpdatePlans(plans: readonly QueryUpdatePlanFact[]): QueryUpdatePlanFact[] {
  const byQuery = new Map<string, QueryUpdatePlanFact[]>();
  for (const plan of plans) {
    byQuery.set(plan.query, [...(byQuery.get(plan.query) ?? []), plan]);
  }

  return [...byQuery.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([query, queryPlans]) => ({
      componentName: queryPlans[0]?.componentName ?? 'Component',
      query,
      paths: [...new Set(queryPlans.flatMap((plan) => plan.paths))].sort(),
      ...(queryPlans.some((plan) => (plan.outputContexts?.length ?? 0) > 0)
        ? {
            outputContexts: dedupeOutputContextFacts(
              queryPlans.flatMap((plan) => [...(plan.outputContexts ?? [])]),
            ),
          }
        : {}),
      ...(queryPlans.some((plan) => (plan.derives?.length ?? 0) > 0)
        ? {
            derives: dedupeByKey(
              queryPlans.flatMap((plan) => [...(plan.derives ?? [])]),
              (derive) => derive.exportName,
            ).sort((left, right) => left.name.localeCompare(right.name)),
          }
        : {}),
      ...(queryPlans.some((plan) => (plan.stamps?.length ?? 0) > 0)
        ? {
            stamps: dedupeByKey(
              queryPlans.flatMap((plan) => [...(plan.stamps ?? [])]),
              (stamp) => `${stamp.attr}\0${stamp.selector}\0${stamp.derive.exportName}`,
            ).sort((left, right) => left.attr.localeCompare(right.attr)),
          }
        : {}),
      ...(queryPlans.some((plan) => (plan.templateStamps?.length ?? 0) > 0)
        ? {
            templateStamps: dedupeByKey(
              queryPlans.flatMap((plan) => [...(plan.templateStamps ?? [])]),
              (stamp) => `${stamp.key}\0${stamp.selector}\0${stamp.list}`,
            ).sort((left, right) => left.list.localeCompare(right.list)),
          }
        : {}),
    }));
}

function dedupeOutputContextFacts(
  facts: readonly GeneratedOutputWriteFact[],
): GeneratedOutputWriteFact[] {
  return dedupeByKey(facts, (fact) => JSON.stringify(fact));
}

function mergeStyleUpdateCoverage(
  coverage: readonly QueryUpdateCoverageFact[],
  styleCoverage: readonly QueryUpdateCoverageFact[],
  handledSpans: readonly SourceSpan[],
): QueryUpdateCoverageFact[] {
  if (styleCoverage.length === 0) return [...coverage];

  return [
    ...coverage.filter((fact) => {
      const sourceSpan = fact.sourceSpan;
      return (
        fact.status !== 'UNHANDLED' ||
        !sourceSpan ||
        !handledSpans.some((span) => containsSourceSpan(span, sourceSpan))
      );
    }),
    ...styleCoverage,
  ];
}

function containsSourceSpan(outer: SourceSpan, inner: { length: number; start: number }): boolean {
  return inner.start >= outer.start && inner.start + inner.length <= outer.end;
}

function dedupeByKey<Value>(values: readonly Value[], keyFor: (value: Value) => string): Value[] {
  const seen = new Set<string>();
  const deduped: Value[] = [];
  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }
  return deduped;
}

/**
 * Assert the SPEC.md §5.2 fixpoint property: re-compiling every emitted artifact of a
 * compileComponentModule result reproduces that artifact byte-for-byte. Throws on the first
 * artifact that changes under recompilation. Public verification helper used by `create-kovo`
 * templates and example apps to prove the compiler is idempotent.
 */
export function assertFixpoint(result: CompileResult): void {
  for (const file of result.files) {
    const recompiled = compileComponentModule({ ...file, sourceProvenance: 'compiler-emitted' });
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
 * Assert the SPEC.md §5.2 rule 3 render-equivalence property: the lowered server render
 * matches the authored reference render once generated-only runtime attributes are
 * normalized. Throws on the first failing check in a compileComponentModule result. Public
 * verification helper used by `create-kovo` templates and example apps.
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
