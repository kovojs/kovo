import {
  createWitnessWeakSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

declare const appMutationAdapterBrand: unique symbol;

/**
 * Opaque framework-adapter mutation accepted by `app.integrateMutation()`.
 *
 * Ordinary app writes use `app.mutation({ ... })`. This capability exists for reviewed framework
 * adapters, such as Better Auth credential mutations, whose fixed identity and private authority
 * must survive app assembly (SPEC §6.2.1/§6.6).
 */
export type AppMutationAdapter<Definition extends { key: string } = { key: string }> =
  Definition & {
    readonly [appMutationAdapterBrand]: 'kovo.app-mutation-adapter';
  };

const appMutationAdapters = createWitnessWeakSet<object>();

/** @internal Mint the adapter witness in a reviewed framework integration module. */
export function registerAppMutationAdapter<Definition extends { key: string }>(
  definition: Definition,
): AppMutationAdapter<Definition> {
  witnessWeakSetAdd(appMutationAdapters, definition);
  return definition as AppMutationAdapter<Definition>;
}

/** @internal Verify exact adapter provenance before app ownership is attached. */
export function isAppMutationAdapter(value: unknown): value is AppMutationAdapter {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    witnessWeakSetHas(appMutationAdapters, value)
  );
}
