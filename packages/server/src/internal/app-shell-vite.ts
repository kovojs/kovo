import '../security-bootstrap.js';

// Generated handlers run only behind compiler or emitted-runner bootstrap. Keeping this raw
// dispatcher on an internal subpath avoids a second cross-bundle lockdown after the emitted outer
// wrapper already guarded the realm (SPEC §6.6).
export { createRequestHandler } from '../app.js';
export { deriveClosedKovoApp } from '../app-snapshot.js';
export { runWithGeneratedLiveTargetRegistry } from '../live-target-registry.js';
export {
  createKovoAppShellDevDiagnosticLedger,
  createKovoAppShellViteDevIntegration,
  dispatchKovoAppShellViteDevRequest,
  kovoAppShellViteDevPlugin,
  renderKovoAppShellViteDevDiagnosticResponse,
  shouldHandleKovoAppShellViteRequest,
  type KovoAppShellDevDiagnosticLedger,
  type KovoAppShellDevDiagnosticRecord,
  type KovoAppShellDevModuleDiagnostics,
  type KovoAppShellViteCompilerModuleDiagnosticReport,
  type KovoAppShellViteDevIntegration,
  type KovoAppShellViteDevModuleServer,
  type KovoAppShellViteDevPlugin,
  type KovoAppShellViteDevPluginOptions,
  type KovoAppShellViteDevServer,
  type KovoAppShellViteMiddleware,
} from '../vite-dev.js';
export {
  kovoAppShellVitePlugin,
  type KovoAppShellVitePlugin,
  type KovoAppShellVitePluginOptions,
} from '../vite-plugin.js';
export {
  writeKovoAppShellVitePluginBuild,
  type KovoAppShellVitePluginBuildContext,
  type KovoAppShellVitePluginBuildResult,
} from '../vite-plugin-build.js';
export {
  kovoAppShellViteOutputDir,
  writeKovoAppShellViteBuildOutput,
  type KovoAppShellViteBuildOutput,
  type KovoAppShellViteBuildOutputOptions,
  type KovoAppShellViteOutputOptions,
} from '../vite-build-output.js';
export {
  assertWritableKovoAppShellViteClientModuleOutput,
  kovoAppShellViteClientModuleOutputPlan,
  writeKovoAppShellViteClientModuleOutput,
  type KovoAppShellViteClientModuleOutputPlanItem,
} from '../vite-client-module-output.js';
export {
  kovoAppShellViteBuildStaticExportAssets,
  kovoAppShellViteManifestFile,
  kovoAppShellViteStaticExportAssets,
  kovoAppShellViteStaticExportAssetsFromManifestFile,
  resolvedFileSystemPath,
  viteDistSourcePath,
  type KovoAppShellViteBuildStaticExportAssetOptions,
  type KovoAppShellViteManifestFileStaticExportAssetOptions,
  type KovoAppShellViteStaticExportAssetOptions,
} from '../vite-build-assets.js';
export {
  kovoAppShellViteManifestAssets,
  kovoAppShellViteManifestAssetsFromFile,
  kovoAppShellViteManifestFromBundle,
  kovoAppShellViteManifestFromFile,
  kovoAppShellViteManifestHints,
  kovoAppShellViteManifestStylesheetHref,
  kovoAppShellViteManifestStylesheetHrefFromFile,
  kovoAppShellViteRouteEntries,
  normalizedDistFile,
  type KovoAppShellBuildAsset,
  type KovoAppShellRouteBuildEntry,
  type KovoAppShellRouteEntryMap,
  type KovoAppShellViteManifest,
  type KovoAppShellViteManifestChunk,
  type KovoAppShellViteManifestHintOptions,
  type KovoAppShellViteOutputAsset,
  type KovoAppShellViteOutputBundle,
  type KovoAppShellViteOutputChunk,
  type KovoAppShellViteRouteEntryOptions,
} from '../vite-manifest.js';
export {
  createKovoAppShellBuild,
  type KovoAppShellBuild,
  type KovoAppShellBuildOptions,
  type KovoAppShellCompiledClientModule,
} from '../vite-build.js';
