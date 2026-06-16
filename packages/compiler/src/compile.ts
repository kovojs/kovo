import { collectQueryUpdateCoverage, collectQueryUpdatePlans } from './analyze/query-updates.js';
import { componentCssAssetForFile, emitCssModule } from './css.js';
import { emitClientModule } from './emit/client.js';
import { emitRegistryModule } from './emit/registry.js';
import {
  emitServerModule,
  renderEquivalenceSourceCheck,
  serverRenderLowering,
} from './emit/server.js';
import { componentGraphFact, findFragmentTargetFacts } from './graph.js';
import {
  clientModuleUrl,
  clientModuleVersion,
  lowerEventHandlers,
  versionHandlerLowering,
} from './lower/handlers.js';
import { lowerInlineAttributeDerives } from './lower/inline-derives.js';
import { navigationHrefLowering, navigationLinkLowering } from './lower/navigation.js';
import { platformBehaviorLowering } from './lower/platform.js';
import { lowerPrimitiveAttributeSpreads } from './lower/primitive-spreads.js';
import { viewTransitionLowering } from './lower/view-transitions.js';
import {
  inferComponentName,
  jsxElements,
  parseComponentModule as parseComponentModuleModel,
  type ComponentModuleModel,
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
import { escapeAttribute, type SourceReplacement } from './shared.js';
import type { CompileComponentOptions, CompileResult, StateDeriveFact } from './types.js';
import { compileArtifactFileNames, createEmptyCompileResult, emittedFileKind } from './types.js';

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
  const originalState = componentPipelineState(options.fileName, options.source, originalModel);
  const primitiveSpreadLowering = lowerPrimitiveAttributeSpreads(originalState.model, {
    fileName: options.fileName,
    source: options.source,
  });
  const viewTransitions = viewTransitionLowering(originalState.model);
  const platformLowering = platformBehaviorLowering(originalState.model);
  const linkReplacements = navigationLinkLowering(originalState.model);
  const hrefReplacements = navigationHrefLowering(originalState.model);
  const deriveLowering = lowerInlineAttributeDerives(
    originalState.model,
    componentName,
    compileOptions,
  );
  const modelPatch = applyModelPatchPass(
    originalState,
    [
      ...primitiveSpreadLowering.replacements,
      ...viewTransitions.replacements,
      ...platformLowering.replacements,
      ...linkReplacements,
      ...hrefReplacements,
      ...deriveLowering.replacements,
    ],
    parseComponentModuleModel,
    { prefix: deriveLowering.prefix },
  );
  const source = modelPatch.state.source;
  const diagnosticSource = options.source;
  const validationOffsetMap = modelPatch.sourceOffsetMap;
  const model = modelPatch.state.model;
  const handlers = lowerEventHandlers({ ...compileOptions, source }, componentName, model);
  const queryUpdatePlans = collectQueryUpdatePlans(model, componentName);
  const updateCoverage = collectQueryUpdateCoverage(model, compileOptions, componentName);
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
    updateCoverage,
  });
  const fileNames = compileArtifactFileNames(options.fileName);

  const clientSource = emitClientModule(
    handlers,
    queryUpdatePlans,
    deriveLowering.stateDerives,
    componentName,
  );
  const clientHref = clientModuleUrl(options.fileName, clientModuleVersion(clientSource));
  const versionedHandlers = handlers.map((handler) =>
    versionHandlerLowering(handler, options.fileName, clientHref),
  );
  const cssSource = emitCssModule(componentName, model);
  const fragmentTargetFacts = findFragmentTargetFacts(componentName, model);
  const fragmentTargets = fragmentTargetFacts.map((fact) => fact.target);
  const componentGraphFacts = [componentGraphFact(componentName, model, fragmentTargets)];
  const cssAssets = cssSource
    ? [componentCssAssetForFile(fileNames.css, componentName, fragmentTargets, {}, cssSource)]
    : [];
  const serverRenderReplacements = [
    ...serverRenderLowering(versionedHandlers, model),
    ...versionStateDeriveReferences(model, deriveLowering.stateDerives, clientHref),
  ];
  const serverRenderedSource = applyTerminalEmitPatches(modelPatch.state, serverRenderReplacements);
  const serverModule = emitServerModule(serverRenderedSource);
  const registrySource = emitRegistryModule({
    clientFileName: fileNames.client,
    cssAssets,
    componentName,
    fragmentTargetFacts,
    handlers: versionedHandlers,
    platformSubstitutions: platformLowering.substitutions,
    queryUpdatePlans,
    ...(options.registryFacts ? { registryFacts: options.registryFacts } : {}),
    viewTransitions: viewTransitions.stamps,
  });

  return {
    componentGraphFacts,
    diagnostics: [
      ...authoringSurfaceDiagnostics,
      ...versionedHandlers.flatMap((handler) => handler.diagnostics ?? []),
      ...primitiveSpreadLowering.diagnostics,
      ...packagePrefixDiagnostics,
      ...validationDiagnostics,
    ],
    files: [
      { fileName: fileNames.server, kind: 'server', source: serverModule.source },
      { fileName: fileNames.client, kind: 'client', source: clientSource },
      ...(cssSource ? [{ fileName: fileNames.css, kind: 'css' as const, source: cssSource }] : []),
      { fileName: fileNames.registry, kind: 'registry', source: registrySource },
    ],
    clientExports: [
      ...versionedHandlers.map((handler) => handler.exportName),
      ...deriveLowering.stateDerives.map((derive) => derive.exportName),
    ],
    handlerExports: versionedHandlers.map((handler) => handler.exportName),
    loweredSource: serverRenderedSource,
    cssAssets,
    platformSubstitutions: platformLowering.substitutions,
    queryUpdatePlans,
    // SPEC §5.2 rule 3: compare the pre-server-stamp reference render source with the lowered
    // server render source after normalizing generated-only runtime attributes.
    renderEquivalenceChecks: [
      renderEquivalenceSourceCheck(fileNames.server, source, serverRenderedSource, {
        expectedIgnoredSpans: renderEquivalenceExpectedIgnoredSpans(model),
      }),
    ],
    updateCoverage,
    viewTransitions: viewTransitions.stamps,
  };
}

function renderEquivalenceExpectedIgnoredSpans(
  model: ComponentModuleModel,
): readonly { end: number; start: number }[] {
  // SPEC §5.2 rule 3: authored event expressions become generated handler refs and element-param
  // stamps in the lowered render. Remove only parser-proven event attributes from the reference
  // side; do not use raw string matching for nested JSX expressions.
  return model.jsxElements.flatMap((element) =>
    element.attributes
      .filter((attribute) => attribute.domEventName || /^on[A-Z]/.test(attribute.name))
      .map((attribute) => ({ end: attribute.end, start: attribute.start })),
  );
}

function versionStateDeriveReferences(
  model: ComponentModuleModel,
  stateDerives: readonly StateDeriveFact[],
  clientHref: string,
): SourceReplacement[] {
  if (stateDerives.length === 0) return [];

  const derivesByPlaceholder = new Map(stateDerives.map((derive) => [derive.placeholder, derive]));
  const replacements: SourceReplacement[] = [];

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

      replacements.push({
        end: attribute.end,
        replacement: `${attribute.name}="${escapeAttribute(`${clientHref}#${derive.exportName}`)}"`,
        start: attribute.start,
      });
    }
  }

  return replacements;
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
      throw new Error(`Render equivalence failed for ${check.artifact}`);
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
