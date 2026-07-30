# Browser inline optimism v1

Kovo's technical-preview optimism API now has one app-authoring path:
`query.optimistic(...)` bindings inside `app.mutation({ optimistic: [...] })`.

Removed from `@kovojs/browser`:

- `MutationChangeRecord`
- `OptimisticChange`
- `OptimisticEntry`
- `OptimisticFor`
- `OptimisticPlan`
- `OptimisticQueryKey`
- `OptimisticTransform`

Removed from `@kovojs/server`:

- `KeyedQueryOptimisticOptions`
- `QueryOptimisticApply`
- `QueryOptimisticBinding`
- `QueryOptimisticStatus`

These were representation or support contracts, not useful independent capabilities. Their public
structural shapes encouraged string-keyed plans, copied bindings, schema drift, and tests that
reached through framework objects. Query handles now preserve app ownership, query result typing,
and exact mutation-schema identity; extracted predictors remain ordinary pure functions that can be
tested directly.

`OptimisticFor` remains on `@kovojs/browser/generated` only because compiler-emitted Drizzle modules
use it as a generated ABI exhaustiveness assertion. Runtime engine types stay package-internal.

Run:

```sh
kovo fix api-v1 --check
```

The `browser-inline-optimism-v1` batch is refusal-only. It anchors each retired root import or
re-export and asks the application to choose the exact query handles and pure predictor boundaries;
it does not invent those decisions. After migrating, rerun `kovo check optimistic` to prove every
invalidated query has either a predictor or an explicit `'await-fragment'` decision.

Rollback requires restoring the prior Kovo package versions and the prior authored plan objects
together. Do not restore the root type exports against the new runtime/compiler contract.
