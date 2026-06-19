export { createApp, createRequestHandler } from './app.js';
export { isKovoApp } from './app-guards.js';
// SPEC.md §9.5: apps inject a custom versioned client-module registry through
// `createApp({ clientModules })`. Real example/site consumers (examples/gallery,
// crm, stackoverflow, reference; site/src/client/modules.ts) construct one with
// `createMemoryVersionedClientModuleRegistry`, so the constructor and its option
// surface stay public at the root barrel (also available on the internal subpath).
export { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
export { toNodeHandler } from './node.js';
export { exportStaticApp } from './static-export.js';
export { StaticExportError } from './static-export-diagnostics.js';
export type {
  AppDiagnostic,
  AppDocumentOptions,
  AppErrorShellOptions,
  AppMutationResponseContext,
  AppMutationResponseOptions,
  AppMutationResponseResolver,
  AppRouteRenderContext,
  CreateAppOptions,
  ErrorShellRenderer,
  KovoApp,
  RequestHandler,
} from './app-types.js';
// Option/registry types named by `createApp({ clientModules })` and by app
// consumers that hold a registry reference (recursive publicness,
// rules/api-surface.md). They also remain on `@kovojs/server/internal/client-modules`.
export type {
  MemoryVersionedClientModuleRegistryOptions,
  VersionedClientModuleInput,
  VersionedClientModuleRegistry,
} from './client-modules.js';
export type { NodeHandlerOptions, NodeRequestHandler } from './node.js';
export type {
  StaticExportCompileDiagnostic,
  StaticExportDiagnostic,
  StaticExportDiagnosticSeverity,
} from './static-export-diagnostics.js';
export type {
  StaticExportNonExportablePolicy,
  StaticExportOptions,
  StaticExportResult,
} from './static-export-types.js';
export * from './api/data.js';
export * from './api/rendering.js';
export * from './api/routing.js';
