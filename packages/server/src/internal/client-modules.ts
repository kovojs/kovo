export {
  commitVersionedClientModuleStaging,
  computeRenderPlanFingerprint,
  createMemoryVersionedClientModuleStore,
  createMemoryVersionedClientModuleRegistry,
  finalizeVersionedClientModuleBuild,
  isVersionedClientModuleBuildSealed,
  RENDER_PLAN_GRAMMAR_VERSION,
  renderVersionedClientModuleResponse,
  replaceVersionedClientModuleBuildSnapshot,
  snapshotVersionedClientModuleRegistry,
  versionedClientModuleHref,
} from '../client-modules.js';
export type {
  MemoryVersionedClientModuleRegistryOptions,
  RenderPlanFingerprintInput,
  VersionedClientModuleActiveSnapshot,
  VersionedClientModuleInput,
  VersionedClientModuleRegistry,
  VersionedClientModuleRequest,
  VersionedClientModuleResponse,
  VersionedClientModuleStore,
} from '../client-modules.js';
