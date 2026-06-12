import { collectQueryUpdateCoverage, collectQueryUpdatePlans } from './analyze/query-updates.js';
import { componentCssAssetForFile, emitCssModule } from './css.js';
import { emitClientModule } from './emit/client.js';
import { emitRegistryModule } from './emit/registry.js';
import { emitServerModule, renderEquivalenceCheck, serverRenderSource } from './emit/server.js';
import { componentGraphFact, findFragmentTargetFacts } from './graph.js';
import {
  clientModuleUrl,
  clientModuleVersion,
  lowerEventHandlers,
  versionHandlerLowering,
} from './lower/handlers.js';
import { lowerInlineAttributeDerives } from './lower/inline-derives.js';
import { lowerNavigationHrefs, lowerNavigationLinks } from './lower/navigation.js';
import { lowerPlatformBehaviors } from './lower/platform.js';
import { lowerViewTransitions } from './lower/view-transitions.js';
import {
  inferComponentName,
  parseComponentModule as parseComponentModuleModel,
} from './scan/parse.js';
import { componentPipelineState, lowerComponentPipelineSource } from './model-pipeline.js';
import {
  mergePackageComponentPrefixFacts,
  packageComponentPrefixesForModule,
} from './package-prefixes.js';
import { isCompilerIrArtifact, validateAuthoringSurface } from './validate/authoring-surface.js';
import { validatePackageComponentPrefixes } from './validate/package-prefixes.js';
import { collectCompilerDiagnostics } from './validate/pipeline.js';
import type { CompileComponentOptions, CompileResult } from './types.js';
import { compileArtifactFileNames, createEmptyCompileResult, emittedFileKind } from './types.js';

export function compileComponentModule(options: CompileComponentOptions): CompileResult {
  const packageComponentPrefixes = mergePackageComponentPrefixFacts(
    packageComponentPrefixesForModule(options),
    options.packageComponentPrefixes,
  );
  const compileOptions = { ...options, packageComponentPrefixes };

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
  const authoringSurfaceDiagnostics = validateAuthoringSurface(options, originalModel);
  const componentName = inferComponentName(options.fileName, originalModel);
  const originalState = componentPipelineState(options.fileName, options.source, originalModel);
  const viewTransitionLowering = lowerViewTransitions(originalState.source, originalState.model);
  const viewTransitionState = lowerComponentPipelineSource(
    originalState,
    viewTransitionLowering.source,
    parseComponentModuleModel,
  );
  const platformLowering = lowerPlatformBehaviors(
    viewTransitionState.source,
    viewTransitionState.model,
  );
  const platformState = lowerComponentPipelineSource(
    viewTransitionState,
    platformLowering.source,
    parseComponentModuleModel,
  );
  const linksLoweredState = lowerComponentPipelineSource(
    platformState,
    lowerNavigationLinks(platformState.source, platformState.model),
    parseComponentModuleModel,
  );
  const navigationState = lowerComponentPipelineSource(
    linksLoweredState,
    lowerNavigationHrefs(linksLoweredState.source, linksLoweredState.model),
    parseComponentModuleModel,
  );
  const deriveLowering = lowerInlineAttributeDerives(
    navigationState.source,
    navigationState.model,
    componentName,
    compileOptions,
  );
  const source = deriveLowering.source;
  const diagnosticSource = deriveLowering.diagnosticSource;
  const model = lowerComponentPipelineSource(
    navigationState,
    source,
    parseComponentModuleModel,
  ).model;
  const handlers = lowerEventHandlers({ ...compileOptions, source }, componentName, model);
  const queryUpdatePlans = collectQueryUpdatePlans(source, model, componentName);
  const updateCoverage = collectQueryUpdateCoverage(source, model, compileOptions, componentName);
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
    sourceOffsetMap: deriveLowering.sourceOffsetMap,
    updateCoverage,
  });
  const fileNames = compileArtifactFileNames(options.fileName);

  const clientSource = emitClientModule(handlers, queryUpdatePlans, componentName);
  const clientHref = clientModuleUrl(options.fileName, clientModuleVersion(clientSource));
  const versionedHandlers = handlers.map((handler) =>
    versionHandlerLowering(handler, options.fileName, clientHref),
  );
  const cssSource = emitCssModule(source, componentName, model);
  const fragmentTargetFacts = findFragmentTargetFacts(componentName, model);
  const fragmentTargets = fragmentTargetFacts.map((fact) => fact.target);
  const componentGraphFacts = [componentGraphFact(componentName, model, fragmentTargets)];
  const cssAssets = cssSource
    ? [componentCssAssetForFile(fileNames.css, componentName, fragmentTargets, {}, cssSource)]
    : [];
  const serverRenderedSource = serverRenderSource(source, versionedHandlers, model);
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
    viewTransitions: viewTransitionLowering.stamps,
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
    viewTransitions: viewTransitionLowering.stamps,
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
