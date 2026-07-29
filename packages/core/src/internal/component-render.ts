import {
  securityWeakMap,
  securityWeakMapGet,
  securityWeakMapHas,
  securityWeakMapSet,
} from './security-witness-intrinsics.js';

/**
 * @internal Snapshot retained for framework renderers after `component()` mints an opaque handle.
 *
 * App code receives no structural path back to this value. The exact module-private WeakMap entry,
 * not a property, brand field, cast, or global symbol, is the runtime authority (SPEC §4.1/§6.6).
 */
export interface ComponentRuntimeDefinition {
  clocks?: Record<string, unknown>;
  css?: string;
  disableServerRefresh?: boolean;
  errorBoundary?: {
    fallback: unknown | ((error: unknown) => unknown);
    target?: string;
  };
  isomorphic?: boolean;
  mutations?: Record<string, unknown>;
  props?: Record<string, unknown>;
  queries?: unknown;
  render: (...args: any[]) => unknown;
  state?: (() => unknown) | undefined;
}

/**
 * @internal Runtime slot carrier shared by framework renderers.
 *
 * The app-facing `component()` signature spells its inferred mutation-form slots inline so this
 * framework plumbing never becomes recursive public API (SPEC §4.1/§6.3).
 */
export interface ComponentRuntimeRenderSlots {
  children?: unknown;
  forms?: Record<string, unknown>;
  [slot: string]: unknown;
}

const componentDefinitions = securityWeakMap<object, ComponentRuntimeDefinition>();

/** @internal Mint the one definition association for an exact component handle. */
export function registerComponentDefinition(
  component: object,
  definition: ComponentRuntimeDefinition,
): void {
  if (securityWeakMapHas(componentDefinitions, component)) {
    throw new TypeError('Kovo refused to replace an existing component definition.');
  }
  securityWeakMapSet(componentDefinitions, component, definition);
}

/** @internal Resolve an exact framework-minted component handle for rendering. */
export function componentDefinitionForFramework(component: object): ComponentRuntimeDefinition {
  const definition = securityWeakMapGet(componentDefinitions, component);
  if (definition === undefined) {
    throw new TypeError('Kovo refused a component descriptor without framework provenance.');
  }
  return definition;
}

/** @internal Test exact component provenance without invoking user-controlled properties. */
export function isFrameworkComponentDescriptor(value: unknown): value is object {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    securityWeakMapHas(componentDefinitions, value)
  );
}

// Re-exported from the leaf `../forms-types.js` module so this internal subpath
// stays stable without forming a `index.ts <-> forms-types.ts` barrel cycle
// (SPEC §4.5/§6.3).
export type { ComponentMutationDefinitions, ComponentMutationForms } from '../forms-types.js';
