export const jisoHeadlessUiPrefix = 'jiso-' as const;

export {
  getPrimitivePlatformAudit,
  h1HeadlessUiPrimitives,
  h1PlatformAudit,
  primitivesRequiringLazyFallback,
  primitiveUsesNativeMechanism,
} from './platform-audit.js';
export type {
  HeadlessUiH1Primitive,
  LazyFallbackModule,
  NativePlatformMechanism,
  PlatformConcern,
  PlatformConcernAudit,
  PrimitivePlatformAudit,
} from './platform-audit.js';
