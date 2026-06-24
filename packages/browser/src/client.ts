// Browser bootstrap surface (SPEC §§4.4, 9.1, 9.4). App entries name only the
// value helpers below; the exported types form the fully-public option surface
// `installKovoLoader` and `createBrowserKovoRoot` require (recursive publicness,
// rules/api-surface.md). Loader engine internals (morph apply, enhanced-mutation
// submit, the event bus, broadcast/queue, optimistic apply, submit context,
// inline-query/refetch, lifecycle) are `@internal` and no longer re-exported here.

// --- Value helpers an app entry installs ---
export { createBrowserKovoRoot, defaultEnhancedFetch } from './browser-root.js';
export { installKovoLoader } from './loader.js';
export { createQueryStore } from './query-store.js';

// --- Browser-root + loader option surface ---
export type { BrowserKovoRoot, CreateBrowserKovoRootOptions } from './browser-root.js';
export type { BrowserEnhancedMutationOptions, KovoLoader, KovoLoaderOptions } from './loader.js';
export type { EnhancedMutationLoaderOptions } from './mutation-submit.js';
export type {
  QuerySnapshot,
  QueryStore,
  QueryUpdatePlan,
  QueryVersionSnapshot,
} from './query-store.js';

// --- DOM-shape supporting types named by the loader option surface ---
export type {
  AttributeElementLike,
  AttributeMutatorLike,
  AttributeReaderLike,
  AttributeWriterLike,
  ClosestElementLike,
  DomAttributeLike,
  DomAttributeListLike,
  ListenerTargetLike,
  OptionalQuerySelectorAllRootLike,
  QuerySelectorAllRootLike,
  TargetElementLike,
  VisibilityStateLike,
} from './dom-like.js';

// --- Event/error context types named by the loader option surface ---
export type {
  DelegatedEvent,
  EventElementLike,
  EventTargetLike,
  RuntimeErrorContext,
  TypedEvent,
  UploadProgressElementLike,
} from './events.js';

// --- Root/lifecycle/observer types named by the loader option surface ---
export type { FragmentTargetRoot } from './fragment-targets.js';
export type { ImportHandlerModule } from './handlers.js';
export type {
  LoaderLifecycleTarget,
  LoaderRoot,
  VisibleObserver,
  VisibleObserverEntry,
  VisibleObserverFactory,
} from './loader-lifecycle.js';
export type { QueryScriptLike } from './query-script-hydration.js';

// --- Morph/target/fetch types named by the enhanced-mutation option surface ---
export type { MorphFragment, MorphRoot, MorphTarget } from './morph.js';
// Structural-morph shape types used by hand-written conformance test helpers
// (e.g. examples/commerce/src/app-test-helpers.ts), which assert keyed reuse
// across reorder per SPEC.md §9.1. The morph engine functions stay `@internal`.
export type {
  StructuralMorphBrowserState,
  StructuralMorphKey,
  StructuralMorphNode,
} from './morph.js';
export type { TargetCollectorRoot } from './mutation-targets.js';
export type {
  EnhancedMutationFetch,
  EnhancedMutationFetchOptions,
  EnhancedMutationResponseLike,
  UploadProgress,
} from './mutation-fetch.js';
export type { EnhancedFormElementLike } from './mutation-form.js';
export type { MutationBroadcast } from './broadcast.js';
export type { MutationChangeRecord } from './optimism.js';
export type { PendingElementLike, PendingRoot } from './pending.js';

// --- Query-binding/event/refetch types named by the loader option surface ---
export type { QueryApplyInterposition } from './query-apply.js';
export type {
  CompiledQueryDerive,
  CompiledQueryStamp,
  CompiledQueryTemplateStamp,
  CompiledQueryUpdatePlan,
  CompiledQueryUpdatePlans,
  QueryBindingElement,
  QueryBindingRoot,
} from './query-bindings.js';
export type {
  InlineQueryEvent,
  InlineQueryEventDetail,
  QueryEventHydrationTarget,
} from './query-events.js';
export type {
  QueryRefetchFetch,
  QueryRefetchOptions,
  QueryRefetchResponse,
} from './query-refetch.js';
export type { QueryChunk, QueryElementChunkLike, QueryScriptChunkLike } from './wire-parser.js';
