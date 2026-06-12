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

export {
  checkedState,
  createChangeDetail,
  dataDisabled,
  dataOrientation,
  dataState,
  defaultTypeaheadTimeoutMs,
  dispatchCancelableChange,
  findTypeaheadMatch,
  mergeDataAttributes,
  moveCollectionIndex,
  navigationIntentFromKey,
  nextTypeaheadState,
  openState,
  pressedState,
} from './lib/index.js';
export type {
  CollectionOrientation,
  MoveOptions,
  NavigationIntent,
  NavigationItem,
  NavigationKeyOptions,
  PrimitiveChangeDetail,
  PrimitiveChangeDetailInput,
  PrimitiveDataAttributes,
  PrimitiveStateToken,
  TextDirection,
  TypeaheadItem,
  TypeaheadMatchOptions,
  TypeaheadState,
} from './lib/index.js';
