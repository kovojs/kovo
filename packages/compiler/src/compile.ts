import { collectQueryUpdateCoverage, collectQueryUpdatePlans } from './analyze/query-updates.js';
import { componentCssAssetForFile, emitCssModule } from './css.js';
import { emitClientModule } from './emit/client.js';
import { emitRegistryModule } from './emit/registry.js';
import { emitServerModule, renderEquivalenceCheck, serverRenderLowering } from './emit/server.js';
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
import { viewTransitionLowering } from './lower/view-transitions.js';
import {
  inferComponentName,
  parseComponentModule as parseComponentModuleModel,
} from './scan/parse.js';
import {
  applyComponentPipelinePatches,
  componentPipelineState,
  lowerComponentPipelinePatches,
  lowerComponentPipelineSequence,
} from './model-pipeline.js';
import {
  mergePackageComponentPrefixFacts,
  packageComponentPrefixesForModule,
} from './package-prefixes.js';
import { isCompilerIrArtifact, validateAuthoringSurface } from './validate/authoring-surface.js';
import { validatePackageComponentPrefixes } from './validate/package-prefixes.js';
import { collectCompilerDiagnostics } from './validate/pipeline.js';
import { composeSourceOffsetMaps } from './shared.js';
import type { CompileComponentOptions, CompileResult } from './types.js';
import { compileArtifactFileNames, createEmptyCompileResult, emittedFileKind } from './types.js';

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
  const viewTransitions = viewTransitionLowering(originalState.model);
  let platformLowering = platformBehaviorLowering(originalState.model);
  const navigationPatch = lowerComponentPipelineSequence(
    originalState,
    [
      () => viewTransitions,
      (state) => {
        platformLowering = platformBehaviorLowering(state.model);
        return platformLowering;
      },
      (state) => navigationLinkLowering(state.model),
      (state) => navigationHrefLowering(state.model),
    ],
    parseComponentModuleModel,
  );
  const navigationState = navigationPatch.state;
  const deriveLowering = lowerInlineAttributeDerives(
    navigationState.model,
    componentName,
    compileOptions,
  );
  const derivePatch = lowerComponentPipelinePatches(
    navigationState,
    deriveLowering.replacements,
    parseComponentModuleModel,
    { prefix: deriveLowering.prefix },
  );
  const source = derivePatch.state.source;
  const diagnosticSource = options.source;
  const validationOffsetMap = composeSourceOffsetMaps(
    navigationPatch.sourceOffsetMap,
    derivePatch.sourceOffsetMap,
  );
  const model = derivePatch.state.model;
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

  const clientSource = emitClientModule(handlers, queryUpdatePlans, componentName);
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
  const serverRender = serverRenderLowering(versionedHandlers, model);
  const serverRenderPatch = applyComponentPipelinePatches(
    derivePatch.state,
    serverRender.replacements,
  );
  const serverRenderedSource = serverRenderPatch.source;
  const serverSource = emitServerModule(serverRenderedSource);
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
      ...packagePrefixDiagnostics,
      ...validationDiagnostics,
    ],
    files: [
      { fileName: fileNames.server, kind: 'server', source: serverSource },
      { fileName: fileNames.client, kind: 'client', source: clientSource },
      ...(cssSource ? [{ fileName: fileNames.css, kind: 'css' as const, source: cssSource }] : []),
      { fileName: fileNames.registry, kind: 'registry', source: registrySource },
    ],
    handlerExports: versionedHandlers.map((handler) => handler.exportName),
    cssAssets,
    platformSubstitutions: platformLowering.substitutions,
    queryUpdatePlans,
    renderEquivalenceChecks: [
      renderEquivalenceCheck(fileNames.server, serverRenderedSource, serverSource),
    ],
    updateCoverage,
    viewTransitions: viewTransitions.stamps,
  };
}

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

export function assertRenderEquivalence(result: CompileResult): void {
  for (const check of result.renderEquivalenceChecks) {
    if (!check.ok) {
      throw new Error(`Render equivalence failed for ${check.artifact}`);
    }
  }
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
