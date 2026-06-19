import type { Form, FormInput } from '@kovojs/core';
import type { OptimisticEntry, OptimisticPlan } from '@kovojs/runtime';

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

/**
 * The contextual type for a generated, partially-derived optimistic plan: the
 * plan shell (`queue` etc.) plus a `transforms` map keyed by exactly the
 * generated derived query names `Keys`. The overridden pairs live in the
 * mutation module, which spreads this plan and re-checks the exhaustive
 * `OptimisticFor<typeof form>`. This helper intentionally stays local to the CRM
 * authored source, so it does not depend on generated QueryRegistry or
 * InvalidationSets module augmentation being present in a clean checkout.
 */
export type CrmDerivedSubset<Definition extends Form<string, any, any>, Keys extends string> = Omit<
  OptimisticPlan<FormInput<Definition>>,
  'transforms'
> & {
  transforms: {
    [QueryName in Keys]: OptimisticEntry<any, any>;
  };
};
