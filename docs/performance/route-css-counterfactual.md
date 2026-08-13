# Route CSS counterfactual

This study answers one narrow question from `plans/good-perf.md` Phase 3: would splitting the
capability-matched Kovo listing/detail stylesheet reduce route-critical bytes without increasing the
bytes transferred by a complete listing/detail session? It is a deterministic byte and correctness
study, not a timing benchmark and not evidence that Kovo currently emits this split.

## Authenticated workload

`scripts/fixtures/perf-route-css/workload.json` binds the calculation to the real matched workload:

| Role                         | Repository source                        | Pinned SHA-256                                                     |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| CSS delivered by both routes | `benchmarks/kovo/src/styles.css`         | `713cffba81912d9c0f415e989481f32db022773729cbcf6ece70a01fd8f75c0c` |
| Kovo route/component source  | `benchmarks/kovo/src/app.tsx`            | `06e437f3a574b4f8a036b312a3273f6552b3363276441b21db5d8a1f2c1e188d` |
| Browser workload lane        | `benchmarks/run-all.mjs`                 | `3defbb4a998e97465e6d954180d248da6fbb1eb28dc7aa60a756bbf5d8d1093c` |
| Matched content contract     | `benchmarks/shared/matched-fixture.json` | `81c57cbd937a1e7014cf337a2deb34abf30dae2b8f23bed548b898b15840787a` |

The runner parses the pinned TSX and derives class ownership from `MatchedL0Shell`,
`MatchedL0ListingPage`, `MatchedProductCard`, and `MatchedProductPage`. It parses every top-level
rule from the real stylesheet, assigns route-exclusive rules to listing or detail, keeps shared,
mixed, and unreachable rules in the conservative base chunk, and proves that the rule census
reconstructs the source stylesheet byte for byte. The current compiler splitter is bundled from
source and its complete esbuild input closure is hashed in the report. This uses the same emitted
stylesheet accounting boundary described by SPEC §13.1.

Changing a pinned source without updating and reviewing the workload manifest aborts before any
decision. Even if a source digest is updated, missing route declarations, dynamic component class
expressions, component classes absent from CSS, unowned CSS classes, incomplete rule parsing, and
fixture/source identity mismatches remain fail-closed errors.

## Acceptance rule and result

Brotli quality 11 static-response-body bytes are the primary route-critical representation;
identity bytes remain visible as a duplication check. A split is eligible only when every fresh
route saves at least 10% Brotli bytes, correctness is complete, and neither Brotli nor identity
bytes regress for either full-session order under immutable content-addressed caching.

For the bound fixture, the unsplit asset is 1,060 Brotli bytes and 3,948 identity bytes. The
counterfactual listing delivery is 1,090 Brotli bytes and 3,471 identity bytes; detail is 1,077 and
3,338 bytes respectively. Although identity bytes fall by 12.08% and 15.45%, Brotli bytes regress
by 2.83% and 1.60%. A listing/detail session transfers 1,321 Brotli bytes, a 24.62% regression,
while identity bytes are effectively flat at 3,944 bytes.

The result is `threshold-not-met`: retain the current unsplit stylesheet and do not implement the
route split for this workload.

Run the authenticated calculation with:

```sh
vp exec node scripts/perf-route-css.mjs --out /tmp/kovo-route-css.json
```

A publishable report requires a clean committed source tree. The report uses
`kovo-route-css-counterfactual/v2` and includes source, derivation, compiler-closure, workload, and
decision digests so CI artifacts can be reviewed independently.
