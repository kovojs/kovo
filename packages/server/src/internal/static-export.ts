import '../security-bootstrap.js';

// Framework-owned build runners preload the exact security profile before authored modules and
// use this raw orchestrator to avoid the public custom-runner assertion (SPEC §6.6/§9.5).
export { exportStaticApp } from '../static-export.js';

export {
  createStaticExportOutputPlan,
  STATIC_EXPORT_DRY_RUN_ROOT,
  staticExportAssetArtifacts,
  staticExportOutputPlan,
  staticExportOutputRoot,
  writeStaticExportOutput,
  type StaticExportOutputPlan,
  type StaticExportOutputPlanItem,
  type StaticExportOutputPlanItemKind,
  type StaticExportOutputPlanOptions,
} from '../static-export-output.js';
export {
  formatStaticExportDiagnostic,
  formatStaticExportDiagnostics,
  isStaticExportDiagnostic,
  isStaticExportDiagnosticError,
} from '../static-export-diagnostics.js';
export {
  assertStaticExportManifestMatchesResult,
  assertStaticExportManifestUsesDirectoryIndexDocuments,
  staticExportInventory,
  staticExportManifest,
} from '../static-export-result.js';
export { staticExportOutputTargets } from '../static-export-output-targets.js';
export type { StaticExportOutputTarget } from '../static-export-output-targets.js';
export type {
  StaticExportInventoryItem,
  StaticExportManifest,
  StaticExportManifestAsset,
  StaticExportManifestClientModule,
  StaticExportManifestRouteDocument,
} from '../static-export-types.js';
