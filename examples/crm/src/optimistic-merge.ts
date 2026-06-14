import type { Form, FormInput, InvalidationSets, JsonValue, QueryRegistry } from '@jiso/core';
import type { OptimisticEntry, OptimisticPlan } from '@jiso/runtime';

// SPEC.md §10.4 (the override path): a PARTIALLY-derived mutation ships a
// generated plan covering only the pairs the deriver could lower, with the
// overridden (hand-written / await-fragment) pairs SUPPRESSED. The generated
// module therefore cannot use the exhaustive `OptimisticFor<typeof form>`
// (TypeScript would demand the overridden keys too). `CrmDerivedSubset` is the
// contextual type the generated override modules `satisfies`: it types each
// transform against its query's value and demands ONLY the derived `Keys`, so the
// generated source stays strict (no implicit `any`) while the mutation module is
// what merges the derived plan with the hand-written transforms and re-checks the
// full `OptimisticFor<...>` exhaustiveness.

type MutationKey<Definition> =
  Definition extends Form<infer Key, Record<string, JsonValue>, JsonValue> ? Key : never;

type InvalidatedQueryValues<Definition> = {
  [QueryName in MutationKey<Definition> extends keyof InvalidationSets
    ? Extract<InvalidationSets[MutationKey<Definition>], Extract<keyof QueryRegistry, string>>
    : never]: QueryRegistry[QueryName];
};

/**
 * The contextual type for a generated, partially-derived optimistic plan: the
 * plan shell (`queue` etc.) plus a `transforms` map keyed by exactly the derived
 * query names `Keys`, each typed to its query value. The overridden pairs live in
 * the mutation module, which spreads this plan and re-checks the exhaustive
 * `OptimisticFor<typeof form>`.
 */
export type CrmDerivedSubset<
  Definition extends Form<string, Record<string, JsonValue>, JsonValue>,
  Keys extends keyof InvalidatedQueryValues<Definition>,
> = Omit<OptimisticPlan<FormInput<Definition>>, 'transforms'> & {
  transforms: {
    [QueryName in Keys]: OptimisticEntry<
      FormInput<Definition>,
      InvalidatedQueryValues<Definition>[QueryName]
    >;
  };
};
